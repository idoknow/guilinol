import * as THREE from 'three'
import './helicopter.css'
import {soloServices,getPlayMode} from '../game/play-mode'
import {hits} from '../input/keymap'
import {isGlobalHotkeyBlocked} from '../walk/input-guard'
import {spots} from '../play/spots'
import {modes,tourRoute,canDisembark,type TourMode} from './route'
import {helipad} from './site'
import {helicopterModel} from './model'
import {queueCommand,type QueueState} from './queue'
import {aircraftPose,flightReplica,routeFor} from './flight'
import {mpEnabled} from '../ui/mp-pref'
import {passengerOrientation} from './seat-frame'
import {padDownwash} from './downwash'
import {cabins,closestCabin} from './doors'
import {rotorSound} from './sound'
import {services as schedules} from '../../../lib/helicopter-clock'
import {remoteSeat} from './remote-seat'

type Phase='idle'|'board'|'start'|'ascend'|'cruise'|'descend'|'stop'|'landed'|'exit'
type Walker=Awaited<ReturnType<typeof import('../walk').walk>>
const clamp=(value:number)=>Math.max(0,Math.min(1,value))
const ease=(value:number)=>{const unit=clamp(value);return unit**3*(10-15*unit+6*unit**2)}
export function helicopter(scene:THREE.Scene,camera:THREE.PerspectiveCamera,walker:()=>Walker|undefined,verify:boolean){
  const model=helicopterModel(),craft=model.root,pad=new THREE.Mesh(new THREE.CylinderGeometry(helipad.radius,helipad.radius,.025,48),new THREE.MeshStandardMaterial({color:0xb5b5b5}))
  scene.add(craft,pad);craft.position.set(helipad.x,helipad.y,helipad.z);craft.rotation.order='YXZ';pad.position.copy(craft.position);pad.position.y-=.0125
  const wash=padDownwash(),sound=rotorSound();wash.root.position.copy(craft.position);wash.root.visible=false;scene.add(wash.root)
  const point=(name:string,out:THREE.Vector3)=>model.anchor(name).getWorldPosition(out)
  const hint=document.createElement('button'),notice=document.createElement('span'),panel=document.createElement('dialog')
  hint.className='heli-prompt';notice.className='heli-mode-notice';notice.textContent='进入单人或联机模式后可乘坐观光直升机';panel.className='heli-panel'
  for(const element of [notice,hint])element.hidden=true
  const altitude:Record<TourMode,string>={low:'楼顶上方 40–70 m',high:'离地 250 m 以上',dynamic:'55–260 m 起伏'}
  panel.innerHTML=`<header class="heli-head"><div><small>滨江路 · 小香港停机坪</small><h2>直升机观光</h2></div><form method="dialog"><button class="heli-close" aria-label="关闭">×</button></form></header>`+
    `<div class="heli-scroll"><div class="heli-body"><figure class="heli-route"><svg class="heli-map" viewBox="-1550 -1550 1650 2870" aria-label="观光环线"></svg><figcaption>环线 · 依次途经景册十景</figcaption></figure>`+
    `<ol class="heli-spots">${spots.map(spot=>`<li>${spot.name}</li>`).join('')}</ol></div>`+
    `<fieldset class="heli-modes"><legend>观光模式</legend>${Object.entries(modes).map(([id,item],index)=>`<label><input type="radio" name="heli-mode" value="${id}"${index?'':' checked'}><b>${item.label}</b><span>${item.description}</span><em>${altitude[id as TourMode]} · ${Math.floor(schedules[id as TourMode].total/60)} 分 ${schedules[id as TourMode].total%60} 秒</em></label>`).join('')}</fieldset></div>`+
    `<div class="heli-foot"><div class="heli-meta"><p class="heli-price"></p></div><div class="heli-actions"><button class="heli-confirm">确认旅行</button></div><p role="status"></p></div>`
  document.body.append(hint,notice,panel)
  let phase:Phase='idle',clock=0,mode:TourMode='low',route:ReturnType<typeof tourRoute>|undefined,first=false,near=false,fare=0,heading=0
  const replica=flightReplica();let verificationClock:number|undefined,verificationAzimuth:number|undefined
  let queue:QueueState|undefined,lastPoll=-Infinity,busy=false,sessionFlight:QueueState['flight']=null
  const status=document.createElement('p'),leave=document.createElement('button'),alert=document.createElement('output');status.className='heli-queue-status';leave.className='heli-queue-leave';leave.textContent='退出排队';alert.className='heli-queue-notice';document.body.append(alert);panel.querySelector('.heli-meta')!.append(status);panel.querySelector('.heli-actions')!.prepend(leave)
  const confirm=panel.querySelector<HTMLButtonElement>('.heli-confirm')!
  function accept(state:QueueState,start:number){
    if(state.mine?.offered&&!state.flight&&!queue?.mine?.offered)alert.textContent='轮到你了，请在 60 秒内回到停机坪确认登机'
    if(!state.mine||state.flight&&state.mine.offered)alert.textContent=''
    if(state.code==='INSUFFICIENT_FUNDS')alert.textContent='余额不足，已跳过本班，请充值后重新排队'
    if(state.code==='SAVE_NOT_READY')alert.textContent='账号存档未同步，请同步后重新排队'
    queue=state;replica.sync(start,Date.now(),state.now)
    status.textContent=`${({idle:'空闲',boarding:'登机中',flying:'执飞中',landing:'降落中',unloading:'下机中'} as Record<string,string>)[state.state]} · 前面 ${state.ahead} 人 · 预计等待 ${state.eta>=60?`${Math.floor(state.eta/60)} 分 ${state.eta%60} 秒`:`${state.eta} 秒`}`
    leave.hidden=!state.mine||!!state.flight&&state.mine.offered;confirm.disabled=!!state.mine&&!state.mine.offered;confirm.textContent=state.mine?.offered?'确认登机':state.mine?'排队中':'加入队列'
  }
  let pending:Promise<QueueState|undefined>|undefined
  async function command(action:string,fields:Record<string,string>={}):Promise<QueueState|undefined>{
    if(pending){if(action==='ping')return pending;await pending;return command(action,fields)}
    const services=soloServices();if(!services)return
    const start=Date.now();busy=true
    pending=(action==='confirm'?services.commerce.confirmHelicopterTicket(fields.ticket,fields.seat):queueCommand(action,fields))
      .then(state=>{accept(state,start);return state}).catch(error=>{status.textContent=error.message;return undefined}).finally(()=>{busy=false;pending=undefined})
    return pending
  }
  leave.onclick=()=>{if(queue?.mine)void command('leave',{ticket:queue.mine.ticket})}
  const from=new THREE.Vector3(),ground=new THREE.Vector3(),seat=new THREE.Vector3(),step=new THREE.Vector3(),actor=new THREE.Vector3(),eye=new THREE.Vector3(),target=new THREE.Vector3(),ahead=new THREE.Vector3()
  const orientation=new THREE.Quaternion()
  const previousPosition=craft.position.clone();let measuredSpeed=0,rotorPower=0
  const stopped=()=>canDisembark(phase,Math.abs(point('skid_contact',target).y-helipad.y)<.02,rotorPower===0,measuredSpeed)
  const durations={board:4,exit:4}
  const setPhase=(next:Phase)=>{phase=next;clock=0;if(next==='idle')delete document.body.dataset.helicopter;else document.body.dataset.helicopter=next}
  const newRoute=routeFor
  function show(){if(phase!=='idle'||!near&&!queue?.mine||!soloServices())return;const commerce=soloServices()!.commerce;fare=commerce.quotePurchasePrice('helicopter_tour','ticket')!;panel.querySelector('.heli-price')!.textContent=fare?`本次 ¥${fare}`:'首次免费';panel.querySelector('[role=status]')!.textContent='';panel.showModal();void command('ping')}
  const selectedMode=()=>(panel.querySelector<HTMLInputElement>('input[name=heli-mode]:checked')?.value??'low') as TourMode
  function map(){mode=selectedMode();route=newRoute(mode);const points=[];for(let time=0;time<=route.duration;time++) {const pos=route.pose(time);points.push(`${pos.x},${pos.z}`)}const xs=[...points.map(text=>+text.split(',')[0]),...spots.map(spot=>spot.x)],zs=[...points.map(text=>+text.split(',')[1]),...spots.map(spot=>spot.z)],pad=140,minX=Math.min(...xs)-pad,minZ=Math.min(...zs)-pad;panel.querySelector('svg')!.setAttribute('viewBox',`${minX} ${minZ} ${Math.max(...xs)+pad-minX} ${Math.max(...zs)+pad-minZ}`);panel.querySelector('svg')!.innerHTML=`<polyline class="heli-path" points="${points.join(' ')}"/><circle class="heli-pad-dot" cx="${helipad.x}" cy="${helipad.z}" r="60"/>${spots.map((spot,index)=>`<g class="heli-spot"><circle cx="${spot.x}" cy="${spot.z}" r="70"/><text x="${spot.x}" y="${spot.z}">${index+1}</text></g>`).join('')}`}
  panel.querySelector('.heli-modes')!.addEventListener('change',map);panel.addEventListener('close',()=>{hint.blur()})
  confirm.onclick=async()=>{
    sound.unlock()
    const player=walker(),services=soloServices();if(!panel.open||!player||!services||phase!=='idle'||!player.heli.available())return
    if(!queue?.mine){await command('join',{mode});return}if(!near||!queue.mine.offered)return
    const cabin=closestCabin(name=>model.has(name)?point(name,target).distanceTo(player.heli.figure.position):Infinity);if(!cabin)return
    const result=await command('confirm',{ticket:queue.mine.ticket,seat:String(cabin.number)});if(!result)return
    if(result.code!=='OK'||!result.flight){panel.querySelector('[role=status]')!.textContent=result.code==='INSUFFICIENT_FUNDS'?'余额不足，已跳过':'存档未同步或登机资格已过期';return}
    sessionFlight=result.flight;mode=result.flight.mode;route=newRoute(mode)
    from.copy(player.heli.figure.position);player.heli.begin();setPhase('board');panel.close()
  }
  const interact=()=>{if(stopped())setPhase('exit');else if(phase==='idle'&&(near||queue?.mine)&&soloServices()){map();show()}}
  hint.onclick=interact
  window.addEventListener('keydown',event=>{if(isGlobalHotkeyBlocked(event.target,{allowPhoto:true})||event.repeat)return
    if(phase!=='idle'&&hits(event.code,'view')){first=!first;event.stopImmediatePropagation();event.preventDefault()}
    if((phase!=='idle'||near&&soloServices())&&hits(event.code,'interact')){event.stopImmediatePropagation();event.preventDefault();interact()}
  },true)
  const padDoor=new THREE.Vector3(helipad.x+1.19,helipad.y+.56,helipad.z-.4)
  alert.onclick=()=>{if(queue?.mine&&!panel.open)show()}
  function tick(dt:number){const player=walker();if(soloServices()&&performance.now()-lastPoll>2500&&!busy){lastPoll=performance.now();void command('ping')}
    const flight=sessionFlight??(soloServices()?queue?.flight:null),pose=verify&&verificationClock!==undefined&&flight?aircraftPose(verificationClock,flight.t0,flight.mode):replica.pose(Date.now(),flight)
    craft.position.set(pose?.x??helipad.x,pose?.y??helipad.y,pose?.z??helipad.z);craft.rotation.set(pose?.pitch??0,pose?.yaw??0,-(pose?.roll??0),'YXZ');craft.visible=!flight||!!sessionFlight||mpEnabled()
    const cabin=cabins.find(candidate=>candidate.number===flight?.seat)??cabins[0]
    remoteSeat.uid=pose&&flight&&model.loaded&&mpEnabled()?flight.passengerUid:0
    const nearGround=clamp(1-(craft.position.y-helipad.y)/13)
    wash.update(pose?.clock??0,craft.visible&&pose&&(pose.phase==='ascend'||pose.phase==='descend')?pose.rpm*nearGround:0)
    sound.update(craft.visible?(pose?.rpm??0):0,first&&!!sessionFlight,camera.position.distanceTo(craft.position))
    if(remoteSeat.uid){point(cabin.seat,seat);passengerOrientation(model.anchor(cabin.seat),remoteSeat.orientation);Object.assign(remoteSeat,{x:seat.x,y:seat.y-.65,z:seat.z})}
    if(phase==='idle'&&player?.active&&model.loaded&&queue?.mine?.offered&&queue.flight&&pose&&pose.phase!=='ended'){sessionFlight=queue.flight;mode=sessionFlight.mode;route=newRoute(mode);from.copy(player.heli.figure.position);player.heli.begin();setPhase(pose.phase)}
    if(phase==='idle'){near=!!player?.heli.available()&&player.position.distanceTo(padDoor)<4.5;notice.hidden=!near||getPlayMode()!=='tour';hint.hidden=(!near&&!queue?.mine)||!soloServices()||panel.open;hint.textContent=queue?.mine?'查看排队':flight?'直升机执飞中 · 排队':'观光直升机';if(panel.open&&(!near&&!queue?.mine||!soloServices()))panel.close();model.animate(dt,pose?.rpm??0,pose?.phase==='board'?ease((pose.clock/4-.23)/.18)*(1-ease((pose.clock/4-.77)/.2)):0,camera.position.distanceTo(craft.position),pose?'cruise':'idle',false,cabin.door,pose?.load??0);return}
    if(!player||!route)return
    notice.hidden=true;hint.hidden=!stopped();hint.textContent='按 F 键下机';if(phase==='exit')clock+=dt;else if(pose){if(pose.phase==='ended'){setPhase('exit')}else{setPhase(pose.phase);clock=pose.clock}}
    const duration=phase==='cruise'?route.duration:phase==='landed'?Infinity:(pose&&pose.phase===phase?pose.duration:(durations[phase as keyof typeof durations]??1)),fraction=clamp(clock/duration),smooth=ease(fraction)
    let rpm=1,door=0,clip='sit',orbit=true
    if(phase==='board'||phase==='exit'){
      const progress=phase==='board'?fraction:1-fraction;rpm=0;door=ease((progress-.23)/.18)*(1-ease((progress-.77)/.2));clip=progress>.8?'sit':'walk';orbit=false
      point(`step_${cabin.side}`,step);point(cabin.seat,seat);step.z=seat.z;seat.y-=.65;ground.copy(step);ground.x+=.7*cabin.outward;ground.y=helipad.y
      if(progress<.27)actor.lerpVectors(phase==='board'?from:ground,ground,ease(progress/.27));else if(progress<.57)actor.lerpVectors(ground,step,ease((progress-.27)/.3));else actor.lerpVectors(step,seat,ease((progress-.57)/.28));actor.y+=.06*Math.sin(Math.PI*clamp((progress-.3)/.45));heading=THREE.MathUtils.lerp(cabin.outward*Math.PI/2,craft.rotation.y+Math.PI,ease((progress-.58)/.28))
    }else{
      if(phase==='cruise'){const future=route.pose(clock+2);ahead.set(future.x,future.y,future.z)}
      else if(phase==='start')rpm=smooth;else if(phase==='stop')rpm=1-smooth;else if(phase==='landed')rpm=0
      point(cabin.seat,actor);actor.y-=.65;heading=craft.rotation.y
    }
    measuredSpeed=craft.position.distanceTo(previousPosition)/Math.max(.001,dt);previousPosition.copy(craft.position);rotorPower=rpm
    craft.rotation.z=phase==='cruise'?-route.pose(clock).roll:0;craft.rotation.z+=.0016*rpm*Math.sin(clock*8)
    model.animate(dt,rpm,door,camera.position.distanceTo(craft.position),phase==='start'?'startup':phase==='cruise'||phase==='ascend'?'cruise':phase==='descend'||phase==='stop'?'landing':'idle',phase==='cruise'&&!first,cabin.door,pose?.load??0);player.heli.pose(actor,heading,clip,dt,first&&orbit,clip==='sit'?passengerOrientation(model.anchor(cabin.seat),orientation):undefined)
    if(clip==='sit'){player.heli.arms.left(point(`hand_rest_pax_${cabin.number}_L`,target));player.heli.arms.right(point(`hand_rest_pax_${cabin.number}_R`,target))}
    else if(door>.05){point(cabin.door,target);target.y+=.66;player.heli.arms.right(target)}
    if(document.body.dataset.photo!=='on'){
      const view=player.heli.view(),{pitch,arm}=view,yaw=(!first?verificationAzimuth:undefined)??view.yaw;if(first&&orbit){camera.position.set(0,.72,.06);model.anchor(cabin.seat).localToWorld(camera.position);camera.rotation.set(-pitch,yaw+Math.PI,0,'YXZ');camera.quaternion.premultiply(craft.quaternion)}
      else{target.copy(orbit?craft.position:actor);target.y+=1;const radius=orbit?9+arm:4;eye.set(Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch)).multiplyScalar(radius);camera.position.copy(target).add(eye);camera.lookAt(target)}
    }
    if(phase==='exit'&&clock>=duration){if(queue?.mine?.offered&&queue.flight?.t0===sessionFlight?.t0){if(!busy)void command('unload',{ticket:queue.mine.ticket});return}player.heli.end(ground);first=false;sessionFlight=null;setPhase('idle')}
  }
  return {tick,get active(){return phase!=='idle'},get lookAhead(){return phase==='cruise'?ahead:null},get phase(){return phase},get mode(){return mode},get first(){return first},...(verify?{seek:(seconds:number,azimuth?:number)=>{verificationAzimuth=azimuth;if(sessionFlight)verificationClock=sessionFlight.t0+seconds*1000},queue:()=>queue,positionAt:(time:number)=>queue?.flight&&aircraftPose(time,queue.flight.t0,queue.flight.mode),visible:()=>craft.visible}: {})}
}
