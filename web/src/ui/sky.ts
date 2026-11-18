import {label, type Weather} from '../look/time'

// 时辰 / 天气 panel (top-left, under the stats line). Time flows by default (1 game hour per real
// minute); ?time=6.6 pins the hour, ?weather=mist|rain picks weather, ?flow=0 pauses.
const moods:[string,number][] = [['晨',6.6],['午',12.5],['昏',18.1],['夜',21.5]]
const skies:[string,Weather][] = [['晴','clear'],['雾','mist'],['雨','rain']]
export function skyClock(params:URLSearchParams) {
  const pinned = params.get('time'), start = Number(pinned ?? 10)
  const clock = {hour:Number.isFinite(start)?start:10, weather:(['clear','mist','rain'].includes(params.get('weather')??'')?params.get('weather'):'clear') as Weather,
    flowing:!pinned&&params.get('flow')!=='0', rate:1/60, goal:null as number|null}
  const panel = document.createElement('div'); panel.className = 'sky-ui'
  const time = document.createElement('span'); time.className = 'sky-time'
  const flow = document.createElement('button'); flow.className = 'sky-flow'
  const row = (items:[string,unknown][], pick:(value:never)=>void, active:(value:never)=>boolean)=>{
    const group = document.createElement('span'); group.className = 'sky-group'
    const buttons = items.map(([text,value])=>{const b = document.createElement('button'); b.textContent = text
      b.onclick = ()=>{pick(value as never); refresh()}; group.append(b); return [b,value] as const})
    return {group,refresh(){for(const [b,value] of buttons) b.classList.toggle('on',active(value as never))}}
  }
  const hours = row(moods,(h:number)=>{clock.goal = h},(h:number)=>{const d=Math.abs(clock.hour-h)%24;return Math.min(d,24-d)<1.25})
  const weathers = row(skies,(w:Weather)=>{clock.weather = w},(w:Weather)=>clock.weather===w)
  flow.onclick = ()=>{clock.flowing = !clock.flowing; refresh()}
  panel.append(time,hours.group,weathers.group,flow); document.body.append(panel)
  function refresh(){hours.refresh(); weathers.refresh(); flow.textContent = clock.flowing?'❚❚':'▶'
    flow.setAttribute('aria-label',clock.flowing?'暂停时间':'时间流转'); time.textContent = label(clock.hour)}
  refresh()
  let shown = ''
  return Object.assign(clock,{tick(dt:number){
    if(clock.goal!==null) {
      // Travel forward through the day to the picked hour in ~1.5 s, so the sky sweeps rather than cuts.
      const ahead = ((clock.goal-clock.hour)%24+24)%24, stepH = Math.max(.02,ahead)*Math.min(1,dt*2.2)
      if(ahead<.02) {clock.hour = clock.goal; clock.goal = null} else clock.hour = (clock.hour+Math.min(ahead,stepH))%24
    } else if(clock.flowing) clock.hour = (clock.hour+dt*clock.rate)%24
    const text = label(clock.hour); if(text!==shown){shown = text; refresh()}
  },set(hour:number,weather?:Weather){clock.hour = hour; if(weather) clock.weather = weather; clock.goal = null; refresh()}})
}
