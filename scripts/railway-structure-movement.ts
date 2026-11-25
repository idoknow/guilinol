// Sample the finished road geometry by way and station on two builds.
import fs from 'node:fs'
import path from 'node:path'
import {ll2xz} from '../lib/projection'
import {vehicleSurface} from './vehicle-surface'

const args=process.argv.slice(2)
const gate=args.includes('--check-grades')
const [main, candidate, output]=args.filter(arg=>arg!=='--check-grades')
if (!main || !candidate || !output) throw Error('Expected baseline world, candidate world and output JSON path')
const motor = new Set(['motorway','trunk','primary','secondary','tertiary','residential','unclassified','service','living_street','road'])
const localRoad = new Set(['residential','unclassified','service','living_street'])
const violations = []
const surface=(world:string)=>vehicleSurface(world,JSON.parse(fs.readFileSync(path.join(world,'manifest.json'),'utf8')))
const before=surface(main),after=surface(candidate)
const inventory=JSON.parse(fs.readFileSync('docs/railway-crossings.json','utf8'))
const ids=new Set(inventory.filter(row=>row.type).map(row=>row.road))
const manifest=JSON.parse(fs.readFileSync(path.join(candidate,'manifest.json'),'utf8'))
for(const tunnel of manifest.tunnels??[])if(tunnel.nodes)ids.add(tunnel.way)
const grades=JSON.parse(fs.readFileSync('docs/railway-grades.json','utf8'))
for(const row of grades.resolvedRoadStructures??[])for(const id of [row.roadWay,row.bridgeWay])if(id)ids.add(id)
const ways=JSON.parse(fs.readFileSync('raw/osm-2026-11.json','utf8')).elements
const result=[]
for(const way of ways){
  if(way.type!=='way'||!way.geometry?.length)continue
  if(!ids.has(way.id) && !(gate && motor.has(way.tags?.highway?.replace(/_link$/, ''))))continue
  const structure=way.tags.tunnel&&way.tags.tunnel!=='no'?'tunnel':way.tags.bridge&&way.tags.bridge!=='no'?'bridge':'surface'
  const lane={way:way.id,structure}
  const coords=way.geometry.map(p=>ll2xz(p.lat,p.lon))
  const row={way:way.id,structure,adjustedLengthM:0,maxRoadChangeM:0,peakGrade:0,mainPeakGrade:0,mainGradeAtCandidatePeak:0,peakGradeStationM:0,fromM:0,toM:0,worst:null}
  const kind=way.tags.highway?.replace(/_link$/, '')
  const cap=localRoad.has(kind) ? .08 : .05
  let failingIntervals=0
  let largestExcess=0
  let failure
  let station=0,previous
  for(let i=1;i<coords.length;i++){
    const {x,z}=coords[i-1],dx=coords[i].x-x,dz=coords[i].z-z,step=Math.hypot(dx,dz)
    if(step<.001)continue
    const count=Math.ceil(step/2)
    for(let j=previous?1:0;j<=count;j++){
      const f=j/count,px=x+f*dx,pz=z+f*dz,at=station+f*step
      let a,b
      try{a=before(px,pz,lane);b=after(px,pz,lane)}catch(error){
        if(!String(error).includes('No rendered chunk'))throw error
        previous=undefined
        continue
      }
      const delta=b-a
      if(Math.abs(delta)>Math.abs(row.maxRoadChangeM)){
        row.maxRoadChangeM=delta;row.worst={x:px,z:pz,stationM:at,oldM:a,newM:b}
      }
      if(previous&&(Math.abs(delta)>.02||Math.abs(previous.delta)>.02)){
        const run=at-previous.at
        if(!row.adjustedLengthM)row.fromM=previous.at
        row.toM=at;row.adjustedLengthM+=run
        const grade=Math.abs(b-previous.b)/run
        const mainGrade=Math.abs(a-previous.a)/run
        const excess=grade-Math.max(mainGrade,cap)
        if(motor.has(kind) && excess>1e-6){
          failingIntervals++
          if(excess>largestExcess){
            largestExcess=excess
            failure={fromM:previous.at,toM:at,x:px,z:pz,grade,mainGrade,cap}
          }
        }
        if(grade>row.peakGrade){
          row.peakGrade=grade
          row.mainGradeAtCandidatePeak=Math.abs(a-previous.a)/run
          row.peakGradeStationM=(at+previous.at)/2
        }
        row.mainPeakGrade=Math.max(row.mainPeakGrade,Math.abs(a-previous.a)/run)
      }
      previous={at,a,b,delta}
    }
    station+=step
  }
  if(failure)violations.push({way:way.id,structure,kind,failingIntervals,worst:failure})
  if(Math.abs(row.maxRoadChangeM)>.02)result.push(row)
}
fs.writeFileSync(output,JSON.stringify(result.sort((a,b)=>Math.abs(b.maxRoadChangeM)-Math.abs(a.maxRoadChangeM)),null,2))

if(gate){
  fs.writeFileSync(output+'.grades.json',JSON.stringify(violations,null,2))
  console.log('Changed motor roads exceeding both the grade cap and baseline at the same station:',violations.length)
  if(violations.length)process.exitCode=1
}
