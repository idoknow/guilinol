import fs from 'node:fs'
import path from 'node:path'
import {gunzipSync} from 'node:zlib'
import {execFileSync} from 'node:child_process'
import {vehicleSurface} from './vehicle-surface'
import {poseAt,trackHeight} from '../web/src/traffic/sim'

const [mode='audit',world='public/world',output='captures/vehicle-grounding']=process.argv.slice(2)
const bake=mode==='bake'
const data=bake?JSON.parse(fs.readFileSync(output,'utf8')):JSON.parse(gunzipSync(fs.readFileSync(path.join(world,'roads/graph.json.gz'))).toString())
const manifest=data.manifest??JSON.parse(fs.readFileSync(path.join(world,'manifest.json'),'utf8'))
// Released graphs predating the way field use OSM node pairs as stable keys.
if(data.lanes.some(lane=>lane.way===undefined)){
  const file=['raw/osm-2026-11.json','raw/osm.json'].find(fs.existsSync)
  if(!file)throw Error('Legacy graph needs its matching OSM snapshot to identify bridge and tunnel layers')
  const ways=new Map()
  for(const way of JSON.parse(fs.readFileSync(file,'utf8')).elements){
    if(way.type!=='way'||!way.tags?.highway)continue
    const cls=way.tags.highway.replace(/_link$/,'')
    for(let i=1;i<way.nodes.length;i++){
      const a=way.nodes[i-1],b=way.nodes[i]
      ways.set([Math.min(a,b),Math.max(a,b),cls].join('/'),way)
    }
  }
  for(const lane of data.lanes){
    if(lane.way!==undefined)continue
    const way=ways.get([Math.min(lane.from,lane.to),Math.max(lane.from,lane.to),lane.cls].join('/'))
    if(!way)throw Error('Missing OSM way for lane '+lane.id)
    lane.way=way.id
    for(const key of ['bridge','tunnel'])if(way.tags[key]&&way.tags[key]!=='no')lane.structure=key
  }
}
const surface=vehicleSurface(world,manifest),nodes=new Map(data.nodes.map(n=>[n.id,n]))
const lanes=data.lanes.map(lane=>{
  const start=nodes.get(lane.from),end=nodes.get(lane.to)
  const length=Math.hypot(end.x-start.x,end.z-start.z)
  return {...lane,start,end,length,dx:(end.x-start.x)/length,dz:(end.z-start.z)/length}
}).sort((a,b)=>Math.floor(a.start.z/256)-Math.floor(b.start.z/256)||a.start.x-b.start.x)

