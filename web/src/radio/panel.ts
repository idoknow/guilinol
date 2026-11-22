import {createRadio, stations} from './player'

let open: (()=>void) | undefined
export function openRadio() {
  if(open){open(); return}
  const player=createRadio(), panel=document.createElement('dialog')
  panel.setAttribute('aria-label','电台')
  panel.innerHTML=`<form method="dialog"><button>关闭</button></form>
    <p><output></output></p><button type="button" data-power></button>
    <label>电台 <select></select></label>
    <label>音量 <input type="range" min="0" max="100" value="50"></label>
    <label><input type="checkbox"> 下车后继续收听</label>`
  const tune=panel.querySelector('select')!, volume=panel.querySelector<HTMLInputElement>('[type=range]')!
  const power=panel.querySelector<HTMLButtonElement>('[data-power]')!, portable=panel.querySelector<HTMLInputElement>('[type=checkbox]')!
  stations.forEach((station,index)=>tune.add(new Option(station.name,String(index))))
  const labels:Record<string,string>={playing:'播放中',waiting:'准备播放',paused:'暂停',off:'已关闭',error:'播放失败，请重新开启'}
  function render(){
    const state=player.snapshot(), station=stations[state.station], title=station.tracks[state.track].title
    const status=labels[state.status]
    panel.querySelector('output')!.textContent=`${station.name} · ${title} · ${status}`
    power.textContent=state.enabled?'关闭播放':'开启播放'
    power.setAttribute('aria-pressed',String(state.enabled))
    const summary=document.querySelector('.st-radio p')
    if(summary){summary.querySelector('b')!.textContent=station.name; summary.querySelector('span')!.textContent=`${status} · ${title}`}
  }
  power.onclick=()=>player.power(!player.snapshot().enabled)
  tune.onchange=()=>player.tune(tune.selectedIndex)
  portable.onchange=()=>player.setPortable(portable.checked)
  volume.oninput=()=>player.setVolume(Number(volume.value)/100)
  player.changes.addEventListener('change',render)
  document.body.append(panel)
  open=()=>{render(); if(!panel.open)panel.showModal()}; open()
}
