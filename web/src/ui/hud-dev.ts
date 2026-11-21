import {onState} from '../game/state'

export function mountDevHud(){
  const text=document.createElement('div')
  text.style.cssText='position:fixed;left:8px;top:48px;pointer-events:none;color:white;background:#222b'
  document.body.append(text)
  return onState(({mode,vehicle})=>{
    text.hidden=mode==='fly'
    text.textContent=`${mode} · ${vehicle?.speedKmh??0} km/h · ${vehicle?.gear??'–'} · F 上下车`
  })
}
