// IDOK-215: three ways to fly — keyboard, touch sticks, and a real RC over Gamepad/WebHID.
// Gamepad covers DJI RC-N series on Windows (they enumerate as HID gamepads); WebHID is the
// fallback for vendor HID collections that the Gamepad API never surfaces.
import {CENTER, type Sticks} from './flight'

export type DroneAction = 'takeoff' | 'land' | 'rth' | 'photo' | 'record' | 'stop'

export interface Sources { keyboard:boolean; touch:boolean; gamepad:string|null; hid:string|null }

const KEY_AXES:Record<string,keyof Sticks> = {
  KeyW:'pitch', KeyS:'pitch', KeyA:'roll', KeyD:'roll',
  ArrowUp:'throttle', ArrowDown:'throttle', ArrowLeft:'yaw', ArrowRight:'yaw',
}

export class PilotInput {
  enabled = false
  private keys = new Set<string>()
  private touch:Sticks = {...CENTER}
  private invert = {throttle:false, yaw:false, pitch:false, roll:false}
  private padIndex:number|null = null
  private hid:any = null
  private hidMap:{axes:Array<{offset:number; invert:boolean}>}|null = null
  private hidRaw:number[] = []
  private hidListeners:(()=>void)[] = []
  private actionSink:((action:DroneAction)=>void)|null = null
  private bound = false

  attach() {
    if (this.bound) return
    this.bound = true
    window.addEventListener('keydown',this.keyDown,{capture:true})
    window.addEventListener('keyup',this.keyUp,{capture:true})
    window.addEventListener('gamepadconnected',this.padOn)
    window.addEventListener('gamepaddisconnected',this.padOff)
    void this.scanHid()
  }
  detach() {
    if (!this.bound) return
    this.bound = false
    window.removeEventListener('keydown',this.keyDown,{capture:true})
    window.removeEventListener('keyup',this.keyUp,{capture:true})
    window.removeEventListener('gamepadconnected',this.padOn)
    window.removeEventListener('gamepaddisconnected',this.padOff)
    for (const off of this.hidListeners) off()
    this.hidListeners = []
    this.keys.clear()
    this.touch = {...CENTER}
  }

  onAction(fn:(action:DroneAction)=>void) { this.actionSink = fn }
  setTouch(patch:Partial<Sticks>) { Object.assign(this.touch,patch) }
  resetTouch() { this.touch = {...CENTER} }
  setInvert(patch:Partial<typeof this.invert>) { Object.assign(this.invert,patch) }
  get inverted() { return {...this.invert} }

  private fire(action:DroneAction) { this.actionSink?.(action) }

  private keyDown = (event:KeyboardEvent) => {
    if (!this.enabled) return
    if (event.repeat) return
    const tag = (event.target as HTMLElement | null)?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
    if (event.code in KEY_AXES) { this.keys.add(event.code); event.preventDefault(); event.stopPropagation(); return }
    const action = this.actionFor(event.code)
    if (action) { event.preventDefault(); event.stopPropagation(); this.fire(action) }
  }
  private keyUp = (event:KeyboardEvent) => {
    if (!this.enabled) return
    if (this.keys.delete(event.code)) { event.preventDefault(); event.stopPropagation() }
  }
  private actionFor(code:string):DroneAction|null {
    if (code === 'Space') return 'takeoff'
    if (code === 'KeyR') return 'rth'
    if (code === 'KeyP') return 'photo'
    if (code === 'KeyV') return 'record'
    if (code === 'Escape') return 'stop'
    return null
  }

  private padOn = (event:GamepadEvent) => { this.padIndex = event.gamepad.index }
  private padOff = (event:GamepadEvent) => { if (this.padIndex === event.gamepad.index) this.padIndex = null }

  private pad():Gamepad|null {
    const pads = navigator.getGamepads?.() ?? []
    if (this.padIndex !== null && pads[this.padIndex]) return pads[this.padIndex]
    for (const pad of pads) if (pad && pad.connected) { this.padIndex = pad.index; return pad }
    return null
  }

  async connectHid():Promise<string|null> {
    const anyNavigator = navigator as Navigator & {hid?:{requestDevice:(opts:unknown)=>Promise<unknown>}}
    if (!anyNavigator.hid) return null
    try {
      const device = await anyNavigator.hid.requestDevice({filters:[
        {usagePage:0x01,usage:0x04},{usagePage:0x01,usage:0x05},{usagePage:0x01,usage:0x08},{usagePage:0x0d,usage:0x04},
      ]}) as any
      const picked = Array.isArray(device) ? device[0] : device
      if (!picked) return null
      await this.bindHid(picked)
      return `${picked.productName ?? 'HID 遥控器'}`
    } catch { return null }
  }

