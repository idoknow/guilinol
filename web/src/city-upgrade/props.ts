import * as THREE from 'three'
import { shareAtmosphere } from '../look/atmosphere'
import { MAIN_DETAIL_LAYER } from '../look/mirror-layer'
import { atmo } from '../look/time'
import { freezeStatic } from '../static-freeze'
import {
  getCityUpgradeIndex,
  getLoadedShard,
  isCityUpgradeEnabled,
  onCityUpgradeToggle,
  type CityUpgradeShard,
  type StreetSignDef,
} from './state'

type V3 = [number, number, number]

const BASE_URL = './city-upgrade'

function pushQuad(
  pos: number[], nor: number[], col: number[], idx: number[],
  a: V3, b: V3, c: V3, d: V3, rgb: V3,
) {
  const base = pos.length / 3
  const v0 = new THREE.Vector3(...a)
  const n = new THREE.Vector3(...b).sub(v0).cross(new THREE.Vector3(...c).sub(v0)).normalize()
  for (const p of [a, b, c, d]) {
    pos.push(p[0], p[1], p[2])
    nor.push(n.x, n.y, n.z)
    col.push(rgb[0], rgb[1], rgb[2])
  }
  idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
}

function pushUvQuad(
  pos: number[], nor: number[], uv: number[], idx: number[],
  a: V3, b: V3, c: V3, d: V3, u0: number, v0: number, u1: number, v1: number,
) {
  const base = pos.length / 3
  const vA = new THREE.Vector3(...a)
  const n = new THREE.Vector3(...b).sub(vA).cross(new THREE.Vector3(...c).sub(vA)).normalize()
  pos.push(...a, ...b, ...c, ...d)
  for (let k = 0; k < 4; k++) nor.push(n.x, n.y, n.z)
  uv.push(u0, v0, u1, v0, u1, v1, u0, v1)
  idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
}

function localPt(cx: number, cy: number, cz: number, yaw: number) {
  const co = Math.cos(yaw), si = Math.sin(yaw)
  return (lx: number, ly: number, lz: number): V3 => [
    cx + lx * co + lz * si,
    cy + ly,
    cz - lx * si + lz * co,
  ]
}

function pushBox(
  pos: number[], nor: number[], col: number[], idx: number[],
  cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, rgb: V3, yaw = 0,
) {
  const hx = sx * 0.5, hy = sy * 0.5, hz = sz * 0.5
  const pt = localPt(cx, cy, cz, yaw)
  const p000 = pt(-hx, -hy, -hz), p100 = pt(hx, -hy, -hz), p110 = pt(hx, hy, -hz), p010 = pt(-hx, hy, -hz)
  const p001 = pt(-hx, -hy, hz), p101 = pt(hx, -hy, hz), p111 = pt(hx, hy, hz), p011 = pt(-hx, hy, hz)
  pushQuad(pos, nor, col, idx, p001, p101, p111, p011, rgb)
  pushQuad(pos, nor, col, idx, p100, p000, p010, p110, rgb)
  pushQuad(pos, nor, col, idx, p011, p111, p110, p010, rgb)
  pushQuad(pos, nor, col, idx, p000, p100, p101, p001, rgb)
  pushQuad(pos, nor, col, idx, p101, p100, p110, p111, rgb)
  pushQuad(pos, nor, col, idx, p000, p001, p011, p010, rgb)
}

function hexRgb(hex: number): V3 {
  const c = new THREE.Color(hex)
  return [c.r, c.g, c.b]
}

function makeColorGeom(pos: number[], nor: number[], col: number[], idx: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  g.setIndex(idx)
  g.computeBoundingBox()
  g.computeBoundingSphere()
  return g
}

function makeUvGeom(pos: number[], nor: number[], uv: number[], idx: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeBoundingBox()
  g.computeBoundingSphere()
  return g
}

