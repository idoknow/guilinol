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
  /** IDOK-280: 吊人垂钓 — 抛竿 / 起竿 / 收竿（只 FlyCart 200 + 载人 时可用） */
  fish():void
  /** IDOK-281: 连接/断开实体遥控（DJI RC Web Serial）。 */
  link():void
}

export interface RcView {
  root:HTMLElement
  update(telemetry:Telemetry, recording:boolean):void
  setRecording(on:boolean):void
  toast(text:string):void
  /** IDOK-281: 更新遥控连接按钮的文案（源名/未连接/隐藏）。 */
  setLinkLabel(text:string|null):void
  /** IDOK-282: 水平仪 —— 倾斜角（度）。0 = 水平线正中。 */
  setHorizon(deg:number):void
}

type Mode = 'photo' | 'video'

export function createRc(spec:DroneSpec, handlers:RcHandlers, onHold?:(held:boolean) => void):RcView {
  const simple = spec.rc === 'simple'
  const root = document.createElement('div')
  root.className = `rc rc-${simple ? 'simple' : 'pro'}`
  root.dataset.ui = spec.rc
  root.innerHTML = simple ? simpleMarkup(spec) : proMarkup(spec)
  // IDOK-281: 实体遥控连接按钮 —— Web Serial（DJI RC-N3）可用时显示在右上角。
  const linkBtn = document.createElement('button')
  linkBtn.className = 'rc-link'
  linkBtn.type = 'button'
  linkBtn.textContent = '连接遥控'
  linkBtn.onclick = () => handlers.link()
  root.append(linkBtn)

  const q = <T extends HTMLElement>(selector:string) => root.querySelector<T>(selector)
  const batteryBar = q<HTMLElement>('.rc-batt i')
  const batteryText = q<HTMLElement>('.rc-battval')
  const signalText = q<HTMLElement>('.rc-signal')
  const timeText = q<HTMLElement>('.rc-time')
  const readout = q<HTMLElement>('.rc-readout')
  const status = q<HTMLElement>('.rc-status')
  // IDOK-278: 障碍警告角标（pro 布局才有）
  const obstacleWarn = document.createElement('div')
  obstacleWarn.className = 'rc-obstacle-warn'
  obstacleWarn.hidden = true
  root.append(obstacleWarn)
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
  on('[data-act="photo"]',() => handlers.photo())
  on('[data-act="record"]',() => handlers.record())
  on('[data-act="exit"]',() => handlers.exit())
  on('[data-act="fish"]',() => handlers.fish())

  // --- 降落 / 返航：长按触发，按住显示进度环；降落在进度未满前松开即暂停（再按继续）。
  const hold = (selector:string, run:(held:boolean) => void) => {
    const node = root.querySelector<HTMLElement>(selector)
    if (!node) return
    // 进度环：按钮外圈
    const ring = document.createElement('i')
    ring.className = 'rc-hold-ring'
    node.classList.add('rc-hold')
    node.append(ring)
    let timer:number|undefined
    let full = false
    const start = () => {
      if (full) return
      node.classList.add('holding')
      onHold?.(true)
      timer = window.setTimeout(() => {
        full = true
        node.classList.remove('holding')
        onHold?.(false)
        run(false)
        window.setTimeout(() => { full = false; ring.style.setProperty('--p','0%') },600)
      },900)
      run(true)
    }
    const stop = () => {
      node.classList.remove('holding')
      onHold?.(false)
      if (timer) { window.clearTimeout(timer); timer = undefined }
    }
    node.addEventListener('pointerdown',event => { node.setPointerCapture(event.pointerId); start(); event.preventDefault() })
    node.addEventListener('pointerup',stop)
    node.addEventListener('pointercancel',stop)
    node.addEventListener('pointerleave',stop)
  }
  hold('[data-act="land"]',held => { if (!held) handlers.land() })
  hold('[data-act="rth"]',held => { if (!held) handlers.rth() })

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
    if (takeoff) takeoff.hidden = state.phase !== 'landed'
    // IDOK-280: 钓鱼按钮 —— 吊人且在钓点（水面低空悬停）时出现；咬钩窗口变红「起竿！」
    const fishBtn = q<HTMLElement>('[data-act="fish"]')
    if (fishBtn) {
      fishBtn.hidden = !state.fish
      if (state.fish === 'bite') {
        fishBtn.textContent = '起竿！'
        fishBtn.dataset.hot = '1'
      } else if (state.fish === 'ready') {
        fishBtn.textContent = '抛竿'
        delete fishBtn.dataset.hot
      } else if (state.fish) {
        fishBtn.textContent = '收竿'
        delete fishBtn.dataset.hot
      } else delete fishBtn.dataset.hot
    }
    if (gimbalInput && document.activeElement !== gimbalInput) gimbalInput.value = String(state.gimbal)
    if (recording) mode = 'video'
    syncMode()
    root.dataset.phase = state.phase
    // IDOK-278: 返航中 —— 屏幕中央绿色横幅 + 三格加载动画。
    const rthBanner = q<HTMLElement>('.rc-rth-banner')
    if (rthBanner) rthBanner.hidden = state.phase !== 'returning'
    // IDOK-278: 近障碍警告 —— 全屏红色边缘光 + 方向角标。
    if (state.obstacle) {
      root.dataset.obstacle = state.obstacle.side
      if (obstacleWarn) {
        obstacleWarn.hidden = false
        obstacleWarn.textContent = `前方障碍 ${state.obstacle.dist}m`
      }
    } else {
      delete root.dataset.obstacle
      if (obstacleWarn) obstacleWarn.hidden = true
    }
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

  function setLinkLabel(text:string|null) {
    if (!text) { linkBtn.hidden = true; return }
    linkBtn.hidden = false
    linkBtn.textContent = text
    linkBtn.classList.toggle('on',text.includes('已连接') || text.includes('DJI RC ·'))
  }

  // IDOK-282: 水平仪 —— 中央横线随飞机滚转/俯仰倾斜，刻度显示倾斜量。
  const horizon = q<HTMLElement>('.rc-horizon')
  let horizonDeg = 0
  function setHorizon(deg:number) {
    if (!horizon || !Number.isFinite(deg)) return
    horizonDeg = Math.max(-45,Math.min(45,deg))
    horizon.style.transform = `translate(-50%,-50%) rotate(${horizonDeg}deg)`
    horizon.dataset.tilt = Math.abs(horizonDeg) > 5 ? '1' : '0'
  }

  return {root,update,setRecording,toast,setLinkLabel,setHorizon}
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
  if (state.fish === 'ready') return `钓点附近 · 低空悬停即可抛竿${load}`;
  if (state.fish) {
    if (state.fish === 'bite') return '咬钩了！快按起竿！';
    if (state.fish === 'waiting') return `垂钓中 · 保持悬停，漂移 ${2.5}m 脱钩${load}`;
    if (state.fish === 'reel') return '收线中…';
  }
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
    <div class="rc-rth-banner" hidden><span class="rc-rth-dots"><i></i><i></i><i></i></span>返航中</div>
    <div class="rc-rail rc-rail-l">
      <button class="rc-side" data-act="rth" title="自动返航">返航</button>
      <button class="rc-side" data-act="land" title="原地降落">降落</button>
      <button class="rc-side rc-fish" data-act="fish" title="抛竿/起竿" hidden>抛竿</button>
    </div>
    <div class="rc-rail rc-rail-r">
      <button class="rc-side" data-act="photo" title="拍照">拍照</button>
      <button class="rc-side" data-act="record" title="录像">录像</button>
      <button class="rc-side" data-act="exit" title="退出遥控">退出</button>
    </div>
    <div class="rc-center"><div class="rc-reticle"></div><div class="rc-horizon"><i></i><i></i></div></div>
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
      <button class="rc-takeoff" data-act="takeoff" hidden>起飞</button>
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
    <div class="rc-center"><div class="rc-reticle"></div><div class="rc-horizon"><i></i><i></i></div></div>
    <div class="rc-readout"></div>
    <div class="rc-gimbal"><span></span><input type="range" min="${spec.gimbal.tiltMin}" max="${spec.gimbal.tiltMax}" step="1" data-gimbal></div>
    <div class="rc-sticks"><div class="rc-stick" data-side="left"><i></i></div><div class="rc-stick" data-side="right"><i></i></div></div>
    <div class="rc-actions">
      <button data-act="exit">退出</button>
      <button data-act="record">录像</button>
      <button data-act="takeoff" class="rc-big">起飞</button>
      <button data-act="photo">拍照</button>
    </div>
    <pre class="rc-alt"></pre><pre class="rc-speed"></pre><div class="rc-compass"></div>
    <span class="rc-signal"></span><span class="rc-time"></span>`
}

export type {Telemetry}