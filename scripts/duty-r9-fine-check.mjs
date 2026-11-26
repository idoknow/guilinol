import assert from 'node:assert/strict'
import {mkdir, mkdtemp, rm, stat} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {build} from 'esbuild'
import {chromium} from 'playwright'
import {browserOptions} from './qa-browser.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const SHOT_DIR = resolve(ROOT, 'captures/duty-r9-fines')
const BASE_ORIGIN = process.env.DUTY_ORIGIN || 'http://127.0.0.1:5176'
const WALK_URL = `${BASE_ORIGIN}/?mode=walk`
const VERIFY_URL = `${BASE_ORIGIN}/?verify&mode=walk`
const CDP_ENDPOINT = process.env.CDP_URL || 'http://127.0.0.1:9222'
const NORMAL_50_VIOLATIONS = new Set(['no_helmet', 'bike_double', 'wrong_way'])

async function loadJiefangBridgeSpec() {
  const bundleDir = await mkdtemp(join(tmpdir(), 'glol-duty-r9-fine-check-'))
  const bundleFile = join(bundleDir, 'railings-spec.mjs')
  await build({
    stdin: {
      contents: `
        export {
          JIEFANG_BRIDGE_ORIGIN,
          JIEFANG_BRIDGE_ROTATION_Y,
          JIEFANG_CROSS_SECTION,
        } from './web/src/traffic-duty/jiefang-railings.ts'
      `,
      resolveDir: ROOT,
      loader: 'ts',
    },
    outfile: bundleFile,
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    mainFields: ['module', 'main'],
    logLevel: 'silent',
  })
  const mod = await import(pathToFileURL(bundleFile).href)
  return {
    bundleDir,
    spec: {
      origin: [...mod.JIEFANG_BRIDGE_ORIGIN],
      rotationY: mod.JIEFANG_BRIDGE_ROTATION_Y,
      crossSection: mod.JIEFANG_CROSS_SECTION,
    },
  }
}

function installDeckHelperOnPage(bridgeSpec) {
  const [OX, OY, OZ] = bridgeSpec.origin
  const ROT = bridgeSpec.rotationY
  const C = Math.cos(ROT)
  const S = Math.sin(ROT)
  function deckLocalY(lx) {
    const original = 5.62 - (lx * 1.3) / 281
    if (lx < 16) return original + 0.05
    const inner = 134.6286
    const head = 151.2322 - 145.6
    const dist = Math.max(0, inner - lx)
    if (lx >= 111) {
      return head + 0.05 * (dist < 2 ? (dist * dist) / 4 : dist - 1) + 0.05
    }
    const start = 16
    const end = 111
    const len = end - start
    const f = Math.max(0, Math.min(1, (lx - start) / len))
    const left = 5.62 - (start * 1.3) / 281
    const right = head + 0.05 * (inner - end - 1)
    return (
      left +
      (right - left) * (3 - 2 * f) * f * f -
      len * f * (1 - f) * ((1 - f) * (1.3 / 281) - f * 0.05) +
      0.05
    )
  }
  window.__jiefangLocalToWorld = (lx, lz) => [OX + lx * C + lz * S, OZ - lx * S + lz * C]
  window.__worldToJiefangLocal = (wx, wz) => {
    const dx = wx - OX
    const dz = wz - OZ
    return [dx * C - dz * S, dx * S + dz * C]
  }
  window.__isOnJiefangBridgeDeck = a => {
    if (!a || !Number.isFinite(a.x) || !Number.isFinite(a.z) || !Number.isFinite(a.y)) return false
    const [lx, lz] = window.__worldToJiefangLocal(a.x, a.z)
    if (lx < bridgeSpec.crossSection.minX || lx > bridgeSpec.crossSection.maxX) return false
    if (lz < bridgeSpec.crossSection.minZ || lz > bridgeSpec.crossSection.maxZ) return false
    const deckY = OY + deckLocalY(lx)
    return a.y >= deckY - 1.1 && a.y <= deckY + 4.5
  }
  window.__placeAlongBridgeFacingTarget = (target, alongDistM, fallbackY, lateralOffsetM = 0, sideSign = 1) => {
    if (!target) return null
    const [lx, lz] = window.__worldToJiefangLocal(target.x, target.z)
    const dirX = lx > 0 ? -1 : 1
    const latSign = (lz >= 0 ? 1 : -1) * (sideSign >= 0 ? 1 : -1)
    const pxLx = Math.max(-138, Math.min(138, lx + dirX * alongDistM))
    const rawLz = lz + latSign * lateralOffsetM
    const pxLz = lz >= 0 ? Math.min(15.85, Math.max(12.45, rawLz)) : Math.max(-15.85, Math.min(-12.45, rawLz))
    const [px, pz] = window.__jiefangLocalToWorld(pxLx, pxLz)
    const py = Number.isFinite(fallbackY) ? fallbackY : target.y
    window.viewer.walk.clampPosition({x: px, y: py, z: pz})
    window.viewer.walk.face(Math.atan2(-(target.x - px), -(target.z - pz)), 0.06)
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    return {px, pz, dist: +Math.hypot(target.x - px, target.z - pz).toFixed(3)}
  }
}

