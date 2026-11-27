import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {gunzipSync} from 'node:zlib'
import {buildingGeometry,isLegacyKuiguangSliver} from '../web/src/buildings.ts'

const world=new URL('../public/world/',import.meta.url)
const tile=JSON.parse(readFileSync(new URL('manifest.json',world))).chunks.find(tile=>tile.x===-1536&&tile.z===-256)
const data=gunzipSync(readFileSync(new URL(tile.file,world)))
const vertexCount=data.readUInt32LE(4),indexCount=data.readUInt32LE(8)
let offset=16924
function section(Type,count){
  return new Type(Uint8Array.from(data.subarray(offset,offset+=Type.BYTES_PER_ELEMENT*count)).buffer)
}
const positions=section(Int16Array,vertexCount*3),normals=section(Int8Array,vertexCount*3),indices=section(Uint32Array,indexCount)
const [parts]=JSON.parse(data.subarray(offset,offset+data.readUInt32LE(12)))
const specs=JSON.parse(readFileSync(new URL('../pipeline/landmarks.json',import.meta.url)))
assert.ok(specs.find(spec=>spec.id==='kuiguang_school').replace.includes('612212e7-767e-417f-a593-c48e1a8350b7'))
const targets=parts.filter(part=>isLegacyKuiguangSliver(tile.x,tile.z,part))
assert.ok(targets.length<=1)
const original=buildingGeometry(positions,normals,indices,parts),fixed=buildingGeometry(positions,normals,indices,parts,tile.x,tile.z)
const corners=new Set(targets.flatMap(part=>part[2][0].map(corner=>corner.join(','))))
const kept=Array.from(original.index.array).filter(vertex=>!corners.has(`${positions[3*vertex]},${positions[3*vertex+2]}`))
assert.equal(original.index.count-kept.length,targets.length*30)
assert.deepEqual(Array.from(fixed.index.array),kept)
console.log(`Kuiguang: ${targets.length} legacy solid(s), ${original.index.count-fixed.index.count} indices removed; all other indices unchanged`)
