import test from 'node:test'
import assert from 'node:assert/strict'
import {gfxDefaults,validGfx} from '../lib/gfx.ts'

test('neutral defaults and sparse presets',()=>{
  const config=structuredClone(gfxDefaults)
  assert.ok(validGfx(config))
  config.presets.dusk={ao:{intensity:0.3},toneMapping:'aces'}
  assert.ok(validGfx(config))
})
test('reject malformed overrides and unsupported targets',()=>{
  for(const patch of [{shadow:{mapSize:9000}},{ao:{enabled:1}},{exposure:Infinity},{toneMapping:'neutral'},JSON.parse('{"__proto__":{}}')]){
    const config=structuredClone(gfxDefaults)
    config.presets.night=patch
    assert.equal(validGfx(config),false)
  }
  assert.equal(validGfx({...gfxDefaults,dof:{}}),false)
})

test('bounded shadow refresh and low AO opt-in',()=>{
  assert.equal(gfxDefaults.ao.lowEnabled,false)
  for(const shadow of [{updateEvery:0},{updateEvery:2.5},{updateEvery:5},{distance:0},{distance:301}]){
    assert.equal(validGfx({...gfxDefaults,shadow:{...gfxDefaults.shadow,...shadow}}),false)
  }
})
