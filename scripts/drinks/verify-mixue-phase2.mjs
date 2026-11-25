#!/usr/bin/env node
/**
 * 蜜雪二期（王城蜜雪冰城）生产预览端到端验收脚本（对应 k70，兼容 Carbon k68 零调试探针生产构建）：
 * 1) 零作弊依赖：完全通过宿主常规位置/键盘/真实 DOM 点击驱动全流程，不依赖 window.viewer.drinks 调试接口；
 * 2) 门外 -> 真实按住 KeyW 穿过 2.8m 门洞进入 1F 室内：校验自动切第一人称、相机标高处于 1F 而非 2F/3F 屋顶、按 KeyS 出门恢复原视角；
 * 3) 门口蜜雪招聘立牌：校验立牌 HUD 可见、真实按 KeyE/点击入职进入当班态（下班按钮/杯数显现）、测完点击下班收起 HUD；
 * 4) 真实点单 -> 实时等待出杯（冰鲜柠檬水 ~2.2s）-> 点击取杯 -> 按住 KeyI 连续喝：校验能量条实时走动、松手即停；
 * 5) 附加护栏：HUD 零遮挡审计（.drinks-staff-hud / .drinks-hold-hud vs .hotbar / .vehicle-action）+ 生产环境零作弊接口审计（k68 联动）；
 * 6) 严格在 finally 中关闭 browser 与自启 vite preview 服务，仅在 --cdp 时优先复用 9222，绝不碰 4190。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '../..')

const LAT_ORIGIN = 25.280
const LON_ORIGIN = 110.300
const METRES_LAT = 110574
const METRES_LON = 111320 * Math.cos((LAT_ORIGIN * Math.PI) / 180)

export const DEFAULT_SITES = {
  wangcheng_mall: {
    id: 'wangcheng_mall',
    lon: 110.2942555,
    lat: 25.2806134,
    bearingDeg: 13.4,
    fallbackGroundY: 157.35,
  },
  zhengyang_208: {
    id: 'zhengyang_208',
    lon: 110.2938048,
    lat: 25.2806767,
    bearingDeg: 13.4,
    fallbackGroundY: 155.7,
  },
}

export const BANNED_PROD_CHEAT_KEYS = [
  'teleportToShop',
  'walkInside',
  'walkToRecruitSign',
  'interactRecruit',
  'placeQuickOrder',
  'fastForward',
  'startHoldSip',
  'stopHoldSip',
  'grantFunds',
  'completeActiveOrderPerfect',
  'forceRecruit',
  'sim',
  'holdSession',
  'staff',
  'terrain',
]

export function ll2xz(lat, lon) {
  return {
    x: (lon - LON_ORIGIN) * METRES_LON,
    z: (LAT_ORIGIN - lat) * METRES_LAT,
  }
}

export function bearingDegToWorldYaw(bearingDeg) {
  const rad = (bearingDeg * Math.PI) / 180
  return Math.atan2(Math.sin(rad), -Math.cos(rad))
}

export function shopLocalToWorld(site, lx, lz) {
  const c = Math.cos(site.worldYaw)
  const s = Math.sin(site.worldYaw)
  return {
    x: site.worldX + lx * c + lz * s,
    z: site.worldZ - lx * s + lz * c,
  }
}

export function worldToShopLocal(site, wx, wz) {
  const dx = wx - site.worldX
  const dz = wz - site.worldZ
  const c = Math.cos(site.worldYaw)
  const s = Math.sin(site.worldYaw)
  return {
    x: dx * c - dz * s,
    z: dx * s + dz * c,
  }
}

/**
 * 从 web/src/drinks/site.ts 实时解析站点坐标，避免 Hy1 调整王城坐标后脚本漂移。
 */
