// IDOK-281: DJI RC-N3 (also RC-N1/N2) over Web Serial + DUML.
// Ported from sewerkde/drone-flight-simulator (MIT, © 2026 SEwerk): protocol details are
// community-documented DUML — 0x55 frame header, crc8(3 bytes)/crc16, sim-mode enable then
// stick/button polling. The remote must be plugged into the bottom USB-C port.
// Only Chrome/Edge desktop ship Web Serial (`'serial' in navigator`).

const DJI_VENDOR = 0x2ca3

function table(poly:number) {
  const t = new Uint16Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ poly : c >>> 1
    t[i] = c
  }
  return t
}
const T8 = table(0x8c)
const T16 = table(0x8408)

function crc8(bytes:Uint8Array, n:number, seed = 0x77) {
  let c = seed
  for (let i = 0; i < n; i++) c = T8[(bytes[i] ^ c) & 0xff]
  return c
}

function crc16(bytes:Uint8Array, n:number, seed = 0x3692) {
  let v = seed
  for (let i = 0; i < n; i++) v = (v >>> 8) ^ T16[(bytes[i] ^ v) & 0xff]
  return v & 0xffff
}

export function duml(cmdSet:number, cmdId:number, payload:readonly number[] = []) {
  const len = 13 + payload.length
  const p = new Uint8Array(len)
  p[0] = 0x55
  p[1] = len & 0xff
  p[2] = (len >> 8) | 0x04
  p[3] = crc8(p, 3)
  p[4] = 0x0a // sender: PC
  p[5] = 0x06 // receiver: remote
  p[6] = 0xeb
  p[7] = 0x34
  p[8] = 0x40
  p[9] = cmdSet
  p[10] = cmdId
  p.set(payload, 11)
  const c = crc16(p, len - 2)
  p[len - 2] = c & 0xff
  p[len - 1] = c >> 8
  return p
}

const PKT_SIM_ON = duml(0x06, 0x24, [0x01])
const PKT_STICKS = duml(0x06, 0x01)
const PKT_BUTTONS = duml(0x06, 0x27)

// Raw stick range 364..1024..1684 → -1..1
function axis(lo:number, hi:number) {
  const v = lo | (hi << 8)
  return Math.max(-1, Math.min(1, (v - 1024) / 660))
}

/** DJI 0x27 payload bytes 28-29 → mode switch + button bits (matches the serve.py bridge decode). */
export function decodeDjiButtons(v:number) {
  const mode = ({0x00:'S', 0x10:'N', 0x20:'C'} as Record<number, 'S'|'N'|'C'|undefined>)[(v >> 8) & 0x30] ?? null
  const lo = v & 0xff
  return {
    mode,
    buttons: {
      photo: (lo & 0x60) === 0x60,
      rth: (lo & 0x80) !== 0,
      camera: (lo & 0x04) !== 0,
      fn: (lo & 0x02) !== 0,
    } as Record<DjiButton, boolean>,
  }
}

export type DjiButton = 'photo'|'rth'|'camera'|'fn'

export class DjiRc {
  port:SerialPortLike|null = null
  private reader:ReadableStreamDefaultReader<Uint8Array>|null = null
  private writer:WritableStreamDefaultWriter<Uint8Array>|null = null
  connected = false
  private lastFrameAt = 0
  status = '未连接'
  // Mode 2: left vertical = throttle, left horizontal = yaw, right vertical = pitch, right horizontal = roll.
  sticks = {lh:0, lv:0, rh:0, rv:0, wheel:0}
  buttons:Record<DjiButton, boolean> = {photo:false, rth:false, camera:false, fn:false}
  rawButtons:Uint8Array|null = null
  onButton:(name:DjiButton) => void = () => {}
  onMode:(m:'C'|'N'|'S') => void = () => {}
  private buf:Uint8Array = new Uint8Array(0)
  private timers:number[] = []

  get supported() { return typeof navigator !== 'undefined' && 'serial' in navigator }
  get live() { return this.connected && performance.now() - this.lastFrameAt < 500 }

  // Connect silently to a previously-authorized DJI port, if any.
  async autoConnect() {
    if (!this.supported) return false
    const ports = (await navigator.serial!.getPorts()).filter(
      (p:SerialPortLike) => p.getInfo().usbVendorId === DJI_VENDOR)
    for (const p of ports) if (await this.tryPort(p)) return true
    return false
  }

