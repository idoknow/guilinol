import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {test} from 'node:test'
import {gunzipSync} from 'node:zlib'
import {DoubleSide,Mesh,MeshBasicMaterial,Raycaster,Vector3} from 'three'
import {buildingGeometry} from '../web/src/buildings.ts'

test('the downhill wall blocks the reported view without moving the roof or other buildings',()=>{
  const data=gunzipSync(readFileSync(new URL('../public/world/100_40.glc',import.meta.url)))
  const vertices=data.readUInt32LE(4),faces=data.readUInt32LE(8),jsonLength=data.readUInt32LE(12)
  let offset=24+2*65*65*2
  function take(bytes){const result=data.subarray(offset,offset+bytes);offset+=bytes;return Uint8Array.from(result).buffer}
  const positions=new Int16Array(take(vertices*6)),normals=new Int8Array(take(vertices*3)),indices=new Uint32Array(take(faces*4))
  const [rings]=JSON.parse(data.toString('utf8',offset,offset+jsonLength)),baseline=structuredClone(rings)
  const geometry=buildingGeometry(positions,normals,indices,rings,-1280,256)
  const original=buildingGeometry(positions,normals,indices,baseline)
  const material=new MeshBasicMaterial({side:DoubleSide})
  const ray=new Raycaster(new Vector3(212,152.8,128),new Vector3(0,0,1),0,10)
  assert.equal(ray.intersectObject(new Mesh(original,material)).length,0)
  const [hit]=ray.intersectObject(new Mesh(geometry,material));assert.ok(hit && hit.distance<10)
  const target=baseline.findIndex(part=>part[5]===3294284245)
  assert.equal(rings[target][0],1509)
  baseline[target][0]=1509
  assert.deepEqual(rings,baseline)
  assert.equal(geometry.index.count,original.index.count)
})
