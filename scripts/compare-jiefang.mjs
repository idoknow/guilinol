import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {gunzipSync} from 'node:zlib'
import {pathToFileURL} from 'node:url'
import * as THREE from 'three'
import {Traffic,MOBILE_ACTORS} from '../web/src/traffic/sim.ts'

const [baselineModule,baselineGraph]=process.argv.slice(2)
const {Traffic:Baseline}=await import(pathToFileURL(resolve(baselineModule)))
const mobile=process.env.PERF_MOBILE==='1'
const camera=new THREE.PerspectiveCamera(55,mobile?844/390:960/540,1,2000)
camera.position.set(-265,168,15);camera.lookAt(-145,153,45);camera.updateMatrixWorld()
const frustum=new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse))
const point=new THREE.Vector3(),visible=actor=>frustum.containsPoint(point.set(actor.x,actor.y+.7,actor.z))
const measure=(Simulation,file,seed)=>{
  const sim=new Simulation(JSON.parse(gunzipSync(readFileSync(file))),()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32),mobile?MOBILE_ACTORS:undefined)
  const counts=[]
  for(let tick=1;tick<=1200;tick++){
    sim.step(.05,camera.position,undefined,visible)
    if(tick%20===0)counts.push(sim.actors.filter(actor=>actor.kind!=='person'&&actor.scale>=.99&&visible(actor)).length)
  }
  return counts
}
for(const seed of [110,111,112]){
  const main=measure(Baseline,baselineGraph,seed),pr=measure(Traffic,'public/world/roads/-1_0.json.gz',seed)
  for(const seconds of [30,60]){
    const stats=counts=>({mean:counts.slice(0,seconds).reduce((sum,value)=>sum+value,0)/seconds,min:Math.min(...counts.slice(0,seconds))})
    const baseline=stats(main),candidate=stats(pr)
    console.log({seed,seconds,baseline,candidate})
    assert.ok(candidate.mean>=(mobile?1:.9)*baseline.mean)
  }
}
