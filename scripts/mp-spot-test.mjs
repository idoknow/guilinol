import test from 'node:test'
import assert from 'node:assert/strict'
import {readMpSpot, saveMpSpot, clearMpSpot, MP_SPOT_KEY} from '../web/src/mp-spot.ts'

const mem = () => { const m = new Map(); return {getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k),m} }

test('round-trips a walker spot', () => {
  const s = mem(); saveMpSpot({x:-812.34, z:190.06, yaw:1.23456}, s, 1000)
  assert.deepEqual(readMpSpot(s, 2000), {x:-812.3, z:190.1, yaw:1.235})
})
test('expires after 30 days and rejects junk', () => {
  const s = mem(); saveMpSpot({x:1, z:2, yaw:0}, s, 0)
  assert.equal(readMpSpot(s, 31*24*3600*1000), null)
  for (const raw of ['nope','null','[]','{"x":1,"z":2,"yaw":0}','{"x":"1","z":2,"yaw":0,"t":1}','{"x":1e9,"z":2,"yaw":0,"t":1}']) {
    s.setItem(MP_SPOT_KEY, raw); assert.equal(readMpSpot(s, 2), null, raw)
  }
  saveMpSpot({x:NaN, z:0, yaw:0}, s); assert.equal(s.getItem(MP_SPOT_KEY), '{"x":1e9,"z":2,"yaw":0,"t":1}')
  clearMpSpot(s); assert.equal(readMpSpot(s), null)
})
