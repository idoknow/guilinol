/** Headless shots for IDOK-25: boot + about, desktop and phone. */
import {chromium} from 'playwright'
import {preview} from 'vite'
import {mkdir, copyFile} from 'node:fs/promises'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = process.env.CAPTURES ?? join(root, 'captures/m5b')
await mkdir(out, {recursive: true})

const server = await preview({root: 'web', configFile: 'web/vite.config.ts', preview: {host: '127.0.0.1', port: 0}})
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
const port = server.httpServer.address().port
const base = `http://127.0.0.1:${port}/`

async function shot(name, {width, height, isMobile = false, touch = false}, action) {
  const page = await browser.newPage({
    viewport: {width, height},
    isMobile,
    hasTouch: touch,
    deviceScaleFactor: 1,
  })
  page.on('pageerror', e => console.log('ERR', name, e.message))
  await action(page)
  const path = join(out, `${name}.png`)
  await page.screenshot({path, fullPage: false})
  console.log('shot', path)
  await page.close()
}

await shot('boot-desktop', {width: 1280, height: 720}, async page => {
  await page.route('**/world/**', () => {}) // hold world requests so the boot layer stays up
  await page.goto(base, {waitUntil: 'domcontentloaded'})
  await page.waitForSelector('#boot:not(.out)')
  await page.waitForTimeout(200)
})

await shot('boot-phone', {width: 390, height: 844, isMobile: true, touch: true}, async page => {
  await page.route('**/world/**', () => {}) // hold world requests so the boot layer stays up
  await page.goto(base, {waitUntil: 'domcontentloaded'})
  await page.waitForSelector('#boot:not(.out)')
  await page.waitForTimeout(200)
})

async function aboutShot(name, viewport) {
  await shot(name, viewport, async page => {
    await page.goto(`${base}?verify&cam=lijiang&time=17.5`)
    await page.waitForFunction(() => window.viewer?.stats.firstMs > 0)
    await page.waitForTimeout(600)
    await page.click('.btn-about')
    await page.waitForSelector('.about-mask:not([hidden])')
    await page.waitForTimeout(200)
  })
}

await aboutShot('about-desktop', {width: 1280, height: 720})
await aboutShot('about-phone', {width: 390, height: 844, isMobile: true, touch: true})

await copyFile(join(root, 'public/og.jpg'), join(out, 'og.jpg'))
console.log('copied og.jpg')

await browser.close()
await server.close()
