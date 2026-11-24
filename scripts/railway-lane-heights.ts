import fs from 'node:fs'
import {vehicleSurface} from './vehicle-surface'
import {profilePad} from '../web/src/traffic/lane-surface'

const [world,file]=process.argv.slice(2)
const data=JSON.parse(fs.readFileSync(file,'utf8'))
const surface=vehicleSurface(world,data.manifest),nodes=new Map(data.nodes.map(n=>[n.id,n]))
const lanes=data.lanes.map(lane=>{
  const start=nodes.get(lane.from),end=nodes.get(lane.to)
  const length=Math.hypot(end.x-start.x,end.z-start.z)
  return {...lane,start,end,length,dx:(end.x-start.x)/length,dz:(end.z-start.z)/length}
}).sort((a,b)=>Math.floor(a.start.z/256)-Math.floor(b.start.z/256)||a.start.x-b.start.x)

// Store only the knots needed to reconstruct the quarter-metre samples. Distances are
// sample-index deltas, heights are signed centimetre deltas, crossfalls int8.
function packSurface(length:number,wheel:(d:number,r:number)=>number){
  const count=Math.ceil((length+2*profilePad)*4)
  const heights=new Int32Array(count+1),cross=new Int8Array(count+1)
  for(let i=0;i<=count;i++){
    const d=i*(length+2*profilePad)/count-profilePad
    const left=wheel(d,-.795),right=wheel(d,.795)
    heights[i]=Math.round((left+right)*50)
    cross[i]=Math.max(-127,Math.min(127,Math.round((right-left)*128/1.59)))
  }
  const keep=new Set([0,count]),pending=[[0,count]]
  while(pending.length){
    const [a,b]=pending.pop()!
    let max=1,cut=0
    for(let i=a+1;i<b;i++){
      const t=(i-a)/(b-a)
      const error=Math.max(Math.abs(heights[i]-heights[a]-t*(heights[b]-heights[a]))/1.5,
        Math.abs(cross[i]-cross[a]-t*(cross[b]-cross[a]))/2)
      if(error>max){max=error;cut=i}
    }
    if(cut){keep.add(cut);pending.push([a,cut],[cut,b])}
  }
  const bytes:number[]=[]
  function write(value:number){
    while(value>=128){bytes.push(128|(value&127));value>>>=7}
    bytes.push(value)
  }
  let prevI=0,prevY=0
  for(const i of [...keep].sort((a,b)=>a-b)){
    const delta=heights[i]-prevY
    write(i-prevI);write((delta<<1)^(delta>>31));bytes.push(cross[i]&255)
    prevI=i;prevY=heights[i]
  }
  return Buffer.from(bytes).toString('base64')
}


const profiles={}
for(const lane of lanes){
  const {start,dx,dz,length}=lane
  let offset=lane.offset
  const sample=(along:number,right:number,diagnostic?)=>surface(start.x+dx*along+dz*(right-offset),
    start.z+dz*along-dx*(right-offset),lane,diagnostic)
  // On two-way service streets the tagged width can include the sidewalk.
  // Keep a car on its own side and prefer the outermost supported wheel path.
  if(lane.cls==='service'&&!lane.oneway&&!lane.structure&&offset>1){
    const stations=Math.ceil((length+2*profilePad)/.5)
    let best=offset,bestMissing=Infinity
    for(let candidate=offset;candidate>=.94;candidate-=.1){
      offset=candidate
      let missing=0
      for(let i=0;i<=stations;i++){
        for(const wheel of [-.88,-.795,.795,.88]){
          const hit={hidden:false,road:-Infinity}
          sample((length+2*profilePad)*i/stations-profilePad,wheel,hit)
          if(!Number.isFinite(hit.road))missing++
        }
      }
      if(missing<bestMissing){best=offset;bestMissing=missing}
      if(!missing)break
    }
    offset=Math.round(best*100)/100
  }
  profiles[lane.id]={offset,floor:packSurface(length,sample)}
}
fs.writeFileSync(file,JSON.stringify(profiles))
