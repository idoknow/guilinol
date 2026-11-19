import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {loadAtlas} from '../web/src/map/atlas.ts'

const manifest=JSON.parse(await readFile('public/world/manifest.json','utf8'))
assert.equal(manifest.version,4)
const binary=await readFile('public/world/atlas.bin')
assert.equal(manifest.atlas.bytes,binary.length)
assert.ok(binary.length<=400000)
globalThis.fetch=async url=>{
  assert.equal(url,'./world/atlas.bin')
  return new Response(binary)
}
const atlas=await loadAtlas(manifest)
assert.deepEqual(atlas.extent,manifest.extent)
const named=atlas.roads.filter(road=>road.n).length
assert.ok(named>=250 && atlas.places.length>=120)
assert.deepEqual(atlas.search('  '),[])
assert.equal(atlas.search('象鼻',1)[0].n,'象鼻山')
assert.ok(atlas.search('双塔').some(place=>['日塔','月塔'].includes(place.n)))
assert.equal(atlas.search('王城')[0].n,'靖江王城')
assert.equal(atlas.search('解放桥')[0].k,'bridge')
const campus = atlas.search('中山中学漓滨校区')[0]
assert.equal(campus.k,'school')
for (const alias of ['桂林市第九中学','桂林九中','九中']) assert.deepEqual(atlas.search(alias),[campus])
assert.equal(atlas.roadAt(campus.x,campus.z)?.name,'漓滨路')
for (const name of ['榕湖小学','民主小学','少年宫','回民小学']) {
  const hits=atlas.search(name)
  assert.equal(hits.length,1)
  assert.equal(hits[0].k,'school')
  assert.ok(atlas.roadAt(hits[0].x,hits[0].z,2))
  if (['少年宫','回民小学'].includes(name)) {
    assert.ok(hits[0].n.includes('待核'))
    assert.ok(!manifest.landmarks.some(entry=>entry.name.includes(name)))
  }
}
for(const [query,name,road] of [
  ['桂林医科大学','桂林医科大学（东城校区）','环城北二路'],
  ['理工大附小','桂林理工大学附属小学','建干路'],
  ['田家炳','桂林市田家炳中学','屏风路'],
  ['辰山小学','桂林市辰山小学',null],
  ['漓江小学','漓江小学','芳香路'],
  ['龙隐小学','龙隐小学','七星路'],
]) {
  const hit=atlas.search(query)[0]
  assert.equal(hit?.n,name)
  assert.equal(hit?.k,'school')
  if(road) assert.equal(atlas.roadAt(hit.x,hit.z,30)?.name,road)
}
const junction=atlas.roadAt(-881,-165)?.name
assert.ok(['中山中路','解放东路','解放西路'].includes(junction))
const river=atlas.roadAt(-1205,2740)
assert.ok(!river || atlas.roads.some(road=>road.b && road.n===river.name))

const [left,top,width,depth]=atlas.extent
let seed=110300
const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32)
const count=100000, start=performance.now()
for(let index=0;index<count;index++) atlas.roadAt(left+random()*width,top+random()*depth)
const mean=(performance.now()-start)/count
console.log(`atlas.bin: ${binary.length} bytes; roads: ${atlas.roads.length} (${named} named); places: ${atlas.places.length}`)
console.log(`water: ${atlas.water.length}; green: ${atlas.green.length}; buildings: ${atlas.buildings.length}`)
console.log(`十字街: ${junction}; 漓江江心: ${river?.name??'null'}; roadAt: ${mean.toFixed(6)} ms/query (${count} samples)`)
assert.ok(mean<0.05)
