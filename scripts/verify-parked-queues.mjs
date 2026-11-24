import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import {gunzipSync} from 'node:zlib'
import {Traffic} from '../web/src/traffic/sim.ts'
import {pickups} from '../web/src/traffic/contact.ts'
import {CAR_SCALE} from '../web/src/drive/scale.ts'

const read=file=>JSON.parse(gunzipSync(readFileSync(`public/world/${file}`)))
const cars=read('vehicles.bin').cars.map(([x,y,z,yaw])=>({x,y,z,yaw,halfWidth:.9*CAR_SCALE,halfLength:2.12*CAR_SCALE,height:1.5}))
for(const solid of cars)pickups.add(solid)
const affected=new Map(),world=new Traffic(read('roads/graph.json.gz'))
for(const track of world.allTracks())if(!track.walk)for(const {solid} of world.parkingHits(track,false)){
  if(!affected.has(solid))affected.set(solid,[])
  affected.get(solid).push(track.id)
}
const rows=[]
for(const [solid,lanes] of affected){
  const key=`${Math.floor(solid.x/512)}_${Math.floor(solid.z/512)}`
  let seed=110,waiting=0,longest=0,observed=0,firstOverrun
  const flow=new Traffic(read(`roads/${key}.json.gz`),()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32))
  for(let tick=0;tick<2400;tick++){
    flow.step(.05,solid,undefined,point=>Math.hypot(point.x-solid.x,point.z-solid.z)<40)
    const near=flow.actors.filter(actor=>actor.kind!=='person'&&Math.hypot(actor.x-solid.x,actor.z-solid.z)<12)
    observed+=near.length;waiting=near.some(actor=>actor.speed<.1)?waiting+1:0;longest=Math.max(longest,waiting)
    if(waiting===601&&!firstOverrun)firstOverrun=near.filter(actor=>actor.speed<.1).map(actor=>({lane:actor.track.id,red:!flow.green(actor.track),gap:actor.track.length-actor.dist,blocker:actor.waitingFor?.kind,blockedTrack:flow.parkingHits(actor.track).length}))
  }
  rows.push({x:solid.x,z:solid.z,lanes,seconds:longest/20,observed,firstOverrun})
}
rows.sort((left,right)=>right.seconds-left.seconds)
const report={total:rows.length,over30:rows.filter(row=>row.seconds>30).length,worst:rows.slice(0,5),lane24510:rows.filter(row=>row.lanes.includes(24510))}
console.log(JSON.stringify(report,null,2));if(process.argv[2])writeFileSync(process.argv[2],JSON.stringify({report,rows}))
assert.ok(report.lane24510.length&&report.over30===0)
