/* IDOK-544 载具操控台（青玉「山水印」：匾 · 印 · 签）
   电驴「车把仪匾」/ 轿车「中控台匾」/ 小船「舟楫罗盘匾」都住在原来的 .ride-hud 里，沿用 input-guard 的触控保护
   和遮罩 / 剧情 / 无人机 / 拍照 / 米粉各自的隐藏规则；手机拇指专用键（踏板、橹 / 篙、左右舵）住在 .walk-ui 里，
   复用拇指槽位、左手镜像、三套预设和 --thumb-scale。
   热路径：每帧 sync* 只经 DomWriter「读-比-写」，值没变就不碰 DOM；速度、转速、罗盘角、倾角这类高频量只写 CSS 变量。
   旧选择器与文案（.ride-type / .ride-gear / .ride-speed「N km/h」/ .ride-state 各状态句 …）一字不改，E2E 照旧按 class 找。
   IDOK-545（点火、P 挡、边撑）与 IDOK-546（船灯）经 VehicleControlHooks、patch() 或 window 事件接入；没接时用安全默认值。 */
import type {CarDynamicTelemetry} from '../walk/car'
import type {EbikeRideControlInput, EbikeTelemetrySnapshot} from '../walk/ebike-fx'
import type {BoatBlockReason, BoatProbe, FreeBoatKind} from '../walk/boat'

export type CarGear = 'P' | 'R' | 'N' | 'D'
export type VehicleUiRide = 'bike' | 'bicycle' | 'car' | 'boat'
export type VehicleLightMode = 'off' | 'low' | 'high'
export type VehicleUiTier = '' | 'personal' | 'shared' | 'bicycle' | 'car' | 'boat' | 'tour'
export type VehicleActionSource = 'click' | 'key' | 'touch' | 'api'
export type VehicleUiAction = 'ignition' | 'car-gear' | 'boat-light' | 'car-horn' | 'kickstand' | 'light-locked' | 'gear-locked' | 'warn-p'

/** 外部（IDOK-545 / 546）覆盖值：undefined 不动，null 交还给内部推断 / 遥测，其余值直接接管显示。 */
export interface VehicleExternalPatch {
  /** 边撑：true 放下、false 收起 */
  kickstand?: boolean | null
  /** 轿车排挡：P/R/N/D，或 car.ts 的挡位号（<0 R、0 N、>0 D） */
  gear?: CarGear | number | null
  engineOn?: boolean | null
  isSharedEbike?: boolean | null
  sharedSpeedCapKmh?: number | null
  lightMode?: VehicleLightMode | null
  notInPWarn?: boolean | null
  boatLightOn?: boolean | null
}

export interface VehicleControlHooks {
  onIgnitionToggle?: (on: boolean, source: VehicleActionSource) => void
  onCarGearSelect?: (gear: CarGear, source: VehicleActionSource) => void
  onBoatLightToggle?: (on: boolean, source: VehicleActionSource) => void
  onCarHorn?: (active: boolean, source: VehicleActionSource) => void
  /** down = 这一下之后边撑应处的状态（按当前显示推算） */
  onKickstandToggle?: (down: boolean, source: VehicleActionSource) => void
  onLockedPress?: (what: 'light' | 'gear', source: VehicleActionSource) => void
}

export interface VehicleActionDetail {
  action: VehicleUiAction
  value: boolean | string | null
  source: VehicleActionSource
}

/** readRideControls() 的扩展版：旧字段原样，新增字段全是可选，ebike-fx / ride 侧不认识也不受影响。 */
export interface VehicleRideControlInput extends EbikeRideControlInput {
  carHorn?: boolean
  carHornPulse?: boolean
  ignitionToggle?: boolean
  carGearSelect?: CarGear | null
  boatLightToggle?: boolean
}

export interface BoatHudState {
  probe: BoatProbe | null
  /** 弧度；0 = 北，逆时针为正（与 walk 的 heading 同号） */
  heading: number
  /** m/s；画舫走固定航线、没有可信船速时传 null */
  speed: number | null
  freeKind: FreeBoatKind | null
  isTourBoat: boolean
  /** IDOK-546 船灯实际点亮态（未传时保留本地状态） */
  lightOn?: boolean
}

/** IDOK-546 真实汽车点火与 P/R/N/D 排挡同步快照（strict=false 时退回本地推断以兼容旧 ?verify 脚本）。 */
export interface CarGearboxHudSync {
  strict: boolean
  ignition: 'off' | 'cranking' | 'on'
  selector: CarGear
}

export interface VehicleControlPulses {
  kickstandToggle: boolean
  ignitionToggle: boolean
  carGearSelect: CarGear | null
  boatLightToggle: boolean
}

export interface VehicleUiState {
  ride: VehicleUiRide | ''
  tier: VehicleUiTier
  engineOn: boolean
  carGear: CarGear
  notInPWarn: boolean
  boatLightOn: boolean
  lightLocked: boolean
  sharedCapKmh: number
  kickstandDown: boolean
}

export interface VehicleControlsOptions {
  /** .ride-hud 宿主：子节点由这里建 */
  hud: HTMLElement
  /** .walk-ui：手机拇指专用键挂在这里 */
  panel?: HTMLElement | null
  doc?: Document
  win?: Window | null
  body?: HTMLElement
  /** .walk-ui .btn-wheelie：翘头 / 手刹 / 爬起一键多义，文案与锁态由这里写 */
  wheelieButton?: HTMLElement | null
  hooks?: VehicleControlHooks
  toast?: (text: string, ms?: number) => void
  now?: () => number
  /** 默认 true：挂到 window.__vehicleControls */
  expose?: boolean
}

// ── 读-比-写：所有每帧写入都走这里，测试用 count 断言「同状态零写入」 ─────────────────────────────────
export interface DomWriter {
  readonly count: number
  text(el: Element, value: string): boolean
  attr(el: Element, name: string, value: string | null): boolean
  cls(el: Element, name: string, on: boolean): boolean
  hide(el: HTMLElement, hidden: boolean): boolean
  prop(el: HTMLElement, name: string, value: string): boolean
  reset(): void
}

export function createDomWriter(): DomWriter {
  let count = 0
  return {
    get count() { return count },
    text(el, value) {
      if (el.textContent === value) return false
      el.textContent = value; count++; return true
    },
    attr(el, name, value) {
      if (el.getAttribute(name) === value) return false
      if (value === null) el.removeAttribute(name)
      else el.setAttribute(name, value)
      count++; return true
    },
    cls(el, name, on) {
      if (el.classList.contains(name) === on) return false
      el.classList.toggle(name, on); count++; return true
    },
    hide(el, hidden) {
      if (el.hidden === hidden) return false
      el.hidden = hidden; count++; return true
    },
    prop(el, name, value) {
      if (el.style.getPropertyValue(name) === value) return false
      el.style.setProperty(name, value); count++; return true
    },
    reset() { count = 0 },
  }
}

