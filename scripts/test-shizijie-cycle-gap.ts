import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {gunzipSync} from 'node:zlib'
import clip from 'polygon-clipping'
import {closeCycleGap} from '../web/src/shizijie-cycle-gap'
import {inRing} from '../web/src/polygon'
import type {Streets} from '../web/src/street-worker'

const tile=gunzipSync(readFileSync(process.argv[2]??'public/world/101_38.glc'))
assert.equal(tile.toString('ascii',0,4),'GL04')
const start=24+65*65*4+tile.readUInt32LE(4)*9+tile.readUInt32LE(8)*4
const streets:Streets=JSON.parse(tile.toString('utf8',start,start+tile.readUInt32LE(12)))[1]
const original=streets[0], repaired=closeCycleGap(original)
assert.equal(repaired.length,original.length+1)
const [kind,...rings]=repaired.at(-1)!
assert.equal(kind,5)
assert(inRing(19167,11337,[...rings[0],rings[0][0]]))
for(const [existingKind,...existing] of original){
  if([0,1,4,5,6].includes(existingKind))assert.equal(clip.intersection(rings,existing).length,0)
}
assert.equal(closeCycleGap(repaired),repaired)
const empty:Streets[0]=[]
assert.equal(closeCycleGap(empty),empty)
console.log('PASS: target covered by one cycle surface, no overlap, no repeat or open-area fill')
