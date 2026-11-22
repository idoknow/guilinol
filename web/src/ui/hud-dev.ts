import {onState} from '../game/state'

// Debug readout (mode · speed · gear). Only for ?verify / ?debug sessions — players never see it (IDOK-144).
export function mountDevHud(){
  if(!('debug' in document.body.dataset))return
  const label=document.createElement('div')
  label.className='hud-dev'
  label.style.cssText='position:fixed;top:48%;left:8px;pointer-events:none;color:white;background:#222b;white-space:nowrap'
  document.body.append(label)
  onState(({mode,vehicle})=>{
    label.hidden=!vehicle
    if(vehicle)label.textContent=`${mode} · ${Math.round(vehicle.speedKmh)} km/h · ${vehicle.gearLabel??vehicle.gear??'–'}`
  })
}