export function loadSiteConfig(siteId = 'wangcheng_mall', repoRoot = REPO_ROOT) {
  const base = DEFAULT_SITES[siteId] ?? DEFAULT_SITES.wangcheng_mall
  let { lon, lat, bearingDeg, fallbackGroundY } = base
  const siteFile = join(repoRoot, 'web/src/drinks/site.ts')
  if (existsSync(siteFile)) {
    try {
      const src = readFileSync(siteFile, 'utf8')
      const blockRe = new RegExp(`${siteId}\\s*:\\s*createSiteCandidate\\(\\{([\\s\\S]*?)\\}\\)`)
      const match = src.match(blockRe)
      if (match) {
        const block = match[1]
        const readNum = key => {
          const m = block.match(new RegExp(`\\b${key}\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`))
          return m ? Number(m[1]) : null
        }
        lon = readNum('lon') ?? lon
        lat = readNum('lat') ?? lat
        bearingDeg = readNum('bearingDeg') ?? bearingDeg
        fallbackGroundY = readNum('fallbackGroundY') ?? fallbackGroundY
      }
    } catch {
      // 解析失败时安全回退内置坐标
    }
  }
  const { x, z } = ll2xz(lat, lon)
  return {
    id: siteId,
    lon,
    lat,
    bearingDeg,
    fallbackGroundY,
    worldX: Math.round(x * 1000) / 1000,
    worldZ: Math.round(z * 1000) / 1000,
    worldYaw: bearingDegToWorldYaw(bearingDeg),
  }
}

/**
 * 生产环境零作弊/调试接口审计（配合 Carbon k68）。
 */
export function auditViewerForCheatApis(snapshot) {
  const drinksKeys = Array.isArray(snapshot?.drinksKeys) ? snapshot.drinksKeys : []
  const viewerKeys = Array.isArray(snapshot?.viewerKeys) ? snapshot.viewerKeys : []
  const leaked = []
  for (const k of drinksKeys) {
    if (BANNED_PROD_CHEAT_KEYS.includes(k)) {
      leaked.push(`viewer.drinks.${k}`)
    }
  }
  for (const k of viewerKeys) {
    if (BANNED_PROD_CHEAT_KEYS.includes(k)) {
      leaked.push(`viewer.${k}`)
    }
  }
  return {
    hasDrinksProp: Boolean(snapshot?.hasDrinksProp),
    drinksKeyCount: drinksKeys.length,
    leakedKeys: leaked,
    clean: leaked.length === 0,
  }
}

export function parseVerifyArgs(argv) {
  const opts = {
    dist: resolve(REPO_ROOT, 'dist'),
    url: '',
    port: 4185,
    out: '/tmp/mixue-phase2-verify',
    site: 'wangcheng_mall',
    holdMs: 900,
    useCdp: false,
    allowDevProbe: false,
    dryRun: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => argv[++i]
    if (a === '--dist') opts.dist = resolve(REPO_ROOT, next() || 'dist')
    else if (a === '--url') opts.url = String(next() || '')
    else if (a === '--port') opts.port = Number(next()) || 4185
    else if (a === '--out') opts.out = resolve(next() || '/tmp/mixue-phase2-verify')
    else if (a === '--site') opts.site = String(next() || 'wangcheng_mall')
    else if (a === '--hold-ms') opts.holdMs = Math.max(250, Number(next()) || 900)
    else if (a === '--cdp') opts.useCdp = true
    else if (a === '--allow-dev-probe') opts.allowDevProbe = true
    else if (a === '--dry-run') opts.dryRun = true
  }
  return opts
}

/**
 * 纯断言汇总：可直接在 node --test 中做单元测试，无浏览器依赖。
 */
