import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {gunzipSync} from 'node:zlib'
import {chromium} from 'playwright'
import {preview} from 'vite'

/**
 * M6-3 自由划船全自动验证脚本 (`verify:boat`)。
 * 覆盖施工图 (boat-spec.md) 与派工单全部验收点：
 *   1. 码头防抢键回归 + 上自由小船 (rowboat) / 竹筏 (freeRaft)
 *   2. 自由划行物理（前划加速、松手惯性滑行、左右转向、倒桨后退）
 *   3. 斜撞岸贴边滑行不卡死（不穿岸、不触发 rescue）
 *   4. 高桥正常穿行（榕湖玻璃桥、漓江解放桥）
 *   5. 低桥拦截并发 walk:toast + .toast.show（榕杉连桥矮跨、杉湖九曲桥）
 *   6. 湖心拒下 + 靠岸下船
 *   7. 跨湖穿行榕湖 → 桂湖（Route 3 经迎宾桥/丽泽桥微阶 <= 1.2 m）
 *   8. 闸坝拦停并发 walk:toast + .toast.show（木龙湖闸 3.9 m 跌水）
 *   9. 漓江自由竹筏顺流漂移（1.2–2.0 m 区间）
 *  10. 手机 390×844 船上按钮与摇杆/HUD 不重叠 + 触屏摇杆划船
 */

const BOUNDS = JSON.parse(await readFile('pipeline/vessel-bounds.json', 'utf8'))
const VEHICLES = JSON.parse(gunzipSync(await readFile('dist/world/vehicles.bin')))

// 由 dist/world/vehicles.bin Route 3（榕湖 → 桂湖）提取实测全通航中心线
const RONGHU_TO_GUIHU_ROUTE = VEHICLES.routes.find(r => r.start === '榕湖' && r.end === '桂湖')
assert(RONGHU_TO_GUIHU_ROUTE?.path?.length > 10, 'vehicles.bin 缺少 榕湖 → 桂湖 航线')

// 施工图第 5.1 节码头自由栈桥岸点（freeBank）与泊位参考坐标
const FREE_DOCKS = {
  ronghu: {name: '榕湖', kind: 'rowboat', label: '划小船', freeBank: [-1340, 326], mooring: [-1340, 320.5]},
  mulong: {name: '木龙湖', kind: 'rowboat', label: '划小船', freeBank: [-344, -1570], mooring: [-344, -1574]},
  jiefang: {name: '解放桥码头', kind: 'freeRaft', label: '划竹筏', freeBank: [-164, 162], mooring: [-170.9, 159.1]},
  shanhu: {name: '杉湖', kind: 'rowboat', label: '划小船', freeBank: [-842, 546], mooring: [-844, 550]},
}

function sampleWaypoints(path, minStep = 8) {
  const pts = []
  let last = null
  for (let i = 0; i < path.length; i++) {
    const p = [path[i][0], path[i][2]]
    if (!last || i === path.length - 1 || Math.hypot(p[0] - last[0], p[1] - last[1]) >= minStep) {
      pts.push(p)
      last = p
    }
  }
  return pts
}

const server = await preview({root: 'web', configFile: 'web/vite.config.ts', preview: {host: '127.0.0.1', port: 0}})
const baseUrl = `http://127.0.0.1:${server.httpServer.address().port}`
const errors = []
let browser

