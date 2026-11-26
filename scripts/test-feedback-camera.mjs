import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const server = await createServer({ root: 'web', configFile: false, server: { host: '127.0.0.1', port: 0 } })
let browser
try {
  await server.listen()
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] })
  const page = await browser.newPage()
  await page.route('**/fixture', route => route.fulfill({ contentType: 'text/html', body: '<body></body>' }))
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/fixture`)
  await page.evaluate(async () => {
    localStorage.setItem('glol.fb.camSave', '0')
    window.camera = (await import('/src/ui/feedback-camera.ts')).shootFeedbackPhoto
    window.openCamera = () => { window.result = window.camera().then(shot => shot?.file.size, error => error.message) }
  })
  await page.evaluate(() => window.openCamera())
  await page.locator('.fb-cam-shutter:enabled').click()
  assert.ok((await page.evaluate(() => window.result)) > 0)
  await page.evaluate(() => {
    HTMLMediaElement.prototype.play = () => Promise.reject(Error('preview failed'))
    window.openCamera()
  })
  assert.match(await page.evaluate(() => window.result), /摄像头没有可用画面/)
  await page.clock.install()
  await page.evaluate(async () => {
    window.lateStream = await navigator.mediaDevices.getUserMedia({ video: true })
    navigator.mediaDevices.getUserMedia = () => new Promise(resolve => { window.grant = resolve })
    window.openCamera()
  })
  await page.clock.fastForward(16000)
  assert.match(await page.evaluate(() => window.result), /摄像头没有可用画面/)
  await page.evaluate(() => window.grant(window.lateStream))
  assert.equal(await page.evaluate(() => window.lateStream.getVideoTracks()[0].readyState), 'ended')
  console.log('Feedback camera: capture, play rejection, timeout and late track cleanup passed')
} finally {
  await browser?.close()
  await server.close()
}
