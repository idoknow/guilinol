import * as THREE from 'three'
import { shopLocalToWorld, type DrinksSiteCandidate } from '../site.ts'
import type { SampledPlotTerrain } from './plot-sampler.ts'

export interface BuiltPlotMeshes {
  readonly apronMesh: THREE.Mesh
  readonly plinthMesh: THREE.Mesh
  readonly curbTrimMesh: THREE.Mesh
  dispose(): void
}

function buildUniformAxes(minVal: number, maxVal: number, anchors: number[], step = 0.45): number[] {
  const uniqueAnchors = anchors
    .filter(a => a >= minVal - 1e-4 && a <= maxVal + 1e-4)
    .sort((a, b) => a - b)
    .filter((a, idx, arr) => idx === 0 || a - arr[idx - 1]! > 1e-4)
  const merged = [...uniqueAnchors]
  const count = Math.max(4, Math.ceil((maxVal - minVal) / step))
  for (let i = 0; i <= count; i++) {
    const v = minVal + ((maxVal - minVal) * i) / count
    if (!merged.some(a => Math.abs(a - v) < 0.12)) {
      merged.push(v)
    }
  }
  merged.sort((a, b) => a - b)
  return merged
}

function buildSubdividedSurfaceGeometry(
  site: DrinksSiteCandidate,
  sampled: SampledPlotTerrain,
): THREE.BufferGeometry {
  const { spec, plotY } = sampled
  const xMin = spec.outerXMin - 0.16
  const xMax = spec.outerXMax + 0.16
  const zMin = spec.outerZMin - 0.16
  const zMax = spec.outerZMax + 0.16

  const xs = buildUniformAxes(
    xMin,
    xMax,
    [xMin, spec.outerXMin, spec.padXMin, -spec.corePadHalfW, 0, spec.corePadHalfW, spec.padXMax, spec.outerXMax, xMax],
    0.45,
  )
  const zs = buildUniformAxes(
    zMin,
    zMax,
    [zMin, spec.outerZMin, spec.padZMin, spec.zFront, spec.wingZMax, spec.wingOuterZMax, spec.padZMax, spec.outerZMax, zMax],
    0.45,
  )

  const cols = xs.length
  const rows = zs.length
  const positions = new Float32Array(cols * rows * 3)
  const colors = new Float32Array(cols * rows * 3)
  const indices: number[] = []

  const cPad = new THREE.Color('#9a9992') // 与解放东路 [9] 灰石人行道齐平衔接的前场砖面色
  const cSlope = new THREE.Color('#868781') // 平顺收坡石阶衔接色

  for (let r = 0; r < rows; r++) {
    const lz = zs[r]!
    for (let c = 0; c < cols; c++) {
      const lx = xs[c]!
      const idx = r * cols + c
      const localZLimit = sampled.maxLevelZForX(lx)
      const localOuterZ = sampled.outerZForX(lx)
      const onPad =
        lx >= spec.padXMin - 1e-4 &&
        lx <= spec.padXMax + 1e-4 &&
        lz >= spec.padZMin - 1e-4 &&
        lz <= localZLimit + 1e-4

      const w = shopLocalToWorld(site, lx, lz)
      const outsideOuter =
        lx <= spec.outerXMin + 1e-4 ||
        lx >= spec.outerXMax - 1e-4 ||
        lz <= spec.outerZMin + 1e-4 ||
        lz >= localOuterZ - 1e-4

      const surfWorldY = onPad
        ? plotY
        : outsideOuter
          ? sampled.sampleTerrainAt(w.x, w.z)
          : sampled.sampleSurfaceAt(w.x, w.z)

      positions[idx * 3] = lx
      positions[idx * 3 + 1] = surfWorldY - plotY - 0.003
      positions[idx * 3 + 2] = lz

      // 使用平滑的落坡比过渡色带，消除生硬跳色
      const dz = Math.max(0, lz - localZLimit, spec.padZMin - lz)
      const dx = Math.max(0, lx - spec.padXMax, spec.padXMin - lx)
      const slopeMix = onPad ? 0 : Math.min(1, Math.hypot(dx, dz) / 2.2)
      const colR = cPad.r + (cSlope.r - cPad.r) * slopeMix
      const colG = cPad.g + (cSlope.g - cPad.g) * slopeMix
      const colB = cPad.b + (cSlope.b - cPad.b) * slopeMix
      colors[idx * 3] = colR
      colors[idx * 3 + 1] = colG
      colors[idx * 3 + 2] = colB
    }
  }

  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c
      const b = r * cols + (c + 1)
      const d = (r + 1) * cols + c
      const e = (r + 1) * cols + (c + 1)
      // 对称棋盘格分三角，彻底消除单向条纹折痕
      if ((r + c) % 2 === 0) {
        indices.push(a, d, b, b, d, e)
      } else {
        indices.push(a, d, e, a, e, b)
      }
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  return geo
}

