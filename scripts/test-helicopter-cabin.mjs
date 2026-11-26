import assert from 'node:assert/strict'
import test from 'node:test'
import {readFile} from 'node:fs/promises'
import {PerspectiveCamera,Quaternion,Raycaster,Vector2} from 'three'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'
import {cabinCamera} from '../web/src/helicopter/cabin-camera.ts'

test('rear passengers can see instruments and windows without moving the eye on head turns',async()=>{
  globalThis.self=globalThis;globalThis.createImageBitmap=async()=>({width:1,height:1})
  const bytes=await readFile('public/models/helicopter_tour.glb'),{scene}=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')
  scene.updateMatrixWorld(true)
  const camera=new PerspectiveCamera(60,1.6,.035,100),ray=new Raycaster()
  const hit=(x,y)=>{ray.setFromCamera(new Vector2(x,y),camera);return ray.intersectObject(scene,true).find(result=>!result.object.material.transparent)}
  for(const number of [2,3]){
    const seat=scene.getObjectByName(`seat_pax_${number}`)
    const look=yaw=>{cabinCamera(camera,seat,number,yaw,8*Math.PI/180,new Quaternion());camera.updateMatrixWorld(true)}
    look(0);const eye=camera.position.clone()
    const dashboard=[-.15,0,.15].some(x=>[-.25,-.3,-.35,-.4].some(y=>hit(x,y)?.object.material.name==='instrument scales'))
    assert.ok(dashboard,`seat ${number} cannot see instruments`)
    for(const side of [-1,1])assert.ok([.1,.2,.3,.4].some(y=>!hit(.9*side,y)),`window ${side} blocked`)
    for(const yaw of [-Math.PI,Math.PI]){look(yaw);assert.ok(eye.equals(camera.position));for(const x of [-1,0,1])for(const y of [-1,0,1])assert.ok((hit(x,y)?.distance??Infinity)>camera.near)}
  }
})