export function evaluatePhase2Checks(metrics) {
  const failures = []
  if (!metrics || typeof metrics !== 'object') {
    return { ok: false, failures: ['MISSING_METRICS'] }
  }
  if (Array.isArray(metrics.errors) && metrics.errors.length > 0) {
    failures.push(`RUNTIME_ERRORS(${metrics.errors.length}): ${metrics.errors[0]}`)
  }
  if (!metrics.autoFirstPerson?.enteredFirstPerson) {
    failures.push('AUTO_FIRST_PERSON_NOT_TRIGGERED')
  }
  if (metrics.autoFirstPerson?.onRoof === true) {
    const delta = metrics.autoFirstPerson?.camDeltaY ?? 'unknown'
    failures.push(`CAMERA_ON_ROOF_NOT_INTERIOR(camDeltaY=${delta})`)
  }
  if (metrics.autoFirstPerson?.restoredOnExit === false) {
    failures.push('AUTO_FIRST_PERSON_DID_NOT_RESTORE')
  }
  if (typeof metrics.shopDrawCalls === 'number' && metrics.shopDrawCalls > 30) {
    failures.push(`SHOP_DRAW_CALLS_EXCEEDED(${metrics.shopDrawCalls}>30)`)
  }
  if (!metrics.recruitSign?.visible) {
    failures.push('RECRUIT_SIGN_NOT_VISIBLE')
  }
  if (!metrics.recruitSign?.interactive) {
    failures.push('RECRUIT_SIGN_NOT_INTERACTIVE')
  }
  const energy = metrics.holdEnergy
  if (!energy || !Number.isFinite(energy.beforeFill) || !Number.isFinite(energy.afterFill)) {
    failures.push('HOLD_ENERGY_SAMPLE_MISSING')
  } else {
    const drained = energy.beforeFill - energy.afterFill
    if (drained <= 0.02) {
      failures.push(`HOLD_ENERGY_NOT_MOVING(delta=${drained.toFixed(4)})`)
    }
    if (!energy.energyBarMoved) {
      failures.push('HOLD_ENERGY_BAR_DOM_STATIC')
    }
    if (energy.stoppedAfterRelease === false) {
      failures.push('HOLD_ENERGY_DID_NOT_STOP_ON_RELEASE')
    }
  }
  if (Array.isArray(metrics.hudOverlaps) && metrics.hudOverlaps.length > 0) {
    failures.push(`HUD_OVERLAP(${metrics.hudOverlaps.map(o => `${o.source}x${o.target}`).join(',')})`)
  }
  if (
    metrics.prodProbeAudit &&
    metrics.prodProbeAudit.enforce !== false &&
    Array.isArray(metrics.prodProbeAudit.leakedKeys) &&
    metrics.prodProbeAudit.leakedKeys.length > 0
  ) {
    failures.push(`PROD_CHEAT_API_LEAKED(${metrics.prodProbeAudit.leakedKeys.slice(0, 4).join(',')})`)
  }
  return { ok: failures.length === 0, failures }
}

async function waitForHttp(url, timeoutMs = 15000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(url)
      if (res.ok) return true
    } catch {}
    await new Promise(r => setTimeout(r, 250))
  }
  return false
}

async function connectOrLaunchBrowser(chromium, useCdp) {
  if (useCdp) {
    try {
      const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
      return { browser, owned: false }
    } catch {
      // 9222 不可连时自动回退新启无头浏览器
    }
  }
  const browser = await chromium.launch({
    headless: true,
    args: process.platform === 'darwin'
      ? ['--enable-gpu', '--use-angle=metal']
      : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  })
  return { browser, owned: true }
}

async function measureHudOverlaps(page, sourceSelector, stepLabel) {
  return page.evaluate(({ sourceSelector, stepLabel }) => {
    const visibleRect = sel => {
      const el = document.querySelector(sel)
      if (!el || el.hasAttribute('hidden')) return null
      const style = getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return null
      const r = el.getBoundingClientRect()
      if (r.width <= 1 || r.height <= 1) return null
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
    }
    const src = visibleRect(sourceSelector)
    if (!src) return []
    const hits = []
    for (const target of ['.hotbar', '.vehicle-action']) {
      const t = visibleRect(target)
      if (!t) continue
      const ix = Math.min(src.right, t.right) - Math.max(src.left, t.left)
      const iy = Math.min(src.bottom, t.bottom) - Math.max(src.top, t.top)
      if (ix > 2 && iy > 2) {
        hits.push({
          step: stepLabel,
          source: sourceSelector,
          target,
          overlapPx: { w: Math.round(ix), h: Math.round(iy) },
          sourceRect: { top: Math.round(src.top), bottom: Math.round(src.bottom) },
          targetRect: { top: Math.round(t.top), bottom: Math.round(t.bottom) },
        })
      }
    }
    return hits
  }, { sourceSelector, stepLabel })
}

