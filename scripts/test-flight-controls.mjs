import assert from 'node:assert/strict'
import {test} from 'node:test'
import {PerspectiveCamera} from 'three'
import {flight} from '../web/src/flight.ts'

function setup(t) {
  const win=new EventTarget(), canvas=new EventTarget(), camera=new PerspectiveCamera()
  Object.defineProperty(globalThis,'window',{value:win,configurable:true})
  t.after(()=>{delete globalThis.window})
  canvas.setPointerCapture=()=>{}
  camera.position.y=240
  const tick=flight(camera,canvas,[-1000,-1000,2000,2000],()=>true)
  const key=(type,code)=>win.dispatchEvent(Object.assign(new Event(type),{code}))
  const touch=(type,id,y)=>canvas.dispatchEvent(Object.assign(new Event(type),{pointerType:'touch',pointerId:id,clientX:id*25,clientY:y}))
  return {camera,tick,key,touch}
}

test('forward motion follows yaw at full speed even at steep pitch; only explicit lift changes altitude',t=>{
  const {camera,tick,key}=setup(t)
  camera.rotation.y=Math.PI/2
  key('keydown','KeyW')
  for(const pitch of [-1.54,-.17,0,.75,1.54]) {
    camera.rotation.x=pitch
    const start=camera.position.clone();tick(.1)
    assert.equal(camera.position.x-start.x,-12)
    assert.ok(Math.abs(camera.position.z-start.z)<1e-9)
    assert.equal(camera.position.y,start.y)
  }
  key('keydown','KeyE');tick(.1);assert.equal(camera.position.y,252)
  key('keyup','KeyE');key('keydown','KeyQ');tick(.1);assert.equal(camera.position.y,240)
})

test('two-finger travel stays level; three fingers control altitude within bounds',t=>{
  const {camera,touch}=setup(t)
  camera.rotation.x=-1.4
  for(const id of [1,2]) touch('pointerdown',id,100)
  for(const id of [1,2]) touch('pointermove',id,90)
  assert.deepEqual(camera.position.toArray(),[0,240,-16])
  touch('pointerdown',3,90)
  for(const id of [1,2,3]) touch('pointermove',id,60)
  assert.deepEqual(camera.position.toArray(),[0,264,-16])
  touch('pointermove',3,2000);assert.equal(camera.position.y,120)
  touch('pointercancel',3,2000);touch('pointermove',1,50)
  assert.deepEqual(camera.position.toArray(),[0,120,-24])
})
