import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {gunzipSync} from 'node:zlib'
import {vehicleSurface} from './vehicle-surface'

const world=process.argv[2]??'public/world'
const manifest=JSON.parse(fs.readFileSync(path.join(world,'manifest.json'),'utf8'))
const surface=vehicleSurface(world,manifest)
const ways=JSON.parse(fs.readFileSync('raw/osm-2026-11.json','utf8')).elements.filter(e=>e.type==='way')
const coordinates=({lat,lon})=>[(lon-110.3)*111320*Math.cos(25.28*Math.PI/180),-(lat-25.28)*110574]
function inside(x:number,z:number,ring:number[][]){
  let contained=false
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const [a,b]=ring[i],[c,d]=ring[j]
    if((b>z)!==(d>z)&&x<(c-a)*(z-b)/(d-b)+a)contained=!contained
  }
  return contained
}

const report=[]
for(const [id,bridgeId] of [[1025751314,1025751315],[1034716138,1034716139]]){
  assert(!manifest.tunnels.some(t=>t.way===id))
  const street=ways.find(w=>w.id===id),span=ways.find(w=>w.id===bridgeId)
  const coords=street.geometry.map(coordinates)
  const bridgeNode=coords.findIndex((_,i)=>span.nodes.includes(street.nodes[i]))
  assert(bridgeNode>=0)
  const [x,z]=coords[bridgeNode]
  const bridgeCoords=span.geometry.map(coordinates)
  const [nx,nz]=bridgeCoords[span.nodes[0]===street.nodes[bridgeNode]?1:bridgeCoords.length-2]
  const distance=Math.hypot(nx-x,nz-z),hit={hidden:false,deck:-Infinity}
  surface(x+.05*(nx-x)/distance,z+.05*(nz-z)/distance,{structure:'bridge'},hit)
  const join=Math.abs(surface(x,z,{})-hit.deck)
  let minimumHeadroom=Infinity,maximumGrade=0,underBuilding=0
  const cache=new Map<string,any[]>()
  for(let i=1;i<coords.length;i++){
    const [ax,az]=coords[i-1],[bx,bz]=coords[i]
    const length=Math.hypot(bx-ax,bz-az),count=Math.ceil(length/.15)
    const dx=(bx-ax)/length,dz=(bz-az)/length
    for(const side of [-1.8,-.9,0,.9,1.8]){
      let previous:number|undefined
      for(let j=0;j<=count;j++){
        const px=ax+dx*length*j/count-dz*side,pz=az+dz*length*j/count+dx*side
        // A skewed deck can already cover an outer wheel at its abutment.
        const atJoint=Math.hypot(px-x,pz-z)<2
        const sample={hidden:false,road:-Infinity,deck:-Infinity}
        const y=surface(px,pz,atJoint?{structure:'bridge'}:{},sample)
        assert(Number.isFinite(Math.max(sample.road,sample.deck))&&!sample.hidden,`Missing exposed pavement on ${id} at ${px},${pz}`)
        if(previous!==undefined)maximumGrade=Math.max(maximumGrade,Math.abs(y-previous)/(length/count))
        previous=y
        const ox=Math.floor(px/256)*256,oz=Math.floor(pz/256)*256,key=ox+','+oz
        if(!cache.has(key)){
          const tile=manifest.chunks.find(t=>t.x===ox&&t.z===oz)
          const raw=gunzipSync(fs.readFileSync(path.join(world,tile.file)))
          const start=24+16900+9*raw.readUInt32LE(4)+4*raw.readUInt32LE(8)
          cache.set(key,JSON.parse(raw.toString('utf8',start,start+raw.readUInt32LE(12)))[0].filter(part=>part[9]))
        }
        for(const [bottom,,rings] of cache.get(key)!){
          const lx=100*(px-ox),lz=100*(pz-oz)
          if(!inside(lx,lz,rings[0])||rings.slice(1).some(hole=>inside(lx,lz,hole)))continue
          minimumHeadroom=Math.min(minimumHeadroom,bottom/10-y)
          underBuilding++
        }
      }
    }
  }
  report.push({way:id,bridgeNode:street.nodes[bridgeNode],join,minimumHeadroom,maximumGrade,underBuilding})
}
console.log(JSON.stringify(report,null,2))
assert(report.every(r=>r.join<.01&&r.maximumGrade<=.08&&r.underBuilding>0&&r.minimumHeadroom>=3.5))
