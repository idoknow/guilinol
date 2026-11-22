import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {gunzipSync} from 'node:zlib'
import {pathToFileURL} from 'node:url'
import * as THREE from 'three'
import {Traffic} from '../web/src/traffic/sim.ts'

const [baselineModule,baselineGraph]=process.argv.slice(2)
const {Traffic:Baseline}=await import(pathToFileURL(resolve(baselineModule)))
const camera=new THREE.PerspectiveCamera(55,960/540,1,2000)
camera.position.set(-265,168,15);camera.lookAt(-145,153,45);camera.updateMatrixWorld()
const frustum=new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse))
const point=new THREE.Vector3(),visible=actor=>frustum.containsPoint(point.set(actor.x,actor.y+.7,actor.z))
const measure=(Simulation,file)=>{
  let seed=110
  const sim=new Simulation(JSON.parse(gunzipSync(readFileSync(file))),()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32))
  const counts=[]
  for(let tick=1;tick<=400;tick++){
    sim.step(.05,camera.position,undefined,visible)
    if(tick%100===0)counts.push(sim.actors.filter(actor=>actor.kind!=='person'&&actor.scale>=.99&&visible(actor)).length)
  }
  return counts
}
const main=measure(Baseline,baselineGraph),pr=measure(Traffic,'public/world/roads/-1_0.json.gz')
console.log({seconds:[5,10,15,20],main,pr})
assert.ok(pr.every((value,index)=>value>=main[index]))
