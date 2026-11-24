import {readFileSync,writeFileSync} from 'node:fs'
import {gunzipSync} from 'node:zlib'
import {Traffic} from '../web/src/traffic/sim.ts'

const graph=JSON.parse(gunzipSync(readFileSync('public/world/roads/graph.json.gz')))
const nodes=new Map(graph.nodes.map(node=>[node.id,node]))
const segments=graph.lanes.filter(lane=>lane.sidewalkFace!==undefined)
if(!segments.length)throw Error('Run pipeline/npc_network.py first')
const points=new Map(),segments_without_sidewalk=[],streets_exempt=[]
function separation(x,z,[ax,az,bx,bz]){
  const dx=bx-ax,dz=bz-az,f=Math.min(1,Math.max(0,((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz)))
  return Math.hypot(x-ax-dx*f,z-az-dz*f)
}
const pairs=segments.map(lane=>{
  const head=nodes.get(lane.from),tail=nodes.get(lane.to),line=[head.x,head.z,tail.x,tail.z]
  const row={street:lane.street,lane:lane.id,x:(head.x+tail.x)/2,z:(head.z+tail.z)/2,length:Math.hypot(head.x-tail.x,head.z-tail.z)}
  if(!lane.sidewalkFace)segments_without_sidewalk.push({...row,reason:'15 m 内无瓦片人行道面'})
  const tracks=points.get(lane.street)??[];tracks.push(...lane.npcWalks);points.set(lane.street,tracks)
  return {lane,line,row}
})
for(const {row} of pairs)if(!points.get(row.street).some(track=>separation(row.x,row.z,track)<=200))streets_exempt.push({...row,reason:'以该中点为观察位置，200 m 内同街无可用轨道'})
const length=rows=>rows.reduce((sum,row)=>sum+row.length,0),total=length(pairs.map(({row})=>row))
const stats={pairs:pairs.length,withTracks:pairs.filter(({lane})=>lane.npcWalks.length).length,segments_without_sidewalk:segments_without_sidewalk.length,segmentLengthPercent:100*length(segments_without_sidewalk)/total,exemptMidpoints:streets_exempt.length,exemptStreetKeys:new Set(streets_exempt.map(row=>row.street)).size,exemptMidpointLengthPercent:100*length(streets_exempt)/total}
if(process.argv[2])writeFileSync(process.argv[2],JSON.stringify({stats,segments_without_sidewalk,streets_exempt}))
console.log(stats)
const locations=[['解放东路',-583,-98],['解放西路',-1215,-222],['中山中路',-885,-135],['正阳步行街',-633,47],['中山北路桥',262,-4955],['lane 74',-11211,1460],['解放桥',-168,40],['滨江路',-185,-306],['依仁路',-811,149]]
const alley=graph.lanes.find(lane=>lane.cls==='service'&&lane.street.startsWith('@'));locations.push(['无名小巷',nodes.get(alley.from).x,nodes.get(alley.from).z])
const errors=[]
for(const [label,x,z] of locations){
  let seed=42
  const sim=new Traffic(graph,()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32))
  const streets=new Map(pairs.filter(({line})=>separation(x,z,line)<=200).map(({lane})=>[lane.street,[Infinity,0,Infinity,0]]))
  let illegal=0,reverse=0,offTrack=0
  for(let tick=0;tick<1200;tick++){
    sim.step(.05,{x,y:150,z})
    for(const actor of sim.actors){
      if(!['primary','secondary','trunk'].includes(actor.track.cls))illegal++
      if(actor.kind==='person'&&(!actor.track.walk||Math.abs(actor.dodge)>.001))offTrack++
      if(actor.kind!=='person'&&(actor.speed<0||Math.cos(actor.yaw)*actor.track.dz+Math.sin(actor.yaw)*actor.track.dx<.99))reverse++
    }
    if(tick%20!==19)continue
    for(const [street,range] of streets){
      const actors=sim.actors.filter(actor=>actor.track.street===street&&Math.hypot(actor.x-x,actor.z-z)<=200)
      const people=actors.filter(actor=>actor.kind==='person').length,cars=actors.length-people
      range[0]=Math.min(range[0],cars);range[1]=Math.max(range[1],cars);range[2]=Math.min(range[2],people);range[3]=Math.max(range[3],people)
    }
  }
  console.log(label,{illegal,reverse,offTrack,streets:Object.fromEntries(streets)})
  if(illegal||reverse||offTrack)errors.push(label)
  for(const [street,[carMin,carMax,personMin,personMax]] of streets){
    const exempt=!points.get(street).some(track=>separation(x,z,track)<=200)
    if(carMin<1||carMax>3||(exempt?personMax!==0||/解放|中山|正阳/.test(street):personMin<4||personMax>8))errors.push(`${label}/${street}`)
  }
}
if(errors.length)throw Error(`rule violations: ${errors.join(', ')}`)
