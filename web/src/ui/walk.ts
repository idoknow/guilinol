import './walk.css'
import './thumb-glyphs.css'
import './vehicle-controls.css'
import {walkConfig as cfg} from '../walk/config'
import type {CarDynamicTelemetry} from '../walk/car'
import type {EbikeTelemetrySnapshot} from '../walk/ebike-fx'
import {isGlobalHotkeyBlocked, isIndoorSceneActive, isModalOrOverlayOpen, isTextInputTarget, isTouchInControlZone, shouldAdminFeedbackClaimKeyPFromDom} from '../walk/input-guard'
import {hits, type Action} from '../input/keymap'
import {shouldSuppressRideGearKey} from '../traffic-duty/duty-keys'
import {rideSoundMuted, setRideSoundMuted} from '../walk/ride-sound-pref'
import {touchUi} from './input-mode'
import {mountThumbLayout} from './thumb-layout'
import {createVehicleControls, type BoatHudState, type CarGearboxHudSync, type VehicleRideControlInput} from './vehicle-controls'

export interface WalkGearKeyContext {
  dutyActive: boolean
  ridingTwoWheel: boolean
  drivingCar: boolean
  aboard: boolean
  repeat?: boolean
}

/**
 * Resolves Q/E gear-shift delta for riding/driving.
 * When on traffic duty and walking on foot, Q (whistle) and E (flag) MUST NOT shift gears.
 */
export function resolveWalkGearKeyDelta(code: string, ctx: WalkGearKeyContext): -1 | 0 | 1 {
  if (ctx.repeat) return 0
  if (ctx.dutyActive && !ctx.aboard) {
    if (shouldSuppressRideGearKey(code, true) || code === 'KeyQ' || code === 'KeyE' || hits(code, 'dutyWhistle') || hits(code, 'dutyFlag')) return 0
    return 0
  }
  if (!ctx.aboard || (!ctx.ridingTwoWheel && !ctx.drivingCar)) return 0
  if (code === 'KeyE') return 1
  if (code === 'KeyQ') return -1
  return 0
}

function safeCapture(el:Element, pointerId:number) {
  try { el.setPointerCapture(pointerId) } catch {}
}

