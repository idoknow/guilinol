import {mkdir, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {parseArgs} from 'node:util'
import {preview} from 'vite'
import {chromium} from 'playwright'
import {telemetryPreview} from './telemetry-preview.mjs'

const {values: args} = parseArgs({
  options: {
    dist: {type: 'string'},
    out: {type: 'string', default: '/tmp/hud-layout'},
    label: {type: 'string', default: 'run'},
    duty: {type: 'boolean', default: false},
    menu: {type: 'boolean', default: false},
    drinks: {type: 'boolean', default: false},
    strict: {type: 'boolean', default: false},
  },
  strict: false,
})

const distArg = typeof args.dist === 'string' && args.dist ? args.dist : undefined
const outDir = typeof args.out === 'string' && args.out ? args.out : '/tmp/hud-layout'
const label = typeof args.label === 'string' && args.label ? args.label : 'run'
const duty = Boolean(args.duty)
// --menu：量之前展开右上「工具」册页，检查展开态不出屏、不压其他 HUD。
const menu = Boolean(args.menu)
// --drinks：开饮品店（?drinks），站到店门口、手里捧一杯，量叫号面板、饮品条和 [F] 进店是否互相压住。
const drinks = Boolean(args.drinks)
const suffix = `${duty ? '-duty' : ''}${menu ? '-menu' : ''}${drinks ? '-drinks' : ''}`
const strict = Boolean(args.strict)

const VIEWPORTS = [
  {
    name: 'phone-1920x886',
    contextOptions: {
      viewport: {width: 873, height: 403},
      deviceScaleFactor: 2.2,
      isMobile: true,
      hasTouch: true,
    },
  },
  {
    name: 'phone-844x390',
    contextOptions: {
      viewport: {width: 844, height: 390},
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    },
  },
  {
    name: 'desktop-1440x900',
    contextOptions: {
      viewport: {width: 1440, height: 900},
      deviceScaleFactor: 1,
    },
  },
]

function measureHudLayout() {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const vpArea = vw * vh

  const styleCache = new Map()
  const rectCache = new Map()
  const shownCache = new Map()

  const getStyle = (el) => {
    let cs = styleCache.get(el)
    if (!cs) {
      cs = window.getComputedStyle(el)
      styleCache.set(el, cs)
    }
    return cs
  }

  const getRect = (el) => {
    let rect = rectCache.get(el)
    if (!rect) {
      rect = el.getBoundingClientRect()
      rectCache.set(el, rect)
    }
    return rect
  }

  const getClassStr = (el) => {
    if (typeof el.className === 'string') return el.className.trim().replace(/\s+/g, ' ')
    if (el.className && typeof el.className.baseVal === 'string') {
      return el.className.baseVal.trim().replace(/\s+/g, ' ')
    }
    return (el.getAttribute('class') || '').trim().replace(/\s+/g, ' ')
  }

  const getInnerText = (el) => {
    const raw = typeof el.innerText === 'string' ? el.innerText : ''
    return raw.replace(/\s+/g, ' ').trim()
  }

  const getText = (el) => {
    const raw = typeof el.innerText === 'string' ? el.innerText : el.textContent || ''
    return raw.replace(/\s+/g, ' ').trim()
  }

  const toRoundRect = (r) => ({
    x: Math.round(r.left),
    y: Math.round(r.top),
    w: Math.round(r.width),
    h: Math.round(r.height),
  })

  const describe = (el) => {
    const tag = el.tagName.toLowerCase()
    const cls = getClassStr(el).replace(/\s+/g, '.').slice(0, 40)
    const text = getText(el).slice(0, 16)
    return `${tag}${cls ? `.${cls}` : ''}「${text}」`
  }

  const isShown = (el) => {
    if (shownCache.has(el)) return shownCache.get(el)
    if (!el || el.nodeType !== 1) {
      shownCache.set(el, false)
      return false
    }

    const r = getRect(el)
    if (r.width <= 1 || r.height <= 1) {
      shownCache.set(el, false)
      return false
    }
    if (r.right <= 0 || r.bottom <= 0 || r.left >= vw || r.top >= vh) {
      shownCache.set(el, false)
      return false
    }

    let opacity = 1
    let cur = el
    while (cur && cur.nodeType === 1) {
      const cs = getStyle(cur)
      if (cs.display === 'none' || cs.visibility === 'hidden') {
        shownCache.set(el, false)
        return false
      }
      const op = Number.parseFloat(cs.opacity)
      opacity *= Number.isFinite(op) ? op : 1
      if (opacity <= 0.05) {
        shownCache.set(el, false)
        return false
      }
      cur = cur.parentElement
    }

    shownCache.set(el, true)
    return true
  }

  // 1. controls
  const controlCandidates = document.querySelectorAll(
    'button, [role="button"], a[href]',
  )
  const controlEls = []
  const controls = []

  for (const el of controlCandidates) {
    if (!isShown(el)) continue
    if (getStyle(el).pointerEvents === 'none') continue
    if (el.disabled === true) continue

    controlEls.push(el)
    const r = getRect(el)
    const cx = Math.min(Math.max(r.left + r.width / 2, 0), Math.max(0, vw - 1))
    const cy = Math.min(Math.max(r.top + r.height / 2, 0), Math.max(0, vh - 1))
    const hit = document.elementFromPoint(cx, cy)
    const clickable = Boolean(hit && (hit === el || el.contains(hit) || hit.contains(el)))

    controls.push({
      tag: el.tagName.toLowerCase(),
      cls: getClassStr(el).slice(0, 60),
      text: getText(el).slice(0, 24),
      aria: el.getAttribute('aria-label') || '',
      rect: toRoundRect(r),
      clickable,
    })
  }

  const controlSet = new Set(controlEls)

  // 2. blocks
  const EXCLUDED_TAGS = new Set(['CANVAS', 'SCRIPT', 'STYLE'])
  const blockCandidates = new Set()

  for (const el of document.body.querySelectorAll('*')) {
    if (EXCLUDED_TAGS.has(el.tagName.toUpperCase())) continue
    if (el.closest('canvas')) continue

    const pos = getStyle(el).position
    if (pos !== 'fixed' && pos !== 'absolute') continue
    if (!isShown(el)) continue

    const r = getRect(el)
    if (r.width * r.height >= vpArea * 0.3) continue

    const clsLower = getClassStr(el).toLowerCase()
    const isRelevant =
      controlSet.has(el) ||
      getInnerText(el).length > 0 ||
      clsLower.includes('minimap') ||
      clsLower.includes('joystick')

    if (isRelevant) blockCandidates.add(el)
  }

  for (const el of controlEls) {
    if (EXCLUDED_TAGS.has(el.tagName.toUpperCase())) continue
    if (el.closest('canvas')) continue
    blockCandidates.add(el)
  }

  const blockEls = []
  for (const el of blockCandidates) {
    let hasAncestor = false
    let p = el.parentElement
    while (p) {
      if (blockCandidates.has(p)) {
        hasAncestor = true
        break
      }
      p = p.parentElement
    }
    if (!hasAncestor) blockEls.push(el)
  }

  // 3. overlaps
  const overlaps = []
  for (let i = 0; i < blockEls.length; i++) {
    const a = blockEls[i]
    const ra = getRect(a)
    for (let j = i + 1; j < blockEls.length; j++) {
      const b = blockEls[j]
      if (a.contains(b) || b.contains(a)) continue
      const rb = getRect(b)
      const ix = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left)
      const iy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top)
      if (ix > 0 && iy > 0) {
        const area = ix * iy
        if (area > 4) {
          overlaps.push({
            a: describe(a),
            b: describe(b),
            area: Math.round(area * 10) / 10,
          })
        }
      }
    }
  }
  overlaps.sort((x, y) => y.area - x.area)

  // 4. offscreen
  const offscreen = []
  const checkedEls = new Set([...blockEls, ...controlEls])
  for (const el of checkedEls) {
    if (!isShown(el)) continue
    const r = getRect(el)
    if (r.left < -1 || r.top < -1 || r.right > vw + 1 || r.bottom > vh + 1) {
      offscreen.push({
        desc: describe(el),
        rect: toRoundRect(r),
      })
    }
  }

  return {
    controlsVisible: controls.length,
    controlsClickable: controls.filter((c) => c.clickable).length,
    controls,
    blocks: blockEls.map(describe),
    overlaps,
    offscreen,
  }
}

