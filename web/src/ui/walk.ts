export function walkInput(
  canvas:HTMLCanvasElement,
  active:()=>boolean,
  rotate:(dx:number,dy:number)=>void,
  zoom:(delta:number)=>void,
  view:()=>void,
  onRide:()=>void,
){
  const keys=new Set<string>(), stick={x:0,y:0}, panel=document.createElement('div')
  panel.className='walk-ui'
  panel.innerHTML='<div class="joystick" role="group" aria-label="移动"><span class="joystick-knob"></span></div><button class="btn-jump" aria-label="跳">跃</button><button class="btn-view" aria-label="切换视距">远近</button><button class="btn-ride" aria-label="骑电动车" hidden>骑车</button>'
  document.body.append(panel);panel.hidden=true
  const joystick=panel.querySelector<HTMLElement>('.joystick')!, knob=panel.querySelector<HTMLElement>('.joystick-knob')!
  const jumpBtn=panel.querySelector<HTMLButtonElement>('.btn-jump')!
  const viewBtn=panel.querySelector<HTMLButtonElement>('.btn-view')!
  const rideBtn=panel.querySelector<HTMLButtonElement>('.btn-ride')!
  let jump=false
  jumpBtn.onpointerdown=()=>{jump=true}
  viewBtn.onpointerdown=()=>view()
  rideBtn.onpointerdown=event=>{event.preventDefault();onRide()}
  function drag(event:PointerEvent){const rect=joystick.getBoundingClientRect(),half=rect.width/2
    stick.x=(event.clientX-rect.left-half)/half;stick.y=(event.clientY-rect.top-half)/half
    const size=Math.max(1,Math.hypot(stick.x,stick.y));stick.x/=size;stick.y/=size
    knob.style.transform=`translate(${stick.x*half*.55}px,${stick.y*half*.55}px)`;joystick.classList.toggle('running',Math.hypot(stick.x,stick.y)>.92)}
  joystick.onpointerdown=event=>{joystick.setPointerCapture(event.pointerId);drag(event)}
  joystick.onpointermove=event=>{if(joystick.hasPointerCapture(event.pointerId))drag(event)}
  joystick.onlostpointercapture=()=>{stick.x=stick.y=0;knob.style.transform='';joystick.classList.remove('running')}
  window.addEventListener('keydown',event=>{
    if(!active())return
    keys.add(event.code)
    if(!event.repeat&&event.code==='Space'){jump=true;event.preventDefault()}
    if(!event.repeat&&event.code==='KeyC')view()
    if(!event.repeat&&event.code==='KeyE')onRide()
  })
  window.addEventListener('keyup',event=>keys.delete(event.code));window.addEventListener('blur',()=>{keys.clear();jump=false})
  canvas.addEventListener('pointerdown',event=>{if(active()&&(event.pointerType==='mouse'||event.clientX>innerWidth/2))canvas.setPointerCapture(event.pointerId)})
  canvas.addEventListener('pointermove',event=>{if(active()&&(document.pointerLockElement===canvas||canvas.hasPointerCapture(event.pointerId)))rotate(event.movementX,event.movementY)})
  canvas.addEventListener('wheel',event=>{if(active()){event.preventDefault();zoom(event.deltaY)}},{passive:false})
  return {
    show(on:boolean){panel.hidden=!on||!matchMedia('(pointer:coarse)').matches;keys.clear();jump=false;stick.x=stick.y=0},
    setRideState(canMount:boolean,riding:boolean){
      rideBtn.hidden=!(canMount||riding)
      rideBtn.textContent=riding?'下车':'骑车'
      rideBtn.setAttribute('aria-label',riding?'下车':'骑电动车')
      jumpBtn.textContent=riding?'刹':'跃'
    },
    read(){const hasSpace=keys.has('Space'),input={right:+keys.has('KeyD')-+keys.has('KeyA')+stick.x,forward:+keys.has('KeyW')-+keys.has('KeyS')-stick.y,
      run:keys.has('ShiftLeft')||keys.has('ShiftRight')||Math.hypot(stick.x,stick.y)>.92,jump,brake:jump||hasSpace};jump=false;return input},
  }
}
