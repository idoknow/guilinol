import test from 'node:test'
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {createHash, createHmac, randomBytes, randomUUID} from 'node:crypto'
import {createServer} from 'node:http'
import {once} from 'node:events'
import {setTimeout as delay} from 'node:timers/promises'
import sharp from 'sharp'
import WebSocket from 'ws'
import pg from 'pg'
import {
  createCheatCaptureService,
  signCheatCaptureToken,
  verifyCheatCaptureToken,
} from '../server/cheat-captures.mjs'
import {multiplayer} from '../server/mp-admin.mjs'
import {database} from '../server/postgres.mjs'
import {onRequest} from '../functions/api/[[path]].ts'
import {fixture} from './selfhost-test.mjs'

function memoryBucket() {
  const store = new Map()
  return {
    store,
    async put(key, data) {
      store.set(key, Buffer.from(data))
    },
    async get(key) {
      const buf = store.get(key)
      if (!buf) return null
      return {
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(buf))
            controller.close()
          },
        }),
      }
    },
    async delete(keys) {
      for (const k of [].concat(keys)) store.delete(k)
    },
  }
}

async function freePort() {
  const listener = createServer().listen(0, '127.0.0.1')
  await once(listener, 'listening')
  const {port} = listener.address()
  await new Promise((resolve) => listener.close(resolve))
  return port
}

test('token verification enforces HMAC domain separation, expiry and schema', () => {
  const secret = 'unit-secret-key'
  const nowMs = Date.now()
  const base = {
    id: randomUUID(),
    uid: 100234,
    name: '测试玩家',
    fp: 'a'.repeat(16),
    kind: 'speed',
    at: nowMs,
    exp: Math.floor(nowMs / 1000) + 120,
    state: '步行',
    activity: 'walk',
    activityDetail: '',
    foot: true,
    bike: '',
    speed: 42.5,
    flatSpeed: 42.5,
    vspeed: 0,
    reportedSpeed: 9,
    overflow: 20,
    pos: [-185, 3, 35],
    attemptPos: [-140, 3, 35],
  }

  const valid = signCheatCaptureToken(base, secret)
  const parsed = verifyCheatCaptureToken(valid, secret, nowMs)
  assert.ok(parsed)
  assert.equal(parsed.id, base.id)
  assert.equal(parsed.uid, 100234)
  assert.equal(parsed.kind, 'speed')
  assert.equal(parsed.speed, 42.5)
  assert.deepEqual(parsed.pos, [-185, 3, 35])
  assert.deepEqual(parsed.attemptPos, [-140, 3, 35])

  // Wrong secret
  assert.equal(verifyCheatCaptureToken(valid, 'wrong-secret', nowMs), null)

  // Tampered payload
  const [body, sig] = valid.split('.')
  const tamperedBody = Buffer.from(JSON.stringify({...base, uid: 100999})).toString('base64url')
  assert.equal(verifyCheatCaptureToken(`${tamperedBody}.${sig}`, secret, nowMs), null)

  // Domain separation: join-ticket style HMAC without cheat-capture prefix must fail
  const plainSig = createHmac('sha256', secret).update(body).digest('base64url')
  assert.equal(verifyCheatCaptureToken(`${body}.${plainSig}`, secret, nowMs), null)

  // Expired token
  const expired = signCheatCaptureToken({...base, exp: Math.floor(nowMs / 1000) - 5}, secret)
  assert.equal(verifyCheatCaptureToken(expired, secret, nowMs), null)

  // Invalid kind
  const badKind = signCheatCaptureToken({...base, kind: 'unknown_hack'}, secret)
  assert.equal(verifyCheatCaptureToken(badKind, secret, nowMs), null)
})