// ── 常量 ────────────────────────────────────────────────────────────────────────────────────
const MOD_LABELS = {stock: '素车', ghostfire: '鬼火', neon: '霓虹'} as const
const BIKE_GEAR_LABELS = ['D1', 'D2', 'D3', 'S'] as const
const BICYCLE_GEAR_LABELS = ['1挡', '2挡', '3挡'] as const
const CAR_MODE_LABELS = ['合规40', '街道75', '运动108'] as const
const PRND: readonly CarGear[] = ['P', 'R', 'N', 'D']
const PRND_NAMES: Record<CarGear, string> = {P: '驻车挡', R: '倒挡', N: '空挡', D: '前进挡'}
const DIAL_MAX_KMH = {bike: 60, bicycle: 36, car: 120} as const
const DEFAULT_SHARED_CAP_KMH = 25
const BOAT_KIND_LABEL: Record<FreeBoatKind, string> = {rowboat: '小船', freeRaft: '竹筏'}
const BOAT_BLOCK_LABEL: Record<Exclude<BoatBlockReason, ''>, string> = {
  bridge: '低桥', shallow: '浅滩', lock: '船闸', obstacle: '有障碍', offshore: '离岸',
}
const WARN_P_MS = 1800
const ENGINE_OFF_TOAST_GAP_MS = 2600

type HoldId = 'gas' | 'brake' | 'row' | 'back' | 'port' | 'stbd'
type Kid = Node | string

function clamp01(v: number) { return v <= 0 ? 0 : v >= 1 ? 1 : v }
function fixed3(v: number) { return clamp01(v).toFixed(3) }

function mk<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, cls: string, attrs?: Record<string, string> | null, ...kids: Kid[]): HTMLElementTagNameMap[K] {
  const el = doc.createElement(tag)
  if (cls) el.className = cls
  if (attrs) for (const k of Object.keys(attrs)) el.setAttribute(k, attrs[k])
  if (kids.length) el.append(...kids)
  return el
}
function keyBtn(doc: Document, cls: string, label: string, keycap: string | null, text: Kid, extra?: Record<string, string>) {
  const attrs: Record<string, string> = {type: 'button', 'aria-label': label}
  if (keycap) attrs['data-key'] = keycap
  return mk(doc, 'button', cls, extra ? {...attrs, ...extra} : attrs, text)
}

export interface VehicleHudRefs {
  hud: HTMLElement
  meter: HTMLElement; dial: HTMLElement; speed: HTMLElement; speedNum: HTMLElement; scale: HTMLElement; gear: HTMLElement
  id: HTMLElement; type: HTMLElement; mod: HTMLButtonElement
  gauges: HTMLElement; bat: HTMLElement; batFill: HTMLElement; batPct: HTMLElement; lean: HTMLElement; leanFill: HTMLElement
  gears: HTMLElement; gearButtons: HTMLButtonElement[]; cap: HTMLElement; capNum: HTMLElement
  car: HTMLElement; ignition: HTMLButtonElement; prnd: HTMLElement; prndButtons: HTMLButtonElement[]; warn: HTMLElement
  pedals: HTMLElement; pedalBrake: HTMLButtonElement; pedalGas: HTMLButtonElement; pedalHb: HTMLButtonElement
  drive: HTMLElement; kickstand: HTMLButtonElement; park: HTMLButtonElement; cruise: HTMLButtonElement; sound: HTMLButtonElement
  lights: HTMLElement; light: HTMLButtonElement; lightText: HTMLElement; turnLeft: HTMLButtonElement; hazard: HTMLButtonElement; turnRight: HTMLButtonElement; horn: HTMLButtonElement
  boat: HTMLElement; compass: HTMLElement; boatSpeedNum: HTMLElement; boatKind: HTMLElement; boatStatus: HTMLElement; boatLight: HTMLButtonElement
  helm: HTMLElement; helmButtons: HTMLButtonElement[]
  state: HTMLButtonElement; keys: HTMLElement
}