export async function runVerify(opts) {
  const site = loadSiteConfig(opts.site)
  if (opts.dryRun) {
    return {
      ok: true,
      dryRun: true,
      opts,
      site,
      distPresent: existsSync(join(opts.dist, 'index.html')),
    }
  }

  mkdirSync(opts.out, { recursive: true })
  const req = createRequire(import.meta.url)
  const { chromium } = req(join(REPO_ROOT, 'node_modules/playwright'))

  let previewProc = null
  let baseUrl = opts.url
  if (!baseUrl) {
    if (!existsSync(join(opts.dist, 'index.html'))) {
      throw new Error(`Production dist missing: ${join(opts.dist, 'index.html')} (run npm run build first)`)
    }
    previewProc = spawn(
      'npx',
      ['--no-install', 'vite', 'preview', '--outDir', opts.dist, '--host', '127.0.0.1', '--port', String(opts.port), '--strictPort'],
      { cwd: REPO_ROOT, stdio: 'pipe' },
    )
    baseUrl = `http://127.0.0.1:${opts.port}`
    const up = await waitForHttp(baseUrl, 20000)
    if (!up) {
      previewProc.kill('SIGTERM')
      throw new Error(`Preview server failed to listen on ${baseUrl}`)
    }
  }

  let browserRef = null
  let context = null
  const errors = []
  const hudOverlaps = []
  try {
    browserRef = await connectOrLaunchBrowser(chromium, opts.useCdp)
    context = await browserRef.browser.newContext({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 2,
    })
    const page = await context.newPage()
    page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`)
    })
    await page.route('**/favicon.ico', r => r.fulfill({ status: 204 }))

    const targetUrl = `${baseUrl}/?verify=&solo=1&mode=walk&time=14.5&drinks=1&drinksSite=${encodeURIComponent(opts.site)}`
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await page.waitForFunction(
      () => Boolean(window.viewer?.walk?.active && window.viewer?.stats?.frame > 30),
      null,
      { timeout: 90000 },
    )

    // 0. 生产构建零作弊/调试接口审计（k68 联动）
    const rawProbeSnapshot = await page.evaluate(() => {
      const v = window.viewer
      const hasDrinksProp = Boolean(v && typeof v.drinks === 'object' && v.drinks !== null)
      return {
        hasDrinksProp,
        drinksKeys: hasDrinksProp ? Object.keys(v.drinks) : [],
        viewerKeys: v ? Object.keys(v) : [],
      }
    })
    const prodProbeAudit = {
      ...auditViewerForCheatApis(rawProbeSnapshot),
      enforce: !opts.allowDevProbe,
    }

    // 1. 走到王城蜜雪门前外摆广场，等待门店与叫号 HUD 懒加载完成
    const apronPt = shopLocalToWorld(site, 0.0, 6.2)
    await page.evaluate(async ({ x, z, yaw }) => {
      await window.viewer.walkTo(x, z, yaw, 'mixue-exterior')
    }, { x: apronPt.x, z: apronPt.z, yaw: site.worldYaw })
    await page.waitForFunction(
      () => {
        const hud = document.querySelector('.drinks-pickup-hud')
        return Boolean((hud && !hud.hasAttribute('hidden')) || window.viewer?.drinks)
      },
      null,
      { timeout: 30000 },
    )
    await page.waitForTimeout(1400)
    const exteriorShot = join(opts.out, '01-storefront-exterior.png')
    await page.screenshot({ path: exteriorShot })

    const beforeWalkIn = await page.evaluate(() => {
      const prefs = (() => {
        try { return JSON.parse(localStorage.getItem('glol.prefs') || '{}') } catch { return {} }
      })()
      const wPos = window.viewer.walk?.position
      const cPos = window.viewer.camera?.position
      const d = window.viewer.drinks
      const st = typeof d?.getState === 'function' ? d.getState() : null
      return {
        viewMode: prefs.view ?? 'third',
        apronWalkerY: wPos ? Math.round(wPos.y * 1000) / 1000 : null,
        apronCameraY: cPos ? Math.round(cPos.y * 1000) / 1000 : null,
        shopMetrics: st?.shopMetrics ?? null,
        siteId: st?.site?.id ?? null,
      }
    })

    // 2. 定位到门洞正外侧（local z=4.1），真实按住 KeyW 穿过 2.8m 门洞进入 1F 室内（杜绝 walkTo 射线落到 2F/3F 屋顶）
    const sillPt = shopLocalToWorld(site, 0.0, 4.1)
    await page.evaluate(async ({ x, z, yaw }) => {
      await window.viewer.walkTo(x, z, yaw, 'mixue-door-approach')
    }, { x: sillPt.x, z: sillPt.z, yaw: site.worldYaw })
    await page.waitForTimeout(500)

    await page.keyboard.down('KeyW')
    const walkStart = Date.now()
    while (Date.now() - walkStart < 3400) {
      await page.waitForTimeout(160)
      const entered = await page.evaluate(() => {
        if (document.body.dataset.drinksIndoor === '1') return true
        try {
          return JSON.parse(localStorage.getItem('glol.prefs') || '{}')?.view === 'first'
        } catch {
          return false
        }
      })
      if (entered) {
        await page.waitForTimeout(350)
        break
      }
    }
    await page.keyboard.up('KeyW')
    await page.waitForTimeout(500)

    const insideShot = join(opts.out, '02-doorway-auto-fp.png')
    await page.screenshot({ path: insideShot })

    const insideState = await page.evaluate(siteArg => {
      const prefs = (() => {
        try { return JSON.parse(localStorage.getItem('glol.prefs') || '{}') } catch { return {} }
      })()
      const wPos = window.viewer.walk?.position
      const cPos = window.viewer.camera?.position
      const indoorFlag = document.body.dataset.drinksIndoor === '1'
      const enteredFirstPerson = indoorFlag || prefs.view === 'first'
      let localPos = null
      if (wPos) {
        const dx = wPos.x - siteArg.worldX
        const dz = wPos.z - siteArg.worldZ
        const c = Math.cos(siteArg.worldYaw)
        const s = Math.sin(siteArg.worldYaw)
        localPos = {
          x: Math.round((dx * c - dz * s) * 100) / 100,
          z: Math.round((dx * s + dz * c) * 100) / 100,
        }
      }
      return {
        enteredFirstPerson,
        indoorFlag,
        rawViewMode: prefs.view ?? null,
        insideWalkerY: wPos ? Math.round(wPos.y * 1000) / 1000 : null,
        insideCameraY: cPos ? Math.round(cPos.y * 1000) / 1000 : null,
        localPos,
      }
    }, site)

    const refGroundY = beforeWalkIn.apronWalkerY ?? site.fallbackGroundY
    const camDeltaY = insideState.insideCameraY !== null
      ? Math.round((insideState.insideCameraY - refGroundY) * 1000) / 1000
      : null
    const walkerDeltaY = insideState.insideWalkerY !== null
      ? Math.round((insideState.insideWalkerY - refGroundY) * 1000) / 1000
      : null
    const onRoof = (camDeltaY !== null && camDeltaY > 3.2) || (walkerDeltaY !== null && Math.abs(walkerDeltaY) > 1.8)

    // 真实按住 KeyS 退出门洞，核验视角自动恢复原视角（third）
    await page.keyboard.down('KeyS')
    const exitStart = Date.now()
    while (Date.now() - exitStart < 3400) {
      await page.waitForTimeout(160)
      const exited = await page.evaluate(() => {
        const prefs = (() => {
          try { return JSON.parse(localStorage.getItem('glol.prefs') || '{}') } catch { return {} }
        })()
        return document.body.dataset.drinksIndoor !== '1' && prefs.view !== 'first'
      })
      if (exited) break
    }
    await page.keyboard.up('KeyS')
    await page.waitForTimeout(400)
    const restoredOnExit = await page.evaluate(() => {
      const prefs = (() => {
        try { return JSON.parse(localStorage.getItem('glol.prefs') || '{}') } catch { return {} }
      })()
      return document.body.dataset.drinksIndoor !== '1' && (prefs.view ?? 'third') === 'third'
    })

    const autoFirstPerson = {
      ...insideState,
      refGroundY,
      camDeltaY,
      walkerDeltaY,
      onRoof,
      restoredOnExit,
    }

    // 3. 走到门口左侧蜜雪招聘立牌，真实检查可见性与按 E/点击入职互动
    const recruitPt = shopLocalToWorld(site, -1.42, 4.95)
    await page.evaluate(async ({ x, z, yaw }) => {
      await window.viewer.walkTo(x, z, yaw, 'mixue-recruit-sign')
    }, { x: recruitPt.x, z: recruitPt.z, yaw: site.worldYaw })
    await page.waitForTimeout(700)

    const beforeRecruit = await page.evaluate(() => {
      const hud = document.querySelector('.drinks-staff-hud')
      const cta = document.querySelector('[data-staff-cta]')
      const visible = Boolean(hud && !hud.hasAttribute('hidden') && hud.getBoundingClientRect().width > 0)
      return {
        visible,
        ctaText: cta?.textContent?.trim() ?? '',
      }
    })
    hudOverlaps.push(...await measureHudOverlaps(page, '.drinks-staff-hud', 'recruit-sign'))

    if (beforeRecruit.visible) {
      await page.keyboard.press('KeyE')
      await page.waitForTimeout(450)
      const stillPreHire = await page.evaluate(() => {
        const resign = document.querySelector('[data-staff-resign]')
        return !resign || resign.hasAttribute('hidden')
      })
      if (stillPreHire) {
        await page.locator('[data-staff-cta]').click({ timeout: 3000 }).catch(() => {})
        await page.waitForTimeout(450)
      }
    }

    const afterRecruit = await page.evaluate(() => {
      const resign = document.querySelector('[data-staff-resign]')
      const count = document.querySelector('[data-staff-count]')
      const cta = document.querySelector('[data-staff-cta]')
      const onDuty = Boolean(resign && !resign.hasAttribute('hidden'))
      return {
        onDuty,
        countText: count?.textContent?.trim() ?? '',
        ctaTextAfter: cta?.textContent?.trim() ?? '',
      }
    })
    const recruitShot = join(opts.out, '03-recruit-sign-interact.png')
    await page.screenshot({ path: recruitShot })

    const recruitSign = {
      visible: beforeRecruit.visible,
      ctaBefore: beforeRecruit.ctaText,
      ctaAfter: afterRecruit.ctaTextAfter,
      interactive: Boolean(beforeRecruit.visible && (afterRecruit.onDuty || afterRecruit.ctaTextAfter !== beforeRecruit.ctaText)),
      onDutyAfter: afterRecruit.onDuty,
    }

    // 测完招聘/员工态后主动下班，避免员工 HUD 遮挡第 4 步手捧饮品验收图
    if (afterRecruit.onDuty) {
      await page.locator('[data-staff-resign]').click({ timeout: 3000 }).catch(() => {})
      await page.waitForTimeout(500)
    }

    // 4. 真实点单 -> 实时等待出杯 -> 点击取杯 -> 真实长按 KeyI 验证能量条平滑走动与松手即停
    const orderPt = shopLocalToWorld(site, 0.2, 4.5)
    await page.evaluate(async ({ x, z, yaw }) => {
      await window.viewer.walkTo(x, z, yaw, 'mixue-order')
    }, { x: orderPt.x, z: orderPt.z, yaw: site.worldYaw })
    await page.waitForTimeout(600)

    const alreadyHolding = await page.evaluate(() => {
      const h = document.querySelector('.drinks-hold-hud')
      return Boolean(h && !h.hasAttribute('hidden'))
    })
    if (!alreadyHolding) {
      await page.locator('[data-drinks-action="open-order"]').click({ timeout: 8000 })
      await page.waitForSelector('.drinks-order-panel:not([hidden])', { timeout: 5000 })
      const lemonBtn = page.locator('[data-drink-id="ice_lemon_water"]').first()
      if (await lemonBtn.count()) await lemonBtn.click().catch(() => {})
      await page.locator('[data-drinks-action="pay"]').click({ timeout: 5000 })
      await page.waitForTimeout(300)
      await page.locator('[data-drinks-action="close"]').first().click({ timeout: 5000 }).catch(() => {})
      // 等待冰鲜柠檬水实时制作完成（~2.2s）并点击「取杯」
      await page.waitForSelector('[data-drinks-collect]', { timeout: 25000 })
      await page.locator('[data-drinks-collect]').first().click({ timeout: 5000 })
    }
    await page.waitForSelector('.drinks-hold-hud:not([hidden])', { timeout: 8000 })
    await page.waitForTimeout(300)
    hudOverlaps.push(...await measureHudOverlaps(page, '.drinks-hold-hud', 'hold-drink'))

    const readHoldDom = () => page.evaluate(() => {
      const meter = document.querySelector('[data-drinks-hold-meter], .drinks-hold-meter')
      const fill = document.querySelector('[data-drinks-hold-fill], .drinks-hold-meter-fill')
      const hud = document.querySelector('.drinks-hold-hud')
      const pctText = document.querySelector('[data-drinks-hold-sips]')?.textContent?.trim() ?? null
      const ariaVal = meter instanceof HTMLElement ? meter.getAttribute('aria-valuenow') : null
      const numericPct = ariaVal !== null ? Number(ariaVal) : null
      const fillVisual = fill instanceof HTMLElement
        ? (fill.style.transform || fill.style.width || String(Math.round(fill.getBoundingClientRect().width)))
        : null
      return {
        fill: Number.isFinite(numericPct) ? numericPct / 100 : null,
        barVal: ariaVal ?? pctText,
        fillVisual,
        isDrinking: Boolean(hud?.classList.contains('is-drinking')),
      }
    })

    const before = await readHoldDom()
    await page.keyboard.down('KeyI')
    await page.waitForTimeout(Math.round(opts.holdMs / 2))
    let mid = await readHoldDom()
    let usedPointerHold = false
    if (!mid.isDrinking && before.fill !== null && mid.fill === before.fill) {
      // 若焦点导致键盘未触发，回退真实指针按住「按住喝」按钮
      await page.keyboard.up('KeyI')
      const sipBtn = page.locator('[data-drinks-action="sip"]').first()
      const box = await sipBtn.boundingBox()
      if (box) {
        usedPointerHold = true
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
        await page.mouse.down()
        await page.waitForTimeout(Math.round(opts.holdMs / 2))
        mid = await readHoldDom()
      }
    }
    await page.waitForTimeout(Math.round(opts.holdMs / 2))
    const after = await readHoldDom()
    const holdShot = join(opts.out, '04-hold-energy-bar.png')
    await page.screenshot({ path: holdShot })

    if (usedPointerHold) {
      await page.mouse.up()
    } else {
      await page.keyboard.up('KeyI')
    }
    await page.waitForTimeout(400)
    const afterRelease = await readHoldDom()

    const energyBarMoved =
      (before.barVal !== null && after.barVal !== null && before.barVal !== after.barVal) ||
      (before.fillVisual !== null && after.fillVisual !== null && before.fillVisual !== after.fillVisual)
    const stoppedAfterRelease =
      typeof after.fill === 'number' && typeof afterRelease.fill === 'number'
        ? Math.abs(after.fill - afterRelease.fill) <= 0.02
        : true

    const holdEnergy = {
      beforeFill: before.fill,
      midFill: mid.fill,
      afterFill: after.fill,
      afterReleaseFill: afterRelease.fill,
      beforeBar: before.barVal,
      afterBar: after.barVal,
      usedPointerHold,
      energyBarMoved,
      stoppedAfterRelease,
    }

    const metrics = {
      timestamp: new Date().toISOString(),
      targetUrl,
      site,
      prodProbeAudit,
      beforeWalkIn,
      shopDrawCalls: beforeWalkIn.shopMetrics?.meshes ?? beforeWalkIn.shopMetrics?.drawCalls ?? null,
      autoFirstPerson,
      recruitSign,
      holdEnergy,
      hudOverlaps,
      screenshots: [exteriorShot, insideShot, recruitShot, holdShot],
      errors,
    }
    const verdict = evaluatePhase2Checks(metrics)
    const report = { ...verdict, metrics }
    writeFileSync(join(opts.out, 'report.json'), JSON.stringify(report, null, 2) + '\n')
    return report
  } finally {
    if (context) await context.close().catch(() => {})
    if (browserRef?.owned && browserRef.browser) {
      await browserRef.browser.close().catch(() => {})
    }
    if (previewProc) {
      previewProc.kill('SIGTERM')
      setTimeout(() => { try { previewProc.kill('SIGKILL') } catch {} }, 1500).unref()
    }
  }
}

const isEntry = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isEntry) {
  const opts = parseVerifyArgs(process.argv.slice(2))
  runVerify(opts)
    .then(res => {
      console.log(JSON.stringify(res, null, 2))
      if (!res.ok) process.exit(1)
    })
    .catch(err => {
      console.error(err?.stack || String(err))
      process.exit(1)
    })
}