function loadSrgbTex(url: string): THREE.Texture {
  const tex = new THREE.TextureLoader().load(url)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

interface SharedResources {
  eavesWallsMat: THREE.MeshStandardMaterial
  acGeom: THREE.BoxGeometry
  acTex: THREE.CanvasTexture
  acMat: THREE.MeshStandardMaterial
  fasciaMap: THREE.Texture
  fasciaEmitMap: THREE.Texture
  fasciaMat: THREE.MeshStandardMaterial
  bladeMap: THREE.Texture
  bladeMat: THREE.MeshStandardMaterial
  dispose(): void
}

function createSharedResources(): SharedResources {
  const eavesWallsMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.80,
    metalness: 0.06,
    side: THREE.DoubleSide,
  })
  eavesWallsMat.onBeforeCompile = shader => shareAtmosphere(shader)
  eavesWallsMat.customProgramCacheKey = () => 'city-upgrade-eaves-walls-v1'

  const acCanvas = document.createElement('canvas')
  acCanvas.width = 128; acCanvas.height = 96
  const ctx = acCanvas.getContext('2d')!
  ctx.fillStyle = '#dadcd8'; ctx.fillRect(0, 0, 128, 96)
  ctx.strokeStyle = '#9aa0a4'; ctx.lineWidth = 4; ctx.strokeRect(2, 2, 124, 92)
  ctx.fillStyle = '#2d3135'; ctx.beginPath(); ctx.arc(44, 48, 30, 0, Math.PI * 2); ctx.fill()
  ctx.strokeStyle = '#6c7278'; ctx.lineWidth = 2.5
  for (let y = 20; y <= 76; y += 7) { ctx.beginPath(); ctx.moveTo(16, y); ctx.lineTo(72, y); ctx.stroke() }
  ctx.fillStyle = '#aeb4b8'; ctx.fillRect(88, 22, 28, 12); ctx.fillRect(88, 42, 28, 30)
  const acTex = new THREE.CanvasTexture(acCanvas)
  acTex.colorSpace = THREE.SRGBColorSpace
  const acGeom = new THREE.BoxGeometry(0.78, 0.54, 0.30)
  const acMat = new THREE.MeshStandardMaterial({ map: acTex, roughness: 0.62, metalness: 0.12 })
  acMat.onBeforeCompile = shader => shareAtmosphere(shader)
  acMat.customProgramCacheKey = () => 'city-upgrade-ac-v1'

  const fasciaMap = loadSrgbTex(`${BASE_URL}/shop-fascias.webp`)
  const fasciaEmitMap = loadSrgbTex(`${BASE_URL}/shop-fascias-emit.webp`)
  const fasciaMat = new THREE.MeshStandardMaterial({
    map: fasciaMap,
    emissive: new THREE.Color(0xffffff),
    emissiveMap: fasciaEmitMap,
    emissiveIntensity: 1.0,
    roughness: 0.50,
    metalness: 0.10,
  })
  fasciaMat.onBeforeCompile = shader => {
    shareAtmosphere(shader)
    shader.uniforms.uNight = atmo.uNight
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;')
      .replace('#include <color_fragment>', `#include <color_fragment>
#ifdef USE_FOG
float spW = sin(vFogWorld.x * 0.11 + vFogWorld.z * 0.08) * cos(vFogWorld.z * 0.13 - vFogWorld.y * 0.22);
diffuseColor.rgb *= 1.0 + spW * 0.045;
#endif`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= (uNight * 0.98);\ntotalEmissiveRadiance += diffuseColor.rgb * (0.095 * (1.0 - uNight));')
  }
  fasciaMat.customProgramCacheKey = () => 'city-upgrade-fascias-v1'

  const bladeMap = loadSrgbTex(`${BASE_URL}/shop-blades.webp`)
  const bladeMat = new THREE.MeshStandardMaterial({ map: bladeMap, roughness: 0.46, metalness: 0.08 })
  bladeMat.onBeforeCompile = shader => {
    shareAtmosphere(shader)
    shader.uniforms.uNight = atmo.uNight
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * uNight * 0.90;')
  }
  bladeMat.customProgramCacheKey = () => 'city-upgrade-blades-v1'

  return {
    eavesWallsMat, acGeom, acTex, acMat, fasciaMap, fasciaEmitMap, fasciaMat, bladeMap, bladeMat,
    dispose() {
      eavesWallsMat.dispose()
      acGeom.dispose(); acTex.dispose(); acMat.dispose()
      fasciaMap.dispose(); fasciaEmitMap.dispose(); fasciaMat.dispose()
      bladeMap.dispose(); bladeMat.dispose()
    },
  }
}