function buildRetainingPlinthGeometry(
  site: DrinksSiteCandidate,
  sampled: SampledPlotTerrain,
): THREE.BufferGeometry {
  const { spec, plotY, groundMinY } = sampled
  const footingFloorWorldY = Math.min(groundMinY - 1.0, plotY - 1.2)
  const localBottomY = footingFloorWorldY - plotY

  // 严格内缩于平层边缘内部 0.25m 沿周向采样，保证挡墙永不从坡面角穿出形成黑楔子
  const inset = 0.25
  const xMin = spec.padXMin + inset
  const xMax = spec.padXMax - inset
  const zMin = spec.padZMin + inset
  const padSamples: Array<[number, number, number]> = []

  const pushSample = (lx: number, lz: number) => {
    const w = shopLocalToWorld(site, lx, lz)
    const rawBot = Math.min(localBottomY, sampled.sampleTerrainAt(w.x, w.z) - plotY - 0.85)
    padSamples.push([lx, lz, rawBot])
  }

  const xSteps = Math.max(8, Math.ceil((xMax - xMin) / 0.5))
  for (let i = 0; i <= xSteps; i++) {
    const lx = xMin + ((xMax - xMin) * i) / xSteps
    pushSample(lx, Math.max(zMin + 0.1, sampled.maxLevelZForX(lx) - inset))
  }
  const eastZEnd = Math.max(zMin + 0.1, sampled.maxLevelZForX(xMax) - inset)
  for (let i = 1; i < 6; i++) {
    pushSample(xMax, eastZEnd + ((zMin - eastZEnd) * i) / 6)
  }
  for (let i = 0; i <= xSteps; i++) {
    const lx = xMax - ((xMax - xMin) * i) / xSteps
    pushSample(lx, zMin)
  }
  const westZEnd = Math.max(zMin + 0.1, sampled.maxLevelZForX(xMin) - inset)
  for (let i = 1; i < 6; i++) {
    pushSample(xMin, zMin + ((westZEnd - zMin) * i) / 6)
  }

  const positions: number[] = []
  const topY = -0.04
  for (let i = 0; i < padSamples.length; i++) {
    const [ax, az, aBot] = padSamples[i]!
    const [bx, bz, bBot] = padSamples[(i + 1) % padSamples.length]!
    positions.push(ax, topY, az, ax, aBot, az, bx, bBot, bz)
    positions.push(ax, topY, az, bx, bBot, bz, bx, topY, bz)
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.computeVertexNormals()
  return geo
}

export function buildPlotMeshes(
  site: DrinksSiteCandidate,
  sampled: SampledPlotTerrain,
): BuiltPlotMeshes {
  const apronGeo = buildSubdividedSurfaceGeometry(site, sampled)
  const plinthGeo = buildRetainingPlinthGeometry(site, sampled)

  const curbW = Math.max(2, (sampled.spec.corePadHalfW - 0.2) * 2)
  const curbGeo = new THREE.BoxGeometry(curbW, 0.025, 0.12)
  curbGeo.translate(0, -0.008, sampled.spec.padZMax - 0.04)

  const apronMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.9,
    metalness: 0.04,
  })
  const plinthMat = new THREE.MeshStandardMaterial({
    color: '#737670',
    roughness: 0.92,
    metalness: 0.05,
  })
  const curbMat = new THREE.MeshStandardMaterial({
    color: '#a6a59e',
    roughness: 0.85,
    metalness: 0.05,
  })

  const apronMesh = new THREE.Mesh(apronGeo, apronMat)
  apronMesh.name = 'drinks.terrain.apron-slope'

  const plinthMesh = new THREE.Mesh(plinthGeo, plinthMat)
  plinthMesh.name = 'drinks.terrain.retaining-plinth'

  const curbTrimMesh = new THREE.Mesh(curbGeo, curbMat)
  curbTrimMesh.name = 'drinks.terrain.curb-trim'

  return {
    apronMesh,
    plinthMesh,
    curbTrimMesh,
    dispose() {
      apronGeo.dispose()
      plinthGeo.dispose()
      curbGeo.dispose()
      apronMat.dispose()
      plinthMat.dispose()
      curbMat.dispose()
    },
  }
}