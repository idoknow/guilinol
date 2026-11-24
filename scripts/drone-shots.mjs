#!/usr/bin/env node
// IDOK-275 — in-game shots of the drone glTF fleet: placed in front of the walker (近景) and in flight
// from a third-person chase camera (远景). FlyCart flies twice: passenger + car on the winch.
// Usage: npm run build && CHROMIUM=/usr/bin/chromium node scripts/drone-shots.mjs [outDir=captures/drones]
import fs from 'node:fs'
import path from 'node:path'
import {chromium} from 'playwright'
import {preview} from 'vite'
import {telemetryPreview} from './telemetry-preview.mjs'

const OUT = path.resolve(process.argv[2] ?? 'captures/drones')
fs.mkdirSync(OUT, {recursive: true})
const server = await preview({plugins: [telemetryPreview], root: 'web', configFile: 'web/vite.config.ts', preview: {host: '127.0.0.1', port: 0}})
const base = `http://127.0.0.1:${server.httpServer.address().port}`
// near / far chase framing per aircraft: [distance, height, side] in metres
const FRAMES = {
  mavic4pro: {near: [1.1, 0.45, 0.5], far: [1.9, 0.75, 0.9]},
  mini5pro: {near: [0.9, 0.35, 0.4], far: [1.3, 0.5, 0.6]},
  air3s: {near: [0.95, 0.4, 0.45], far: [1.6, 0.65, 0.75]},
  inspire3: {near: [1.6, 0.6, 0.8], far: [2.8, 1.1, 1.3]},
  flycart200: {near: [5, 2, 2.4], far: [9, 2.6, 4]},
}
const RUNS = [['mavic4pro'], ['mini5pro'], ['air3s'], ['inspire3'], ['flycart200', 'person'], ['flycart200', 'car']]
let browser
try {
  browser = await chromium.launch({executablePath: process.env.CHROMIUM, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']})
  const page = await browser.newPage({viewport: {width: 1280, height: 720}})
  page.on('pageerror', error => console.error('pageerror', error.message))
  await page.route('**/stats.rcpd.cc/**', route => route.fulfill({status: 204, body: ''}))
  await page.route('**/api/t', route => route.fulfill({status: 204}))
  await page.route('**/api/live', route => route.fulfill({status: 200, contentType: 'application/json', body: '{"online":42}'}))
  await page.goto(base + '/?verify&mode=walk&flow=0', {waitUntil: 'domcontentloaded', timeout: 120000})
  await page.waitForFunction(() => window.viewer?.walk?.active && document.querySelector('.dock-drone'), null, {timeout: 180000})
  await page.waitForFunction(() => {
    const entry = document.querySelector('.dock-drone'), rect = entry?.getBoundingClientRect()
    if (!rect?.width) return false
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
    return !!hit && entry.contains(hit)
  }, null, {timeout: 120000})
  // open ground with a view: the 解放桥 deck (same spot as scripts/perf.mjs)
  if (!(await page.evaluate(() => window.viewer.walkTo(-265, 15, 0, 'drone-shots')))) throw Error('walkTo failed')
  await page.waitForTimeout(4000)
  await page.addStyleTag({content: '.rc,.drone-hint,.walk-toast{visibility:hidden!important}'})
  const tap = sel => page.evaluate(s => document.querySelector(s).click(), sel)
  // apply the chase camera through one model step, then let two real frames render
  const settle = async ms => {
    await page.evaluate(() => { const m = document.querySelector('.drone-mask'); if (m) { m.classList.remove('show'); m.hidden = true } })
    await page.evaluate(() => window.droneStep(0.016, 1))
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
    await page.waitForTimeout(ms)
  }
  for (const [id, load] of RUNS) {
    const f = FRAMES[id]
    // first run opens the hangar from the dock; later runs tap the (re-rendered) card directly —
    // placing a new aircraft recalls the previous one
    if (!(await page.evaluate(() => window.droneDebug?.().placed))) {
      await tap('.dock-drone')
      await page.waitForFunction(() => !document.querySelector('.drone-mask')?.hidden, null, {timeout: 10000}).catch(() => tap('.dock-drone'))
    }
    await page.waitForSelector(`[data-drone="${id}"]`, {state: 'attached', timeout: 60000})
    if (load) await tap(`[data-drone="${id}"] [data-load="${load}"]`)
    if (await page.evaluate(i => window.droneDebug().placed === i, id)) await tap(`[data-drone="${id}"]`)
    await tap(`[data-drone="${id}"]`)
    await page.waitForFunction(i => window.droneDebug?.().placed === i && window.droneDebug().model, id, {timeout: 30000})
    await page.waitForFunction(() => document.querySelector('.drone-mask')?.hidden, null, {timeout: 5000}).catch(() => {})
    await page.evaluate(v => window.droneChase({distance: v[0], height: v[1], side: v[2]}), f.near)
    await settle(2500)
    if (load !== 'car') await page.screenshot({path: path.join(OUT, `${id}-placed.png`)})
    await tap('.dock-drone')
    await page.waitForFunction(() => document.body.dataset.drone === 'rc', null, {timeout: 20000})
    await page.evaluate(() => window.droneStep(0.1, 40))
    await page.keyboard.down('ArrowUp')
    await page.evaluate(h => window.droneStep(0.1, h), id === 'flycart200' ? 30 : 14)
    await page.keyboard.up('ArrowUp')
    await page.evaluate(() => window.droneStep(0.1, 10))
    await page.evaluate(v => window.droneChase({distance: v[0], height: v[1], side: v[2]}), f.far)
    if (load) await page.waitForFunction(() => (window.droneDebug().payload?.parts ?? 0) >= 4 && (window.droneDebug().load !== 'person' || window.droneDebug().payload.figure), null, {timeout: 30000})
    await settle(2500)
    const name = `${id}${load ? '-' + load : ''}-flying.png`
    await page.screenshot({path: path.join(OUT, name)})
    console.log(name, JSON.stringify((({flight, model, payload}) => ({agl: flight.agl, phase: flight.phase, props: model.props.length, payload}))(await page.evaluate(() => window.droneDebug()))))
    await page.evaluate(() => window.droneChase(null))
    await tap('.rc [data-act="exit"]')
    await page.waitForFunction(() => !document.querySelector('.rc'), null, {timeout: 20000})
  }
} finally {
  await browser?.close()
  await new Promise(resolve => server.httpServer.close(resolve))
}