/** 建 .ride-hud 的全部子节点（旧 class 一个不少，按「组」包起来，CSS 再按载具和屏幕排行）。 */
export function buildRideHud(doc: Document, hud: HTMLElement): VehicleHudRefs {
  while (hud.firstChild) hud.removeChild(hud.firstChild)
  hud.classList.add('vc-hud')

  const dial = mk(doc, 'i', 'vc-dial', {'aria-hidden': 'true'})
  const speedNum = mk(doc, 'b', 'vc-num', null, '0')
  const speed = mk(doc, 'span', 'ride-speed', null, speedNum, mk(doc, 'span', 'vc-unit', null, ' km/h'))
  const scale = mk(doc, 'i', 'vc-scale', {'aria-hidden': 'true'}, mk(doc, 'i', ''))
  const gear = mk(doc, 'span', 'ride-gear', null, 'D2')
  const meter = mk(doc, 'span', 'vc-grp vc-meter', null, dial, speed, scale, gear)

  const type = mk(doc, 'span', 'ride-type', {'data-kind': 'normal'}, '电摩')
  const mod = keyBtn(doc, 'ride-mod vc-key', '切换电动车改装', 'G', '素车', {'data-mod': 'stock'})
  const id = mk(doc, 'span', 'vc-grp vc-id', null, type, mod)

  const batFill = mk(doc, 'i', '')
  const batPct = mk(doc, 'span', 'ride-bat-pct', null, '100%')
  const bat = mk(doc, 'span', 'ride-bat', {'data-level': 'ok'}, mk(doc, 'span', 'ride-bat-bar', null, batFill), batPct)
  const leanFill = mk(doc, 'i', '')
  const lean = mk(doc, 'span', 'ride-lean-bar', {title: '压弯倾角风险', 'data-level': 'ok'}, leanFill)
  const gauges = mk(doc, 'span', 'vc-grp vc-gauges', null, bat, lean)

  const gearButtons = BIKE_GEAR_LABELS.map((label, i) => {
    const b = mk(doc, 'button', 'ride-gear-btn', {type: 'button', 'data-gear': String(i + 1), 'aria-pressed': String(i === 1)}, label)
    if (i === 1) b.classList.add('on')
    return b
  })
  const capNum = mk(doc, 'b', '', null, String(DEFAULT_SHARED_CAP_KMH))
  const cap = mk(doc, 'span', 'vc-cap', {role: 'note', title: '共享电单车锁速，不可换挡'}, capNum, ' km/h 锁速')
  const gears = mk(doc, 'span', 'vc-grp ride-gears', {role: 'group', 'aria-label': '挡位切换'}, ...gearButtons, cap)

  const ignition = keyBtn(doc, 'vc-ignition vc-key', '点火开关', 'K', mk(doc, 'span', 'vc-t', null, '点火'), {'aria-pressed': 'true', title: '点火 / 熄火 (K / I)'})
  ignition.prepend(mk(doc, 'i', 'vc-ign-ring', {'aria-hidden': 'true'}))
  const prndButtons = PRND.map(g => mk(doc, 'button', 'vc-prnd-btn', {type: 'button', role: 'radio', 'data-prnd': g, 'aria-checked': String(g === 'P'), 'aria-label': `${g} ${PRND_NAMES[g]}`}, g))
  const prnd = mk(doc, 'span', 'vc-prnd', {role: 'radiogroup', 'aria-label': '排挡 P R N D', 'data-sel': 'P'}, mk(doc, 'i', 'vc-prnd-slot', {'aria-hidden': 'true'}), ...prndButtons)
  prnd.style.setProperty('--vc-prnd-i', '0')
  const warn = mk(doc, 'span', 'vc-warn', {role: 'status'}, '请先挂 P 挡')
  warn.hidden = true
  const car = mk(doc, 'span', 'vc-grp vc-car', null, ignition, prnd, warn)

  const pedalBrake = keyBtn(doc, 'vc-pedal', '刹车（按住）', 'S', '刹车', {'data-pedal': 'brake'})
  const pedalGas = keyBtn(doc, 'vc-pedal', '油门（按住）', 'W', '油门', {'data-pedal': 'gas'})
  const pedalHb = keyBtn(doc, 'vc-pedal', '手刹', 'SP', '手刹', {'data-pedal': 'hb', tabindex: '-1'})
  const pedals = mk(doc, 'span', 'vc-grp vc-pedals', {'aria-label': '踏板'}, pedalBrake, pedalGas, pedalHb)

  const kickstand = keyBtn(doc, 'vc-kickstand vc-key', '边撑', 'K', '边撑', {'aria-pressed': 'false', 'data-state': 'up', title: '边撑 放下 / 收起 (K)'})
  const park = keyBtn(doc, 'ride-park vc-key', 'P档驻车', 'P', 'P', {title: 'P档驻车 / 边撑 (0/P/K)'})
  const cruise = keyBtn(doc, 'ride-cruise vc-key', '定速巡航', 'U', '定速', {title: '定速巡航 (U)'})
  const sound = keyBtn(doc, 'ride-sound vc-key', '骑行音效', null, '音效', {'aria-pressed': 'true', title: '骑行音效 开/关'})
  const drive = mk(doc, 'span', 'vc-grp vc-drive', null, kickstand, park, cruise, sound)

  const lightText = mk(doc, 'span', 'vc-t', null, '关灯')
  const light = keyBtn(doc, 'ride-light vc-key', '切换车灯', 'L', lightText, {title: '车灯切换 关/近/远 (L)', 'data-mode': 'off'})
  light.append(mk(doc, 'i', 'vc-lock', {'aria-hidden': 'true'}))
  const turnLeft = keyBtn(doc, 'ride-turn-left vc-key', '左转向灯', 'Z', '◀', {title: '左转向灯 (Z)'})
  const hazard = keyBtn(doc, 'ride-hazard vc-key', '双闪警示灯', 'B', '⚠', {title: '双闪警示灯 (B)'})
  const turnRight = keyBtn(doc, 'ride-turn-right vc-key', '右转向灯', 'X', '▶', {title: '右转向灯 (X)'})
  const horn = keyBtn(doc, 'ride-horn vc-key', '喇叭鸣笛', 'H', '喇叭', {title: '喇叭鸣笛 (H)'})
  const lights = mk(doc, 'span', 'vc-grp vc-lights', null, light, turnLeft, hazard, turnRight, horn)

  const card = mk(doc, 'i', 'vc-compass-card', null,
    mk(doc, 'i', 'vc-compass-needle'),
    mk(doc, 'b', '', {'data-dir': 'n'}, '北'), mk(doc, 'b', '', {'data-dir': 'e'}, '东'),
    mk(doc, 'b', '', {'data-dir': 's'}, '南'), mk(doc, 'b', '', {'data-dir': 'w'}, '西'))
  const compass = mk(doc, 'span', 'vc-compass', {'aria-hidden': 'true'}, card)
  compass.style.setProperty('--vc-compass-deg', '0deg')
  const boatSpeedNum = mk(doc, 'b', 'vc-num', null, '0.0')
  const boatKind = mk(doc, 'span', 'vc-boat-kind', null, '小船')
  const boatRead = mk(doc, 'span', 'vc-boat-read', null, mk(doc, 'span', 'vc-boat-speed', null, boatSpeedNum, mk(doc, 'span', 'vc-unit', null, ' km/h')), boatKind)
  const boatStatus = mk(doc, 'span', 'vc-boat-status', {role: 'status', 'data-state': 'ok'}, '通航')
  const boatLight = keyBtn(doc, 'vc-boat-light vc-key', '船灯', 'L', '船灯', {'aria-pressed': 'false', title: '船灯 (L)'})
  const helmButtons = ([['port', 'A', '左舵'], ['fwd', 'W', '推进'], ['back', 'S', '倒桨'], ['stbd', 'D', '右舵']] as const)
    .map(([h, k, label]) => keyBtn(doc, 'vc-helm-btn', `${label}（按住）`, k, label, {'data-helm': h, tabindex: '-1'}))
  const helm = mk(doc, 'span', 'vc-helm', {role: 'group', 'aria-label': '舵桨'}, ...helmButtons)
  const boat = mk(doc, 'span', 'vc-grp vc-boat', null, compass, boatRead, boatStatus, boatLight, helm)

  const state = mk(doc, 'button', 'ride-state', {type: 'button'})
  state.hidden = true
  const keys = mk(doc, 'span', 'ride-keys', {'aria-hidden': 'true'}, '0/P驻车 · K撑 · L灯 · Z/X/B · H喇叭 · U定速 · G改 · Shift压弯')

  const band1 = mk(doc, 'span', 'vc-band vc-band--1', null, meter, id, gauges, boat)
  const band2 = mk(doc, 'span', 'vc-band vc-band--2', null, car, drive)
  const band3 = mk(doc, 'span', 'vc-band vc-band--3', null, gears, pedals, lights, state)
  hud.append(band1, band2, band3, keys)
  return {
    hud, meter, dial, speed, speedNum, scale, gear, id, type, mod, gauges, bat, batFill, batPct, lean, leanFill,
    gears, gearButtons, cap, capNum, car, ignition, prnd, prndButtons, warn, pedals, pedalBrake, pedalGas, pedalHb,
    drive, kickstand, park, cruise, sound, lights, light, lightText, turnLeft, hazard, turnRight, horn,
    boat, compass, boatSpeedNum, boatKind, boatStatus, boatLight, helm, helmButtons, state, keys,
  }
}

export interface VehicleThumbRefs {
  gas: HTMLButtonElement; brake: HTMLButtonElement
  row: HTMLButtonElement; back: HTMLButtonElement; port: HTMLButtonElement; stbd: HTMLButtonElement
}

/** 手机拇指专用键：轿车 A 油门 / C 刹车（B 手刹沿用 .btn-wheelie）；小船 A 推进 / B 倒桨 / C 左舵 / D 右舵。 */
export function buildThumbKeys(doc: Document, panel: HTMLElement): VehicleThumbRefs {
  const t = (mod: string, label: string, text: string) => {
    const b = mk(doc, 'button', `vc-thumb vc-thumb--${mod}`, {type: 'button', 'aria-label': label}, text)
    panel.append(b)
    return b
  }
  return {
    gas: t('gas', '油门（按住加速）', '油门'),
    brake: t('brake', '刹车（按住减速 / 倒车）', '刹车'),
    row: t('row', '推进（按住摇橹 / 撑篙）', '推进'),
    back: t('back', '倒桨（按住后退）', '倒桨'),
    port: t('port', '左舵（按住）', '左舵'),
    stbd: t('stbd', '右舵（按住）', '右舵'),
  }
}

