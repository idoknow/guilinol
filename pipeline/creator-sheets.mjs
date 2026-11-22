// Offline WebGL studio. Render the identical rig, clothing and attachments used by the game.
import {resolve} from 'node:path'
import {createServer} from 'vite'
import {chromium} from 'playwright'
import {mkdir, writeFile} from 'node:fs/promises'
import {browserOptions} from '../scripts/qa-browser.mjs'
const dir = 'captures/creator'
await mkdir(dir, {recursive: true})
const server = await createServer({
  root: 'web',
  configFile: 'web/vite.config.ts',
  server: {host: '127.0.0.1', port: 0},
})
let browser
try {
  await server.listen()
  browser = await chromium.launch(browserOptions(true))
  const page = await browser.newPage({viewport: {width: 320, height: 320}})
  await page.route('**/studio.html', (r) =>
    r.fulfill({
      contentType: 'text/html',
      body: '<style>*{margin:0}#studio,canvas{width:320px;height:320px}</style><div id="studio"></div>',
    }),
  )
  await page.goto('http://127.0.0.1:' + server.httpServer.address().port + '/studio.html')
  const images = await page.evaluate(
    async (shared) => {
      const {creatorStage} = await import('/src/ui/creator-stage.ts')
      const {hairStyles, hairNames, lookNames, looks, defaultAvatar, skinTones} = await import(shared)
      const stage = creatorStage(document.querySelector('#studio'), true, true),
        canvas = document.querySelector('canvas')
      const raf = () => new Promise((r) => requestAnimationFrame(r))
      function sheet(cols, rows, w, h, caption = 0) {
        const sheet = document.createElement('canvas')
        sheet.width = cols * w
        sheet.height = rows * (h + caption)
        const ctx = sheet.getContext('2d')
        ctx.fillStyle = '#e3ebe5'
        ctx.fillRect(0, 0, sheet.width, sheet.height)
        return {
          canvas: sheet,
          put(x, y, label = '') {
            ctx.drawImage(canvas, x * w, y * (h + caption), w, h)
            if (caption) {
              ctx.fillStyle = '#34544a'
              ctx.textAlign = 'center'
              ctx.font = '16px sans-serif'
              ctx.fillText(label, (x + 0.5) * w, y * (h + caption) + h + 19)
            }
          },
        }
      }
      const sprite = sheet(6, 11, 88, 88),
        skin = sheet(5, 2, 180, 180, 24),
        hair = sheet(6, 8, 160, 160, 24),
        outfits = sheet(6, 4, 210, 210, 24)
      async function render(a, head, yaw = 0) {
        await stage.apply(a)
        stage.frameHead(head)
        stage.angle(yaw)
        await raf()
        await raf()
      }
      for (const [index, body] of ['m', 'f'].entries()) {
        const a = {...defaultAvatar(), body, hair: hairStyles[body][0]}
        await render(a, false)
        sprite.put(index, 0)
        for (let i = 0; i < 5; i++) {
          await render({...a, skin: i}, true)
          skin.put(i, index, skinTones[i])
        }
        for (const [k, key] of ['face', 'brows', 'eyes'].entries())
          for (let i = 0; i < 3; i++) {
            await render({...a, [key]: i}, true)
            sprite.put(i, 1 + index * 5 + k)
          }
        for (const [i, id] of hairStyles[body].entries()) {
          await render({...a, hair: id}, true)
          sprite.put(i, 4 + index * 5)
          for (let j = 0; j < 4; j++) {
            stage.angle((j * Math.PI) / 2)
            await raf()
            await raf()
            hair.put(i, index * 4 + j, hairNames[body][i])
          }
        }
        for (const [i, look] of looks.entries()) {
          await render({...a, look}, false)
          sprite.put(i, 5 + index * 5)
          outfits.put(i, index * 2, lookNames[i])
          stage.angle(Math.PI)
          await raf()
          await raf()
          outfits.put(i, index * 2 + 1, lookNames[i])
        }
      }
      stage.dispose()
      return [
        sprite.canvas.toDataURL('image/webp', 0.79),
        ...[skin, hair, outfits].map((s) => s.canvas.toDataURL()),
      ]
    },
    '/@fs/' + resolve('lib/avatar.ts'),
  )
  for (const [i, path] of [
    'public/avatar/creator-options.webp',
    ...['skin', 'hair', 'outfits'].map((s) => dir + '/' + s + '.png'),
  ].entries())
    await writeFile(path, Buffer.from(images[i].split(',')[1], 'base64'))
} finally {
  await browser?.close()
  await server.close()
}
