// 手游加载实测：把手机档的 CPU 和 4G 网络一起压上去，量从进游戏到“身边世界真的齐了”要多久，
// 再按 W 走一段，量边跑边补的窟窿有多大。
//
// 用 .evalbuild（见 scripts/_evalbuild.mjs）而不是 vite preview：本机沙箱里 esbuild 起不来。
// 用法：node scripts/load-audit.mjs [--out captures/load-audit.json]
//   AUDIT_QUERY      页面参数（默认 verify&mode=walk&quality=mid）
//   AUDIT_CPU        CDP CPU 降速倍数（默认 4）
//   AUDIT_DOWN/UP/RTT 网络（默认 4 Mbps / 3 Mbps / 100 ms）
//   AUDIT_PROFILE=1  采集主线程 CPU 采样，输出前 14 个自耗时函数
//   AUDIT_PFX        自签证书（默认取 %TEMP%/glol-h2.pfx）：有就走 HTTP/2，
//                    线上 nginx 是 h2，单机用 1.1 会假报「小文件被大文件堵住」。
import {chromium} from 'playwright'
import {createServer} from 'node:http'
import {createSecureServer} from 'node:http2'
import {createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync} from 'node:fs'
import {dirname, extname, join, normalize} from 'node:path'

const root = join(import.meta.dirname, '..')
const outFile = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'captures/load-audit.json'
const CPU = Number(process.env.AUDIT_CPU ?? 4)
const DOWN = Number(process.env.AUDIT_DOWN ?? 4) * 125000 // Mbps -> B/s
const UP = Number(process.env.AUDIT_UP ?? 3) * 125000
const RTT = Number(process.env.AUDIT_RTT ?? 100)
const SETTLE_SECONDS = Number(process.env.AUDIT_SECONDS ?? 50)
const WALK_SECONDS = Number(process.env.AUDIT_WALK ?? 40)
const QUERY = process.env.AUDIT_QUERY ?? 'verify&mode=walk&quality=mid'
const PFX = process.env.AUDIT_PFX ?? join(process.env.TEMP ?? process.env.TMP ?? '/tmp', 'glol-h2.pfx')

const TYPES = {
  '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css',
  '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json', '.glb': 'model/gltf-binary',
  '.ktx2': 'image/ktx2', '.frag': 'text/plain', '.wgsl': 'text/plain',
}

function resolvePath(url) {
  const path = decodeURIComponent(url.split('?')[0].split('#')[0])
  if (path === '/' || path === '') return join(root, '.evaldist/index.html')
  // 打包产物：一个 JS + 几个 worker，和发布包同形状（见 scripts/_bundle.mjs）
  if (path.startsWith('/assets/')) return join(root, '.evaldist', path)
  if (path.startsWith('/eval/')) {
    // CSS 只做展示，直接从 web/src 原样发；JS 走 .evalbuild。
    if (path.endsWith('.css')) return join(root, 'web', path.slice(6))
    return join(root, '.evalbuild', path.slice(6))
  }
  if (path.startsWith('/lib/')) return join(root, '.evalbuild', path.slice(1))
  if (path.startsWith('/node_modules/')) return join(root, path.slice(1))
  return join(root, 'public', path.slice(1))
}

