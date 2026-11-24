import './walk.css'
import {walkConfig as cfg} from '../walk/config'
import type {CarDynamicTelemetry} from '../walk/car'
import type {EbikeRideControlInput, EbikeTelemetrySnapshot} from '../walk/ebike-fx'
import {isGlobalHotkeyBlocked, isModalOrOverlayOpen, isTouchInControlZone} from '../walk/input-guard'
import {hits, type Action} from '../input/keymap'

const MOD_LABELS = {stock: '素车', ghostfire: '鬼火', neon: '霓虹'} as const

function safeCapture(el:Element, pointerId:number) {
  try { el.setPointerCapture(pointerId) } catch {}
}

export function walkInput(canvas:HTMLCanvasElement,active:()=>boolean,rotate:(dx:number,dy:number)=>void,zoom:(delta:number)=>void,view:()=>void){
  const keys=new Set<string>(), stick={x:0,y:0,mag:0}, panel=document.createElement('div')
// 键位可改：keys 里存物理 code，判定时问 keymap 这个 code 现在是不是在做该动作。
const held=(action:Action)=>{let on=false;keys.forEach(code=>{if(!on&&hits(code,action))on=true});return on}
  panel.className='walk-ui'
  panel.innerHTML='<div class="joystick" role="group" aria-label="移动"><span class="joystick-knob"></span></div>'
    +'<button class="btn-run" type="button" aria-label="奔跑" aria-pressed="false">跑</button>'
    +'<button class="btn-crouch" type="button" aria-label="蹲伏" aria-pressed="false">蹲</button>'
    +'<button class="btn-jump" type="button" aria-label="跳">跃</button>'
    +'<button class="btn-view" type="button" aria-label="切换视距">远近</button>'
    +'<button class="btn-wheelie" type="button" aria-label="翘头或扶车">翘头</button>'
    +'<button class="btn-gear-up" type="button" aria-label="升挡">+挡</button>'
    +'<button class="btn-gear-down" type="button" aria-label="降挡">-挡</button>'
    +'<button class="btn-tuck" type="button" aria-label="深压弯" aria-pressed="false">压弯</button>'
    +'<button class="btn-hail" type="button" aria-label="叫一辆附近的共享电车">叫车</button>'
  document.body.append(panel);panel.hidden=true

  const rideHud=document.createElement('div')
  rideHud.className='ride-hud'
  rideHud.innerHTML='<span class="ride-type" data-kind="normal">电摩</span><span class="ride-gear">D2</span><span class="ride-gears" role="group" aria-label="挡位切换"><button class="ride-gear-btn" type="button" data-gear="1">D1</button><button class="ride-gear-btn on" type="button" data-gear="2">D2</button><button class="ride-gear-btn" type="button" data-gear="3">D3</button><button class="ride-gear-btn" type="button" data-gear="4">S</button></span><span class="ride-speed">0 km/h</span><span class="ride-bat" data-level="ok"><span class="ride-bat-bar"><i></i></span><span class="ride-bat-pct">100%</span></span><span class="ride-lean-bar" title="压弯倾角风险"><i></i></span><button class="ride-park" type="button" aria-label="P档驻车" title="P档驻车 / 边撑 (0/P/K)">P</button><button class="ride-light" type="button" aria-label="切换车灯" title="车灯切换 关/近/远 (L)">关灯</button><button class="ride-turn-left" type="button" aria-label="左转向灯" title="左转向灯 (Z)">◀</button><button class="ride-turn-right" type="button" aria-label="右转向灯" title="右转向灯 (X)">▶</button><button class="ride-hazard" type="button" aria-label="双闪警示灯" title="双闪警示灯 (B)">⚠</button><button class="ride-horn" type="button" aria-label="喇叭鸣笛" title="喇叭鸣笛 (H)">喇叭</button><button class="ride-cruise" type="button" aria-label="定速巡航" title="定速巡航 (U)">定速</button><button class="ride-state" type="button" hidden></button><button class="ride-mod" type="button" aria-label="切换电动车改装">素车</button><span class="ride-keys">0/P驻车 · K撑 · L灯 · Z/X/B · H喇叭 · U定速 · G改 · Shift压弯</span>'
  document.body.append(rideHud)
  const typeEl=rideHud.querySelector<HTMLElement>('.ride-type')!
  const gearEl=rideHud.querySelector<HTMLElement>('.ride-gear')!
  const gearButtons=Array.from(rideHud.querySelectorAll<HTMLButtonElement>('.ride-gear-btn'))
  const speedEl=rideHud.querySelector<HTMLElement>('.ride-speed')!
  const batEl=rideHud.querySelector<HTMLElement>('.ride-bat')!
  const batFillEl=rideHud.querySelector<HTMLElement>('.ride-bat-bar i')!
  const batPctEl=rideHud.querySelector<HTMLElement>('.ride-bat-pct')!
  const leanBarEl=rideHud.querySelector<HTMLElement>('.ride-lean-bar')!
  const leanBarFillEl=rideHud.querySelector<HTMLElement>('.ride-lean-bar i')!
  const parkBtn=rideHud.querySelector<HTMLButtonElement>('.ride-park')!
  const lightBtn=rideHud.querySelector<HTMLButtonElement>('.ride-light')!
  const turnLeftBtn=rideHud.querySelector<HTMLButtonElement>('.ride-turn-left')!
  const turnRightBtn=rideHud.querySelector<HTMLButtonElement>('.ride-turn-right')!
  const hazardBtn=rideHud.querySelector<HTMLButtonElement>('.ride-hazard')!
  const hornBtn=rideHud.querySelector<HTMLButtonElement>('.ride-horn')!
  const cruiseBtn=rideHud.querySelector<HTMLButtonElement>('.ride-cruise')!
  const stateEl=rideHud.querySelector<HTMLButtonElement>('.ride-state')!
  const modBtn=rideHud.querySelector<HTMLButtonElement>('.ride-mod')!
  const keysEl=rideHud.querySelector<HTMLElement>('.ride-keys')!

  const joystick=panel.querySelector<HTMLElement>('.joystick')!, knob=panel.querySelector<HTMLElement>('.joystick-knob')!
  const btnRun=panel.querySelector<HTMLButtonElement>('.btn-run')!, btnCrouch=panel.querySelector<HTMLButtonElement>('.btn-crouch')!, btnJump=panel.querySelector<HTMLButtonElement>('.btn-jump')!, btnView=panel.querySelector<HTMLButtonElement>('.btn-view')!
  const btnWheelie=panel.querySelector<HTMLButtonElement>('.btn-wheelie')!
  const btnGearUp=panel.querySelector<HTMLButtonElement>('.btn-gear-up')!
  const btnGearDown=panel.querySelector<HTMLButtonElement>('.btn-gear-down')!
  const btnTuck=panel.querySelector<HTMLButtonElement>('.btn-tuck')!
  let jump=false, crouch=false, runHold=false, runLock=false, runDownAt=0, stickPointer=-1, runPointer=-1
  function syncCrouch(){
    btnCrouch.classList.toggle('on',crouch)
    btnCrouch.setAttribute('aria-pressed',String(crouch))
  }
  let wheelieTouch=false, wheeliePointer=-1, tuckTouch=false, tuckPointer=-1
  let hornTouch=false, hornPointer=-1, hornPulse=false
  let gearDelta=0, gearSelect:number|null=null, recoverPulse=false, cycleModPulse=false
  let parkTogglePulse=false, kickstandTogglePulse=false, headlightCyclePulse=false
  let turnLeftPulse=false, turnRightPulse=false, hazardPulse=false, cruisePulse=false
  const touches=new Map<number,{x:number,y:number}>()
  let mouseDown=false, lastMouse={x:0,y:0}, pinchDist=0

  function resetRideTouchControls(){
    wheelieTouch=false;wheeliePointer=-1;btnWheelie.classList.remove('on')
    tuckTouch=false;tuckPointer=-1;btnTuck.classList.remove('on');btnTuck.setAttribute('aria-pressed','false')
    hornTouch=false;hornPointer=-1;hornPulse=false;hornBtn.classList.remove('on')
    gearDelta=0;gearSelect=null;recoverPulse=false;cycleModPulse=false
    parkTogglePulse=false;kickstandTogglePulse=false;headlightCyclePulse=false
    turnLeftPulse=false;turnRightPulse=false;hazardPulse=false;cruisePulse=false
  }
  function clearTransientInput(clearKeys=true){
    if(clearKeys)keys.clear()
    jump=false;crouch=false;syncCrouch();runHold=false;runLock=false;runPointer=-1
    resetRideTouchControls()
    touches.clear();mouseDown=false;pinchDist=0
    resetStick()
  }

  function syncRun(){
    const running=runHold||runLock||stick.mag>.9
    if(running&&crouch){crouch=false;syncCrouch()}
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
    if(event.pointerId===hornPointer){hornTouch=false;hornPointer=-1;hornBtn.classList.remove('on')}
  })
  window.addEventListener('pointercancel',event=>{
    endStick(event)
    if(event.pointerId===runPointer)endRun(false,event.pointerId)
    if(event.pointerId===wheeliePointer){wheelieTouch=false;wheeliePointer=-1;btnWheelie.classList.remove('on')}
    if(event.pointerId===tuckPointer){tuckTouch=false;tuckPointer=-1;btnTuck.classList.remove('on');btnTuck.setAttribute('aria-pressed','false')}
    if(event.pointerId===hornPointer){hornTouch=false;hornPointer=-1;hornBtn.classList.remove('on')}
  })

  btnJump.onpointerdown=event=>{event.preventDefault();event.stopPropagation();crouch=false;syncCrouch();jump=true}
  btnCrouch.onpointerdown=event=>{event.preventDefault();event.stopPropagation();crouch=!crouch;if(crouch){runHold=false;runLock=false;syncRun()}syncCrouch()}
  btnView.onpointerdown=event=>{event.preventDefault();event.stopPropagation();view()}
  const btnHail=panel.querySelector<HTMLButtonElement>('.btn-hail')!
  btnHail.onpointerdown=event=>{event.preventDefault();event.stopPropagation();window.dispatchEvent(new CustomEvent('walk:hail'))}
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
  parkBtn.onpointerdown=event=>{event.stopPropagation()}
  parkBtn.onclick=event=>{event.stopPropagation();if(document.body.dataset.rideCrash!=='1')parkTogglePulse=true}
  lightBtn.onpointerdown=event=>{event.stopPropagation()}
  lightBtn.onclick=event=>{event.stopPropagation();if(document.body.dataset.rideCrash!=='1')headlightCyclePulse=true}
  turnLeftBtn.onpointerdown=event=>{event.stopPropagation()}
  turnLeftBtn.onclick=event=>{event.stopPropagation();if(document.body.dataset.rideCrash!=='1')turnLeftPulse=true}
  turnRightBtn.onpointerdown=event=>{event.stopPropagation()}
  turnRightBtn.onclick=event=>{event.stopPropagation();if(document.body.dataset.rideCrash!=='1')turnRightPulse=true}
  hazardBtn.onpointerdown=event=>{event.stopPropagation()}
  hazardBtn.onclick=event=>{event.stopPropagation();if(document.body.dataset.rideCrash!=='1')hazardPulse=true}
  hornBtn.onpointerdown=event=>{
    event.stopPropagation()
    if(document.body.dataset.rideCrash==='1')return
    hornPointer=event.pointerId;safeCapture(hornBtn,event.pointerId)
    hornTouch=true;hornPulse=true;hornBtn.classList.add('on')
  }
  const endHorn=(event:PointerEvent)=>{if(event.pointerId===hornPointer){hornTouch=false;hornPointer=-1;hornBtn.classList.remove('on')}}
  hornBtn.onpointerup=endHorn;hornBtn.onpointercancel=endHorn;hornBtn.onlostpointercapture=endHorn
  hornBtn.onclick=event=>{event.stopPropagation();if(document.body.dataset.rideCrash!=='1')hornPulse=true}
  cruiseBtn.onpointerdown=event=>{event.stopPropagation()}
  cruiseBtn.onclick=event=>{event.stopPropagation();if(document.body.dataset.rideCrash!=='1')cruisePulse=true}
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
    if(document.body.dataset.photo==='on'||document.body.dataset.shopOpen==='1'){clearTransientInput(true);return}
    crouch=false;syncCrouch()
    runHold=false;runLock=false;runPointer=-1
    resetRideTouchControls()
    resetStick()
  }).observe(document.body,{attributes:true,attributeFilter:['data-aboard','data-photo','data-shop-open']})

  window.addEventListener('keydown',event=>{
    if(!active()||isGlobalHotkeyBlocked(event.target))return
    keys.add(event.code)
    const ridingTwoWheel=document.body.dataset.ride==='bike'||document.body.dataset.ride==='bicycle'
    const drivingCar=document.body.dataset.ride==='car'
    const aboard=document.body.hasAttribute('data-aboard')
    const crashed=document.body.dataset.rideCrash==='1'
    if(!event.repeat&&hits(event.code,'jump')){
      if(ridingTwoWheel)recoverPulse=true
      else if(!drivingCar){crouch=false;syncCrouch();jump=true}
      event.preventDefault()
    }
    if(!event.repeat&&event.code==='KeyC')view()
    if(!event.repeat&&hits(event.code,'crouch')&&!aboard){crouch=!crouch;syncCrouch()}
    if(!event.repeat&&hits(event.code,'run')&&!aboard&&crouch){crouch=false;syncCrouch()}
    if((ridingTwoWheel||drivingCar)&&!event.repeat){
      if(event.code==='KeyE')gearDelta+=1
      else if(event.code==='KeyQ')gearDelta-=1
      else if(event.code==='KeyG'&&document.body.dataset.ride==='bike')cycleModPulse=true
      else if(event.code==='KeyP'&&document.body.dataset.ride==='bike'&&!crashed&&!event.shiftKey&&!event.altKey&&!event.ctrlKey&&!event.metaKey){
        parkTogglePulse=true
        event.preventDefault()
      }
      else if(event.code==='Digit0'&&document.body.dataset.ride==='bike'&&!crashed&&!parkBtn.classList.contains('on'))parkTogglePulse=true
      else if(event.code==='KeyK'&&ridingTwoWheel&&!crashed)kickstandTogglePulse=true
      else if(event.code==='KeyL'&&(document.body.dataset.ride==='bike'||drivingCar)&&!crashed)headlightCyclePulse=true
      else if(event.code==='KeyZ'&&document.body.dataset.ride==='bike'&&!crashed)turnLeftPulse=true
      else if(event.code==='KeyX'&&document.body.dataset.ride==='bike'&&!crashed)turnRightPulse=true
      else if(event.code==='KeyB'&&document.body.dataset.ride==='bike'&&!crashed)hazardPulse=true
      else if(event.code==='KeyU'&&document.body.dataset.ride==='bike'&&!crashed)cruisePulse=true
      else if(event.code==='Digit1'||event.code==='Digit2'||event.code==='Digit3'||(ridingTwoWheel&&event.code==='Digit4'))gearSelect=Number(event.code.slice(-1))
    }
  })
  // Capture-phase keyup ensures modal dialogs calling stopPropagation() never leave stuck movement/ride keys.
  window.addEventListener('keyup',event=>keys.delete(event.code),{capture:true})
  window.addEventListener('blur',()=>clearTransientInput(true))
  document.addEventListener('visibilitychange',()=>{if(document.hidden)clearTransientInput(true)})

  /** Hand the cursor back whenever a menu, dialog or photo mode needs it. */
  function releaseLockIfBlocked(){
    if(document.pointerLockElement===canvas&&(isModalOrOverlayOpen()||document.body.dataset.photo==='on'))document.exitPointerLock?.()
  }
  // Watch on a timer while locked (rAF can stall when the walker is held, e.g. photo mode).
  let lockWatch=0
  document.addEventListener('pointerlockchange',()=>{
    clearInterval(lockWatch);lockWatch=0
    if(document.pointerLockElement===canvas)lockWatch=window.setInterval(releaseLockIfBlocked,150)
  })
  function touchDistance(){
    const [a,b]=[...touches.values()]
    return a&&b?Math.hypot(a.x-b.x,a.y-b.y):0
  }
  canvas.addEventListener('pointerdown',event=>{
    if(!active())return
    if(event.pointerType==='mouse'){
      // IDOK-150: desktop mouse-look. Solo mode starts straight in walk, so the lock that the tour
      // flight controls used to grab never happens — request it here. Photo mode keeps drag-to-look
      // (its shutter/filters need a free cursor); drag stays as the fallback if the lock is refused.
      if(event.button===0&&document.body.dataset.photo!=='on'&&!isModalOrOverlayOpen()&&document.pointerLockElement!==canvas)
        (canvas.requestPointerLock() as unknown as Promise<void>|undefined)?.catch?.(()=>{})
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
    clearTransientInput,
    clearRun(){
      runHold=false;runLock=false;runPointer=-1;syncRun()
    },
    /** Movement intent for this frame. */
    read(dt?:number){
      if(isModalOrOverlayOpen()){
        if(keys.size||jump||crouch||runHold||runLock||stick.mag>0)clearTransientInput(true)
        return {right:0,forward:0,run:false,crouch:false,jump:false}
      }
      if(document.body.hasAttribute('data-aboard')&&(runHold||runLock)){runHold=false;runLock=false;runPointer=-1;syncRun()}
      if(document.body.hasAttribute('data-aboard')&&crouch){crouch=false;syncCrouch()}
      const right=Math.max(-1,Math.min(1,+held('right')-+held('left')+stick.x))
      const forward=Math.max(-1,Math.min(1,+held('forward')-+held('back')-stick.y))
      const run=held('run')||runHold||runLock||stick.mag>.9
      if(run&&crouch){crouch=false;syncCrouch()}
      const jumped=jump;jump=false
      return {right,forward,run,crouch,jump:jumped}
    },
    readRideControls():EbikeRideControlInput{
      if(isModalOrOverlayOpen()){
        if(keys.size||wheelieTouch||tuckTouch||hornTouch||gearDelta||gearSelect!==null)clearTransientInput(true)
        return {
          gearDelta:0,gearSelect:null,wheelie:false,tuck:false,recover:false,cycleMod:false,
          parkToggle:false,kickstandToggle:false,headlightCycle:false,turnLeftToggle:false,
          turnRightToggle:false,hazardToggle:false,horn:false,hornPulse:false,cruiseToggle:false,
        }
      }
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
        turnLeftToggle:turnLeftPulse,
        turnRightToggle:turnRightPulse,
        hazardToggle:hazardPulse,
        horn:crashed?false:(keys.has('KeyH')||hornTouch),
        hornPulse:crashed?false:hornPulse,
        cruiseToggle:cruisePulse,
      }
      gearDelta=0;gearSelect=null;recoverPulse=false;cycleModPulse=false
      parkTogglePulse=false;kickstandTogglePulse=false;headlightCyclePulse=false
      turnLeftPulse=false;turnRightPulse=false;hazardPulse=false;hornPulse=false;cruisePulse=false
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
        keysEl.textContent='1-3/Q·E · K撑 · H铃铛 · Shift压弯 · Space翘头'
        hornBtn.textContent='铃铛'
        hornBtn.classList.toggle('on',!!state.hornActive)
      }else{
        typeEl.dataset.kind=state.vehicleType;typeEl.textContent=state.vehicleBadge
        gearEl.textContent=state.parkLocked?'P':state.gearLabel
        gearEl.title=state.parkLocked
          ?`${state.vehicleLabel} · P档驻车（按 0/P/K 或 E 解除）`
          :`${state.vehicleLabel} · 本挡限速 ${Math.round(state.maxKmh)} km/h（1-4 / Q·E 换挡）`
        const lightTag=state.headlight==='high'?'远光':state.headlight==='low'?'近光':'关灯'
        keysEl.textContent='0/P驻车 · K撑 · L灯 · Z/X/B · H喇叭 · U定速 · G改 · Shift压弯'
        parkBtn.classList.toggle('on',!!state.parkLocked)
        parkBtn.setAttribute('aria-pressed',String(!!state.parkLocked))
        lightBtn.textContent=lightTag
        lightBtn.dataset.mode=state.headlight??'off'
        lightBtn.classList.toggle('on',state.headlight==='low'||state.headlight==='high')
        turnLeftBtn.classList.toggle('on',!!state.leftSignalLit)
        turnLeftBtn.classList.toggle('armed',state.turnSignal==='left')
        turnRightBtn.classList.toggle('on',!!state.rightSignalLit)
        turnRightBtn.classList.toggle('armed',state.turnSignal==='right')
        hazardBtn.classList.toggle('on',!!state.hazard&&!!state.blinkOn)
        hazardBtn.classList.toggle('armed',!!state.hazard)
        hornBtn.textContent='喇叭'
        hornBtn.classList.toggle('on',!!state.hornActive)
        cruiseBtn.classList.toggle('on',!!state.cruiseControl)
        cruiseBtn.textContent=state.cruiseControl&&state.cruiseTargetKmh?`定速${state.cruiseTargetKmh}`:'定速'
        const pct=Math.max(0,Math.min(100,Math.round(state.battery)))
        batEl.dataset.level=state.criticalBattery?'crit':state.lowBattery?'low':'ok'
        batFillEl.style.width=`${pct}%`
        batPctEl.textContent=`${pct}%`
      }
      const riskVal=Math.max(0,Math.min(1,state.leanDangerRatio??state.crashRisk??(Math.abs(state.lean)/Math.max(.18,state.leanLimit))))
      leanBarFillEl.style.width=`${Math.round(riskVal*100)}%`
      leanBarEl.dataset.level=riskVal>=.82?'crit':riskVal>=.55?'warn':'ok'
      for(let i=0;i<gearButtons.length;i++){
        const btn=gearButtons[i]
        const label=gearLabels[i]
        btn.hidden=!label
        if(label){
          btn.textContent=label
          const activeGear=!state.parkLocked&&state.gear===i+1
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
          // IDOK-153: holding a wheelie is safe; only a hard / fast turn on the back wheel tips it over.
          const tipping=(state.wheelieTip??0)>=.35
          stateEl.hidden=false;stateEl.dataset.warn=tipping?'1':'0'
          stateEl.textContent=tipping?`翘头 ${wheelieDeg}° 别急转`:`翘头 ${wheelieDeg}°`
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
    syncCarHud(state:CarDynamicTelemetry|null,headlight:'off'|'low'|'high'='off'){
      if(!state){
        stateEl.hidden=true
        delete document.body.dataset.rideCrash
        return
      }
      document.body.dataset.ride='car'
      delete document.body.dataset.rideType
      delete document.body.dataset.rideCrash
      typeEl.dataset.kind='car';typeEl.textContent='轿车'
      const hlLabel=headlight==='high'?'远光':headlight==='low'?'近光':'关灯'
      lightBtn.textContent=hlLabel
      lightBtn.dataset.mode=headlight
      lightBtn.classList.toggle('on',headlight!=='off')
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
