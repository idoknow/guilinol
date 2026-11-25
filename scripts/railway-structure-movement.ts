// Sample the finished road geometry by way and station on two builds.
import fs from 'node:fs'
import path from 'node:path'
import {ll2xz} from '../lib/projection'
import {vehicleSurface} from './vehicle-surface'
import {nearbyTunnels} from '../web/src/tunnels'

const args=process.argv.slice(2)
const gate=args.includes('--check-grades')
const [main, candidate, output]=args.filter(arg=>arg!=='--check-grades')
if (!main || !candidate || !output) throw Error('Expected baseline world, candidate world and output JSON path')
const motor = new Set(['motorway','trunk','primary','secondary','tertiary','residential','unclassified','service','living_street','road'])
const localRoad = new Set(['residential','unclassified','service','living_street'])
const violations = []
const readManifest=(world:string)=>JSON.parse(fs.readFileSync(path.join(world,'manifest.json'),'utf8'))
const original=readManifest(main),manifest=readManifest(candidate)
const before=vehicleSurface(main,original),after=vehicleSurface(candidate,manifest)
const tileMap=(entries:any[])=>new Map(entries.map(t=>[t.x+','+t.z,t]))
const oldTiles=tileMap(original.chunks),newTiles=tileMap(manifest.chunks)
const sameLandmarks=JSON.stringify(original.landmarks)===JSON.stringify(manifest.landmarks)
const changedTiles=new Map<string,boolean>()
function changedTile(x:number,z:number){
  const key=x+','+z
  if(changedTiles.has(key))return changedTiles.get(key)
  const old=oldTiles.get(key),now=newTiles.get(key)
  if(!old&&!now){changedTiles.set(key,false);return false}
  const changed=!sameLandmarks || !old || !now || old.bytes!==now.bytes ||
    JSON.stringify(nearbyTunnels(original.tunnels,x,z))!==JSON.stringify(nearbyTunnels(manifest.tunnels,x,z)) ||
    !fs.readFileSync(path.join(main,old.file)).equals(fs.readFileSync(path.join(candidate,now.file)))
  changedTiles.set(key,changed)
  return changed
}
function overlapsChange(x:number,z:number,dx:number,dz:number){
  for(let tx=Math.floor(Math.min(x,x+dx)/256);tx<=Math.floor(Math.max(x,x+dx)/256);tx++)
    for(let tz=Math.floor(Math.min(z,z+dz)/256);tz<=Math.floor(Math.max(z,z+dz)/256);tz++)
      if(changedTile(tx*256,tz*256))return true
  return false
}
const inventory=JSON.parse(fs.readFileSync('docs/railway-crossings.json','utf8'))
const ids=new Set(inventory.filter(row=>row.type).map(row=>row.road))
for(const tunnel of manifest.tunnels??[])if(tunnel.nodes)ids.add(tunnel.way)
const grades=JSON.parse(fs.readFileSync('docs/railway-grades.json','utf8'))
for(const row of grades.resolvedRoadStructures??[])for(const id of [row.roadWay,row.bridgeWay])if(id)ids.add(id)
const ways=JSON.parse(fs.readFileSync('raw/osm-2026-11.json','utf8')).elements
type Lane = {way:number,structure:string,nodes:Set<number>}
type Probe = {x:number,z:number,at:number,lane:Lane,connected:boolean,before:number,after:number}
const byTile=new Map<string,Probe[]>()
const surveys:{way:any,structure:string,probes:Probe[]}[]=[]

