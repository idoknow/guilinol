// Offline WebGL studio. Render the identical rig, clothing and attachments used by the game.
import {resolve} from 'node:path'
import {createServer} from 'vite'
import {chromium} from 'playwright'
import {mkdir, writeFile} from 'node:fs/promises'
import {browserOptions} from '../scripts/qa-browser.mjs'
const dir = 'captures/creator'
const portraitNames = ['m-front', 'm-three-quarter', 'm-profile', 'f-front', 'f-three-quarter', 'f-profile']
await mkdir(dir, {recursive: true})
const server = await createServer({
  root: 'web',
  configFile: 'web/vite.config.ts',
  server: {host: '127.0.0.1', port: 0},
})
let browser
try {
  await server.listen()
  browser = await chromium.launch(browserOptions(process.env.QA_SWIFTSHADER !== '1'))
  const page = await browser.newPage({viewport: {width: 600, height: 600}})
  await page.route('**/studio.html', (r) =>
    r.fulfill({
      contentType: 'text/html',
      body: '<style>*{margin:0}#studio,canvas{width:600px;height:600px}</style><div id="studio"></div>',
    }),
  )
  await page.goto('http://127.0.0.1:' + server.httpServer.address().port + '/studio.html')
  const images = await page.evaluate(
    async (shared) => {
      const {creatorStage} = await import('/src/ui/creator-stage.ts')
      const {hairStyles, hairNames, lookNames, looks, defaultAvatar, skinTones, faceNames, browNames, eyeNames} = await import(shared)
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
          put(x, y, label = '', source = canvas) {
            ctx.drawImage(source, x * w, y * (h + caption), w, h)
            if (caption) {
              ctx.fillStyle = '#34544a'
              ctx.textAlign = 'center'
              ctx.font = '16px sans-serif'
              ctx.fillText(label, (x + 0.5) * w, y * (h + caption) + h + 19)
            }
          },
        }
      }
      const sprite = sheet(12, 11, 88, 88),
        skin = sheet(5, 2, 180, 180, 24),
        hair = sheet(6, 8, 160, 160, 24),
        outfits = sheet(12, 4, 210, 210, 24)
      async function render(a, head, yaw = 0) {
        await stage.apply(a)
        stage.frameHead(head)
        stage.angle(yaw)
        await raf()
        await raf()
      }
      const hairLight = sheet(6, 8, 160, 160, 24),
        faces = sheet(faceNames.length, 4, 180, 180, 24)
      // Subtract the empty studio so the turntable stays out of the silhouette plate.
      const matte = document.createElement('canvas')
      matte.width = matte.height = 600
      const painter = matte.getContext('2d', {willReadFrequently: true})
      await raf()
      await raf()
      painter.drawImage(canvas, 0, 0)
      const empty = painter.getImageData(0, 0, 600, 600).data
      function silhouette() {
        painter.clearRect(0, 0, 600, 600)
        painter.drawImage(canvas, 0, 0)
        const pixels = painter.getImageData(0, 0, 600, 600),
          rgba = pixels.data
        for (let k = 0; k < rgba.length; k += 4) {
          const diff = Math.max(...[0, 1, 2, 3].map((channel) => Math.abs(empty[k + channel] - rgba[k + channel])))
          rgba[k] = 31
          rgba[k + 1] = 35
          rgba[k + 2] = 38
          rgba[k + 3] = diff > 4 ? 255 : 0
        }
        painter.putImageData(pixels, 0, 0)
        return matte
      }
      const silhouettes = sheet(2, 2, 420, 420, 24)
      const bodies = sheet(2, 2, 420, 420, 24),
        portraits = []
      for (const [index, body] of ['m', 'f'].entries()) {
        const a = {...defaultAvatar(), body, hair: hairStyles[body][0]}
        await render(a, false)
        sprite.put(index, 0)
        await render({...a, hair: body === 'm' ? 'm_buzz' : 'f_bun'}, false)
        silhouettes.put(index, 0, body === 'm' ? '男 · 正' : '女 · 正', silhouette())
        bodies.put(index, 0, body === 'm' ? '男' : '女')
        await render({...a, hair: body === 'm' ? 'm_buzz' : 'f_bun'}, false, Math.PI / 2)
        silhouettes.put(index, 1, body === 'm' ? '男 · 侧' : '女 · 侧', silhouette())
        bodies.put(index, 1, body === 'm' ? '男 · 侧' : '女 · 侧')
        for (const [row, skin] of [0, 4].entries())
          for (let face = 0; face < faceNames.length; face++) {
            await render({...a, face, skin}, true)
            faces.put(face, index * 2 + row, faceNames[face])
          }
        const cuts = body === 'm' ? ['m_part', 'm_crop', 'm_mullet'] : ['f_bun', 'f_lob', 'f_pony']
        for (const [j, cut] of cuts.entries()) {
          await render({...a, hair: cut}, true, (j * Math.PI) / 4)
          const portrait = sheet(1, 1, 600, 600)
          portrait.put(0, 0)
          portraits.push(portrait.canvas.toDataURL())
        }
        for (let i = 0; i < 5; i++) {
          await render({...a, skin: i}, true)
          skin.put(i, index, skinTones[i])
        }
        for (const [k, key] of ['face', 'brows', 'eyes'].entries())
          for (let i = 0; i < [faceNames, browNames, eyeNames][k].length; i++) {
            await render({...a, [key]: i}, true)
            sprite.put(i, 1 + index * 5 + k)
          }
        for (const [i, id] of hairStyles[body].entries()) {
          await render({...a, hair: id}, true)
          sprite.put(i, 4 + index * 5)
          for (const hairColor of [0, 3]) {
            await render({...a, hair: id, hairColor}, true)
            for (let j = 0; j < 4; j++) {
              stage.angle((j * Math.PI) / 2)
              await raf()
              await raf()
              ;(hairColor ? hairLight : hair).put(i, index * 4 + j, hairNames[body][i])
            }
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
      await render({...defaultAvatar(), look: 'sport', hair: 'm_crop'}, false)
      const street = sheet(1, 1, 600, 600)
      street.put(0, 0)
      stage.dispose()
      return [
        sprite.canvas.toDataURL('image/webp', 0.79),
        ...[skin, hair, outfits, bodies, hairLight, faces, silhouettes].map((s) => s.canvas.toDataURL()),
        ...portraits,
        street.canvas.toDataURL(),
      ]
    },
    '/@fs/' + resolve('lib/avatar.ts'),
  )
  for (const [i, path] of [
    'public/avatar/creator-options.webp',
    ...['skin', 'hair', 'outfits', 'bodies', 'hair-light', 'faces', 'silhouettes', ...portraitNames, 'street'].map(
      (s) => dir + '/' + s + '.png',
    ),
  ].entries())
    await writeFile(path, Buffer.from(images[i].split(',')[1], 'base64'))
} finally {
  await browser?.close()
  await server.close()
}