const tunnelWays=new Set((manifest.tunnels??[]).map(t=>t.way))
const missingFloors=new Set<number>()
const profiles=[],reports=[],worst=[],hist=new Map<number,number>(),heat=new Map<string,number>()
let total=0,outliers=0,nonplanar=0,sunk=0,floating=0
for(const lane of lanes){
  const {dx,dz,length,start,offset}=lane
  const unresolved=lane.structure==='tunnel'&&!tunnelWays.has(lane.way)
  if(unresolved){
    missingFloors.add(lane.way)
    if(bake){profiles[lane.id]=null;continue}
  }
  // Wheel centers of the 4.48 x 1.82 m reference car (mountWheel in vehicle-model.ts).
  const front=1.34,rear=-1.31,halfWidth=.795,span=front-rear
  const wheel=(along,right)=>surface(start.x+dx*along+dz*(right-offset),start.z+dz*along-dx*(right-offset),lane)
  const active=mode==='baseline'?{...lane,wheelPose:undefined}:lane
  const count=Math.ceil(length/(bake?1:2)),samples=[]
  let maximum=0,over=0
  for(let i=0;i<=count;i++){
    const f=i/count,dist=f*length
    const fr=wheel(dist+front,halfWidth),fl=wheel(dist+front,-halfWidth)
    const br=wheel(dist+rear,halfWidth),bl=wheel(dist+rear,-halfWidth)
    if(bake){
      const incline=(fr+fl-br-bl)/(2*span),cross=(fr+br-fl-bl)/(4*halfWidth)
      let y=(bl+br)/2-rear*incline,pitch=-Math.atan(incline),roll=Math.atan(cross/Math.hypot(1,incline))
      // On grades, rotation shifts each contact horizontally. Refit the plane at
      // the shifted wheel positions, retaining the pose with the smallest residual.
      let best=[y,pitch,roll],minimum=Infinity
      for(let step=0;step<5;step++){
        const gaps=[]
        for(const forward of [front,rear])for(const right of [halfWidth,-halfWidth]){
          const ry=right*Math.sin(roll),rz=ry*Math.sin(pitch)+forward*Math.cos(pitch)
          gaps.push(wheel(dist+rz,right*Math.cos(roll))-y-ry*Math.cos(pitch)+forward*Math.sin(pitch))
        }
        const error=Math.max(...gaps.map(Math.abs))
        if(error>=minimum)break
        minimum=error;best=[y,pitch,roll]
        if(error<.015)break
        const [a,b,c,d]=gaps
        const u=(a+b-c-d)/(2*span),v=(a+c-b-d)/(4*halfWidth)
        y+=(c+d)/2-rear*u
        pitch-=Math.atan(u);roll+=Math.atan(v)
      }
      samples.push([f,...best])
      continue
    }
    const y=trackHeight(active,dist),pitch=active.wheelPose?poseAt(lane.wheelPose,f,2):0,roll=active.wheelPose?poseAt(lane.wheelPose,f,3):0
    // Intersect under the rotated contact, including its horizontal displacement.
    for(const forward of [rear,front])for(const right of [-halfWidth,halfWidth]){
      const rx=right*Math.cos(roll),ry=right*Math.sin(roll)
      const rz=ry*Math.sin(pitch)+forward*Math.cos(pitch)
      const x=start.x+dx*(dist+rz)+dz*(rx-offset),z=start.z+dz*(dist+rz)-dx*(rx-offset)
      const roadY=surface(x,z,lane),gap=y+ry*Math.cos(pitch)-forward*Math.sin(pitch)-roadY,error=Math.abs(gap)
      maximum=Math.max(maximum,error)
      const mm=Math.ceil(error*1000);hist.set(mm,(hist.get(mm)??0)+1);total++
      const key=Math.floor(x/32)+','+Math.floor(z/32)
      heat.set(key,Math.max(heat.get(key)??0,error))
      if(error>.25){over++;outliers++;if(gap>0)floating++;else sunk++}
      if(worst.length<50||error>worst.at(-1).error){
        worst.push({dist,f,nominalContactHeights:[fr,fl,br,bl],lane:lane.id,way:lane.way??null,kind:lane.kind,x,z,roadY,gap,error})
        worst.sort((a,b)=>b.error-a.error);worst.length=Math.min(50,worst.length)
      }
    }
    if(Math.abs(fr+bl-fl-br)/4>.25)nonplanar++
  }
  if(bake){
    // Keep midpoints wherever a 4 m chord exceeds the height/angle tolerances.
    const kept=[0]
    function split(a,b){
      let cut=0
      for(let j=a+1;j<b;j++){
        const t=(j-a)/(b-a)
        if([1,2,3].some(k=>Math.abs(samples[j][k]-(samples[a][k]+t*(samples[b][k]-samples[a][k])))>(k===1?.015:.008))){cut=j;break}
      }
      if(cut){split(a,cut);split(cut,b)}else kept.push(b)
    }
    for(let a=0;a<count;a+=4)split(a,Math.min(count,a+4))
    profiles[lane.id]=kept.flatMap(i=>samples[i].map((v,k)=>Number(v.toFixed(k===0?8:4))))
  }else reports.push({lane:lane.id,way:lane.way??null,kind:lane.kind,maximum,over,unresolvedTunnelFloor:unresolved})
}
if(bake)fs.writeFileSync(output,JSON.stringify(profiles))
else{
  let seen=0,p99=0
  for(const [mm,n] of [...hist].sort((a,b)=>a[0]-b[0])){seen+=n;if(seen>=.99*total){p99=mm/1000;break}}
  const summary={lanes:lanes.length,wheelSamples:total,outliers,sunk,floating,p99,nonplanarFootprints:nonplanar,unresolvedTunnelWays:[...missingFloors].sort((a,b)=>a-b)}
  fs.mkdirSync(output,{recursive:true})
  fs.writeFileSync(path.join(output,'audit.json'),JSON.stringify({summary,worst,lanes:reports}))
  execFileSync('uv',['run','--locked','python','scripts/vehicle-heatmap.py',path.join(output,'heatmap.png')],{input:JSON.stringify({extent:manifest.extent,cells:[...heat]})})
  console.log(summary)
  if(!lanes.length||outliers||p99>.1||missingFloors.size)process.exitCode=1
}
