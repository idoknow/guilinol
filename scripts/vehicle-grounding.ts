import fs from 'node:fs'
import path from 'node:path'
import {gunzipSync} from 'node:zlib'
import {execFileSync} from 'node:child_process'
import {vehicleSurface} from './vehicle-surface'
import {contactPose,profilePad} from '../web/src/traffic/lane-surface'
import {poseAt,trackHeight} from '../web/src/traffic/sim'

const [mode='audit',world='public/world',output='captures/vehicle-grounding']=process.argv.slice(2)
const bake=mode==='bake'
const data=(bake||mode==='passage-heights'||mode==='prop-heights'||mode==='portals'||mode==='portal-check'||mode==='portal-routes')?JSON.parse(fs.readFileSync(output,'utf8')):JSON.parse(gunzipSync(fs.readFileSync(path.join(world,'roads/graph.json.gz'))).toString())
const manifest=data.manifest??JSON.parse(fs.readFileSync(path.join(world,'manifest.json'),'utf8'))
if(mode==='passage-heights'){
  const surface=vehicleSurface(world,manifest)
  const heights=data.positions.map(({x,z,bridge}:{x:number,z:number,bridge?:number[]})=>{
    if(bridge){
      const [dx,dz]=bridge, length=Math.hypot(dx,dz)
      for(const along of [0,.1,.25,.5,1,2]){
        const hit={hidden:false,deck:-Infinity}
        surface(x+dx*along/length,z+dz*along/length,{structure:'bridge'},hit)
        if(Number.isFinite(hit.deck))return hit.deck
      }
    }
    return surface(x,z,{})
  })
  fs.writeFileSync(output,JSON.stringify(heights))
  process.exit(0)
}
if(mode==='prop-heights'){
  const surface=vehicleSurface(world,manifest)
  const heights=data.positions.map(([x,z])=>{
    const hit={hidden:false,road:-Infinity,terrain:-Infinity}
    surface(x,z,{pedestrian:true},hit)
    return Math.max(hit.road,hit.terrain)
  })
  fs.writeFileSync(output,JSON.stringify(heights))
  process.exit(0)
}
if(mode==='portal-routes'){
  const surface=vehicleSurface(world,manifest)
  const portalIds=new Set(data.routes.map(site=>site.id))
  const [left,top,width,depth]=manifest.extent
  const former=JSON.parse(fs.readFileSync(new URL('./fixtures/grounding-portals.json',import.meta.url),'utf8')).filter(site=>
    site.way!==1493582667 && !portalIds.has(site.id) && site.modes.every(m=>m.route.every(([x,z])=>
      x>=left && z>=top && x<left+width && z<top+depth)))
  const surfaceRoutes=[...former,...(data.yardRoutes??[])]
  for(const site of [...data.routes,...surfaceRoutes])for(const test of site.modes){
    const [x,z,way]=test.route[0]
    test.startHeight=surface(x,z,{way,structure:test.startStructure,pedestrian:test.mode==='foot'})
  }
  fs.writeFileSync(path.join(world,'vehicle-surface-routes.json'),JSON.stringify(surfaceRoutes))
  fs.writeFileSync(output,JSON.stringify(data.routes))
  process.exit(0)
}
if(mode==='portal-check'){
  const surface=vehicleSurface(world,manifest),nodes=new Map(data.nodes.map(n=>[n.id,n]))
  const checks=data.constraints.map(row=>{
    if(row.approachCut===undefined)return row
    const p=nodes.get(row.node),road=surface(p.x,p.z,{pedestrian:data.pedestrianNodes?.includes(row.node)})
    const difference=road-row.floor
    return {...row,finalRoad:road,difference,reason:Math.abs(difference)<=.05?'gradedApproach':'portalMismatch'}
  })
  fs.writeFileSync(output,JSON.stringify(checks,null,2))
  process.exit(0)
}
if(mode==='portals'){
  const surface=vehicleSurface(world,manifest),nodes=new Map(data.nodes.map(n=>[n.id,n]))
  const heights={},roofs=[]
  // Survey final surface grades near mouths for the constrained approach solver.
  const mouthCells=new Set<string>()
  for(const id of data.network.portals){
    const p=nodes.get(id),x=Math.floor(p.x/256),z=Math.floor(p.z/256)
    for(let i=x-1;i<=x+1;i++)for(let j=z-1;j<=z+1;j++)mouthCells.add(i+','+j)
  }
  const guideNodes=new Set(data.guideNodes)
  const approaches=data.nodes.filter(n=>guideNodes.has(n.id)||mouthCells.has(Math.floor(n.x/256)+','+Math.floor(n.z/256)))
  approaches.sort((a,b)=>Math.floor(a.x/256)-Math.floor(b.x/256)||Math.floor(a.z/256)-Math.floor(b.z/256))
  for(const n of approaches)heights[n.id]=surface(n.x,n.z,{})
  for(const edge of data.network.edges){
    const a=nodes.get(edge.a),b=nodes.get(edge.b)
    for(const node of [a,b])heights[node.id]??=surface(node.x,node.z,{})
    const dx=b.x-a.x,dz=b.z-a.z,length=Math.hypot(dx,dz),count=Math.ceil(length/2)
    const levels=[]
    for(let i=0;i<=count;i++){
      const f=i/count,x=a.x+dx*f,z=a.z+dz*f
      // The lowest obstruction across the carriageway sets the clearance.
      levels.push(Math.min(...[-edge.halfWidth,0,edge.halfWidth].map((offset,side)=>{
        const hit={hidden:false,road:-Infinity,deck:-Infinity}
        const ground=surface(x-dz/length*offset,z+dx/length*offset,{structure:'bridge'},hit)
        const mountain=edge.mountainRoof?.[3*i+side]
        if(mountain==null)return ground
        // A mapped upper road remains a hard roof below the mountain shell.
        const roadRoof=Math.min(...[hit.road,hit.deck].filter(Number.isFinite))
        return Math.min(Math.max(ground,mountain),roadRoof)
      })))
    }
    roofs.push(levels)
  }
  fs.writeFileSync(output,JSON.stringify({heights,roofs}))
  process.exit(0)
}
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
const surface=vehicleSurface(world,manifest,data),nodes=new Map(data.nodes.map(n=>[n.id,n]))
const lanes=data.lanes.map(lane=>{
  const start=nodes.get(lane.from),end=nodes.get(lane.to)
  const length=Math.hypot(end.x-start.x,end.z-start.z)
  return {...lane,start,end,length,dx:(end.x-start.x)/length,dz:(end.z-start.z)/length}
}).sort((a,b)=>Math.floor(a.start.z/256)-Math.floor(b.start.z/256)||a.start.x-b.start.x)