async function verifyServerFreshness() {
  const htmlRes = await fetch(WALK_URL)
  assert.equal(htmlRes.status, 200, `GET ${WALK_URL} expected HTTP 200, got ${htmlRes.status}`)
  const html = await htmlRes.text()
  const queue = [...new Set([...html.matchAll(/assets\/([a-zA-Z0-9_-]+\.js)/g)].map(m => m[1]))]
  assert.ok(queue.length > 0, `no built JS chunks referenced in ${WALK_URL}`)
  const visited = new Set()
  let foundR9Markers = false
  let checkedChunk = null
  while (queue.length > 0 && visited.size < 24) {
    const name = queue.shift()
    if (!name || visited.has(name)) continue
    visited.add(name)
    const jsRes = await fetch(`${BASE_ORIGIN}/assets/${name}`)
    if (!jsRes.ok) continue
    const js = await jsRes.text()
    if (js.includes('数罪并罚') && js.includes('openOffDuty')) {
      foundR9Markers = true
      checkedChunk = name
      break
    }
    for (const m of js.matchAll(/(?:assets\/|\.\/)([a-zA-Z0-9_-]+\.js)/g)) {
      if (!visited.has(m[1])) queue.push(m[1])
    }
  }
  assert.ok(
    foundR9Markers,
    `${BASE_ORIGIN} is serving a stale bundle (missing r8/r9 数罪并罚 + openOffDuty across ${visited.size} chunks)`,
  )
  console.log(`[PASS] PREFLIGHT ${WALK_URL} HTTP 200 (fresh bundle: assets/${checkedChunk})`)
}

async function acquireBrowser() {
  try {
    const browser = await chromium.connectOverCDP(CDP_ENDPOINT, {timeout: 1500})
    return {browser, ownsBrowser: false, mode: `cdp(${CDP_ENDPOINT})`}
  } catch {
    const browser = await chromium.launch(browserOptions())
    return {browser, ownsBrowser: true, mode: 'launch(chromium)'}
  }
}

async function dismissCoachIfShown(page, waitMs = 3500) {
  try {
    await page.waitForSelector('.coach.in .coach-skip', {timeout: waitMs})
    await page.evaluate(() => {
      const btn = document.querySelector('.coach.in .coach-skip')
      if (btn instanceof HTMLElement) btn.click()
    })
    await page.waitForFunction(() => !document.querySelector('.coach'), null, {timeout: 3000}).catch(() => {})
    await page.waitForTimeout(200)
    return true
  } catch {
    return false
  }
}

async function capture(page, fileName) {
  const fullPath = resolve(SHOT_DIR, fileName)
  await page.screenshot({path: fullPath, fullPage: false})
  const info = await stat(fullPath)
  assert.ok(info.size > 4096, `screenshot ${fileName} unexpectedly small (${info.size} bytes)`)
  return {rel: `captures/duty-r9-fines/${fileName}`, fullPath, bytes: info.size}
}

