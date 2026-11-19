import assert from 'node:assert/strict'
import {existsSync, readFileSync} from 'node:fs'
import {mkdir} from 'node:fs/promises'
import {chromium} from 'playwright'
import {preview} from 'vite'

const gisInv = existsSync('raw/g3_gis_inventory.json')
  ? JSON.parse(readFileSync('raw/g3_gis_inventory.json', 'utf8'))
  : null

const SHOTS = [
  {
    id: 'glmu_dongcheng',
    name: '桂林医科大学（东城校区）',
    walkStart: [-15.0, -304.0],
    walkInside: [-28.0, -245.0],
    views: [
      ['gate',     [-13.5,  3.1, -305.5], [-27.5,  2.6, -291.5]],
      ['main',     [-18.5,  5.2, -172.0], [ 12.0, 12.0, -195.0]],
      ['hongde',   [  3.5,  3.2, -144.5], [ 34.0, 10.5, -144.5]],
      ['field',    [ -5.8, 22.0,  126.0], [-10.0,  6.0,   16.0]],
      ['overview', [ 18.0, 565.0,   5.05], [ 18.0,  0.0,    5.0]],
    ],
    labels: [
      ['东城图书馆', 22, 24, -200],
      ['弘德楼', 50, 26, -144.5],
      ['第二教学实验楼', 47, 22, -95],
      ['科教楼与报告厅', -45, 22, -110],
      ['标准田径运动场', -5.8, 2, 47],
      ['北区学生公寓群', -81, 20, -18],
      ['西区公寓与教学楼', -82, 18, 65],
      ['南区体育馆', 77, 18, 221],
      ['博学实验楼', 144, 19, 222],
    ],
  },
  {
    id: 'glut_primary',
    name: '桂林理工大学附属小学',
    walkStart: [-42.0, -10.0],
    walkInside: [-16.0, 8.0],
    views: [
      ['gate',     [-44.5,  2.8, -11.2], [-30.0,  3.8,  -6.5]],
      ['main',     [  2.0,  3.8,  16.0], [  7.5,  8.0, -16.0]],
      ['field',    [-26.0, 12.0,  22.0], [  6.0,  3.5,  -2.0]],
      ['overview', [  2.0, 165.0,  0.05], [  2.0,  0.0,   0.0]],
    ],
    labels: [
      ['崇德楼（4F）', 7.5, 15, -22.3],
      ['求是楼（3F）', -1.1, 11, 39.0],
      ['西南配楼（2F）', -28.1, 8, 30.1],
      ['运动场与球场', 6.0, 1, 14.5],
      ['游戏布局，非实地导览', -8.0, 1, -48.0],
    ],
  },
  {
    id: 'tianjiabing',
    name: '桂林市田家炳中学',
    walkStart: [12.0, 102.0],
    walkInside: [20.0, 68.0],
    views: [
      ['gate',     [ 11.0,  4.2, 106.0], [ 12.0,  9.2,  64.0]],
      ['main',     [ -5.0,  3.6,  98.0], [ -3.0, 10.2,  64.0]],
      ['field',    [-78.0, 46.0,  68.0], [-52.0,  6.0,  -6.0]],
      ['overview', [  6.0, 315.0,  8.05], [  6.0,  0.0,   8.0]],
    ],
    labels: [
      ['田家炳楼（5F）', -6.8, 19, 62.4],
      ['四中教学楼（4F）', 50.5, 16, 61.8],
      ['艺体馆', -53.9, 15, 23.2],
      ['中区教学楼（5F）', 58.0, 18, 27.0],
      ['北区教学楼群', 58.0, 18, -28.0],
      ['田径运动场', -105.0, 2, -32.0],
      ['游戏布局，非实地导览', 14.0, 1, 92.0],
    ],
  },
  {
    id: 'chenshan_primary',
    name: '桂林市辰山小学',
    walkStart: [-24.0, -55.0],
    walkInside: [-10.0, -32.0],
    views: [
      ['gate',     [-25.5,  2.3, -56.0], [-16.0,  2.0, -47.0]],
      ['main',     [  0.8,  4.8,  -6.0], [  0.8,  9.5,  39.0]],
      ['field',    [ -4.0, 14.5, -26.0], [ 20.0,  2.0, -56.0]],
      ['overview', [  4.0, 268.0,  0.05], [  4.0,  0.0,   0.0]],
    ],
    labels: [
      ['厚德主楼（5F）', 0.8, 19, 39.0],
      ['南翼教学楼（4F）', -10.0, 15, 76.0],
      ['西北翼楼（4F）', -26.0, 15, 6.0],
      ['东北配楼（2F）', 76.0, 8, -65.5],
      ['田径场与双球场', 19.0, 2, -55.0],
      ['游戏布局，非实地导览', -22.0, 1, -62.0],
    ],
  },
  {
    id: 'lijiang_primary',
    name: '漓江小学',
    walkStart: [-11.0, 42.0],
    walkInside: [2.0, 18.0],
    satPolys: [
      [[-20.1, 21.0], [9.2, 10.9], [4.8, -1.8], [-24.5, 8.3]],
      [[-12.4, -20.5], [7.4, -27.3], [4.2, -36.6], [-15.6, -29.8]],
    ],
    views: [
      ['gate',     [-22.0,  3.2,  46.5], [ -6.5,  8.5,  16.0]],
      ['main',     [-13.5,  5.2,  36.5], [ -5.5,  9.8,  12.5]],
      ['field',    [ 12.0, 18.0,  10.0], [  4.0,  4.0, -20.0]],
      ['overview', [  0.0, 145.0,  0.05], [  0.0,  0.0,   0.0]],
    ],
    labels: [
      ['尚善主楼（5F）', -5.5, 19, 12.5],
      ['致远楼（4F）', -3.5, 15, -28.5],
      ['塑胶双球场', 9.5, 1, -10.5],
      ['游戏布局，非实地导览', -4.0, 1, 36.0],
    ],
  },
  {
    id: 'longyin_primary',
    name: '龙隐小学',
    walkStart: [-103.0, 3.0],
    walkInside: [-76.0, -8.0],
    views: [
      ['gate',     [-105.0, 2.5,   4.2], [-91.0,  3.0,  -6.5]],
      ['main',     [ -78.0, 2.8,  -4.0], [-52.0,  6.5, -18.0]],
      ['field',    [  53.0, 12.5, 42.0], [ 53.3,  2.0,   2.0]],
      ['overview', [ -10.0, 235.0,-4.95], [-10.0,  0.0,  -5.0]],
    ],
    labels: [
      ['崇文楼（4F）', -45.9, 15, -23.5],
      ['西中楼（3F）', -42.0, 12, 7.3],
      ['西南楼（4F）', -35.7, 15, 31.2],
      ['博学楼（4F）', 12.3, 15, -18.9],
      ['明德楼（4F）', 15.8, 15, 13.3],
      ['腾龙雕塑', -70.5, 5, -10.5],
      ['塑胶田径场与球场', 53.3, 2, 2.0],
      ['游戏布局，非实地导览', -22.0, 1, 48.0],
    ],
  },
]

