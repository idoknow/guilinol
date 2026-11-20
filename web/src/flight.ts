import * as THREE from 'three'

export function flight(camera:THREE.PerspectiveCamera, canvas:HTMLCanvasElement, extent:number[],enabled:()=>boolean) {
  const keys = new Set<string>(), touches = new Map<number,[number,number]>()
  camera.rotation.order = 'YXZ'
  const clamp = THREE.MathUtils.clamp
  function rotate(dx:number,dy:number) {
    camera.rotation.y -= dx*.003
    camera.rotation.x = clamp(camera.rotation.x-dy*.003,-1.54,1.54)
  }
  const forward = new THREE.Vector3(), right = new THREE.Vector3()
  function move(ahead:number, side:number) {
    camera.getWorldDirection(forward)
    right.setFromMatrixColumn(camera.matrixWorld,0)
    camera.position.addScaledVector(forward,ahead).addScaledVector(right,side)
  }
  window.addEventListener('keydown',event=>keys.add(event.code))
  window.addEventListener('keyup',event=>keys.delete(event.code))
  window.addEventListener('blur',()=>{keys.clear();touches.clear()})
  canvas.addEventListener('pointerdown',event=>{
    if(!enabled())return
    if(event.pointerType==='mouse') {canvas.requestPointerLock()?.catch(()=>{});return}
    canvas.setPointerCapture(event.pointerId);touches.set(event.pointerId,[event.clientX,event.clientY])
  })
  canvas.addEventListener('pointermove',event=>{
    if(!enabled())return
    if(event.pointerType==='mouse') {
      if(document.pointerLockElement===canvas||event.buttons===1) rotate(event.movementX,event.movementY)
      return
    }
    const last = touches.get(event.pointerId)
    if(!last) return
    const dx=event.clientX-last[0],dy=event.clientY-last[1]
    if(touches.size===1) rotate(dx,dy)
    else move(-dy*.8,dx*.8)
    touches.set(event.pointerId,[event.clientX,event.clientY])
  })
  for(const name of ['pointerup','pointercancel','lostpointercapture'])
    canvas.addEventListener(name,event=>touches.delete((event as PointerEvent).pointerId))
  return (dt:number)=>{
    if(!enabled()||!['KeyW','KeyS','KeyA','KeyD','KeyE','KeyQ'].some(key=>keys.has(key)))return
    const speed = (keys.has('ShiftLeft')?380:120)*Math.min(.1,dt)
    const axis = (plus:string,minus:string)=>Number(keys.has(plus))-Number(keys.has(minus))
    move(axis('KeyW','KeyS')*speed,axis('KeyD','KeyA')*speed)
    camera.position.y += axis('KeyE','KeyQ')*speed
    camera.position.clamp(new THREE.Vector3(extent[0],120,extent[1]),new THREE.Vector3(extent[0]+extent[2],6000,extent[1]+extent[3]))
  }
}