  // Must be called from a user gesture (click) — requestPort shows the chooser.
  async connect() {
    if (!this.supported) throw new Error('此浏览器不支持 Web Serial，请用 Chrome/Edge 桌面版')
    const port = await navigator.serial!.requestPort({filters:[{usbVendorId:DJI_VENDOR}]})
    if (!(await this.tryPort(port))) throw new Error('该端口没有响应，请重新插拔遥控器再选其他端口')
  }

  async disconnect() {
    this.timers.forEach(clearInterval)
    this.timers = []
    this.connected = false
    try { await this.reader?.cancel() } catch {}
    try { this.reader?.releaseLock() } catch {}
    try { this.writer?.releaseLock() } catch {}
    try { await this.port?.close() } catch {}
    this.port = this.reader = this.writer = null
    this.status = '未连接'
  }

  private async tryPort(port:SerialPortLike) {
    await this.disconnect()
    this.status = '连接中…'
    try {
      await port.open({baudRate:115200, bufferSize:8192})
    } catch {
      this.status = '端口打不开'
      return false
    }
    this.port = port
    try { await port.setSignals({dataTerminalReady:true, requestToSend:true}) } catch {}
    this.writer = port.writable!.getWriter()
    this.reader = port.readable!.getWriter()
    this.connected = true
    void this.readLoop()
    await this.send(PKT_SIM_ON)
    this.timers.push(setInterval(() => void this.send(PKT_STICKS), 20))
    this.timers.push(setInterval(() => void this.send(PKT_BUTTONS), 60))
    this.timers.push(setInterval(() => void this.send(PKT_SIM_ON), 3000))
    const t0 = performance.now()
    while (performance.now() - t0 < 1500) {
      await new Promise(resolve => setTimeout(resolve, 100))
      if (this.lastFrameAt > t0) { this.status = '已连接'; return true }
    }
    await this.disconnect()
    this.status = '无响应'
    return false
  }

  private async send(pkt:Uint8Array) {
    if (!this.writer) return
    try { await this.writer.write(pkt) } catch { this.lost() }
  }

  private lost() {
    if (!this.connected) return
    void this.disconnect()
    this.status = '连接断开'
  }

  private async readLoop() {
    const reader = this.reader
    try {
      while (this.connected && reader) {
        const {value, done} = await reader.read()
        if (done) break
        if (value) this.feed(value)
      }
    } catch { this.lost() }
  }

  private feed(chunk:Uint8Array) {
    const b = new Uint8Array(this.buf.length + chunk.length)
    b.set(this.buf)
    b.set(chunk, this.buf.length)
    let i = 0
    for (;;) {
      while (i < b.length && b[i] !== 0x55) i++
      if (b.length - i < 4) break
      const len = (b[i + 1] | (b[i + 2] << 8)) & 0x3ff
      if (len < 13 || crc8(b.subarray(i, i + 3), 3) !== b[i + 3]) { i++; continue }
      if (b.length - i < len) break
      const f = b.subarray(i, i + len)
      if ((f[len - 2] | (f[len - 1] << 8)) === crc16(f, len - 2)) {
        this.frame(f)
        i += len
      } else i++
    }
    this.buf = b.slice(i)
  }

  private frame(f:Uint8Array) {
    const s = this.sticks
    if (f.length === 38 && f[10] === 0x01) {
      s.rh = axis(f[13], f[14])
      s.rv = axis(f[16], f[17])
      s.lv = axis(f[19], f[20])
      s.lh = axis(f[22], f[23])
      s.wheel = axis(f[25], f[26])
      this.lastFrameAt = performance.now()
    } else if (f.length === 21 && f[10] === 0x26) {
      s.rh = axis(f[11], f[12])
      s.rv = axis(f[13], f[14])
      s.lv = axis(f[15], f[16])
      s.lh = axis(f[17], f[18])
      this.lastFrameAt = performance.now()
    } else if (f.length === 58 && f[10] === 0x27) {
      this.rawButtons = f.slice(11, 56)
      const v = (f[28] << 8) | f[29]
      const now = decodeDjiButtons(v).buttons
      for (const k of Object.keys(now) as DjiButton[]) {
        if (now[k] && !this.buttons[k]) this.onButton(k)
      }
      this.buttons = now
    }
  }
}
