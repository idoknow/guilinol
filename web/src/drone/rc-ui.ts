import type {DroneSpec} from './specs'
import type {Sticks} from './flight'
import type {Telemetry} from './flight'

// IDOK-215: two remote controllers. Mini 5 Pro gets the 傻瓜式 layout (big pads, four buttons);
// everything else gets the professional DJI RC layout (tapes, compass ribbon, gimbal dial).
export interface RcHandlers {
  takeoff():void
  land():void
  rth():void
  photo():void
  record():void
  exit():void
  gimbal(deg:number):void
  sticks(patch:Partial<Sticks>):void
}

export interface RcView {
  root:HTMLElement
  update(telemetry:Telemetry, recording:boolean):void
  setRecording(on:boolean):void
  toast(text:string):void
}

const CARDINALS = ['北','东北','东','东南','南','西南','西','西北']

export function createRc(spec:DroneSpec, handlers:RcHandlers):RcView {
  const simple = spec.rc === 'simple'
  const root = document.createElement('div')
  root.className = `rc rc-${simple ? 'simple' : 'pro'}`
  root.dataset.ui = spec.rc
  root.innerHTML = simple ? simpleMarkup(spec) : proMarkup(spec)

  const $ = <T extends HTMLElement>(selector:string) => root.querySelector<T>(selector)!
  const alt = $('.rc-alt')
  const speed = $('.rc-speed')
  const compass = $('.rc-compass')
  const batteryBar = $('.rc-batt i')
  const batteryText = $('.rc-battval')
  const signalText = $('.rc-signal')
  const timeText = $('.rc-time')
  const readout = $('.rc-readout')
  const gimbalInput = root.querySelector<HTMLInputElement>('.rc-gimbal input')
  const takeoff = $('[data-act="takeoff"]')
  const record = $('[data-act="record"]')
  const toastBox = document.createElement('div')
  toastBox.className = 'rc-toast'
  root.append(toastBox)

  // The simple layout ships fewer buttons (takeoff/photo/record/exit); add 返航 so the safety
  // action exists on both controllers, then wire whatever is actually present.
  const actions = root.querySelector('.rc-actions')
  if (simple && actions) {
    const rth = document.createElement('button')
    rth.dataset.act = 'rth'
    rth.textContent = '返航'
    actions.append(rth)
  }
  const on = (selector:string, run:() => void) => {
    const node = root.querySelector<HTMLElement>(selector)
    if (node) node.onclick = run
  }
  on('[data-act="takeoff"]',() => handlers.takeoff())
  on('[data-act="land"]',() => handlers.land())
  on('[data-act="rth"]',() => handlers.rth())
  on('[data-act="photo"]',() => handlers.photo())
  on('[data-act="record"]',() => handlers.record())
  on('[data-act="exit"]',() => handlers.exit())
  if (gimbalInput) {
    gimbalInput.min = String(spec.gimbal.tiltMin)
    gimbalInput.max = String(spec.gimbal.tiltMax)
    gimbalInput.addEventListener('input',() => handlers.gimbal(Number(gimbalInput.value)))
  }

  // --- Touch sticks: drag inside the ring, release springs back to centre.
  for (const pad of Array.from(root.querySelectorAll<HTMLElement>('.rc-stick'))) {
    const knob = pad.querySelector<HTMLElement>('i')!
    const side = pad.dataset.side as 'left' | 'right'
    let active = false
    const apply = (event:PointerEvent) => {
      const rect = pad.getBoundingClientRect()
      const radius = rect.width * .5 - 6
      let dx = (event.clientX - rect.left - rect.width * .5) / radius
      let dy = (event.clientY - rect.top - rect.height * .5) / radius
      const length = Math.hypot(dx,dy)
      if (length > 1) { dx /= length; dy /= length }
      knob.style.transform = `translate(${dx * radius}px,${dy * radius}px)`
      handlers.sticks(side === 'left'
        ? {yaw:round(dx),throttle:round(-dy)}
        : {roll:round(dx),pitch:round(-dy)})
    }
    pad.addEventListener('pointerdown',event => {
      active = true
      pad.setPointerCapture(event.pointerId)
      apply(event)
      event.preventDefault()
    })
    pad.addEventListener('pointermove',event => { if (active) apply(event) })
    const release = () => {
      if (!active) return
      active = false
      knob.style.transform = 'translate(0,0)'
      handlers.sticks(side === 'left' ? {yaw:0,throttle:0} : {roll:0,pitch:0})
    }
    pad.addEventListener('pointerup',release)
    pad.addEventListener('pointercancel',release)
    pad.addEventListener('lostpointercapture',release)
  }

  function update(state:Telemetry, recording:boolean) {
    // Tapes: 60 px per 10 m, so a 120 m climb scrolls the tape twice.
    alt.textContent = simple ? '' : tape(state.agl,6)
    speed.textContent = simple ? '' : tape(state.speed,6)
    compass.textContent = simple ? '' : ribbon(state.yaw)
    batteryBar.style.width = `${Math.max(0,Math.min(100,state.battery))}%`
    batteryBar.style.background = state.battery < 20 ? '#e0553f' : state.battery < 40 ? '#e0a63f' : '#5fd07a'
    batteryText.textContent = simple
      ? `${state.battery.toFixed(0)}% · 剩 ${state.minutes.toFixed(0)} 分`
      : `${state.battery.toFixed(0)}% ${state.minutes.toFixed(1)}min`
    signalText.textContent = `图传 ${state.signal}%`
    signalText.dataset.warn = state.signal < 30 ? '1' : '0'
    timeText.textContent = state.phase === 'landed' ? '待飞' : `${state.phase === 'returning' ? '返航中 · ' : ''}${state.agl.toFixed(0)}m`
    readout.textContent = simple
      ? `${state.agl.toFixed(0)} m · ${state.distance.toFixed(0)} m · ${state.speedKmh} km/h`
      : `高度 ${state.agl.toFixed(1)}m · 距离 ${state.distance.toFixed(0)}m · ${state.speedKmh}km/h · 升降 ${state.vs > 0 ? '+' : ''}${state.vs}m/s · 云台 ${state.gimbal}°`
    takeoff.textContent = state.phase === 'landed' ? '起飞' : '降落'
    if (gimbalInput && document.activeElement !== gimbalInput) gimbalInput.value = String(state.gimbal)
    setRecording(recording)
    root.dataset.phase = state.phase
  }

  function setRecording(on:boolean) {
    record.classList.toggle('live',on)
    record.textContent = on ? '停止 ●' : '录像'
    root.classList.toggle('rc-rec',on)
  }

  let toastTimer = 0
  function toast(text:string) {
    toastBox.textContent = text
    toastBox.classList.add('show')
    clearTimeout(toastTimer)
    toastTimer = window.setTimeout(() => toastBox.classList.remove('show'),2600)
  }

  return {root,update,setRecording,toast}
}