  private async scanHid() {
    const anyNavigator = navigator as Navigator & {hid?:{getDevices:()=>Promise<any[]>}}
    if (!anyNavigator.hid?.getDevices) return
    try {
      const devices = await anyNavigator.hid.getDevices()
      if (devices[0]) await this.bindHid(devices[0])
    } catch { /* permission not granted yet — the UI button will ask */ }
  }

  private async bindHid(device:any) {
    for (const off of this.hidListeners) off()
    this.hidListeners = []
    this.hid = device
    await device.open?.()
    const onReport = (event:{data:DataView}) => {
      const data = event.data
      const bytes:number[] = []
      for (let i = 0; i < Math.min(data.byteLength,24); i++) bytes.push(data.getInt8(i))
      this.hidRaw = bytes
    }
    device.addEventListener('inputreport',onReport)
    this.hidListeners.push(() => device.removeEventListener?.('inputreport',onReport))
  }

  /**
   * Watch the raw reports while the pilot wiggles the sticks, then pick the four byte offsets with
   * the most movement. Works for the HID joysticks DJI RCs expose without vendor docs.
   */
  async calibrate(ms = 3200):Promise<boolean> {
    if (!this.hid) return false
    const samples:number[][] = []
    const started = performance.now()
    await new Promise<void>(resolve => {
      const timer = setInterval(() => {
        if (this.hidRaw.length) samples.push([...this.hidRaw])
        if (performance.now() - started > ms) { clearInterval(timer); resolve() }
      },40)
    })
    if (samples.length < 12) return false
    const width = Math.max(...samples.map(s => s.length))
    const scored:Array<{offset:number;score:number}> = []
    for (let offset = 0; offset < width; offset++) {
      const values = samples.map(s => s[offset] ?? 0)
      const min = Math.min(...values), max = Math.max(...values)
      scored.push({offset,score:max - min})
    }
    scored.sort((a,b) => b.score - a.score)
    const picked = scored.slice(0,4).filter(entry => entry.score > 6)
    if (picked.length < 2) return false
    this.hidMap = {axes:picked.map(entry => ({offset:entry.offset,invert:false}))}
    return true
  }

  get hidReady() { return !!this.hidMap }
  get hidName():string|null { return this.hid?.productName ?? null }

  read():Sticks {
    const out:Sticks = {...CENTER}
    // Keyboard
    let throttle = 0, yaw = 0, pitch = 0, roll = 0
    if (this.keys.has('ArrowUp')) throttle += 1
    if (this.keys.has('ArrowDown')) throttle -= 1
    if (this.keys.has('ArrowLeft')) yaw -= 1
    if (this.keys.has('ArrowRight')) yaw += 1
    if (this.keys.has('KeyW')) pitch += 1
    if (this.keys.has('KeyS')) pitch -= 1
    if (this.keys.has('KeyD')) roll += 1
    if (this.keys.has('KeyA')) roll -= 1
    if (throttle || yaw || pitch || roll) return {throttle,yaw,pitch,roll}

    // Real RC over Gamepad API (DJI RC-N3 on Windows shows up here).
    const pad = this.pad()
    if (pad) {
      const dead = .12
      const axis = (index:number,invert:boolean) => {
        const raw = pad.axes[index] ?? 0
        const value = Math.abs(raw) < dead ? 0 : (raw - Math.sign(raw) * dead) / (1 - dead)
        return clamp(value * (invert ? -1 : 1))
      }
      const left = {x:axis(0,this.invert.yaw),y:axis(1,!this.invert.throttle)}
      const right = {x:axis(2,this.invert.roll),y:axis(3,!this.invert.pitch)}
      if (left.x || left.y || right.x || right.y) {
        return {throttle:left.y,yaw:left.x,pitch:right.y,roll:right.x}
      }
    }

    // Vendor HID stick, if the pilot calibrated one.
    if (this.hidMap && this.hidRaw.length) {
      const value = (index:number) => {
        const axis = this.hidMap!.axes[index]
        if (!axis) return 0
        const raw = this.hidRaw[axis.offset] ?? 0
        const scaled = clamp(raw / 127)
        return axis.invert ? -scaled : scaled
      }
      const sticks = {throttle:value(1),yaw:value(0),pitch:value(3),roll:value(2)}
      if (sticks.throttle || sticks.yaw || sticks.pitch || sticks.roll) return sticks
    }

    // Touch sticks from the on-screen pads.
    return {...this.touch}
  }

  sources():Sources {
    return {
      keyboard:this.bound,
      touch:!!(this.touch.throttle || this.touch.yaw || this.touch.pitch || this.touch.roll),
      gamepad:this.pad()?.id ?? null,
      hid:this.hidReady ? (this.hidName ?? 'HID') : (this.hidName ?? null),
    }
  }
}

function clamp(value:number) { return Math.max(-1,Math.min(1,value)) }
