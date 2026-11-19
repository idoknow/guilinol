import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {preview} from 'vite'
import {mkdir} from 'node:fs/promises'

const SHOTS = [
  {
    id: 'glmu_dongcheng',
    query: '桂林医科大学',
    walkStart: [-15.0, -298.0],
    walkInside: [-25.0, -245.0],
    hitDir: [1.0, 0.3],
    views: [
      ['gate', [-6.0, 3.0, -308.0], [-20.0, 2.8, -284.0]],
      ['main', [45.0, 5.2, -223.0], [20.0, 11.5, -198.0]],
      ['field', [-5.8, 22.0, 126.0], [-10.0, 6.0, 16.0]],
      ['overview', [12.0, 540.0, -19.9], [12.0, 0.0, -20.0]],
    ],
    labels: [
      ['东城图书馆', 20, 24, -198],
      ['附属口腔医院楼', -58, 22, -268],
      ['弘德楼', 50, 26, -144.5],
      ['第二教学楼', 47, 22, -95],
      ['科教楼与报告厅', -48, 22, -116],
      ['标准田径运动场', -5.8, 2, 48],
      ['学生公寓群', -80, 20, -18],
      ['博学实验楼', 105, 18, 218],
    ],
  },
  {
    id: 'glut_primary',
    query: '理工大附小',
    walkStart: [-45.0, -6.0],
    walkInside: [-20.0, 2.0],
    hitDir: [0.8, -0.6],
    views: [
      ['gate', [-46.5, 2.6, -6.2], [-32.0, 3.0, -1.5]],
      ['main', [-4.0, 4.5, 12.0], [8.5, 8.0, -24.0]],
      ['field', [-26.0, 14.0, 24.0], [6.0, 2.0, 6.0]],
      ['overview', [0.0, 165.0, 0.05], [0.0, 0.0, 0.0]],
    ],
    labels: [
      ['崇德楼（4F）', 8.5, 16, -24],
      ['求是楼（3F）', -2.0, 12, 35.5],
      ['操场与篮球场', 6.0, 1, 7.5],
      ['游戏布局，非实地导览', -8.0, 1, -44.0],
    ],
  },
  {
    id: 'tianjiabing',
    query: '田家炳',
    walkStart: [-46.0, 72.0],
    walkInside: [-30.0, 44.0],
    hitDir: [0.9, -0.4],
    views: [
      ['gate', [-43.5, 2.7, 68.5], [-38.0, 4.2, 56.0]],
      ['main', [-26.0, 5.0, 54.0], [-8.0, 10.0, 20.0]],
      ['field', [-84.0, 36.0, 48.0], [-45.0, 5.0, -18.0]],
      ['overview', [-8.0, 290.0, 5.05], [-8.0, 0.0, 5.0]],
    ],
    labels: [
      ['田家炳楼（5F）', -12, 19, 22],
      ['艺体馆', -6, 14, -48],
      ['博学楼（5F）', 52, 18, -24],
      ['明德楼（4F）', 58, 15, 20],
      ['田径运动场', -84, 2, -16],
      ['游戏布局，非实地导览', 6, 1, 68],
    ],
  },
  {
    id: 'chenshan_primary',
    query: '辰山小学',
    walkStart: [-24.0, -64.0],
    walkInside: [-6.0, -40.0],
    hitDir: [-0.8, 0.6],
    views: [
      ['gate', [-28.0, 2.8, -68.0], [-10.0, 3.2, -52.0]],
      ['main', [-14.0, 5.5, 4.0], [-14.0, 10.0, 60.0]],
      ['field', [-8.0, 15.0, -56.0], [16.0, 1.5, -22.0]],
      ['overview', [-4.0, 260.0, 5.05], [-4.0, 0.0, 5.0]],
    ],
    labels: [
      ['厚德楼（5F）', -14, 19, 62],
      ['明德楼（4F）', -38, 15, 36],
      ['尚善楼（4F）', 10, 15, 36],
      ['田径场与球场', 16, 2, -24],
      ['游戏布局，非实地导览', -14, 1, -72],
    ],
  },
  {
    id: 'lijiang_primary',
    query: '漓江小学',
    walkStart: [-18.0, 44.0],
    walkInside: [-4.0, 22.0],
    hitDir: [-0.8, -0.5],
    views: [
      ['gate', [-24.0, 3.0, 52.0], [-14.0, 6.5, 22.0]],
      ['main', [-22.0, 4.5, 44.0], [-12.5, 9.5, 13.5]],
      ['field', [20.0, 22.0, 24.0], [2.0, 2.0, -6.0]],
      ['overview', [0.0, 145.0, 0.05], [0.0, 0.0, 0.0]],
    ],
    labels: [
      ['尚善楼（5F）', -12.5, 18, 13.5],
      ['致远楼（4F）', 8.0, 15, -23.5],
      ['塑胶球场', 10.0, 1, 2.0],
      ['游戏布局，非实地导览', 8.0, 1, 34.0],
    ],
  },
  {
    id: 'longyin_primary',
    query: '龙隐小学',
    walkStart: [-66.0, 46.0],
    walkInside: [-38.0, 26.0],
    hitDir: [0.0, -1.0],
    views: [
      ['gate', [-64.0, 2.6, 44.0], [-52.0, 3.6, 34.0]],
      ['main', [-20.0, 3.6, 28.0], [-36.0, 6.5, -8.0]],
      ['field', [48.0, 14.0, -34.0], [50.0, 2.0, 12.0]],
      ['overview', [-4.0, 235.0, 0.05], [-4.0, 0.0, 0.0]],
    ],
    labels: [
      ['崇文楼（4F）', -38, 15, -12],
      ['博学楼（4F）', 10, 16, -24],
      ['明德楼（4F）', 8, 15, 14],
      ['腾龙雕塑庭院', -32, 4, 20],
      ['塑胶田径场与球场', 50, 2, -6],
      ['游戏布局，非实地导览', -12, 1, 46],
    ],
  },
]

