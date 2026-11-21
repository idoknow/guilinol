import {onState} from '../game/state'

export function positionTravelHint(element:HTMLElement,kind:'action'|'toast'){
  if(!matchMedia('(max-width:520px) and (pointer:coarse)').matches)return ()=>{}
  const previous=element.style.cssText
  Object.assign(element.style,{left:'10px',top:kind==='toast'?'230px':'156px',bottom:'auto',transform:'none',maxWidth:'52vw',boxSizing:'border-box'})
  return ()=>{element.style.cssText=previous}
}

export function mountDevHud(){
  const text=document.createElement('div')
  text.style.cssText='position:fixed;left:8px;top:48px;pointer-events:none;color:white;background:#222b'
  text.className='hud-dev'
  if(matchMedia('(max-width:520px) and (pointer:coarse)').matches)Object.assign(text.style,{top:'105px',maxWidth:'55vw'})
  document.body.append(text)
  return onState(({mode,vehicle})=>{
    text.hidden=mode==='fly'
    text.textContent=`${mode} · ${vehicle?.speedKmh??0} km/h · ${vehicle?.gear??'–'} · F 上下车`
  })
}