export interface VehicleControls {
  readonly refs: VehicleHudRefs
  readonly thumbs: VehicleThumbRefs | null
  readonly writer: DomWriter
  readonly engineOn: boolean
  syncRide(state: EbikeTelemetrySnapshot | null, kind: VehicleUiRide | null, opts?: {wheelieHeld?: boolean}): void
  syncCar(state: CarDynamicTelemetry | null, headlight?: VehicleLightMode, opts?: {hornHeld?: boolean; carGearbox?: CarGearboxHudSync | null}): void
  syncBoat(state: BoatHudState | null): void
  /** 虚拟踏板 / 舵桨的轴量（鼠标按住桌面键、手指按住拇指键），叠加到 walk.read() */
  axes(): {forward: number; right: number}
  /** 熄火时不给油：仍在滑行时允许踩刹车，停稳后前后都不动 */
  gateForward(forward: number): number
  /** 桌面 W/S/A/D 按下时点亮对应踏板 / 舵键 */
  reflectKeys(forward: boolean, back: boolean, left: boolean, right: boolean): void
  resetHolds(): void
  consumePulses(): VehicleControlPulses
  toggleIgnition(source?: VehicleActionSource): boolean
  toggleKickstand(source?: VehicleActionSource): void
  toggleBoatLight(source?: VehicleActionSource): boolean
  selectCarGear(gear: CarGear, source?: VehicleActionSource): void
  noteCarHorn(active: boolean, source?: VehicleActionSource): void
  lightLocked(): boolean
  isShared(): boolean
  isTourBoat(): boolean
  lockedPress(what: 'light' | 'gear', source?: VehicleActionSource): void
  triggerNotInPWarn(ms?: number): void
  patch(p: VehicleExternalPatch): void
  setHooks(h: VehicleControlHooks): void
  getState(): VehicleUiState
  dispose(): void
}