// Combined 2F grey-tile eaves + sun-faded alley awnings + subtle compound walls + street sign poles (1 DrawCall per shard!)
function buildEavesAndWalls(shard: CityUpgradeShard, mat: THREE.MeshStandardMaterial): { mesh: THREE.Mesh; box: THREE.Box3 } | null {
  const eaves = shard.eaves ?? []
  const walls = shard.walls ?? []
  const signs = shard.streetSigns ?? []
  if (!eaves.length && !walls.length && !signs.length) return null

  const pos: number[] = [], nor: number[] = [], col: number[] = [], idx: number[] = []
  const tileMain = hexRgb(0x454a50)
  const tileRib = hexRgb(0x363b40)
  const ridgeWhite = hexRgb(0xe8e5dc)
  const fasciaDark = hexRgb(0x342922)
  // Sun-faded, rain-weathered Guilin alley corrugated awning tones (zero vivid plastic blue/green!)
  const awningColors = [hexRgb(0x535e69), hexRgb(0x525e57), hexRgb(0x6b5350), hexRgb(0x5c6063)]

  for (let i = 0; i < eaves.length; i++) {
    const [x1, z1, x2, z2, y, nx, nz, kind] = eaves[i]
    const reach = kind === 0 ? 0.96 : 0.88
    const drop = kind === 0 ? 0.40 : 0.28
    const thick = kind === 0 ? 0.09 : 0.05

    const aTop: V3 = [x1, y, z1], bTop: V3 = [x2, y, z2]
    const cTop: V3 = [x2 + nx * reach, y - drop, z2 + nz * reach]
    const dTop: V3 = [x1 + nx * reach, y - drop, z1 + nz * reach]
    const aBot: V3 = [x1, y - thick, z1], bBot: V3 = [x2, y - thick, z2]
    const cBot: V3 = [x2 + nx * reach, y - drop - thick, z2 + nz * reach]
    const dBot: V3 = [x1 + nx * reach, y - drop - thick, z1 + nz * reach]

    const topCol = kind === 0 ? tileMain : awningColors[i % awningColors.length]
    const underCol = kind === 0 ? fasciaDark : hexRgb(0x3b4046)
    pushQuad(pos, nor, col, idx, aTop, dTop, cTop, bTop, topCol)
    pushQuad(pos, nor, col, idx, aBot, bBot, cBot, dBot, underCol)
    pushQuad(pos, nor, col, idx, dTop, dBot, cBot, cTop, kind === 0 ? tileRib : topCol)

    if (kind === 0) {
      const rA: V3 = [x1, y + 0.14, z1], rB: V3 = [x2, y + 0.14, z2]
      const rC: V3 = [x2 + nx * 0.14, y + 0.14, z2 + nz * 0.14]
      const rD: V3 = [x1 + nx * 0.14, y + 0.14, z1 + nz * 0.14]
      pushQuad(pos, nor, col, idx, rA, rD, rC, rB, ridgeWhite)
      pushQuad(pos, nor, col, idx, rD, [x1 + nx * 0.14, y, z1 + nz * 0.14], [x2 + nx * 0.14, y, z2 + nz * 0.14], rC, ridgeWhite)
    }
  }

  const plinthCol = hexRgb(0xb8b5ae), plasterCol = hexRgb(0xe6e3da), copingCol = hexRgb(0x52575c), ironCol = hexRgb(0x282d32)
  for (const [x1, z1, x2, z2, y1, y2, kind] of walls) {
    const dx = x2 - x1, dz = z2 - z1, len = Math.hypot(dx, dz)
    if (len < 3.0) continue
    const ux = dx / len, uz = dz / len, yaw = Math.atan2(ux, uz)
    const mx = (x1 + x2) * 0.5, mz = (z1 + z2) * 0.5, my = (y1 + y2) * 0.5

    pushBox(pos, nor, col, idx, mx, my + 0.42, mz, 0.34, 0.86, len, kind === 0 ? plinthCol : plasterCol, yaw)
    pushBox(pos, nor, col, idx, mx, my + 0.88, mz, 0.40, 0.08, len, copingCol, yaw)
    if (kind === 0) {
      const piers = Math.max(2, Math.round(len / 4.8) + 1)
      for (let pi = 0; pi < piers; pi++) {
        const t = pi / (piers - 1)
        pushBox(pos, nor, col, idx, x1 + dx * t, y1 + (y2 - y1) * t + 1.15, z1 + dz * t, 0.44, 2.30, 0.44, plasterCol, yaw)
        pushBox(pos, nor, col, idx, x1 + dx * t, y1 + (y2 - y1) * t + 2.34, z1 + dz * t, 0.52, 0.10, 0.52, copingCol, yaw)
      }
      pushBox(pos, nor, col, idx, mx, my + 2.08, mz, 0.06, 0.06, len, ironCol, yaw)
      pushBox(pos, nor, col, idx, mx, my + 1.06, mz, 0.06, 0.06, len, ironCol, yaw)
      const nBars = Math.min(80, Math.floor(len / 0.42))
      for (let bi = 1; bi < nBars; bi++) {
        const t = bi / nBars
        pushBox(pos, nor, col, idx, x1 + dx * t, y1 + (y2 - y1) * t + 1.56, z1 + dz * t, 0.035, 1.04, 0.035, ironCol, yaw)
      }
    } else {
      pushBox(pos, nor, col, idx, mx, my + 1.50, mz, 0.28, 1.25, len, plasterCol, yaw)
      pushBox(pos, nor, col, idx, mx, my + 2.18, mz, 0.42, 0.14, len, copingCol, yaw)
    }
  }

  const blueSleeve = hexRgb(0x345270), poleSilver = hexRgb(0xc2c7cc), capDark = hexRgb(0x2d3338)
  for (const s of signs) {
    // Base sleeve (0..1.40m) + silver pole stopping cleanly at 2.71m right under the sign plate (2.71..3.29m)
    pushBox(pos, nor, col, idx, s.x, s.y + 0.70, s.z, 0.11, 1.40, 0.11, blueSleeve, s.yaw)
    pushBox(pos, nor, col, idx, s.x, s.y + 2.055, s.z, 0.085, 1.31, 0.085, poleSilver, s.yaw)
    pushBox(pos, nor, col, idx, s.x, s.y + 2.69, s.z, 0.38, 0.05, 0.10, capDark, s.yaw)
    pushBox(pos, nor, col, idx, s.x, s.y + 3.32, s.z, 1.60, 0.06, 0.09, capDark, s.yaw)
  }

  if (!idx.length) return null
  const geom = makeColorGeom(pos, nor, col, idx)
  const mesh = new THREE.Mesh(geom, mat)
  mesh.name = 'city-upgrade-eaves-walls'
  mesh.layers.set(MAIN_DETAIL_LAYER)
  mesh.userData.noShadowCast = true
  return { mesh: freezeStatic(mesh), box: geom.boundingBox!.clone() }
}

