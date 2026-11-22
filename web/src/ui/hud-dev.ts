import {onState} from '../game/state'

export function mountDevHud(){
  const label=document.createElement('div')
  label.className='hud-dev'
  label.style.cssText='position:fixed;top:48%;left:8px;pointer-events:none;color:white;background:#222b;white-space:nowrap'
  document.body.append(label)
  onState(({mode,vehicle})=>{
    label.hidden=!vehicle
    if(vehicle)label.textContent=`${mode} · ${Math.round(vehicle.speedKmh)} km/h · ${vehicle.gearLabel??vehicle.gear??'–'}`
  })
}
