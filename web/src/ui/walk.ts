export function walkInput(canvas:HTMLCanvasElement,active:()=>boolean,rotate:(dx:number,dy:number)=>void,zoom:(delta:number)=>void,view:()=>void){
  const keys=new Set<string>(), stick={x:0,y:0}, panel=document.createElement('div')
  panel.innerHTML='<div class="joystick" role="group" aria-label="移动"><span class="joystick-knob">＋</span></div><button class="btn-jump">跳</button><button class="btn-view">视角</button>'
  document.body.append(panel);panel.hidden=true
  const joystick=panel.querySelector<HTMLElement>('.joystick')!, knob=panel.querySelector<HTMLElement>('.joystick-knob')!
  joystick.style.cssText='position:fixed;bottom:32px;left:20px;width:80px;height:80px;outline:1px solid;touch-action:none;display:grid;place-items:center'
  let jump=false
  for(const [index,button] of Array.from(panel.querySelectorAll('button')).entries()){
    button.style.cssText=`position:fixed;bottom:${32+index*48}px;right:16px;touch-action:none`
    button.onpointerdown=()=>{if(index)view();else jump=true}
  }
  function drag(event:PointerEvent){const rect=joystick.getBoundingClientRect();stick.x=(event.clientX-rect.left-40)/40;stick.y=(event.clientY-rect.top-40)/40
    const size=Math.max(1,Math.hypot(stick.x,stick.y));stick.x/=size;stick.y/=size;knob.style.transform=`translate(${stick.x*30}px,${stick.y*30}px)`}
  joystick.onpointerdown=event=>{joystick.setPointerCapture(event.pointerId);drag(event)}
  joystick.onpointermove=event=>{if(joystick.hasPointerCapture(event.pointerId))drag(event)}
  joystick.onlostpointercapture=()=>{stick.x=stick.y=0;knob.style.transform=''}
  window.addEventListener('keydown',event=>{if(!active())return;keys.add(event.code);if(!event.repeat&&event.code==='Space'){jump=true;event.preventDefault()}if(!event.repeat&&event.code==='KeyC')view()})
  window.addEventListener('keyup',event=>keys.delete(event.code));window.addEventListener('blur',()=>{keys.clear();jump=false})
  canvas.addEventListener('pointerdown',event=>{if(active()&&(event.pointerType==='mouse'||event.clientX>innerWidth/2))canvas.setPointerCapture(event.pointerId)})
  canvas.addEventListener('pointermove',event=>{if(active()&&(document.pointerLockElement===canvas||canvas.hasPointerCapture(event.pointerId)))rotate(event.movementX,event.movementY)})
  canvas.addEventListener('wheel',event=>{if(active()){event.preventDefault();zoom(event.deltaY)}},{passive:false})
  return {show(on:boolean){panel.hidden=!on||!matchMedia('(pointer:coarse)').matches;keys.clear();jump=false;stick.x=stick.y=0},
    read(){const input={right:+keys.has('KeyD')-+keys.has('KeyA')+stick.x,forward:+keys.has('KeyW')-+keys.has('KeyS')-stick.y,
      run:keys.has('ShiftLeft')||keys.has('ShiftRight')||Math.hypot(stick.x,stick.y)>.92,jump};jump=false;return input}}
}
