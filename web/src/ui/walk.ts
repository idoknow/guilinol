export function walkInput(canvas:HTMLCanvasElement,active:()=>boolean,rotate:(dx:number,dy:number)=>void,zoom:(delta:number)=>void,view:()=>void){
  const keys=new Set<string>(), stick={x:0,y:0}, panel=document.createElement('div')
  panel.className='walk-ui'
  panel.innerHTML='<div class="joystick" role="group" aria-label="移动"><span class="joystick-knob"></span></div><button class="btn-jump" aria-label="跳">跃</button><button class="btn-view" aria-label="切换视距">远近</button>'
  document.body.append(panel);panel.hidden=true
  const joystick=panel.querySelector<HTMLElement>('.joystick')!, knob=panel.querySelector<HTMLElement>('.joystick-knob')!
  let jump=false
  for(const [index,button] of Array.from(panel.querySelectorAll('button')).entries()){
    button.onpointerdown=()=>{if(index)view();else jump=true}
  }
  function drag(event:PointerEvent){const rect=joystick.getBoundingClientRect(),half=rect.width/2
    stick.x=(event.clientX-rect.left-half)/half;stick.y=(event.clientY-rect.top-half)/half
    const size=Math.max(1,Math.hypot(stick.x,stick.y));stick.x/=size;stick.y/=size
    knob.style.transform=`translate(${stick.x*half*.55}px,${stick.y*half*.55}px)`;joystick.classList.toggle('running',Math.hypot(stick.x,stick.y)>.92)}
  joystick.onpointerdown=event=>{joystick.setPointerCapture(event.pointerId);drag(event)}
  joystick.onpointermove=event=>{if(joystick.hasPointerCapture(event.pointerId))drag(event)}
  joystick.onlostpointercapture=()=>{stick.x=stick.y=0;knob.style.transform='';joystick.classList.remove('running')}
  window.addEventListener('keydown',event=>{if(!active())return;keys.add(event.code);if(!event.repeat&&event.code==='Space'){jump=true;event.preventDefault()}if(!event.repeat&&event.code==='KeyC')view()})
  window.addEventListener('keyup',event=>keys.delete(event.code));window.addEventListener('blur',()=>{keys.clear();jump=false})
  const fingers=new Map<number,[number,number]>()
  const span=()=>{const [first,second]=fingers.values();return second?Math.hypot(first[0]-second[0],first[1]-second[1]):0}
  canvas.addEventListener('pointerdown',event=>{if(active()&&(document.body.dataset.tour==='photo'||event.pointerType==='mouse'||event.clientX>innerWidth/2)){canvas.setPointerCapture(event.pointerId);fingers.set(event.pointerId,[event.clientX,event.clientY])}})
  canvas.addEventListener('lostpointercapture',event=>fingers.delete(event.pointerId))
  canvas.addEventListener('pointermove',event=>{if(!active()||!(document.pointerLockElement===canvas||canvas.hasPointerCapture(event.pointerId)))return
    const before=span();if(fingers.has(event.pointerId))fingers.set(event.pointerId,[event.clientX,event.clientY]);if(before)zoom((before-span())*5);else rotate(event.movementX,event.movementY)})
  canvas.addEventListener('wheel',event=>{if(active()){event.preventDefault();zoom(event.deltaY)}},{passive:false})
  return {show(on:boolean){panel.hidden=!on||!matchMedia('(pointer:coarse)').matches;keys.clear();jump=false;stick.x=stick.y=0},
    read(){const input={right:+keys.has('KeyD')-+keys.has('KeyA')+stick.x,forward:+keys.has('KeyW')-+keys.has('KeyS')-stick.y,
      run:keys.has('ShiftLeft')||keys.has('ShiftRight')||Math.hypot(stick.x,stick.y)>.92,jump};jump=false;return input}}
}
