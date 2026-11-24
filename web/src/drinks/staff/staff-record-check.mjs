import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, rename, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = resolve(import.meta.dirname, '../../../..')
const WEB_DIR = join(ROOT, 'web')
const OUT_DIR = process.env.DRINKS_STAFF_RECORD_DIR || '/Users/pan-work/z-rubbish/guilinol-drinks-staff-rec-20261124'

await mkdir(OUT_DIR, { recursive: true })

const DEV_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>蜜雪冰城员工玩法实测</title>
  <style>html,body,#app{margin:0;width:1280px;height:720px;overflow:hidden;background:#dce8ee;position:relative}</style>
</head>
<body>
  <div id="app"></div>
  <script type="module">
    import { mountDrinksStaffPreview } from '/src/drinks/staff/preview.ts'
    const app = document.getElementById('app')
    mountDrinksStaffPreview(app, { width: 1280, height: 720 })
  </script>
</body>
</html>`

const viteServer = await createServer({
  root: WEB_DIR,
  configFile: join(WEB_DIR, 'vite.config.ts'),
  server: {
    host: '127.0.0.1',
    port: 0,
    strictPort: false,
  },
  logLevel: 'silent',
  plugins: [
    {
      name: 'staff-dev-preview-html',
      configureServer(server) {
        server.middlewares.use('/staff-preview.html', (_req, res) => {
          res.statusCode = 200
          res.setHeader('Content-Type', 'text/html; charset=utf-8')
          res.end(DEV_HTML)
        })
      },
    },
  ],
})

await viteServer.listen()
const addr = viteServer.httpServer?.address()
const port = typeof addr === 'object' && addr ? addr.port : 5173
const devUrl = `http://127.0.0.1:${port}/staff-preview.html`

const useMetal = process.env.QA_NATIVE_GPU === '1' && process.platform === 'darwin'
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM || undefined,
  args: useMetal
    ? ['--enable-gpu', '--use-angle=metal']
    : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})

let rawVideoPath = null
const errors = []

