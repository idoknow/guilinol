import {readFileSync} from 'node:fs'
import {gunzipSync} from 'node:zlib'

const root='public/world/',manifest=JSON.parse(readFileSync(root+'manifest.json'))
const tiles=new Map(manifest.chunks.map(tile=>[`${tile.x},${tile.z}`,tile])),cache=new Map()
function inside(x,z,ring){
  let hit=false
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const [ax,az]=ring[i],[bx,bz]=ring[j]
    if((az>z)!==(bz>z)&&x<(bx-ax)*(z-az)/(bz-az)+ax)hit=!hit
  }
  return hit
}
export function sidewalk(x,z){
  const size=manifest.chunkSize,ox=Math.floor(x/size)*size,oz=Math.floor(z/size)*size,key=`${ox},${oz}`
  if(!cache.has(key)){
    const tile=tiles.get(key)
    if(!tile)return false
    const bytes=gunzipSync(readFileSync(root+tile.file))
    if(bytes.toString('ascii',0,4)!=='GL04')throw Error(tile.file)
    const start=24+4*(size/manifest.grid+1)**2+9*bytes.readUInt32LE(4)+4*bytes.readUInt32LE(8)
    const faces=JSON.parse(bytes.toString('utf8',start,start+bytes.readUInt32LE(12)))[1][0]
    cache.set(key,faces.filter(([kind])=>[1,4,6].includes(kind)))
  }
  x=(x-ox)*100;z=(z-oz)*100
  return cache.get(key).some(([,shell,...holes])=>inside(x,z,shell)&&!holes.some(hole=>inside(x,z,hole)))
}