await mkdir('captures/schools', {recursive: true})
await mkdir('docs/schools', {recursive: true})

const server = await preview({root: 'web', configFile: 'web/vite.config.ts', preview: {host: '127.0.0.1', port: 0}})
let browser
try {
  browser = await chromium.launch({executablePath: process.env.CHROMIUM, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']})
  const page = await browser.newPage({viewport: {width: 1080, height: 720}})
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?verify&radius=512&time=10.5`)
  await page.waitForFunction(() => window.viewer?.stats.firstMs > 0, null, {timeout: 60000})

  for (const school of SHOTS) {
    await mkdir(`captures/schools/${school.id}`, {recursive: true})
    for (const [viewName, eye, target] of school.views) {
      await page.evaluate(() => {
        document.querySelectorAll('.g3-label').forEach(el => el.remove())
      })
      await page.evaluate(({id, eye, target}) => {
        const {camera, manifest, walk} = window.viewer
        if (walk?.active) walk.leave()
        const entry = manifest.landmarks.find(e => e.id === id)
        if (!entry) throw new Error('Missing landmark: ' + id)
        const p = entry.position
        camera.position.set(p[0] + eye[0], p[1] + eye[1], p[2] + eye[2])
        camera.lookAt(p[0] + target[0], p[1] + target[1], p[2] + target[2])
        camera.updateMatrixWorld()
      }, {id: school.id, eye, target})

      await page.waitForFunction((id) => {
        const v = window.viewer
        if (v.stats.pending) return false
        return [...v.stream.landmarks].some(([item, root]) => {
          if (item.id !== id) return false
          const l0 = root.getObjectByName('lod0'), l1 = root.getObjectByName('lod1')
          return (l0 && l0.visible) || (l1 && l1.visible)
        })
      }, school.id, {timeout: 45000})
      // Let 3 frames render cleanly
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)))))

      if (viewName === 'overview') {
        await page.evaluate(({id, labels}) => {
          const {camera, manifest} = window.viewer
          const {position} = manifest.landmarks.find(e => e.id === id)
          for (const [text, east, height, south] of labels) {
            const v = camera.position.clone().set(position[0] + east, position[1] + height, position[2] + south).project(camera)
            const span = document.createElement('span')
            span.className = 'g3-label'
            span.textContent = text
            const isNotice = text.includes('非实地导览')
            span.style.cssText = `position:fixed;left:${(1 + v.x) * 50}%;top:${(1 - v.y) * 50}%;transform:translate(-50%,-50%);` +
              `background:${isNotice ? 'rgba(166,46,38,0.92)' : 'rgba(252,250,244,0.92)'};` +
              `color:${isNotice ? '#fff' : '#1e2422'};border:1px solid rgba(40,48,44,0.35);border-radius:4px;` +
              `padding:3px 8px;font:600 ${isNotice ? '15px' : '14px'} "PingFang SC","STHeiti",sans-serif;white-space:nowrap;z-index:9999;`
            document.body.append(span)
          }
        }, {id: school.id, labels: school.labels})
        await page.screenshot({path: `docs/schools/${school.id}-overview.jpg`, type: 'jpeg', quality: 86})
      }
      await page.screenshot({path: `captures/schools/${school.id}/${viewName}.png`})
    }
    console.log(`[${school.id}] 4 views captured`)
  }

  // Walkability check in walk mode across all 6 schools
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?verify&mode=walk`)
  await page.waitForFunction(() => window.viewer?.walk?.active, null, {timeout: 60000})
  for (const school of SHOTS) {
    const walkCheck = await page.evaluate(async ({id, walkStart, walkInside}) => {
      const {manifest, walk} = window.viewer
      const {position} = manifest.landmarks.find(e => e.id === id)
      walk.leave()
      const sx = position[0] + walkStart[0], sz = position[2] + walkStart[1]
      const ix = position[0] + walkInside[0], iz = position[2] + walkInside[1]
      const spawned = await walk.enter(sx, sz, 0, 'g3-street')
      const streetProbe = walk.probe()
      walk.leave()
      const insideSpawned = await walk.enter(ix, iz, 0, 'g3-inside')
      walk.drive(0.3, -0.95)
      for (let i = 0; i < 18; i++) walk.tick(0.1)
      const insideProbe = walk.probe()
      walk.drive(0, 0)
      return {spawned, insideSpawned, streetProbe, insideProbe}
    }, school)
    assert.ok(walkCheck.spawned, `Street spawn failed for ${school.id}`)
    assert.ok(walkCheck.insideSpawned, `Campus interior spawn failed for ${school.id}`)
    assert.equal(walkCheck.insideProbe.inHouse, false, `inHouse on ${school.id}`)
    assert.equal(walkCheck.insideProbe.resets, 0, `resets on ${school.id}`)
    console.log(`[${school.id}] walkability OK (street=${walkCheck.streetProbe.x.toFixed(1)},${walkCheck.streetProbe.z.toFixed(1)} inside=${walkCheck.insideProbe.x.toFixed(1)},${walkCheck.insideProbe.z.toFixed(1)})`)
  }
  assert.deepEqual(errors, [])
} finally {
  await browser?.close()
  await server.close()
}