for(const way of ways){
  if(way.type!=='way'||!way.geometry?.length)continue
  const kind=way.tags?.highway?.replace(/_link$/, '')
  if(!ids.has(way.id) && !(gate && motor.has(kind)))continue
  const structure=way.tags.tunnel&&way.tags.tunnel!=='no'?'tunnel':way.tags.bridge&&way.tags.bridge!=='no'?'bridge':'surface'
  const lane={way:way.id,structure,nodes:new Set<number>(way.nodes)}
  const coords=way.geometry.map(p=>ll2xz(p.lat,p.lon))
  const probes:Probe[]=[]
  let station=0,connected=false
  for(let i=1;i<coords.length;i++){
    const {x,z}=coords[i-1],dx=coords[i].x-x,dz=coords[i].z-z,step=Math.hypot(dx,dz)
    if(step<.001)continue
    if(!gate||overlapsChange(x,z,dx,dz)){
      const count=Math.ceil(step/2)
      for(let j=connected?1:0;j<=count;j++){
        const f=j/count,px=x+f*dx,pz=z+f*dz,at=station+f*step
        const key=Math.floor(px/256)*256+','+Math.floor(pz/256)*256
        if(!oldTiles.has(key)||!newTiles.has(key)){connected=false;continue}
        const point={x:px,z:pz,at,lane,connected,before:0,after:0}
        probes.push(point)
        if(!byTile.has(key))byTile.set(key,[])
        byTile.get(key)!.push(point)
        connected=true
      }
    }else connected=false
    station+=step
  }
  if(probes.length)surveys.push({way,structure,probes})
}

// Build the two collision meshes only once per tile, regardless of way order.
for(const probes of byTile.values())for(const p of probes){
  p.before=before(p.x,p.z,p.lane)
  p.after=after(p.x,p.z,p.lane)
}
const result=[]
for(const {way,structure,probes} of surveys){
  const row={way:way.id,structure,adjustedLengthM:0,maxRoadChangeM:0,peakGrade:0,mainPeakGrade:0,mainGradeAtCandidatePeak:0,peakGradeStationM:0,fromM:0,toM:0,worst:null}
  const kind=way.tags.highway?.replace(/_link$/, '')
  const cap=localRoad.has(kind) ? .08 : .05
  let failingIntervals=0
  let largestExcess=0
  let failure
  for(const [index,p] of probes.entries()){
    const {x:px,z:pz,at,before:a,after:b}=p
    const previous=p.connected?probes[index-1]:undefined
    const delta=b-a
    if(Math.abs(delta)>Math.abs(row.maxRoadChangeM)){
      row.maxRoadChangeM=delta;row.worst={x:px,z:pz,stationM:at,oldM:a,newM:b}
    }
    if(previous){
      const run=at-previous.at
      const grade=Math.abs(b-previous.after)/run
      const mainGrade=Math.abs(a-previous.before)/run
      const excess=grade-Math.max(mainGrade,cap)
      if(motor.has(kind) && excess>1e-6){
        failingIntervals++
        if(excess>largestExcess){
          largestExcess=excess
          failure={fromM:previous.at,toM:at,x:px,z:pz,grade,mainGrade,cap}
        }
      }
      if(Math.abs(delta)>.02||Math.abs(previous.after-previous.before)>.02){
        if(!row.adjustedLengthM)row.fromM=previous.at
        row.toM=at
        row.adjustedLengthM+=run
        if(grade>row.peakGrade){
          row.peakGrade=grade
          row.mainGradeAtCandidatePeak=mainGrade
          row.peakGradeStationM=(at+previous.at)/2
        }
        row.mainPeakGrade=Math.max(row.mainPeakGrade,mainGrade)
      }
    }
  }
  if(Math.abs(row.maxRoadChangeM)>.02){
    result.push(row)
  }
  // The movement inventory uses 2 cm for reporting. The grade gate also
  // catches smaller displacements on short intervals at the class limit.
  if(failure)violations.push({way:way.id,structure,kind,failingIntervals,worst:failure})
}
fs.writeFileSync(output,JSON.stringify(result.sort((a,b)=>Math.abs(b.maxRoadChangeM)-Math.abs(a.maxRoadChangeM)),null,2))

if(gate){
  fs.writeFileSync(output+'.grades.json',JSON.stringify(violations,null,2))
  console.log('Changed motor roads exceeding both the grade cap and baseline at the same station:',violations.length)
  if(violations.length)process.exitCode=1
}
