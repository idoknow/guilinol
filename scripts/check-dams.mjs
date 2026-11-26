import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {gunzipSync} from 'node:zlib'

const directory=process.argv[2]??'dist/world'
const manifest=JSON.parse(readFileSync(join(directory,'manifest.json')))
const footprints=JSON.parse(readFileSync(new URL('../pipeline/dam-cells.json',import.meta.url)))
const passages=JSON.parse(readFileSync(new URL('../pipeline/dam-passages.json',import.meta.url)))
const vehicles=JSON.parse(gunzipSync(readFileSync(join(directory,manifest.vehicles.file))))
const routes=new Set(vehicles.routes.flatMap(leg=>leg.path.map(([x,,z])=>[x/4,z/4].join())))
const required=new Set(['way/1008909377','way/1008909373'])
for(const [id,runs] of Object.entries(footprints)){
  const openings=new Set((passages[id]?.cells??[]).map(pair=>pair.join()))
  let checked=0
  for(const tile of manifest.chunks){
    const relevant=runs.filter(([row,start,end])=>row*4>=tile.z&&row*4<=tile.z+256&&end*4>=tile.x&&start*4<=tile.x+256)
    if(!relevant.length)continue
    const buffer=readFileSync(join(directory,tile.file));assert.equal(buffer.length,tile.bytes)
    const data=gunzipSync(buffer)
    for(const [row,start,end] of relevant)for(let col=start;col<=end;col++){
      if(col*4<tile.x||col*4>tile.x+256)continue
      const index=(row-tile.z/4)*65+col-tile.x/4
      const key=[col,row].join(),water=data.readInt16LE(8474+2*index)
      if(openings.has(key))assert.notEqual(water,-32768,`${id} ferry passage dry at ${key}`)
      else {
        assert.equal(water,-32768,`${id} still wet at ${key}`)
        assert(!routes.has(key),`${id} route crosses solid dam at ${key}`)
      }
      checked++
    }
  }
  if(checked)required.delete(id)
  console.log(`${id}: ${checked} dam samples checked`)
}
assert.equal(required.size,0,'Both acceptance sites must be present')
for(const [id,passage] of Object.entries(passages)){
  const [start,end]=passage.leg
  const leg=vehicles.routes.find(r=>r.start===start && r.end===end && r.kind==='boat')
  const openings=new Set(passage.cells.map(cell=>cell.join()))
  assert(leg?.path.some(([x,,z])=>openings.has([x/4,z/4].join())),`${start} → ${end} bypasses ${id}`)
}
const baseline=JSON.parse(readFileSync(new URL('../pipeline/unchanged-vessel-legs.json',import.meta.url)))
for(const [kind,start,end,expected] of baseline){
  const leg=vehicles.routes.find(r=>r.kind===kind && r.start===start && r.end===end)
  assert(leg,`${kind} ${start} → ${end} missing`)
  assert.equal(createHash('sha256').update(JSON.stringify(leg.path)).digest('hex'),expected,`${start} → ${end} differs from published path`)
}
if(process.argv[3]){
  const referenceDirectory=process.argv[3]
  const referenceManifest=JSON.parse(readFileSync(join(referenceDirectory,'manifest.json')))
  const reference=JSON.parse(gunzipSync(readFileSync(join(referenceDirectory,referenceManifest.vehicles.file))))
  assert.equal(Object.keys(vehicles.docks).length,10,'Expected ten docks')
  assert.equal(vehicles.routes.length,10,'Expected ten vessel legs')
  assert.deepEqual(vehicles.docks,reference.docks,'Dock coordinates differ across extents')
  assert.deepEqual(vehicles.routes,reference.routes,'Vessel paths differ across extents')
  console.log('10 docks and 10 three-dimensional paths match the reference world')
}