test('realtime server emits signed cheat_capture on cheats and full API upload + admin view works end-to-end', async (context) => {
  const secret = 'rt-capture-secret-' + randomUUID()
  const adminToken = 'rt-admin-' + randomUUID()
  const port = await freePort()
  const wsUrl = `ws://127.0.0.1:${port}/ws`

  const rtProc = spawn(process.execPath, ['rt/server-realtime.mjs'], {
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_URL: '',
      RT_JOIN_SECRET: secret,
      RT_ADMIN_TOKEN: adminToken,
      RT_AC_CAPTURE_COOLDOWN_MS: '0',
      MAX_PLAYERS: '20',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const sockets = []
  let rtLogs = ''
  rtProc.stdout.on('data', (d) => { rtLogs += d })
  rtProc.stderr.on('data', (d) => { rtLogs += d })
  context.after(async () => {
    for (const s of sockets) s.terminate()
    if (rtProc.exitCode === null && rtProc.signalCode === null) {
      const exited = once(rtProc, 'exit')
      rtProc.kill()
      await exited
    }
  })

  for (let i = 0; i < 100; i++) {
    if (await fetch(`http://127.0.0.1:${port}/health`).then((r) => r.ok).catch(() => false)) break
    await delay(100)
  }

  const mintTicket = (uid, name) => {
    const p = Buffer.from(JSON.stringify({uid, name, exp: Math.floor(Date.now() / 1000) + 55})).toString('base64url')
    return `${p}.${createHmac('sha256', secret).update(p).digest('base64url')}`
  }

  async function connectPlayer(uid, name, x = -185, y = 3, z = 35) {
    const ws = new WebSocket(wsUrl)
    sockets.push(ws)
    const messages = []
    ws.on('message', (raw) => messages.push(JSON.parse(String(raw))))
    await once(ws, 'open')
    ws.send(JSON.stringify({
      t: 'join',
      ticket: mintTicket(uid, name),
      name,
      x,
      y,
      z,
      yaw: 0,
      fp: 'b'.repeat(16),
      dev: 'TestPC|Chrome 130',
    }))
    for (let i = 0; i < 40; i++) {
      if (messages.some((m) => m.t === 'welcome')) break
      await delay(50)
    }
    return {
      ws,
      messages,
      pos: (px, py, pz, extra = {}) => ws.send(JSON.stringify({t: 'pos', x: px, y: py, z: pz, yaw: 0, v: 9, ...extra})),
    }
  }

  // 1. Normal walking produces NO cheat_capture
  const walker = await connectPlayer(100501, '正常步行者', -185, 3, 35)
  for (let i = 1; i <= 8; i++) {
    walker.pos(-185 + i * 0.08, 3, 35)
    await delay(90)
  }
  assert.equal(walker.messages.filter((m) => m.t === 'cheat_capture').length, 0, 'normal walking must not emit cheat_capture')

  // 2. Speed cheat emits signed cheat_capture BEFORE setback
  const cheater = await connectPlayer(100502, '测试开挂者', -185, 3, 35)
  let x = -185
  for (let i = 0; i < 8; i++) {
    x += 0.1
    cheater.pos(x, 3, 35)
    await delay(90)
  }
  cheater.pos(x+30,10,35)
  await delay(150)
  const speedIdx = cheater.messages.findIndex((m) => m.t === 'cheat_capture' && m.kind === 'speed')
  const setbackIdx = cheater.messages.findIndex((m) => m.t === 'setback' && m.kind === 'speed')
  assert.ok(speedIdx >= 0, 'speed cheat must emit cheat_capture: ' + rtLogs)
  assert.ok(setbackIdx > speedIdx, 'cheat_capture must arrive before setback so pre-setback state is preserved')
  const speedCapture = cheater.messages[speedIdx]
  assert.equal(speedCapture.speedBasis,'accepted-horizontal')
  assert.ok(speedCapture.speed>0 && speedCapture.speed<4,'rejected displacement must not inflate the walking average')
  assert.ok(Array.isArray(speedCapture.pos) && speedCapture.pos.length === 3)
  assert.ok(Array.isArray(speedCapture.attemptPos) && speedCapture.attemptPos.length === 3)

  // 3. Teleport cheat emits signed cheat_capture
  cheater.pos(x,3,35);await delay(100);cheater.pos(600, 3, 600)
  await delay(150)
  const tpCapture = cheater.messages.find((m) => m.t === 'cheat_capture' && m.kind === 'teleport')
  assert.ok(tpCapture, 'illegal teleport must emit cheat_capture')

  // 4. Protocol attack (mount_player) emits cheat_capture BEFORE banned
  const victim = await connectPlayer(100503, '路人', -185, 3, 36)
  const victimId = victim.messages.find((m) => m.t === 'welcome')?.me?.id
  const attacker = await connectPlayer(100504, '协议攻击者', -185, 3, 35)
  await delay(100)
  attacker.ws.send(JSON.stringify({t: 'mount_player', target: victimId}))
  await delay(200)
  const atkCapIdx = attacker.messages.findIndex((m) => m.t === 'cheat_capture' && m.kind === 'mount_player')
  const banIdx = attacker.messages.findIndex((m) => m.t === 'banned')
  assert.ok(atkCapIdx >= 0, 'protocol attack must emit cheat_capture')
  assert.ok(banIdx > atkCapIdx, 'cheat_capture must arrive before banned disconnect')

  // 5. Full API + Postgres + Storage verification (skipped only if postgres fixture unavailable)
  let storage
  try {
    storage = await fixture({postgresOnly: true})
  } catch (err) {
    context.diagnostic('Postgres fixture unavailable, skipping DB portion: ' + err.message)
    return
  }
  const pool = new pg.Pool({connectionString: storage.env.DATABASE_URL})
  context.after(async () => {
    await pool.end()
    await storage.close()
  })

  // Create Admin, Cheater (uid=100502), and Other user
  const adminTokenCookie = randomBytes(32).toString('hex')
  const cheaterCookie = randomBytes(32).toString('hex')
  const otherCookie = randomBytes(32).toString('hex')

  await pool.query(
    `INSERT INTO users(id, email, nickname, salt, digest, verified, role, uid)
     OVERRIDING SYSTEM VALUE
     VALUES ('adm-1','adm@example.test','管理员','','',1,'admin',100500),
            ('usr-cheat','cheat@example.test','测试开挂者','','',1,'user',100502),
            ('usr-other','other@example.test','其他玩家','','',1,'user',100505)`,
  )
  for (const [tok, uidStr] of [[adminTokenCookie, 'adm-1'], [cheaterCookie, 'usr-cheat'], [otherCookie, 'usr-other']]) {
    await pool.query('INSERT INTO sessions VALUES($1, $2, unixepoch()+600)', [
      createHash('sha256').update(tok).digest('hex'),
      uidStr,
    ])
  }

  const bucket = memoryBucket()
  const mp = multiplayer(pool, {RT_ADMIN_TOKEN: adminToken, MP_WORLD_MANIFEST_URL: 'http://127.0.0.1:1/none'})
  const captureSvc = createCheatCaptureService(pool, {RT_JOIN_SECRET: secret}, {
    bucket,
    resolvePlace: mp.resolvePlace,
  })
  mp.setCheatCaptures(captureSvc)

  const env = {
    DB: database(pool),
    FEEDBACK: bucket,
    RT_JOIN_SECRET: secret,
    RT_ADMIN_TOKEN: adminToken,
    mpAdmin: mp.route,
    cheatCaptureUpload: captureSvc.upload,
  }

  const sampleJpeg = await sharp({
    create: {width: 640, height: 360, channels: 3, background: {r: 32, g: 64, b: 96}},
  }).jpeg({quality: 80}).toBuffer()

  const origin = 'http://glol.test'
  const metaHeader = Buffer.from(JSON.stringify({
    stateLabel: '步行 · 地面',
    activity: 'walk',
    speedMs: 9.0,
    verticalSpeedMs: 0,
    grounded: true,
    pos: [-185, 3, 35],
    landmark: '解放桥',
    landmarkDist: 0,
    fallback: false,
  })).toString('base64url')

  const callApi = (path, {method = 'GET', cookie = '', headers = {}, body} = {}) => onRequest({
    env,
    request: new Request(`${origin}/api/${path}`, {
      method,
      headers: {
        ...(method !== 'GET' ? {origin} : {}),
        ...(cookie ? {cookie: `glol_session=${cookie}`} : {}),
        ...headers,
      },
      body,
    }),
  })

  // Unauthenticated upload rejected
  assert.equal((await callApi('mp/cheat-capture', {
    method: 'POST',
    headers: {'content-type': 'image/jpeg', 'x-cheat-capture-token': speedCapture.token},
    body: sampleJpeg,
  })).status, 401)

  // Cross-account upload rejected (other user tries to upload cheater's token)
  assert.equal((await callApi('mp/cheat-capture', {
    method: 'POST',
    cookie: otherCookie,
    headers: {'content-type': 'image/jpeg', 'x-cheat-capture-token': speedCapture.token},
    body: sampleJpeg,
  })).status, 403)

  // Non-JPEG rejected
  assert.equal((await callApi('mp/cheat-capture', {
    method: 'POST',
    cookie: cheaterCookie,
    headers: {'content-type': 'image/jpeg', 'x-cheat-capture-token': speedCapture.token},
    body: Buffer.from('not a real jpeg file at all ' + 'x'.repeat(80)),
  })).status, 400)

  // Valid upload succeeds
  const uploadRes = await callApi('mp/cheat-capture', {
    method: 'POST',
    cookie: cheaterCookie,
    headers: {
      'content-type': 'image/jpeg',
      'x-cheat-capture-token': speedCapture.token,
      'x-cheat-capture-meta': metaHeader,
    },
    body: sampleJpeg,
  })
  assert.equal(uploadRes.status, 200)
  const uploadJson = await uploadRes.json()
  assert.equal(uploadJson.ok, true)
  assert.equal(uploadJson.id, speedCapture.id)
  assert.equal(uploadJson.width, 640)
  assert.equal(uploadJson.height, 360)
  assert.equal(uploadJson.landmark, '解放桥')

  // Replay with same token rejected with 409
  const replayRes = await callApi('mp/cheat-capture', {
    method: 'POST',
    cookie: cheaterCookie,
    headers: {'content-type': 'image/jpeg', 'x-cheat-capture-token': speedCapture.token},
    body: sampleJpeg,
  })
  assert.equal(replayRes.status, 409)

  // Upload second capture (teleport)
  const tpUploadRes = await callApi('mp/cheat-capture', {
    method: 'POST',
    cookie: cheaterCookie,
    headers: {
      'content-type': 'image/jpeg',
      'x-cheat-capture-token': tpCapture.token,
      'x-cheat-capture-meta': metaHeader,
    },
    body: sampleJpeg,
  })
  assert.equal(tpUploadRes.status, 200)

  // Regular user forbidden from admin list / image / delete
  assert.equal((await callApi('admin/mp/cheat-captures', {cookie: cheaterCookie})).status, 403)
  assert.equal((await callApi(`admin/mp/cheat-captures/${speedCapture.id}/image`, {cookie: cheaterCookie})).status, 403)
  assert.equal((await callApi(`admin/mp/cheat-captures/${speedCapture.id}`, {method: 'DELETE', cookie: cheaterCookie})).status, 403)

  // Admin can list all captures with rich telemetry & account linkage
  const listRes = await callApi('admin/mp/cheat-captures?uid=100502&kind=speed', {cookie: adminTokenCookie})
  assert.equal(listRes.status, 200)
  const listJson = await listRes.json()
  assert.equal(listJson.total, 1)
  assert.equal(listJson.captures.length, 1)
  const item = listJson.captures[0]
  assert.equal(item.id, speedCapture.id)
  assert.equal(item.uid, 100502)
  assert.equal(item.nickname, '测试开挂者')
  assert.equal(item.accountId, 'usr-cheat')
  assert.equal(item.stateLabel, '步行 · 地面')
  assert.equal(item.meta.speedBasis,'accepted-horizontal')
  assert.ok(Math.abs(item.speedMs-speedCapture.speed)<0.001)
  const page=async(offset)=> (await (await callApi(`admin/mp/cheat-captures?uid=100502&limit=1&offset=${offset}`,{cookie:adminTokenCookie})).json()).captures
  assert.notEqual((await page(0))[0].id,(await page(1))[0].id)
  assert.deepEqual(await page(2),[])
  const filtered=async(fp,offset)=>(await (await callApi(`admin/mp/cheat-captures?uid=100502&fp=${fp}&limit=1&offset=${offset}`,{cookie:adminTokenCookie})).json())
  assert.equal((await filtered('a'.repeat(16),0)).total,0)
  assert.equal((await filtered('b'.repeat(16),1)).captures.length,1)
  await pool.query("insert into admin_audit(actor_id,action,target_type,target_id,detail) values ('adm-1','mp.unban','mp','100502','{}')")
  const audit=await (await callApi('admin/audit?target_type=mp',{cookie:adminTokenCookie})).json()
  const unban=audit.items.find(row=>row.action==='mp.unban' && row.target_id==='100502')
  assert.equal(unban.mp_nickname,'测试开挂者');assert.equal(unban.mp_account_id,'usr-cheat')
  assert.equal(item.landmark, '解放桥')
  assert.equal(item.imageUrl, `/api/admin/mp/cheat-captures/${speedCapture.id}/image`)

  // Admin can fetch stored JPEG image with security headers
  const imgRes = await callApi(`admin/mp/cheat-captures/${speedCapture.id}/image`, {cookie: adminTokenCookie})
  assert.equal(imgRes.status, 200)
  assert.equal(imgRes.headers.get('content-type'), 'image/jpeg')
  assert.equal(imgRes.headers.get('x-content-type-options'), 'nosniff')
  assert.match(imgRes.headers.get('content-security-policy') || '', /sandbox/)
  const fetchedBytes = Buffer.from(await imgRes.arrayBuffer())
  assert.deepEqual(fetchedBytes, sampleJpeg)

  // Admin can delete capture and audit trail is recorded
  if(process.env.CAPTURE_BROWSER==='1'){
    const {preview}=await import('vite'),{chromium}=await import('playwright'),{browserOptions}=await import('./qa-browser.mjs')
    const web=await preview({configFile:false,build:{outDir:'dist'},preview:{host:'127.0.0.1',port:0},plugins:[{name:'fixture-api',configurePreviewServer(server){
      server.middlewares.use('/api',async(req,res,next)=>{try{
        const url=new URL('/api'+req.url,`http://${req.headers.host}`)
        const result=await onRequest({env,request:new Request(url,{method:req.method,headers:req.headers})})
        res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()))
      }catch(error){next(error)}})
    }}]})
    try{
      const browser=await chromium.launch(browserOptions())
      try{
        const base=`http://127.0.0.1:${web.httpServer.address().port}`,page=await browser.newPage()
        await page.context().addCookies([{name:'glol_session',value:adminTokenCookie,url:base}])
        page.on('dialog',dialog=>dialog.accept());await page.goto(base+'/admin/?view=security')
        for(const [index,label] of ['删除截图','删除抓拍'].entries()){
          const card=page.locator('.adm-capture-card').first()
          if(index)await card.getByText('查看大图').click()
          const button=(index?page.locator('dialog'):card).getByRole('button',{name:label,exact:true})
          const [response]=await Promise.all([page.waitForResponse(r=>r.request().method()==='DELETE'&&r.url().includes('/api/admin/mp/cheat-captures/')),button.click()])
          assert.equal(response.status(),200)
          const id=new URL(response.url()).pathname.split('/').pop()
          assert.equal((await pool.query("select count(*)::int n from admin_audit where action='mp.cheat_capture.delete' and detail->>'captureId'=$1",[id])).rows[0].n,1)
          await page.waitForFunction(count=>document.querySelectorAll('.adm-capture-card').length===count,1-index)
          console.log(`${label}: HTTP DELETE 200, one persisted audit row`)
        }
      }finally{await browser.close()}
    }finally{await web.close()}
  }else{
    const delRes = await callApi(`admin/mp/cheat-captures/${speedCapture.id}`, {method: 'DELETE', cookie: adminTokenCookie})
    assert.equal(delRes.status, 200)
  }
  assert.equal((await callApi(`admin/mp/cheat-captures/${speedCapture.id}/image`, {cookie: adminTokenCookie})).status, 404)
  const auditRow = (await pool.query("SELECT action, target_id FROM admin_audit WHERE action='mp.cheat_capture.delete'")).rows[0]
  assert.equal(auditRow.target_id, '100502')
})
