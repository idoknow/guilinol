import './walk.css'
import {walkConfig as cfg} from '../walk/config'
import type {CarDynamicTelemetry} from '../walk/car'
import type {EbikeRideControlInput, EbikeTelemetrySnapshot} from '../walk/ebike-fx'
import {isGlobalHotkeyBlocked, isTouchInControlZone} from '../walk/input-guard'

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
  rideHud.innerHTML='<span class="ride-type" data-kind="normal">电摩</span><span class="ride-gear">D2</span><span class="ride-gears" role="group" aria-label="挡位切换"><button class="ride-gear-btn" type="button" data-gear="1">D1</button><button class="ride-gear-btn on" type="button" data-gear="2">D2</button><button class="ride-gear-btn" type="button" data-gear="3">D3</button><button class="ride-gear-btn" type="button" data-gear="4">S</button></span><span class="ride-speed">0 km/h</span><span class="ride-bat" data-level="ok"><span class="ride-bat-bar"><i></i></span><span class="ride-bat-pct">100%</span></span><button class="ride-state" type="button" hidden></button><button class="ride-mod" type="button" aria-label="切换电动车改装">素车</button><span class="ride-keys">1-4/Q·E换挡 · Space翘头</span>'
  document.body.append(rideHud)
  const typeEl=rideHud.querySelector<HTMLElement>('.ride-type')!
  const gearEl=rideHud.querySelector<HTMLElement>('.ride-gear')!
  const gearButtons=Array.from(rideHud.querySelectorAll<HTMLButtonElement>('.ride-gear-btn'))
  const speedEl=rideHud.querySelector<HTMLElement>('.ride-speed')!
  const batEl=rideHud.querySelector<HTMLElement>('.ride-bat')!
  const batFillEl=rideHud.querySelector<HTMLElement>('.ride-bat-bar i')!
  const batPctEl=rideHud.querySelector<HTMLElement>('.ride-bat-pct')!
  const stateEl=rideHud.querySelector<HTMLButtonElement>('.ride-state')!
  const modBtn=rideHud.querySelector<HTMLButtonElement>('.ride-mod')!
  const keysEl=rideHud.querySelector<HTMLElement>('.ride-keys')!

  const joystick=panel.querySelector<HTMLElement>('.joystick')!, knob=panel.querySelector<HTMLElement>('.joystick-knob')!
  const btnRun=panel.querySelector<HTMLButtonElement>('.btn-run')!, btnJump=panel.querySelector<HTMLButtonElement>('.btn-jump')!, btnView=panel.querySelector<HTMLButtonElement>('.btn-view')!
  const btnWheelie=panel.querySelector<HTMLButtonElement>('.btn-wheelie')!
  const btnGearUp=panel.querySelector<HTMLButtonElement>('.btn-gear-up')!
  const btnGearDown=panel.querySelector<HTMLButtonElement>('.btn-gear-down')!
  const btnTuck=panel.querySelector<HTMLButtonElement>('.btn-tuck')!
  let jump=false, runHold=false, runLock=false, runDownAt=0, stickPointer=-1, runPointer=-1
  let wheelieTouch=false, wheeliePointer=-1, tuckTouch=false, tuckPointer=-1
  let gearDelta=0, gearSelect:number|null=null, recoverPulse=false, cycleModPulse=false
  let parkTogglePulse=false, kickstandTogglePulse=false, headlightCyclePulse=false
  const touches=new Map<number,{x:number,y:number}>()
  let mouseDown=false, lastMouse={x:0,y:0}, pinchDist=0

  function resetRideTouchControls(){
    wheelieTouch=false;wheeliePointer=-1;btnWheelie.classList.remove('on')
    tuckTouch=false;tuckPointer=-1;btnTuck.classList.remove('on');btnTuck.setAttribute('aria-pressed','false')
    gearDelta=0;gearSelect=null;recoverPulse=false;cycleModPulse=false
    parkTogglePulse=false;kickstandTogglePulse=false;headlightCyclePulse=false
  }
  function clearTransientInput(clearKeys=true){
    if(clearKeys)keys.clear()
    jump=false;runHold=false;runLock=false;runPointer=-1
    resetRideTouchControls()
    touches.clear();mouseDown=false;pinchDist=0
    resetStick()
  }

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
    wheelieTouch=true
    if(document.body.dataset.rideCrash==='1')recoverPulse=true
    btnWheelie.classList.add('on')
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
  for(const btn of gearButtons){
    btn.onpointerdown=event=>{event.stopPropagation()}
    btn.onclick=event=>{event.stopPropagation();const g=Number(btn.dataset.gear);if(g>=1)gearSelect=g}
  }
  stateEl.onpointerdown=event=>{event.stopPropagation()}
  stateEl.onclick=event=>{event.stopPropagation();if(document.body.dataset.rideCrash==='1')recoverPulse=true}
  btnRun.onpointerdown=event=>{event.preventDefault();event.stopPropagation();runPointer=event.pointerId;safeCapture(btnRun,event.pointerId);runHold=true;runDownAt=performance.now();syncRun()}
  const endRun=(toggle:boolean,pointerId?:number)=>{if(!runHold||(pointerId!==undefined&&pointerId!==runPointer))return;if(toggle&&performance.now()-runDownAt<220)runLock=!runLock;runHold=false;runPointer=-1;syncRun()}
  btnRun.onpointerup=event=>endRun(true,event.pointerId)
  btnRun.onpointercancel=event=>endRun(false,event.pointerId)
  new MutationObserver(()=>{
    if(document.body.dataset.photo==='on'){clearTransientInput(true);return}
    runHold=false;runLock=false;runPointer=-1
    resetRideTouchControls()
    resetStick()
  }).observe(document.body,{attributes:true,attributeFilter:['data-aboard','data-photo']})

  window.addEventListener('keydown',event=>{
    if(!active()||isGlobalHotkeyBlocked(event.target))return
    keys.add(event.code)
    const ridingTwoWheel=document.body.dataset.ride==='bike'||document.body.dataset.ride==='bicycle'
    const drivingCar=document.body.dataset.ride==='car'
    const crashed=document.body.dataset.rideCrash==='1'
    if(!event.repeat&&event.code==='Space'){
      if(ridingTwoWheel)recoverPulse=true
      else if(!drivingCar)jump=true
      event.preventDefault()
    }
    if(!event.repeat&&event.code==='KeyC')view()
    if((ridingTwoWheel||drivingCar)&&!event.repeat){
      if(event.code==='KeyE')gearDelta+=1
      else if(event.code==='KeyQ')gearDelta-=1
      else if(event.code==='KeyG'&&document.body.dataset.ride==='bike')cycleModPulse=true
      else if(event.code==='KeyP'&&document.body.dataset.ride==='bike'&&!crashed&&!event.shiftKey&&!event.altKey&&!event.ctrlKey&&!event.metaKey){
        parkTogglePulse=true
        event.preventDefault()
      }
      else if(event.code==='KeyK'&&ridingTwoWheel&&!crashed)kickstandTogglePulse=true
      else if(event.code==='KeyL'&&(document.body.dataset.ride==='bike'||drivingCar)&&!crashed)headlightCyclePulse=true
      else if(event.code==='Digit1'||event.code==='Digit2'||event.code==='Digit3'||(ridingTwoWheel&&event.code==='Digit4'))gearSelect=Number(event.code.slice(-1))
    }
  })
  // Capture-phase keyup ensures modal dialogs calling stopPropagation() never leave stuck movement/ride keys.
  window.addEventListener('keyup',event=>keys.delete(event.code),{capture:true})
  window.addEventListener('blur',()=>clearTransientInput(true))
  document.addEventListener('visibilitychange',()=>{if(document.hidden)clearTransientInput(true)})

  function touchDistance(){
    const [a,b]=[...touches.values()]
    return a&&b?Math.hypot(a.x-b.x,a.y-b.y):0
  }
  canvas.addEventListener('pointerdown',event=>{
    if(!active())return
    if(event.pointerType==='mouse'){
      mouseDown=true;lastMouse={x:event.clientX,y:event.clientY};safeCapture(canvas,event.pointerId)
    }else{
      if(isTouchInControlZone({
        clientX:event.clientX,clientY:event.clientY,innerWidth,innerHeight,
        panelVisible:!panel.hidden,photoOn:document.body.dataset.photo==='on',
        aboard:document.body.hasAttribute('data-aboard'),target:event.target,
      }))return
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
      clearTransientInput(true)
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
      const crashed=document.body.dataset.rideCrash==='1'
      const out:EbikeRideControlInput={
        gearDelta,
        gearSelect,
        wheelie:crashed?false:(keys.has('Space')||wheelieTouch),
        tuck:crashed?false:(keys.has('ShiftLeft')||keys.has('ShiftRight')||tuckTouch),
        recover:recoverPulse,
        cycleMod:cycleModPulse,
        parkToggle:parkTogglePulse,
        kickstandToggle:kickstandTogglePulse,
        headlightCycle:headlightCyclePulse,
      }
      gearDelta=0;gearSelect=null;recoverPulse=false;cycleModPulse=false
      parkTogglePulse=false;kickstandTogglePulse=false;headlightCyclePulse=false
      return out
    },
    syncRideHud(state:EbikeTelemetrySnapshot|null,rideKind:'bike'|'bicycle'|'car'|'boat'|null){
      if(rideKind)document.body.dataset.ride=rideKind
      else delete document.body.dataset.ride
      if(state&&rideKind==='bike')document.body.dataset.rideType=state.vehicleType
      else delete document.body.dataset.rideType
      if(!state||(rideKind!=='bike'&&rideKind!=='bicycle')){
        stateEl.hidden=true
        delete document.body.dataset.rideCrash
        return
      }
      const bikeGearLabels=['D1','D2','D3','S']
      const bicycleGearLabels=['1挡','2挡','3挡']
      const gearLabels=rideKind==='bicycle'?bicycleGearLabels:bikeGearLabels
      if(rideKind==='bicycle'){
        typeEl.dataset.kind='bicycle';typeEl.textContent='单车'
        gearEl.textContent=state.gearLabel||'2挡'
        gearEl.title=`单车 · 本挡限速 ${Math.round(state.maxKmh)} km/h（1-3 / Q·E 换挡）`
        keysEl.textContent='1-3/Q·E换挡 · Space翘头'
      }else{
        typeEl.dataset.kind=state.vehicleType;typeEl.textContent=state.vehicleBadge
        gearEl.textContent=state.parkLocked?'P':state.gearLabel
        gearEl.title=state.parkLocked
          ?`${state.vehicleLabel} · P档驻车（按 P/K 或 E 解除）`
          :`${state.vehicleLabel} · 本挡限速 ${Math.round(state.maxKmh)} km/h（1-4 / Q·E 换挡）`
        const lightTag=state.headlight==='high'?'远光':state.headlight==='low'?'近光':'关灯'
        keysEl.textContent=`1-4/Q·E换挡 · P驻车 · L${lightTag}`
        const pct=Math.max(0,Math.min(100,Math.round(state.battery)))
        batEl.dataset.level=state.criticalBattery?'crit':state.lowBattery?'low':'ok'
        batFillEl.style.width=`${pct}%`
        batPctEl.textContent=`${pct}%`
      }
      for(let i=0;i<gearButtons.length;i++){
        const btn=gearButtons[i]
        const label=gearLabels[i]
        btn.hidden=!label
        if(label){
          btn.textContent=label
          const activeGear=state.gear===i+1
          btn.classList.toggle('on',activeGear)
          btn.setAttribute('aria-pressed',String(activeGear))
        }
      }
      speedEl.textContent=`${state.kmh} km/h`
      modBtn.textContent=MOD_LABELS[state.modPreset]
      const leanDeg=Math.round(Math.abs(state.lean)*180/Math.PI)
      const wheelieDeg=Math.round(Math.max(0,state.wheelie)*180/Math.PI)
      const crashed=state.crashPhase==='crashed'
      document.body.dataset.rideCrash=crashed?'1':'0'
      if(crashed){
        stateEl.hidden=false;stateEl.dataset.warn='1'
        stateEl.textContent='摔车 · 空格先爬起'
        btnWheelie.textContent='爬起';btnWheelie.classList.add('on')
      }else if(state.crashPhase==='recovering'){
        stateEl.hidden=false;stateEl.dataset.warn='0'
        stateEl.textContent='爬起中…'
        btnWheelie.textContent='翘头'
      }else{
        btnWheelie.textContent='翘头'
        btnWheelie.classList.toggle('on',wheelieTouch||keys.has('Space'))
        if(rideKind==='bike'&&state.parkLocked){
          stateEl.hidden=false;stateEl.dataset.warn='0'
          stateEl.textContent=state.kickstandDown?'P档 · 边撑已放':'P档驻车'
        }else if(state.kickstandDown){
          stateEl.hidden=false;stateEl.dataset.warn='0'
          stateEl.textContent='边撑放下 · 按K收起'
        }else if(rideKind==='bike'&&state.batteryDepleted){
          stateEl.hidden=false;stateEl.dataset.warn='1'
          stateEl.textContent=state.maxKmh>0?`电量耗尽 · 限速 ${Math.round(state.maxKmh)}`:'电量耗尽'
        }else if(rideKind==='bike'&&state.criticalBattery){
          stateEl.hidden=false;stateEl.dataset.warn='1'
          stateEl.textContent=`极低电 · 限速 ${Math.round(state.maxKmh)}`
        }else if(wheelieDeg>=4){
          stateEl.hidden=false;stateEl.dataset.warn=wheelieDeg>=26?'1':'0'
          stateEl.textContent=wheelieDeg>=26?`翘头 ${wheelieDeg}° 易翻`:`翘头 ${wheelieDeg}°`
        }else if(leanDeg>=8){
          const risky=Math.abs(state.lean)>=state.leanLimit*.82||(state.crashRisk??0)>=.72
          stateEl.hidden=false;stateEl.dataset.warn=risky?'1':'0'
          stateEl.textContent=risky?`压弯 ${leanDeg}° 易摔`:`压弯 ${leanDeg}°`
        }else if(rideKind==='bike'&&state.lowBattery){
          stateEl.hidden=false;stateEl.dataset.warn='1'
          stateEl.textContent='低电预警'
        }else{
          stateEl.hidden=true;stateEl.dataset.warn='0'
        }
      }
    },
    syncCarHud(state:CarDynamicTelemetry|null){
      if(!state){
        stateEl.hidden=true
        delete document.body.dataset.rideCrash
        return
      }
      document.body.dataset.ride='car'
      delete document.body.dataset.rideType
      delete document.body.dataset.rideCrash
      typeEl.dataset.kind='car';typeEl.textContent='轿车'
      gearEl.textContent=state.gearLabel
      gearEl.title=`自动挡 ${state.gearLabel} · ${state.modeLabel}模式上限 ${state.maxKmh} km/h（1-3 / Q·E 切模式）`
      const modeLabels=['合规40','街道75','运动108']
      for(let i=0;i<gearButtons.length;i++){
        const btn=gearButtons[i]
        const label=modeLabels[i]
        btn.hidden=!label
        if(label){
          btn.textContent=label
          const activeMode=state.modeIndex===i+1
          btn.classList.toggle('on',activeMode)
          btn.setAttribute('aria-pressed',String(activeMode))
        }
      }
      speedEl.textContent=`${state.kmh} km/h`
      const rpmPct=Math.max(5,Math.min(100,Math.round(state.rpmRatio*100)))
      batEl.dataset.level=state.rpm>=5600?'crit':state.rpm>=4400?'low':'ok'
      batFillEl.style.width=`${rpmPct}%`
      batPctEl.textContent=`${(state.rpm/1000).toFixed(1)}k`
      keysEl.textContent='Space手刹漂移 · 1-3/Q·E切模式'
      btnWheelie.textContent='手刹'
      btnWheelie.classList.toggle('on',state.handbrake)
      const slipDeg=Math.round(Math.abs(state.slipAngle)*180/Math.PI)
      if(state.impactStrength>.32){
        stateEl.hidden=false;stateEl.dataset.warn='1'
        stateEl.textContent='撞击缓冲'
      }else if(state.driftIntensity>.22){
        stateEl.hidden=false;stateEl.dataset.warn=state.driftIntensity>.62?'1':'0'
        stateEl.textContent=state.handbrake?`手刹漂移 ${slipDeg}°`:`侧滑 ${slipDeg}°`
      }else if(state.handbrake&&state.kmh>3){
        stateEl.hidden=false;stateEl.dataset.warn='0'
        stateEl.textContent='手刹拉起'
      }else if(state.shifting){
        stateEl.hidden=false;stateEl.dataset.warn='0'
        stateEl.textContent=`升挡 ${state.gearLabel}`
      }else{
        stateEl.hidden=true;stateEl.dataset.warn='0'
      }
    },
  }
}
