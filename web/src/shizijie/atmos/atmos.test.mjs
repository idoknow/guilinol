import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as THREE from 'three'

import { SHIZIJIE_B1_LAYOUT } from '../layout/index.ts'
import { SZJ_STAIRWELLS, indoorToStairLocal } from '../contract.ts'
import {
  SZJ_ATMOS_BUDGET,
  SZJ_ATMOS_PRESETS,
  countGeometryTriangles,
  createCeilingStructure,
  createLightingRig,
  createSzjAtmos,
  resolveAtmosSpec,
} from './index.ts'

const test = process.env.VITEST
  ? (await import('vitest')).test
  : (await import('node:test')).default

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** Independently measures real drawCalls, triangles, geometries, and materials by traversing Three.js scene graph. */
function auditObject3DGraph(root) {
  let drawCalls = 0
  let triangles = 0
  let pointLights = 0
  const geometries = new Set()
  const materials = new Set()
  const instancedMeshes = []

  root.traverse(obj => {
    if (obj.isPointLight) pointLights++
    if (obj.isMesh || obj.isInstancedMesh) {
      drawCalls++
      const count = obj.isInstancedMesh ? obj.count : 1
      if (obj.geometry) {
        geometries.add(obj.geometry)
        triangles += countGeometryTriangles(obj.geometry) * count
      }
      const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : []
      for (const m of mats) materials.add(m)
      if (obj.isInstancedMesh) instancedMeshes.push(obj)
    }
  })

  return { drawCalls, triangles, pointLights, geometries, materials, instancedMeshes }
}

test('k9 budget: real SHIZIJIE_B1_LAYOUT stays strictly <= 12 drawCalls and <= 40k tris across baffle & grille styles', () => {
  for (const ceilingStyle of ['baffle', 'grille']) {
    for (const preset of Object.keys(SZJ_ATMOS_PRESETS)) {
      const atmos = createSzjAtmos(SHIZIJIE_B1_LAYOUT, {
        preset,
        spec: { ceilingStyle },
      })
      const reported = atmos.getMetrics()
      const actual = auditObject3DGraph(atmos.group)

      // Reported metrics match real Three.js graph traversal exactly
      assert.equal(reported.drawCalls, actual.drawCalls, `${preset}/${ceilingStyle}: drawCalls mismatch`)
      assert.equal(reported.triangles, actual.triangles, `${preset}/${ceilingStyle}: triangles mismatch`)

      // Hard k9 ceilings
      assert.ok(actual.drawCalls > 0 && actual.drawCalls <= SZJ_ATMOS_BUDGET.maxDrawCalls,
        `${preset}/${ceilingStyle}: drawCalls=${actual.drawCalls} exceeds ${SZJ_ATMOS_BUDGET.maxDrawCalls}`)
      assert.ok(actual.triangles > 0 && actual.triangles <= SZJ_ATMOS_BUDGET.maxTriangles,
        `${preset}/${ceilingStyle}: triangles=${actual.triangles} exceeds ${SZJ_ATMOS_BUDGET.maxTriangles}`)
      assert.ok(actual.pointLights <= SZJ_ATMOS_BUDGET.maxPointLights,
        `${preset}/${ceilingStyle}: pointLights=${actual.pointLights} exceeds ${SZJ_ATMOS_BUDGET.maxPointLights}`)

      // Every expected architectural layer is instantiated
      const layerNames = new Set(reported.breakdown.map(b => b.name))
      for (const expected of [
        'szj-atmos-baffles',
        'szj-atmos-ducts',
        'szj-atmos-cable-trays',
        'szj-atmos-sprinklers',
        'szj-atmos-plenum-trim',
        'szj-atmos-linear-lamps',
        'szj-atmos-lamp-housings',
        'szj-atmos-downlights',
        'szj-atmos-cove-wash',
      ]) {
        assert.ok(layerNames.has(expected), `${preset}/${ceilingStyle}: missing layer ${expected}`)
      }

      atmos.dispose()
    }
  }
})

test('ceiling & luminaire instances exclude all 4 stairwell shafts and preserve >= 2.75m clearance for 2.3m hanging signs', () => {
  const atmos = createSzjAtmos(SHIZIJIE_B1_LAYOUT)
  const actual = auditObject3DGraph(atmos.group)
  const mat4 = new THREE.Matrix4()
  const pos = new THREE.Vector3()
  const quat = new THREE.Quaternion()
  const scale = new THREE.Vector3()

  for (const mesh of actual.instancedMeshes) {
    const isWallCove = mesh.name === 'szj-atmos-cove-wash'
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, mat4)
      mat4.decompose(pos, quat, scale)

      // Zero intrusion into any open-air stairwell shaft
      for (const st of SZJ_STAIRWELLS) {
        const local = indoorToStairLocal(st, { x: pos.x, z: pos.z })
        const insideShaft =
          Math.abs(local.x) < st.width * 0.5 + 0.1 &&
          Math.abs(local.z) < st.length * 0.5 + 0.1
        assert.equal(
          insideShaft,
          false,
          `${mesh.name}[${i}] at (${pos.x.toFixed(2)}, ${pos.z.toFixed(2)}) intrudes stairwell ${st.id}`,
        )
      }

      // Ceiling & luminaire layers stay strictly above 2.75m (clear of 2.3m hanging signs)
      if (!isWallCove) {
        const bottomY = pos.y - scale.y * 0.5
        assert.ok(
          bottomY >= SZJ_ATMOS_BUDGET.minSignClearanceY,
          `${mesh.name}[${i}] bottomY=${bottomY.toFixed(3)} drops below sign clearance ${SZJ_ATMOS_BUDGET.minSignClearanceY}`,
        )
      }
      assert.ok(
        pos.y + scale.y * 0.5 <= SHIZIJIE_B1_LAYOUT.ceilingHeight + 0.02,
        `${mesh.name}[${i}] exceeds ceilingHeight`,
      )
    }
  }

  atmos.dispose()
})