export function createVehicleControls(opts: VehicleControlsOptions): VehicleControls {
  const hud = opts.hud
  const doc = opts.doc ?? hud.ownerDocument
  const win: Window | null = opts.win !== undefined ? opts.win : (typeof window !== 'undefined' ? window : null)
  const body = opts.body ?? doc.body
  const wheelieBtn = opts.wheelieButton ?? null
  let wheelieLabel: HTMLElement | null = null
  if (wheelieBtn) {
    const initText = wheelieBtn.textContent || '翘头'
    while (wheelieBtn.firstChild) wheelieBtn.removeChild(wheelieBtn.firstChild)
    wheelieLabel = mk(doc, 'span', 'vc-wheelie-t', null, initText)
    wheelieBtn.append(wheelieLabel, mk(doc, 'i', 'vc-thumb-lock', {'aria-hidden': 'true'}))
  }
  const now = opts.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()))
  const toast = opts.toast ?? ((text: string, ms = 2200) => {
    win?.dispatchEvent(new CustomEvent('walk:toast', {detail: {text, ms}}))
  })
  let hooks: VehicleControlHooks = {...opts.hooks}
  const w = createDomWriter()
  const r = buildRideHud(doc, hud)
  const panel = opts.panel ?? null
  const thumbs = panel ? buildThumbKeys(doc, panel) : null

  // ── 状态 ──
  const ov: VehicleExternalPatch = {}
  let ride: VehicleUiRide | '' = ''
  let tier: VehicleUiTier = ''
  let engine = true
  let pickedGear: CarGear | null = null
  let movedSinceMount = false
  let lastCarKmh = 0
  let lastCarGear: CarGear = 'P'
  let warnUntil = 0
  let warnTimer = 0
  let boatLight = false
  let tourBoat = false
  let sharedNow = false
  let kickDown = false
  let carHornOn = false
  let carBoxActive = false
  let carCranking = false
  let engineToastAt = -Infinity
  let engineBlockedPrev = false
  const kb = {forward: false, back: false, left: false, right: false}
  const holds = new Map<number, HoldId>()
  const pulses: VehicleControlPulses = {kickstandToggle: false, ignitionToggle: false, carGearSelect: null, boatLightToggle: false}
  const pulsesOut: VehicleControlPulses = {kickstandToggle: false, ignitionToggle: false, carGearSelect: null, boatLightToggle: false}
  const axesOut = {forward: 0, right: 0}
  let boatStatusText = '通航'
  let boatStatusLevel: 'ok' | 'warn' | 'info' = 'ok'

  const emit = (action: VehicleUiAction, value: boolean | string | null, source: VehicleActionSource) => {
    win?.dispatchEvent(new CustomEvent<VehicleActionDetail>('glol:vehicle-ui:action', {detail: {action, value, source}}))
  }
  const engineOn = () => (typeof ov.engineOn === 'boolean' ? ov.engineOn : engine)
  const sharedCap = () => {
    const v = ov.sharedSpeedCapKmh
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : DEFAULT_SHARED_CAP_KMH
  }
  const warnActive = () => ov.notInPWarn === true || now() < warnUntil
  const boatLightOn = () => (typeof ov.boatLightOn === 'boolean' ? ov.boatLightOn : boatLight)
  const held = (id: HoldId) => { for (const v of holds.values()) if (v === id) return true; return false }

  function setRide(next: VehicleUiRide | '', nextTier: VehicleUiTier) {
    if (next === 'car' && ride !== 'car') {
      // 每次上车：没有外部钩子时默认已点火（car.mjs / drive.mjs 照旧能开），挡位从 P 起
      engine = true; pickedGear = null; movedSinceMount = false; lastCarKmh = 0; engineBlockedPrev = false
    }
    if (next !== 'car') {
      if (carHornOn) noteCarHorn(false, 'api')
      carBoxActive = false; carCranking = false
    }
    if (next !== ride) resetHolds()
    ride = next; tier = nextTier
    w.attr(hud, 'data-vc-ride', next || null)
    w.attr(hud, 'data-vc-tier', nextTier || null)
    if (panel) w.attr(panel, 'data-vc-tier', nextTier || null)
  }

  // ── 电驴 / 单车 ──
  function syncRide(state: EbikeTelemetrySnapshot | null, kind: VehicleUiRide | null, o?: {wheelieHeld?: boolean}) {
    w.attr(body, 'data-ride', kind)
    w.attr(body, 'data-ride-type', state && kind === 'bike' ? state.vehicleType : null)
    if (!state || (kind !== 'bike' && kind !== 'bicycle')) {
      w.hide(r.state, true)
      w.attr(body, 'data-ride-crash', null)
      if (wheelieBtn) { w.attr(wheelieBtn, 'data-locked', '0'); w.attr(wheelieBtn, 'aria-disabled', 'false') }
      if (kind === 'boat') { if (ride !== 'boat') setRide('boat', tourBoat ? 'tour' : 'boat') }
      else if (kind === 'car') { if (ride !== 'car') setRide('car', 'car') }
      else setRide('', '')
      return
    }
    const bicycle = kind === 'bicycle'
    sharedNow = !bicycle && (typeof ov.isSharedEbike === 'boolean' ? ov.isSharedEbike : state.vehicleType === 'shared')
    setRide(kind, bicycle ? 'bicycle' : sharedNow ? 'shared' : 'personal')
    const gearLabels: readonly string[] = bicycle ? BICYCLE_GEAR_LABELS : sharedNow ? [] : BIKE_GEAR_LABELS
    const lightMode: VehicleLightMode = ov.lightMode ?? state.headlight ?? 'off'
    kickDown = typeof ov.kickstand === 'boolean' ? ov.kickstand : !!state.kickstandDown
    const maxKmh = Math.round(state.maxKmh)

    if (bicycle) {
      w.attr(r.type, 'data-kind', 'bicycle'); w.text(r.type, '单车')
      w.text(r.gear, state.gearLabel || '2挡')
      w.attr(r.gear, 'title', `单车 · 本挡限速 ${maxKmh} km/h（1-3 / Q·E 换挡）`)
      w.text(r.keys, '1-3/Q·E · K撑 · H铃铛 · Shift压弯 · Space翘头')
      w.text(r.horn, '铃铛')
      w.attr(r.horn, 'aria-label', '车铃')
      w.cls(r.horn, 'on', !!state.hornActive)
    } else {
      w.attr(r.type, 'data-kind', state.vehicleType); w.text(r.type, state.vehicleBadge)
      w.text(r.gear, state.parkLocked ? 'P' : state.gearLabel)
      w.attr(r.gear, 'title', state.parkLocked
        ? `${state.vehicleLabel} · P档驻车（${sharedNow ? '轻捏刹车(S) / 按 P / 按 K 解锁' : '按 0/P/K 或 E 解除'}）`
        : sharedNow
          ? `${state.vehicleLabel} · 单档限速 ${maxKmh} km/h（不可调档）`
          : `${state.vehicleLabel} · 本挡限速 ${maxKmh} km/h（1-4 / Q·E 换挡）`)
      w.text(r.keys, sharedNow
        ? '0/P驻车 · K撑 · Z/X/B · H喇叭 · U定速 · 单档限25(禁调档/禁切远近光)'
        : '0/P驻车 · K撑 · L灯 · Z/X/B · H喇叭 · U定速 · G改 · Shift压弯')
      w.cls(r.park, 'on', !!state.parkLocked)
      w.attr(r.park, 'aria-pressed', String(!!state.parkLocked))
      paintLight(lightMode, sharedNow)
      w.cls(r.turnLeft, 'on', !!state.leftSignalLit)
      w.cls(r.turnLeft, 'armed', state.turnSignal === 'left')
      w.cls(r.turnRight, 'on', !!state.rightSignalLit)
      w.cls(r.turnRight, 'armed', state.turnSignal === 'right')
      w.cls(r.hazard, 'on', !!state.hazard && !!state.blinkOn)
      w.cls(r.hazard, 'armed', !!state.hazard)
      w.text(r.horn, '喇叭')
      w.attr(r.horn, 'aria-label', '喇叭鸣笛')
      w.cls(r.horn, 'on', !!state.hornActive)
      const cruiseOn = !!state.cruiseControl
      w.cls(r.cruise, 'on', cruiseOn)
      w.text(r.cruise, cruiseOn && state.cruiseTargetKmh ? `定速${state.cruiseTargetKmh}` : '定速')
      w.attr(r.cruise, 'data-target', cruiseOn && state.cruiseTargetKmh ? String(state.cruiseTargetKmh) : null)
      const pct = Math.max(0, Math.min(100, Math.round(state.battery)))
      w.attr(r.bat, 'data-level', state.criticalBattery ? 'crit' : state.lowBattery ? 'low' : 'ok')
      w.prop(r.bat, '--vc-bat', fixed3(pct / 100))
      w.text(r.batPct, `${pct}%`)
      w.text(r.mod, MOD_LABELS[state.modPreset])
      w.attr(r.mod, 'data-mod', state.modPreset)
      w.attr(r.mod, 'title', `改装：${MOD_LABELS[state.modPreset]}（G 切换）`)
      w.text(r.capNum, String(sharedCap()))
      w.attr(r.cap, 'aria-label', `共享电单车 ${sharedCap()} km/h 锁速`)
    }
    w.cls(r.kickstand, 'on', kickDown)
    w.attr(r.kickstand, 'data-state', kickDown ? 'down' : 'up')
    w.attr(r.kickstand, 'aria-pressed', String(kickDown))

    const risk = clamp01(state.leanDangerRatio ?? state.crashRisk ?? (Math.abs(state.lean) / Math.max(.18, state.leanLimit)))
    w.prop(r.lean, '--vc-lean', risk.toFixed(2))
    w.attr(r.lean, 'data-level', risk >= .82 ? 'crit' : risk >= .55 ? 'warn' : 'ok')
    for (let i = 0; i < r.gearButtons.length; i++) {
      const btn = r.gearButtons[i], label = gearLabels[i]
      w.hide(btn, !label)
      if (label) {
        w.text(btn, label)
        const active = !state.parkLocked && state.gear === i + 1
        w.cls(btn, 'on', active)
        w.attr(btn, 'aria-pressed', String(active))
      }
    }
    paintSpeed(state.kmh, bicycle ? DIAL_MAX_KMH.bicycle : DIAL_MAX_KMH.bike, sharedNow ? Math.min(maxKmh, sharedCap()) : maxKmh)

    const leanDeg = Math.round(Math.abs(state.lean) * 180 / Math.PI)
    const wheelieDeg = Math.round(Math.max(0, state.wheelie) * 180 / Math.PI)
    const crashed = state.crashPhase === 'crashed'
    const wheelieBlocked = kind === 'bike' && state.vehicleType === 'shared' && !crashed
    if (wheelieBtn) {
      w.attr(wheelieBtn, 'data-locked', wheelieBlocked ? '1' : '0')
      w.attr(wheelieBtn, 'aria-disabled', wheelieBlocked ? 'true' : 'false')
    }
    w.attr(body, 'data-ride-crash', crashed ? '1' : '0')
    const st = (text: string | null, warnOn = false, sharedLegacy = false) => {
      w.attr(r.state, 'data-shared-legacy', sharedLegacy ? '1' : null)
      if (text === null) { w.hide(r.state, true); w.attr(r.state, 'data-warn', '0'); return }
      w.hide(r.state, false); w.attr(r.state, 'data-warn', warnOn ? '1' : '0'); w.text(r.state, text)
    }
    if (crashed) {
      st('摔车中', true)
      if (wheelieBtn) { if (wheelieLabel) w.text(wheelieLabel, '爬起'); w.cls(wheelieBtn, 'on', true) }
    } else if (state.crashPhase === 'recovering') {
      st('爬起中…')
      if (wheelieLabel) w.text(wheelieLabel, '翘头')
    } else {
      if (wheelieBtn) {
        if (wheelieLabel) w.text(wheelieLabel, wheelieBlocked ? '禁翘头' : '翘头')
        w.cls(wheelieBtn, 'on', !wheelieBlocked && !!o?.wheelieHeld)
      }
      if (kind === 'bike' && state.parkLocked) st(state.kickstandDown ? 'P档 · 边撑已放' : 'P档驻车')
      else if (state.kickstandDown) st('边撑放下 · 按K收起')
      else if (kind === 'bike' && state.batteryDepleted) st(state.maxKmh > 0 ? `电量耗尽 · 限速 ${maxKmh}` : '电量耗尽', true)
      else if (kind === 'bike' && state.criticalBattery) st(`极低电 · 限速 ${maxKmh}`, true)
      else if (wheelieDeg >= 4) {
        // IDOK-153：稳住翘头是安全的，只有后轮着地时急转 / 高速转才会翻
        const tipping = (state.wheelieTip ?? 0) >= .35
        st(tipping ? `翘头 ${wheelieDeg}° 别急转` : `翘头 ${wheelieDeg}°`, tipping)
      } else if (leanDeg >= 8) {
        const risky = Math.abs(state.lean) >= state.leanLimit * .82 || (state.crashRisk ?? 0) >= .72
        st(risky ? `压弯 ${leanDeg}° 易摔` : `压弯 ${leanDeg}°`, risky)
      } else if (kind === 'bike' && state.lowBattery) st('低电预警', true)
      else if (kind === 'bike' && state.vehicleType === 'shared') st('单档 · 限25', false, true)
      else st(null)
    }
  }

  function paintLight(mode: VehicleLightMode, locked: boolean) {
    const tag = locked ? (mode === 'low' ? '基础灯' : '自动灯') : (mode === 'high' ? '远光' : mode === 'low' ? '近光' : '关灯')
    w.text(r.lightText, tag)
    w.attr(r.light, 'data-mode', mode)
    w.cls(r.light, 'on', mode !== 'off')
    w.attr(r.light, 'data-locked', locked ? '1' : null)
    w.attr(r.light, 'aria-disabled', locked ? 'true' : null)
    w.attr(r.light, 'title', locked ? '共享电车锁定基础车灯（无法切换远近光）' : '车灯切换 关/近/远 (L)')
  }

  function paintSpeed(kmh: number, dialMax: number, limitKmh: number) {
    const v = Math.round(Math.abs(kmh))
    w.text(r.speedNum, String(v))
    w.prop(r.meter, '--vc-speed', fixed3(v / dialMax))
    w.prop(r.meter, '--vc-limit', fixed3(limitKmh / dialMax))
  }

  // ── 轿车 ──
  function carGearOf(state: CarDynamicTelemetry): CarGear {
    const ext = ov.gear
    if (typeof ext === 'number' && Number.isFinite(ext)) return ext < 0 ? 'R' : ext === 0 ? 'N' : 'D'
    if (typeof ext === 'string' && (PRND as readonly string[]).includes(ext)) return ext as CarGear
    const still = Math.abs(state.kmh) < 1
    if (!still) { movedSinceMount = true; pickedGear = null }
    if (still && pickedGear) return pickedGear
    if (state.gearLabel === 'R' || state.reversing) return 'R'
    if (still && (state.handbrake || !engineOn() || !movedSinceMount)) return 'P'
    if (state.gear === 0) return still ? 'P' : 'N'
    return 'D'
  }

  function syncCar(state: CarDynamicTelemetry | null, headlight: VehicleLightMode = 'off', o?: {hornHeld?: boolean; carGearbox?: CarGearboxHudSync | null}) {
    if (!state) {
      carBoxActive = false; carCranking = false
      w.hide(r.state, true)
      w.attr(body, 'data-ride-crash', null)
      return
    }
    w.attr(body, 'data-ride', 'car')
    w.attr(body, 'data-ride-type', null)
    w.attr(body, 'data-ride-crash', null)
    setRide('car', 'car')
    const box = o?.carGearbox ?? null
    carBoxActive = !!box?.strict
    carCranking = carBoxActive && box!.ignition === 'cranking'
    if (carBoxActive) engine = box!.ignition === 'on'
    lastCarKmh = Math.abs(state.kmh)
    w.attr(r.type, 'data-kind', 'car'); w.text(r.type, '轿车')
    paintLight(ov.lightMode ?? headlight, false)
    w.text(r.gear, state.gearLabel)
    w.attr(r.gear, 'title', `自动挡 ${state.gearLabel} · ${state.modeLabel}模式上限 ${state.maxKmh} km/h（1-3 / Q·E 切模式）`)
    for (let i = 0; i < r.gearButtons.length; i++) {
      const btn = r.gearButtons[i], label = CAR_MODE_LABELS[i]
      w.hide(btn, !label)
      if (label) {
        w.text(btn, label)
        const active = state.modeIndex === i + 1
        w.cls(btn, 'on', active)
        w.attr(btn, 'aria-pressed', String(active))
      }
    }
    paintSpeed(state.kmh, DIAL_MAX_KMH.car, state.maxKmh)
    const rpmRatio = Math.max(.05, Math.min(1, Math.round(state.rpmRatio * 100) / 100))
    w.attr(r.bat, 'data-level', state.rpm >= 5600 ? 'crit' : state.rpm >= 4400 ? 'low' : 'ok')
    w.prop(r.bat, '--vc-bat', fixed3(rpmRatio))
    w.text(r.batPct, `${(state.rpm / 1000).toFixed(1)}k`)
    w.text(r.keys, 'Space手刹漂移 · 1-3/Q·E切模式')
    w.text(r.horn, '喇叭')
    w.attr(r.horn, 'aria-label', '喇叭鸣笛')
    w.cls(r.horn, 'on', !!o?.hornHeld)
    if (wheelieBtn) {
      w.attr(wheelieBtn, 'data-locked', '0')
      w.attr(wheelieBtn, 'aria-disabled', 'false')
      if (wheelieLabel) w.text(wheelieLabel, '手刹')
      w.cls(wheelieBtn, 'on', state.handbrake)
    }
    w.cls(r.pedalHb, 'on', state.handbrake)
    paintEngine()
    lastCarGear = ov.gear != null ? carGearFromPatch(ov.gear) : carBoxActive ? box!.selector : carGearOf(state)
    paintPrnd(lastCarGear)

    const slipDeg = Math.round(Math.abs(state.slipAngle) * 180 / Math.PI)
    const st = (text: string | null, warnOn = false) => {
      w.attr(r.state, 'data-shared-legacy', null)
      if (text === null) { w.hide(r.state, true); w.attr(r.state, 'data-warn', '0'); return }
      w.hide(r.state, false); w.attr(r.state, 'data-warn', warnOn ? '1' : '0'); w.text(r.state, text)
    }
    if (state.impactStrength > .32) st('撞击缓冲', true)
    else if (state.driftIntensity > .22) st(state.handbrake ? `手刹漂移 ${slipDeg}°` : `侧滑 ${slipDeg}°`, state.driftIntensity > .62)
    else if (state.handbrake && state.kmh > 3) st('手刹拉起')
    else if (state.shifting) st(`升挡 ${state.gearLabel}`)
    else if (carCranking && typeof ov.engineOn !== 'boolean') st('点火启动中…')
    else if (!engineOn()) st('已熄火 · 按 K/I 点火')
    else st(null)
  }

  function paintEngine() {
    const on = engineOn()
    const engState = carCranking && typeof ov.engineOn !== 'boolean' ? 'cranking' : on ? 'on' : 'off'
    w.attr(r.ignition, 'aria-pressed', String(on))
    w.attr(r.ignition, 'data-engine', engState)
    w.attr(hud, 'data-engine', ride === 'car' ? engState : null)
  }

  function paintPrnd(g: CarGear) {
    const idx = PRND.indexOf(g)
    w.attr(r.prnd, 'data-sel', g)
    w.prop(r.prnd, '--vc-prnd-i', String(idx))
    for (const b of r.prndButtons) w.attr(b, 'aria-checked', String(b.getAttribute('data-prnd') === g))
    const warnOn = warnActive() && g !== 'P'
    w.attr(r.prnd, 'data-warn-p', warnOn ? '1' : null)
    w.hide(r.warn, !warnOn)
  }

  // ── 小船 ──
  function resolveBoatStatus(b: BoatHudState) {
    if (b.isTourBoat) { boatStatusText = '随船游览'; boatStatusLevel = 'info'; return }
    const p = b.probe
    if (!p) { boatStatusText = '通航'; boatStatusLevel = 'ok'; return }
    const reason = p.blocked ? (p.reason || p.blockReason) : ''
    if (reason) { boatStatusText = BOAT_BLOCK_LABEL[reason]; boatStatusLevel = 'warn'; return }
    if (Number.isFinite(p.clearance) && p.clearance < 1.5) {
      boatStatusText = `净空 ${Math.max(0, p.clearance).toFixed(1)} m`
      boatStatusLevel = p.clearance < .3 ? 'warn' : 'info'
      return
    }
    boatStatusText = '通航'; boatStatusLevel = 'ok'
  }

  function syncBoat(b: BoatHudState | null) {
    if (!b) return
    tourBoat = b.isTourBoat
    setRide('boat', tourBoat ? 'tour' : 'boat')
    const kind = tourBoat ? '画舫' : b.freeKind ? BOAT_KIND_LABEL[b.freeKind] : '小船'
    w.text(r.boatKind, kind)
    const free = tourBoat ? null : (b.freeKind ?? 'rowboat')
    w.attr(hud, 'data-vc-free', free)
    if (panel) w.attr(panel, 'data-vc-free', free)
    const kmh = b.speed === null || !Number.isFinite(b.speed) ? null : Math.abs(b.speed) * 3.6
    w.text(r.boatSpeedNum, kmh === null ? '—' : kmh.toFixed(1))
    // 罗盘：heading 0 = 北、逆时针为正；卡盘顺时针转同样的角度，船头（顶上的准线）就指着实际航向
    let deg = (b.heading * 180 / Math.PI) % 360
    if (deg < 0) deg += 360
    w.prop(r.compass, '--vc-compass-deg', `${Math.round(deg * 2) / 2}deg`)
    resolveBoatStatus(b)
    w.text(r.boatStatus, boatStatusText)
    w.attr(r.boatStatus, 'data-state', boatStatusLevel)
    if (typeof b.lightOn === 'boolean' && typeof ov.boatLightOn !== 'boolean') boatLight = b.lightOn
    const lit = boatLightOn()
    w.cls(r.boatLight, 'on', lit)
    w.attr(r.boatLight, 'aria-pressed', String(lit))
    w.hide(r.state, true)
  }

  // ── 动作 ──
  function toggleIgnition(source: VehicleActionSource = 'api') {
    const next = !engineOn()
    pulses.ignitionToggle = true
    if (!(carBoxActive && typeof ov.engineOn !== 'boolean')) {
      if (typeof ov.engineOn === 'boolean') ov.engineOn = next
      else engine = next
      if (!next) { pickedGear = null }
      paintEngine()
      if (ride === 'car') paintPrnd(next ? lastCarGear : 'P')
    }
    hooks.onIgnitionToggle?.(next, source)
    emit('ignition', next, source)
    return next
  }

  function toggleKickstand(source: VehicleActionSource = 'api') {
    const next = !kickDown
    pulses.kickstandToggle = true
    hooks.onKickstandToggle?.(next, source)
    emit('kickstand', next, source)
  }

  function toggleBoatLight(source: VehicleActionSource = 'api') {
    const next = !boatLightOn()
    if (typeof ov.boatLightOn === 'boolean') ov.boatLightOn = next
    else boatLight = next
    pulses.boatLightToggle = true
    w.cls(r.boatLight, 'on', next)
    w.attr(r.boatLight, 'aria-pressed', String(next))
    hooks.onBoatLightToggle?.(next, source)
    emit('boat-light', next, source)
    return next
  }

  function selectCarGear(gear: CarGear, source: VehicleActionSource = 'api') {
    if (!(PRND as readonly string[]).includes(gear)) return
    pulses.carGearSelect = gear
    if (!(carBoxActive && ov.gear == null)) {
      const moving = lastCarKmh >= 1
      if (!moving && ov.gear == null) pickedGear = gear
      if (gear === 'P' && ov.notInPWarn !== true) warnUntil = 0
      if (ride === 'car' && !moving) { lastCarGear = ov.gear == null ? gear : lastCarGear; paintPrnd(lastCarGear) }
    }
    hooks.onCarGearSelect?.(gear, source)
    emit('car-gear', gear, source)
  }

  function noteCarHorn(active: boolean, source: VehicleActionSource = 'api') {
    if (active === carHornOn) return
    carHornOn = active
    hooks.onCarHorn?.(active, source)
    emit('car-horn', active, source)
  }

  function lockedPress(what: 'light' | 'gear', source: VehicleActionSource = 'api') {
    hooks.onLockedPress?.(what, source)
    emit(what === 'light' ? 'light-locked' : 'gear-locked', true, source)
    toast(what === 'light' ? '共享电单车车灯由平台锁定，不能手动切换' : `共享电单车 ${sharedCap()} km/h 锁速，不能换挡`, 1800)
  }

  function triggerNotInPWarn(ms = WARN_P_MS) {
    warnUntil = now() + Math.max(0, ms)
    if (ride === 'car') paintPrnd(lastCarGear)
    emit('warn-p', true, 'api')
    if (!win) return
    if (warnTimer) win.clearTimeout(warnTimer)
    warnTimer = win.setTimeout(() => { warnTimer = 0; if (ride === 'car') paintPrnd(lastCarGear) }, Math.max(0, ms) + 20)
  }

  function patch(p: VehicleExternalPatch) {
    if (!p || typeof p !== 'object') return
    for (const k of Object.keys(p) as (keyof VehicleExternalPatch)[]) {
      const v = p[k]
      if (v === undefined) continue
      if (v === null) delete ov[k]
      else (ov as Record<string, unknown>)[k] = v
    }
    if (ride === 'car') { paintEngine(); paintPrnd(ov.gear != null ? carGearFromPatch(ov.gear) : lastCarGear) }
    if (ride === 'boat') { const lit = boatLightOn(); w.cls(r.boatLight, 'on', lit); w.attr(r.boatLight, 'aria-pressed', String(lit)) }
  }
  function carGearFromPatch(g: CarGear | number): CarGear {
    if (typeof g === 'number') return g < 0 ? 'R' : g === 0 ? 'N' : 'D'
    return (PRND as readonly string[]).includes(g) ? g : lastCarGear
  }

  // ── 按住类（桌面踏板 / 舵键 + 手机拇指键） ──
  function paintHolds() {
    const on = (id: HoldId) => held(id)
    w.cls(r.pedalGas, 'on', on('gas') || (ride !== 'boat' && kb.forward))
    w.cls(r.pedalBrake, 'on', on('brake') || (ride !== 'boat' && kb.back))
    const [port, fwd, back, stbd] = r.helmButtons
    w.cls(fwd, 'on', on('row') || kb.forward)
    w.cls(back, 'on', on('back') || kb.back)
    w.cls(port, 'on', on('port') || kb.left)
    w.cls(stbd, 'on', on('stbd') || kb.right)
    if (thumbs) {
      w.cls(thumbs.gas, 'on', on('gas')); w.cls(thumbs.brake, 'on', on('brake'))
      w.cls(thumbs.row, 'on', on('row')); w.cls(thumbs.back, 'on', on('back'))
      w.cls(thumbs.port, 'on', on('port')); w.cls(thumbs.stbd, 'on', on('stbd'))
    }
  }
  function resetHolds() {
    if (!holds.size && !kb.forward && !kb.back && !kb.left && !kb.right) return
    holds.clear(); kb.forward = kb.back = kb.left = kb.right = false
    paintHolds()
  }
  function bindHold(el: HTMLElement, id: HoldId) {
    el.addEventListener('pointerdown', (ev: PointerEvent) => {
      ev.preventDefault(); ev.stopPropagation()
      holds.set(ev.pointerId, id)
      try { el.setPointerCapture(ev.pointerId) } catch {}
      paintHolds()
    })
    const end = (ev: PointerEvent) => { if (holds.get(ev.pointerId) === id) { holds.delete(ev.pointerId); paintHolds() } }
    el.addEventListener('pointerup', end)
    el.addEventListener('pointercancel', end)
    el.addEventListener('lostpointercapture', end)
    el.addEventListener('click', (ev: Event) => ev.stopPropagation())
  }
  bindHold(r.pedalGas, 'gas'); bindHold(r.pedalBrake, 'brake')
  const [helmPort, helmFwd, helmBack, helmStbd] = r.helmButtons
  bindHold(helmFwd, 'row'); bindHold(helmBack, 'back'); bindHold(helmPort, 'port'); bindHold(helmStbd, 'stbd')
  if (thumbs) {
    bindHold(thumbs.gas, 'gas'); bindHold(thumbs.brake, 'brake')
    bindHold(thumbs.row, 'row'); bindHold(thumbs.back, 'back'); bindHold(thumbs.port, 'port'); bindHold(thumbs.stbd, 'stbd')
  }
  const winRelease = (ev: PointerEvent) => { if (holds.delete(ev.pointerId)) paintHolds() }
  win?.addEventListener('pointerup', winRelease)
  win?.addEventListener('pointercancel', winRelease)

  const tap = (el: HTMLElement, fn: (ev: Event) => void) => {
    el.addEventListener('pointerdown', (ev: Event) => ev.stopPropagation())
    el.addEventListener('click', (ev: Event) => { ev.stopPropagation(); fn(ev) })
  }
  tap(r.ignition, () => { if (ride === 'car') toggleIgnition('click') })
  for (const b of r.prndButtons) tap(b, () => { if (ride === 'car') selectCarGear(b.getAttribute('data-prnd') as CarGear, 'click') })
  tap(r.kickstand, () => { if ((ride === 'bike' || ride === 'bicycle') && body.getAttribute('data-ride-crash') !== '1') toggleKickstand('click') })
  tap(r.boatLight, () => { if (ride === 'boat' && !tourBoat) toggleBoatLight('click') })
  // 手刹（桌面 Space 指示）：按住走 walk 的 Space 逻辑不现实，这里只作指示，点一下给出键位提示
  tap(r.pedalHb, () => toast('按住空格拉手刹', 1400))

  // ── 外部接口 ──
  const onPatch = (ev: Event) => patch((ev as CustomEvent<VehicleExternalPatch>).detail)
  const onWarn = (ev: Event) => {
    const d = (ev as CustomEvent<{ms?: number; on?: boolean} | null>).detail
    if (d && d.on === false) { warnUntil = 0; if (ride === 'car') paintPrnd(lastCarGear); return }
    triggerNotInPWarn(d?.ms)
  }
  win?.addEventListener('glol:vehicle-ui:patch', onPatch)
  win?.addEventListener('glol:vehicle-ui:warn-p', onWarn)

  const api: VehicleControls = {
    refs: r,
    thumbs,
    writer: w,
    get engineOn() { return engineOn() },
    syncRide,
    syncCar,
    syncBoat,
    axes() {
      if (!holds.size) { axesOut.forward = 0; axesOut.right = 0; return axesOut }
      if (ride === 'car' || ride === 'bike' || ride === 'bicycle') { axesOut.forward = +held('gas') - +held('brake'); axesOut.right = 0; return axesOut }
      if (ride === 'boat' && !tourBoat) { axesOut.forward = +held('row') - +held('back'); axesOut.right = +held('stbd') - +held('port'); return axesOut }
      axesOut.forward = 0; axesOut.right = 0; return axesOut
    },
    gateForward(forward) {
      if (ride !== 'car' || carBoxActive || engineOn()) { engineBlockedPrev = false; return forward }
      const allowed = lastCarKmh > 1 && forward < 0 ? forward : 0
      const blocked = forward !== 0 && allowed === 0
      if (blocked && !engineBlockedPrev && now() - engineToastAt > ENGINE_OFF_TOAST_GAP_MS) {
        engineToastAt = now()
        toast('已熄火 · 按 K/I 或点火钮点火', 1800)
      }
      engineBlockedPrev = blocked
      return allowed
    },
    reflectKeys(forward, back, left, right) {
      if (!ride) return
      if (kb.forward === forward && kb.back === back && kb.left === left && kb.right === right) return
      kb.forward = forward; kb.back = back; kb.left = left; kb.right = right
      paintHolds()
    },
    resetHolds,
    consumePulses() {
      pulsesOut.kickstandToggle = pulses.kickstandToggle
      pulsesOut.ignitionToggle = pulses.ignitionToggle
      pulsesOut.carGearSelect = pulses.carGearSelect
      pulsesOut.boatLightToggle = pulses.boatLightToggle
      pulses.kickstandToggle = false; pulses.ignitionToggle = false; pulses.carGearSelect = null; pulses.boatLightToggle = false
      return pulsesOut
    },
    toggleIgnition,
    toggleKickstand,
    toggleBoatLight,
    selectCarGear,
    noteCarHorn,
    lightLocked: () => ride === 'bike' && sharedNow,
    isShared: () => ride === 'bike' && sharedNow,
    isTourBoat: () => ride === 'boat' && tourBoat,
    lockedPress,
    triggerNotInPWarn,
    patch,
    setHooks(h) { hooks = {...hooks, ...h} },
    getState() {
      return {
        ride, tier, engineOn: engineOn(), carGear: lastCarGear, notInPWarn: warnActive(), boatLightOn: boatLightOn(),
        lightLocked: ride === 'bike' && sharedNow, sharedCapKmh: sharedCap(), kickstandDown: kickDown,
      }
    },
    dispose() {
      win?.removeEventListener('glol:vehicle-ui:patch', onPatch)
      win?.removeEventListener('glol:vehicle-ui:warn-p', onWarn)
      win?.removeEventListener('pointerup', winRelease)
      win?.removeEventListener('pointercancel', winRelease)
      if (warnTimer && win) win.clearTimeout(warnTimer)
      warnTimer = 0
    },
  }
  if (win && opts.expose !== false) (win as Window & {__vehicleControls?: VehicleControls}).__vehicleControls = api
  return api
}
