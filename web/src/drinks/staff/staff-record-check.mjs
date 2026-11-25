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
  <title>蜜雪冰城员工玩法全流程实测（连做3单+做错反馈）</title>
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

async function holdStepUntilPhase(page, nextPhase) {
  const box = await page.locator('[data-staff-cta]').boundingBox()
  assert.ok(box)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.waitForFunction(
    target => window.__drinksStaffPreview.getMetrics().snapshot.phase === target,
    nextPhase,
    { timeout: 5500 },
  )
  await page.mouse.up()
  await page.waitForTimeout(160)
}

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
  await page.waitForTimeout(300)

  // 1. 门口招聘立牌 + 极简 HUD 应聘提示
  const shot1 = join(OUT_DIR, '01-recruit-prompt.png')
  await page.evaluate(() => {
    const stand = window.__drinksStaffPreview.staff.session.anchors.recruitStandee
    window.__drinksStaffPreview.setPlayerPose(stand.x + 0.88, stand.z + 0.25, 1.25)
    window.__drinksStaffPreview.setCamera(stand.x + 2.05, 1.52, stand.z + 2.25, stand.x + 0.28, 0.88, stand.z + 0.05)
    window.__drinksStaffPreview.step(0.05)
  })
  await page.waitForTimeout(220)
  await page.screenshot({ path: shot1 })
  const m1 = await page.evaluate(() => window.__drinksStaffPreview.getMetrics())
  assert.equal(m1.snapshot.nearRecruit, true)
  assert.equal(m1.snapshot.onDuty, false)

  // 2. 点击应聘穿员工服，然后走进店门观察 BGM 平滑淡入
  await page.click('[data-staff-cta]')
  await page.evaluate(() => {
    const stand = window.__drinksStaffPreview.staff.session.anchors.recruitStandee
    window.__drinksStaffPreview.setPlayerPose(stand.x + 0.88, stand.z + 0.35, -Math.PI * 0.88)
    window.__drinksStaffPreview.setCamera(stand.x + 1.55, 1.38, stand.z + 1.95, stand.x + 0.88, 1.06, stand.z + 0.35)
    window.__drinksStaffPreview.step(0.05)
  })
  await page.waitForTimeout(350)
  const shot2 = join(OUT_DIR, '02-uniform-equipped.png')
  await page.screenshot({ path: shot2 })
  const m2Outside = await page.evaluate(() => window.__drinksStaffPreview.getMetrics())
  assert.equal(m2Outside.snapshot.onDuty, true)
  assert.equal(m2Outside.uniformEquipped, true)
  assert.equal(m2Outside.bgmPlaying, true)
  assert.equal(m2Outside.bgmInsideShop, false)

  // 走入店内后 BGM 淡入到满值 1.0
  await page.evaluate(() => {
    const desk = window.__drinksStaffPreview.staff.session.anchors.orderDesk
    window.__drinksStaffPreview.setPlayerPose(desk.x, desk.z, 0)
    for (let i = 0; i < 6; i++) window.__drinksStaffPreview.step(0.2)
  })
  const m2Inside = await page.evaluate(() => window.__drinksStaffPreview.getMetrics())
  assert.equal(m2Inside.bgmInsideShop, true)
  assert.equal(m2Inside.bgmFadeLevel, 1)

  const servedNames = []

  // ====== 第 1 单（含 1 次做错工位反馈 + 全部 5 步实操截图） ======
  // 1a. 收银台接单
  await page.evaluate(() => {
    const desk = window.__drinksStaffPreview.staff.session.anchors.orderDesk
    window.__drinksStaffPreview.setPlayerPose(desk.x, desk.z, 0)
    window.__drinksStaffPreview.setCamera(desk.x + 1.45, 1.68, desk.z - 1.1, desk.x - 0.25, 1.05, desk.z + 0.2)
    window.__drinksStaffPreview.step(0.05)
  })
  await page.waitForTimeout(200)
  await page.keyboard.press('KeyE')
  await page.waitForTimeout(200)
  const o1Accept = await page.evaluate(() => window.__drinksStaffPreview.getMetrics())
  assert.equal(o1Accept.snapshot.phase, 'shake_cup')
  assert.ok(o1Accept.snapshot.activeTicket)
  servedNames.push(o1Accept.snapshot.activeTicket.itemName)

  // 1b. 做错演示：未去摇杯区而站在封口区提前按操作 -> 触发做错音 action_reject + 人物摆手摇头 + HUD 警示抖动
  await page.evaluate(() => {
    const seal = window.__drinksStaffPreview.staff.session.anchors.sealStation
    window.__drinksStaffPreview.setPlayerPose(seal.x + 0.05, seal.z + 0.14, -Math.PI * 0.72)
    window.__drinksStaffPreview.setCamera(seal.x + 1.05, 1.56, seal.z + 1.15, seal.x - 0.1, 1.06, seal.z - 0.25)
    window.__drinksStaffPreview.step(0.05)
  })
  await page.waitForTimeout(180)
  await page.click('[data-staff-cta]')
  await page.evaluate(() => window.__drinksStaffPreview.step(0.08))
  await page.waitForTimeout(120)
  const shot3 = join(OUT_DIR, '03-mistake-feedback.png')
  await page.screenshot({ path: shot3 })
  const mMistake = await page.evaluate(() => window.__drinksStaffPreview.getMetrics())
  assert.equal(mMistake.snapshot.mistakeCount, 1)
  assert.equal(mMistake.snapshot.lastMistake?.code, 'wrong_station')
  assert.ok(mMistake.audioCounts.action_reject >= 1)
  assert.ok(Math.abs(mMistake.armRightPitch) > 0.4)

  // 1c. 第 1 单第 2 步：走到摇茶区长按摇杯（双臂前抬摇振手部动作 + tea_shake 设备 + 清除做错提示）
  await page.evaluate(() => {
    const shake = window.__drinksStaffPreview.staff.session.anchors.shakeStation
    window.__drinksStaffPreview.setPlayerPose(shake.x - 0.54, shake.z + 0.14, -0.45)
    window.__drinksStaffPreview.setCamera(shake.x + 1.18, 1.72, shake.z + 1.32, shake.x - 0.24, 1.04, shake.z - 0.34)
    window.__drinksStaffPreview.step(0.05)
  })
  await page.waitForTimeout(200)
  const shakeBox = await page.locator('[data-staff-cta]').boundingBox()
  await page.mouse.move(shakeBox.x + shakeBox.width / 2, shakeBox.y + shakeBox.height / 2)
  await page.mouse.down()
  await page.waitForFunction(
    () => {
      const s = window.__drinksStaffPreview.getMetrics().snapshot
      return s.phase !== 'shake_cup' || (s.stepProgress >= 0.45 && s.lastMistake === null)
    },
    null,
    { timeout: 5000 },
  )
  await page.waitForTimeout(60)
  const shot4 = join(OUT_DIR, '04-order1-shake-cup.png')
  await page.screenshot({ path: shot4 })
  const mShake = await page.evaluate(() => window.__drinksStaffPreview.getMetrics())
  assert.equal(mShake.snapshot.lastMistake, null)
  assert.ok(mShake.audioCounts.shaker_shake >= 1)
  assert.ok(mShake.armRightPitch > 0.5)
  await page.waitForFunction(
    () => window.__drinksStaffPreview.getMetrics().snapshot.phase === 'add_toppings',
    null,
    { timeout: 5000 },
  )
  await page.mouse.up()
  await page.waitForTimeout(160)

  // 1d. 第 1 单第 3 步：走到对应加料台长按加料（完整全身+右臂前倾加料+设备与草莓粉杯体清晰无挡）
  await page.evaluate(() => {
    const snap = window.__drinksStaffPreview.staff.session.getSnapshot()
    const zone = snap.targetZone
    const cupPos = snap.activeCupPos ?? zone
    window.__drinksStaffPreview.setPlayerPose(zone.x - 0.46, zone.z + 0.14, -0.45)
    window.__drinksStaffPreview.setCamera(zone.x + 1.15, 1.72, zone.z + 1.3, zone.x - 0.16, 1.02, cupPos.z + 0.15)
    window.__drinksStaffPreview.step(0.05)
  })
  await page.waitForTimeout(200)
  const topBox = await page.locator('[data-staff-cta]').boundingBox()
  await page.mouse.move(topBox.x + topBox.width / 2, topBox.y + topBox.height / 2)
  await page.mouse.down()
  await page.waitForFunction(
    () => {
      const s = window.__drinksStaffPreview.getMetrics().snapshot
      return s.phase !== 'add_toppings' || s.stepProgress >= 0.48
    },
    null,
    { timeout: 5000 },
  )
  await page.waitForTimeout(60)
  const shot5 = join(OUT_DIR, '05-order1-add-toppings.png')
  await page.screenshot({ path: shot5 })
  await page.waitForFunction(
    () => window.__drinksStaffPreview.getMetrics().snapshot.phase === 'seal_cup',
    null,
    { timeout: 5000 },
  )
  await page.mouse.up()
  await page.waitForTimeout(160)

  // 1e. 第 1 单第 4 步：走到封口机按住封口压膜（完整玩家+前推封口手势+开放封口机压合）
  await page.evaluate(() => {
    const seal = window.__drinksStaffPreview.staff.session.anchors.sealStation
    window.__drinksStaffPreview.setPlayerPose(seal.x - 0.42, seal.z + 0.14, -0.45)
    window.__drinksStaffPreview.setCamera(seal.x + 0.98, 1.68, seal.z + 1.24, seal.x - 0.18, 1.02, seal.z - 0.36)
    window.__drinksStaffPreview.step(0.05)
  })
  await page.waitForTimeout(200)
  const sealBox = await page.locator('[data-staff-cta]').boundingBox()
  await page.mouse.move(sealBox.x + sealBox.width / 2, sealBox.y + sealBox.height / 2)
  await page.mouse.down()
  await page.waitForFunction(
    () => {
      const s = window.__drinksStaffPreview.getMetrics().snapshot
      return s.phase !== 'seal_cup' || s.stepProgress >= 0.45
    },
    null,
    { timeout: 5000 },
  )
  const shot6 = join(OUT_DIR, '06-order1-seal-cup.png')
  await page.screenshot({ path: shot6 })
  await page.waitForFunction(
    () => window.__drinksStaffPreview.getMetrics().snapshot.phase === 'call_pickup',
    null,
    { timeout: 5000 },
  )
  await page.mouse.up()
  await page.waitForTimeout(160)

  // 1f. 第 1 单第 5 步：取餐台出杯叫号
  await page.evaluate(() => {
    const pick = window.__drinksStaffPreview.staff.session.anchors.pickupCounter
    window.__drinksStaffPreview.setPlayerPose(pick.x - 0.58, pick.z - 0.05, Math.PI * 0.85)
    window.__drinksStaffPreview.setCamera(pick.x - 1.55, 1.66, pick.z + 1.45, pick.x - 0.05, 1.04, pick.z - 0.25)
    window.__drinksStaffPreview.step(0.05)
  })
  await page.waitForTimeout(220)
  const shot7 = join(OUT_DIR, '07-order1-pickup.png')
  await page.screenshot({ path: shot7 })
  await page.click('[data-staff-cta]')
  await page.waitForTimeout(220)
  const afterOrder1 = await page.evaluate(() => window.__drinksStaffPreview.getMetrics())
  assert.equal(afterOrder1.snapshot.cupsServed, 1)

  // ====== 第 2 单 & 第 3 单：连续出杯节奏实测 ======
  for (let orderNo = 2; orderNo <= 3; orderNo++) {
    // 接单
    await page.evaluate(() => {
      const desk = window.__drinksStaffPreview.staff.session.anchors.orderDesk
      window.__drinksStaffPreview.setPlayerPose(desk.x, desk.z, 0)
      window.__drinksStaffPreview.setCamera(desk.x + 1.45, 1.68, desk.z - 1.1, desk.x - 0.25, 1.05, desk.z + 0.2)
      window.__drinksStaffPreview.step(0.05)
    })
    await page.waitForTimeout(150)
    await page.keyboard.press('KeyE')
    await page.waitForTimeout(150)
    const ticketSnap = await page.evaluate(() => window.__drinksStaffPreview.getMetrics().snapshot)
    assert.equal(ticketSnap.phase, 'shake_cup')
    servedNames.push(ticketSnap.activeTicket.itemName)

    // 摇杯
    await page.evaluate(() => {
      const shake = window.__drinksStaffPreview.staff.session.anchors.shakeStation
      window.__drinksStaffPreview.setPlayerPose(shake.x - 0.56, shake.z + 0.14, -0.58)
      window.__drinksStaffPreview.setCamera(shake.x + 0.96, 1.58, shake.z + 0.92, shake.x - 0.14, 1.02, shake.z - 0.48)
      window.__drinksStaffPreview.step(0.05)
    })
    await page.waitForTimeout(120)
    await holdStepUntilPhase(page, 'add_toppings')

    // 加料
    await page.evaluate(() => {
      const snap = window.__drinksStaffPreview.staff.session.getSnapshot()
      const zone = snap.targetZone
      const cupPos = snap.activeCupPos ?? zone
      window.__drinksStaffPreview.setPlayerPose(zone.x - 0.42, zone.z + 0.14, -0.45)
      window.__drinksStaffPreview.setCamera(zone.x + 0.96, 1.56, zone.z + 0.96, cupPos.x - 0.1, 1.0, cupPos.z)
      window.__drinksStaffPreview.step(0.05)
    })
    await page.waitForTimeout(120)
    await holdStepUntilPhase(page, 'seal_cup')

    // 封口
    await page.evaluate(() => {
      const seal = window.__drinksStaffPreview.staff.session.anchors.sealStation
      window.__drinksStaffPreview.setPlayerPose(seal.x - 0.34, seal.z + 0.14, -0.45)
      window.__drinksStaffPreview.setCamera(seal.x + 0.78, 1.54, seal.z + 0.94, seal.x - 0.08, 1.0, seal.z - 0.6)
      window.__drinksStaffPreview.step(0.05)
    })
    await page.waitForTimeout(120)
    await holdStepUntilPhase(page, 'call_pickup')

    // 叫号
    await page.evaluate(() => {
      const pick = window.__drinksStaffPreview.staff.session.anchors.pickupCounter
      window.__drinksStaffPreview.setPlayerPose(pick.x - 0.58, pick.z - 0.05, Math.PI * 0.85)
      window.__drinksStaffPreview.setCamera(pick.x - 1.55, 1.66, pick.z + 1.45, pick.x - 0.05, 1.04, pick.z - 0.25)
      window.__drinksStaffPreview.step(0.05)
    })
    await page.waitForTimeout(160)
    await page.click('[data-staff-cta]')
    await page.waitForTimeout(200)
  }

  const shot8 = join(OUT_DIR, '08-order3-complete.png')
  await page.screenshot({ path: shot8 })
  const afterOrder3 = await page.evaluate(() => window.__drinksStaffPreview.getMetrics())
  assert.equal(afterOrder3.snapshot.cupsServed, 3)
  assert.equal(afterOrder3.snapshot.streakCount, 3)
  assert.ok(afterOrder3.audioCounts.shaker_shake >= 3)
  assert.ok(afterOrder3.audioCounts.cup_seal >= 3)
  assert.ok(afterOrder3.audioCounts.call_number >= 3)
  assert.ok(afterOrder3.audioCounts.action_reject >= 1)
  assert.ok(afterOrder3.audioCounts.staff_step_done >= 9)
  assert.notEqual(servedNames[0], servedNames[1])
  assert.notEqual(servedNames[1], servedNames[2])

  // 验证下班/出门时 BGM 淡出至 0
  await page.evaluate(() => {
    window.__drinksStaffPreview.setPlayerPose(0.2, 5.2, 0)
    for (let i = 0; i < 6; i++) window.__drinksStaffPreview.step(0.2)
  })
  const afterLeaveShop = await page.evaluate(() => window.__drinksStaffPreview.getMetrics())
  assert.equal(afterLeaveShop.bgmInsideShop, false)
  assert.equal(afterLeaveShop.bgmFadeLevel, 0)

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
        servedDrinks: servedNames,
        keyframes: [shot1, shot2, shot3, shot4, shot5, shot6, shot7, shot8],
        bgmTransition: {
          outsideBeforeEnter: m2Outside.bgmFadeLevel,
          insideShop: m2Inside.bgmFadeLevel,
          afterExitShop: afterLeaveShop.bgmFadeLevel,
        },
        mistakeCheck: {
          mistakeCount: mMistake.snapshot.mistakeCount,
          code: mMistake.snapshot.lastMistake?.code,
          message: mMistake.snapshot.lastMistake?.message,
          actionRejectCount: mMistake.audioCounts.action_reject,
        },
        afterOrder3,
      },
      null,
      2,
    ),
  )
} finally {
  await browser.close()
  await viteServer.close()
}