// 全局令牌桶：一条 4 Mbps 的管子，所有响应共用。
// 不用 CDP 的 Network.emulateNetworkConditions —— 它会把 module worker 的脚本请求挂死，
// 测出来全是「街块卡在 decoded 之前」的假象。
const RATE = DOWN
const BURST = RATE * 0.25
let tokens = BURST
let tokensAt = performance.now()
function refill() {
  const now = performance.now()
  tokens = Math.min(BURST, tokens + ((now - tokensAt) / 1000) * RATE)
  tokensAt = now
}
function take(bytes) {
  return new Promise(resolve => {
    const attempt = () => {
      refill()
      if (tokens >= bytes) {
        tokens -= bytes
        resolve()
        return
      }
      setTimeout(attempt, Math.max(1, Math.ceil(((bytes - tokens) / RATE) * 1000)))
    }
    attempt()
  })
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function respond(request, response) {
  const file = normalize(resolvePath(request.url))
  if (!file.startsWith(normalize(root))) {
    response.writeHead(403).end()
    return
  }
  let target = file
  if (existsSync(target) && statSync(target).isDirectory()) target = join(target, 'index.html')
  if (!existsSync(target)) {
    response.writeHead(404).end('not found')
    return
  }
  const size = statSync(target).size
  response.writeHead(200, {
    'Content-Type': TYPES[extname(target)] ?? 'application/octet-stream',
    'Content-Length': size,
    // 线上 nginx 对 world/* 是 public, max-age=600（见 /world/*.glc 的响应头），这里对齐
    'Cache-Control': target.includes(`${join(root, 'public', 'world')}`) ? 'public, max-age=600' : 'no-store',
  })
  await sleep(RTT / 2)
  const stream = createReadStream(target, {highWaterMark: 8192})
  for await (const chunk of stream) {
    await take(chunk.length)
    // drain 用超时兜一层：客户端被强关时 h2/h1 的 drain 可能永远不来
    if (!response.write(chunk)) await Promise.race([new Promise(resolve => response.once('drain', resolve)), sleep(2000)])
  }
  response.end()
}

// 默认走 HTTP/1.1：本机 h2 需要自签证书，浏览器被强杀时 h2 会话还会把关闭挂住。
// 线上 nginx 是 h2，1.1 的 6 连接上限只会让「大文件挡小文件」更严重 —— 也就是偏保守的测法。
// 想跑 h2：设 AUDIT_PFX=证书.pfx。
const server = PFX && existsSync(PFX) && process.env.AUDIT_H2 === '1'
  ? createSecureServer({pfx: readFileSync(PFX), passphrase: process.env.AUDIT_PFX_PASS ?? 'glol', allowHTTP1: true}, respond)
  : createServer(respond)
// h2 的 server.close() 要等所有会话关闭才回调，浏览器被强杀时会一直挂着。
const sessions = new Set()
server.on('session', session => {
  sessions.add(session)
  session.on('close', () => sessions.delete(session))
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const secure = Boolean(server.setSecureContext)
const base = `${secure ? 'https' : 'http'}://127.0.0.1:${server.address().port}`

// 在页面里取一次快照：身边还缺几块、近处地标下载了几个、世界数据拉了多少字节。
const snapshot = () => {
  const viewer = window.viewer
  if (!viewer?.stats.firstMs) return null
  const {stream, manifest, stats, camera, walk} = viewer
  const position = walk?.active ? walk.position : camera.position
  let total = 0, loaded = 0, nearestMissing = 0
  for (const tile of manifest.chunks) {
    const distance = Math.hypot(tile.x + 128 - position.x, tile.z + 128 - position.z)
    if (distance > stream.radius) continue
    total++
    if (stream.loaded.has(tile)) loaded++
    else if (nearestMissing === 0 || distance < nearestMissing) nearestMissing = distance
  }
  const ids = new Set([...stream.landmarks.keys()].map(entry => entry.id))
  let landmarksNear = 0, landmarksNearLoaded = 0, landmarksInRange = 0, landmarksInRangeLoaded = 0
  for (const entry of manifest.landmarks ?? []) {
    const distance = Math.hypot(entry.position[0] - position.x, entry.position[1] - position.y, entry.position[2] - position.z) - entry.sphere[3]
    if (distance > 900) continue
    landmarksInRange++
    if (ids.has(entry.id)) landmarksInRangeLoaded++
    if (distance > 400) continue
    landmarksNear++
    if (ids.has(entry.id)) landmarksNearLoaded++
  }
  let worldBytes = 0, landmarkBytes = 0
  for (const entry of performance.getEntriesByType('resource')) {
    if (entry.name.includes('/world/')) worldBytes += entry.encodedBodySize
    if (entry.name.includes('/landmarks/')) landmarkBytes += entry.encodedBodySize
  }
  return {
    t: performance.now(), frame: stats.frame, ms: stats.ms, calls: stats.calls,
    loaded, total, missing: total - loaded, nearestMissing,
    pending: stream.pending.size, radius: stream.radius,
    landmarksInRange, landmarksInRangeLoaded, landmarksNear, landmarksNearLoaded,
    trees: stream.forest.loaded.size, worldBytes, landmarkBytes,
    x: position.x, z: position.z,
  }
}

function summarise(samples) {
  const first = samples[0]
  let t50 = null, tChunks = null, tNear = null, gapSeconds = 0, worstMissing = 0, peakMs = 0
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i]
    const dt = i ? (sample.t - samples[i - 1].t) / 1000 : 0
    if (t50 === null && sample.loaded >= sample.total * 0.5) t50 = (sample.t - first.t) / 1000
    if (tChunks === null && sample.missing === 0 && sample.pending === 0) tChunks = (sample.t - first.t) / 1000
    if (tNear === null && sample.landmarksNearLoaded === sample.landmarksNear) tNear = (sample.t - first.t) / 1000
    if (sample.missing > 0) gapSeconds += dt
    worstMissing = Math.max(worstMissing, sample.missing)
    peakMs = Math.max(peakMs, sample.ms)
  }
  const last = samples[samples.length - 1]
  const MB = value => +(value / 1048576).toFixed(1)
  return {
    t50: t50 === null ? null : +t50.toFixed(1), tChunks: tChunks === null ? null : +tChunks.toFixed(1),
    tNear: tNear === null ? null : +tNear.toFixed(1),
    gapSeconds: +gapSeconds.toFixed(1), worstMissing, peakFrameMs: +peakMs.toFixed(1),
    chunks: `${last.loaded}/${last.total}`,
    landmarksInRange: `${last.landmarksInRangeLoaded}/${last.landmarksInRange}`,
    landmarksNear: `${last.landmarksNearLoaded}/${last.landmarksNear}`,
    worldMB: MB(last.worldBytes), landmarkMB: MB(last.landmarkBytes),
  }
}

let browser
try {
  browser = await chromium.launch({channel: process.env.AUDIT_CHANNEL ?? 'msedge', args: ['--ignore-certificate-errors']})
  // 不启用 Playwright 的 isMobile：它会切到移动端 UA/viewport 行为，和线上手机并非同一套路径，
  // 反而让进入步行的流程走不通。这里只保留触屏 + 竖排横屏尺寸 + CPU 降速，,再用 ?quality=mid 指定手机档。
  const context = await browser.newContext({viewport: {width: 844, height: 390}, deviceScaleFactor: 2, hasTouch: true})
  // 资源时间线条目默认只有 250 条，世界文件一多就爆；爆了 landmarkMB 会明显偏小
  await context.addInitScript(() => performance.setResourceTimingBufferSize(20000))
  const page = await context.newPage()
  const errors = []
  const consoleErrors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 300)) })
  const cdp = await context.newCDPSession(page)
  // 只压 CPU，网络由服务器令牌桶按 4 Mbps 匀速发（见上面的 take()）
  await cdp.send('Emulation.setCPUThrottlingRate', {rate: CPU})

  await page.goto(`${base}/?${QUERY}`, {waitUntil: 'domcontentloaded'})
  const firstMs = (await page.waitForFunction(() => window.viewer?.stats.firstMs > 0, null, {timeout: 240000}).then(() => page.evaluate(() => window.viewer.stats.firstMs)))
  console.log('audit: first frame', Math.round(firstMs))
  const tier = await page.evaluate(() => ({tier: window.viewer.quality.tier, radius: window.viewer.stream.radius, maxPending: window.viewer.stream.maxPending}))
  // 首帧那一刻世界加载到哪一步了：加载屏期间有没有真的把出生点抓完
  const atFirst = await page.evaluate(() => {
    const {stream} = window.viewer
    return {loaded: stream.loaded.size, pending: stream.pending.size, landmarks: stream.landmarks.size,
      detail: (globalThis.__detailLog ?? []).slice(-18), log: (stream.log ?? []).slice(0, 24)}
  })

  // 主线程被 walk 模块的解析卡住时 page.evaluate 会一直等，采样要能放弃
  const probe = () => Promise.race([page.evaluate(snapshot).catch(() => null), new Promise(resolve => setTimeout(() => resolve(null), 4000))])

  const profiling = process.env.AUDIT_PROFILE === '1'
  if (profiling) {
    await cdp.send('Profiler.enable')
    await cdp.send('Profiler.setSamplingInterval', {interval: 500})
    await cdp.send('Profiler.start')
  }

  const samples = []
  const deadline = Date.now() + SETTLE_SECONDS * 1000
  while (Date.now() < deadline) {
    const sample = await probe()
    if (sample) samples.push(sample)
    await page.waitForTimeout(400)
  }
  const settle = summarise(samples)
  console.log('audit: settle sampled', samples.length)

  let profile = null
  if (profiling) {
    const {profile: raw} = await cdp.send('Profiler.stop')
    const byId = new Map(raw.nodes.map(node => [node.id, node]))
    const counts = new Map()
    for (const id of raw.samples ?? []) counts.set(id, (counts.get(id) ?? 0) + 1)
    const total = raw.samples?.length ?? 1
    const self = new Map()
    for (const [id, count] of counts) {
      const node = byId.get(id)
      if (!node) continue
      const {functionName, url, lineNumber} = node.callFrame
      const name = `${functionName || '(anonymous)'} ${url.replace(base, '').replace(/^\/eval\//, '')}:${lineNumber + 1}`
      self.set(name, (self.get(name) ?? 0) + count)
    }
    profile = [...self].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([name, count]) => `${(100 * count / total).toFixed(1)}% ${name}`)
  }

  // 玩家真正拿到操控权的时间：走模块（Rapier 的 wasm）下完、解析完、落地遮罩收起。
  // 这段在手机上就是「进去半天」里最长的一截。
  const controlAt = Date.now()
  const gotControl = await page.waitForFunction(() => window.viewer?.walk?.active === true, null, {timeout: 180000}).then(() => true).catch(() => false)
  const timeToControl = gotControl ? (Date.now() - controlAt) / 1000 : null
  const stalled = gotControl ? null : await Promise.race([
    page.evaluate(() => ({
      mode: document.body.dataset.mode,
      output: document.querySelector('output')?.value,
      walker: Boolean(window.viewer?.walk),
      active: window.viewer?.walk?.active ?? null,
      resources: performance.getEntriesByType('resource').filter(entry => /\.js$/.test(entry.name)).map(entry => `${entry.name.split('/').pop()} ${(entry.transferSize / 1024).toFixed(0)}KB ${Math.round(entry.duration)}ms`).slice(-6),
    })).catch(error => String(error)),
    new Promise(resolve => setTimeout(() => resolve('evaluate timed out'), 5000)),
  ])
  console.log('audit: control', timeToControl, stalled ? JSON.stringify(stalled) : '')

  const walkSamples = []
  const before = await page.evaluate(() => window.viewer.stats.frame)
  await page.keyboard.down('KeyW')
  const walkDeadline = Date.now() + WALK_SECONDS * 1000
  while (Date.now() < walkDeadline) {
    const sample = await probe()
    if (sample) walkSamples.push(sample)
    await page.waitForTimeout(400)
  }
  await page.keyboard.up('KeyW').catch(() => {})
  const walk = summarise(walkSamples)
  console.log('audit: walk sampled', walkSamples.length)
  const final = await page.evaluate(() => {
    const {stream} = window.viewer
    return {loaded: stream.loaded.size, pending: stream.pending.size, landmarks: stream.landmarks.size,
      detail: (globalThis.__detailLog ?? []).slice(-18), log: (stream.log ?? []).slice(-12)}
  }).catch(() => null)
  const travelled = Math.hypot((walkSamples.at(-1)?.x ?? 0) - (walkSamples[0]?.x ?? 0), (walkSamples.at(-1)?.z ?? 0) - (walkSamples[0]?.z ?? 0))

  const report = {
    when: new Date().toISOString(), query: QUERY, protocol: secure ? 'h2' : 'http/1.1',
    tier, cpuThrottle: CPU, network: {Mbps: DOWN / 125000, rttMs: RTT}, gotControl, timeToControl,
    firstMs: +firstMs.toFixed(1), framesBeforeWalk: before, profile, atFirst, final,
    settle, walk: {...walk, travelled: Math.round(travelled)}, errors: errors.slice(0, 5), consoleErrors: consoleErrors.slice(0, 8),
    series: samples.map(s => [Math.round(s.t - samples[0].t), s.loaded, s.total, s.landmarksNearLoaded, s.landmarksNear, s.landmarksInRangeLoaded, s.landmarksInRange, +s.ms.toFixed(1)]),
  }
  mkdirSync(dirname(join(root, outFile)), {recursive: true})
  writeFileSync(join(root, outFile), JSON.stringify(report, null, 2) + '\n')
  if (profile) console.log(`PROFILE\n${profile.join('\n')}`)
  console.log(JSON.stringify({tier, firstMs: report.firstMs, gotControl, timeToControl, settle: report.settle, walk: report.walk, errors: report.errors}, null, 2))
  if (errors.length) process.exitCode = 1
} finally {
  await browser?.close().catch(() => {})
  for (const session of sessions) session.destroy()
  await new Promise(resolve => {
    server.close(resolve)
    setTimeout(resolve, 2000).unref?.()
  })
}