test('k9 disposal: dispose() releases 100% of geometries and materials, removes from scene, restores fog, and is idempotent', () => {
  const scene = new THREE.Scene()
  const origFog = new THREE.Fog('#112233', 10, 50)
  const origBg = new THREE.Color('#445566')
  scene.fog = origFog
  scene.background = origBg

  const atmos = createSzjAtmos(SHIZIJIE_B1_LAYOUT)
  scene.add(atmos.group)
  atmos.applyAtmosphere(scene)

  assert.ok(scene.fog instanceof THREE.FogExp2, 'applyAtmosphere should apply FogExp2')
  assert.notEqual(scene.background, origBg)

  const actual = auditObject3DGraph(atmos.group)
  assert.ok(actual.geometries.size > 0)
  assert.ok(actual.materials.size > 0)

  const disposedGeos = new Set()
  const disposedMats = new Set()
  let geoDisposeCalls = 0
  let matDisposeCalls = 0

  for (const g of actual.geometries) {
    const orig = g.dispose.bind(g)
    g.dispose = () => {
      disposedGeos.add(g)
      geoDisposeCalls++
      orig()
    }
  }
  for (const m of actual.materials) {
    const orig = m.dispose.bind(m)
    m.dispose = () => {
      disposedMats.add(m)
      matDisposeCalls++
      orig()
    }
  }

  assert.equal(atmos.isDisposed(), false)
  atmos.dispose()
  assert.equal(atmos.isDisposed(), true)
  assert.equal(atmos.ceiling.isDisposed(), true)
  assert.equal(atmos.lighting.isDisposed(), true)

  // Every single geometry & material disposed exactly once
  assert.equal(disposedGeos.size, actual.geometries.size, 'Not all BufferGeometries were disposed')
  assert.equal(disposedMats.size, actual.materials.size, 'Not all Materials were disposed')

  // Removed from parent scene and atmosphere restored
  assert.equal(scene.children.includes(atmos.group), false)
  assert.equal(atmos.group.children.length, 0)
  assert.equal(scene.fog, origFog)
  assert.equal(scene.background, origBg)

  // Idempotent double dispose does not double-free or throw
  atmos.dispose()
  assert.equal(geoDisposeCalls, actual.geometries.size)
  assert.equal(matDisposeCalls, actual.materials.size)
})

test('factory composability, preset switching, step(dt), and zero DOM / indoor-scene coupling', () => {
  const ceiling = createCeilingStructure(SHIZIJIE_B1_LAYOUT)
  const lighting = createLightingRig(SHIZIJIE_B1_LAYOUT, { preset: 'day-rush' })
  assert.ok(ceiling.getMetrics().drawCalls <= 5)
  assert.ok(lighting.getMetrics().drawCalls <= 4)
  assert.ok(lighting.lights.length >= 5)

  const scene = new THREE.Scene()
  const undo = lighting.applyAtmosphere(scene)
  assert.ok(scene.fog instanceof THREE.FogExp2)

  // Switching presets mutates lights/materials cleanly without adding drawCalls
  const beforeDc = lighting.getMetrics().drawCalls
  lighting.applySpec(resolveAtmosSpec('evening-warm'))
  assert.equal(lighting.getMetrics().drawCalls, beforeDc)
  lighting.step(1 / 60)
  lighting.step(0.5)

  undo()
  assert.equal(scene.fog, null)
  ceiling.dispose()
  lighting.dispose()

  // Static isolation audit: no DOM globals or runtime indoor-scene imports inside atmos/*.ts
  const tsFiles = fs.readdirSync(__dirname).filter(f => f.endsWith('.ts'))
  assert.ok(tsFiles.length >= 4)
  for (const file of tsFiles) {
    const src = fs.readFileSync(path.join(__dirname, file), 'utf8')
    assert.equal(/\b(window|document)\b/.test(src), false, `${file} must not reference DOM globals`)
    assert.equal(/indoor-scene/.test(src), false, `${file} must not import or mutate indoor-scene`)
  }
})
