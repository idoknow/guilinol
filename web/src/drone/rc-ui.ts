import type {DroneSpec} from './specs'
import type {Sticks} from './flight'
import type {Telemetry} from './flight'

// IDOK-215/IDOK-256: two remote controllers. Mini 5 Pro gets the 傻瓜式 layout (big pads, four buttons);
// everything else gets the professional DJI RC screen: a translucent top status bar (mode, RC/HD signal,
// GNSS, battery + remaining time), side rails for 返航/降落 and 拍照/录像/退出, a white shutter at the
// bottom centre and a telemetry line (H/D/H.S/V.S) like DJI Fly. The two touch pads stand in for the
// physical sticks of the RC.
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

type Mode = 'photo' | 'video'

export function createRc(spec:DroneSpec, handlers:RcHandlers):RcView {
  const simple = spec.rc === 'simple'
  const root = document.createElement('div')
  root.className = `rc rc-${simple ? 'simple' : 'pro'}`
  root.dataset.ui = spec.rc
  root.innerHTML = simple ? simpleMarkup(spec) : proMarkup(spec)

  const q = <T extends HTMLElement>(selector:string) => root.querySelector<T>(selector)
  const batteryBar = q<HTMLElement>('.rc-batt i')
  const batteryText = q<HTMLElement>('.rc-battval')
  const signalText = q<HTMLElement>('.rc-signal')
  const timeText = q<HTMLElement>('.rc-time')
  const readout = q<HTMLElement>('.rc-readout')
  const status = q<HTMLElement>('.rc-status')
  const tele = q<HTMLElement>('.rc-tele')
  const gimbalValue = q<HTMLElement>('.rc-gimbalval')
  const rcBars = root.querySelector<HTMLElement>('.rc-bars[data-kind="rc"]')
  const hdBars = root.querySelector<HTMLElement>('.rc-bars[data-kind="hd"]')
  const gimbalInput = root.querySelector<HTMLInputElement>('.rc-gimbal input')
  const takeoff = q<HTMLElement>('[data-act="takeoff"]')
  const record = q<HTMLElement>('[data-act="record"]')
  const shutter = q<HTMLElement>('.rc-shutter')
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

  // Idle camera mode on the professional controller: the big shutter fires whichever mode is lit.
  let mode:Mode = 'photo'
  const modes = Array.from(root.querySelectorAll<HTMLElement>('[data-mode]'))
  const syncMode = () => {
    for (const chip of modes) chip.classList.toggle('on', chip.dataset.mode === mode)
    root.dataset.mode = mode
  }
  for (const chip of modes) {
    chip.onclick = () => {
      mode = chip.dataset.mode === 'video' ? 'video' : 'photo'
      syncMode()
    }
  }
  syncMode()
  if (shutter) shutter.onclick = () => (mode === 'video' ? handlers.record() : handlers.photo())

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
    if (batteryBar) {
      batteryBar.style.width = `${Math.max(0,Math.min(100,state.battery))}%`
      batteryBar.style.background = state.battery < 20 ? '#e0553f' : state.battery < 40 ? '#e0a63f' : '#5fd07a'
    }
    if (batteryText) {
      batteryText.textContent = simple
        ? `${state.battery.toFixed(0)}% · 剩 ${state.minutes.toFixed(0)} 分`
        : `${state.battery.toFixed(0)}%`
    }
    if (signalText) {
      signalText.textContent = `图传 ${state.signal}%`
      signalText.dataset.warn = state.signal < 30 ? '1' : '0'
    }
    if (timeText) {
      timeText.textContent = simple
        ? (state.phase === 'landed' ? '待飞' : `${state.phase === 'returning' ? '返航中 · ' : ''}${state.agl.toFixed(0)}m`)
        : clock(state.minutes)
    }
    if (readout) {
      readout.textContent = simple
        ? `${state.agl.toFixed(0)} m · ${state.distance.toFixed(0)} m · ${state.speedKmh} km/h`
        : telemetryLine(state)
    }
    if (tele) tele.textContent = simple ? '' : telemetryLine(state)
    if (status) status.textContent = simple ? '' : statusLine(state)
    if (gimbalValue) gimbalValue.textContent = `${state.gimbal > 0 ? '+' : ''}${state.gimbal}°`
    const level = Math.max(1,Math.min(4,Math.round(state.signal / 25)))
    if (rcBars) rcBars.dataset.level = String(level)
    if (hdBars) hdBars.dataset.level = String(state.signal < 12 ? 1 : level)
    if (takeoff) takeoff.textContent = state.phase === 'landed' ? '起飞' : '降落'
    if (gimbalInput && document.activeElement !== gimbalInput) gimbalInput.value = String(state.gimbal)
    if (recording) mode = 'video'
    syncMode()
    root.dataset.phase = state.phase
  }

  function setRecording(on:boolean) {
    if (record) {
      record.classList.toggle('live',on)
      record.textContent = on ? '停止 ●' : '录像'
    }
    if (shutter) shutter.dataset.live = on ? '1' : '0'
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

function clock(minutes:number) {
  const total = Math.max(0,Math.round(minutes * 60))
  const mm = Math.floor(total / 60)
  const ss = total % 60
  return `${mm}:${ss.toString().padStart(2,'0')}`
}

// DJI Fly style bottom line: H 高度 · D 距离 · H.S 水平速度 · V.S 垂直速度.
function telemetryLine(state:Telemetry) {
  return `H ${state.agl.toFixed(1)}m   D ${state.distance.toFixed(0)}m   H.S ${(state.speed).toFixed(1)}m/s   V.S ${state.vs > 0 ? '+' : ''}${state.vs.toFixed(1)}m/s`
}

function statusLine(state:Telemetry) {
  const load = state.load > 0 ? ` · 载重 ${state.load.toFixed(0)} kg` : '';
  if (state.phase === 'landed') return `准备起飞 · 定位正常${load}`;
  if (state.phase === 'takeoff') return `起飞中 · 自动爬升${load}`;
  if (state.phase === 'returning') return `自动返航中 · 请勿操作摇杆${load}`;
  if (state.phase === 'landing') return `降落中${load}`;
  return `悬停 · GNSS 18 · 图传 ${state.signal}%${load}`;
}

function proMarkup(spec:DroneSpec) {
  return `
    <div class="rc-topbar">
      <div class="rc-tb-l">
        <span class="rc-mode">N</span>
        <span class="rc-bars" data-kind="rc" data-level="4" title="遥控信号"><i></i><i></i><i></i><i></i></span>
        <span class="rc-bars" data-kind="hd" data-level="4" title="图传信号"><i></i><i></i><i></i><i></i></span>
        <span class="rc-gps" title="GNSS 卫星"><b></b>18</span>
      </div>
      <div class="rc-tb-r">
        <span class="rc-batt"><i></i></span>
        <span class="rc-battval"></span>
        <span class="rc-time"></span>
      </div>
    </div>
    <div class="rc-status"></div>
    <div class="rc-rail rc-rail-l">
      <button class="rc-side" data-act="rth" title="自动返航">返航</button>
      <button class="rc-side" data-act="land" title="原地降落">降落</button>
    </div>
    <div class="rc-rail rc-rail-r">
      <button class="rc-side" data-act="photo" title="拍照">拍照</button>
      <button class="rc-side" data-act="record" title="录像">录像</button>
      <button class="rc-side" data-act="exit" title="退出遥控">退出</button>
    </div>
    <div class="rc-center"><div class="rc-reticle"></div></div>
    <div class="rc-gimbal"><span>云台 <b class="rc-gimbalval"></b></span><input type="range" step="1" aria-label="云台俯仰"></div>
    <div class="rc-bottom">
      <div class="rc-tele"></div>
      <div class="rc-bottom-mid">
        <div class="rc-modes">
          <button data-mode="photo" class="on">照片</button>
          <button data-mode="video">录像</button>
        </div>
        <button class="rc-shutter" aria-label="快门"><i></i></button>
      </div>
      <button class="rc-takeoff" data-act="takeoff">起飞</button>
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