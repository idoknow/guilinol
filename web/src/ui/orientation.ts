import './orientation.css'

// Phones play in landscape (IDOK-144). Browsers cannot rotate a page for us: Android Chrome may lock orientation only
// inside fullscreen, and iOS Safari supports neither. So once the city is running, a portrait phone gets a full-screen
// "turn your phone" card. On Android its button enters fullscreen + locks landscape (the page rotates itself); where the
// lock is refused it explains how to turn the phone. A quiet "竖屏继续" escape keeps portrait for this session.
// CSS decides visibility (portrait + coarse pointer + narrow), so rotating back hides it with no JS involved.

const SKIP_KEY='glol.portraitOk'
const HINT='请把手机横过来。若画面不转，先在控制中心关闭「竖排方向锁定」。'
let armed=false

export function armOrientationGate(){
  if(armed)return
  armed=true
  if(sessionStorage.getItem(SKIP_KEY))return
  const gate=document.createElement('div')
  gate.className='rotate-gate'
  gate.setAttribute('role','dialog')
  gate.setAttribute('aria-modal','true')
  gate.setAttribute('aria-label','请横屏游玩')
  gate.innerHTML=`<div class="rotate-card">
<svg class="rotate-phone" viewBox="0 0 120 120" aria-hidden="true">
<path class="rotate-arc" d="M28 30A44 44 0 0 1 92 24" fill="none"/><path class="rotate-arc" d="M84 16l9 8-11 4" fill="none"/>
<g class="rotate-device"><rect x="42" y="30" width="36" height="64" rx="7"/><rect class="rotate-screen" x="46" y="37" width="28" height="48" rx="2"/><path class="rotate-peaks" d="M47 79c2-8 4-12 7-12s4 4 5 9c1-9 3-15 7-15s6 7 7 18z"/></g>
</svg>
<h2>横过手机，桂林更开阔</h2>
<p class="rotate-msg">网上桂林按横屏设计，摇杆、车速表和地图在横屏下才不挤。</p>
<button class="ui-btn ui-btn--seal rotate-go" type="button">横屏进入</button>
<button class="rotate-skip" type="button">竖屏继续</button>
</div>`
  const msg=gate.querySelector<HTMLElement>('.rotate-msg')!,go=gate.querySelector<HTMLButtonElement>('.rotate-go')!
  // Keep game input (joysticks, look-drag, keyboard shortcuts on tablets) from reacting underneath the card.
  for(const type of ['pointerdown','touchstart','wheel'])gate.addEventListener(type,event=>event.stopPropagation(),{passive:true})
  go.addEventListener('click',async()=>{
    if(await lockLandscape())return
    go.hidden=true
    msg.textContent=HINT
  })
  gate.querySelector('.rotate-skip')!.addEventListener('click',()=>{
    sessionStorage.setItem(SKIP_KEY,'1')
    gate.remove()
  })
  document.body.append(gate)
}

// The gate above can be dismissed ("竖屏继续"), and that escape sticks for the session, so the in-game dock keeps a
// one-tap way back to landscape: same fullscreen+lock attempt, same fallback sentence, no card in the way. CSS shows it
// only on narrow portrait coarse screens, so landscape and desktop never see it.
export function mountLandscapeEntry(host:HTMLElement){
  if(host.querySelector('.dock-rotate'))return
  const entry=document.createElement('button')
  entry.type='button'; entry.className='dock-rotate'; entry.textContent='横屏'
  entry.setAttribute('aria-label','横屏游玩'); entry.title='横屏游玩（横过手机）'
  entry.addEventListener('click',async()=>{
    if(await lockLandscape())return
    window.dispatchEvent(new CustomEvent('walk:toast',{detail:{text:HINT,ms:3600}}))
  })
  host.append(entry)
}

async function lockLandscape():Promise<boolean>{
  const orientation=screen.orientation as ScreenOrientation&{lock?:(o:string)=>Promise<void>}|undefined
  const root=document.documentElement
  if(!orientation?.lock||!root.requestFullscreen)return false
  try{
    if(!document.fullscreenElement)await root.requestFullscreen({navigationUI:'hide'})
    await orientation.lock('landscape')
    return true
  }catch{
    if(document.fullscreenElement)await document.exitFullscreen().catch(()=>{})
    return false
  }
}