try {
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  })

  // ---------- 通用页面辅助工具 ----------
  async function attachHelpers(page) {
    await page.addInitScript(() => {
      window.__boatToasts = []
      window.addEventListener('walk:toast', ev => {
        const detail = ev.detail || {}
        window.__boatToasts.push({
          text: String(detail.text ?? ''),
          ms: detail.ms ?? null,
          at: performance.now(),
        })
      })
    })
  }

  async function gotoWalk(page, urlQuery = 'mode=walk&verify&flow=0') {
    await page.route('**/favicon.ico', route => route.fulfill({status: 204}))
    await page.route('**/api/t', route => route.fulfill({status: 204}))
    await page.goto(`${baseUrl}/?${urlQuery}`)
    await page.waitForFunction(() => window.viewer?.walk?.active, null, {timeout: 90000})
    await page.waitForSelector('.vehicle-action', {state: 'attached', timeout: 45000})
  }

  async function closeSpotCard(page) {
    const close = page.locator('.spot-card.show .card-close')
    if (await close.isVisible().catch(() => false)) await close.click()
  }

  async function clearToasts(page) {
    await page.evaluate(() => {
      window.__boatToasts = []
      document.querySelector('.toast')?.classList.remove('show')
    })
  }

  async function enterSpot(page, x, z, heading = 0, reason = 'boat-test') {
    const ok = await page.evaluate(async ([px, pz, h, tag]) => {
      const {walk, stream, manifest} = window.viewer
      walk.leave()
      const res = await walk.enter(px, pz, h, tag)
      if (!res) return false
      const nearby = manifest.chunks.filter(tile =>
        Math.hypot(Math.max(0, Math.abs(px - tile.x - 128) - 128), Math.max(0, Math.abs(pz - tile.z - 128) - 128)) <= 64,
      )
      const deadline = performance.now() + 15000
      while (nearby.some(tile => !stream.loaded.has(tile)) && performance.now() < deadline) {
        stream.tick(walk.position)
        await new Promise(r => setTimeout(r, 16))
      }
      for (let i = 0; i < 6; i++) {
        walk.tick(1 / 60)
        await new Promise(requestAnimationFrame)
      }
      return true
    }, [x, z, heading, reason])
    assert(ok, `无法在 (${x}, ${z}) 落脚 [${reason}]`)
  }

  async function triggerAction(page, expectedText, mobile = false) {
    await closeSpotCard(page)
    await page.waitForFunction(
      text => {
        const btn = document.querySelector('.vehicle-action')
        return btn && !btn.hidden && btn.textContent?.includes(text)
      },
      expectedText,
      {timeout: 15000},
    )
    if (mobile) {
      await page.locator('.vehicle-action').tap()
    } else {
      await page.keyboard.press('f')
    }
    await page.evaluate(async () => {
      const {walk} = window.viewer
      for (let i = 0; i < 6; i++) {
        walk.tick(1 / 60)
        await new Promise(requestAnimationFrame)
      }
    })
  }

  /**
   * 页面内确定性步进器与舵机引导。
   * 冻结 rAF 中的 walk.tick，使用固定 1/60s 驱动，并在中途同步 stream.tick。
   * 兼容读取 walk.probe().boat 与既有 walk.boatClearance() 字段，待与 Hy-agy 群里字段最终对齐。
   */
  async function runInPage(page, fn, arg) {
    return page.evaluate(async ({fnSrc, arg}) => {
      const {walk, stream, manifest} = window.viewer
      const advance = walk.tick
      walk.tick = () => {}
      const keys = new Set()

      function press(code, on) {
        if (keys.has(code) === on) return
        window.dispatchEvent(new KeyboardEvent(on ? 'keydown' : 'keyup', {code}))
        if (on) keys.add(code)
        else keys.delete(code)
      }

      function releaseAll() {
        for (const k of [...keys]) press(k, false)
      }

      function readBoat() {
        const p = walk.probe()
        const b = p.boat ?? null
        const clr = walk.boatClearance()
        const pos = walk.position
        return {
          probe: p,
          boat: b,
          clearanceInfo: clr,
          kind: b?.kind ?? b?.vessel ?? clr?.kind ?? null,
          speed: b?.speed ?? b?.vLong ?? walk.speed ?? 0,
          vLong: b?.vLong ?? b?.speed ?? walk.speed ?? 0,
          vLat: b?.vLat ?? 0,
          waterY: b?.waterY ?? b?.currentWaterY ?? null,
          clearance: b?.clearance ?? clr?.clearance ?? null,
          blocked: b?.blocked ?? b?.reason ?? b?.obstacle ?? null,
          x: pos.x,
          y: pos.y,
          z: pos.z,
          heading: walk.heading,
        }
      }

      async function ensureTileLoaded(x, z) {
        const tile = manifest.chunks.find(t => x >= t.x && x < t.x + 256 && z >= t.z && z < t.z + 256)
        if (!tile || stream.loaded.has(tile)) return
        const deadline = performance.now() + 15000
        const pt = walk.position.clone().set(tile.x + 128, walk.position.y, tile.z + 128)
        while (!stream.loaded.has(tile) && performance.now() < deadline) {
          stream.tick(pt)
          await new Promise(r => setTimeout(r, 20))
        }
      }

      function step(n = 1, dt = 1 / 60) {
        for (let i = 0; i < n; i++) advance(dt)
      }

      async function faceTarget(tx, tz, maxSteps = 240) {
        for (let i = 0; i < maxSteps; i++) {
          const pos = walk.position
          const angle = Math.atan2(-(tx - pos.x), -(tz - pos.z)) - walk.heading
          const err = Math.atan2(Math.sin(angle), Math.cos(angle))
          if (Math.abs(err) < 0.04) break
          press('KeyA', err > 0.025)
          press('KeyD', err < -0.025)
          advance(1 / 60)
        }
        press('KeyA', false)
        press('KeyD', false)
      }

      async function steerTo(waypoints, opts = {}) {
        const {
          arriveDist = 2.6,
          maxSecondsPerLeg = 45,
          allowBlockStop = false,
          turnOnlyAngle = 0.42,
        } = opts
        let minClearance = Infinity
        let sawUnsafeProbe = false
        let sawResetOrHouse = false
        const history = []

        for (let wi = 0; wi < waypoints.length; wi++) {
          const [tx, tz] = waypoints[wi]
          await ensureTileLoaded(tx, tz)
          const limit = Math.ceil(maxSecondsPerLeg * 60)
          let arrived = false
          for (let i = 0; i < limit; i++) {
            const pos = walk.position
            const dx = tx - pos.x, dz = tz - pos.z
            const dist = Math.hypot(dx, dz)
            if (dist < arriveDist) {
              arrived = true
              break
            }
            if (i % 60 === 0) {
              await ensureTileLoaded(pos.x, pos.z)
              stream.tick(pos)
              await new Promise(r => setTimeout(r, 0))
            }
            const angle = Math.atan2(-dx, -dz) - walk.heading
            const err = Math.atan2(Math.sin(angle), Math.cos(angle))
            press('KeyA', err > 0.04)
            press('KeyD', err < -0.04)
            press('KeyW', Math.abs(err) < turnOnlyAngle)
            advance(1 / 60)

            const info = readBoat()
            if (info.clearance !== null && Number.isFinite(info.clearance)) {
              minClearance = Math.min(minClearance, info.clearance)
            }
            if (info.probe.resets > 0 || info.probe.inHouse) sawResetOrHouse = true
            if (info.probe.wet === false) sawUnsafeProbe = true
            if (i % 15 === 0) history.push({x: +info.x.toFixed(2), z: +info.z.toFixed(2), waterY: info.waterY})
          }
          if (!arrived && !allowBlockStop) {
            releaseAll()
            const last = readBoat()
            throw Error(`航路点 #${wi} (${tx}, ${tz}) 未能到达，停在 (${last.x.toFixed(1)}, ${last.z.toFixed(1)}), blocked=${last.blocked}`)
          }
        }
        releaseAll()
        return {minClearance, sawUnsafeProbe, sawResetOrHouse, history, end: readBoat()}
      }

      const fn = eval(`(${fnSrc})`)
      try {
        return await fn({
          walk, stream, manifest, advance, step, press, releaseAll,
          readBoat, ensureTileLoaded, faceTarget, steerTo, arg,
        })
      } finally {
        releaseAll()
        walk.tick = advance
      }
    }, {fnSrc: fn.toString(), arg})
  }

  // ==================== 桌面端 800×450 验收 ====================
  const page = await browser.newPage({viewport: {width: 800, height: 450}})
  page.on('pageerror', err => errors.push(`desktop pageerror: ${err.message}`))
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(`desktop console: ${msg.location().url}: ${msg.text()}`)
  })
  await attachHelpers(page)
  await gotoWalk(page)

  // --- 用例 1：防抢键回归 + 榕湖上自由小船 (rowboat) + 自由划行物理 ---
  const [autoDockX, , autoDockZ] = VEHICLES.docks['榕湖']
  await enterSpot(page, autoDockX, autoDockZ, 0, 'ronghu-auto-dock')
  await closeSpotCard(page)
  await page.waitForFunction(
    () => document.querySelector('.vehicle-action')?.textContent?.includes('上船 · 榕湖'),
    null,
    {timeout: 15000},
  )
  console.log('1a. 防回归抢键通过: 榕湖自动码头仍显示 上船 · 榕湖')

  // Bug 3 回归用例: ±40m 邻片未齐备不提前残缺解析 + 未解出泊位失败缓存防每帧暴力重扫
  const slotCacheCheck = await runInPage(page, async ({walk, stream, manifest, advance, ensureTileLoaded}) => {
    // 1) 木龙湖码头 (-336, -1564) 距北邻片 z=-1536 仅 28m (>22m, <40m)：北邻片未加载时不应提前执行解析
    await ensureTileLoaded(-336, -1564)
    await ensureTileLoaded(-336, -1530)
    walk.leave()
    await walk.enter(-344, -1570, 0, 'bug3-neighbor-guard')
    const northTile = manifest.chunks.find(t => -336 >= t.x && -336 < t.x + 256 && -1530 >= t.z && -1530 < t.z + 256)
    const savedNorth = northTile ? stream.loaded.get(northTile) : null
    let deferredWhenMissingNeighbor = false
    let resolvedOnceRestored = false
    if (northTile && savedNorth) {
      stream.loaded.delete(northTile)
      try {
        advance(1 / 60)
        const mulongMoor = walk.freeMoorings.find(m => m.name === '木龙湖')
        deferredWhenMissingNeighbor = !!mulongMoor && !mulongMoor.resolved && (mulongMoor.resolveRuns ?? 0) === 0
      } finally {
        stream.loaded.set(northTile, savedNorth)
      }
      advance(1 / 60)
      const afterRestore = walk.freeMoorings.find(m => m.name === '木龙湖')
      resolvedOnceRestored = !!afterRestore && afterRestore.resolved && afterRestore.resolveRuns === 1
    }

    // 2) 龙船坪码头 (-1340, 2916) 模拟无水不可解出泊位：首帧失败后，后续 20 帧不得重复全环暴力扫描
    walk.leave()
    await walk.enter(-1340, 2906, 0, 'bug3-fail-cache')
    const lcpTiles = manifest.chunks.filter(t =>
      stream.loaded.has(t) &&
      Math.hypot(Math.max(0, Math.abs(-1340 - t.x - 128) - 128), Math.max(0, Math.abs(2916 - t.z - 128) - 128)) <= 64,
    )
    const waterBackups = lcpTiles.map(t => [t, Int16Array.from(stream.loaded.get(t).water)])
    for (const [t] of waterBackups) stream.loaded.get(t).water.fill(-32768)
    let getCallsIn20Frames = 0
    let lcpRuns = -1
    try {
      advance(1 / 60) // 首帧尝试解析失败并写入缓存
      const origGet = stream.loaded.get.bind(stream.loaded)
      stream.loaded.get = k => {
        getCallsIn20Frames++
        return origGet(k)
      }
      try {
        for (let i = 0; i < 20; i++) advance(1 / 60)
      } finally {
        stream.loaded.get = origGet
      }
      lcpRuns = walk.freeMoorings.find(m => m.name === '龙船坪码头')?.resolveRuns ?? -1
    } finally {
      for (const [t, bak] of waterBackups) stream.loaded.get(t)?.water.set(bak)
    }
    let lcpRecovered = false
    let lcpRunsAfterRestore = -1
    if (lcpTiles.length > 0) {
      const t0 = lcpTiles[0]
      const saved0 = stream.loaded.get(t0)
      if (saved0) {
        stream.loaded.delete(t0)
        try {
          advance(1 / 60)
        } finally {
          stream.loaded.set(t0, saved0)
        }
        advance(1 / 60)
        const lcpAfter = walk.freeMoorings.find(m => m.name === '龙船坪码头')
        lcpRecovered = !!lcpAfter && lcpAfter.resolved && Array.isArray(lcpAfter.bank) && Array.isArray(lcpAfter.mooring)
        lcpRunsAfterRestore = lcpAfter?.resolveRuns ?? -1
      }
    }
    return {
      deferredWhenMissingNeighbor,
      resolvedOnceRestored,
      getCallsIn20Frames,
      lcpRuns,
      lcpRecovered,
      lcpRunsAfterRestore,
      maxExpectedGets: manifest.chunks.length * 25,
    }
  })
  assert(slotCacheCheck.deferredWhenMissingNeighbor && slotCacheCheck.resolvedOnceRestored, `邻片 (28m 处) 未加载防护或恢复解析异常: ${JSON.stringify(slotCacheCheck)}`)
  assert(slotCacheCheck.getCallsIn20Frames < slotCacheCheck.maxExpectedGets && slotCacheCheck.lcpRuns === 1, `未解泊位每帧暴力重扫未缓存: ${JSON.stringify(slotCacheCheck)}`)
  assert(slotCacheCheck.lcpRecovered && slotCacheCheck.lcpRunsAfterRestore === 2, `龙船坪码头恢复水深后未能恢复解析: ${JSON.stringify(slotCacheCheck)}`)
  console.log('1a-cache. 泊位 ±40m 邻片防护与失败缓存通过:', {
    deferred: slotCacheCheck.deferredWhenMissingNeighbor,
    lcpRuns: slotCacheCheck.lcpRuns,
    lcpRecovered: slotCacheCheck.lcpRecovered,
    gets20f: slotCacheCheck.getCallsIn20Frames,
  })

  // 全量检查 10 个 walk.freeMoorings 在正常水域下全部 resolved（含 1a-cache 之后的龙船坪码头）
  const allMooringsCheck = await runInPage(page, async ({walk, advance, ensureTileLoaded}) => {
    const initial = walk.freeMoorings
    for (const m of initial) {
      const [dx, , dz] = m.dock
      for (const ox of [-40, 0, 40]) {
        for (const oz of [-40, 0, 40]) {
          await ensureTileLoaded(dx + ox, dz + oz)
        }
      }
      walk.leave()
      const entered = await walk.enter(dx, dz, 0, `mooring-all-${m.name}`)
      if (!entered) throw new Error(`无法在码头 ${m.name} (${dx}, ${dz}) 附近落脚`)
      advance(1 / 60)
    }
    return walk.freeMoorings
  })
  assert.equal(allMooringsCheck.length, 10, `自由码头总数应为 10，实际 ${allMooringsCheck.length}`)
  const unresolvedMoorings = allMooringsCheck.filter(m => !m.resolved || !Array.isArray(m.bank) || !Array.isArray(m.mooring))
  assert.deepEqual(unresolvedMoorings, [], `存在正常水域下未解析成功的自由码头: ${JSON.stringify(unresolvedMoorings)}`)
  const lcpMooring = allMooringsCheck.find(m => m.name === '龙船坪码头')
  assert(lcpMooring?.resolved, `龙船坪码头在 1a-cache 后未保持 resolved: ${JSON.stringify(lcpMooring)}`)
  console.log('1a-moorings. 10 处自由码头正常水域全量解析与龙船坪恢复通过:', {
    resolved: `${allMooringsCheck.filter(m => m.resolved).length}/${allMooringsCheck.length}`,
    lcpBank: lcpMooring.bank.map(v => +v.toFixed(1)),
  })

  await enterSpot(page, ...FREE_DOCKS.ronghu.freeBank, 0, 'ronghu-free-bank')
  await triggerAction(page, FREE_DOCKS.ronghu.label)

  const mountInfo = await runInPage(page, ({readBoat}) => ({
    vehicle: window.viewer.walk.vehicle,
    boatState: readBoat(),
  }))
  assert.equal(mountInfo.vehicle, 'boat', '登上自由小船后 walk.vehicle 应为 boat')
  assert(mountInfo.boatState.boat !== null, 'walk.probe().boat 应已就绪并包含自由船探测字段')
  assert.equal(mountInfo.boatState.kind, 'rowboat', `榕湖自由船型应为 rowboat，实际: ${mountInfo.boatState.kind}`)

  // 自由划行物理检查：朝东偏北开阔水面 (-1270, 304)
  const physicsRes = await runInPage(page, async ({faceTarget, press, step, readBoat}) => {
    await faceTarget(-1270, 304)
    const start = readBoat()
    press('KeyW', true)
    step(150) // 2.5s 前进加速
    const peak = readBoat()
    press('KeyW', false)

    // 松手惯性滑行 0.6s (36步) + 再滑行 1.4s
    step(36)
    const coast06 = readBoat()
    step(84)
    const coast20 = readBoat()

    // 转向检查 (KeyA 左转 heading 增大, KeyD 右转 heading 减小)
    const h0 = coast20.heading
    press('KeyA', true)
    step(36)
    const hAfterA = readBoat().heading
    press('KeyA', false)
    press('KeyD', true)
    step(36)
    const hAfterD = readBoat().heading
    press('KeyD', false)

    // 倒桨检查 (KeyS)
    const revStart = readBoat()
    press('KeyS', true)
    step(72) // 1.2s
    const revEnd = readBoat()
    press('KeyS', false)
    const revFwd = [-Math.sin(revStart.heading), -Math.cos(revStart.heading)]
    const revMoveAlong = (revEnd.x - revStart.x) * revFwd[0] + (revEnd.z - revStart.z) * revFwd[1]

    return {
      peakSpeed: peak.speed,
      driftDist06: Math.hypot(coast06.x - peak.x, coast06.z - peak.z),
      coast06Speed: coast06.speed,
      coast20Speed: coast20.speed,
      turnLeftDelta: Math.atan2(Math.sin(hAfterA - h0), Math.cos(hAfterA - h0)),
      turnRightDelta: Math.atan2(Math.sin(hAfterD - hAfterA), Math.cos(hAfterD - hAfterA)),
      revSpeed: revEnd.vLong,
      revMoveAlong,
      wet: peak.probe.wet && coast06.probe.wet && revEnd.probe.wet,
      inHouse: peak.probe.inHouse || revEnd.probe.inHouse,
      resets: revEnd.probe.resets,
    }
  })
  assert(physicsRes.peakSpeed >= 2.6 && physicsRes.peakSpeed <= 3.9, `rowboat 静水极速异常: ${JSON.stringify(physicsRes)}`)
  assert(physicsRes.driftDist06 > 0.4, `松手 0.6s 惯性滑行不足: ${JSON.stringify(physicsRes)}`)
  assert(physicsRes.coast06Speed > 0.3 && physicsRes.coast06Speed < physicsRes.peakSpeed, `惯性衰减异常: ${JSON.stringify(physicsRes)}`)
  assert(physicsRes.coast20Speed < physicsRes.coast06Speed, `水阻未继续收敛: ${JSON.stringify(physicsRes)}`)
  assert(physicsRes.turnLeftDelta > 0.25 && physicsRes.turnRightDelta < -0.25, `左右转向异常: ${JSON.stringify(physicsRes)}`)
  assert(physicsRes.revSpeed < -0.5 || physicsRes.revMoveAlong < -0.5, `倒桨后退异常: ${JSON.stringify(physicsRes)}`)
  assert(physicsRes.wet && !physicsRes.inHouse && physicsRes.resets === 0, `自由划行状态不安全: ${JSON.stringify(physicsRes)}`)
  console.log('1b. 自由划行物理通过:', {
    peakSpeed: +physicsRes.peakSpeed.toFixed(2),
    drift06m: +physicsRes.driftDist06.toFixed(2),
    revAlong: +physicsRes.revMoveAlong.toFixed(2),
  })

  // Bug 4 回归用例: 大帧间隔 dt=0.25s 限幅 <= 0.12s (<=8 子步)，消除低帧率 15 子步射线风暴
  const dtClampRes = await runInPage(page, async ({faceTarget, press, step, advance, readBoat}) => {
    await faceTarget(-1270, 304)
    press('KeyW', true)
    step(150) // 达静水巡航极速 ~3.3m/s
    const before = readBoat()
    advance(0.25) // 单帧卡顿 250ms，应限幅为 120ms
    const after = readBoat()
    press('KeyW', false)
    return {
      speedBefore: before.speed,
      stepDist: Math.hypot(after.x - before.x, after.z - before.z),
    }
  })
  assert(dtClampRes.stepDist >= 0.25 && dtClampRes.stepDist <= 0.46, `dt=0.25s 未按 0.12s 限幅 (15子步射线风暴): ${JSON.stringify(dtClampRes)}`)
  console.log('1c. 大帧间隔 dt=0.25s 步进限幅通过:', {stepDist: +dtClampRes.stepDist.toFixed(3)})

  // --- 用例 2：斜撞岸贴边滑行不卡死 ---
  const shoreSlide = await runInPage(page, async ({steerTo, faceTarget, press, step, readBoat}) => {
    // 驶向榕湖南岸斜坡岸线前开阔位置 (-1324, 322)
    await steerTo([[-1324, 322]], {arriveDist: 2.5})
    // 瞄准南偏东 (-1304, 358)，以约 30° 斜角撞击东南走向驳岸，保持 KeyW 推力 4s
    await faceTarget(-1304, 358)
    const start = readBoat()
    const samples = []
    press('KeyW', true)
    for (let i = 0; i < 240; i++) {
      step(1)
      if (i % 15 === 0) {
        const s = readBoat()
        samples.push({x: s.x, z: s.z, speed: s.speed, wet: s.probe.wet, resets: s.probe.resets, inHouse: s.probe.inHouse})
      }
    }
    press('KeyW', false)
    const end = readBoat()
    const halfIdx = Math.floor(samples.length / 2)
    const lateSlide = Math.hypot(end.x - samples[halfIdx].x, end.z - samples[halfIdx].z)
    return {
      totalDist: Math.hypot(end.x - start.x, end.z - start.z),
      lateSlide,
      eastGain: end.x - start.x,
      allWet: samples.every(s => s.wet !== false),
      anyReset: samples.some(s => s.resets > 0),
      anyHouse: samples.some(s => s.inHouse),
    }
  })
  assert(shoreSlide.totalDist > 6 && shoreSlide.lateSlide > 1.5 && shoreSlide.eastGain > 4, `斜撞岸贴边滑行疑似卡死: ${JSON.stringify(shoreSlide)}`)
  assert(shoreSlide.allWet && !shoreSlide.anyReset && !shoreSlide.anyHouse, `斜撞岸穿岸或触发重置: ${JSON.stringify(shoreSlide)}`)
  console.log('2a. 斜撞岸贴边滑行通过:', {
    totalDist: +shoreSlide.totalDist.toFixed(2),
    lateSlide: +shoreSlide.lateSlide.toFixed(2),
    eastGain: +shoreSlide.eastGain.toFixed(2),
  })

  // Bug 2 回归用例: 摇杆未严格回中微偏舵 (|inRight| > 0.05) 擦撞 4m 水面网格锯齿岸线仍顺岸滑行不卡死
  const shoreSteerSlide = await runInPage(page, async ({steerTo, faceTarget, step, readBoat}) => {
    await steerTo([[-1324, 322]], {arriveDist: 2.5})
    await faceTarget(-1304, 358)
    const panel = document.querySelector('.walk-ui')
    const joy = document.querySelector('.walk-ui .joystick')
    const wasHidden = panel.hidden
    panel.hidden = false
    const jr = joy.getBoundingClientRect()
    const half = Math.max(1, jr.width / 2)
    const cx = jr.left + half, cy = jr.top + half
    const start = readBoat()
    let mid = null
    let allSafe = true
    try {
      // 模拟摇杆前推同时向岸侧微偏 ~18% (inRight ≈ 0.08 > 0.05)，验证不会因一刀切阈值禁用顺岸滑行而卡死
      joy.dispatchEvent(new PointerEvent('pointerdown', {pointerId: 42, pointerType: 'touch', clientX: cx, clientY: cy, bubbles: true}))
      joy.dispatchEvent(new PointerEvent('pointermove', {pointerId: 42, pointerType: 'touch', clientX: cx + half * 0.18, clientY: cy - half * 0.95, bubbles: true}))
      for (let i = 0; i < 240; i++) {
        step(1)
        if (i === 120) mid = readBoat()
        const cur = readBoat()
        if (cur.probe.wet === false || cur.probe.resets > 0 || cur.probe.inHouse) allSafe = false
      }
    } finally {
      joy.dispatchEvent(new PointerEvent('pointerup', {pointerId: 42, pointerType: 'touch', clientX: cx, clientY: cy, bubbles: true}))
      panel.hidden = wasHidden
    }
    const end = readBoat()
    return {
      totalDist: Math.hypot(end.x - start.x, end.z - start.z),
      lateSlide: Math.hypot(end.x - mid.x, end.z - mid.z),
      eastGain: end.x - start.x,
      allSafe,
    }
  })
  assert(shoreSteerSlide.totalDist > 6 && shoreSteerSlide.lateSlide > 1.5 && shoreSteerSlide.eastGain > 3.0, `微偏舵斜撞 4m 锯齿岸线卡死: ${JSON.stringify(shoreSteerSlide)}`)
  assert(shoreSteerSlide.allSafe, `微偏舵贴岸滑行发生穿岸或重置: ${JSON.stringify(shoreSteerSlide)}`)
  console.log('2b. 微偏舵斜撞 4m 锯齿岸线滑行通过:', {
    totalDist: +shoreSteerSlide.totalDist.toFixed(2),
    lateSlide: +shoreSteerSlide.lateSlide.toFixed(2),
  })

  // --- 用例 3：高桥穿行（榕湖古榕双桥）+ 低桥拦截（IDOK-66 接地低平玻璃桥）并发 walk:toast + 湖心拒下 & 靠岸下船 ---
  await clearToasts(page)
  const highBridge = await runInPage(page, async ({steerTo, readBoat}) => {
    await steerTo([[-1344, 304], [-1372, 292], [-1400, 268], [-1412, 240]], {arriveDist: 2.8})
    const east = readBoat()
    const res = await steerTo([[-1432, 216], [-1448, 204], [-1472, 192]], {arriveDist: 2.6})
    return {
      eastX: east.x,
      westX: res.end.x,
      minClearance: res.minClearance,
      toasts: [...window.__boatToasts],
      sawUnsafe: res.sawUnsafeProbe || res.sawResetOrHouse,
    }
  })
  assert(highBridge.eastX > -1425 && highBridge.westX < -1465, `未能完整穿过古榕双桥: ${JSON.stringify(highBridge)}`)
  assert(highBridge.minClearance >= 0.30, `古榕双桥净空不足: ${JSON.stringify(highBridge)}`)
  assert.equal(highBridge.toasts.length, 0, `过古榕双桥不应触发拦截 toast: ${JSON.stringify(highBridge.toasts)}`)
  assert(!highBridge.sawUnsafe, '过古榕双桥期间发生异常落水/进屋/重置')
  console.log('3a. 高桥穿行通过 (古榕双桥):', {westX: +highBridge.westX.toFixed(1), minClearance: +highBridge.minClearance.toFixed(2)})

  // 回到西榕湖开阔水面驶向玻璃桥 (-1174, 286) [IDOK-66 桥底净高约 0.9m < 1.6m]
  await runInPage(page, async ({steerTo}) => {
    await steerTo([[-1448, 204], [-1412, 240], [-1372, 292], [-1300, 304], [-1260, 298], [-1186, 286]], {arriveDist: 2.2})
  })
  await clearToasts(page)
  const lowBridge = await runInPage(page, async ({faceTarget, press, step, readBoat}) => {
    await faceTarget(-1174, 286)
    let minClearance = Infinity
    let maxTravelDist = 0
    const start = readBoat()
    press('KeyW', true)
    for (let i = 0; i < 360; i++) { // 6.0s 持续撞向矮桥
      step(1)
      const cur = readBoat()
      if (cur.clearance !== null && Number.isFinite(cur.clearance)) minClearance = Math.min(minClearance, cur.clearance)
      maxTravelDist = Math.max(maxTravelDist, Math.hypot(cur.x - start.x, cur.z - start.z))
    }
    press('KeyW', false)
    const end = readBoat()
    const toastEl = document.querySelector('.toast')
    const toastVisible = toastEl?.classList.contains('show') ?? false
    const toastText = toastEl?.textContent ?? ''
    return {
      endX: end.x,
      endZ: end.z,
      minClearance,
      maxTravelDist,
      toastVisible,
      toastText,
      events: [...window.__boatToasts],
      blocked: end.blocked,
      inHouse: end.probe.inHouse,
      resets: end.probe.resets,
    }
  })
  assert(lowBridge.endX < -1175, `船体越过了玻璃桥矮跨轴线: ${JSON.stringify(lowBridge)}`)
  assert(lowBridge.minClearance >= 0, `矮桥穿模！最小净空小于 0: ${JSON.stringify(lowBridge)}`)
  assert(lowBridge.events.length > 0 && lowBridge.toastVisible, `低桥拦截未发 walk:toast 或未显示 .toast.show: ${JSON.stringify(lowBridge)}`)
  assert(/净高|无法通过/.test(lowBridge.toastText) && /净高|无法通过/.test(lowBridge.events[0].text), `低桥提示文案不符合施工图: ${JSON.stringify(lowBridge)}`)
  console.log('3b. 低桥拦截通过 (榕湖玻璃桥):', {
    stopAt: [+lowBridge.endX.toFixed(1), +lowBridge.endZ.toFixed(1)],
    toast: lowBridge.toastText,
  })

  // 倒桨脱困 -> 回榕湖开阔湖心拒下 -> 回自由栈桥靠岸下船
  await runInPage(page, async ({press, step, steerTo}) => {
    press('KeyS', true)
    step(72)
    press('KeyS', false)
    await steerTo([[-1260, 298], [-1300, 304]], {arriveDist: 3})
  })
  await clearToasts(page)
  await triggerAction(page, '靠岸下船')
  const midLakeDismount = await page.evaluate(() => ({
    vehicle: window.viewer.walk.vehicle,
    toastVisible: document.querySelector('.toast')?.classList.contains('show') ?? false,
    toastText: document.querySelector('.toast')?.textContent ?? '',
    events: [...window.__boatToasts],
  }))
  assert.equal(midLakeDismount.vehicle, 'boat', `湖心深水不应允许下船: ${JSON.stringify(midLakeDismount)}`)
  assert(midLakeDismount.toastVisible && /岸|码头|太远/.test(midLakeDismount.toastText), `湖心拒下缺少提示: ${JSON.stringify(midLakeDismount)}`)

  await runInPage(page, async ({steerTo, arg}) => {
    await steerTo([arg], {arriveDist: 2.8})
  }, FREE_DOCKS.ronghu.mooring)
  await triggerAction(page, '靠岸下船')
  const landed = await page.evaluate(() => ({
    vehicle: window.viewer.walk.vehicle,
    probe: window.viewer.walk.probe(),
  }))
  assert.equal(landed.vehicle, 'foot', '靠岸下船后应恢复步行状态')
  assert.equal(landed.probe.wet, false, `下船应落在干地上: ${JSON.stringify(landed.probe)}`)
  assert(Math.abs(landed.probe.clearance) < 0.25 && landed.probe.grounded && !landed.probe.inHouse, `下船落点不安全: ${JSON.stringify(landed.probe)}`)
  console.log('3c. 湖心拒下 + 靠岸下船通过')

  // Bug 5 回归用例: 岸点碰撞未同步或落脚被拒时，不得提前清空 activeSlot 把玩家扔水里或穿进障碍物
  await enterSpot(page, ...FREE_DOCKS.ronghu.freeBank, 0, 'ronghu-dismount-guard')
  await triggerAction(page, FREE_DOCKS.ronghu.label)
  await clearToasts(page)
  const blockedShoreDismount = await runInPage(page, ({walk, stream, manifest, readBoat}) => {
    const pos = walk.position
    const bankTile = manifest.chunks.find(t => pos.x >= t.x && pos.x < t.x + 256 && pos.z >= t.z && pos.z < t.z + 256)
    const treeList = bankTile ? stream.forest.loaded.get(bankTile) : null
    const origLen = treeList ? treeList.length : 0
    if (treeList) {
      for (let ox = -12; ox <= 12; ox += 0.9) {
        for (let oz = -4; oz <= 12; oz += 0.9) {
          treeList.push({x: pos.x + ox, y: 148.5, z: pos.z + oz, scale: 2.2, kind: 1})
        }
      }
    }
    try {
      // 不跑 walk.tick，直接触发 KeyF 下船：dismount 必须自行 sync 并拒绝全部受阻岸点，保留 activeSlot
      window.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyF'}))
      window.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyF'}))
      const cur = readBoat()
      return {
        vehicle: walk.vehicle,
        hasBoatProbe: cur.boat !== null,
        aboardAttr: document.body.hasAttribute('data-aboard'),
        toasts: [...window.__boatToasts],
      }
    } finally {
      if (treeList) treeList.length = origLen
    }
  })
  assert.equal(blockedShoreDismount.vehicle, 'boat', `岸点全受阻时不应穿模下船或丢船落水: ${JSON.stringify(blockedShoreDismount)}`)
  assert(blockedShoreDismount.hasBoatProbe && blockedShoreDismount.aboardAttr, `下船被拒后 activeSlot 或 data-aboard 丢失: ${JSON.stringify(blockedShoreDismount)}`)
  console.log('3d. 岸点受阻安全拒下防落水通过')

  // --- 用例 4：榕湖 → 桂湖跨湖全线通航（微阶 <= 1.2 m 放行） ---
  await enterSpot(page, ...FREE_DOCKS.ronghu.freeBank, 0, 'ronghu-to-guihu')
  await triggerAction(page, FREE_DOCKS.ronghu.label)
  await clearToasts(page)
  const crossWaypoints = sampleWaypoints(RONGHU_TO_GUIHU_ROUTE.path, 6)
  const crossLake = await runInPage(page, async ({steerTo, arg}) => {
    const start = arg[0]
    const res = await steerTo(arg, {arriveDist: 2.2, maxSecondsPerLeg: 30})
    const waterYs = res.history.map(h => h.waterY).filter(v => v !== null)
    return {
      start,
      end: res.end,
      minClearance: res.minClearance,
      sawUnsafe: res.sawUnsafeProbe || res.sawResetOrHouse,
      minWaterY: waterYs.length ? Math.min(...waterYs) : null,
      maxWaterY: waterYs.length ? Math.max(...waterYs) : null,
      toasts: [...window.__boatToasts],
    }
  }, crossWaypoints)
  const targetEnd = RONGHU_TO_GUIHU_ROUTE.path.at(-1)
  const guihuGap = Math.hypot(crossLake.end.x - targetEnd[0], crossLake.end.z - targetEnd[2])
  assert(guihuGap < 8, `榕湖 → 桂湖 未能抵达终点，距终点 ${guihuGap.toFixed(1)} m`)
  assert(crossLake.minClearance >= 0.30, `榕湖 → 桂湖 跨湖过桥净空异常: ${crossLake.minClearance}`)
  assert(!crossLake.sawUnsafe, '榕湖 → 桂湖 途中发生异常落水/进屋/重置')
  if (crossLake.minWaterY !== null && crossLake.maxWaterY !== null) {
    assert(crossLake.maxWaterY - crossLake.minWaterY >= 1.1, `应经历榕湖(~148.1m)到桂湖(~149.5m)水位升阶，实际 ${crossLake.minWaterY}..${crossLake.maxWaterY}`)
  }
  assert.equal(crossLake.toasts.length, 0, `榕湖 → 桂湖 正常微阶不应弹窗拦截: ${JSON.stringify(crossLake.toasts)}`)
  console.log('4a. 榕湖 → 桂湖跨湖通航通过:', {
    end: [+crossLake.end.x.toFixed(1), +crossLake.end.z.toFixed(1)],
    waterSpan: [crossLake.minWaterY, crossLake.maxWaterY],
  })

  // Bug 6a 回归用例: 反向跨湖降阶 (桂湖 149.5m -> 丽泽桥/迎宾桥 148.6m -> 榕湖 148.1m) 阻尼过渡期，门禁不得虚增净高
  const downStepCheck = await runInPage(page, async ({arg, readBoat, press, ensureTileLoaded, stream, walk, advance}) => {
    const revPts = [...arg].reverse()
    let maxOverestimate = 0
    let minDynamicClear = Infinity
    let bridgeSamples = 0
    for (let wi = 0; wi < revPts.length; wi++) {
      const [tx, tz] = revPts[wi]
      await ensureTileLoaded(tx, tz)
      for (let i = 0; i < 1500; i++) {
        const pos = walk.position
        const dx = tx - pos.x, dz = tz - pos.z
        if (Math.hypot(dx, dz) < 2.6) break
        if (i % 60 === 0) {
          stream.tick(pos)
          await new Promise(r => setTimeout(r, 0))
        }
        const err = Math.atan2(Math.sin(Math.atan2(-dx, -dz) - walk.heading), Math.cos(Math.atan2(-dx, -dz) - walk.heading))
        press('KeyA', err > 0.04)
        press('KeyD', err < -0.04)
        press('KeyW', Math.abs(err) < 0.42)
        advance(1 / 60)
        const cur = readBoat()
        const gateClear = cur.boat?.clearance
        const dynClear = cur.clearanceInfo?.clearance
        if (dynClear !== undefined && Number.isFinite(dynClear)) {
          bridgeSamples++
          minDynamicClear = Math.min(minDynamicClear, dynClear)
          if (gateClear !== undefined && Number.isFinite(gateClear)) {
            maxOverestimate = Math.max(maxOverestimate, gateClear - dynClear)
          }
        }
      }
      if (walk.position.z >= 140) break
    }
    press('KeyA', false); press('KeyD', false); press('KeyW', false)
    return {bridgeSamples, maxOverestimate, minDynamicClear, endZ: readBoat().z}
  }, crossWaypoints)
  assert(downStepCheck.bridgeSamples > 10 && Number.isFinite(downStepCheck.minDynamicClear) && downStepCheck.minDynamicClear >= 0.30, `跨湖降阶过桥动态 Box3 净空异常: ${JSON.stringify(downStepCheck)}`)
  assert(downStepCheck.maxOverestimate <= 0.08, `降阶水位阻尼滞后导致门禁净高虚增: ${JSON.stringify(downStepCheck)}`)
  console.log('4b. 反向跨湖降阶桥下净高对齐通过:', {
    bridgeSamples: downStepCheck.bridgeSamples,
    minDynClear: +downStepCheck.minDynamicClear.toFixed(2),
    maxOverest: +downStepCheck.maxOverestimate.toFixed(3),
  })

  // --- 用例 5：闸坝拦停并发 walk:toast（木龙湖闸 145.6 m -> 149.5 m，落差 3.9 m） ---
  await enterSpot(page, ...FREE_DOCKS.mulong.freeBank, 0, 'mulong-dam')
  await triggerAction(page, FREE_DOCKS.mulong.label)
  await clearToasts(page)
  const damCheck = await runInPage(page, async ({steerTo, faceTarget, press, step, readBoat}) => {
    await steerTo([[-356, -1584], [-400, -1584], [-426, -1584]], {arriveDist: 2.4})
    const before = readBoat()
    await faceTarget(-448, -1584)
    press('KeyW', true)
    step(240) // 4.0s 直推向 z=-1584 处 3.9m 闸坝跌水线 (x ≈ -436..-440)
    press('KeyW', false)
    const after = readBoat()
    const toastEl = document.querySelector('.toast')
    return {
      beforeX: before.x,
      beforeWaterY: before.waterY,
      afterX: after.x,
      afterZ: after.z,
      afterWaterY: after.waterY,
      blocked: after.blocked,
      toastVisible: toastEl?.classList.contains('show') ?? false,
      toastText: toastEl?.textContent ?? '',
      events: [...window.__boatToasts],
      resets: after.probe.resets,
      inHouse: after.probe.inHouse,
    }
  })
  assert(damCheck.afterX > -439, `船体越过了木龙湖闸坝跌水线！停在 x=${damCheck.afterX}`)
  if (damCheck.afterWaterY !== null) {
    assert(damCheck.afterWaterY < 147.0, `水位不应跨越闸坝跳变到 149.5 m，实际 ${damCheck.afterWaterY}`)
  }
  assert(damCheck.events.length > 0 && damCheck.toastVisible, `闸坝拦截未发 walk:toast 或未显示 .toast.show: ${JSON.stringify(damCheck)}`)
  assert(/水闸|落差|划过/.test(damCheck.toastText) && /水闸|落差|划过/.test(damCheck.events[0].text), `闸坝拦截文案不符合施工图: ${JSON.stringify(damCheck)}`)
  assert(damCheck.resets === 0 && !damCheck.inHouse, '撞闸坝触发了异常重置或进屋')
  console.log('5a. 闸坝拦停通过 (木龙湖闸):', {stopX: +damCheck.afterX.toFixed(1), toast: damCheck.toastText})

  // Bug 1 回归用例 (闸坝): 斜向顶住闸坝跌水线后按住 KeyW + KeyA 扫过正西法线仍可微退脱困转向，不锁死航向
  const damTurn = await runInPage(page, async ({press, step, faceTarget, readBoat}) => {
    press('KeyS', true)
    step(36)
    press('KeyS', false)
    await faceTarget(-448, -1588) // 斜撞南北向跌水线
    press('KeyW', true)
    step(150)
    const h0 = readBoat().heading
    press('KeyA', true) // 按住 W 不放同时左转扫过正西法线 (1.57 rad)
    step(84)
    press('KeyA', false)
    press('KeyW', false)
    const after = readBoat()
    const delta = Math.abs(Math.atan2(Math.sin(after.heading - h0), Math.cos(after.heading - h0)))
    return {h0, h1: after.heading, delta, endX: after.x, waterY: after.waterY}
  })
  assert(damTurn.delta > 0.65 && damTurn.endX > -440, `顶住闸坝按住 W+A 转向锁死或越界: ${JSON.stringify(damTurn)}`)
  console.log('5b. 顶住闸坝按住 W+A 转向脱困通过:', {turnRad: +damTurn.delta.toFixed(2), endX: +damTurn.endX.toFixed(1)})

  // --- 用例 6：漓江自由竹筏水流漂移 + 解放桥穿行 + 杉湖九曲桥矮桥验证 ---
  await enterSpot(page, ...FREE_DOCKS.jiefang.freeBank, 0, 'jiefang-free-raft')
  await triggerAction(page, FREE_DOCKS.jiefang.label)
  await clearToasts(page)
  const raftDrift = await runInPage(page, async ({steerTo, press, step, readBoat}) => {
    const startKind = readBoat().kind
    await steerTo([[-180, 140]], {arriveDist: 2.6})
    // 先松手等待自身推进惯性彻底归零，再测 4.0s 纯水流顺流漂移
    step(180)
    const driftStart = readBoat()
    step(240) // 4.0s 无输入漂移
    const driftEnd = readBoat()
    const driftDist = Math.hypot(driftEnd.x - driftStart.x, driftEnd.z - driftStart.z)
    const driftDx = driftEnd.x - driftStart.x
    const driftDz = driftEnd.z - driftStart.z

    // 向北穿行解放桥 (landmark 桥底净高 ~6.1 m)
    const bridgeRes = await steerTo([[-176, 80], [-170, 40], [-168, 14]], {arriveDist: 2.8})
    return {
      startKind,
      driftDist,
      driftDx,
      driftDz,
      bridgeEndZ: bridgeRes.end.z,
      minClearance: bridgeRes.minClearance,
      toasts: [...window.__boatToasts],
    }
  })
  assert(raftDrift.startKind === 'freeRaft' || raftDrift.startKind === 'raft', `解放桥自由船型应为 freeRaft/raft，实际 ${raftDrift.startKind}`)
  assert(raftDrift.driftDist >= 1.1 && raftDrift.driftDist <= 2.3, `漓江 4s 水流漂移距离应约 1.2–2.0 m，实际 ${raftDrift.driftDist.toFixed(2)} m`)
  assert(raftDrift.driftDz > 0.8 && raftDrift.driftDx < -0.2, `漓江此段水流方向应为南偏西 (+z, -x)，实际 dx=${raftDrift.driftDx.toFixed(2)}, dz=${raftDrift.driftDz.toFixed(2)}`)
  assert(raftDrift.bridgeEndZ < 20 && raftDrift.minClearance >= 0.30, `未能顺利穿过解放桥: ${JSON.stringify(raftDrift)}`)
  assert.equal(raftDrift.toasts.length, 0, `穿过解放桥不应触发矮桥 toast: ${JSON.stringify(raftDrift.toasts)}`)
  console.log('6a. 漓江竹筏水流漂移 + 解放桥穿行通过:', {
    driftDist: +raftDrift.driftDist.toFixed(2),
    minClearance: +raftDrift.minClearance.toFixed(2),
  })

  // 补充校验杉湖九曲桥矮桥拦截 (全跨净高 0.80 m)
  await enterSpot(page, ...FREE_DOCKS.shanhu.freeBank, 0, 'shanhu-jiuqu')
  await triggerAction(page, FREE_DOCKS.shanhu.label)
  await clearToasts(page)
  const jiuqu = await runInPage(page, async ({steerTo, faceTarget, press, step, readBoat}) => {
    await steerTo([[-930, 576], [-1018, 608], [-1020, 644], [-1016, 674]], {arriveDist: 2.2})
    await faceTarget(-1016, 688)
    press('KeyW', true)
    step(240) // 4.0s 直抵 z≈683.5 杉湖九曲桥 (全深水区净高 0.80 m)
    press('KeyW', false)
    const end = readBoat()
    const toastEl = document.querySelector('.toast')
    return {
      endZ: end.z,
      clearance: end.clearance,
      toastVisible: toastEl?.classList.contains('show') ?? false,
      toastText: toastEl?.textContent ?? '',
      events: [...window.__boatToasts],
    }
  })
  assert(jiuqu.endZ < 684, `船体越过了杉湖九曲桥: ${JSON.stringify(jiuqu)}`)
  assert(jiuqu.events.length > 0 && jiuqu.toastVisible && /净高|无法通过/.test(jiuqu.toastText), `杉湖九曲桥未触发矮桥 toast: ${JSON.stringify(jiuqu)}`)
  console.log('6b. 杉湖九曲桥矮桥拦截通过:', {stopZ: +jiuqu.endZ.toFixed(1), toast: jiuqu.toastText})

  // Bug 1 回归用例 (矮桥): 斜向顶住矮桥时按住 KeyW + KeyA 扫过桥面法向仍可顺畅转向，不因 +0.70m 前瞻锁死航向
  const lowBridgeTurn = await runInPage(page, async ({press, step, faceTarget, readBoat}) => {
    const stopPos = readBoat() // 紧贴九曲桥北缘 (~ -1016, 679)
    press('KeyS', true)
    step(30)
    press('KeyS', false)
    await faceTarget(stopPos.x - 3, stopPos.z + 14) // 西南偏南 ~12° 顶住九曲桥本体
    press('KeyW', true)
    step(120)
    const hStart = readBoat().heading
    let minClear = Infinity
    press('KeyA', true) // 按住 W 不放同时左转扫过正南法线
    for (let i = 0; i < 84; i++) {
      step(1)
      const c = readBoat().clearanceInfo?.clearance
      if (c !== undefined && Number.isFinite(c)) minClear = Math.min(minClear, c)
    }
    press('KeyA', false)
    press('KeyW', false)
    const hEnd = readBoat().heading
    const turnDelta = Math.abs(Math.atan2(Math.sin(hEnd - hStart), Math.cos(hEnd - hStart)))
    return {hStart, hEnd, turnDelta, minClear, endZ: readBoat().z}
  })
  assert(lowBridgeTurn.turnDelta > 0.70, `斜顶矮桥按住 W+A 转向被锁死: ${JSON.stringify(lowBridgeTurn)}`)
  assert(lowBridgeTurn.minClear >= 0.30 && lowBridgeTurn.endZ < 684, `矮桥前转向期间净空不足或穿桥: ${JSON.stringify(lowBridgeTurn)}`)
  console.log('6c. 斜顶矮桥按住 W+A 转向脱困通过:', {turnRad: +lowBridgeTurn.turnDelta.toFixed(2), minClear: +lowBridgeTurn.minClear.toFixed(2)})

  // Bug 6b 回归用例: 斜角倒船退撞矮桥，船尾左右角全采样对齐动态 Box3，杜绝单边船尾角穿入矮桥底
  const reverseCornerBridge = await runInPage(page, async ({steerTo, faceTarget, press, step, readBoat}) => {
    await steerTo([[-1016, 675]], {arriveDist: 1.8})
    const pos = readBoat()
    // 船头朝北偏东 (~18°)，使船尾右后角正对南侧九曲桥本体 (z≈683.5)，持续按 KeyS 倒退撞桥
    await faceTarget(pos.x + 6, pos.z - 18)
    let minDynClear = Infinity
    let finiteSamples = 0
    let sawBlocked = false
    let blockReason = ''
    press('KeyS', true)
    for (let i = 0; i < 260; i++) {
      step(1)
      const cur = readBoat()
      if (cur.blocked) {
        sawBlocked = true
        if (cur.boat?.reason) blockReason = cur.boat.reason
      }
      const dyn = cur.clearanceInfo?.clearance
      if (dyn !== undefined && Number.isFinite(dyn)) {
        finiteSamples++
        minDynClear = Math.min(minDynClear, dyn)
      }
    }
    press('KeyS', false)
    const end = readBoat()
    return {
      finiteSamples,
      minDynClear,
      endZ: end.z,
      blocked: Boolean(end.blocked || sawBlocked),
      blockReason: end.boat?.reason || blockReason,
    }
  })
  assert(reverseCornerBridge.finiteSamples > 0 || reverseCornerBridge.blocked, `斜角倒船未触达矮桥且未被拦下: ${JSON.stringify(reverseCornerBridge)}`)
  assert(reverseCornerBridge.minDynClear >= 0.30 && reverseCornerBridge.endZ < 684, `斜角倒船船尾角穿入矮桥底 (动态 Box3 净空跌破 0.30m): ${JSON.stringify(reverseCornerBridge)}`)
  console.log('6d. 斜角倒船矮桥船尾角净空防护通过:', {
    finiteSamples: reverseCornerBridge.finiteSamples,
    blocked: reverseCornerBridge.blocked,
    reason: reverseCornerBridge.blockReason,
    minDynClear: Number.isFinite(reverseCornerBridge.minDynClear) ? +reverseCornerBridge.minDynClear.toFixed(2) : 'blocked-before-footprint',
  })

  await page.close()

  // ==================== 手机端 390×844 HUD 防重叠与触屏划船验收 ====================
  const mobileCtx = await browser.newContext({
    viewport: {width: 390, height: 844},
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  })
  const mobile = await mobileCtx.newPage()
  mobile.on('pageerror', err => errors.push(`mobile pageerror: ${err.message}`))
  mobile.on('console', msg => {
    if (msg.type() === 'error') errors.push(`mobile console: ${msg.location().url}: ${msg.text()}`)
  })
  await attachHelpers(mobile)
  await gotoWalk(mobile)

  await enterSpot(mobile, ...FREE_DOCKS.ronghu.freeBank, 0, 'mobile-ronghu-bank')
  await closeSpotCard(mobile)
  await mobile.waitForSelector('.hud-me .account-entry', {state: 'attached', timeout: 10000})
  await mobile.waitForFunction(
    t => document.querySelector('.vehicle-action')?.textContent?.includes(t),
    FREE_DOCKS.ronghu.label,
    {timeout: 15000},
  )

  async function measureHud(targetPage, selectors) {
    return targetPage.evaluate(sels => {
      const boxes = sels.flatMap(sel => {
        const els = sel === '.hud-me'
          ? [...document.querySelectorAll('.hud-me > *')]
          : [...document.querySelectorAll(sel)].slice(0, 1)
        return els.map((el, idx) => {
          const st = getComputedStyle(el)
          const r = el.getBoundingClientRect()
          if (st.display === 'none' || st.visibility === 'hidden' || el.hasAttribute('hidden') || r.width === 0 || r.height === 0) {
            return null
          }
          const label = els.length > 1
            ? (el.classList.contains('account-entry') ? `${sel}.account-entry` : `${sel}[${idx}]`)
            : sel
          return {
            sel: label,
            left: +r.left.toFixed(1),
            top: +r.top.toFixed(1),
            right: +r.right.toFixed(1),
            bottom: +r.bottom.toFixed(1),
          }
        })
      }).filter(Boolean)
      const overlaps = []
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i], b = boxes[j]
          const ox = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
          const oy = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
          if (ox * oy > 0) overlaps.push({a: a.sel, b: b.sel, area: +(ox * oy).toFixed(1)})
        }
      }
      const outOfBounds = boxes.filter(b => b.left < 0 || b.top < 0 || b.right > 390.5 || b.bottom > 844.5)
      return {boxes, overlaps, outOfBounds}
    }, selectors)
  }

  const preHud = await measureHud(mobile, [
    '.walk-ui .joystick', '.walk-ui .btn-run', '.walk-ui .btn-jump',
    '.walk-ui .btn-view', '.vehicle-action', '.dock', '.sky-ui', 'output', '.hud-me',
  ])
  assert(preHud.boxes.some(b => b.sel === '.vehicle-action'), '手机端自由栈桥旁未显示 .vehicle-action')
  assert(preHud.boxes.filter(b => b.sel.startsWith('.hud-me')).length >= 2, `手机端 .hud-me 未完整覆盖两个按钮: ${JSON.stringify(preHud.boxes)}`)
  assert.deepEqual(preHud.overlaps, [], `手机端上船前按钮重叠: ${JSON.stringify(preHud)}`)
  assert.deepEqual(preHud.outOfBounds, [], `手机端上船前按钮出界: ${JSON.stringify(preHud)}`)

  // 触屏点击上船按钮，检查船上按钮不重叠 + 左摇杆划船
  await triggerAction(mobile, FREE_DOCKS.ronghu.label, true)
  const aboardHud = await measureHud(mobile, [
    '.walk-ui .joystick', '.walk-ui .btn-view', '.vehicle-action',
    '.dock', '.sky-ui', 'output', '.hud-me',
  ])
  const aboardState = await mobile.evaluate(() => ({
    vehicle: window.viewer.walk.vehicle,
    aboardAttr: document.body.hasAttribute('data-aboard'),
    jumpHidden: getComputedStyle(document.querySelector('.walk-ui .btn-jump')).display === 'none',
    runHidden: getComputedStyle(document.querySelector('.walk-ui .btn-run')).display === 'none',
    actionText: document.querySelector('.vehicle-action')?.textContent ?? '',
  }))
  assert.equal(aboardState.vehicle, 'boat', '手机端点击后应成功上船')
  assert(aboardState.aboardAttr && aboardState.jumpHidden && aboardState.runHidden, `船上状态或跳跑按钮隐藏异常: ${JSON.stringify(aboardState)}`)
  assert(aboardState.actionText.includes('靠岸下船'), `船上按钮文案应含 靠岸下船，实际 ${aboardState.actionText}`)
  assert.deepEqual(aboardHud.overlaps, [], `手机 390×844 船上按钮重叠: ${JSON.stringify(aboardHud)}`)
  assert.deepEqual(aboardHud.outOfBounds, [], `手机 390×844 船上按钮出界: ${JSON.stringify(aboardHud)}`)

  // 左摇杆触控划船
  const stickDrive = await mobile.evaluate(() => {
    const {walk} = window.viewer
    const advance = walk.tick
    walk.tick = () => {}
    const joy = document.querySelector('.walk-ui .joystick')
    const jr = joy.getBoundingClientRect()
    const cx = jr.left + jr.width / 2, cy = jr.top + jr.height / 2
    const p0 = walk.position.clone()
    const h0 = walk.heading
    try {
      joy.dispatchEvent(new PointerEvent('pointerdown', {pointerId: 31, pointerType: 'touch', clientX: cx, clientY: cy, bubbles: true}))
      joy.dispatchEvent(new PointerEvent('pointermove', {pointerId: 31, pointerType: 'touch', clientX: cx + jr.width * 0.2, clientY: cy - jr.height * 0.5, bubbles: true}))
      for (let i = 0; i < 60; i++) advance(1 / 60)
      const ringColor = getComputedStyle(joy, '::after').borderColor
      const dist = walk.position.distanceTo(p0)
      const spd = walk.speed
      const dh = Math.abs(Math.atan2(Math.sin(walk.heading - h0), Math.cos(walk.heading - h0)))
      return {ringColor, dist, spd, dh}
    } finally {
      joy.dispatchEvent(new PointerEvent('pointerup', {pointerId: 31, pointerType: 'touch', bubbles: true}))
      walk.tick = advance
    }
  })
  assert(stickDrive.ringColor.endsWith(', 0)') || stickDrive.ringColor === 'transparent', `船上摇杆不应亮跑步红圈: ${stickDrive.ringColor}`)
  assert(stickDrive.dist > 0.6 && stickDrive.spd > 1.2 && stickDrive.dh > 0.08, `手机左摇杆划船未生效: ${JSON.stringify(stickDrive)}`)

  // 划入湖心触发离岸拒下提示，校验手机端 .toast.show 不与 .dock / .vehicle-action / .joystick 重叠
  await clearToasts(mobile)
  await runInPage(mobile, async ({steerTo}) => {
    await steerTo([[-1340, 304]], {arriveDist: 2.0})
  })
  await triggerAction(mobile, '靠岸下船', true)
  await mobile.waitForSelector('.toast.show', {state: 'visible', timeout: 5000})
  const toastHud = await measureHud(mobile, [
    '.toast.show', '.walk-ui .joystick', '.walk-ui .btn-view', '.vehicle-action',
    '.dock', '.sky-ui', 'output', '.hud-me',
  ])
  assert(toastHud.boxes.some(b => b.sel === '.toast.show'), `手机端未测到激活态 .toast.show: ${JSON.stringify(toastHud)}`)
  assert.deepEqual(toastHud.overlaps, [], `手机 390×844 .toast.show 与 HUD 控件重叠: ${JSON.stringify(toastHud)}`)
  assert.deepEqual(toastHud.outOfBounds, [], `手机 390×844 .toast.show 出界: ${JSON.stringify(toastHud)}`)

  // 触屏划回泊位或靠岸下船
  await runInPage(mobile, async ({steerTo, arg}) => {
    await steerTo([arg], {arriveDist: 2.8})
  }, FREE_DOCKS.ronghu.mooring)
  await triggerAction(mobile, '靠岸下船', true)
  const mobileLanded = await mobile.evaluate(() => ({
    vehicle: window.viewer.walk.vehicle,
    aboardAttr: document.body.hasAttribute('data-aboard'),
  }))
  assert.equal(mobileLanded.vehicle, 'foot', '手机端靠岸下船应恢复步行')
  assert.equal(mobileLanded.aboardAttr, false, '下船后应移除 data-aboard')
  console.log('7. 手机 390×844 船上按钮不重叠 + 摇杆划船 + 触屏下船通过')

  assert.deepEqual(errors, [], `存在运行错误: ${JSON.stringify(errors)}`)
  await mobileCtx.close()
  console.log('ALL verify:boat checks passed!')
} finally {
  await browser?.close()
  await server?.close()
}