await mkdir(outDir, {recursive: true})

const server = await preview({
  plugins: [telemetryPreview],
  root: 'web',
  configFile: 'web/vite.config.ts',
  preview: {host: '127.0.0.1', port: 0},
  ...(distArg ? {build: {outDir: path.resolve(distArg)}} : {}),
})
const base = `http://127.0.0.1:${server.httpServer.address().port}`

let browser
try {
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || undefined,
    // macOS headless can use Metal (fast); elsewhere fall back to SwiftShader.
    args: process.platform === 'darwin'
      ? ['--enable-gpu', '--use-angle=metal']
      : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  })

  const results = []

  for (const vp of VIEWPORTS) {
    const context = await browser.newContext(vp.contextOptions)
    try {
      const page = await context.newPage()
      const consoleErrors = []
      page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text())
      })
      page.on('pageerror', (err) => {
        consoleErrors.push(err?.message || String(err))
      })
      // A bare "404" console line has no URL; keep the paths so preview-only gaps (no backend) can be told apart.
      const failedRequests = []
      page.on('response', (res) => {
        if (res.status() >= 400) failedRequests.push(`${res.status()} ${new URL(res.url()).pathname}`)
      })

      await page.route('**/api/t', (route) => route.fulfill({status: 204}))
      await page.route('**/favicon.ico', (route) => route.fulfill({status: 204}))
      await page.route('**/stats.rcpd.cc/**', (route) => route.fulfill({status: 204, body: ''}))
      await page.route('**/mxana.tacool.com/**', (route) => route.fulfill({status: 204, body: ''}))
      await page.route('**/api/live', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({online: 14}),
        }),
      )

      // `verify` publishes window.viewer; it also turns on the dev overlay, which we switch back off before measuring.
      await page.goto(`${base}/?play&verify&mode=walk&flow=0${drinks ? '&drinks' : ''}`, {waitUntil: 'domcontentloaded', timeout: 120000})
      await page
        .waitForFunction(() => Boolean(window.viewer?.walk?.active), null, {timeout: 180000})
        .catch(async (err) => {
          await page.screenshot({path: path.join(outDir, `${label}-${vp.name}-timeout.png`)}).catch(() => {})
          throw err
        })

      // Software GL renders a few frames per second, so streaming may stay busy; the HUD is what we measure.
      await page
        .waitForFunction(() => ![1, 2].includes(window.__loading?.level), null, {timeout: 60000})
        .catch(() => {})
      const {width, height} = vp.contextOptions.viewport
      const center = {x: Math.round(width / 2), y: Math.round(height / 2)}
      await page
        .locator('canvas')
        .first()
        .click({position: center, timeout: 10000})
        .catch(() => page.locator('canvas').first().click({position: center, force: true}))

      const hasCoachSkip = await page
        .waitForSelector('.coach.in .coach-skip', {state: 'attached', timeout: 3000})
        .then(() => true)
        .catch(() => false)
      if (hasCoachSkip) {
        await page.evaluate(() => {
          document.querySelector('.coach.in .coach-skip')?.click()
        })
      }

      await page.evaluate(() => {
        document.querySelector('.spot-card.show .card-close')?.click()
      })

      // Player view: no ?verify/?debug overlay (FPS, B/s, online count, 视野 entry stay dev-only).
      await page.evaluate(() => { delete document.body.dataset.debug })
      await page.waitForTimeout(8000)

      let dutyError = null
      if (duty) {
        try {
          await page.locator('.td-entry').click({timeout: 15000})
          const go = page.locator('dialog.td-panel[open] [data-td-action="go-bridge"]')
          await go.waitFor({state: 'visible', timeout: 10000})
          await go.click()
          await page.waitForFunction(() => !document.querySelector('.ld-veil'), null, {
            timeout: 20000,
          })
          await page
            .waitForFunction(
              () =>
                window.viewer?.trafficDuty?.getInteractCandidate?.()?.action === 'talk_officer',
              null,
              {timeout: 8000},
            )
            .catch(() => {})
          await page.evaluate(() => window.viewer.trafficDuty.startDuty())
          await page.waitForTimeout(3000)
        } catch (err) {
          dutyError = err?.message || String(err)
        }
      }

      let drinksError = null
      if (drinks) {
        try {
          await page.waitForFunction(() => Boolean(window.viewer?.drinks), null, {timeout: 30000})
          await page.evaluate(() => window.viewer.drinks.teleportToShop())
          await page.waitForFunction(() => !document.querySelector('.ld-veil'), null, {timeout: 20000}).catch(() => {})
          const held = await page.evaluate(() => {
            const probe = window.viewer.drinks
            probe.sim.placePlayerOrder({menuItemId: 'ice_lemon_water', orderKey: `hud-layout-${Date.now()}`})
            probe.fastForward(90)
            probe.collectReady()
            return probe.getState().hold?.state
          })
          if (held !== 'holding') throw new Error(`drink not in hand: ${held}`)
          await page.waitForSelector('.drinks-hold-hud:not([hidden])', {timeout: 5000})
          await page.waitForSelector('.vehicle-action:not([hidden])', {timeout: 8000})
          await page.waitForTimeout(1500)
        } catch (err) {
          drinksError = err?.message || String(err)
        }
      }

      if (menu) {
        await page.locator('.dock-more').click({timeout: 10000})
        await page.waitForSelector('#dock-menu:not([hidden])', {timeout: 5000})
        await page.waitForTimeout(300)
      }

      const screenshotPath = path.join(outDir, `${label}-${vp.name}${suffix}.png`)
      await page.screenshot({path: screenshotPath, fullPage: false})

      const metrics = await page.evaluate(measureHudLayout)
      results.push({
        name: vp.name,
        duty,
        menu,
        drinks,
        dutyError,
        drinksError,
        ...metrics,
        consoleErrors,
        failedRequests,
      })
    } finally {
      await context.close()
    }
  }

  const jsonPath = path.join(outDir, `${label}${suffix}.json`)
  await writeFile(jsonPath, `${JSON.stringify(results, null, 2)}\n`, 'utf8')

  for (const r of results) {
    console.log(
      `${r.name.padEnd(17)} visible=${r.controlsVisible} clickable=${r.controlsClickable} overlaps=${r.overlaps.length} offscreen=${r.offscreen.length} errors=${r.consoleErrors.length}`,
    )
    if (r.dutyError) {
      console.log(`  dutyError: ${r.dutyError}`)
    }
    if (r.drinksError) {
      console.log(`  drinksError: ${r.drinksError}`)
    }
    for (const ov of r.overlaps.slice(0, 20)) {
      console.log(`  overlap (${ov.area}px²): ${ov.a} <-> ${ov.b}`)
    }
    if (r.overlaps.length > 20) {
      console.log(`  ... (${r.overlaps.length - 20} more overlaps)`)
    }
    for (const os of r.offscreen.slice(0, 20)) {
      const {x, y, w, h} = os.rect
      console.log(`  offscreen (${x},${y} ${w}x${h}): ${os.desc}`)
    }
    if (r.offscreen.length > 20) {
      console.log(`  ... (${r.offscreen.length - 20} more offscreen)`)
    }
    for (const err of r.consoleErrors.slice(0, 20)) {
      console.log(`  error: ${err}`)
    }
    for (const req of [...new Set(r.failedRequests)]) {
      console.log(`  failed request: ${req}`)
    }
    if (r.consoleErrors.length > 20) {
      console.log(`  ... (${r.consoleErrors.length - 20} more errors)`)
    }
  }

  if (
    strict &&
    results.some(
      (r) => r.overlaps.length > 0 || r.offscreen.length > 0 || r.consoleErrors.length > 0,
    )
  ) {
    process.exitCode = 1
  }
} finally {
  await browser?.close().catch(() => {})
  if (server) {
    if (typeof server.close === 'function') {
      await server.close().catch(() => {})
    } else if (server.httpServer) {
      server.httpServer.closeAllConnections?.()
      await new Promise((resolve) => server.httpServer.close(() => resolve()))
    }
  }
}
