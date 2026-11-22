import stations from './stations.json'
import {getState, onState} from '../game/state'

export {stations}

export function createRadio() {
  const media = new Audio()
  media.preload = 'none'
  const context = new AudioContext()
  const gain = context.createGain()
  context.createMediaElementSource(media).connect(gain).connect(context.destination)
  gain.gain.value = .5
  const changes = new EventTarget()
  let station = 0, track = 0, enabled = false, portable = false, away = false, failed = false
  let aboard = !!getState().vehicle, revision = 0
  const current = () => stations[station].tracks[track]
  const notify = () => changes.dispatchEvent(new Event('change'))
  const allowed = () => enabled && (aboard || portable) && !away && !document.hidden && !document.body.hasAttribute('data-home')
  const snapshot = () => ({station, track, enabled, portable, aboard, volume:gain.gain.value,
    status: failed ? 'error' : !enabled ? 'off' : !allowed() ? 'paused' : media.paused || context.state !== 'running' ? 'waiting' : 'playing'})
  function sync() {
    const request = ++revision
    if (!allowed()) media.pause()
    else {
      const url = `/audio/radio/${current().file}`
      if (media.getAttribute('src') !== url) media.src = url
      void Promise.all([context.resume(), media.play()]).catch(()=>{
        if (request===revision) {failed=true; media.pause(); notify()}
      })
    }
    notify()
  }
  media.onplaying = media.onpause = context.onstatechange = notify
  media.onended = () => {track=(track+1)%stations[station].tracks.length; sync()}
  media.onerror = () => {failed=true; notify()}
  const off = onState(state=>{
    if (aboard!==!!state.vehicle) {aboard=!!state.vehicle; sync()}
  })
  document.addEventListener('visibilitychange',sync)
  const hide = () => {away=true; sync()}
  const show = () => {away=false; sync()}
  window.addEventListener('pagehide',hide)
  window.addEventListener('pageshow',show)
  const home = new MutationObserver(sync)
  home.observe(document.body,{attributes:true,attributeFilter:['data-home']})
  return {snapshot, changes,
    power(value:boolean) {enabled=value; failed=false; if(value) void context.resume().catch(()=>{}); sync()},
    tune(index:number) {
      if(!Number.isInteger(index) || !stations[index])return
      station=index; track=0; failed=false; media.pause(); media.removeAttribute('src'); media.load(); sync()
    },
    setPortable(value:boolean) {portable=value; sync()},
    setVolume(value:number) {if(Number.isFinite(value))gain.gain.value=Math.max(0,Math.min(1,value)); notify()},
    dispose() {
      off(); home.disconnect(); document.removeEventListener('visibilitychange',sync)
      window.removeEventListener('pagehide',hide); window.removeEventListener('pageshow',show)
      enabled=false; revision++; media.pause(); media.removeAttribute('src'); media.load(); void context.close()
    },
  }
}
