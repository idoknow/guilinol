import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import {gunzipSync} from 'node:zlib'
import {execFileSync} from 'node:child_process'
import {Traffic} from '../web/src/traffic/sim.ts'
import {sidewalk} from './ped-sidewalk.mjs'

const graph=JSON.parse(gunzipSync(readFileSync('public/world/roads/graph.json.gz')))
const sim=new Traffic(graph,()=>.5,0),tracks=[...sim.allTracks()].filter(track=>track.walk)
const reverse=new Map(tracks.map(track=>[track.from,track]))
const chosen=[],widths=new Set(),trace=[]
for(const pattern of [/解放/,/中山/,/.*/])for(const track of tracks){
  if(chosen.length===10||!pattern.test(track.street)||track.length<100||track.from<track.to)continue
  const x=(track.start.x+track.end.x)/2,z=(track.start.z+track.end.z)/2
  let width=0
  for(const side of [-1,1])for(let d=.05;d<=15&&sidewalk(x-side*d*track.dz,z+side*d*track.dx);d+=.05)width++
  if(widths.has(width))continue
  widths.add(width);chosen.push({track,width:width*.05})
  if(pattern.source!=='.*')break
}
assert.equal(chosen.length,10)
const reports=[],footprints=[]
for(const [index,{track,width}] of chosen.entries()){
  const count=2+index%5,same=index%2,mid=track.length/2,dt=.05
  sim.actors=Array.from({length:count},(_,id)=>{
    const backward=!same&&id>=Math.ceil(count/2),path=backward?reverse.get(track.to):track
    const along=mid+(id-(count-1)/2)*5
    const actor={track:path,dist:backward?track.length-along:along,kind:'person',pace:same?1.75-id*.18:1.4,speed:1.4,scale:1,dodge:0,down:0,leaving:false}
    sim.position(actor);return actor
  })
  const waits=Array(count).fill(0),encounters=new Map(),times=[]
  const frames=[];footprints.push(frames)
  let min=Infinity,stall=0,overlap=0,outside=0
  for(let frame=0;frame<1200;frame++){
    sim.step(dt,{x:(track.start.x+track.end.x)/2,z:(track.start.z+track.end.z)/2,y:track.start.y})
    assert.equal(sim.actors.length,count)
    frames.push(sim.actors.map(actor=>[actor.x,actor.z]))
    let close=false,off=false
    for(const [id,actor] of sim.actors.entries()){
      waits[id]=actor.speed<.1?waits[id]+1:0
      if(waits[id]===41)stall++
      if(!sidewalk(actor.x,actor.z))off=true
      for(let j=id+1;j<count;j++){
        const other=sim.actors[j],dx=other.x-actor.x,dz=other.z-actor.z,d=Math.hypot(dx,dz),ahead=dx*track.dx+dz*track.dz,key=`${id},${j}`
        min=Math.min(min,d);if(d<.45)close=true
        if(d<=4&&!encounters.has(key))encounters.set(key,{frame,ahead})
        const entry=encounters.get(key)
        if(entry&&entry.ahead*ahead<0&&Math.abs(ahead)>=.65&&!entry.passed){times.push((frame-entry.frame)*dt);entry.passed=true}
        if(d>4)encounters.delete(key)
      }
    }
    if(!index&&frame<100)trace.push(sim.actors.map(({x,y,z,yaw,speed})=>({x,y,z,yaw,speed})))
    overlap+=close;outside+=off
  }
  reports.push({street:track.street,id:track.id,count,width:+width.toFixed(2),min:+min.toFixed(3),passes:times.length,meanSeconds:+(times.reduce((a,b)=>a+b,0)/times.length).toFixed(2),stall,overlap,outside})
}
const bodyOutside=JSON.parse(execFileSync('uv',['run','--locked','python','scripts/ped-envelope.py'],{input:JSON.stringify(footprints)}))
reports.forEach((row,index)=>{row.bodyOutside=bodyOutside[index]})
console.table(reports)
if(process.argv[2])writeFileSync(process.argv[2],JSON.stringify(trace))
assert.ok(reports.every(row=>row.passes&&!row.stall&&!row.overlap&&!row.outside))