function buildAcUnits(shard: CityUpgradeShard, shared: SharedResources): { mesh: THREE.InstancedMesh; box: THREE.Box3 } | null {
  const list = shard.acUnits ?? []
  if (!list.length) return null
  const inst = new THREE.InstancedMesh(shared.acGeom, shared.acMat, list.length)
  inst.name = 'city-upgrade-ac-units'
  inst.layers.set(MAIN_DETAIL_LAYER)
  inst.userData.noShadowCast = true
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0)
  const box = new THREE.Box3()
  for (let i = 0; i < list.length; i++) {
    const [x, y, z, yaw] = list[i]
    p.set(x, y, z); q.setFromAxisAngle(up, yaw); m.compose(p, q, s); inst.setMatrixAt(i, m)
    box.expandByPoint(p)
  }
  box.expandByScalar(0.6)
  inst.instanceMatrix.needsUpdate = true
  inst.computeBoundingBox()
  inst.computeBoundingSphere()
  return { mesh: freezeStatic(inst), box }
}

function buildShopFascias(
  shard: CityUpgradeShard,
  mat: THREE.MeshStandardMaterial,
  grid: [number, number],
): { mesh: THREE.Mesh; box: THREE.Box3 } | null {
  const list = shard.fascias ?? []
  if (!list.length) return null
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = []
  const cols = Math.max(1, grid[0] || 8)
  const rows = Math.max(1, grid[1] || 6)
  const total = cols * rows
  const du = 1 / (512 * cols)
  const dv = 1 / (256 * rows)

  for (const [x, y, z, yaw, fw, fh, fd, aidx] of list) {
    const cell = ((aidx % total) + total) % total
    const col = cell % cols
    const row = Math.floor(cell / cols)
    const u0 = col / cols, u1 = (col + 1) / cols
    const v1 = 1 - row / rows, v0 = 1 - (row + 1) / rows
    const bu0 = u0 + du, bu1 = u0 + du * 3
    const bv1 = v1 - dv, bv0 = v1 - dv * 3

    const hx = fw * 0.5, hy = fh * 0.5
    const pt = localPt(x, y, z, yaw)
    const fBL = pt(-hx, -hy, fd), fBR = pt(hx, -hy, fd), fTR = pt(hx, hy, fd), fTL = pt(-hx, hy, fd)
    const bBL = pt(-hx, -hy, -0.02), bBR = pt(hx, -hy, -0.02), bTR = pt(hx, hy, -0.02), bTL = pt(-hx, hy, -0.02)

    pushUvQuad(pos, nor, uv, idx, fBL, fBR, fTR, fTL, u0, v0, u1, v1)
    pushUvQuad(pos, nor, uv, idx, fTL, fTR, bTR, bTL, bu0, bv0, bu1, bv1)
    pushUvQuad(pos, nor, uv, idx, bBL, bBR, fBR, fBL, bu0, bv0, bu1, bv1)
    pushUvQuad(pos, nor, uv, idx, fBR, bBR, bTR, fTR, bu0, bv0, bu1, bv1)
    pushUvQuad(pos, nor, uv, idx, bBL, fBL, fTL, bTL, bu0, bv0, bu1, bv1)
  }

  const geom = makeUvGeom(pos, nor, uv, idx)
  const mesh = new THREE.Mesh(geom, mat)
  mesh.name = 'city-upgrade-shop-fascias'
  mesh.layers.set(MAIN_DETAIL_LAYER)
  mesh.userData.noShadowCast = true
  return { mesh: freezeStatic(mesh), box: geom.boundingBox!.clone() }
}