async function run() {
  await mkdir(SHOT_DIR, {recursive: true})
  await verifyServerFreshness()

  const {bundleDir, spec: bridgeSpec} = await loadJiefangBridgeSpec()
  const {browser, ownsBrowser, mode} = await acquireBrowser()
  let context = null
  const ERRS = []
  const shots = {}

  const attachErrorListeners = (page, tag) => {
    page.on('pageerror', err => ERRS.push(`[${tag}] pageerror: ${err.message}`))
    page.on('console', msg => {
      if (msg.type() === 'error') ERRS.push(`[${tag}] console.error: ${msg.text()}`)
    })
  }

  try {
    console.log(`[INFO] browser=${mode} origin=${BASE_ORIGIN}`)
    context = await browser.newContext({viewport: {width: 1280, height: 800}})

    // Full real-key fine & settlement flow (?verify&mode=walk)
    const page = await context.newPage()
    attachErrorListeners(page, 'verify&mode=walk')
    await page.goto(VERIFY_URL, {waitUntil: 'domcontentloaded', timeout: 60000})
    await page.waitForFunction(
      () =>
        document.body.dataset.mode === 'walk' &&
        !document.querySelector('#boot, .ld-veil, .about-mask:not([hidden]), dialog[open]') &&
        Boolean(document.querySelector('.td-entry:not([hidden])')) &&
        Boolean(window.viewer?.walk?.active) &&
        Boolean(window.viewer?.trafficDuty) &&
        Boolean(window.viewer?.dutyTraffic),
      null,
      {timeout: 120000},
    )
    await page.waitForTimeout(500)
    await page.evaluate(() => document.querySelector('.spot-card.show .card-close')?.click?.())
    await dismissCoachIfShown(page, 3500)
    await page.evaluate(installDeckHelperOnPage, bridgeSpec)

    const readWallet = () =>
      page.evaluate(() => {
        let savedMoney = null
        try {
          savedMoney = JSON.parse(localStorage.getItem('glol.save.v1') || 'null')?.money ?? null
        } catch {
          savedMoney = null
        }
        return {
          stateMoney: window.viewer?.game?.getState?.()?.money ?? null,
          savedMoney,
        }
      })

    const walletBefore = await readWallet()
    assert.equal(typeof walletBefore.stateMoney, 'number', 'initial game state wallet money must be numeric')
    console.log(`[INFO] WALLET_BEFORE=${JSON.stringify(walletBefore)}`)

    // Step A: Enter auxiliary police via UI (.td-entry -> go-bridge) -> press KeyF -> finish officer briefing
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
    await page.locator('.td-entry').click({timeout: 15000})
    const goBridgeBtn = page.locator('dialog.td-panel[open] [data-td-action="go-bridge"]')
    await goBridgeBtn.waitFor({state: 'visible', timeout: 15000})
    await goBridgeBtn.click({timeout: 15000})
    console.log('[INFO] clicked go-bridge, waiting for teleport & Jiefang chunk stream...')
    await page.waitForFunction(
      () => {
        const snap = window.viewer?.trafficDuty?.getSnapshot?.()
        return (
          Boolean(snap && snap.officerDistanceM !== null && snap.officerDistanceM <= 5.5) &&
          !document.querySelector('dialog.td-panel[open]') &&
          !document.querySelector('.ld-veil')
        )
      },
      null,
      {timeout: 90000},
    )
    await page.waitForTimeout(500)
    await page.keyboard.press('KeyF')
    await page.waitForSelector('.td-story-dialog:not([hidden])', {timeout: 15000})

    for (let i = 0; i < 18; i++) {
      const activeNow = await page.evaluate(() => {
        const snap = window.viewer?.trafficDuty?.getSnapshot?.()
        const dlg = document.querySelector('.td-story-dialog')
        const dlgOpen = Boolean(dlg && !dlg.hasAttribute('hidden') && getComputedStyle(dlg).display !== 'none')
        return snap?.phase === 'active' && !dlgOpen
      })
      if (activeNow) break
      const acceptChoice = page.locator(
        '.td-story-dialog:not([hidden]) .td-story-choice[data-td-story-choice="ready_now"], .td-story-dialog:not([hidden]) .td-story-choice[data-td-story-choice="repeat_accept"]',
      )
      if ((await acceptChoice.count()) > 0 && (await acceptChoice.first().isVisible())) {
        await acceptChoice.first().click()
      } else {
        const anyChoice = page.locator('.td-story-dialog:not([hidden]) .td-story-choice')
        const nextBtn = page.locator('.td-story-dialog:not([hidden]) [data-td-story-action="next"]')
        if ((await anyChoice.count()) > 0 && (await anyChoice.first().isVisible())) {
          await anyChoice.first().click()
        } else if ((await nextBtn.count()) > 0 && (await nextBtn.first().isVisible())) {
          await nextBtn.first().click()
        }
      }
      await page.waitForTimeout(200)
    }
    await page.waitForFunction(
      () => window.viewer?.trafficDuty?.getSnapshot?.()?.phase === 'active' && Boolean(document.querySelector('.td-bar:not([hidden])')),
      null,
      {timeout: 12000},
    )
    const hudStart = await page.evaluate(() => document.querySelector('.td-bar')?.textContent?.replace(/\s+/g, ' ').trim() ?? '')
    console.log(`[PASS] ON_DUTY active, HUD="${hudStart}"`)

    // Helper: pull over target actor with real short KeyE
    const pullOverTargetViaKeyE = async targetGlobalName => {
      for (let attempt = 0; attempt < 3; attempt++) {
        await page.evaluate(
          name =>
            new Promise(done =>
              requestAnimationFrame(() => {
                const t = window[name]
                if (t) window.__placeAlongBridgeFacingTarget(t, 2.6, t.y, 0.72)
                done(true)
              }),
            ),
          targetGlobalName,
        )
        await page.keyboard.down('KeyE')
        await page.waitForTimeout(110)
        await page.keyboard.up('KeyE')
        for (let s = 0; s < 35; s++) {
          const st = await page.evaluate(name => {
            const t = window[name]
            const p = window.viewer.walk?.position
            if (t && t.dutyState === 'pulling_over') {
              for (let i = 0; i < 4; i++) window.viewer.dutyTraffic?.step?.(0.1, p)
              window.viewer.trafficDuty?.step?.(0.1)
            }
            return {
              speed: t?.speed ?? 99,
              dutyState: t?.dutyState ?? null,
              haltedByDuty: Boolean(t?.haltedByDuty),
            }
          }, targetGlobalName)
          if (st.speed <= 0.15 && (st.dutyState === 'pulled_over' || st.dutyState === 'halted' || st.haltedByDuty)) {
            return st
          }
          if (s >= 2 && st.dutyState !== 'pulling_over' && st.dutyState !== 'pulled_over' && st.dutyState !== 'halted') {
            break
          }
          await page.waitForTimeout(140)
        }
      }
      throw new Error(`pullOverTargetViaKeyE(${targetGlobalName}) failed`)
    }

    // Helper: real keyboard walk (ShiftLeft + KeyW) along bridge, hopping low curb/railing with Space if blocked
    const walkWithKeysTo = async (targetX, targetZ, stopDistM = 2.2, maxMs = 45000) => {
      const startMs = Date.now()
      let stuckSteps = 0
      let prevDist = Infinity
      await page.keyboard.down('ShiftLeft')
      await page.keyboard.down('KeyW')
      try {
        while (Date.now() - startMs < maxMs) {
          const dist = await page.evaluate(
            ({tx, tz, stop}) => {
              const w = window.viewer.walk
              for (let s = 0; s < 16; s++) {
                const p = w.position
                const dx = tx - p.x
                const dz = tz - p.z
                const d = Math.hypot(dx, dz)
                if (d <= stop) return d
                w.face(Math.atan2(-dx, -dz), 0.1)
                w.tick(1 / 60)
              }
              const p2 = w.position
              return Math.hypot(tx - p2.x, tz - p2.z)
            },
            {tx: targetX, tz: targetZ, stop: stopDistM},
          )
          if (dist <= stopDistM) return dist
          if (prevDist - dist < 0.08) {
            stuckSteps++
            if (stuckSteps >= 2) {
              await page.keyboard.press('Space')
              stuckSteps = 0
            }
          } else {
            stuckSteps = 0
          }
          prevDist = dist
          await page.waitForTimeout(40)
        }
      } finally {
        await page.keyboard.up('KeyW')
        await page.keyboard.up('ShiftLeft')
      }
      return page.evaluate(
        ({tx, tz}) => Math.hypot(tx - window.viewer.walk.position.x, tz - window.viewer.walk.position.z),
        {tx: targetX, tz: targetZ},
      )
    }

    // Helper: open fine terminal via KeyF, verify amount/DOM, capture shot, Enter->print->tear->deliver via KeyF
    const issueAndDeliverFine = async ({targetGlobalName, expectedYuan, requireStackedCopy, shotFileName, expectedCitedAfter}) => {
      await pullOverTargetViaKeyE(targetGlobalName)
      await page.evaluate(name => {
        const t = window[name]
        window.__placeAlongBridgeFacingTarget(t, 2.05, t?.y, 0.72)
      }, targetGlobalName)
      await page.waitForFunction(
        () => window.viewer?.trafficDuty?.getInteractCandidate?.()?.action === 'whistle_cite',
        null,
        {timeout: 8000},
      )
      await page.keyboard.press('KeyF')
      await page.waitForSelector('.td-fine-terminal', {timeout: 8000})
      await page.waitForTimeout(320)

      const termInfo = await page.evaluate(() => {
        const ft = window.viewer.getActiveFineTerminalSession?.()?.getSnapshot?.() ?? null
        const domText = document.querySelector('.td-fine-terminal')?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
        return {
          fineYuan: ft?.fineYuan ?? null,
          violation: ft?.violation ?? null,
          violations: ft?.violations ?? null,
          lineItems: ft?.lineItems ?? null,
          domText,
        }
      })
      assert.equal(termInfo.fineYuan, expectedYuan, `expected fine terminal fineYuan=${expectedYuan}, got ${JSON.stringify(termInfo)}`)
      assert.ok(
        new RegExp(`¥\\s*${expectedYuan}|${expectedYuan}\\s*元|${expectedYuan}`).test(termInfo.domText),
        `fine terminal DOM must show ¥${expectedYuan}, got "${termInfo.domText}"`,
      )
      if (requireStackedCopy) {
        assert.ok(termInfo.domText.includes('数罪并罚'), `stacked fine terminal DOM must show 数罪并罚, got "${termInfo.domText}"`)
        assert.ok(
          termInfo.domText.includes('20') && termInfo.domText.includes('50') && termInfo.domText.includes('70'),
          `stacked fine terminal DOM must list 20 + 50 = 70, got "${termInfo.domText}"`,
        )
      }

      const shot = await capture(page, shotFileName)

      // Confirm print via Enter
      await page.evaluate(() => {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
      })
      await page.keyboard.press('Enter')
      await page.waitForFunction(
        () => {
          const ft = window.viewer.getActiveFineTerminalSession?.()?.getSnapshot?.()
          const primary = document.querySelector('.td-ft-btn-primary')
          return ft?.phase === 'deliver' || Boolean(primary?.textContent?.includes('撕下'))
        },
        null,
        {timeout: 30000},
      )
      const needManualTear = await page.evaluate(
        () => window.viewer.getActiveFineTerminalSession?.()?.getSnapshot?.()?.phase !== 'deliver',
      )
      if (needManualTear) {
        await page.evaluate(() => {
          if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
        })
        await page.keyboard.press('KeyF')
      }
      await page.waitForFunction(
        () => {
          const ft = window.viewer.getActiveFineTerminalSession?.()?.getSnapshot?.()
          return ft?.phase === 'deliver' && ft.paperTornOff === true
        },
        null,
        {timeout: 12000},
      )

      // Move close beside rider (<= 1.0m) and deliver via real KeyF
      const deliverPos = await page.evaluate(name => {
        const t = window[name]
        const [, tlz] = window.__worldToJiefangLocal(t.x, t.z)
        const towardCenter = Math.abs(tlz) >= 14.1 ? -1 : 1
        return window.__placeAlongBridgeFacingTarget(t, 0.85, t.y, 0.25, towardCenter)
      }, targetGlobalName)
      await page.waitForFunction(
        () => {
          const btn = document.querySelector('.td-ft-btn-deliver')
          return Boolean(btn && !btn.disabled)
        },
        null,
        {timeout: 15000},
      ).catch(async err => {
        const diag = await page.evaluate(() => ({
          snap: window.viewer.getActiveFineTerminalSession?.()?.getSnapshot?.() ?? null,
          btnText: document.querySelector('.td-ft-btn-deliver')?.textContent?.trim() ?? null,
          btnDisabled: document.querySelector('.td-ft-btn-deliver')?.disabled ?? null,
        }))
        throw new Error(`deliver button stayed disabled (pos=${JSON.stringify(deliverPos)}, diag=${JSON.stringify(diag)}): ${err.message}`)
      })
      await page.keyboard.press('KeyF')
      await page.waitForFunction(
        expectedCount =>
          !document.querySelector('.td-fine-terminal') &&
          (window.viewer?.trafficDuty?.getSnapshot?.()?.citedCount ?? 0) >= expectedCount,
        expectedCitedAfter,
        {timeout: 15000},
      )
      await page.waitForTimeout(300)
      return {termInfo, shot}
    }

    // Step B: Find & cite stacked ebike_overload + no_helmet scooter (¥70)
    let stackedTarget = null
    for (let retry = 0; retry < 120 && !stackedTarget?.ok; retry++) {
      stackedTarget = await page.evaluate(() => {
        const actors = window.viewer.dutyTraffic.getActors()
        const onDeck = window.__isOnJiefangBridgeDeck
        const toLocal = window.__worldToJiefangLocal
        const match = actors
          .filter(
            a =>
              a.kind === 'scooter' &&
              !a.leaving &&
              !a.pendingRecycle &&
              !a.cited &&
              a.scale >= 0.5 &&
              onDeck(a) &&
              Array.isArray(a.violations) &&
              a.violations.includes('ebike_overload') &&
              a.violations.includes('no_helmet'),
          )
          .sort((u, v) => toLocal(u.x, u.z)[0] - toLocal(v.x, v.z)[0])[0]
        if (!match) {
          const p = window.viewer.walk?.position
          for (let i = 0; i < 25; i++) window.viewer.dutyTraffic?.step?.(0.1, p)
          return {ok: false}
        }
        window.__r9Target70 = match
        window.__placeAlongBridgeFacingTarget(match, 2.7, match.y, 0.72)
        return {ok: true, id: match.id ?? null, violation: match.violation, violations: [...match.violations]}
      })
      if (!stackedTarget.ok) await page.waitForTimeout(150)
    }
    assert.ok(stackedTarget?.ok, 'failed to spawn ebike_overload+no_helmet scooter on Jiefang Bridge')

    const fine70 = await issueAndDeliverFine({
      targetGlobalName: '__r9Target70',
      expectedYuan: 70,
      requireStackedCopy: true,
      shotFileName: '01-fine-70-stacked.png',
      expectedCitedAfter: 1,
    })
    shots.fine70 = fine70.shot

    const afterFine1 = await page.evaluate(() => ({
      snap: window.viewer.trafficDuty.getSnapshot(),
      hud: document.querySelector('.td-bar')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      money: window.viewer.game.getState().money,
    }))
    assert.equal(afterFine1.snap.citedCount, 1)
    assert.equal(afterFine1.snap.totalFineYuan, 70)
    assert.equal(afterFine1.snap.pendingEarningsYuan, 7)
    assert.equal(afterFine1.money, walletBefore.stateMoney, 'wallet must NOT increase before off-duty check-in (after ¥70)')
    console.log(`[PASS] FINE_70 cited=${afterFine1.snap.citedCount} total=¥70 pending=¥7 wallet=${afterFine1.money} shot=${fine70.shot.rel}`)

    // Step C: Find & cite a normal ¥50 single-violation scooter (no_helmet / bike_double / wrong_way)
    let normalTarget = null
    for (let retry = 0; retry < 180 && !normalTarget?.ok; retry++) {
      normalTarget = await page.evaluate(
        ({prevId, allowed50}) => {
          const allowed = new Set(allowed50)
          const actors = window.viewer.dutyTraffic.getActors()
          const onDeck = window.__isOnJiefangBridgeDeck
          const toLocal = window.__worldToJiefangLocal
          const match = actors
            .filter(a => {
              if (a.id === prevId || a.kind !== 'scooter' || a.leaving || a.pendingRecycle || a.cited || a.scale < 0.5) return false
              if (!onDeck(a)) return false
              const [alx] = toLocal(a.x, a.z)
              if (Math.abs(alx) > 125) return false
              const list = Array.isArray(a.violations) && a.violations.length > 0 ? a.violations : a.violation && a.violation !== 'none' ? [a.violation] : []
              return list.length === 1 && allowed.has(list[0])
            })
            .sort((u, v) => {
              const [ulx, ulz] = toLocal(u.x, u.z)
              const [vlx, vlz] = toLocal(v.x, v.z)
              return (ulz >= 0 ? 0 : 1) - (vlz >= 0 ? 0 : 1) || Math.abs(ulx + 75) - Math.abs(vlx + 75)
            })[0]
          if (!match) {
            const p = window.viewer.walk?.position
            for (let i = 0; i < 25; i++) window.viewer.dutyTraffic?.step?.(0.1, p)
            return {ok: false}
          }
          window.__r9Target50 = match
          window.__placeAlongBridgeFacingTarget(match, 2.7, match.y, 0.72)
          return {
            ok: true,
            id: match.id ?? null,
            violation: match.violation,
            violations: Array.isArray(match.violations) ? [...match.violations] : [match.violation],
          }
        },
        {prevId: stackedTarget.id, allowed50: [...NORMAL_50_VIOLATIONS]},
      )
      if (!normalTarget.ok) await page.waitForTimeout(150)
    }
    assert.ok(normalTarget?.ok, 'failed to find normal ¥50 violator on Jiefang Bridge after cooldown')

    const fine50 = await issueAndDeliverFine({
      targetGlobalName: '__r9Target50',
      expectedYuan: 50,
      requireStackedCopy: false,
      shotFileName: '02-fine-50-normal.png',
      expectedCitedAfter: 2,
    })
    shots.fine50 = fine50.shot

    const afterFine2 = await page.evaluate(() => ({
      snap: window.viewer.trafficDuty.getSnapshot(),
      hud: document.querySelector('.td-bar')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      money: window.viewer.game.getState().money,
    }))
    assert.equal(afterFine2.snap.citedCount, 2)
    assert.equal(afterFine2.snap.totalFineYuan, 120)
    assert.equal(afterFine2.snap.pendingEarningsYuan, 12)
    assert.equal(afterFine2.money, walletBefore.stateMoney, 'wallet must STILL not increase before off-duty check-in (after ¥70+¥50)')
    console.log(`[PASS] FINE_50 cited=${afterFine2.snap.citedCount} total=¥120 pending=¥12 wallet=${afterFine2.money} shot=${fine50.shot.rel}`)

    // Step D: Walk via real ShiftLeft+KeyW back to Jiefang Bridge officer and trigger off-duty settlement via KeyF
    const walkPlan = await page.evaluate(() => {
      const p = window.viewer.walk.position
      const [, lz] = window.__worldToJiefangLocal(p.x, p.z)
      if (lz < 0) {
        const [wxEnd, wzEnd] = window.__jiefangLocalToWorld(-143, -14.5)
        const [wxSouth, wzSouth] = window.__jiefangLocalToWorld(-143, 14.8)
        return {clearEnd: {x: wxEnd, z: wzEnd}, clearSouth: {x: wxSouth, z: wzSouth}}
      }
      return {clearEnd: null, clearSouth: null}
    })
    if (walkPlan.clearEnd) {
      await walkWithKeysTo(walkPlan.clearEnd.x, walkPlan.clearEnd.z, 2.5, 45000)
      await walkWithKeysTo(walkPlan.clearSouth.x, walkPlan.clearSouth.z, 2.5, 25000)
    }
    await walkWithKeysTo(-266.9, 25.9, 2.2, 60000)
    const preTalkDiag = await page.evaluate(() => {
      const p = window.viewer.walk.position
      window.viewer.walk.face(Math.atan2(-(-266.26 - p.x), -(26.86 - p.z)), 0.08)
      return {
        pos: {x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2)},
        cand: window.viewer.trafficDuty.getInteractCandidate(),
        officerDist: window.viewer.trafficDuty.getSnapshot().officerDistanceM,
      }
    })
    console.log(`[INFO] PRE_OFFDUTY=${JSON.stringify(preTalkDiag)}`)
    assert.ok(
      preTalkDiag.officerDist !== null && preTalkDiag.officerDist <= 4.5,
      `expected player within talk range of officer before KeyF, got ${JSON.stringify(preTalkDiag)}`,
    )
    await page.waitForTimeout(300)

    await page.keyboard.press('KeyF')
    await page.waitForSelector('.td-story-dialog:not([hidden])', {timeout: 10000})

    const dialogueLines = []
    let capturedOffDutySummary = false
    for (let i = 0; i < 16; i++) {
      // Wait for typewriter text to finish on current line
      await page
        .waitForFunction(
          () => {
            const st = window.viewer?.trafficDuty?.getStorySnapshot?.()
            const expected = st?.line?.text ?? ''
            const actual = document.querySelector('[data-td-story-text]')?.textContent ?? ''
            return Boolean(expected) && actual === expected
          },
          null,
          {timeout: 3000},
        )
        .catch(() => {})
      await page.waitForTimeout(260)

      const stepState = await page.evaluate(() => {
        const dlg = document.querySelector('.td-story-dialog')
        const dlgOpen = Boolean(dlg && !dlg.hasAttribute('hidden') && getComputedStyle(dlg).display !== 'none')
        const story = window.viewer.trafficDuty.getStorySnapshot?.() ?? null
        const choices = Array.from(document.querySelectorAll('.td-story-dialog:not([hidden]) .td-story-choice')).map(el => ({
          id: el.getAttribute('data-td-story-choice') ?? '',
          text: el.textContent?.trim() ?? '',
        }))
        const renderedText = document.querySelector('.td-story-dialog:not([hidden]) [data-td-story-text]')?.textContent?.trim() ?? ''
        const pillText = document.querySelector('.td-story-dialog:not([hidden]) [data-td-story-gear]')?.textContent?.trim() ?? ''
        return {
          dlgOpen,
          shot: story?.currentShot ?? null,
          text: story?.line?.text ?? renderedText,
          pillText,
          choices,
        }
      })
      if (!stepState.dlgOpen) break
      dialogueLines.push(stepState.text)

      const hasSettlementNumbers =
        (stepState.text.includes('120') && stepState.text.includes('12')) ||
        (stepState.pillText.includes('120') && stepState.pillText.includes('12'))
      if (hasSettlementNumbers || !capturedOffDutySummary) {
        shots.offDuty = await capture(page, '03-offduty-dialogue.png')
        if (hasSettlementNumbers) capturedOffDutySummary = true
      }

      const settleChoice = stepState.choices.find(
        c =>
          !/继续执勤|再守|暂不|cancel|decline/i.test(`${c.id} ${c.text}`) &&
          /settle|off|finish|confirm|accept|下岗|领款|结算|交差/i.test(`${c.id} ${c.text}`),
      )
      const fallbackChoice = stepState.choices.find(c => !/继续执勤|再守|暂不|cancel|decline/i.test(`${c.id} ${c.text}`))
      if (settleChoice || fallbackChoice) {
        const chosen = settleChoice ?? fallbackChoice
        await page.locator(`.td-story-dialog:not([hidden]) .td-story-choice[data-td-story-choice="${chosen.id}"]`).click()
      } else {
        const nextBtn = page.locator('.td-story-dialog:not([hidden]) [data-td-story-action="next"]')
        if ((await nextBtn.count()) > 0 && (await nextBtn.first().isVisible())) {
          await nextBtn.first().click()
        } else {
          break
        }
      }
    }

    await page.waitForFunction(
      () => {
        const dlg = document.querySelector('.td-story-dialog')
        const dlgOpen = Boolean(dlg && !dlg.hasAttribute('hidden') && getComputedStyle(dlg).display !== 'none')
        return !window.viewer.trafficDuty.isStoryOpen?.() && !dlgOpen && window.viewer.trafficDuty.getSnapshot().phase !== 'active'
      },
      null,
      {timeout: 10000},
    )
    await page.waitForTimeout(260)

    const walletAfter = await readWallet()
    const postSnap = await page.evaluate(() => ({
      snap: window.viewer.trafficDuty.getSnapshot(),
      settlement: window.viewer.trafficDuty.getShiftSettlement?.() ?? null,
      panelText: document.querySelector('dialog.td-panel[open]')?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
    }))
    shots.walletSettled = await capture(page, '04-wallet-settled-plus12.png')

    const walletDiff = walletAfter.stateMoney - walletBefore.stateMoney
    const savedDiff =
      walletAfter.savedMoney !== null && walletBefore.savedMoney !== null
        ? walletAfter.savedMoney - walletBefore.savedMoney
        : null
    const joinedDialogue = dialogueLines.join(' ')

    console.log(
      `WALLET_DIFF: before=${walletBefore.stateMoney} after=${walletAfter.stateMoney} diff=${walletDiff} savedBefore=${walletBefore.savedMoney} savedAfter=${walletAfter.savedMoney} savedDiff=${savedDiff}`,
    )
    console.log(`[INFO] POST_SETTLE=${JSON.stringify({phase: postSnap.snap.phase, pending: postSnap.snap.pendingEarningsYuan, settled: postSnap.snap.settledEarningsYuan})}`)
    console.log(
      `[INFO] SHOTS=${JSON.stringify([shots.fine70.rel, shots.fine50.rel, shots.offDuty.rel, shots.walletSettled.rel])}`,
    )

    assert.equal(walletDiff, 12, `expected wallet diff === 12, got ${walletDiff} (before=${walletBefore.stateMoney}, after=${walletAfter.stateMoney})`)
    if (savedDiff !== null) {
      assert.equal(savedDiff, 12, `expected saved localStorage wallet diff === 12, got ${savedDiff}`)
    }
    assert.equal(postSnap.snap.pendingEarningsYuan, 0, 'pendingEarningsYuan must reset to 0 after settlement')
    assert.equal(postSnap.snap.settledEarningsYuan, 12, 'settledEarningsYuan must equal 12')
    assert.ok(
      joinedDialogue.includes('2') && joinedDialogue.includes('120') && joinedDialogue.includes('12'),
      `off-duty dialogue must quote 2 tickets, ¥120 total, and ¥12 share; got: "${joinedDialogue}"`,
    )
    assert.equal(ERRS.length, 0, `unexpected runtime errors: ${JSON.stringify(ERRS)}`)

    console.log(`[PASS] ALL_R9_FINE_CHECKS_PASSED (wallet diff = ${walletDiff}, 4 shots saved in captures/duty-r9-fines/)`)
  } finally {
    await context?.close().catch(() => {})
    if (ownsBrowser) await browser?.close().catch(() => {})
    await rm(bundleDir, {recursive: true, force: true}).catch(() => {})
  }
}

run().catch(err => {
  console.error('[FAIL] duty-r9-fine-check:', err)
  process.exit(1)
})
