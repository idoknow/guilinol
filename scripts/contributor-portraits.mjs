/**
 * 渲染「关于」页贡献者头像（IDOK-148）：每人用自己账号在网上桂林里的角色外形（contributors.ts 的 avatar），
 * 走角色创建页同一套舞台（creator-stage.ts 的头像特写），输出 public/contributors/<portrait>.webp（192×192，透明底）。
 * 用法：CHROMIUM=/usr/bin/chromium node scripts/contributor-portraits.mjs
 */
import {mkdirSync, writeFileSync} from 'node:fs'
import {chromium} from 'playwright'
import {createServer} from 'vite'

const out = new URL('../public/contributors/', import.meta.url)
mkdirSync(out, {recursive: true})
const server = await createServer({root: 'web', configFile: 'web/vite.config.ts', logLevel: 'error', server: {port: 0, host: '127.0.0.1'}})
await server.listen()
const base = server.resolvedUrls.local[0]
const browser = await chromium.launch({executablePath: process.env.CHROMIUM || undefined, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader']})
try {
  const page = await browser.newPage({viewport: {width: 400, height: 400}, deviceScaleFactor: 1})
  page.on('pageerror', error => console.error('pageerror', error.message))
  await page.goto(`${base}avatar-dev.html`)
  const shots = await page.evaluate(async () => {
    document.body.innerHTML = ''
    const {creatorStage} = await import('/src/ui/creator-stage.ts')
    const {contributors, LOGO_PORTRAIT} = await import('/src/ui/contributors.ts')
    const wait = ms => new Promise(r => setTimeout(r, ms))
    const result = {}
    for (const person of [...contributors, LOGO_PORTRAIT]) {
      const host = document.createElement('div')
      host.style.cssText = 'width:192px;height:192px'
      document.body.append(host)
      const stage = creatorStage(host, true, true)
      await stage.apply(person.avatar)
      stage.angle(0.35)
      stage.frameHead(true, 0.955)
      await wait(900)
      const square = document.createElement('canvas')
      square.width = square.height = 192
      square.getContext('2d').drawImage(host.querySelector('canvas'), 0, 0, 192, 192, 0, 0, 192, 192)
      result[person.portrait] = square.toDataURL('image/webp', 0.9)
      stage.dispose()
      host.remove()
    }
    return result
  })
  for (const [name, url] of Object.entries(shots)) {
    writeFileSync(new URL(`${name}.webp`, out), Buffer.from(url.split(',')[1], 'base64'))
    console.log('wrote', name)
  }
} finally {
  await browser.close()
  await server.close()
}