function buildShopBlades(
  shard: CityUpgradeShard,
  mat: THREE.MeshStandardMaterial,
  grid: [number, number],
): { mesh: THREE.Mesh; box: THREE.Box3 } | null {
  const list = shard.blades ?? []
  if (!list.length) return null
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = []
  const cols = Math.max(1, grid[0] || 8)
  const rows = Math.max(1, grid[1] || 2)
  const total = cols * rows
  const du = 1 / (128 * cols)
  const dv = 1 / (512 * rows)
  const w = 0.52, h = 1.42, d = 0.11

  for (const [x, y, z, yaw, bi] of list) {
    const li = ((bi % total) + total) % total
    const col = li % cols, row = Math.floor(li / cols)
    const u0 = col / cols, u1 = (col + 1) / cols
    const v1 = 1 - row / rows, v0 = 1 - (row + 1) / rows
    const bu0 = u0 + du, bu1 = u0 + du * 3
    const bv1 = v1 - dv, bv0 = v1 - dv * 3
    const pt = localPt(x, y, z, yaw)
    const hx = d * 0.5, hy = h * 0.5
    pushUvQuad(pos, nor, uv, idx, pt(hx, -hy, 0), pt(hx, -hy, w), pt(hx, hy, w), pt(hx, hy, 0), u0, v0, u1, v1)
    pushUvQuad(pos, nor, uv, idx, pt(-hx, -hy, w), pt(-hx, -hy, 0), pt(-hx, hy, 0), pt(-hx, hy, w), u0, v0, u1, v1)
    pushUvQuad(pos, nor, uv, idx, pt(-hx, -hy, w), pt(hx, -hy, w), pt(hx, hy, w), pt(-hx, hy, w), bu0, bv0, bu1, bv1)
    pushUvQuad(pos, nor, uv, idx, pt(-hx, hy, 0), pt(hx, hy, 0), pt(hx, hy, w), pt(-hx, hy, w), bu0, bv0, bu1, bv1)
    pushUvQuad(pos, nor, uv, idx, pt(-hx, -hy, w), pt(hx, -hy, w), pt(hx, -hy, 0), pt(-hx, -hy, 0), bu0, bv0, bu1, bv1)
  }

  const geom = makeUvGeom(pos, nor, uv, idx)
  const mesh = new THREE.Mesh(geom, mat)
  mesh.name = 'city-upgrade-shop-blades'
  mesh.layers.set(MAIN_DETAIL_LAYER)
  mesh.userData.noShadowCast = true
  return { mesh: freezeStatic(mesh), box: geom.boundingBox!.clone() }
}

