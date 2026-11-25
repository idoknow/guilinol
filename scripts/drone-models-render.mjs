#!/usr/bin/env node
// IDOK-275 — load public/models/drones/*.glb with GLTFLoader in Chromium, measure THREE.Box3 + triangles,
// render a 3-view sheet per body (front ¾ / rear ¾ / side) on a mannequin-free studio background.
// Usage: node scripts/camera-models-render.mjs [outDir=$TMPDIR/camera-models]
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { chromium } from 'playwright'

const ROOT = path.resolve(import.meta.dirname, '..')
const OUT = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'drone-models'))
fs.mkdirSync(OUT, { recursive: true })

const PAGE = `<!doctype html><html><head><style>html,body{margin:0;background:#e9e6df}canvas{display:block}</style>
<script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script></head>
<body><script type="module">
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
const W = 600, H = 520
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
renderer.setPixelRatio(2); renderer.setSize(W * 3, H + 70)
renderer.toneMapping = THREE.ACESFilmicToneMapping
document.body.appendChild(renderer.domElement)
const pmrem = new THREE.PMREMGenerator(renderer)
const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
window.render = async (id, label) => {
  const gltf = await new GLTFLoader().loadAsync('/public/models/drones/' + id + '.glb')
  const obj = gltf.scene
  const box = new THREE.Box3().setFromObject(obj)
  let tris = 0; const mats = new Set(); const names = []
  obj.traverse(o => { names.push(o.name); if (o.isMesh) { tris += o.geometry.index.count / 3; mats.add(o.material.name) } })
  const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3())
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0xe9e6df)
  scene.environment = envTex
  scene.environmentIntensity = 0.55
  const sun = new THREE.DirectionalLight(0xfff4e6, 2.2); sun.position.set(0.6, 1.2, 0.4); scene.add(sun)
  const rim = new THREE.DirectionalLight(0xdfe9ff, 0.9); rim.position.set(-1, 0.4, 1); scene.add(rim)
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8273, 0.6))
  scene.add(obj)
  // origin marker (grip point) + axes: red X (grip side), green Y (top), blue Z (lens looks to -Z)
  const r = Math.max(size.x, size.y, size.z)
  const axes = new THREE.AxesHelper(r * 0.35); axes.material.depthTest = false; axes.renderOrder = 9; scene.add(axes)
  const dot = new THREE.Mesh(new THREE.SphereGeometry(r * 0.012), new THREE.MeshBasicMaterial({ color: 0xff00aa, depthTest: false })); dot.renderOrder = 10; scene.add(dot)
  const cam = new THREE.PerspectiveCamera(22, W / H, 0.01, 50)
  const views = [[0.8, 0.42, -1], [-0.9, 0.75, 0.9], [-1, 0.06, 0.0001]] // front ¾ (nose side), rear ¾ from above, left side
  renderer.setScissorTest(true)
  renderer.setClearColor(0xe9e6df); renderer.setScissor(0, 0, W * 3, H + 70); renderer.setViewport(0, 0, W * 3, H + 70); renderer.clear()
  views.forEach((v, i) => {
    const dir = new THREE.Vector3(...v).normalize()
    const dist = (r * 0.62) / Math.tan((cam.fov * Math.PI) / 360)
    cam.position.copy(center).addScaledVector(dir, dist); cam.lookAt(center); cam.updateProjectionMatrix()
    renderer.setViewport(i * W, 70, W, H); renderer.setScissor(i * W, 70, W, H)
    renderer.render(scene, cam)
  })
  renderer.setScissorTest(false)
  return { id, tris, materials: [...mats], names, size: size.toArray(), min: box.min.toArray(), max: box.max.toArray() }
}
window.ready = true
</script></body></html>`

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0])
  if (url === '/') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(PAGE) }
  const f = path.join(ROOT, url)
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end() }
  const type = f.endsWith('.js') ? 'text/javascript' : f.endsWith('.glb') ? 'model/gltf-binary' : 'application/octet-stream'
  res.writeHead(200, { 'content-type': type }); fs.createReadStream(f).pipe(res)
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
try {
  const page = await browser.newPage({ viewport: { width: 1800, height: 590 } })
  page.on('pageerror', e => console.error('pageerror', e))
  await page.goto(`http://127.0.0.1:${server.address().port}/`)
  await page.waitForFunction('window.ready')
  const LABELS = { mavic4pro: 'DJI Mavic 4 Pro', mini5pro: 'DJI Mini 5 Pro', air3s: 'DJI Air 3S', inspire3: 'DJI Inspire 3', flycart200: 'DJI FlyCart 200' }
  const results = []
  for (const id of Object.keys(LABELS)) {
    const s = await page.evaluate(([id, l]) => window.render(id, l), [id, LABELS[id]])
    const mm = s.size.map(v => (v * 1000).toFixed(1)).join(' × ')
    await page.evaluate(t => {
      let el = document.getElementById('cap'); if (!el) { el = document.createElement('div'); el.id = 'cap'; document.body.appendChild(el) }
      el.style.cssText = 'position:fixed;left:0;bottom:0;width:1800px;height:70px;font:600 20px/70px system-ui,"Noto Sans CJK SC",sans-serif;color:#2b2a27;padding-left:24px;box-sizing:border-box;background:#d9d4c9'
      el.textContent = t
    }, `${LABELS[id]} · ${s.tris} tris · ${s.materials.length} mats · Box3 ${mm} mm · 前¾ / 后¾俯 / 左侧 · 粉点=原点(机身中心) 红X 绿Y 蓝Z(机头 −Z)`)
    await page.screenshot({ path: path.join(OUT, `${id}.png`) })
    results.push(s)
    console.log(`${id.padEnd(10)} tris=${s.tris} mats=${s.materials.join(',')} size(mm)=${mm} min=${s.min.map(v => v.toFixed(4))} max=${s.max.map(v => v.toFixed(4))} nodes=${s.names.join(',')}`)
  }
  fs.writeFileSync(path.join(OUT, 'stats.json'), JSON.stringify(results, null, 2))
} finally {
  await browser.close()
  server.close()
}