try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: {
      dir: OUT_DIR,
      size: { width: 1280, height: 720 },
    },
  })
  const page = await context.newPage()
  page.on('pageerror', err => errors.push(`pageerror: ${err.message}`))
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`)
  })

  await page.goto(devUrl, { waitUntil: 'load' })
  await page.waitForFunction(() => Boolean(window.__drinksStaffPreview))
  await page.waitForSelector('.drinks-staff-hud:not([hidden])')
  await page.waitForTimeout(350)

  // 1. 门口靠近招聘立牌：斜侧3/4机位同时展示清晰的「蜜雪冰城招聘」A字立牌文字 + 玩家 + 极简「应聘上岗」按钮
  const shot1 = join(OUT_DIR, '01-recruit-prompt.png')
  await page.evaluate(() => {
    const stand = window.__drinksStaffPreview.staff.session.anchors.recruitStandee
    window.__drinksStaffPreview.setPlayerPose(stand.x + 0.88, stand.z + 0.25, 1.25)
    window.__drinksStaffPreview.setCamera(stand.x + 2.05, 1.52, stand.z + 2.25, stand.x + 0.28, 0.88, stand.z + 0.05)
    window.__drinksStaffPreview.step(0.05)
  })
  await page.waitForTimeout(250)
  await page.screenshot({ path: shot1 })
  const m1 = await page.evaluate(() => window.__drinksStaffPreview.getMetrics())
  assert.equal(m1.snapshot.nearRecruit, true)
  assert.equal(m1.snapshot.onDuty, false)

  // 2. 点击「应聘上岗」并换穿蜜雪员工服（纯黑帽子+纯黑短袖T恤+黑红围裙），开启BGM
  await page.click('[data-staff-cta]')
  await page.evaluate(() => {
    const stand = window.__drinksStaffPreview.staff.session.anchors.recruitStandee
    window.__drinksStaffPreview.setPlayerPose(stand.x + 0.88, stand.z + 0.35, -Math.PI * 0.88)
    window.__drinksStaffPreview.setCamera(stand.x + 1.55, 1.38, stand.z + 1.95, stand.x + 0.88, 1.06, stand.z + 0.35)
    window.__drinksStaffPreview.step(0.05)
  })
  await page.waitForTimeout(450)
  const shot2 = join(OUT_DIR, '02-uniform-equipped.png')
  await page.screenshot({ path: shot2 })
  const m2 = await page.evaluate(() => window.__drinksStaffPreview.getMetrics())
  assert.equal(m2.snapshot.onDuty, true)
  assert.equal(m2.uniformEquipped, true)
  assert.equal(m2.bgmPlaying, true)

  // 3. 进店到收银台接单（玩家站在独立副收银工位，错开 NPC，按 KeyE 触发接单）
  await page.evaluate(() => {
    const desk = window.__drinksStaffPreview.staff.session.anchors.orderDesk
    window.__drinksStaffPreview.setPlayerPose(desk.x, desk.z, 0)
    window.__drinksStaffPreview.setCamera(desk.x + 1.45, 1.68, desk.z - 1.1, desk.x - 0.25, 1.05, desk.z + 0.2)
    window.__drinksStaffPreview.step(0.05)
  })
  await page.waitForTimeout(300)
  await page.keyboard.press('KeyE')
  await page.waitForTimeout(350)
  const shot3 = join(OUT_DIR, '03-accept-order.png')
  await page.screenshot({ path: shot3 })
  const m3 = await page.evaluate(() => window.__drinksStaffPreview.getMetrics())
  assert.equal(m3.snapshot.phase, 'add_toppings')
  assert.ok(m3.snapshot.activeTicket)

  // 4. 后场制茶台按住「加料制作」：宽视角完整框入玩家全身+红环+open deck 倾倒设备+显色充液杯体
  await page.evaluate(() => {
    const snap = window.__drinksStaffPreview.staff.session.getSnapshot()
    const zone = snap.targetZone
    const cupPos = snap.activeCupPos ?? zone
    window.__drinksStaffPreview.setPlayerPose(cupPos.x - 0.68, zone.z + 0.14, -0.55)
    window.__drinksStaffPreview.setCamera(cupPos.x + 0.92, 1.56, zone.z + 0.95, cupPos.x - 0.18, 1.0, cupPos.z)
    window.__drinksStaffPreview.step(0.05)
  })
  await page.waitForTimeout(250)
  const ctaBox = await page.locator('[data-staff-cta]').boundingBox()
  assert.ok(ctaBox)
  await page.mouse.move(ctaBox.x + ctaBox.width / 2, ctaBox.y + ctaBox.height / 2)
  await page.mouse.down()
  await page.waitForFunction(
    () => {
      const s = window.__drinksStaffPreview.getMetrics().snapshot
      return s.phase !== 'add_toppings' || s.stepProgress >= 0.45
    },
    null,
    { timeout: 5000 },
  )
  const shot4 = join(OUT_DIR, '04-add-toppings.png')
  await page.screenshot({ path: shot4 })
  // Hold until toppings step finishes -> seal_cup
  await page.waitForFunction(
    () => window.__drinksStaffPreview.getMetrics().snapshot.phase === 'seal_cup',
    null,
    { timeout: 5000 },
  )
  await page.mouse.up()
  await page.waitForTimeout(200)
  const m4 = await page.evaluate(() => window.__drinksStaffPreview.getMetrics())
  assert.equal(m4.snapshot.phase, 'seal_cup')

  // 5. 封口贴标：宽近景正对红色封口机开放槽口（rotation.y=0），展示完整玩家与腔内热压杯子
  await page.evaluate(() => {
    const seal = window.__drinksStaffPreview.staff.session.anchors.sealStation
    window.__drinksStaffPreview.setPlayerPose(seal.x - 0.62, seal.z + 0.14, -0.62)
    window.__drinksStaffPreview.setCamera(seal.x + 0.68, 1.54, seal.z + 0.92, seal.x - 0.14, 1.0, seal.z - 0.62)
    window.__drinksStaffPreview.step(0.05)
  })
  await page.waitForTimeout(250)
  const ctaBox2 = await page.locator('[data-staff-cta]').boundingBox()
  await page.mouse.move(ctaBox2.x + ctaBox2.width / 2, ctaBox2.y + ctaBox2.height / 2)
  await page.mouse.down()
  await page.waitForFunction(
    () => {
      const s = window.__drinksStaffPreview.getMetrics().snapshot
      return s.phase !== 'seal_cup' || s.stepProgress >= 0.45
    },
    null,
    { timeout: 5000 },
  )
  const shot5 = join(OUT_DIR, '05-seal-cup.png')
  await page.screenshot({ path: shot5 })
  await page.waitForFunction(
    () => window.__drinksStaffPreview.getMetrics().snapshot.phase === 'call_pickup',
    null,
    { timeout: 5000 },
  )
  await page.mouse.up()
  await page.waitForTimeout(200)
  const m5 = await page.evaluate(() => window.__drinksStaffPreview.getMetrics())
  assert.equal(m5.snapshot.phase, 'call_pickup')
  assert.equal(m5.snapshot.cupLidSealed, true)

  // 6. 取餐台出杯叫号：玩家正面对前厅取餐台，斜前方从门店侧翼看入，正面帽子与胸口围裙徽标完全对齐同向
  await page.evaluate(() => {
    const pick = window.__drinksStaffPreview.staff.session.anchors.pickupCounter
    window.__drinksStaffPreview.setPlayerPose(pick.x - 0.58, pick.z - 0.05, Math.PI * 0.85)
    window.__drinksStaffPreview.setCamera(pick.x - 1.55, 1.66, pick.z + 1.45, pick.x - 0.05, 1.04, pick.z - 0.25)
    window.__drinksStaffPreview.step(0.05)
  })
  await page.waitForTimeout(350)
  const shot6a = join(OUT_DIR, '06-call-pickup.png')
  await page.screenshot({ path: shot6a })
  await page.click('[data-staff-cta]')
  await page.waitForTimeout(450)
  const shot7 = join(OUT_DIR, '07-served-complete.png')
  await page.screenshot({ path: shot7 })
  const m6 = await page.evaluate(() => window.__drinksStaffPreview.getMetrics())
  assert.equal(m6.snapshot.cupsServed, 1)
  assert.ok(m6.audioTotalPlayed >= 5)

  assert.deepEqual(errors, [], `unexpected runtime errors: ${errors.join('; ')}`)

  const vid = page.video()
  rawVideoPath = vid ? await vid.path() : null
  await page.evaluate(() => window.__drinksStaffPreview.dispose())
  await context.close()

  const finalWebm = join(OUT_DIR, 'staff-workflow-recording.webm')
  if (rawVideoPath && rawVideoPath !== finalWebm) {
    await rm(finalWebm, { force: true })
    await rename(rawVideoPath, finalWebm)
    rawVideoPath = finalWebm
  }

  let mp4Path = null
  try {
    const candidateMp4 = join(OUT_DIR, 'staff-workflow-recording.mp4')
    execFileSync(
      'ffmpeg',
      ['-y', '-i', finalWebm, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', candidateMp4],
      { stdio: 'ignore' },
    )
    mp4Path = candidateMp4
  } catch {
    // ffmpeg optional; webm is always saved
  }

  console.log(
    JSON.stringify(
      {
        devUrl,
        videoWebm: rawVideoPath,
        videoMp4: mp4Path,
        keyframes: [shot1, shot2, shot3, shot4, shot5, shot6a, shot7],
        afterRecruit: m2,
        afterToppings: m4,
        afterSeal: m5,
        afterComplete: m6,
      },
      null,
      2,
    ),
  )
} finally {
  await browser.close()
  await viteServer.close()
}