interface StreetSignBuild {
  mesh: THREE.Mesh
  box: THREE.Box3
  plateGeom: THREE.BufferGeometry
  plateTex: THREE.CanvasTexture
  plateMat: THREE.MeshStandardMaterial
}

function buildStreetSignPlates(list: StreetSignDef[]): StreetSignBuild | null {
  if (!list.length) return null
  const cols = 4, rows = Math.ceil(list.length / cols), pw = 256, ph = 96
  const canvas = document.createElement('canvas')
  canvas.width = cols * pw; canvas.height = rows * ph
  const ctx = canvas.getContext('2d')!
  for (let i = 0; i < list.length; i++) {
    const s = list[i], cx = (i % cols) * pw, cy = Math.floor(i / cols) * ph
    const isEW = Math.abs(Math.sin(s.yaw)) >= Math.abs(Math.cos(s.yaw))
    ctx.fillStyle = '#eceee9'; ctx.fillRect(cx, cy, pw, 22)
    ctx.fillStyle = '#294d78'; ctx.fillRect(cx, cy + 22, pw, ph - 22)
    ctx.strokeStyle = '#dde2e8'; ctx.lineWidth = 3; ctx.strokeRect(cx + 2, cy + 2, pw - 4, ph - 4)
    ctx.fillStyle = '#294d78'; ctx.font = 'bold 14px sans-serif'; ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'; ctx.fillText(isEW ? '西 W' : '北 N', cx + 10, cy + 12)
    ctx.textAlign = 'right'; ctx.fillText(isEW ? 'E 东' : 'S 南', cx + pw - 10, cy + 12)
    ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'
    ctx.font = 'bold 34px "PingFang SC", "Hiragino Sans GB", sans-serif'
    ctx.fillText(s.zh, cx + pw * 0.5, cy + 50, pw - 18)
    ctx.font = 'bold 15px sans-serif'; ctx.fillStyle = '#dce8f8'
    ctx.fillText(s.en, cx + pw * 0.5, cy + 79, pw - 18)
  }
  const plateTex = new THREE.CanvasTexture(canvas)
  plateTex.colorSpace = THREE.SRGBColorSpace; plateTex.anisotropy = 4

  const bPos: number[] = [], bNor: number[] = [], bUv: number[] = [], bIdx: number[] = []
  const plateW = 1.56, plateH = 0.58, plateD = 0.07
  for (let i = 0; i < list.length; i++) {
    const s = list[i]
    const u0 = (i % cols) / cols, u1 = u0 + 1 / cols
    const v1 = 1 - Math.floor(i / cols) / rows, v0 = v1 - 1 / rows
    const pt = localPt(s.x, s.y + 3.00, s.z, s.yaw)
    const hx = plateW * 0.5, hy = plateH * 0.5, hz = plateD * 0.5
    pushUvQuad(bPos, bNor, bUv, bIdx, pt(-hx, -hy, hz), pt(hx, -hy, hz), pt(hx, hy, hz), pt(-hx, hy, hz), u0, v0, u1, v1)
    pushUvQuad(bPos, bNor, bUv, bIdx, pt(hx, -hy, -hz), pt(-hx, -hy, -hz), pt(-hx, hy, -hz), pt(hx, hy, -hz), u0, v0, u1, v1)
  }
  const plateGeom = makeUvGeom(bPos, bNor, bUv, bIdx)
  const plateMat = new THREE.MeshStandardMaterial({ map: plateTex, roughness: 0.38, metalness: 0.1 })
  plateMat.onBeforeCompile = shader => {
    shareAtmosphere(shader)
    shader.uniforms.uNight = atmo.uNight
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * uNight * 0.25;')
  }
  plateMat.customProgramCacheKey = () => 'city-upgrade-sign-plates-v1'
  const plateMesh = new THREE.Mesh(plateGeom, plateMat)
  plateMesh.name = 'city-upgrade-street-signs'
  plateMesh.layers.set(MAIN_DETAIL_LAYER)
  plateMesh.userData.noShadowCast = true
  return { mesh: freezeStatic(plateMesh), box: plateGeom.boundingBox!.clone(), plateGeom, plateTex, plateMat }
}

