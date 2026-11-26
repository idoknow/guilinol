import * as THREE from 'three'
import { shareAtmosphere } from '../look/atmosphere'
import { MAIN_DETAIL_LAYER } from '../look/mirror-layer'
import { atmo } from '../look/time'
import { freezeStatic } from '../static-freeze'
import {
  getCityUpgradeAnisotropy,
  getCityUpgradeIndex,
  getCityUpgradeQuality,
  getLoadedShard,
  isCityUpgradeEnabled,
  onCityUpgradeAnisotropy,
  onCityUpgradeQuality,
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

function readTexPixelSize(tex: THREE.Texture): [number, number] | null {
  const img = tex.image as { naturalWidth?: number; naturalHeight?: number; width?: number; height?: number } | undefined
  const w = img?.naturalWidth || img?.width || 0
  const h = img?.naturalHeight || img?.height || 0
  return w > 0 && h > 0 ? [w, h] : null
}

function loadSrgbTex(url: string, onLoad?: (tex: THREE.Texture) => void): THREE.Texture {
  const tex = new THREE.TextureLoader().load(url, loaded => {
    loaded.needsUpdate = true
    onLoad?.(loaded)
  })
  tex.colorSpace = THREE.SRGBColorSpace
  tex.generateMipmaps = true
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.wrapS = THREE.ClampToEdgeWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  tex.anisotropy = getCityUpgradeAnisotropy()
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
  fasciaTexSize: [number, number] | null
  bladeTexSize: [number, number] | null
  setAnisotropy(aniso: number): void
  dispose(): void
}

function createSharedResources(
  onFasciaTexLoad?: (size: [number, number]) => void,
  onBladeTexLoad?: (size: [number, number]) => void,
): SharedResources {
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

  const res: SharedResources = {
    eavesWallsMat,
    acGeom,
    acTex,
    acMat,
    fasciaMap: null as unknown as THREE.Texture,
    fasciaEmitMap: null as unknown as THREE.Texture,
    fasciaMat: null as unknown as THREE.MeshStandardMaterial,
    bladeMap: null as unknown as THREE.Texture,
    bladeMat: null as unknown as THREE.MeshStandardMaterial,
    fasciaTexSize: null,
    bladeTexSize: null,
    setAnisotropy(aniso: number) {
      for (const tex of [res.fasciaMap, res.fasciaEmitMap, res.bladeMap]) {
        if (tex && tex.anisotropy !== aniso) {
          tex.anisotropy = aniso
          tex.needsUpdate = true
        }
      }
    },
    dispose() {
      eavesWallsMat.dispose()
      acGeom.dispose(); acTex.dispose(); acMat.dispose()
      res.fasciaMap.dispose(); res.fasciaEmitMap.dispose(); res.fasciaMat.dispose()
      res.bladeMap.dispose(); res.bladeMat.dispose()
    },
  }

  res.fasciaMap = loadSrgbTex(`${BASE_URL}/shop-fascias.webp`, tex => {
    const sz = readTexPixelSize(tex)
    if (sz) {
      res.fasciaTexSize = sz
      onFasciaTexLoad?.(sz)
    }
  })
  res.fasciaEmitMap = loadSrgbTex(`${BASE_URL}/shop-fascias-emit.webp`)
  res.fasciaMat = new THREE.MeshStandardMaterial({
    map: res.fasciaMap,
    emissive: new THREE.Color(0xffffff),
    emissiveMap: res.fasciaEmitMap,
    emissiveIntensity: 1.0,
    roughness: 0.50,
    metalness: 0.10,
  })
  res.fasciaMat.onBeforeCompile = shader => {
    shareAtmosphere(shader)
    shader.uniforms.uNight = atmo.uNight
    shader.uniforms.uSun = atmo.uSun
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSignWorldNormal;')
      .replace(
        '#include <beginnormal_vertex>',
        '#include <beginnormal_vertex>\nvSignWorldNormal = normalize(mat3(modelMatrix) * objectNormal);',
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;\nuniform vec3 uSun;\nvarying vec3 vSignWorldNormal;')
      .replace('#include <color_fragment>', `#include <color_fragment>
#ifdef USE_FOG
float spW = sin(vFogWorld.x * 0.11 + vFogWorld.z * 0.08) * cos(vFogWorld.z * 0.13 - vFogWorld.y * 0.22);
diffuseColor.rgb *= 1.0 + spW * 0.045;
#endif`)
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
float signSunFacing = clamp(dot(normalize(vSignWorldNormal), normalize(uSun)), 0.0, 1.0);
float signDayFill = mix(0.175, 0.075, smoothstep(0.05, 0.65, signSunFacing)) * (1.0 - uNight);
totalEmissiveRadiance *= (uNight * 0.96);
totalEmissiveRadiance += diffuseColor.rgb * signDayFill;`,
      )
  }
  res.fasciaMat.customProgramCacheKey = () => 'city-upgrade-fascias-v2'

  res.bladeMap = loadSrgbTex(`${BASE_URL}/shop-blades.webp`, tex => {
    const sz = readTexPixelSize(tex)
    if (sz) {
      res.bladeTexSize = sz
      onBladeTexLoad?.(sz)
    }
  })
  res.bladeMat = new THREE.MeshStandardMaterial({ map: res.bladeMap, roughness: 0.46, metalness: 0.08 })
  res.bladeMat.onBeforeCompile = shader => {
    shareAtmosphere(shader)
    shader.uniforms.uNight = atmo.uNight
    shader.uniforms.uSun = atmo.uSun
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSignWorldNormal;')
      .replace(
        '#include <beginnormal_vertex>',
        '#include <beginnormal_vertex>\nvSignWorldNormal = normalize(mat3(modelMatrix) * objectNormal);',
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;\nuniform vec3 uSun;\nvarying vec3 vSignWorldNormal;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
float bladeSunFacing = clamp(dot(normalize(vSignWorldNormal), normalize(uSun)), 0.0, 1.0);
float bladeDayFill = mix(0.15, 0.065, smoothstep(0.05, 0.65, bladeSunFacing)) * (1.0 - uNight);
totalEmissiveRadiance += diffuseColor.rgb * (uNight * 0.88 + bladeDayFill);`,
      )
  }
  res.bladeMat.customProgramCacheKey = () => 'city-upgrade-blades-v2'

  return res
}

type FasciaTuple = NonNullable<CityUpgradeShard['fascias']>[number]
type EaveTuple = NonNullable<CityUpgradeShard['eaves']>[number]

interface ResolvedEave {
  x1: number
  z1: number
  x2: number
  z2: number
  y: number
  nx: number
  nz: number
  kind: number
  reach: number
  drop: number
  thick: number
}

// Resolve spatial & sightline clearance between 3D eaves/awnings and shopfront fascias:
// - kind === 0 (2F grey-tile eave): tighten overhang above shopfronts and lift lip cleanly above
//   both eye-level and 25-degree downward third-person camera sightlines to fascia top.
// - kind === 1 (alley rain awning): press below fascia bottom with compact reach so awning never
//   slices through fascia geometry or blocks eye-level / third-person view of sign letters & icons.
function resolveEaveClearance(eave: EaveTuple, fascias: FasciaTuple[]): ResolvedEave | null {
  const [x1, z1, x2, z2, ey, enx, enz, kind] = eave
  const dx = x2 - x1, dz = z2 - z1
  const elen = Math.hypot(dx, dz)
  if (elen < 0.05) return null

  const ex = dx / elen, ez = dz / elen
  let reach = kind === 0 ? 0.96 : 0.88
  let drop = kind === 0 ? 0.40 : 0.28
  let thick = kind === 0 ? 0.09 : 0.05

  let minFBot = Infinity
  let maxFTop = -Infinity
  let maxFd = 0
  let hasOverlap = false

  for (let i = 0; i < fascias.length; i++) {
    const [fx, fy, fz, fyaw, fw, fh, fd] = fascias[i]
    const fBot = fy - fh * 0.5
    const fTop = fy + fh * 0.5
    if (fTop < ey - 1.65 || fBot > ey + 1.65) continue

    const fnx = Math.sin(fyaw), fnz = Math.cos(fyaw)
    const dot = fnx * enx + fnz * enz
    const s = (fx - x1) * ex + (fz - z1) * ez
    let matched = false

    if (dot >= 0.55) {
      const perp = (fx - x1) * enx + (fz - z1) * enz
      if (perp >= -0.45 && perp <= reach + 0.35 && s + fw * 0.5 + 0.35 >= 0 && s - fw * 0.5 - 0.35 <= elen) {
        matched = true
      }
    } else {
      const t = Math.max(0, Math.min(1, s / elen))
      const px = x1 + dx * t, pz = z1 + dz * t
      const qx = px + enx * reach, qz = pz + enz * reach
      const d0 = Math.hypot(px - fx, pz - fz)
      const d1 = Math.hypot(qx - fx, qz - fz)
      if (Math.min(d0, d1) <= fw * 0.5 + 0.55) {
        const pf0 = (px - fx) * fnx + (pz - fz) * fnz
        const pf1 = (qx - fx) * fnx + (qz - fz) * fnz
        if (Math.max(pf0, pf1) >= -0.05 && Math.min(pf0, pf1) <= 1.5) {
          matched = true
        }
      }
    }

    if (matched) {
      hasOverlap = true
      if (fBot < minFBot) minFBot = fBot
      if (fTop > maxFTop) maxFTop = fTop
      if (fd > maxFd) maxFd = fd
    }
  }

  if (!hasOverlap) {
    return { x1, z1, x2, z2, y: ey, nx: enx, nz: enz, kind, reach, drop, thick }
  }

  if (kind === 0) {
    reach = 0.72
    drop = 0.26
    thick = 0.08
    // Keep outer lip bottom above 25-deg downward sightline to fascia top (+0.08m clearance)
    const needLipBot = maxFTop + Math.max(0.10, (reach - maxFd) * 0.47 + 0.08)
    const yAdj = Math.max(ey, needLipBot + drop + thick)
    if (yAdj - ey > 1.45) return null
    return { x1, z1, x2, z2, y: yAdj, nx: enx, nz: enz, kind, reach, drop, thick }
  }

  reach = 0.50
  drop = 0.14
  thick = 0.04
  // Press alley awning cleanly below fascia bottom (0.10m physical gap + unobstructed eye-level ray)
  const yAdj = Math.min(ey, minFBot - 0.10)
  if (ey - yAdj > 1.35) return null
  return { x1, z1, x2, z2, y: yAdj, nx: enx, nz: enz, kind, reach, drop, thick }
}

// Combined 2F grey-tile eaves + sun-faded alley awnings + subtle compound walls + street sign poles (1 DrawCall per shard!)
function buildEavesAndWalls(shard: CityUpgradeShard, mat: THREE.MeshStandardMaterial): { mesh: THREE.Mesh; box: THREE.Box3 } | null {
  const eaves = shard.eaves ?? []
  const fascias = shard.fascias ?? []
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
    const resolved = resolveEaveClearance(eaves[i], fascias)
    if (!resolved) continue
    const { x1, z1, x2, z2, y, nx, nz, kind, reach, drop, thick } = resolved

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

function fallbackFasciaTexSize(cols: number, rows: number): [number, number] {
  if (cols === 6 && rows === 16) return [3840, 2560]
  return [cols * 384, rows * 192]
}

function buildShopFascias(
  shard: CityUpgradeShard,
  mat: THREE.MeshStandardMaterial,
  grid: [number, number],
  texSize: [number, number] | null,
): { mesh: THREE.Mesh; box: THREE.Box3; texSize: [number, number] } | null {
  const list = shard.fascias ?? []
  if (!list.length) return null
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = []
  const cols = Math.max(1, grid[0] || 6)
  const rows = Math.max(1, grid[1] || 16)
  const total = cols * rows
  const usedSize = texSize ?? fallbackFasciaTexSize(cols, rows)
  const du = 1 / Math.max(1, usedSize[0])
  const dv = 1 / Math.max(1, usedSize[1])

  for (const [x, y, z, yaw, fw, fh, fd, aidx] of list) {
    const cell = ((aidx % total) + total) % total
    const col = cell % cols
    const row = Math.floor(cell / cols)
    const u0 = col / cols, u1 = (col + 1) / cols
    const v1 = 1 - row / rows, v0 = 1 - (row + 1) / rows
    // 1-texel inset on front face prevents mipmap/bilinear neighbor-cell bleeding across atlas seams
    const fu0 = u0 + du, fu1 = u1 - du
    const fv0 = v0 + dv, fv1 = v1 - dv
    const bu0 = u0 + du * 2, bu1 = u0 + du * 4
    const bv1 = v1 - dv * 2, bv0 = v1 - dv * 4

    const hx = fw * 0.5, hy = fh * 0.5
    const pt = localPt(x, y, z, yaw)
    const fBL = pt(-hx, -hy, fd), fBR = pt(hx, -hy, fd), fTR = pt(hx, hy, fd), fTL = pt(-hx, hy, fd)
    const bBL = pt(-hx, -hy, -0.02), bBR = pt(hx, -hy, -0.02), bTR = pt(hx, hy, -0.02), bTL = pt(-hx, hy, -0.02)

    pushUvQuad(pos, nor, uv, idx, fBL, fBR, fTR, fTL, fu0, fv0, fu1, fv1)
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
  return { mesh: freezeStatic(mesh), box: geom.boundingBox!.clone(), texSize: usedSize }
}

function buildShopBlades(
  shard: CityUpgradeShard,
  mat: THREE.MeshStandardMaterial,
  grid: [number, number],
  texSize: [number, number] | null,
): { mesh: THREE.Mesh; box: THREE.Box3; texSize: [number, number] } | null {
  const list = shard.blades ?? []
  if (!list.length) return null
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = []
  const cols = Math.max(1, grid[0] || 8)
  const rows = Math.max(1, grid[1] || 2)
  const total = cols * rows
  const usedSize: [number, number] = texSize ?? [cols * 128, rows * 512]
  const du = 1 / Math.max(1, usedSize[0])
  const dv = 1 / Math.max(1, usedSize[1])
  const w = 0.52, h = 1.42, d = 0.11

  for (const [x, y, z, yaw, bi] of list) {
    const li = ((bi % total) + total) % total
    const col = li % cols, row = Math.floor(li / cols)
    const u0 = col / cols, u1 = (col + 1) / cols
    const v1 = 1 - row / rows, v0 = 1 - (row + 1) / rows
    const fu0 = u0 + du, fu1 = u1 - du
    const fv0 = v0 + dv, fv1 = v1 - dv
    const bu0 = u0 + du * 2, bu1 = u0 + du * 4
    const bv1 = v1 - dv * 2, bv0 = v1 - dv * 4
    const pt = localPt(x, y, z, yaw)
    const hx = d * 0.5, hy = h * 0.5
    pushUvQuad(pos, nor, uv, idx, pt(hx, -hy, 0), pt(hx, -hy, w), pt(hx, hy, w), pt(hx, hy, 0), fu0, fv0, fu1, fv1)
    pushUvQuad(pos, nor, uv, idx, pt(-hx, -hy, w), pt(-hx, -hy, 0), pt(-hx, hy, 0), pt(-hx, hy, w), fu0, fv0, fu1, fv1)
    pushUvQuad(pos, nor, uv, idx, pt(-hx, -hy, w), pt(hx, -hy, w), pt(hx, hy, w), pt(-hx, hy, w), bu0, bv0, bu1, bv1)
    pushUvQuad(pos, nor, uv, idx, pt(-hx, hy, 0), pt(hx, hy, 0), pt(hx, hy, w), pt(-hx, hy, w), bu0, bv0, bu1, bv1)
    pushUvQuad(pos, nor, uv, idx, pt(-hx, -hy, w), pt(hx, -hy, w), pt(hx, -hy, 0), pt(-hx, -hy, 0), bu0, bv0, bu1, bv1)
  }

  const geom = makeUvGeom(pos, nor, uv, idx)
  const mesh = new THREE.Mesh(geom, mat)
  mesh.name = 'city-upgrade-shop-blades'
  mesh.layers.set(MAIN_DETAIL_LAYER)
  mesh.userData.noShadowCast = true
  return { mesh: freezeStatic(mesh), box: geom.boundingBox!.clone(), texSize: usedSize }
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
  plateTex.colorSpace = THREE.SRGBColorSpace
  plateTex.generateMipmaps = true
  plateTex.minFilter = THREE.LinearMipmapLinearFilter
  plateTex.magFilter = THREE.LinearFilter
  plateTex.anisotropy = getCityUpgradeAnisotropy()

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
  shard: CityUpgradeShard
  group: THREE.Group
  fascias: { mesh: THREE.Mesh; box: THREE.Box3; texSize: [number, number] } | null
  eavesWalls: { mesh: THREE.Mesh; box: THREE.Box3 } | null
  blades: { mesh: THREE.Mesh; box: THREE.Box3; texSize: [number, number] } | null
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

  function rebuildMountedFascias(actualSize: [number, number]): void {
    if (!shared || !mounted.size) return
    const index = getCityUpgradeIndex()
    const fasciaGrid: [number, number] = index?.fasciaGrid ?? [6, 16]
    for (const entry of mounted.values()) {
      if (!entry.fascias) continue
      if (entry.fascias.texSize[0] === actualSize[0] && entry.fascias.texSize[1] === actualSize[1]) continue
      const wasVisible = entry.fascias.mesh.visible
      entry.group.remove(entry.fascias.mesh)
      entry.fascias.mesh.geometry.dispose()
      const next = buildShopFascias(entry.shard, shared.fasciaMat, fasciaGrid, actualSize)
      entry.fascias = next
      if (next) {
        next.mesh.visible = wasVisible
        entry.group.add(next.mesh)
      }
    }
  }

  function rebuildMountedBlades(actualSize: [number, number]): void {
    if (!shared || !mounted.size) return
    const index = getCityUpgradeIndex()
    const bladeGrid: [number, number] = index?.bladeGrid ?? [8, 2]
    for (const entry of mounted.values()) {
      if (!entry.blades) continue
      if (entry.blades.texSize[0] === actualSize[0] && entry.blades.texSize[1] === actualSize[1]) continue
      const wasVisible = entry.blades.mesh.visible
      entry.group.remove(entry.blades.mesh)
      entry.blades.mesh.geometry.dispose()
      const next = buildShopBlades(entry.shard, shared.bladeMat, bladeGrid, actualSize)
      entry.blades = next
      if (next) {
        next.mesh.visible = wasVisible
        entry.group.add(next.mesh)
      }
    }
  }

  function ensureShared(): SharedResources {
    return (shared ??= createSharedResources(rebuildMountedFascias, rebuildMountedBlades))
  }

  function mountShard(key: string, shard: CityUpgradeShard): void {
    if (mounted.has(key)) return
    const res = ensureShared()
    const index = getCityUpgradeIndex()
    const fasciaGrid: [number, number] = index?.fasciaGrid ?? [6, 16]
    const bladeGrid: [number, number] = index?.bladeGrid ?? [8, 2]

    const group = new THREE.Group()
    group.name = `city-upgrade-shard:${key}`

    const fascias = buildShopFascias(shard, res.fasciaMat, fasciaGrid, res.fasciaTexSize)
    const eavesWalls = buildEavesAndWalls(shard, res.eavesWallsMat)
    const blades = buildShopBlades(shard, res.bladeMat, bladeGrid, res.bladeTexSize)
    const acUnits = buildAcUnits(shard, res)
    const streetSigns = buildStreetSignPlates(shard.streetSigns ?? [])

    if (fascias) group.add(fascias.mesh)
    if (eavesWalls) group.add(eavesWalls.mesh)
    if (blades) group.add(blades.mesh)
    if (acUnits) group.add(acUnits.mesh)
    if (streetSigns) group.add(streetSigns.mesh)

    root.add(group)
    const entry: MountedShard = {
      key,
      shard,
      group,
      fascias,
      eavesWalls,
      blades,
      acUnits,
      streetSigns,
      dispose() {
        entry.fascias?.mesh.geometry.dispose()
        entry.eavesWalls?.mesh.geometry.dispose()
        entry.blades?.mesh.geometry.dispose()
        entry.acUnits?.mesh.dispose()
        if (entry.streetSigns) {
          entry.streetSigns.plateGeom.dispose()
          entry.streetSigns.plateTex.dispose()
          entry.streetSigns.plateMat.dispose()
        }
        group.removeFromParent()
      },
    }
    mounted.set(key, entry)
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
    const isLow = getCityUpgradeQuality() === 'low'
    const fasciaDist = isAerial ? (isLow ? 140 : 220) : Math.min(streetRadius, isLow ? 120 : 195)
    const eavesDist = isAerial ? (isLow ? 110 : 180) : Math.min(streetRadius, isLow ? 95 : 145)
    const bladeDist = isAerial ? 0 : Math.min(streetRadius, isLow ? 60 : 110)
    const acDist = isAerial || isLow ? 0 : Math.min(streetRadius, 75)
    const signDist = isAerial ? 0 : Math.min(streetRadius, isLow ? 65 : 85)

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

  const offToggle = onCityUpgradeToggle(on => {
    root.visible = on
    if (on) lastCam.set(Infinity, Infinity, Infinity)
  })
  const offQuality = onCityUpgradeQuality(() => {
    lastCam.set(Infinity, Infinity, Infinity)
  })
  const offAniso = onCityUpgradeAnisotropy(aniso => {
    shared?.setAnisotropy(aniso)
    for (const entry of mounted.values()) {
      if (entry.streetSigns && entry.streetSigns.plateTex.anisotropy !== aniso) {
        entry.streetSigns.plateTex.anisotropy = aniso
        entry.streetSigns.plateTex.needsUpdate = true
      }
    }
  })

  return {
    root,
    update,
    mountedCount: () => mounted.size,
    dispose() {
      offToggle()
      offQuality()
      offAniso()
      for (const key of Array.from(mounted.keys())) unmountShard(key)
      shared?.dispose()
      shared = null
      root.removeFromParent()
    },
  }
}
