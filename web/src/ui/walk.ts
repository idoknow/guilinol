import './walk.css'
import {walkConfig as cfg} from '../walk/config'
import type {EbikeRideControlInput, EbikeTelemetrySnapshot} from '../walk/ebike-fx'

const MOD_LABELS = {stock: '素车', ghostfire: '鬼火', neon: '霓虹'} as const

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
    +'<button class="btn-wheelie" type="button" aria-label="翘头或扶车">翘头</button>'
    +'<button class="btn-gear-up" type="button" aria-label="升挡">+挡</button>'
    +'<button class="btn-gear-down" type="button" aria-label="降挡">-挡</button>'
    +'<button class="btn-tuck" type="button" aria-label="深压弯" aria-pressed="false">压弯</button>'
  document.body.append(panel);panel.hidden=true

  const rideHud=document.createElement('div')
  rideHud.className='ride-hud'
  rideHud.innerHTML='<span class="ride-type" data-kind="normal">电摩</span><span class="ride-gear">D2</span><span class="ride-speed">0 km/h</span><span class="ride-bat" data-level="ok"><span class="ride-bat-bar"><i></i></span><span class="ride-bat-pct">100%</span></span><span class="ride-state" hidden></span><button class="ride-mod" type="button" aria-label="切换电动车改装">素车</button>'
  document.body.append(rideHud)
  const typeEl=rideHud.querySelector<HTMLElement>('.ride-type')!
  const gearEl=rideHud.querySelector<HTMLElement>('.ride-gear')!
  const speedEl=rideHud.querySelector<HTMLElement>('.ride-speed')!
  const batEl=rideHud.querySelector<HTMLElement>('.ride-bat')!
  const batFillEl=rideHud.querySelector<HTMLElement>('.ride-bat-bar i')!
  const batPctEl=rideHud.querySelector<HTMLElement>('.ride-bat-pct')!
  const stateEl=rideHud.querySelector<HTMLElement>('.ride-state')!
  const modBtn=rideHud.querySelector<HTMLButtonElement>('.ride-mod')!

  const joystick=panel.querySelector<HTMLElement>('.joystick')!, knob=panel.querySelector<HTMLElement>('.joystick-knob')!
  const btnRun=panel.querySelector<HTMLButtonElement>('.btn-run')!, btnJump=panel.querySelector<HTMLButtonElement>('.btn-jump')!, btnView=panel.querySelector<HTMLButtonElement>('.btn-view')!
  const btnWheelie=panel.querySelector<HTMLButtonElement>('.btn-wheelie')!
  const btnGearUp=panel.querySelector<HTMLButtonElement>('.btn-gear-up')!
  const btnGearDown=panel.querySelector<HTMLButtonElement>('.btn-gear-down')!
  const btnTuck=panel.querySelector<HTMLButtonElement>('.btn-tuck')!
  let jump=false, runHold=false, runLock=false, runDownAt=0, stickPointer=-1, runPointer=-1
  let wheelieTouch=false, wheeliePointer=-1, tuckTouch=false, tuckPointer=-1
  let gearDelta=0, gearSelect:number|null=null, recoverPulse=false, cycleModPulse=false
  const touches=new Map<number,{x:number,y:number}>()
  let mouseDown=false, lastMouse={x:0,y:0}, pinchDist=0

  function syncRun(){
    const running=runHold||runLock||stick.mag>.9
    btnRun.classList.toggle('on',runHold||runLock)
    btnRun.setAttribute('aria-pressed',String(runHold||runLock))
    joystick.classList.toggle('running',running&&stick.mag>.1&&!document.body.hasAttribute('data-aboard'))
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
  window.addEventListener('pointerup',event=>{
    endStick(event)
    if(event.pointerId===runPointer)endRun(true,event.pointerId)
    if(event.pointerId===wheeliePointer){wheelieTouch=false;wheeliePointer=-1;btnWheelie.classList.remove('on')}
    if(event.pointerId===tuckPointer){tuckTouch=false;tuckPointer=-1;btnTuck.classList.remove('on');btnTuck.setAttribute('aria-pressed','false')}
  })
  window.addEventListener('pointercancel',event=>{
    endStick(event)
    if(event.pointerId===runPointer)endRun(false,event.pointerId)
    if(event.pointerId===wheeliePointer){wheelieTouch=false;wheeliePointer=-1;btnWheelie.classList.remove('on')}
    if(event.pointerId===tuckPointer){tuckTouch=false;tuckPointer=-1;btnTuck.classList.remove('on');btnTuck.setAttribute('aria-pressed','false')}
  })

  btnJump.onpointerdown=event=>{event.preventDefault();event.stopPropagation();jump=true}
  btnView.onpointerdown=event=>{event.preventDefault();event.stopPropagation();view()}
  btnGearUp.onpointerdown=event=>{event.preventDefault();event.stopPropagation();gearDelta+=1}
  btnGearDown.onpointerdown=event=>{event.preventDefault();event.stopPropagation();gearDelta-=1}
  btnWheelie.onpointerdown=event=>{
    event.preventDefault();event.stopPropagation()
    wheeliePointer=event.pointerId;safeCapture(btnWheelie,event.pointerId)
    wheelieTouch=true;recoverPulse=true;btnWheelie.classList.add('on')
  }
  const endWheelie=(event:PointerEvent)=>{if(event.pointerId===wheeliePointer){wheelieTouch=false;wheeliePointer=-1;btnWheelie.classList.remove('on')}}
  btnWheelie.onpointerup=endWheelie;btnWheelie.onpointercancel=endWheelie;btnWheelie.onlostpointercapture=endWheelie
  btnTuck.onpointerdown=event=>{
    event.preventDefault();event.stopPropagation()
    tuckPointer=event.pointerId;safeCapture(btnTuck,event.pointerId)
    tuckTouch=true;btnTuck.classList.add('on');btnTuck.setAttribute('aria-pressed','true')
  }
  const endTuck=(event:PointerEvent)=>{if(event.pointerId===tuckPointer){tuckTouch=false;tuckPointer=-1;btnTuck.classList.remove('on');btnTuck.setAttribute('aria-pressed','false')}}
  btnTuck.onpointerup=endTuck;btnTuck.onpointercancel=endTuck;btnTuck.onlostpointercapture=endTuck
  modBtn.onpointerdown=event=>{event.stopPropagation()}
  modBtn.onclick=event=>{event.stopPropagation();cycleModPulse=true}
  btnRun.onpointerdown=event=>{event.preventDefault();event.stopPropagation();runPointer=event.pointerId;safeCapture(btnRun,event.pointerId);runHold=true;runDownAt=performance.now();syncRun()}
  const endRun=(toggle:boolean,pointerId?:number)=>{if(!runHold||(pointerId!==undefined&&pointerId!==runPointer))return;if(toggle&&performance.now()-runDownAt<220)runLock=!runLock;runHold=false;runPointer=-1;syncRun()}
  btnRun.onpointerup=event=>endRun(true,event.pointerId)
  btnRun.onpointercancel=event=>endRun(false,event.pointerId)
  new MutationObserver(()=>{if(document.body.hasAttribute('data-aboard')){runHold=false;runLock=false;runPointer=-1;resetStick()}})
    .observe(document.body,{attributes:true,attributeFilter:['data-aboard']})

  window.addEventListener('keydown',event=>{
    if(!active()||document.body.hasAttribute('data-home')||document.body.dataset.photo==='on'||document.querySelector('dialog[open],.about-mask:not([hidden]),.atlas.show,.book.show')||(event.target as Element)?.closest?.('input,textarea,select,[contenteditable]'))return
    keys.add(event.code)
    const ridingBike=document.body.dataset.ride==='bike'
    if(!event.repeat&&event.code==='Space'){
      if(ridingBike)recoverPulse=true
      else jump=true
      event.preventDefault()
    }
    if(!event.repeat&&event.code==='KeyC')view()
    if(ridingBike&&!event.repeat){
      if(event.code==='KeyE')gearDelta+=1
      else if(event.code==='KeyQ')gearDelta-=1
      else if(event.code==='KeyG')cycleModPulse=true
      else if(event.code==='Digit1'||event.code==='Digit2'||event.code==='Digit3'||event.code==='Digit4')gearSelect=Number(event.code.slice(-1))
    }
  })
  window.addEventListener('keyup',event=>keys.delete(event.code))
  window.addEventListener('blur',()=>{keys.clear();jump=false;runHold=false;wheelieTouch=false;tuckTouch=false;touches.clear();mouseDown=false;resetStick()})

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
    clearRun(){
      runHold=false;runLock=false;runPointer=-1;syncRun()
    },
    read(){
      if(document.body.hasAttribute('data-aboard')&&(runHold||runLock)){runHold=false;runLock=false;runPointer=-1;syncRun()}
      const right=Math.max(-1,Math.min(1,+keys.has('KeyD')-+keys.has('KeyA')+stick.x))
      const forward=Math.max(-1,Math.min(1,+keys.has('KeyW')-+keys.has('KeyS')-stick.y))
      const run=keys.has('ShiftLeft')||keys.has('ShiftRight')||runHold||runLock||stick.mag>.9
      const jumped=jump;jump=false
      return {right,forward,run,jump:jumped}
    },
    readRideControls():EbikeRideControlInput{
      const out:EbikeRideControlInput={
        gearDelta,
        gearSelect,
        wheelie:keys.has('Space')||wheelieTouch,
        tuck:keys.has('ShiftLeft')||keys.has('ShiftRight')||tuckTouch,
        recover:recoverPulse,
        cycleMod:cycleModPulse,
      }
      gearDelta=0;gearSelect=null;recoverPulse=false;cycleModPulse=false
      return out
    },
    syncRideHud(state:EbikeTelemetrySnapshot|null,rideKind:'bike'|'bicycle'|'car'|'boat'|null){
      if(rideKind)document.body.dataset.ride=rideKind
      else delete document.body.dataset.ride
      if(state&&rideKind==='bike')document.body.dataset.rideType=state.vehicleType
      else delete document.body.dataset.rideType
      if(!state||(rideKind!=='bike'&&rideKind!=='bicycle')){
        stateEl.hidden=true
        return
      }
      if(rideKind==='bicycle'){
        typeEl.dataset.kind='bicycle';typeEl.textContent='单车'
        gearEl.textContent='人力';gearEl.removeAttribute('title')
      }else{
        typeEl.dataset.kind=state.vehicleType;typeEl.textContent=state.vehicleBadge
        gearEl.textContent=state.gearLabel
        gearEl.title=`${state.vehicleLabel} · 本挡限速 ${Math.round(state.maxKmh)} km/h`
        const pct=Math.max(0,Math.min(100,Math.round(state.battery)))
        batEl.dataset.level=state.criticalBattery?'crit':state.lowBattery?'low':'ok'
        batFillEl.style.width=`${pct}%`
        batPctEl.textContent=`${pct}%`
      }
      speedEl.textContent=`${state.kmh} km/h`
      modBtn.textContent=MOD_LABELS[state.modPreset]
      const leanDeg=Math.round(Math.abs(state.lean)*180/Math.PI)
      const wheelieDeg=Math.round(Math.max(0,state.wheelie)*180/Math.PI)
      if(state.crashPhase==='crashed'){
        stateEl.hidden=false;stateEl.dataset.warn='1'
        stateEl.textContent='摔车 · 空格扶起'
        btnWheelie.textContent='扶车';btnWheelie.classList.add('on')
      }else if(state.crashPhase==='recovering'){
        stateEl.hidden=false;stateEl.dataset.warn='0'
        stateEl.textContent='扶车中…'
        btnWheelie.textContent='扶车'
      }else{
        btnWheelie.textContent='翘头'
        btnWheelie.classList.toggle('on',wheelieTouch||keys.has('Space'))
        if(rideKind==='bike'&&state.batteryDepleted){
          stateEl.hidden=false;stateEl.dataset.warn='1'
          stateEl.textContent=state.maxKmh>0?`电量耗尽 · 限速 ${Math.round(state.maxKmh)}`:'电量耗尽'
        }else if(rideKind==='bike'&&state.criticalBattery){
          stateEl.hidden=false;stateEl.dataset.warn='1'
          stateEl.textContent=`极低电 · 限速 ${Math.round(state.maxKmh)}`
        }else if(wheelieDeg>=4){
          stateEl.hidden=false;stateEl.dataset.warn=wheelieDeg>=38?'1':'0'
          stateEl.textContent=`翘头 ${wheelieDeg}°`
        }else if(leanDeg>=8){
          stateEl.hidden=false;stateEl.dataset.warn=Math.abs(state.lean)>=state.leanLimit*.86?'1':'0'
          stateEl.textContent=`压弯 ${leanDeg}°`
        }else if(rideKind==='bike'&&state.lowBattery){
          stateEl.hidden=false;stateEl.dataset.warn='1'
          stateEl.textContent='低电预警'
        }else{
          stateEl.hidden=true;stateEl.dataset.warn='0'
        }
      }
    },
  }
}
