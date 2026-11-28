import assert from 'node:assert/strict'
import test from 'node:test'
import {
  LIGHT_PALETTE,
  buildLampClusterGeometry,
  createBoatLanternRig,
  createHeadlightBeamRig,
  createLampClusterMaterial,
  headlightPolicyFor,
} from './vehicle-lights.ts'
import {WATER_LAYER} from '../look/water.ts'

test('headlightPolicyFor locks shared bicycles & shared e-bikes while allowing personal bikes & cars', () => {
  const sharedBike = headlightPolicyFor('bike', 'shared')
  assert.equal(sharedBike.switchable, false)
  assert.equal(sharedBike.maxMode, 'low')
  assert.ok(sharedBike.rejectMessage)

  const sharedBicycle = headlightPolicyFor('bicycle', 'normal')
  assert.equal(sharedBicycle.switchable, false)
  assert.equal(sharedBicycle.maxMode, 'off')

  const personalBike = headlightPolicyFor('bike', 'normal')
  assert.equal(personalBike.switchable, true)
  assert.equal(personalBike.maxMode, 'high')

  const car = headlightPolicyFor('car', 'normal')
  assert.equal(car.switchable, true)
  assert.equal(car.maxMode, 'high')
})

test('headlight beam rig shares atmo uniforms, stays <=2 draw calls, and dims smoothly on crank sag', () => {
  const rig = createHeadlightBeamRig('car')
  rig.update({mode: 'off', night: 1})
  assert.equal(rig.probe().drawCalls, 0)
  assert.equal(rig.probe().usesDynamicLights, false)

  rig.update({mode: 'low', night: 1})
  const fullLow = rig.probe()
  assert.equal(fullLow.drawCalls, 2)
  assert.ok(fullLow.intensity > 0.5)

  rig.update({mode: 'low', night: 1, crankDim: 0.55})
  const sagLow = rig.probe()
  assert.ok(sagLow.intensity < fullLow.intensity * 0.7)

  rig.update({mode: 'high', night: 1})
  const fullHigh = rig.probe()
  assert.equal(fullHigh.drawCalls, 2)
  assert.ok(fullHigh.intensity > fullLow.intensity)

  // Verify shared atmo uniforms exist on shader materials
  const coneMat = rig.coneMesh.material
  assert.ok('uNight' in coneMat.uniforms && 'uFog' in coneMat.uniforms && 'uRain' in coneMat.uniforms)
  rig.dispose()
})

test('lamp cluster merges lens, halo, and wet streak into a single geometry with 8-channel zero-alloc controls', () => {
  const geom = buildLampClusterGeometry([
    {
      channel: 0,
      pos: [-0.6, 0.4, -2.2],
      size: [0.22, 0.07, 0.02],
      dir: [0, 0, -1],
      color: LIGHT_PALETTE.carLow,
      offColor: LIGHT_PALETTE.lensOffFront,
      haloSize: 0.48,
      wetGroundY: -0.45,
    },
    {
      channel: 1,
      pos: [0.6, 0.4, 2.2],
      size: [0.34, 0.05, 0.02],
      dir: [0, 0, 1],
      color: LIGHT_PALETTE.brakeCore,
      offColor: LIGHT_PALETTE.lensOffTail,
      haloSize: 0.42,
      wetGroundY: -0.45,
    },
  ])
  assert.ok(geom.attributes.position.count > 70)
  assert.ok(geom.attributes.aMeta && geom.attributes.aLitColor)

  const mat = createLampClusterMaterial()
  mat.setChannel(0, 1.2)
  mat.setChannel(1, 0.8)
  assert.ok(Math.abs(mat.channels[0] - 1.2) < 1e-5)
  assert.ok(Math.abs(mat.channels[1] - 0.8) < 1e-5)
  geom.dispose()
  mat.dispose()
})

test('boat lantern rig gates on night, obeys LOD & shimmer budget, and splits layer 0 vs WATER_LAYER', () => {
  const rig = createBoatLanternRig('rowboat')
  assert.equal(rig.lanternMesh.layers.isEnabled(0), true)
  assert.equal(rig.shimmerMesh.layers.isEnabled(WATER_LAYER), true)

  // Daytime off => 0 draw calls
  rig.update({night: 0, distance: 10})
  assert.equal(rig.probe().drawCalls, 0)
  assert.equal(rig.probe().lit, false)

  // Night nearby => 2 draw calls (lantern + water shimmer), 0 dynamic lights
  rig.update({night: 0.9, distance: 25})
  assert.equal(rig.probe().drawCalls, 2)
  assert.equal(rig.probe().usesDynamicLights, false)

  // Far LOD (>260m) hides shimmer (1 draw call); >600m hides all (0 draw calls)
  rig.update({night: 0.9, distance: 320})
  assert.equal(rig.probe().drawCalls, 1)
  assert.equal(rig.probe().shimmerVisible, false)

  rig.update({night: 0.9, distance: 650})
  assert.equal(rig.probe().drawCalls, 0)

  // Manual toggle overrides day/night cleanly
  rig.update({night: 0, distance: 15, manualOn: true})
  assert.equal(rig.probe().lit, true)
  rig.update({night: 1, distance: 15, manualOn: false})
  assert.equal(rig.probe().lit, false)
  rig.dispose()
})
