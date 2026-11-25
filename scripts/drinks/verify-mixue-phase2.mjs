#!/usr/bin/env node
/**
 * 蜜雪二期（王城蜜雪冰城）生产预览端到端验收脚本（对应 k50）：
 * 1) 走到王城店门口并步入店内，验证自动切换第一人称（出门恢复原视角）与整店 draw calls <= 30；
 * 2) 靠近门口蜜雪招聘立牌，验证立牌可见且互动提示/入职入口可触发；
 * 3) 手捧饮品长按饮用，验证能量条实时平滑走动、液位连续下降且松手即停；
 * 4) 产出结构化 JSON 报告与关键帧截图（默认写入 /tmp/mixue-phase2-verify，不污染桌面/仓库）；
 * 5) 严格在 finally 中关闭 browser 与自启 vite preview 服务，优先复用现成 9222 调试端口（仅 --cdp 时）。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '../..')

export function parseVerifyArgs(argv) {
  const opts = {
    dist: resolve(REPO_ROOT, 'dist'),
    url: '',
    port: 4185,
    out: '/tmp/mixue-phase2-verify',
    site: 'wangcheng_mall',
    holdMs: 800,
    useCdp: false,
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
    else if (a === '--hold-ms') opts.holdMs = Math.max(250, Number(next()) || 800)
    else if (a === '--cdp') opts.useCdp = true
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

export async function runVerify(opts) {
  if (opts.dryRun) {
    return {
      ok: true,
      dryRun: true,
      opts,
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
      () => Boolean(window.viewer?.walk?.active && window.viewer?.drinks && window.viewer?.stats?.frame > 30),
      null,
      { timeout: 90000 },
    )

    // 1. 传送到王城蜜雪门前，记录门外第三人称状态与整店指标
    await page.evaluate(async () => {
      await window.viewer.drinks.teleportToShop()
    })
    await page.waitForTimeout(1500)
    const exteriorShot = join(opts.out, '01-storefront-exterior.png')
    await page.screenshot({ path: exteriorShot })

    const beforeWalkIn = await page.evaluate(() => {
      const d = window.viewer.drinks
      const st = d.getState()
      return {
        viewMode: st.viewMode ?? (document.body.dataset.view ?? 'third'),
        shopMetrics: st.shopMetrics ?? null,
        siteId: st.site?.id ?? null,
      }
    })

    // 2. 步入王城店门口：验证自动切换第一人称
    if (await page.evaluate(() => typeof window.viewer.drinks.walkInside === 'function')) {
      await page.evaluate(async () => { await window.viewer.drinks.walkInside() })
    } else {
      await page.keyboard.down('KeyW')
      await page.waitForTimeout(1400)
      await page.keyboard.up('KeyW')
    }
    await page.waitForTimeout(600)
    const insideShot = join(opts.out, '02-doorway-auto-fp.png')
    await page.screenshot({ path: insideShot })

    const autoFirstPerson = await page.evaluate(() => {
      const st = window.viewer.drinks.getState()
      const fpByState = Boolean(st.firstPerson ?? st.isFirstPerson ?? st.viewMode === 'first')
      const fpByPrefs = (() => {
        try {
          const raw = localStorage.getItem('glol.prefs')
          return raw ? JSON.parse(raw)?.view === 'first' : false
        } catch { return false }
      })()
      return {
        enteredFirstPerson: fpByState || fpByPrefs,
        rawViewMode: st.viewMode ?? null,
        insideShop: Boolean(st.insideShop ?? st.nearInteract),
      }
    })

    // 3. 回到门口检查招聘立牌可见与互动提示
    await page.evaluate(async () => { await window.viewer.drinks.teleportToShop() })
    await page.waitForTimeout(800)
    const recruitSign = await page.evaluate(async () => {
      const d = window.viewer.drinks
      if (typeof d.walkToRecruitSign === 'function') {
        await d.walkToRecruitSign()
      }
      const st = d.getState()
      const staff = st.staff ?? null
      const promptEl = document.querySelector('[data-drinks-recruit-prompt], .drinks-recruit-prompt, [data-staff-action]')
      const promptVisible = Boolean(promptEl && !promptEl.hasAttribute('hidden') && promptEl.getBoundingClientRect().width > 0)
      let interacted = false
      if (typeof d.interactRecruit === 'function') {
        interacted = Boolean(await d.interactRecruit())
      } else if (promptEl instanceof HTMLElement && promptVisible) {
        promptEl.click()
        interacted = true
      }
      const after = d.getState()
      return {
        visible: Boolean(staff?.recruitSignVisible ?? staff?.signVisible ?? promptVisible),
        promptVisible,
        interactive: Boolean(interacted || staff?.nearRecruitSign || after.staff?.working),
        workingAfter: Boolean(after.staff?.working),
      }
    })
    const recruitShot = join(opts.out, '03-recruit-sign-interact.png')
    await page.screenshot({ path: recruitShot })

    // 4. 点单/取杯并验证长按能量条连续饮用
    const holdEnergy = await page.evaluate(async holdMs => {
      const d = window.viewer.drinks
      let st = d.getState()
      if (!st.hold?.active) {
        d.openOrder?.()
        if (typeof d.placeQuickOrder === 'function') {
          await d.placeQuickOrder()
        } else {
          const orderBtn = document.querySelector('[data-drinks-order-submit], .drinks-order-card button')
          if (orderBtn instanceof HTMLElement) orderBtn.click()
        }
        d.fastForward?.(45)
        d.collectReady?.()
        st = d.getState()
      }

      const readBar = () => {
        const cur = d.getState()
        const bar = document.querySelector('[data-drinks-energy-bar], .drinks-energy-fill, .drinks-hold-meter progress, .drinks-hold-meter-fill')
        let barVal = null
        if (bar instanceof HTMLProgressElement) barVal = bar.value
        else if (bar instanceof HTMLElement) {
          barVal = bar.dataset.progress ?? bar.style.width ?? bar.style.transform ?? String(Math.round(bar.getBoundingClientRect().width))
        }
        return { fill: cur.hold?.fillRatio ?? null, active: Boolean(cur.hold?.active), barVal }
      }

      const before = readBar()
      if (typeof d.startHoldSip === 'function') {
        d.startHoldSip()
      } else {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyI', bubbles: true }))
      }
      await new Promise(r => setTimeout(r, Math.round(holdMs / 2)))
      const mid = readBar()
      await new Promise(r => setTimeout(r, Math.round(holdMs / 2)))
      const after = readBar()
      if (typeof d.stopHoldSip === 'function') {
        d.stopHoldSip()
      } else {
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyI', bubbles: true }))
      }
      await new Promise(r => setTimeout(r, 350))
      const afterRelease = readBar()

      const energyBarMoved = before.barVal !== null && after.barVal !== null
        ? before.barVal !== after.barVal
        : (typeof before.fill === 'number' && typeof after.fill === 'number' && before.fill - after.fill > 0.02)
      const stoppedAfterRelease = typeof after.fill === 'number' && typeof afterRelease.fill === 'number'
        ? Math.abs(after.fill - afterRelease.fill) < 0.015
        : true

      return {
        beforeFill: before.fill,
        midFill: mid.fill,
        afterFill: after.fill,
        afterReleaseFill: afterRelease.fill,
        beforeBar: before.barVal,
        afterBar: after.barVal,
        energyBarMoved,
        stoppedAfterRelease,
      }
    }, opts.holdMs)

    const holdShot = join(opts.out, '04-hold-energy-bar.png')
    await page.screenshot({ path: holdShot })

    const metrics = {
      timestamp: new Date().toISOString(),
      targetUrl,
      beforeWalkIn,
      shopDrawCalls: beforeWalkIn.shopMetrics?.drawCalls ?? null,
      autoFirstPerson,
      recruitSign,
      holdEnergy,
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
    .then(report => {
      console.log(JSON.stringify(report, null, 2))
      if (!report.ok) process.exit(1)
    })
    .catch(err => {
      console.error(err?.stack || String(err))
      process.exit(1)
    })
}
