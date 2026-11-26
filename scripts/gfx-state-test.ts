import assert from 'node:assert/strict'
import test from 'node:test'
import {gfxDefaults} from '../web/src/look/gfx-config'
import {sample} from '../web/src/look/gfx-state'

test('sparse hourly presets interpolate and wrap without mutating the source',()=>{
  const config=structuredClone(gfxDefaults)
  config.presets.dusk={exposure:2,bloom:{intensity:1},shadow:{mapSize:1024}}
  const blended=sample(config,17.05)
  assert.ok(Math.abs(blended.exposure-1.5)<1e-6)
  assert.ok(Math.abs(blended.bloom.intensity-.8)<1e-6)
  assert.equal(blended.bloom.threshold,config.bloom.threshold)
  assert.equal(sample(config,18.1).shadow.mapSize,1024)
  assert.deepEqual(sample(config,-3),sample(config,21))
  assert.deepEqual(sample(config,24),sample(config,0))
  assert.equal(config.exposure,1)
})
