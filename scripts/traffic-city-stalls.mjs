import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {gunzipSync} from 'node:zlib'
import {Traffic} from '../web/src/traffic/sim.ts'

const directory=process.argv[2]??'public/world/roads'
const cells=JSON.parse(readFileSync(join(directory,'cells.json'))).sort()
let seed=175,sites=0,observed=0,stationary=0,restarted=0,withdrawn=0
const sample=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32)
const reasons=new Map()
for(const key of cells){
  const graph=JSON.parse(gunzipSync(readFileSync(join(directory,`${key}.json.gz`))))
  const sim=new Traffic(graph,sample),[col,row]=key.split('_').map(Number)
  const tracks=[...sim.allTracks()].filter(track=>!track.walk&&track.kind==='motor'&&Math.floor(track.start.x/512)===col&&Math.floor(track.start.z/512)===row)
  if(!tracks.length)continue
  const distance=track=>(track.start.x-(col+.5)*512)**2+(track.start.z-(row+.5)*512)**2
  const camera=tracks.reduce((a,b)=>distance(a)<distance(b)?a:b).start
  const waiting=new WeakMap(),seen=new WeakSet();sites++
  for(let tick=0;tick<600;tick++){
    sim.step(.2,camera)
    for(const actor of sim.actors){
      if(actor.leaving||actor.kind==='person')continue
      if(!seen.has(actor)){seen.add(actor);observed++}
      waiting.set(actor,actor.speed<.05?(waiting.get(actor)??0)+1:0)
    }
  }
  const cohort=new Set(sim.actors.filter(actor=>!actor.leaving&&waiting.get(actor)>=450))
  stationary+=cohort.size
  const nextSeed=seed
  for(let tick=0;cohort.size&&tick<1500;tick++){
    sim.step(.2,camera)
    for(const actor of cohort){
      if(actor.leaving||!sim.actors.includes(actor)){withdrawn++;cohort.delete(actor)}
      else if(actor.speed>=.05){restarted++;cohort.delete(actor)}
    }
  }
  seed=nextSeed
  for(const actor of cohort){
    const seen=new Set();let head=actor
    while(head.waitingFor&&!seen.has(head)){seen.add(head);head=head.waitingFor}
    const reason=seen.has(head)?'cycle':!sim.green(head.track)?'red signal':`no current blocker (${head.kind})`
    if(process.env.TRACE_STALLS&&(!reasons.has(reason)||reasons.get(reason)<3))console.log({key,reason,track:head.track.id,dist:head.dist,length:head.track.length,kind:head.kind,speed:head.speed,actor:actor.track.id,headActive:sim.actors.includes(head),phases:graph.signals.find(signal=>signal.node===head.track.to)?.phases.map(phase=>phase.lanes.includes(head.track.id)),waitingSince:head.waitingSince})
    reasons.set(reason,(reasons.get(reason)??0)+1)
  }
}
console.log({sites,secondsPerSite:120,observed,stationary90sAtEnd:stationary,followup300s:{restarted,withdrawn,unresolved:Object.fromEntries(reasons)}})
assert.ok(sites>0&&observed>0,'no city traffic sampled')
assert.equal(reasons.size,0,'long-wait cohort still blocked after follow-up')
