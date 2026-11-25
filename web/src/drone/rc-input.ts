// IDOK-281: unified controller sources → one stick/button stream for the RC screen.
// Priority: DJI RC (Web Serial) > gamepad > touch/keyboard (the on-screen sticks stay the
// fallback when nothing physical is live). Input shaping (deadzone + expo) is applied in
// shapeStick so both touch and hardware inputs feel the same.
// Inspired by sewerkde/drone-flight-simulator (MIT).

import {DjiRc, type DjiButton} from './dji-rc'

export type RcSource = 'serial'|'gamepad'|'touch'|'none'

export interface RcSticks { lh:number; lv:number; rh:number; rv:number; wheel:number }
export type RcButtonName = DjiButton|'takeoff'|'land'|'modeUp'|'modeDown'

export interface ShapeConf { deadzone:number; expo:number }

/** deadzone (rescaled outside) + expo curve — smooth near centre, crisp at the ends. */
export function shapeStick(v:number, conf:ShapeConf) {
  const a = Math.abs(v)
  const dz = Math.min(.5, Math.max(0, conf.deadzone))
  if (a < dz || !a) return 0
  const x = Math.min(1, (a - dz) / (1 - dz))
  const e = conf.expo
  return Math.sign(v) * ((1 - e) * x + e * x * x * x)
}

const GAMEPAD_PRESETS:Record<string, {axes:[number,number,number,number]; buttons:Record<number,RcButtonName>}> = {
  xbox: {axes:[0,1,2,3], buttons:{0:'photo', 3:'rth', 4:'modeUp', 5:'modeDown', 6:'land', 7:'takeoff'}},
  ps: {axes:[0,1,2,3], buttons:{0:'photo', 3:'rth', 4:'modeUp', 5:'modeDown', 6:'land', 7:'takeoff'}},
  generic: {axes:[0,1,2,3], buttons:{0:'photo', 1:'rth', 4:'modeUp', 5:'modeDown', 8:'land', 9:'takeoff'}},
}

function padName(id = '') {
  const s = id.toLowerCase()
  if (/xbox|xinput|0810/.test(s) && !/dual|0ce6|054c/.test(s)) return 'xbox'
  if (/dual|0ce6|054c|playstation/.test(s)) return 'ps'
  return 'generic'
}

const clamp1 = (v:number) => (v > 1 ? 1 : v < -1 ? -1 : v)
const radial = (x:number, y:number, dz:number) => {
  const m = Math.hypot(x,y)
  if (m <= dz) return {x:0, y:0}
  const k = Math.min(1, (m - dz) / (1 - dz)) / m
  return {x:x * k, y:y * k}
}

export class RcInput {
  sticks:RcSticks = {lh:0, lv:0, rh:0, rv:0, wheel:0}
  raw:RcSticks = {lh:0, lv:0, rh:0, rv:0, wheel:0}
  source:RcSource = 'none'
  sourceName = ''
  mode:'C'|'N'|'S'|null = null
  shape:ShapeConf = {deadzone:.05, expo:.3}
  onButton:(name:RcButtonName) => void = () => {}
  onMode:(m:'C'|'N'|'S') => void = () => {}
  onSource:(source:RcSource, name:string) => void = () => {}
  readonly serial = new DjiRc()
  private prevButtons = new Set<string>()
  private timer:number|null = null

  constructor() {
    this.serial.onButton = name => this.button(name)
    this.serial.onMode = m => { if (m !== this.mode) { this.mode = m; this.onMode(m) } }
    this.poll()
    this.timer = window.setInterval(() => this.poll(), 100)
  }

  get serialSupported() { return this.serial.supported }

  status() {
    if (this.source === 'serial') return `DJI RC · ${this.serial.status}`
    if (this.source === 'gamepad') return `手柄 · ${this.sourceName}`
    return '未连接实体遥控'
  }

  async connectSerial() {
    await this.serial.connect()
    this.poll()
  }

  async disconnectSerial() {
    await this.serial.disconnect()
    this.poll()
  }

  dispose() { if (this.timer !== null) clearInterval(this.timer) }

  // Buttons fire on the pressed edge; serial/gamepad sources call this too.
  private button(name:RcButtonName) { this.onButton(name) }

  private pollGamepad() {
    const pads = navigator.getGamepads?.() ?? []
    const pad = Array.from(pads).find(p => !!p)
    if (!pad) return false
    const preset = GAMEPAD_PRESETS[padName(pad.id)]
    const [lx,ly,rx,ry] = preset.axes.map(i => pad.axes[i] ?? 0)
    const left = radial(lx, ly, .12)
    const right = radial(rx, ry, .08)
    this.raw = {lh:left.x, lv:-left.y, rh:right.x, rv:-right.y, wheel:0}
    for (const [index, name] of Object.entries(preset.buttons)) {
      const pressed = !!pad.buttons[Number(index)]?.pressed
      if (pressed && !this.prevButtons.has(name)) this.button(name)
      if (pressed) this.prevButtons.add(name); else this.prevButtons.delete(name)
    }
    return true
  }

  private poll() {
    const serialLive = this.serial.live
    const gamepadLive = !serialLive && this.pollGamepad()
    this.source = serialLive ? 'serial' : gamepadLive ? 'gamepad' : 'none'
    this.sourceName = serialLive ? 'DJI RC-N3' : gamepadLive ? (Array.from(navigator.getGamepads?.() ?? []).find(p => !!p)?.id ?? '手柄') : ''
    if (serialLive) this.raw = {...this.serial.sticks}
    if (!gamepadLive && !serialLive) this.raw = {lh:0, lv:0, rh:0, rv:0, wheel:0}
    for (const k of Object.keys(this.raw) as (keyof RcSticks)[]) {
      this.sticks[k] = shapeStick(this.raw[k], this.shape)
    }
    if (serialLive) for (const [name, pressed] of Object.entries(this.serial.buttons)) {
      if (!pressed) continue
      if (!this.prevButtons.has(name)) this.button(name as RcButtonName)
      this.prevButtons.add(name)
    } else {
      for (const name of ['photo','rth','camera','fn'] as DjiButton[]) {
        if (!this.serial.buttons[name]) this.prevButtons.delete(name)
      }
    }
    if (this.source !== this.sourceName) this.onSource(this.source, this.sourceName)
  }
}