// Store only the knots needed to reconstruct the metre samples. Distances are
// sample-index deltas, heights are signed centimetre deltas, crossfalls int8.
function packSurface(length:number,wheel:(d:number,r:number)=>number){
  const span=length+2*profilePad
  let count=Math.ceil(span)
  function measure(d:number){
    const left=wheel(d,-.795),right=wheel(d,.795)
    return {height:Math.round((left+right)*50),
      cross:Math.max(-127,Math.min(127,Math.round((right-left)*128/1.59)))}
  }
  let samples=Array.from({length:count+1},(_,i)=>measure(i*span/count-profilePad))
  // Keep the existing distance encoding. Only lanes whose midpoint heights
  // or crossfalls depart from interpolation need a finer station grid.
  for(let refinement=0;refinement<3;refinement++){
    const midpoints=Array.from({length:count},(_,i)=>measure((i+.5)*span/count-profilePad))
    if(!midpoints.some((m,i)=>Math.abs(m.height-(samples[i].height+samples[i+1].height)/2)>2
      ||Math.abs(m.cross-(samples[i].cross+samples[i+1].cross)/2)>3))break
    const refined=new Array(2*count+1)
    for(let i=0;i<count;i++){
      refined[2*i]=samples[i]
      refined[2*i+1]=midpoints[i]
    }
    refined[2*count]=samples[count]
    samples=refined
    count*=2
  }
  const heights=samples.map(s=>s.height),cross=samples.map(s=>s.cross)
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

const tunnelWays=new Set((manifest.tunnels??[]).map(t=>t.way))
const missingFloors=new Set<number>()
const partialFloors=new Set<number>()
const profiles=[],reports=[],hist=new Map<number,number>(),heat=new Map<string,number>()
const reasons={surface:0,tunnel:0,fit:0,hidden:0}
const worstByLane={tunnel:new Map(),surface:new Map()}
let problemBuffer=''
if(!bake){fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'outliers.ndjson'),'')}
function flushProblems(){
  fs.appendFileSync(path.join(output,'outliers.ndjson'),problemBuffer)
  problemBuffer=''
}
let total=0,outliers=0,nonplanar=0,sunk=0,floating=0
for(const lane of lanes){
  const {dx,dz,length,start}=lane
  let offset=lane.offset
  if(bake&&lane.structure==='bridge'&&offset){
    // Split OSM carriageways can have a narrower deck than their tagged
    // nominal lane width. Check the actual lateral slab edge along the span.
    const direction=Math.sign(offset),outer=Math.abs(offset)+1.005
    for(const f of [.1,.3,.5,.7,.9]){
      const cx=start.x+dx*f*length,cz=start.z+dz*f*length
      function deckAt(distance:number){
        const hit={hidden:false,deck:-Infinity}
        surface(cx-dz*direction*distance,cz+dx*direction*distance,lane,hit)
        return hit.deck
      }
      const center=deckAt(0)
      if(!Number.isFinite(center))continue
      for(let d=.1;d<=outer+.1;d+=.1){
        if(Math.abs(deckAt(d)-center)<.5)continue
        offset=direction*Math.min(Math.abs(offset),Math.max(0,d-.1-1.005))
        break
      }
    }
    offset=Math.round(100*offset)/100
  }
  const unresolved=lane.structure==='tunnel'&&!tunnelWays.has(lane.way)
  if(unresolved){
    missingFloors.add(lane.way)
    if(bake){profiles[lane.id]=null;continue}
  }
  // Wheel centers of the 4.48 x 1.82 m reference car (mountWheel in vehicle-model.ts).
  const front=1.34,rear=-1.31,halfWidth=.795,span=front-rear
  const wheel=(along,right)=>surface(start.x+dx*along+dz*(right-offset),start.z+dz*along-dx*(right-offset),lane)
  if(bake){profiles[lane.id]={floor:packSurface(length,wheel),offset};continue}
  const active=mode==='baseline'?{...lane,wheelPose:undefined,floor:undefined}:lane
  const count=Math.ceil(length/2)
  let maximum=0,over=0
  for(let i=0;i<=count;i++){
    const f=i/count,dist=f*length
    const fr=wheel(dist+front,halfWidth),fl=wheel(dist+front,-halfWidth)
    const br=wheel(dist+rear,halfWidth),bl=wheel(dist+rear,-halfWidth)
    const {y,pitch,roll}=active.floor?contactPose(active,dist):{
      y:trackHeight(active,dist),pitch:active.wheelPose?poseAt(active.wheelPose,f,2):0,roll:active.wheelPose?poseAt(active.wheelPose,f,3):0}
    let uneven:boolean|undefined
    // Intersect under the rotated contact, including its horizontal displacement.
    for(const forward of [rear,front])for(const right of [-halfWidth,halfWidth]){
      const rx=right*Math.cos(roll),ry=right*Math.sin(roll)
      const rz=ry*Math.sin(pitch)+forward*Math.cos(pitch)
      const x=start.x+dx*(dist+rz)+dz*(rx-offset),z=start.z+dz*(dist+rz)-dx*(rx-offset)
      const diagnostic={hidden:false,missingFloor:false}
      const roadY=surface(x,z,lane,diagnostic),gap=y+ry*Math.cos(pitch)-forward*Math.sin(pitch)-roadY,error=Math.abs(gap)
      if(diagnostic.missingFloor)partialFloors.add(lane.way)
      maximum=Math.max(maximum,error)
      const mm=Math.ceil(error*1000);hist.set(mm,(hist.get(mm)??0)+1);total++
      const key=Math.floor(x/32)+','+Math.floor(z/32)
      heat.set(key,Math.max(heat.get(key)??0,error))
      if(error>.25){
        over++;outliers++;if(gap>0)floating++;else sunk++
        // A full-width broken bridge approach can leave four coplanar
        // corner samples while an axle crosses a vertical edge inside them.
        // Probe the two wheel paths and both axle midpoints before blaming
        // profile interpolation for a defect in the underlying surface.
        if(uneven===undefined){
          const mid=dist+(front+rear)/2
          uneven=Math.abs(fr+bl-fl-br)/4>.25 ||
            Math.abs(wheel(mid,halfWidth)-(fr+br)/2)>.25 ||
            Math.abs(wheel(mid,-halfWidth)-(fl+bl)/2)>.25 ||
            Math.abs(wheel(dist+front,0)-(fl+fr)/2)>.25 ||
            Math.abs(wheel(dist+rear,0)-(bl+br)/2)>.25
        }
        const reason=unresolved||diagnostic.missingFloor?'tunnel':diagnostic.hidden?'hidden':uneven?'surface':'fit'
        reasons[reason]++
        const point={lane:lane.id,way:lane.way,kind:lane.kind,reason,x,z,dist,gap,error}
        problemBuffer+=JSON.stringify(point)+'\n'
        if(problemBuffer.length>=262144)flushProblems()
        const group=worstByLane[lane.structure==='tunnel'?'tunnel':'surface']
        if(!group.has(lane.id)||error>group.get(lane.id).error)group.set(lane.id,point)
      }

    }
    if(Math.abs(fr+bl-fl-br)/4>.25)nonplanar++
  }
  reports.push({lane:lane.id,way:lane.way??null,kind:lane.kind,maximum,over,unresolvedTunnelFloor:unresolved})
}
if(bake)fs.writeFileSync(output,JSON.stringify(profiles))
else{
  let seen=0,p99=0
  for(const [mm,n] of [...hist].sort((a,b)=>a[0]-b[0])){seen+=n;if(seen>=.99*total){p99=mm/1000;break}}
  flushProblems()
  const top50=Object.fromEntries(Object.entries(worstByLane).map(([k,v])=>[k,[...v.values()].sort((a,b)=>b.error-a.error).slice(0,50)]))
  const constraintsFile=path.join(world,'vehicle-tunnel-grades.json')
  const conflicts=fs.existsSync(constraintsFile)?JSON.parse(fs.readFileSync(constraintsFile,'utf8')):[]
  const pending=conflicts.filter(row=>row.reason!=='gradedApproach')
  const summary={tunnelConstraintRecords:pending.length,gradedApproaches:conflicts.length-pending.length,partialTunnelWays:[...partialFloors].sort((a,b)=>a-b),reasons,lanes:lanes.length,wheelSamples:total,outliers,sunk,floating,p99,nonplanarFootprints:nonplanar,unresolvedTunnelWays:[...missingFloors].sort((a,b)=>a-b)}
  fs.mkdirSync(output,{recursive:true})
  fs.writeFileSync(path.join(output,'audit.json'),JSON.stringify({summary,top50,lanes:reports}))
  const rasterDir=fs.mkdtempSync(path.join(output,'heatmap-'))
  const cells=path.join(rasterDir,'cells.json')
  try{
    fs.writeFileSync(cells,JSON.stringify({extent:manifest.extent,cells:[...heat]}))
    execFileSync('uv',['run','--locked','python','scripts/vehicle-heatmap.py',path.join(output,'heatmap.png'),cells])
  }finally{fs.rmSync(rasterDir,{recursive:true,force:true})}
  console.log(summary)
  if(!lanes.length||outliers||p99>.1||missingFloors.size||partialFloors.size||pending.length)process.exitCode=1
}
