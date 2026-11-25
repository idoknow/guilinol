// Back the raised carriageways with terrain and cut the visible pavement at
// the same chamfered clearance envelope used by the driving colliders.
import {readFileSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {gunzipSync, gzipSync} from 'node:zlib'
import {tunnelClearanceClipper} from '../web/src/tunnels'
import {tileSurface} from './vehicle-surface'

const [world, request]=process.argv.slice(2)
const {tile,bore,upper}=JSON.parse(readFileSync(request,'utf8'))
const file=join(world,tile.file), raw=gunzipSync(readFileSync(file))
const start=24+16900+9*raw.readUInt32LE(4)+4*raw.readUInt32LE(8), size=raw.readUInt32LE(12)
const data=JSON.parse(raw.toString('utf8',start,start+size)), survey=data[1][12]
function decode(encoded:string,unit:number){
  const b=Buffer.from(encoded,'base64')
  return Float32Array.from({length:b.length/4},(_,i)=>b.readInt32LE(4*i)*unit)
}
function encode(xyz:ArrayLike<number>,scale:number){
  const buffer=Buffer.alloc(xyz.length*4)
  for(let i=0;i<xyz.length;i++)buffer.writeInt32LE(Math.round(xyz[i]*scale),i*4)
  return buffer
}
const clip=tunnelClearanceClipper(tile,[bore],-.045)
for(const part of ['packed','skirt','sidewalk']){
  if(!survey[part])continue
  const positions=decode(survey[part],.001)
  const corners=Array.from({length:positions.length/3},(_,i)=>i)
  survey[part]=encode(clip(positions,corners),1000).toString('base64')
}
const road=decode(upper,.001)
const wet=Array.from({length:4225},(_,i)=>raw.readInt16LE(8474+2*i)).some(v=>v!==-32768)
const step=wet?4:8, cells=256/step
const bed=data[7]??{drop:[],packed:''}, old=new Set<number>(bed.drop), needed=new Set<number>()
const cell=(p:number)=>Math.max(0,Math.min(cells-1,Math.floor(p/step)))
for(let i=0;i<road.length;i+=9){
  const x=[road[i],road[i+3],road[i+6]],z=[road[i+2],road[i+5],road[i+8]]
  for(let row=cell(Math.min(...z));row<=cell(Math.max(...z));row++)
    for(let col=cell(Math.min(...x));col<=cell(Math.max(...x));col++)
      for(const half of [0,1]){
        const id=2*(row*cells+col)+half
        if(!old.has(id))needed.add(id)
      }
}
// Preserve the rest of every native terrain triangle touched by an edge.
let original:Float32Array|undefined
tileSurface(world,tile,[],(kind,xyz)=>{if(kind==='ground'&&!original)original=xyz})
const kept:number[]=[]
for(let i=0;i<original!.length;i+=9){
  const v=original!.subarray(i,i+9)
  const x=(v[0]+v[3]+v[6])/3/step,z=(v[2]+v[5]+v[8])/3/step
  const col=Math.floor(x),row=Math.floor(z),id=2*(row*cells+col)+Number(x-col+z-row>1)
  if(needed.has(id))kept.push(...v)
}
for(let i=1;i<road.length;i+=3)road[i]-=.051
bed.drop=[...old,...needed].sort((a,b)=>a-b)
const existing=bed.packed?Buffer.from(bed.packed,'base64'):encode((bed.vertices??[]).flat(),10000)
bed.packed=Buffer.concat([existing,encode(kept,10000),encode(road,10000)]).toString('base64')
delete bed.vertices
data[7]=bed
const payload=Buffer.from(JSON.stringify(data));raw.writeUInt32LE(payload.length,12)
writeFileSync(file,gzipSync(Buffer.concat([raw.subarray(0,start),payload,raw.subarray(start+size)])))
