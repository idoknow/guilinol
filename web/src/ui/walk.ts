import './walk.css'
import {walkConfig as cfg} from '../walk/config'

function safeCapture(el:Element, pointerId:number) {
  try { el.setPointerCapture(pointerId) } catch {}
}

export function walkInput(canvas:HTMLCanvasElement,active:()=>boolean,rotate:(dx:number,dy:number)=>void,zoom:(delta:number)=>void,view:()=>void){
  const keys=new Set<string>(), stick={x:0,y:0,mag:0}, panel=document.createElement('div')
  panel.className='walk-ui'
  panel.innerHTML='<div class="joystick" role="group" aria-label="移动"><span class="joystick-knob"></span></div>'
    +'<button class="btn-run" type="button" aria-label="奔跑" aria-pressed="false">跑</button>'
    +'<button class="btn-jump" type="button" aria-label="跳">跃</button>'
    +'<button class="btn-view" type="button" aria-label="切换视距">远近</button>'
  document.body.append(panel);panel.hidden=true
  const joystick=panel.querySelector<HTMLElement>('.joystick')!, knob=panel.querySelector<HTMLElement>('.joystick-knob')!
  const btnRun=panel.querySelector<HTMLButtonElement>('.btn-run')!, btnJump=panel.querySelector<HTMLButtonElement>('.btn-jump')!, btnView=panel.querySelector<HTMLButtonElement>('.btn-view')!
  let jump=false, runHold=false, runLock=false, runDownAt=0, stickPointer=-1, runPointer=-1
  const touches=new Map<number,{x:number,y:number}>()
  let mouseDown=false, lastMouse={x:0,y:0}, pinchDist=0

  function syncRun(){
    const running=runHold||runLock||stick.mag>.9
    btnRun.classList.toggle('on',runHold||runLock)
    btnRun.setAttribute('aria-pressed',String(runHold||runLock))
    joystick.classList.toggle('running',running&&stick.mag>.1)
  }
  function resetStick(){stick.x=stick.y=stick.mag=0;stickPointer=-1;knob.style.transform='';syncRun()}
  function drag(event:PointerEvent){
    const rect=joystick.getBoundingClientRect(), half=Math.max(1,rect.width/2)
    const rx=(event.clientX-rect.left-half)/half, ry=(event.clientY-rect.top-half)/half
    const raw=Math.hypot(rx,ry), clamped=Math.min(1,raw), dead=.1
    const eff=clamped<=dead?0:(clamped-dead)/(1-dead)
    if(raw>1e-4){stick.x=rx/raw*eff;stick.y=ry/raw*eff}else{stick.x=stick.y=0}
    stick.mag=eff
    const travel=raw>1e-4?clamped/raw:0
    knob.style.transform=`translate(${(rx*travel*half*.54).toFixed(1)}px,${(ry*travel*half*.54).toFixed(1)}px)`
    syncRun()
  }
  joystick.onpointerdown=event=>{event.preventDefault();event.stopPropagation();stickPointer=event.pointerId;safeCapture(joystick,event.pointerId);drag(event)}
  joystick.onpointermove=event=>{if(event.pointerId===stickPointer)drag(event)}
  const endStick=(event:PointerEvent)=>{if(event.pointerId===stickPointer)resetStick()}
  joystick.onpointerup=endStick
  joystick.onpointercancel=endStick
  joystick.onlostpointercapture=endStick
  window.addEventListener('pointermove',event=>{if(event.pointerId===stickPointer)drag(event)})
  window.addEventListener('pointerup',event=>{endStick(event);if(event.pointerId===runPointer)endRun(true,event.pointerId)})
  window.addEventListener('pointercancel',event=>{endStick(event);if(event.pointerId===runPointer)endRun(false,event.pointerId)})

  btnJump.onpointerdown=event=>{event.preventDefault();event.stopPropagation();jump=true}
  btnView.onpointerdown=event=>{event.preventDefault();event.stopPropagation();view()}
  btnRun.onpointerdown=event=>{event.preventDefault();event.stopPropagation();runPointer=event.pointerId;safeCapture(btnRun,event.pointerId);runHold=true;runDownAt=performance.now();syncRun()}
  const endRun=(toggle:boolean,pointerId?:number)=>{if(!runHold||(pointerId!==undefined&&pointerId!==runPointer))return;if(toggle&&performance.now()-runDownAt<220)runLock=!runLock;runHold=false;runPointer=-1;syncRun()}
  btnRun.onpointerup=event=>endRun(true,event.pointerId)
  btnRun.onpointercancel=event=>endRun(false,event.pointerId)
  new MutationObserver(()=>{if(document.body.hasAttribute('data-aboard')){runHold=false;runLock=false;runPointer=-1;resetStick()}})
    .observe(document.body,{attributes:true,attributeFilter:['data-aboard']})

  window.addEventListener('keydown',event=>{
    if(!active()||(event.target as HTMLElement)?.tagName==='INPUT')return
    keys.add(event.code)
    if(!event.repeat&&event.code==='Space'){jump=true;event.preventDefault()}
    if(!event.repeat&&event.code==='KeyC')view()
  })
  window.addEventListener('keyup',event=>keys.delete(event.code))
  window.addEventListener('blur',()=>{keys.clear();jump=false;runHold=false;touches.clear();mouseDown=false;resetStick()})

  function touchDistance(){
    const [a,b]=[...touches.values()]
    return a&&b?Math.hypot(a.x-b.x,a.y-b.y):0
  }
  canvas.addEventListener('pointerdown',event=>{
    if(!active())return
    if(event.pointerType==='mouse'){
      mouseDown=true;lastMouse={x:event.clientX,y:event.clientY};safeCapture(canvas,event.pointerId)
    }else{
      if(!panel.hidden && document.body.dataset.photo!=='on' && event.clientX<innerWidth*.45 && event.clientY>innerHeight*.55)return
      touches.set(event.pointerId,{x:event.clientX,y:event.clientY})
      safeCapture(canvas,event.pointerId)
      if(touches.size===2)pinchDist=touchDistance()
    }
  })
  canvas.addEventListener('pointermove',event=>{
    if(!active())return
    if(document.pointerLockElement===canvas){rotate(event.movementX,event.movementY);return}
    if(event.pointerType==='mouse'){
      if(!mouseDown)return
      const dx=event.clientX-lastMouse.x, dy=event.clientY-lastMouse.y
      lastMouse={x:event.clientX,y:event.clientY}
      rotate(dx||event.movementX,dy||event.movementY)
      return
    }
    const prev=touches.get(event.pointerId)
    if(!prev)return
    const dx=event.clientX-prev.x, dy=event.clientY-prev.y
    prev.x=event.clientX;prev.y=event.clientY
    if(touches.size===1){
      const scale=cfg.touchSensitivity/cfg.sensitivity
      rotate(dx*scale,dy*scale)
    }else if(touches.size===2){
      const nextDist=touchDistance()
      if(pinchDist>0&&nextDist>0)zoom((pinchDist-nextDist)*1.6)
      pinchDist=nextDist
    }
  })
  const releaseCanvas=(event:PointerEvent)=>{
    if(event.pointerType==='mouse')mouseDown=false
    else{touches.delete(event.pointerId);pinchDist=touches.size===2?touchDistance():0}
  }
  canvas.addEventListener('pointerup',releaseCanvas)
  canvas.addEventListener('pointercancel',releaseCanvas)
  canvas.addEventListener('lostpointercapture',releaseCanvas)
  canvas.addEventListener('wheel',event=>{if(active()){event.preventDefault();zoom(event.deltaY)}},{passive:false})

  return {
    show(on:boolean){
      panel.hidden=!on||!matchMedia('(pointer:coarse)').matches
      keys.clear();jump=false;runHold=false;runLock=false;touches.clear();mouseDown=false;resetStick()
    },
    read(){
      if(document.body.hasAttribute('data-aboard')&&(runHold||runLock)){runHold=false;runLock=false;runPointer=-1;syncRun()}
      const right=Math.max(-1,Math.min(1,+keys.has('KeyD')-+keys.has('KeyA')+stick.x))
      const forward=Math.max(-1,Math.min(1,+keys.has('KeyW')-+keys.has('KeyS')-stick.y))
      const run=keys.has('ShiftLeft')||keys.has('ShiftRight')||runHold||runLock||stick.mag>.9
      const jumped=jump;jump=false
      return {right,forward,run,jump:jumped}
    },
  }
}
