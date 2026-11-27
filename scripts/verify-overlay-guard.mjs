// IDOK-399 — `isModalOrOverlayOpen` keeps its document scan until the DOM changes. This checks that
// claim in a real browser: thousands of random DOM edits, and after each one the cached answer must
// equal a fresh scan — in the same task, after a microtask and after a frame.
// Headless. Run: node scripts/verify-overlay-guard.mjs   (part of `npm run verify:hot-paths`)
import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {chromium} from 'playwright'

const bundle = await build({
  entryPoints: ['web/src/walk/input-guard.ts'],
  bundle: true,
  write: false,
  format: 'iife',
  globalName: 'guard',
})

const browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM || undefined})
try {
  const page = await browser.newPage()
  await page.setContent('<!doctype html><body><div id="hud"></div><div id="ui"><div id="deep"></div></div></body>')
  await page.addScriptTag({content: bundle.outputFiles[0].text})
  const result = await page.evaluate(async () => {
    const {isModalOrOverlayOpen, overlayScanCount} = window.guard
    // Same rules, but through an object that is not `document`: that path scans on every call.
    const uncached = {body: document.body, querySelector: selector => document.querySelector(selector)}
    let seed = 20261126
    const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
    const pick = list => list[Math.floor(random() * list.length)]
    const hud = document.getElementById('hud'), ui = document.getElementById('ui'), deep = document.getElementById('deep')

    // One element per overlay rule, all closed, plus HUD pieces that are rewritten every frame.
    const overlays = [
      ['dialog', '', el => { el.open = true }, el => { el.open = false }],
      ...['about-mask', 'fx-drawer', 'mifen-story-dialog', 'td-story-dialog', 'drinks-order-panel', 'td-fine-terminal']
        .map(name => ['div', name, el => { el.hidden = false }, el => { el.hidden = true }, el => { el.hidden = true }]),
      ...['atlas', 'book', 'shop-overlay', 'wardrobe-overlay', 'garage-overlay']
        .map(name => ['div', name, el => el.classList.add('show'), el => el.classList.remove('show')]),
      ['div', '', el => { el.hidden = false; el.dataset.storyDialog = '1' }, el => { el.hidden = true }, el => { el.hidden = true }],
    ].map(([tag, className, open, close, init]) => {
      const el = document.createElement(tag)
      if (className) el.className = className
      init?.(el)
      ui.append(el)
      return {el, open, close, className}
    })
    const labels = Array.from({length: 6}, () => hud.appendChild(document.createElement('span')))
    const buttons = Array.from({length: 6}, (_, index) => {
      const button = hud.appendChild(document.createElement('button'))
      button.className = 'hud-button'
      button.hidden = index % 2 === 0
      return button
    })
    const hudFrame = frame => {
      for (const label of labels) label.textContent = `${frame} km/h`
      for (const button of buttons) { button.hidden = button.hidden; button.classList.add('hud-button') }
    }

    const closeEverything = () => {
      for (const overlay of overlays) { overlay.el.className = overlay.className; overlay.el.removeAttribute('open'); overlay.close(overlay.el) }
      deep.textContent = ''
      for (const flag of ['shopOpen', 'tdTerminalOpen', 'drinksUiOpen', 'tdTerminalPhase']) delete document.body.dataset[flag]
    }
    const ops = [
      closeEverything, closeEverything, closeEverything, closeEverything, closeEverything,
      () => { const overlay = pick(overlays); overlay.open(overlay.el) },
      () => { const overlay = pick(overlays); overlay.close(overlay.el) },
      () => pick(overlays).el.remove(),
      () => pick([ui, deep, document.body]).append(pick(overlays).el),
      () => { deep.innerHTML = random() < .5 ? '<div class="book show"><p>x</p></div>' : '<p>plain</p>' },
      () => { deep.textContent = '' },
      () => { pick(overlays).el.className = pick(['atlas show', 'atlas', 'book', 'shop-overlay show', 'fx-drawer', 'x']) },
      () => pick(overlays).el.toggleAttribute('hidden'),
      () => pick(overlays).el.setAttribute('open', ''),
      () => pick(overlays).el.removeAttribute('open'),
      () => { const flag = pick(['shopOpen', 'tdTerminalOpen', 'drinksUiOpen']); if (random() < .5) document.body.dataset[flag] = '1'; else delete document.body.dataset[flag] },
      () => { if (random() < .5) document.body.dataset.tdTerminalPhase = 'deliver'; else delete document.body.dataset.tdTerminalPhase },
      () => hudFrame(seed),
    ]
    const waits = [null, null, null, () => Promise.resolve(), () => new Promise(resolve => setTimeout(resolve)), () => new Promise(resolve => requestAnimationFrame(resolve))]

    let checks = 0, opened = 0, closed = 0
    const mismatches = []
    const check = step => {
      const truth = isModalOrOverlayOpen(uncached)
      for (let call = 0; call < 3; call++) {
        checks++
        if (isModalOrOverlayOpen() !== truth && mismatches.length < 5) mismatches.push({step, call, truth})
      }
      if (truth) opened++
      else closed++
    }
    const steps = 4000
    for (let step = 0; step < steps; step++) {
      const count = 1 + Math.floor(random() * 3)
      for (let op = 0; op < count; op++) pick(ops)()
      check(step)
      const wait = pick(waits)
      if (wait) { await wait(); check(step) }
    }

    // A quiet game: only the HUD moves. Several callers a frame, and no scan at all.
    closeEverything()
    isModalOrOverlayOpen()
    const before = overlayScanCount()
    let quietOpen = 0
    for (let frame = 0; frame < 300; frame++) {
      for (let caller = 0; caller < 6; caller++) { hudFrame(frame); if (isModalOrOverlayOpen()) quietOpen++ }
      if (frame % 50 === 0) await new Promise(resolve => requestAnimationFrame(resolve))
    }
    return {steps, checks, opened, closed, mismatches, quietScans: overlayScanCount() - before, quietOpen}
  })
  console.log(result)
  assert.deepEqual(result.mismatches, [], 'cached answer differs from a fresh scan')
  assert.ok(Math.min(result.opened, result.closed) > result.steps * .2, 'the random walk visits both open and closed states')
  assert.equal(result.quietOpen, 0)
  assert.equal(result.quietScans, 0, 'HUD text and same-value writes must not cause a rescan')
  console.log('ok — overlay guard matches a fresh scan after every DOM change')
} finally {
  await browser.close()
}
