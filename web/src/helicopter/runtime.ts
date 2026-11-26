import * as THREE from 'three'
import {soloServices,getPlayMode} from '../game/play-mode'
import {hits} from '../input/keymap'
import {isGlobalHotkeyBlocked} from '../walk/input-guard'
import {spots} from '../play/spots'
import {modes,tourRoute,canDisembark,type TourMode} from './route'
import {helipad} from './site'
import {helicopterModel} from './model'
import profiles from './clearance.json'

type Phase='idle'|'board'|'start'|'ascend'|'cruise'|'descend'|'stop'|'landed'|'exit'
type Walker=Awaited<ReturnType<typeof import('../walk').walk>>
const clamp=(value:number)=>Math.max(0,Math.min(1,value))
const ease=(value:number)=>{const unit=clamp(value);return unit**3*(10-15*unit+6*unit**2)}
export function helicopter(scene:THREE.Scene,camera:THREE.PerspectiveCamera,walker:()=>Walker|undefined,verify:boolean){
  const model=helicopterModel(),craft=model.root,pad=new THREE.Mesh(new THREE.CylinderGeometry(helipad.radius,helipad.radius,.025,48),new THREE.MeshStandardMaterial({color:0xb5b5b5}))
  scene.add(craft,pad);craft.position.set(helipad.x,helipad.y,helipad.z);craft.rotation.order='YXZ';pad.position.copy(craft.position);pad.position.y-=.0125
  const point=(name:string,out:THREE.Vector3)=>model.anchor(name).getWorldPosition(out)
  const hint=document.createElement('button'),notice=document.createElement('span'),panel=document.createElement('dialog')
  hint.className='heli-prompt';notice.className='heli-mode-notice';notice.textContent='进入单人或联机模式后可乘坐观光直升机';panel.className='heli-panel'
  for(const element of [notice,hint]){element.hidden=true;Object.assign(element.style,{position:'fixed',top:'36%',left:'50%',transform:'translateX(-50%)',zIndex:'12'})}
  panel.innerHTML=`<form method="dialog"><button aria-label="关闭">关闭</button></form><h2>直升机观光</h2><svg class="heli-map" viewBox="-1550 -1550 1650 2870" width="120" height="180"></svg><ol>${spots.map(spot=>`<li>${spot.name}</li>`).join('')}</ol><select aria-label="观光模式">${Object.entries(modes).map(([id,mode])=>`<option value="${id}">${mode.label}：${mode.description}</option>`).join('')}</select><p class="heli-price"></p><button class="heli-confirm">确认旅行</button><p role="status"></p>`
  document.body.append(hint,notice,panel)
  let phase:Phase='idle',clock=0,mode:TourMode='low',route:ReturnType<typeof tourRoute>|undefined,rate=1,first=false,near=false,fare=0,key='',heading=0,lastHeading=0
  const from=new THREE.Vector3(),ground=new THREE.Vector3(),seat=new THREE.Vector3(),step=new THREE.Vector3(),actor=new THREE.Vector3(),eye=new THREE.Vector3(),target=new THREE.Vector3(),ahead=new THREE.Vector3()
  const previousPosition=craft.position.clone();let measuredSpeed=0,rotorPower=0
  const stopped=()=>canDisembark(phase,Math.abs(point('skid_contact',target).y-helipad.y)<.02,rotorPower===0,measuredSpeed)
  const durations={board:4,start:3,ascend:11,descend:11,stop:4,exit:4}
  const setPhase=(next:Phase)=>{phase=next;clock=0;if(next==='idle')delete document.body.dataset.helicopter;else document.body.dataset.helicopter=next}
  function newRoute(id:TourMode){const profile=profiles[id];return tourRoute(helipad,id,(_x,_z,time)=>THREE.MathUtils.lerp(profile[Math.floor(time)],profile[Math.ceil(time)],time%1))}
  function show(){if(phase!=='idle'||!near||!soloServices())return;const commerce=soloServices()!.commerce;fare=commerce.quotePurchasePrice('helicopter_tour','ticket')!;panel.querySelector('.heli-price')!.textContent=fare?`本次 ¥${fare}`:'首次免费';panel.querySelector('[role=status]')!.textContent='';key=crypto.randomUUID();panel.showModal()}
  const select=panel.querySelector('select')!
  function map(){mode=select.value as TourMode;route=newRoute(mode);const points=[];for(let time=0;time<=route.duration;time++) {const pos=route.pose(time);points.push(`${pos.x},${pos.z}`)}panel.querySelector('svg')!.innerHTML=`<polyline points="${points.join(' ')}" fill="none" stroke="currentColor" stroke-width="12"/>${spots.map((spot,index)=>`<text x="${spot.x}" y="${spot.z}" font-size="100">${index+1}</text>`).join('')}`}
  select.onchange=map;panel.addEventListener('close',()=>{hint.blur()})
  panel.querySelector<HTMLButtonElement>('.heli-confirm')!.onclick=()=>{
    const player=walker(),services=soloServices();if(!panel.open||!player||!services||phase!=='idle'||!player.heli.available())return
    const result=services.commerce.executePurchase({itemType:'helicopter_tour',itemId:'ticket',shopId:'helipad',expectedPrice:fare,idempotencyKey:key})
    if(result.code!=='OK'){panel.querySelector('[role=status]')!.textContent=result.code==='INSUFFICIENT_FUNDS'?'余额不足，无法登机':'价格已变更或交易未完成，请重新打开面板';return}
    from.copy(player.heli.figure.position);player.heli.begin();setPhase('board');panel.close()
  }
  const interact=()=>{if(stopped())setPhase('exit');else if(phase==='idle'&&near&&soloServices()){map();show()}}
  hint.onclick=interact
  window.addEventListener('keydown',event=>{if(isGlobalHotkeyBlocked(event.target,{allowPhoto:true})||event.repeat)return
    if(phase!=='idle'&&hits(event.code,'view')){first=!first;event.stopImmediatePropagation();event.preventDefault()}
    if((phase!=='idle'||near&&soloServices())&&hits(event.code,'interact')){event.stopImmediatePropagation();event.preventDefault();interact()}
  },true)
  function tick(dt:number){const player=walker(),locked=phase!=='idle';if(!locked){near=model.loaded&&!!player?.heli.available()&&player.position.distanceTo(point('step_L',step))<4.5;notice.hidden=!near||getPlayMode()!=='tour';hint.hidden=!near||!soloServices()||panel.open;hint.textContent='观光直升机';if(panel.open&&(!near||!soloServices()))panel.close();model.animate(dt,0,0,camera.position.distanceTo(craft.position),'idle');return}
    if(!player||!route)return
    notice.hidden=true;hint.hidden=!stopped();hint.textContent='按 F 键下机';clock+=Math.min(1,dt)*rate
    const duration=phase==='cruise'?route.duration:phase==='landed'?Infinity:durations[phase as keyof typeof durations],fraction=clamp(clock/duration),smooth=ease(fraction)
    let rpm=1,door=0,clip='sit',orbit=true
    if(phase==='board'||phase==='exit'){
      const progress=phase==='board'?fraction:1-fraction;rpm=0;door=ease((progress-.23)/.18)*(1-ease((progress-.77)/.2));clip=progress>.8?'sit':'walk';orbit=false
      point('step_L',step);point('seat_pax_1',seat);seat.y-=.65;ground.copy(step);ground.x+=.7;ground.y=helipad.y
      if(progress<.27)actor.lerpVectors(phase==='board'?from:ground,ground,ease(progress/.27));else if(progress<.57)actor.lerpVectors(ground,step,ease((progress-.27)/.3));else actor.lerpVectors(step,seat,ease((progress-.57)/.28));actor.y+=.06*Math.sin(Math.PI*clamp((progress-.3)/.45));heading=THREE.MathUtils.lerp(Math.PI/2,craft.rotation.y,ease((progress-.58)/.28))
    }else{
      const begin=route.pose(0),end=route.pose(route.duration);if(phase==='ascend'||phase==='descend'){
        const lift=phase==='ascend'?smooth:1-smooth;craft.position.y=THREE.MathUtils.lerp(helipad.y,phase==='ascend'?begin.y:end.y,lift);craft.rotation.x=(phase==='ascend'?1:-1)*.06*Math.sin(Math.PI*fraction)**2
        craft.rotation.y=phase==='ascend'?route.pose(.2).yaw*smooth:lastHeading*(1-smooth)
      }else if(phase==='cruise'){const pose=route.pose(clock);craft.position.set(pose.x,pose.y,pose.z);craft.rotation.set(pose.pitch,pose.yaw,-pose.roll,'YXZ');lastHeading=pose.yaw;const future=route.pose(clock+2);ahead.set(future.x,future.y,future.z)}
      else if(phase==='start')rpm=smooth;else if(phase==='stop')rpm=1-smooth;else if(phase==='landed')rpm=0
      point('seat_pax_1',actor);actor.y-=.65;heading=craft.rotation.y
    }
    measuredSpeed=craft.position.distanceTo(previousPosition)/Math.max(.001,dt);previousPosition.copy(craft.position);rotorPower=rpm
    craft.rotation.z=phase==='cruise'?-route.pose(clock).roll:0;craft.rotation.z+=.0016*rpm*Math.sin(clock*8)
    model.animate(dt,rpm,door,camera.position.distanceTo(craft.position),phase==='start'?'startup':phase==='cruise'||phase==='ascend'?'cruise':phase==='descend'||phase==='stop'?'landing':'idle');player.heli.pose(actor,heading,clip,dt,first&&orbit)
    if(clip==='sit'){player.heli.arms.left(point('hand_rest_pax_1_L',target));player.heli.arms.right(point('hand_rest_pax_1_R',target))}
    else if(door>.05){point('door_L',target);target.y+=.66;player.heli.arms.right(target)}
    if(document.body.dataset.photo!=='on'){
      const {yaw,pitch,arm}=player.heli.view();if(first&&orbit){point('cam_pax_1',camera.position);camera.rotation.set(-pitch,yaw+craft.rotation.y+Math.PI,0,'YXZ')}
      else{target.copy(orbit?craft.position:actor);target.y+=1;const radius=orbit?9+arm:4;eye.set(Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch)).multiplyScalar(radius);camera.position.copy(target).add(eye);camera.lookAt(target)}
    }
    if(clock>=duration){if(phase==='exit'){player.heli.end(ground);first=false;setPhase('idle')}else{const next:Partial<Record<Phase,Phase>>={board:'start',start:'ascend',ascend:'cruise',cruise:'descend',descend:'stop',stop:'landed'};setPhase(next[phase]!)}}
  }
  return {tick,get active(){return phase!=='idle'},get lookAhead(){return phase==='cruise'?ahead:null},get phase(){return phase},get mode(){return mode},get first(){return first},...(verify?{rate:(scale:number)=>{rate=Math.max(1,Math.min(120,scale))}}:{})}
}