export function walkInput(canvas:HTMLCanvasElement,active:()=>boolean,rotate:(dx:number,dy:number)=>void,zoom:(delta:number)=>void,view:()=>void,zoomLevel:()=>number=()=>.5){
  const keys=new Set<string>(), stick={x:0,y:0,mag:0}, panel=document.createElement('div')
// 键位可改：keys 里存物理 code，判定时问 keymap 这个 code 现在是不是在做该动作。
const held=(action:Action)=>{let on=false;keys.forEach(code=>{if(!on&&hits(code,action))on=true});return on}
  mountThumbLayout()
  panel.className='walk-ui'
  panel.innerHTML='<div class="joystick" role="group" aria-label="移动"><span class="joystick-knob"></span></div>'
    +'<button class="btn-crouch" type="button" aria-label="蹲伏" aria-pressed="false">蹲</button>'
    +'<button class="btn-jump" type="button" aria-label="跳">跃</button>'
    +'<button class="btn-view" type="button" aria-label="视距：按住上下拖动调远近，轻点切换"><span>远近</span><i class="view-rail" aria-hidden="true"><b>近</b><s></s><b>远</b></i></button>'
    +'<button class="btn-wheelie" type="button" aria-label="翘头或扶车">翘头</button>'
    +'<button class="btn-gear-up" type="button" aria-label="升挡">+挡</button>'
    +'<button class="btn-gear-down" type="button" aria-label="降挡">-挡</button>'
    +'<button class="btn-tuck" type="button" aria-label="深压弯" aria-pressed="false">压弯</button>'
    +'<button class="btn-hail" type="button" aria-label="叫一辆附近的共享电车">叫车</button>'
  document.body.append(panel);panel.hidden=true
  let shown=false
  addEventListener('glol:input-mode',()=>{panel.hidden=!shown||!touchUi()})

  const rideHud=document.createElement('div')
  rideHud.className='ride-hud'
  document.body.append(rideHud)

  const joystick=panel.querySelector<HTMLElement>('.joystick')!, knob=panel.querySelector<HTMLElement>('.joystick-knob')!
  const btnCrouch=panel.querySelector<HTMLButtonElement>('.btn-crouch')!, btnJump=panel.querySelector<HTMLButtonElement>('.btn-jump')!, btnView=panel.querySelector<HTMLButtonElement>('.btn-view')!
  const btnWheelie=panel.querySelector<HTMLButtonElement>('.btn-wheelie')!
  const btnGearUp=panel.querySelector<HTMLButtonElement>('.btn-gear-up')!
  const btnGearDown=panel.querySelector<HTMLButtonElement>('.btn-gear-down')!
  const btnTuck=panel.querySelector<HTMLButtonElement>('.btn-tuck')!

  const vc=createVehicleControls({hud:rideHud,panel,wheelieButton:btnWheelie})
  const {
    gearButtons,park:parkBtn,light:lightBtn,turnLeft:turnLeftBtn,turnRight:turnRightBtn,
    hazard:hazardBtn,horn:hornBtn,cruise:cruiseBtn,sound:soundBtn,state:stateEl,mod:modBtn,
  }=vc.refs
  const syncSoundBtn=()=>{const on=!rideSoundMuted();soundBtn.setAttribute('aria-pressed',String(on));soundBtn.title=on?'骑行音效：开（点击静音）':'骑行音效：关（点击打开）'}
  syncSoundBtn()

  let jump=false, crouch=false, stickPointer=-1
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

  function resetRideTouchControls(preserveRecover=false){
    wheelieTouch=false;wheeliePointer=-1;btnWheelie.classList.remove('on')
    tuckTouch=false;tuckPointer=-1;btnTuck.classList.remove('on');btnTuck.setAttribute('aria-pressed','false')
    hornTouch=false;hornPointer=-1;hornPulse=false;hornBtn.classList.remove('on')
    vc.noteCarHorn(false,'api')
    vc.resetHolds()
    vc.consumePulses()
    gearDelta=0;gearSelect=null;if(!preserveRecover)recoverPulse=false;cycleModPulse=false
    parkTogglePulse=false;kickstandTogglePulse=false;headlightCyclePulse=false
    turnLeftPulse=false;turnRightPulse=false;hazardPulse=false;cruisePulse=false
  }
  function clearTransientInput(clearKeys=true,preserveRecover=false){
    if(clearKeys)keys.clear()
    jump=false;crouch=false;syncCrouch();endView()
    resetRideTouchControls(preserveRecover)
    touches.clear();mouseDown=false;pinchDist=0
    resetStick()
  }

  // 手机端没有跑键（IDOK-256）：摇杆推到底就是跑，桌面仍是 Shift。
  function syncRun(){
    const running=stick.mag>.9
    if(running&&crouch){crouch=false;syncCrouch()}
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
    if(event.pointerId===wheeliePointer){wheelieTouch=false;wheeliePointer=-1;btnWheelie.classList.remove('on')}
    if(event.pointerId===tuckPointer){tuckTouch=false;tuckPointer=-1;btnTuck.classList.remove('on');btnTuck.setAttribute('aria-pressed','false')}
    if(event.pointerId===hornPointer){hornTouch=false;hornPointer=-1;hornBtn.classList.remove('on');if(document.body.dataset.ride==='car'&&!keys.has('KeyH'))vc.noteCarHorn(false,'click')}
  })
  window.addEventListener('pointercancel',event=>{
    endStick(event)
    if(event.pointerId===wheeliePointer){wheelieTouch=false;wheeliePointer=-1;btnWheelie.classList.remove('on')}
    if(event.pointerId===tuckPointer){tuckTouch=false;tuckPointer=-1;btnTuck.classList.remove('on');btnTuck.setAttribute('aria-pressed','false')}
    if(event.pointerId===hornPointer){hornTouch=false;hornPointer=-1;hornBtn.classList.remove('on');if(document.body.dataset.ride==='car'&&!keys.has('KeyH'))vc.noteCarHorn(false,'click')}
  })

  btnJump.onpointerdown=event=>{event.preventDefault();event.stopPropagation();crouch=false;syncCrouch();jump=true}
  btnCrouch.onpointerdown=event=>{event.preventDefault();event.stopPropagation();crouch=!crouch;syncCrouch()}
  // 远近（IDOK-256）：按住后上下拖动连续变焦（上近下远），轻点（<8px 且 <220ms）仍在近/远两档间切换。
  // 按下时在按钮上方展开一条竖向滑轨，刻度跟着实际视距走；松手后 0.6 s 收起。
  const viewDot=btnView.querySelector<HTMLElement>('.view-rail s')!
  let viewPointer=-1, viewDownAt=0, viewStartY=0, viewLastY=0, viewMoved=false, viewFade=0
  const paintView=()=>{viewDot.style.setProperty('--z',Math.max(0,Math.min(1,zoomLevel())).toFixed(3))}
  function endView(){
    if(viewPointer<0)return
    viewPointer=-1;btnView.classList.remove('on');delete document.body.dataset.zooming
    clearTimeout(viewFade);viewFade=window.setTimeout(()=>btnView.classList.remove('dragging'),600)
  }
  btnView.onpointerdown=event=>{
    event.preventDefault();event.stopPropagation()
    viewPointer=event.pointerId;safeCapture(btnView,event.pointerId)
    viewDownAt=performance.now();viewStartY=viewLastY=event.clientY;viewMoved=false
    clearTimeout(viewFade);btnView.classList.add('on','dragging');document.body.dataset.zooming='1';paintView()
  }
  btnView.onpointermove=event=>{
    if(event.pointerId!==viewPointer)return
    event.stopPropagation()
    if(!viewMoved&&Math.abs(event.clientY-viewStartY)<8)return
    viewMoved=true
    // 140 px 走完整个 zoomMin→zoomMax（arm += delta*.013）。
    zoom((event.clientY-viewLastY)*(cfg.zoomMax-cfg.zoomMin)/140/.013)
    viewLastY=event.clientY;paintView()
  }
  btnView.onpointerup=event=>{
    if(event.pointerId!==viewPointer)return
    event.stopPropagation()
    if(!viewMoved&&performance.now()-viewDownAt<220){view();paintView()}
    endView()
  }
  btnView.onpointercancel=event=>{if(event.pointerId===viewPointer)endView()}
  btnView.onlostpointercapture=event=>{if(event.pointerId===viewPointer)endView()}
  const btnHail=panel.querySelector<HTMLButtonElement>('.btn-hail')!
  btnHail.onpointerdown=event=>{event.preventDefault();event.stopPropagation();window.dispatchEvent(new CustomEvent('walk:hail'))}
  btnGearUp.onpointerdown=event=>{event.preventDefault();event.stopPropagation();gearDelta+=1}
  btnGearDown.onpointerdown=event=>{event.preventDefault();event.stopPropagation();gearDelta-=1}
  btnWheelie.onpointerdown=event=>{
    event.preventDefault();event.stopPropagation()
    const kdActive=document.body.dataset.tdKnockdown==='1'
    const rideCrashed=document.body.dataset.rideCrash==='1'
    if(kdActive||rideCrashed){
      if(kdActive)window.dispatchEvent(new CustomEvent('walk:knockdown-mash'))
      else recoverPulse=true
      btnWheelie.classList.add('on')
      wheeliePointer=event.pointerId;safeCapture(btnWheelie,event.pointerId)
      return
    }
    wheeliePointer=event.pointerId;safeCapture(btnWheelie,event.pointerId)
    wheelieTouch=true
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
  lightBtn.onclick=event=>{
    event.stopPropagation()
    if(document.body.dataset.rideCrash==='1')return
    if(vc.lightLocked()){vc.lockedPress('light','click');return}
    headlightCyclePulse=true
  }
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
    if(document.body.dataset.ride==='car')vc.noteCarHorn(true,'click')
  }
  const endHorn=(event:PointerEvent)=>{if(event.pointerId===hornPointer){hornTouch=false;hornPointer=-1;hornBtn.classList.remove('on');if(document.body.dataset.ride==='car'&&!keys.has('KeyH'))vc.noteCarHorn(false,'click')}}
  hornBtn.onpointerup=endHorn;hornBtn.onpointercancel=endHorn;hornBtn.onlostpointercapture=endHorn
  hornBtn.onclick=event=>{event.stopPropagation();if(document.body.dataset.rideCrash!=='1')hornPulse=true}
  cruiseBtn.onpointerdown=event=>{event.stopPropagation()}
  cruiseBtn.onclick=event=>{event.stopPropagation();if(document.body.dataset.rideCrash!=='1')cruisePulse=true}
  soundBtn.onpointerdown=event=>{event.stopPropagation()}
  soundBtn.onclick=event=>{event.stopPropagation();setRideSoundMuted(!rideSoundMuted());syncSoundBtn()}
  for(const btn of gearButtons){
    btn.onpointerdown=event=>{event.stopPropagation()}
    btn.onclick=event=>{event.stopPropagation();const g=Number(btn.dataset.gear);if(g>=1)gearSelect=g}
  }
  stateEl.onpointerdown=event=>{event.stopPropagation()}
  stateEl.onclick=event=>{
    event.stopPropagation()
    if(document.body.dataset.tdKnockdown==='1')window.dispatchEvent(new CustomEvent('walk:knockdown-mash'))
    else if(document.body.dataset.rideCrash==='1')recoverPulse=true
  }
  new MutationObserver(()=>{
    if(document.body.dataset.photo==='on'||document.body.dataset.shopOpen==='1'){clearTransientInput(true);return}
    crouch=false;syncCrouch()
    resetRideTouchControls()
    resetStick()
  }).observe(document.body,{attributes:true,attributeFilter:['data-aboard','data-photo','data-shop-open']})

  const MOVE_ACTIONS:readonly Action[]=['forward','back','left','right','run']
  /** While an indoor scene holds the walker, keep only movement keys, so walking up the stairs out of it never stops. */
  function carriesIntoStreet(event:KeyboardEvent){
    return isIndoorSceneActive()&&!isTextInputTarget(event.target)&&document.body.dataset.photo!=='on'
      &&!isModalOrOverlayOpen(document,{ignoreIndoor:true})&&MOVE_ACTIONS.some(a=>hits(event.code,a))
  }
  window.addEventListener('keydown',event=>{
    if(!active())return
    if(isGlobalHotkeyBlocked(event.target)){
      if(carriesIntoStreet(event))keys.add(event.code)
      return
    }
    keys.add(event.code)
    const ridingTwoWheel=document.body.dataset.ride==='bike'||document.body.dataset.ride==='bicycle'
    const drivingCar=document.body.dataset.ride==='car'
    const aboard=document.body.hasAttribute('data-aboard')
    const crashed=document.body.dataset.rideCrash==='1'
    if(!event.repeat&&hits(event.code,'jump')){
      if(document.body.dataset.tdKnockdown==='1'){event.preventDefault();return}
      if(ridingTwoWheel)recoverPulse=true
      else if(!drivingCar){crouch=false;syncCrouch();jump=true}
      event.preventDefault()
    }
    if(!event.repeat&&event.code==='KeyC')view()
    if(!event.repeat&&hits(event.code,'crouch')&&!aboard){crouch=!crouch;syncCrouch()}
    if(!event.repeat&&hits(event.code,'run')&&!aboard&&crouch){crouch=false;syncCrouch()}
    const dutyActive=document.body.dataset.duty==='active'||document.body.dataset.tdDutyActive==='1'
    if(!shouldSuppressRideGearKey(event.code,dutyActive&&!aboard)){
      const gearStep=resolveWalkGearKeyDelta(event.code,{dutyActive,ridingTwoWheel,drivingCar,aboard,repeat:event.repeat})
      if(gearStep!==0){
        gearDelta+=gearStep
      }
    }
    if(aboard&&(ridingTwoWheel||drivingCar)&&!event.repeat&&!(dutyActive&&!aboard)){
      if(event.code==='KeyG'&&document.body.dataset.ride==='bike')cycleModPulse=true
      else if(event.code==='KeyI'&&drivingCar&&!event.shiftKey&&!event.altKey&&!event.ctrlKey&&!event.metaKey){
        vc.toggleIgnition('key')
        event.preventDefault()
      }
      else if(event.code==='KeyH'&&drivingCar&&!crashed){
        hornPulse=true
        vc.noteCarHorn(true,'key')
      }
      else if(event.code==='KeyP'&&document.body.dataset.ride==='bike'&&!crashed&&!event.shiftKey&&!event.altKey&&!event.ctrlKey&&!event.metaKey&&!shouldAdminFeedbackClaimKeyPFromDom(event)){
        parkTogglePulse=true
        event.preventDefault()
      }
      else if(event.code==='Digit0'&&document.body.dataset.ride==='bike'&&!crashed&&!parkBtn.classList.contains('on'))parkTogglePulse=true
      else if(event.code==='KeyK'&&ridingTwoWheel&&!crashed)vc.toggleKickstand('key')
      else if(event.code==='KeyL'&&(document.body.dataset.ride==='bike'||drivingCar)&&!crashed){
        if(vc.lightLocked())vc.lockedPress('light','key')
        else headlightCyclePulse=true
      }
      else if(event.code==='KeyZ'&&document.body.dataset.ride==='bike'&&!crashed)turnLeftPulse=true
      else if(event.code==='KeyX'&&document.body.dataset.ride==='bike'&&!crashed)turnRightPulse=true
      else if(event.code==='KeyB'&&document.body.dataset.ride==='bike'&&!crashed)hazardPulse=true
      else if(event.code==='KeyU'&&document.body.dataset.ride==='bike'&&!crashed)cruisePulse=true
      else if(event.code==='Digit1'||event.code==='Digit2'||event.code==='Digit3'||(ridingTwoWheel&&event.code==='Digit4'))gearSelect=Number(event.code.slice(-1))
    }
  })
  // Capture-phase keyup ensures modal dialogs calling stopPropagation() never leave stuck movement/ride keys.
  window.addEventListener('keyup',event=>{
    keys.delete(event.code)
    if(event.code==='KeyH'&&!hornTouch&&document.body.dataset.ride==='car')vc.noteCarHorn(false,'key')
  },{capture:true})
  window.addEventListener('blur',()=>clearTransientInput(true))
  document.addEventListener('visibilitychange',()=>{if(document.hidden)clearTransientInput(true)})

  // 端游：按 Alt 切换鼠标锁定（隐藏鼠标转视角 ⇄ 显示鼠标点界面）
  window.addEventListener('keydown',event=>{
    if((event.code!=='AltLeft'&&event.code!=='AltRight')||event.repeat||!active())return
    event.preventDefault()
    if(document.pointerLockElement===canvas)document.exitPointerLock?.()
    else if(document.body.dataset.photo!=='on'&&!isModalOrOverlayOpen(document,{ignoreIndoor:true}))(canvas.requestPointerLock() as unknown as Promise<void>|undefined)?.catch?.(()=>{})
  })
  window.addEventListener('keyup',event=>{if(event.code==='AltLeft'||event.code==='AltRight')event.preventDefault()})
  /** Hand the cursor back whenever a menu, dialog or photo mode needs it. */
  function releaseLockIfBlocked(){
    if(document.pointerLockElement===canvas&&(isModalOrOverlayOpen(document,{ignoreIndoor:true})||document.body.dataset.photo==='on'))document.exitPointerLock?.()
  }
  // Watch on a timer while locked (rAF can stall when the walker is held, e.g. photo mode).
  let lockWatch=0
  document.addEventListener('pointerlockchange',()=>{
    clearInterval(lockWatch);lockWatch=0
    if(document.pointerLockElement===canvas)lockWatch=window.setInterval(releaseLockIfBlocked,150)
  })
  /** Visible thumb controls for the touch guard (IDOK-256: presets / size / left-hand mode move them). */
  function controlRects(){
    const out:{left:number,top:number,right:number,bottom:number,stick?:boolean}[]=[]
    if(panel.hidden)return out
    for(const el of Array.from(panel.children) as HTMLElement[]){
      const r=el.getBoundingClientRect()
      if(r.width&&r.height)out.push({left:r.left,top:r.top,right:r.right,bottom:r.bottom,stick:el===joystick})
    }
    return out
  }
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
      if(event.button===0&&document.body.dataset.photo!=='on'&&!isModalOrOverlayOpen(document,{ignoreIndoor:true})&&document.pointerLockElement!==canvas)
        (canvas.requestPointerLock() as unknown as Promise<void>|undefined)?.catch?.(()=>{})
      mouseDown=true;lastMouse={x:event.clientX,y:event.clientY};safeCapture(canvas,event.pointerId)
    }else{
      if(isTouchInControlZone({
        clientX:event.clientX,clientY:event.clientY,innerWidth,innerHeight,
        panelVisible:!panel.hidden,photoOn:document.body.dataset.photo==='on',
        aboard:document.body.hasAttribute('data-aboard'),target:event.target,controls:controlRects(),
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

  const AXES_ZERO={forward:0,right:0}
  const syncRideOpts={wheelieHeld:false}
  const syncCarOpts:{hornHeld:boolean;carGearbox?:CarGearboxHudSync|null}={hornHeld:false,carGearbox:null}

  return {
    show(on:boolean){
      shown=on;panel.hidden=!on||!touchUi()
      clearTransientInput(true)
    },
    clearTransientInput,
    /** Kept for callers that reset sprint on boarding; on touch the stick itself is the only run input now. */
    clearRun(){
      syncRun()
    },
    /** Movement intent for this frame. */
    read(dt?:number){
      if(isModalOrOverlayOpen()||document.body.dataset.tdKnockdown==='1'){
        const preserve=document.body.dataset.tdKnockdown==='1'||document.body.dataset.rideCrash==='1'
        if(keys.size||jump||crouch||stick.mag>0)clearTransientInput(true,preserve)
        return {right:0,forward:0,run:false,crouch:false,jump:false}
      }
      const aboard=document.body.hasAttribute('data-aboard')
      if(aboard&&crouch){crouch=false;syncCrouch()}
      const vcAxes=aboard?vc.axes():AXES_ZERO
      const kbFwd=held('forward'), kbBack=held('back'), kbLeft=held('left'), kbRight=held('right')
      const right=Math.max(-1,Math.min(1,+kbRight-+kbLeft+stick.x+vcAxes.right))
      const rawForward=Math.max(-1,Math.min(1,+kbFwd-+kbBack-stick.y+vcAxes.forward))
      const forward=aboard?vc.gateForward(rawForward):rawForward
      if(aboard)vc.reflectKeys(kbFwd,kbBack,kbLeft,kbRight)
      const run=held('run')||stick.mag>.9
      if(run&&crouch){crouch=false;syncCrouch()}
      const jumped=jump;jump=false
      return {right,forward,run,crouch,jump:jumped}
    },
    readRideControls():VehicleRideControlInput{
      if(isModalOrOverlayOpen()){
        if(keys.size||wheelieTouch||tuckTouch||hornTouch||gearDelta||gearSelect!==null)clearTransientInput(true)
        vc.consumePulses()
        return {
          gearDelta:0,gearSelect:null,wheelie:false,tuck:false,recover:false,cycleMod:false,
          parkToggle:false,kickstandToggle:false,headlightCycle:false,turnLeftToggle:false,
          turnRightToggle:false,hazardToggle:false,horn:false,hornPulse:false,cruiseToggle:false,
          carHorn:false,carHornPulse:false,ignitionToggle:false,carGearSelect:null,boatLightToggle:false,
        }
      }
      const crashed=document.body.dataset.rideCrash==='1'||document.body.dataset.tdKnockdown==='1'
      const drivingCar=document.body.dataset.ride==='car'
      const vcPulses=vc.consumePulses()
      const hornHeld=keys.has('KeyH')||hornTouch
      const out:VehicleRideControlInput={
        gearDelta:crashed?0:gearDelta,
        gearSelect:crashed?null:gearSelect,
        wheelie:crashed?false:(keys.has('Space')||wheelieTouch),
        tuck:crashed?false:(keys.has('ShiftLeft')||keys.has('ShiftRight')||tuckTouch),
        recover:recoverPulse,
        cycleMod:crashed?false:cycleModPulse,
        parkToggle:crashed?false:parkTogglePulse,
        kickstandToggle:crashed?false:(kickstandTogglePulse||vcPulses.kickstandToggle),
        headlightCycle:crashed?false:headlightCyclePulse,
        turnLeftToggle:crashed?false:turnLeftPulse,
        turnRightToggle:crashed?false:turnRightPulse,
        hazardToggle:crashed?false:hazardPulse,
        horn:crashed?false:hornHeld,
        hornPulse:crashed?false:hornPulse,
        cruiseToggle:crashed?false:cruisePulse,
        carHorn:drivingCar&&!crashed?hornHeld:false,
        carHornPulse:drivingCar&&!crashed?hornPulse:false,
        ignitionToggle:drivingCar&&!crashed?vcPulses.ignitionToggle:false,
        carGearSelect:drivingCar&&!crashed?vcPulses.carGearSelect:null,
        boatLightToggle:vcPulses.boatLightToggle,
      }
      gearDelta=0;gearSelect=null;recoverPulse=false;cycleModPulse=false
      parkTogglePulse=false;kickstandTogglePulse=false;headlightCyclePulse=false
      turnLeftPulse=false;turnRightPulse=false;hazardPulse=false;hornPulse=false;cruisePulse=false
      return out
    },
    syncRideHud(state:EbikeTelemetrySnapshot|null,rideKind:'bike'|'bicycle'|'car'|'boat'|null){
      syncRideOpts.wheelieHeld=wheelieTouch||keys.has('Space')
      vc.syncRide(state,rideKind,syncRideOpts)
    },
    syncCarHud(state:CarDynamicTelemetry|null,headlight:'off'|'low'|'high'='off',carGearbox?:CarGearboxHudSync|null){
      syncCarOpts.hornHeld=keys.has('KeyH')||hornTouch
      syncCarOpts.carGearbox=carGearbox
      vc.syncCar(state,headlight,syncCarOpts)
    },
    syncBoatHud(state:BoatHudState|null){
      vc.syncBoat(state)
    },
    vehicleControls:vc,
  }
}