function round(value:number) { return Math.round(value * 100) / 100 }

function tape(value:number, perTick:number) {
  const lines:string[] = []
  const base = Math.round(value / perTick) * perTick
  for (let i = -3; i <= 3; i++) {
    const mark = base + i * perTick
    if (mark < 0) continue
    lines.push(`${Math.abs(i) === 1 ? '▸' : ' '} ${mark.toFixed(0)}`)
  }
  return `${lines.join('\n')}\n\n${value.toFixed(0)}`
}

function ribbon(yaw:number) {
  const heading = ((yaw * 180) / Math.PI % 360 + 360) % 360
  const sector = Math.round(heading / 45) % 8
  const neighbours = [1,2,3].map(step => CARDINALS[(sector + step) % 8]).join('  ')
  const left = [1,2,3].map(step => CARDINALS[(sector - step + 8) % 8]).join('  ')
  return `${left}   ${CARDINALS[sector]}( ${heading.toFixed(0)}° )   ${neighbours}`
}

function proMarkup(spec:DroneSpec) {
  return `
    <div class="rc-top">
      <span class="rc-model">${spec.name}</span>
      <span class="rc-mode">N</span>
      <span class="rc-sat">GPS 18</span>
      <span class="rc-batt"><i></i></span>
      <span class="rc-battval"></span>
      <span class="rc-signal"></span>
      <span class="rc-time"></span>
    </div>
    <div class="rc-compass"></div>
    <pre class="rc-alt"></pre>
    <pre class="rc-speed"></pre>
    <span class="rc-cap rc-cap-alt">高度 m</span>
    <span class="rc-cap rc-cap-speed">速度 km/h</span>
    <div class="rc-center"><div class="rc-reticle"></div></div>
    <div class="rc-gimbal"><span>云台</span><input type="range" step="1"></div>
    <div class="rc-readout"></div>
    <div class="rc-actions">
      <button data-act="takeoff">起飞</button>
      <button data-act="rth">自动返航</button>
      <button data-act="photo">拍照</button>
      <button data-act="record">录像</button>
      <button data-act="land" hidden>降落</button>
      <button data-act="exit">退出</button>
    </div>
    <div class="rc-sticks"><div class="rc-stick" data-side="left"><i></i></div><div class="rc-stick" data-side="right"><i></i></div></div>`
}

function simpleMarkup(spec:DroneSpec) {
  return `
    <div class="rc-top">
      <span class="rc-model">${spec.name}</span>
      <span class="rc-batt"><i></i></span>
      <span class="rc-battval"></span>
    </div>
    <div class="rc-center"><div class="rc-reticle"></div></div>
    <div class="rc-readout"></div>
    <div class="rc-sticks"><div class="rc-stick" data-side="left"><i></i></div><div class="rc-stick" data-side="right"><i></i></div></div>
    <div class="rc-actions">
      <button data-act="takeoff" class="rc-big">起飞</button>
      <button data-act="photo">拍照</button>
      <button data-act="record">录像</button>
      <button data-act="exit">退出</button>
    </div>
    <pre class="rc-alt"></pre><pre class="rc-speed"></pre><div class="rc-compass"></div>
    <span class="rc-signal"></span><span class="rc-time"></span>`
}

export type {Telemetry}