interface MountedShard {
  key: string
  group: THREE.Group
  fascias: { mesh: THREE.Mesh; box: THREE.Box3 } | null
  eavesWalls: { mesh: THREE.Mesh; box: THREE.Box3 } | null
  blades: { mesh: THREE.Mesh; box: THREE.Box3 } | null
  acUnits: { mesh: THREE.InstancedMesh; box: THREE.Box3 } | null
  streetSigns: StreetSignBuild | null
  dispose(): void
}

export function mountCityUpgradeProps(scene: THREE.Scene) {
  const root = new THREE.Group()
  root.name = 'city-upgrade-props'
  root.visible = isCityUpgradeEnabled()
  scene.add(root)

  let shared: SharedResources | null = null
  const mounted = new Map<string, MountedShard>()
  const lastCam = new THREE.Vector3(Infinity, Infinity, Infinity)
  const lastQuat = new THREE.Quaternion(0, 0, 0, 0)
  const frustum = new THREE.Frustum()
  const projScreen = new THREE.Matrix4()
  let lastRadius = -1

  function ensureShared(): SharedResources {
    return (shared ??= createSharedResources())
  }

  function mountShard(key: string, shard: CityUpgradeShard): void {
    if (mounted.has(key)) return
    const res = ensureShared()
    const index = getCityUpgradeIndex()
    const fasciaGrid: [number, number] = index?.fasciaGrid ?? [8, 6]
    const bladeGrid: [number, number] = index?.bladeGrid ?? [8, 2]

    const group = new THREE.Group()
    group.name = `city-upgrade-shard:${key}`

    const fascias = buildShopFascias(shard, res.fasciaMat, fasciaGrid)
    const eavesWalls = buildEavesAndWalls(shard, res.eavesWallsMat)
    const blades = buildShopBlades(shard, res.bladeMat, bladeGrid)
    const acUnits = buildAcUnits(shard, res)
    const streetSigns = buildStreetSignPlates(shard.streetSigns ?? [])

    if (fascias) group.add(fascias.mesh)
    if (eavesWalls) group.add(eavesWalls.mesh)
    if (blades) group.add(blades.mesh)
    if (acUnits) group.add(acUnits.mesh)
    if (streetSigns) group.add(streetSigns.mesh)

    root.add(group)
    mounted.set(key, {
      key,
      group,
      fascias,
      eavesWalls,
      blades,
      acUnits,
      streetSigns,
      dispose() {
        fascias?.mesh.geometry.dispose()
        eavesWalls?.mesh.geometry.dispose()
        blades?.mesh.geometry.dispose()
        acUnits?.mesh.dispose()
        if (streetSigns) {
          streetSigns.plateGeom.dispose()
          streetSigns.plateTex.dispose()
          streetSigns.plateMat.dispose()
        }
        group.removeFromParent()
      },
    })
    lastCam.set(Infinity, Infinity, Infinity)
  }

  function unmountShard(key: string): void {
    const entry = mounted.get(key)
    if (!entry) return
    entry.dispose()
    mounted.delete(key)
    lastCam.set(Infinity, Infinity, Infinity)
  }

  function update(camera: THREE.PerspectiveCamera, activeKeys: Set<string>, streetRadius: number, force = false): void {
    if (!isCityUpgradeEnabled()) {
      root.visible = false
      if (mounted.size) {
        for (const key of Array.from(mounted.keys())) unmountShard(key)
      }
      return
    }
    root.visible = true

    for (const key of mounted.keys()) {
      if (!activeKeys.has(key)) unmountShard(key)
    }
    for (const key of activeKeys) {
      if (!mounted.has(key)) {
        const shard = getLoadedShard(key)
        if (shard) mountShard(key, shard)
      }
    }

    const moved =
      force ||
      lastRadius !== streetRadius ||
      camera.position.distanceToSquared(lastCam) >= 4 ||
      lastQuat.angleTo(camera.quaternion) >= 0.015
    if (!moved) return
    lastCam.copy(camera.position)
    lastQuat.copy(camera.quaternion)
    lastRadius = streetRadius

    camera.updateMatrixWorld()
    frustum.setFromProjectionMatrix(projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse))

    const cam = camera.position
    const isAerial = cam.y > 230
    const fasciaDist = isAerial ? 220 : Math.min(streetRadius, 195)
    const eavesDist = isAerial ? 180 : Math.min(streetRadius, 145)
    const bladeDist = isAerial ? 0 : Math.min(streetRadius, 110)
    const acDist = isAerial ? 0 : Math.min(streetRadius, 75)
    const signDist = isAerial ? 0 : Math.min(streetRadius, 85)

    for (const entry of mounted.values()) {
      let anyVis = false
      if (entry.fascias) {
        const v = fasciaDist > 0 && entry.fascias.box.distanceToPoint(cam) <= fasciaDist && frustum.intersectsBox(entry.fascias.box)
        entry.fascias.mesh.visible = v
        anyVis ||= v
      }
      if (entry.eavesWalls) {
        const v = eavesDist > 0 && entry.eavesWalls.box.distanceToPoint(cam) <= eavesDist && frustum.intersectsBox(entry.eavesWalls.box)
        entry.eavesWalls.mesh.visible = v
        anyVis ||= v
      }
      if (entry.blades) {
        const v = bladeDist > 0 && entry.blades.box.distanceToPoint(cam) <= bladeDist && frustum.intersectsBox(entry.blades.box)
        entry.blades.mesh.visible = v
        anyVis ||= v
      }
      if (entry.acUnits) {
        const v = acDist > 0 && entry.acUnits.box.distanceToPoint(cam) <= acDist && frustum.intersectsBox(entry.acUnits.box)
        entry.acUnits.mesh.visible = v
        anyVis ||= v
      }
      if (entry.streetSigns) {
        const v = signDist > 0 && entry.streetSigns.box.distanceToPoint(cam) <= signDist && frustum.intersectsBox(entry.streetSigns.box)
        entry.streetSigns.mesh.visible = v
        anyVis ||= v
      }
      entry.group.visible = anyVis
    }
  }

  const off = onCityUpgradeToggle(on => {
    root.visible = on
    if (on) lastCam.set(Infinity, Infinity, Infinity)
  })

  return {
    root,
    update,
    mountedCount: () => mounted.size,
    dispose() {
      off()
      for (const key of Array.from(mounted.keys())) unmountShard(key)
      shared?.dispose()
      shared = null
      root.removeFromParent()
    },
  }
}