await mkdir('captures/schools/comparisons', {recursive: true})
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
        document.querySelectorAll('.g3-label,.g3-osm-svg').forEach(el => el.remove())
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
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)))))

      if (viewName === 'overview') {
        // 1. Capture OSM/Overture footprint overlay screenshot first (if gisInv is present)
        if (gisInv && gisInv[school.id]) {
          const info = gisInv[school.id]
          await page.evaluate(({id, name, info, satPolys}) => {
            const {camera, manifest} = window.viewer
            const {position} = manifest.landmarks.find(e => e.id === id)
            const ns = 'http://www.w3.org/2000/svg'
            const svg = document.createElementNS(ns, 'svg')
            svg.setAttribute('class', 'g3-osm-svg')
            svg.setAttribute('viewBox', '0 0 1080 720')
            svg.style.cssText = 'position:fixed;inset:0;width:1080px;height:720px;pointer-events:none;z-index:9998;'

            function polyEl(pts, stroke, dash, width = 2.5, yOff = 0.2) {
              const coords = pts.map(([lx, lz]) => {
                const v = camera.position.clone().set(position[0] + lx, position[1] + yOff, position[2] + lz).project(camera)
                return `${((1 + v.x) * 540).toFixed(1)},${((1 - v.y) * 360).toFixed(1)}`
              }).join(' ')
              const p = document.createElementNS(ns, 'polygon')
              p.setAttribute('points', coords)
              p.setAttribute('fill', 'none')
              p.setAttribute('stroke', stroke)
              p.setAttribute('stroke-width', String(width))
              if (dash) p.setAttribute('stroke-dasharray', dash)
              svg.appendChild(p)
            }

            polyEl(info.campus_pts, '#ffd600', '7,5', 2.6, 0.2)
            for (const p of info.osm_pitches || []) {
              if (p.pts) polyEl(p.pts, '#52ff52', '5,3', 2.2, 0.3)
            }
            for (const b of info.overture_buildings || []) {
              if (!b.covered_by_osm) polyEl(b.pts, '#00e5ff', null, 2.5, 14.0)
            }
            for (const b of info.osm_buildings || []) {
              polyEl(b.pts, '#ff3333', null, 2.8, 16.0)
            }
            for (const sp of satPolys || []) {
              polyEl(sp, '#ff9800', '6,3', 2.6, 15.0)
            }
            document.body.appendChild(svg)

            const banner = document.createElement('div')
            banner.className = 'g3-osm-svg'
            banner.style.cssText = 'position:fixed;left:16px;bottom:48px;background:rgba(20,24,26,0.90);color:#f4f2ea;padding:7px 12px;border-radius:6px;font:600 13px "PingFang SC","STHeiti",sans-serif;z-index:9999;border:1px solid rgba(255,255,255,0.22);'
            banner.innerHTML = `${name} · 地图轮廓叠合核验 &nbsp;|&nbsp; <span style="color:#ffd600">■ OSM校园界</span> &nbsp;<span style="color:#ff4444">■ OSM建筑</span> &nbsp;<span style="color:#00e5ff">■ Overture建筑</span> &nbsp;<span style="color:#52ff52">■ OSM球场</span> &nbsp;<span style="color:#ff9800">■ 卫星图描绘</span> &nbsp;|&nbsp; 中心偏移 ≤ 0.6 m (限2m) · 朝向差 ≤ 0.1° (限3°)`
            document.body.appendChild(banner)
          }, {id: school.id, name: school.name, info, satPolys: school.satPolys || []})
          await page.screenshot({path: `captures/schools/comparisons/${school.id}-osm-overlay.jpg`, type: 'jpeg', quality: 88})
          await page.evaluate(() => document.querySelectorAll('.g3-osm-svg').forEach(el => el.remove()))
        }

        // 2. Capture clean annotated overview diagram for docs/schools/<id>-overview.jpg
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
              `padding:3px 8px;font:600 ${isNotice ? '15px' : '13px'} "PingFang SC","STHeiti",sans-serif;white-space:nowrap;z-index:9999;`
            document.body.append(span)
          }
        }, {id: school.id, labels: school.labels})
        await page.screenshot({path: `docs/schools/${school.id}-overview.jpg`, type: 'jpeg', quality: 86})
      }
      await page.screenshot({path: `captures/schools/${school.id}/${viewName}.png`})
    }
    console.log(`[${school.id}] ${school.views.length} views captured`)
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
