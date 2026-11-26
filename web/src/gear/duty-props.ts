import * as T from 'three'
import {mainDetail} from '../look/mirror-layer.ts'
import type {AvatarRig} from '../walk/avatar-rig.ts'

export type DutyWhistleMode = 'chest' | 'mouth'
export type DutyFlagMode = 'stowed' | 'idle' | 'stop' | 'pass'
export type DutyPrinterMode = 'hidden' | 'holstered' | 'in_hand' | 'belt_printing'

export interface DutyPropsOptions {
  rig?: AvatarRig
  flagHand?: 'right' | 'left'
  initialFlagMode?: DutyFlagMode
  /** 默认 `true`：执勤期间口哨一直叼在嘴边，开罚单双手占着也能随时按 Q 吹哨。 */
  whistleAlwaysAtMouth?: boolean
}

export interface DutyPropsProbe {
  attached: boolean
  attachedToSkeleton: boolean
  whistleVisible: boolean
  flagVisible: boolean
  printerVisible: boolean
  holsterStrapVisible: boolean
  handSlipVisible: boolean
  whistleAlwaysAtMouth: boolean
  whistleMode: DutyWhistleMode
  blowBlend: number
  blowPulse: number
  flagMode: DutyFlagMode
  printerMode: DutyPrinterMode
  printProgress: number
  paperTornOff: boolean
  handSide: 'right' | 'left'
  whistleWorldPos: {x: number; y: number; z: number}
  chestWorldPos: {x: number; y: number; z: number}
  mouthWorldPos: {x: number; y: number; z: number}
  flagWorldPos: {x: number; y: number; z: number}
  printerWorldPos: {x: number; y: number; z: number}
  whistleToMouthDist: number
  whistleToChestDist: number
}

export interface DutyPropsHandle {
  whistleGroup: T.Group
  flagGroup: T.Group
  holsterGroup: T.Group
  printerGroup: T.Group
  handSlipGroup: T.Group
  setVisible: (visible: boolean) => void
  setWhistleVisible: (visible: boolean) => void
  setFlagVisible: (visible: boolean) => void
  setPrinterVisible: (visible: boolean) => void
  setWhistleAlwaysAtMouth: (alwaysAtMouth: boolean) => void
  setWhistleBlowing: (blowing: boolean, instant?: boolean) => void
  triggerWhistlePulse: () => void
  setFlagMode: (mode: DutyFlagMode) => void
  setPrinterMode: (mode: DutyPrinterMode) => void
  setPrintProgress: (progress: number) => void
  /** 扯下凭条；side 指定拿凭条的手（就近递单那只），不传就用执勤主手。 */
  tearOffSlip: (side?: 'left' | 'right') => void
  clearHandSlip: () => void
  isFlagSuppressedByTicket: () => boolean
  syncFromEmoteId: (emoteId: number, instant?: boolean) => void
  update: (dt: number) => void
  getProbe: () => DutyPropsProbe
  dispose: () => void
}

function makePropMaterial(
  color: number,
  options?: {roughness?: number; metalness?: number; emissive?: number; emissiveIntensity?: number; side?: T.Side},
): T.MeshStandardMaterial {
  return new T.MeshStandardMaterial({
    color,
    roughness: options?.roughness ?? 0.42,
    metalness: Math.min(0.26, options?.metalness ?? 0.16),
    emissive: new T.Color(options?.emissive ?? color),
    emissiveIntensity: options?.emissiveIntensity ?? 0.24,
    side: options?.side ?? T.FrontSide,
  })
}

function makeRoundedRectShape(width: number, height: number, radius: number): T.Shape {
  const hw = width * 0.5
  const hh = height * 0.5
  const r = Math.min(radius, hw * 0.9, hh * 0.9)
  const s = new T.Shape()
  s.moveTo(-hw + r, -hh)
  s.lineTo(hw - r, -hh)
  s.quadraticCurveTo(hw, -hh, hw, -hh + r)
  s.lineTo(hw, hh - r)
  s.quadraticCurveTo(hw, hh, hw - r, hh)
  s.lineTo(-hw + r, hh)
  s.quadraticCurveTo(-hw, hh, -hw, hh - r)
  s.lineTo(-hw, -hh + r)
  s.quadraticCurveTo(-hw, -hh, -hw + r, -hh)
  return s
}

function makeRoundedExtrude(
  width: number,
  height: number,
  depth: number,
  radius: number,
  bevel = 0.0025,
): T.ExtrudeGeometry {
  const geo = new T.ExtrudeGeometry(makeRoundedRectShape(width - bevel * 2, height - bevel * 2, Math.max(0.002, radius - bevel)), {
    depth: Math.max(0.002, depth - bevel * 2),
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 8,
  })
  geo.center()
  return geo
}

function buildMouthAndCollarWhistle(): {
  lanyardGroup: T.Group
  whistleGroup: T.Group
  chamberMat: T.MeshStandardMaterial
  geometries: T.BufferGeometry[]
  materials: T.Material[]
} {
  const geometries: T.BufferGeometry[] = []
  const materials: T.Material[] = []

  const track = <G extends T.BufferGeometry>(g: G): G => {
    geometries.push(g)
    return g
  }
  const trackMat = <M extends T.Material>(m: M): M => {
    materials.push(m)
    return m
  }

  const lanyardMat = trackMat(makePropMaterial(0x1f3a60, {roughness: 0.72, metalness: 0.04, emissiveIntensity: 0.14}))
  const silverMat = trackMat(makePropMaterial(0xdbe2ea, {roughness: 0.24, metalness: 0.26, emissive: 0xcbd5e1, emissiveIntensity: 0.28}))
  const darkSlotMat = trackMat(makePropMaterial(0x1b2430, {roughness: 0.55, metalness: 0.1, emissiveIntensity: 0.08}))
  const ringMat = trackMat(makePropMaterial(0xeab308, {roughness: 0.28, metalness: 0.24, emissive: 0xd97706, emissiveIntensity: 0.26}))

  const lanyardGroup = new T.Group()
  lanyardGroup.name = 'duty_whistle_lanyard'

  const collarGeo = track(new T.TorusGeometry(0.082, 0.0055, 6, 18))
  const collar = new T.Mesh(collarGeo, lanyardMat)
  collar.rotation.set(Math.PI * 0.42, 0, 0)
  collar.position.set(0, 0.14, -0.025)
  collar.name = 'whistle_lanyard_collar'
  lanyardGroup.add(collar)

  const whistleGroup = new T.Group()
  whistleGroup.name = 'duty_whistle_body'

  const chamberGeo = track(new T.CylinderGeometry(0.014, 0.014, 0.024, 12))
  const chamber = new T.Mesh(chamberGeo, silverMat)
  chamber.rotation.z = Math.PI * 0.5
  chamber.name = 'whistle_chamber'

  const mouthpieceGeo = track(new T.BoxGeometry(0.015, 0.011, 0.028))
  const mouthpiece = new T.Mesh(mouthpieceGeo, silverMat)
  mouthpiece.position.set(0, 0.003, 0.019)
  mouthpiece.name = 'whistle_mouthpiece'

  const slitGeo = track(new T.BoxGeometry(0.013, 0.004, 0.01))
  const slit = new T.Mesh(slitGeo, darkSlotMat)
  slit.position.set(0, 0.012, 0.004)
  slit.name = 'whistle_slit'

  const splitRingGeo = track(new T.TorusGeometry(0.0085, 0.0022, 6, 12))
  const splitRing = new T.Mesh(splitRingGeo, ringMat)
  splitRing.position.set(0, 0.008, -0.015)
  splitRing.rotation.y = Math.PI * 0.5

  const cordGeo = track(new T.CylinderGeometry(0.003, 0.003, 0.036, 6))
  const cord = new T.Mesh(cordGeo, lanyardMat)
  cord.position.set(0, -0.022, -0.012)

  whistleGroup.add(chamber, mouthpiece, slit, splitRing, cord)
  return {lanyardGroup, whistleGroup, chamberMat: silverMat, geometries, materials}
}

function buildCommandFlag(): {
  flagGroup: T.Group
  clothPivot: T.Group
  geometries: T.BufferGeometry[]
  materials: T.Material[]
} {
  const geometries: T.BufferGeometry[] = []
  const materials: T.Material[] = []
  const track = <G extends T.BufferGeometry>(g: G): G => {
    geometries.push(g)
    return g
  }
  const trackMat = <M extends T.Material>(m: M): M => {
    materials.push(m)
    return m
  }

  const gripMat = trackMat(makePropMaterial(0x1f2937, {roughness: 0.76, metalness: 0.05, emissiveIntensity: 0.1}))
  const poleMat = trackMat(makePropMaterial(0xe2e8f0, {roughness: 0.28, metalness: 0.24, emissiveIntensity: 0.22}))
  const tipMat = trackMat(makePropMaterial(0xf59e0b, {roughness: 0.3, metalness: 0.22, emissive: 0xd97706, emissiveIntensity: 0.28}))
  const redClothMat = trackMat(
    makePropMaterial(0xef4444, {roughness: 0.64, metalness: 0.02, emissive: 0xb91c1c, emissiveIntensity: 0.28, side: T.DoubleSide}),
  )
  const stripeMat = trackMat(
    makePropMaterial(0xfacc15, {roughness: 0.58, metalness: 0.04, emissive: 0xeab308, emissiveIntensity: 0.32, side: T.DoubleSide}),
  )

  const flagGroup = new T.Group()
  flagGroup.name = 'duty_command_flag'

  const poleLen = 0.44
  const gripGeo = track(new T.CylinderGeometry(0.014, 0.015, 0.115, 10))
  const grip = new T.Mesh(gripGeo, gripMat)
  grip.rotation.x = Math.PI * 0.5
  grip.position.set(0, 0, -0.025)
  grip.name = 'flag_grip'

  const shaftGeo = track(new T.CylinderGeometry(0.0085, 0.0095, poleLen, 10))
  const shaft = new T.Mesh(shaftGeo, poleMat)
  shaft.rotation.x = Math.PI * 0.5
  shaft.position.set(0, 0, -poleLen * 0.5 - 0.02)
  shaft.name = 'flag_shaft'

  const capGeo = track(new T.SphereGeometry(0.013, 10, 8))
  const cap = new T.Mesh(capGeo, tipMat)
  cap.position.set(0, 0, -poleLen - 0.02)
  cap.name = 'flag_finial'

  const clothPivot = new T.Group()
  clothPivot.name = 'flag_cloth_pivot'
  clothPivot.position.set(0, 0, -poleLen + 0.085)

  const pennantShape = new T.Shape([
    new T.Vector2(0, 0.095),
    new T.Vector2(0.24, 0.045),
    new T.Vector2(0.24, -0.045),
    new T.Vector2(0, -0.095),
  ])
  const clothGeo = track(new T.ShapeGeometry(pennantShape, 2))
  const cloth = new T.Mesh(clothGeo, redClothMat)
  cloth.rotation.set(0, Math.PI * 0.5, -Math.PI * 0.5)
  cloth.position.set(0, -0.006, 0.015)
  cloth.name = 'flag_cloth_main'

  const stripeGeo = track(new T.PlaneGeometry(0.18, 0.032))
  const stripe = new T.Mesh(stripeGeo, stripeMat)
  stripe.position.set(0.002, -0.115, 0.015)
  stripe.rotation.set(0, Math.PI * 0.5, 0)
  stripe.name = 'flag_reflective_stripe'

  clothPivot.add(cloth, stripe)
  flagGroup.add(grip, shaft, cap, clothPivot)

  return {flagGroup, clothPivot, geometries, materials}
}

/**
 * 重做圆角便携热敏打印机 + 腰侧半包皮套 + 皮质扣带与黄铜按扣：
 * - 圆角倒角机身、防滑侧翼、背光屏幕与香槟金外框、下凹出纸口、锯齿撕纸刀、真皮扣带皮套。
 */
interface BoxSpec {
  w: number
  h: number
  d: number
  x: number
  y: number
  z: number
}

/** 把一堆小方块并成一个 BufferGeometry（键盘按键、扣带这类零件一次 draw call）。 */
function mergeBoxes(specs: readonly BoxSpec[]): T.BufferGeometry {
  const pos: number[] = []
  const nor: number[] = []
  const uv: number[] = []
  for (const b of specs) {
    const g = new T.BoxGeometry(b.w, b.h, b.d).toNonIndexed()
    g.translate(b.x, b.y, b.z)
    pos.push(...Array.from(g.getAttribute('position').array as ArrayLike<number>))
    nor.push(...Array.from(g.getAttribute('normal').array as ArrayLike<number>))
    uv.push(...Array.from(g.getAttribute('uv').array as ArrayLike<number>))
    g.dispose()
  }
  const out = new T.BufferGeometry()
  out.setAttribute('position', new T.Float32BufferAttribute(pos, 3))
  out.setAttribute('normal', new T.Float32BufferAttribute(nor, 3))
  out.setAttribute('uv', new T.Float32BufferAttribute(uv, 2))
  out.computeBoundingSphere()
  return out
}

/** 平面小矩形批（凭条上的字行、二维码模块、屏幕 UI 条），朝 +Z，一次 draw call。 */
function quadBatch(rects: ReadonlyArray<readonly [number, number, number, number]>, z: number): T.BufferGeometry {
  const pos: number[] = []
  const nor: number[] = []
  const uv: number[] = []
  for (const [cx, cy, w, h] of rects) {
    const x0 = cx - w / 2
    const x1 = cx + w / 2
    const y0 = cy - h / 2
    const y1 = cy + h / 2
    pos.push(x0, y0, z, x1, y0, z, x1, y1, z, x0, y0, z, x1, y1, z, x0, y1, z)
    for (let i = 0; i < 6; i++) nor.push(0, 0, 1)
    uv.push(0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1)
  }
  const out = new T.BufferGeometry()
  out.setAttribute('position', new T.Float32BufferAttribute(pos, 3))
  out.setAttribute('normal', new T.Float32BufferAttribute(nor, 3))
  out.setAttribute('uv', new T.Float32BufferAttribute(uv, 2))
  out.computeBoundingSphere()
  return out
}

/** 热敏纸外形：上下两端是撕纸刀留下的锯齿口。 */
function serratedSlipShape(width: number, height: number, teeth: number, toothDepth: number): T.Shape {
  const hw = width / 2
  const hh = height / 2
  const s = new T.Shape()
  s.moveTo(-hw, -hh + toothDepth)
  for (let i = 0; i < teeth; i++) {
    const x0 = -hw + (width * i) / teeth
    const x1 = -hw + (width * (i + 1)) / teeth
    s.lineTo((x0 + x1) / 2, -hh)
    s.lineTo(x1, -hh + toothDepth)
  }
  s.lineTo(hw, hh - toothDepth)
  for (let i = teeth - 1; i >= 0; i--) {
    const x0 = -hw + (width * i) / teeth
    const x1 = -hw + (width * (i + 1)) / teeth
    s.lineTo((x0 + x1) / 2, hh)
    s.lineTo(x0, hh - toothDepth)
  }
  s.closePath()
  return s
}

/** 撕纸刀：一排三角齿，齿尖朝上。 */
function serratedCutterGeometry(width: number, teeth: number, toothH: number, baseH: number, depth: number): T.ExtrudeGeometry {
  const hw = width / 2
  const s = new T.Shape()
  s.moveTo(-hw, -baseH)
  s.lineTo(hw, -baseH)
  s.lineTo(hw, 0)
  for (let i = teeth - 1; i >= 0; i--) {
    const x0 = -hw + (width * i) / teeth
    const x1 = -hw + (width * (i + 1)) / teeth
    s.lineTo((x0 + x1) / 2, toothH)
    s.lineTo(x0, 0)
  }
  s.closePath()
  const g = new T.ExtrudeGeometry(s, {depth, bevelEnabled: false})
  g.translate(0, 0, -depth / 2)
  return g
}

/** 虚构的二维码图案（固定种子，三个定位角），纯装饰，不编码任何真实信息。 */
function fakeQrRects(size: number, cx: number, cy: number, seed: number): Array<[number, number, number, number]> {
  const n = 21
  const m = size / n
  const rects: Array<[number, number, number, number]> = []
  let st = seed >>> 0
  const rnd = () => {
    st = (Math.imul(st, 1664525) + 1013904223) >>> 0
    return st / 4294967296
  }
  const finder = (fx: number, fy: number, x: number, y: number) => {
    const dx = x - fx
    const dy = y - fy
    if (dx < 0 || dy < 0 || dx > 6 || dy > 6) return -1
    const ring = Math.min(dx, dy, 6 - dx, 6 - dy)
    return ring === 1 ? 0 : 1
  }
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let on = -1
      for (const [fx, fy] of [[0, 0], [14, 0], [0, 14]] as const) {
        const f = finder(fx, fy, x, y)
        if (f >= 0) on = f
      }
      const sep = (x === 7 && y <= 7) || (y === 7 && x <= 7) || (x === 13 && y <= 7) || (y === 7 && x >= 13) || (x === 7 && y >= 13) || (y === 13 && x <= 7)
      if (on < 0) on = sep ? 0 : rnd() < 0.47 ? 1 : 0
      if (on) rects.push([cx - size / 2 + (x + 0.5) * m, cy + size / 2 - (y + 0.5) * m, m * 1.02, m * 1.02])
    }
  }
  return rects
}

/** 打印机出纸口在打印机局部坐标里的位置（ticket-handover 扯单时手要伸到这里）。 */
export const DUTY_PRINTER_SLOT_LOCAL = Object.freeze({x: 0, y: 0.079, z: 0.004})

/**
 * 腰挂快拔套在骨盆挂点（角色空间：-Z 朝前、+X 朝右）里的位置和朝向：
 * 挂在右胯前侧皮带上，屏幕朝前偏外，伸手一低头就能看见。
 */
const HOLSTER_LOCAL_POS = new T.Vector3(0.17, 0.03, -0.055)
const HOLSTER_LOCAL_ROT = new T.Euler(0.04, Math.PI - 0.9, -0.04)

function buildBeltAndHandPrinter(): {
  holsterGroup: T.Group
  strapPivot: T.Group
  printerGroup: T.Group
  ejectPaperMesh: T.Mesh
  handSlipGroup: T.Group
  paperSlotAnchor: T.Object3D
  geometries: T.BufferGeometry[]
  materials: T.Material[]
} {
  const geometries: T.BufferGeometry[] = []
  const materials: T.Material[] = []
  const track = <G extends T.BufferGeometry>(g: G): G => {
    geometries.push(g)
    return g
  }
  const trackMat = <M extends T.Material>(m: M): M => {
    materials.push(m)
    return m
  }
  const mesh = (geo: T.BufferGeometry, mat: T.Material, name: string, x = 0, y = 0, z = 0): T.Mesh => {
    const m = new T.Mesh(track(geo), mat)
    m.name = name
    m.position.set(x, y, z)
    return m
  }

  // 警用蓝白涂装 + 黑橡胶护角
  const blueMat = trackMat(makePropMaterial(0x1f4fa8, {roughness: 0.34, metalness: 0.18, emissive: 0x16388a, emissiveIntensity: 0.34}))
  const whiteMat = trackMat(makePropMaterial(0xeef2f7, {roughness: 0.4, metalness: 0.1, emissive: 0xcfd8e3, emissiveIntensity: 0.22}))
  const rubberMat = trackMat(makePropMaterial(0x24282f, {roughness: 0.86, metalness: 0.02, emissive: 0x15181d, emissiveIntensity: 0.2}))
  const reflectMat = trackMat(makePropMaterial(0xe4e9ef, {roughness: 0.22, metalness: 0.26, emissive: 0xffffff, emissiveIntensity: 0.42}))
  const bezelMat = trackMat(makePropMaterial(0x0e1218, {roughness: 0.3, metalness: 0.12, emissiveIntensity: 0.1}))
  const lcdMat = trackMat(makePropMaterial(0xa9d8ff, {roughness: 0.16, metalness: 0.04, emissive: 0x5cb2ff, emissiveIntensity: 0.78}))
  const lcdInkMat = trackMat(makePropMaterial(0x0d2f57, {roughness: 0.3, metalness: 0.02, emissive: 0x0d2f57, emissiveIntensity: 0.3}))
  const keyMat = trackMat(makePropMaterial(0x343b46, {roughness: 0.6, metalness: 0.06, emissiveIntensity: 0.2}))
  const okKeyMat = trackMat(makePropMaterial(0x2fae68, {roughness: 0.42, metalness: 0.06, emissive: 0x1f8a4e, emissiveIntensity: 0.4}))
  const noKeyMat = trackMat(makePropMaterial(0xd5463e, {roughness: 0.42, metalness: 0.06, emissive: 0xa92f28, emissiveIntensity: 0.4}))
  const slotDarkMat = trackMat(makePropMaterial(0x07090c, {roughness: 0.9, metalness: 0.02, emissiveIntensity: 0.03}))
  const steelMat = trackMat(makePropMaterial(0xc3cad3, {roughness: 0.2, metalness: 0.26, emissive: 0x8d97a3, emissiveIntensity: 0.4}))
  const ledMat = trackMat(makePropMaterial(0x52d68a, {roughness: 0.22, metalness: 0.05, emissive: 0x34d399, emissiveIntensity: 0.9}))
  const nylonMat = trackMat(makePropMaterial(0x171a1f, {roughness: 0.92, metalness: 0.02, emissive: 0x0f1115, emissiveIntensity: 0.22}))
  const webbingMat = trackMat(makePropMaterial(0x262b33, {roughness: 0.84, metalness: 0.02, emissive: 0x181b20, emissiveIntensity: 0.22}))
  const paperMat = trackMat(makePropMaterial(0xfbfaf3, {roughness: 0.78, metalness: 0.02, emissiveIntensity: 0.26, side: T.DoubleSide}))
  const inkMat = trackMat(makePropMaterial(0x1a1e24, {roughness: 0.7, metalness: 0.02, emissiveIntensity: 0.05, side: T.DoubleSide}))
  const headerInkMat = trackMat(makePropMaterial(0x1f4fa8, {roughness: 0.6, metalness: 0.02, emissiveIntensity: 0.3, side: T.DoubleSide}))

  // ——— 1) 腰挂快拔套：黑尼龙背板 + 底托 + 两侧护条 + 横跨正面的魔术贴扣带（金属按扣），正面敞开露出屏幕 ———
  const holsterGroup = new T.Group()
  holsterGroup.name = 'duty_printer_belt_holster'
  holsterGroup.add(mesh(makeRoundedExtrude(0.09, 0.116, 0.008, 0.012, 0.002), nylonMat, 'holster_leather_pouch', 0, -0.012, -0.022))
  holsterGroup.add(mesh(makeRoundedExtrude(0.094, 0.026, 0.046, 0.01, 0.003), nylonMat, 'holster_bottom_cup', 0, -0.07, -0.002))
  holsterGroup.add(
    mesh(
      mergeBoxes([
        {w: 0.007, h: 0.084, d: 0.04, x: -0.047, y: -0.03, z: -0.004},
        {w: 0.007, h: 0.084, d: 0.04, x: 0.047, y: -0.03, z: -0.004},
        // 尼龙缝线压边（浅一点的织带色）
        {w: 0.092, h: 0.004, d: 0.047, x: 0, y: -0.057, z: -0.002},
      ]),
      webbingMat,
      'holster_side_rails',
    ),
  )
  holsterGroup.add(mesh(makeRoundedExtrude(0.04, 0.084, 0.012, 0.006, 0.0015), webbingMat, 'holster_belt_loop', 0, 0.004, -0.032))

  const strapPivot = new T.Group()
  strapPivot.name = 'holster_strap_pivot'
  strapPivot.position.set(0, 0.07, -0.024)
  strapPivot.add(
    mesh(
      mergeBoxes([
        {w: 0.098, h: 0.013, d: 0.003, x: 0, y: 0, z: 0.044},
        {w: 0.003, h: 0.013, d: 0.046, x: -0.0485, y: 0, z: 0.021},
        {w: 0.003, h: 0.013, d: 0.046, x: 0.0485, y: 0, z: 0.021},
      ]),
      webbingMat,
      'holster_retaining_strap',
    ),
  )
  const snap = mesh(new T.CylinderGeometry(0.0055, 0.0055, 0.0035, 14), steelMat, 'holster_brass_snap', 0, 0, 0.0465)
  snap.rotation.x = Math.PI * 0.5
  strapPivot.add(snap)
  holsterGroup.add(strapPivot)

  // ——— 2) 便携热敏打印机：蓝色主壳 + 白色面板 + 四角橡胶护角 ———
  const printerGroup = new T.Group()
  printerGroup.name = 'duty_portable_printer'
  printerGroup.add(mesh(makeRoundedExtrude(0.08, 0.146, 0.03, 0.014, 0.0035), blueMat, 'printer_chassis'))
  // 白色顶盖（纸仓）+ 白色下面板
  printerGroup.add(mesh(makeRoundedExtrude(0.078, 0.028, 0.034, 0.01, 0.003), whiteMat, 'printer_thermal_hood', 0, 0.061, 0))
  printerGroup.add(mesh(makeRoundedExtrude(0.066, 0.062, 0.003, 0.008, 0.001), whiteMat, 'printer_white_faceplate', 0, -0.038, 0.0158))
  // 横贯机身的银色反光腰线（蓝白分界）
  printerGroup.add(mesh(new T.BoxGeometry(0.0815, 0.0055, 0.0315), reflectMat, 'printer_reflective_band', 0, -0.0035, 0))
  // 四角橡胶护角 + 两侧防滑握条
  const bumperGeo = makeRoundedExtrude(0.019, 0.026, 0.037, 0.007, 0.002)
  const bumpers = new T.Group()
  bumpers.name = 'printer_bumpers'
  geometries.push(bumperGeo)
  for (const [bx, by] of [[-0.033, 0.063], [0.033, 0.063], [-0.033, -0.063], [0.033, -0.063]] as const) {
    const b = new T.Mesh(bumperGeo, rubberMat)
    b.name = `printer_bumper_${by > 0 ? 't' : 'b'}${bx > 0 ? 'r' : 'l'}`
    b.position.set(bx, by, 0)
    bumpers.add(b)
  }
  printerGroup.add(bumpers)
  const gripGeo = makeRoundedExtrude(0.006, 0.084, 0.026, 0.0025, 0.001)
  geometries.push(gripGeo)
  const gripL = new T.Mesh(gripGeo, rubberMat)
  gripL.name = 'printer_grip_left'
  gripL.position.set(-0.0405, -0.002, 0)
  const gripR = new T.Mesh(gripGeo, rubberMat)
  gripR.name = 'printer_grip_right'
  gripR.position.set(0.0405, -0.002, 0)
  printerGroup.add(gripL, gripR)

  // 出纸口：黑色窄缝 + 不锈钢锯齿撕纸刀 + 露出一截的纸舌
  printerGroup.add(mesh(new T.BoxGeometry(0.06, 0.0042, 0.0085), slotDarkMat, 'printer_paper_slot', 0, 0.0755, 0.004))
  printerGroup.add(mesh(serratedCutterGeometry(0.062, 16, 0.0028, 0.0022, 0.0016), steelMat, 'printer_serrated_cutter', 0, 0.0768, 0.0092))
  const paperTongue = mesh(new T.BoxGeometry(0.054, 0.006, 0.0007), paperMat, 'printer_paper_tongue', 0, 0.0785, 0.0045)
  printerGroup.add(paperTongue)
  const paperSlotAnchor = new T.Object3D()
  paperSlotAnchor.name = 'printer_paper_slot_anchor'
  paperSlotAnchor.position.set(DUTY_PRINTER_SLOT_LOCAL.x, DUTY_PRINTER_SLOT_LOCAL.y, DUTY_PRINTER_SLOT_LOCAL.z)
  printerGroup.add(paperSlotAnchor)

  // 状态灯
  printerGroup.add(mesh(new T.SphereGeometry(0.0028, 8, 6), ledMat, 'printer_status_led', 0.027, 0.0605, 0.0172))

  // 屏幕：黑边框 + 背光 LCD + 屏上 UI 条（标题栏、金额行、进度条）
  printerGroup.add(mesh(makeRoundedExtrude(0.066, 0.05, 0.003, 0.006, 0.001), bezelMat, 'printer_screen_bezel', 0, 0.0225, 0.0158))
  printerGroup.add(mesh(new T.PlaneGeometry(0.056, 0.04), lcdMat, 'printer_lcd_face', 0, 0.0225, 0.0183))
  printerGroup.add(
    mesh(
      quadBatch(
        [
          [0, 0.0175, 0.056, 0.007],
          [-0.012, 0.007, 0.026, 0.003],
          [-0.012, 0.001, 0.02, 0.003],
          [0.016, 0.004, 0.014, 0.008],
          [-0.006, -0.008, 0.038, 0.0025],
          [-0.006, -0.0135, 0.03, 0.0025],
        ],
        0,
      ),
      lcdInkMat,
      'printer_lcd_ui',
      0,
      0.0225,
      0.0185,
    ),
  )

  // 键盘：绿色确认键 + 红色取消键 + 3×3 数字键
  const keyBoxes: BoxSpec[] = []
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      keyBoxes.push({w: 0.0135, h: 0.0075, d: 0.003, x: (c - 1) * 0.0185, y: -0.0345 - r * 0.0115, z: 0.0182})
    }
  }
  printerGroup.add(mesh(mergeBoxes(keyBoxes), keyMat, 'printer_keypad'))
  printerGroup.add(mesh(makeRoundedExtrude(0.022, 0.009, 0.0035, 0.0035, 0.001), okKeyMat, 'printer_confirm_key', 0.016, -0.0175, 0.0181))
  printerGroup.add(mesh(makeRoundedExtrude(0.022, 0.009, 0.0035, 0.0035, 0.001), noKeyMat, 'printer_cancel_key', -0.016, -0.0175, 0.0181))

  // 背夹（不锈钢弹簧夹）
  printerGroup.add(
    mesh(
      mergeBoxes([
        {w: 0.026, h: 0.064, d: 0.0025, x: 0, y: 0.008, z: -0.0185},
        {w: 0.026, h: 0.004, d: 0.008, x: 0, y: 0.04, z: -0.0155},
      ]),
      steelMat,
      'printer_belt_clip',
    ),
  )

  // 正在出纸的那一截（长度由 printProgress 拉伸）
  const ejectPaperMesh = new T.Mesh(track(new T.BoxGeometry(0.054, 1.0, 0.0008)), paperMat)
  ejectPaperMesh.name = 'printer_ejecting_paper'
  ejectPaperMesh.visible = false
  printerGroup.add(ejectPaperMesh)

  // ——— 3) 扯下来的热敏凭条：两端锯齿撕口 + 蓝色抬头 + 字行 + 金额 + 虚构编号条码 + 虚构二维码 ———
  const handSlipGroup = new T.Group()
  handSlipGroup.name = 'duty_torn_receipt_slip'
  const slipW = 0.056
  const slipH = 0.12
  const slipSheet = new T.Mesh(track(new T.ShapeGeometry(serratedSlipShape(slipW, slipH, 14, 0.0022))), paperMat)
  slipSheet.position.set(0, 0.012, -0.036)
  slipSheet.rotation.set(-0.44, 0.08, 0)
  slipSheet.name = 'torn_receipt_sheet'

  const header = new T.Mesh(track(quadBatch([[0, 0.049, 0.048, 0.008]], 0.0004)), headerInkMat)
  header.name = 'torn_receipt_header'
  slipSheet.add(header)

  const lines: Array<[number, number, number, number]> = []
  // 虚构单号（细竖条当条码）
  let seed = 0x5a17
  for (let i = 0; i < 26; i++) {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0
    const bw = 0.0005 + ((seed >>> 16) % 3) * 0.0004
    lines.push([-0.022 + i * 0.00125, 0.038, bw, 0.006])
  }
  // 字行（左对齐，长短不一）
  const rows: Array<[number, number]> = [
    [0.03, 0.03],
    [0.025, 0.036],
    [0.02, 0.026],
    [0.015, 0.034],
    [0.009, 0.03],
    [0.004, 0.022],
  ]
  for (const [y, w] of rows) lines.push([-0.024 + w / 2, y, w, 0.0018])
  // 合计行（粗）
  lines.push([-0.012, -0.004, 0.024, 0.0042])
  lines.push([0.016, -0.004, 0.014, 0.0048])
  // 分隔虚线
  for (let i = 0; i < 12; i++) lines.push([-0.0225 + i * 0.0041, -0.0105, 0.0024, 0.0007])
  // 虚构二维码 + 右侧说明短行
  lines.push(...fakeQrRects(0.026, -0.011, -0.028, 0x2f7a))
  lines.push([0.013, -0.019, 0.016, 0.0016], [0.012, -0.024, 0.014, 0.0016], [0.013, -0.029, 0.016, 0.0016], [0.011, -0.034, 0.012, 0.0016])
  const ink = new T.Mesh(track(quadBatch(lines, 0.0004)), inkMat)
  ink.name = 'torn_receipt_qr_mark'
  slipSheet.add(ink)

  handSlipGroup.add(slipSheet)
  handSlipGroup.visible = false

  return {holsterGroup, strapPivot, printerGroup, ejectPaperMesh, handSlipGroup, paperSlotAnchor, geometries, materials}
}

export function createDutyProps(target: T.Object3D, options?: DutyPropsOptions): DutyPropsHandle {
  const rig =
    options?.rig ??
    (target.userData.avatarRig as AvatarRig | undefined)

  const handSide = options?.flagHand ?? 'right'
  const handBoneName = handSide === 'left' ? 'hand_l' : 'hand_r'
  const torsoAnchor = rig?.attachmentAt?.('spine_03') ?? rig?.attachments.torso ?? target.getObjectByName('spine_03') ?? target
  const waistAnchor =
    rig?.attachmentAt?.('pelvis') ??
    rig?.attachmentAt?.('spine_01') ??
    target.getObjectByName('pelvis') ??
    target.getObjectByName('spine_01') ??
    torsoAnchor
  const headAnchor = rig?.attachments.head ?? rig?.attachmentAt?.('head') ?? target.getObjectByName('head') ?? target
  const resolveHandAnchor = (boneName: 'hand_l' | 'hand_r'): T.Object3D | undefined =>
    rig?.attachmentAt?.(boneName) ?? target.getObjectByName(`attach_${boneName}`) ?? target.getObjectByName(boneName) ?? undefined
  const handAnchor = resolveHandAnchor(handBoneName) ?? rig?.attachmentAt?.('hand_r') ?? target
  const attachedToSkeleton = Boolean((rig?.isSkinned || target.getObjectByProperty('isSkinnedMesh', true)) && torsoAnchor !== target && headAnchor !== target)

  const whistleAssets = buildMouthAndCollarWhistle()
  const flagAssets = buildCommandFlag()
  const printerAssets = buildBeltAndHandPrinter()

  const {lanyardGroup, whistleGroup, chamberMat} = whistleAssets
  const {flagGroup, clothPivot} = flagAssets
  const {holsterGroup, strapPivot, printerGroup, ejectPaperMesh, handSlipGroup} = printerAssets
  const slipSheet = handSlipGroup.getObjectByName('torn_receipt_sheet')!
  const slipRotY = slipSheet.rotation.y
  const slipRestPos = slipSheet.position.clone()
  const slipRestRot = slipSheet.rotation.clone()
  const _pa = new T.Vector3()
  const _pb = new T.Vector3()
  const _pc = new T.Vector3()
  const _pd = new T.Vector3()
  const _pm = new T.Matrix4()
  const _pq = new T.Quaternion()

  /**
   * 把凭条捏在拇指和食指之间：长边顺着手掌朝指尖伸出去一截，纸面朝外斜 40°，侧面和背后机位都能看到纸。
   * 依赖真骨骼的手指（thumb_03 / index_02 / middle_01 / pinky_01）；没有就返回 false。
   */
  function placeSlipInPinch(anchor: T.Object3D, side: 'left' | 'right'): boolean {
    const k = side === 'left' ? 'l' : 'r'
    const hand = target.getObjectByName(`hand_${k}`)
    const thumb = target.getObjectByName(`thumb_03_${k}`)
    const index = target.getObjectByName(`index_02_${k}`)
    const middle = target.getObjectByName(`middle_01_${k}`)
    const pinky = target.getObjectByName(`pinky_01_${k}`)
    if (!hand || !thumb || !index || !middle || !pinky) return false
    target.updateWorldMatrix(true, true)
    const handP = hand.getWorldPosition(new T.Vector3())
    const dir = middle.getWorldPosition(_pa).sub(handP)
    if (dir.lengthSq() < 1e-8) return false
    dir.normalize()
    const across = index.getWorldPosition(_pb).sub(pinky.getWorldPosition(_pc))
    across.addScaledVector(dir, -across.dot(dir))
    if (across.lengthSq() < 1e-8) return false
    across.normalize()
    const palmN = _pd.crossVectors(across, dir).normalize()
    // 纸面法线：掌面法线朝食指侧斜 40°
    const n = palmN.multiplyScalar(Math.cos(0.7)).addScaledVector(across, Math.sin(0.7)).normalize()
    const xAxis = new T.Vector3().crossVectors(dir, n).normalize()
    _pm.makeBasis(xAxis, dir, n)
    // 捏点：拇指尖与食指中节之间，和掌心握点（腕 + 8cm，与 ticket-handover 的握点一致）取中，
    // 纸从指间往外伸：递单时纸的根部正好落在对方手里
    const pinch = thumb.getWorldPosition(new T.Vector3()).add(index.getWorldPosition(_pb)).multiplyScalar(0.5)
    const palmGrip = handP.clone().addScaledVector(dir, 0.08)
    const center = pinch.lerp(palmGrip, 0.5).addScaledVector(dir, 0.03)
    anchor.updateWorldMatrix(true, false)
    handSlipGroup.position.set(0, 0, 0)
    handSlipGroup.quaternion.identity()
    handSlipGroup.scale.set(1, 1, 1)
    slipSheet.position.copy(anchor.worldToLocal(center))
    _pq.setFromRotationMatrix(_pm)
    slipSheet.quaternion.copy(anchor.getWorldQuaternion(new T.Quaternion()).invert().multiply(_pq))
    return true
  }
  let slipSide: 'left' | 'right' = handSide

  mainDetail(lanyardGroup)
  mainDetail(whistleGroup)
  mainDetail(flagGroup)
  mainDetail(holsterGroup)
  mainDetail(printerGroup)
  mainDetail(handSlipGroup)

  torsoAnchor.add(lanyardGroup, whistleGroup)
  handAnchor.add(flagGroup, handSlipGroup)
  waistAnchor.add(holsterGroup, printerGroup)

  holsterGroup.position.copy(HOLSTER_LOCAL_POS)
  holsterGroup.rotation.copy(HOLSTER_LOCAL_ROT)

  let whistleVisible = true
  let flagVisible = true
  let printerVisible = true
  let whistleAlwaysAtMouth = options?.whistleAlwaysAtMouth ?? true
  let whistleBlowing = false
  let blowBlend = whistleAlwaysAtMouth ? 1 : 0
  let blowPulse = 0
  let flagMode: DutyFlagMode = options?.initialFlagMode ?? 'idle'
  let manualFlagHoldSec = 0
  let printerMode: DutyPrinterMode = 'holstered'
  let printProgress = 0
  let paperTornOff = false
  let waveClock = 0

  const chestLocalOffset = new T.Vector3(0, 0.055, -0.145)
  const mouthLocalOffset = new T.Vector3(0, -0.026, -0.148)
  const chestQuat = new T.Quaternion().setFromEuler(new T.Euler(Math.PI * 0.42, 0, 0))
  const mouthQuat = new T.Quaternion().setFromEuler(new T.Euler(0, 0, 0))

  const tmpChestWorld = new T.Vector3()
  const tmpMouthWorld = new T.Vector3()
  const tmpWhistleWorld = new T.Vector3()
  const tmpFlagWorld = new T.Vector3()
  const tmpPrinterWorld = new T.Vector3()
  const tmpLocal = new T.Vector3()

  function isFlagSuppressedByTicket(): boolean {
    return printerMode === 'in_hand' || printerMode === 'belt_printing' || paperTornOff
  }

  function syncParentAndVisibility(): void {
    lanyardGroup.visible = whistleVisible
    whistleGroup.visible = whistleVisible

    const suppressFlag = isFlagSuppressedByTicket()
    flagGroup.visible = flagVisible && !suppressFlag && flagMode !== 'stowed'

    holsterGroup.visible = printerVisible && printerMode !== 'hidden'
    printerGroup.visible = printerVisible && printerMode !== 'hidden'
    handSlipGroup.visible = printerVisible && paperTornOff

    // 皮套扣带开合：打印机拿在手上时扣带掀开，归回皮套时扣紧
    strapPivot.rotation.x = printerMode === 'in_hand' ? -0.75 : 0

    const desiredParent = printerMode === 'in_hand' ? handAnchor : waistAnchor
    if (printerGroup.parent !== desiredParent) {
      desiredParent.add(printerGroup)
    }
    if (printerMode === 'in_hand') {
      printerGroup.position.set(0, -0.018, -0.044)
      printerGroup.rotation.set(-0.42, -0.12, 0.05)
    } else {
      // 插在套里：与快拔套同一朝向，往上抬 1cm 让屏幕和出纸口露在套外
      printerGroup.position.set(0, 0.01, 0).applyEuler(HOLSTER_LOCAL_ROT).add(HOLSTER_LOCAL_POS)
      printerGroup.rotation.copy(HOLSTER_LOCAL_ROT)
    }

    const paperLen =
      (printerMode === 'in_hand' || printerMode === 'belt_printing') && !paperTornOff
        ? Math.max(0, Math.min(1, printProgress)) * 0.092
        : 0
    if (paperLen > 0.002) {
      ejectPaperMesh.visible = true
      ejectPaperMesh.scale.set(1, paperLen, 1)
      ejectPaperMesh.position.set(DUTY_PRINTER_SLOT_LOCAL.x, DUTY_PRINTER_SLOT_LOCAL.y + paperLen * 0.5, DUTY_PRINTER_SLOT_LOCAL.z)
      ejectPaperMesh.rotation.set(-0.16 * printProgress, 0, 0)
    } else {
      ejectPaperMesh.visible = false
    }
  }

  function applyTransform(): void {
    torsoAnchor.updateWorldMatrix(true, false)
    headAnchor.updateWorldMatrix(true, false)

    tmpChestWorld.copy(chestLocalOffset).applyMatrix4(torsoAnchor.matrixWorld)
    tmpMouthWorld.copy(mouthLocalOffset).applyMatrix4(headAnchor.matrixWorld)

    const effectiveBlend = whistleAlwaysAtMouth ? 1 : blowBlend
    const t = effectiveBlend * effectiveBlend * (3 - 2 * effectiveBlend)
    tmpWhistleWorld.lerpVectors(tmpChestWorld, tmpMouthWorld, t)

    if (blowPulse > 0.001) {
      const jitter = Math.sin(waveClock * 42) * 0.0025 * blowPulse
      tmpWhistleWorld.y += jitter
    }

    tmpLocal.copy(tmpWhistleWorld)
    torsoAnchor.worldToLocal(tmpLocal)
    whistleGroup.position.copy(tmpLocal)
    whistleGroup.quaternion.slerpQuaternions(chestQuat, mouthQuat, t)
    chamberMat.emissiveIntensity = 0.28 + blowPulse * 0.28

    if (flagMode === 'pass') {
      flagGroup.rotation.set(0.84, -0.14, 0.18 + Math.sin(waveClock * 11.5) * 0.24)
      clothPivot.rotation.z = Math.sin(waveClock * 13.5) * 0.26
    } else if (flagMode === 'stop') {
      flagGroup.rotation.set(0.62, 0.16, -0.28)
      clothPivot.rotation.z = 0.04 * Math.sin(waveClock * 3.5)
    } else {
      flagGroup.rotation.set(0, 0, 0)
      clothPivot.rotation.z = Math.sin(waveClock * 2.2) * 0.06
    }
  }

  function setWhistleBlowing(blowing: boolean, instant = false): void {
    whistleBlowing = blowing
    if (blowing) blowPulse = 1
    if (instant) {
      blowBlend = whistleAlwaysAtMouth || blowing ? 1 : 0
      if (!blowing) blowPulse = 0
      applyTransform()
    }
  }

  function triggerWhistlePulse(): void {
    blowPulse = 1
    whistleBlowing = true
    if (whistleAlwaysAtMouth) blowBlend = 1
    applyTransform()
  }

  function setFlagMode(mode: DutyFlagMode): void {
    flagMode = mode
    if (mode === 'stop' || mode === 'pass') {
      manualFlagHoldSec = 1.35
    } else {
      manualFlagHoldSec = 0
    }
    syncParentAndVisibility()
    applyTransform()
  }

  function setPrinterMode(mode: DutyPrinterMode): void {
    printerMode = mode
    if (mode === 'in_hand' || mode === 'belt_printing') {
      paperTornOff = false
    }
    syncParentAndVisibility()
    applyTransform()
  }

  function setPrintProgress(progress: number): void {
    printProgress = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0
    syncParentAndVisibility()
  }

  function tearOffSlip(side?: 'left' | 'right'): void {
    slipSide = side === 'left' || side === 'right' ? side : handSide
    const anchor = (slipSide === handSide ? handAnchor : resolveHandAnchor(slipSide === 'left' ? 'hand_l' : 'hand_r')) ?? handAnchor
    if (handSlipGroup.parent !== anchor) anchor.add(handSlipGroup)
    if (!placeSlipInPinch(anchor, slipSide)) {
      // 没有手指骨（简化模型）：沿用旧挂点，左手镜像
      slipSheet.position.copy(slipRestPos)
      slipSheet.rotation.set(slipRestRot.x, slipSide === 'left' ? -slipRotY : slipRotY, slipRestRot.z)
    }
    paperTornOff = true
    printProgress = 0
    if (printerMode === 'in_hand' || printerMode === 'belt_printing') {
      printerMode = 'holstered'
    }
    syncParentAndVisibility()
  }

  function clearHandSlip(): void {
    paperTornOff = false
    printProgress = 0
    if (printerMode !== 'hidden') {
      printerMode = 'holstered'
    }
    syncParentAndVisibility()
  }

  function syncFromEmoteId(emoteId: number, instant = false): void {
    if (emoteId === 4) {
      setWhistleBlowing(true, instant)
      if (!isFlagSuppressedByTicket()) setFlagMode('idle')
    } else if (emoteId === 5 && !isFlagSuppressedByTicket()) {
      setWhistleBlowing(false, instant)
      setFlagMode('stop')
    } else if (emoteId === 6 && !isFlagSuppressedByTicket()) {
      setWhistleBlowing(false, instant)
      setFlagMode('pass')
    } else {
      if (!whistleBlowing || blowPulse <= 0.05) {
        setWhistleBlowing(false, instant)
      }
      if (!isFlagSuppressedByTicket() && manualFlagHoldSec <= 0) {
        setFlagMode('idle')
      }
    }
  }

  function update(dt: number): void {
    const cdt = Number.isFinite(dt) && dt > 0 ? Math.min(0.2, dt) : 0
    waveClock += cdt
    if (cdt > 0 && blowPulse > 0) {
      blowPulse = Math.max(0, blowPulse - cdt * 3.2)
      if (blowPulse === 0 && whistleAlwaysAtMouth) {
        whistleBlowing = false
      }
    }
    if (cdt > 0 && manualFlagHoldSec > 0) {
      manualFlagHoldSec = Math.max(0, manualFlagHoldSec - cdt)
      if (manualFlagHoldSec === 0 && !isFlagSuppressedByTicket() && (flagMode === 'stop' || flagMode === 'pass')) {
        flagMode = 'idle'
      }
    }
    const targetBlend = whistleAlwaysAtMouth || whistleBlowing ? 1 : 0
    if (cdt > 0 && Math.abs(blowBlend - targetBlend) > 1e-4) {
      const rate = 1 / 0.16
      if (blowBlend < targetBlend) blowBlend = Math.min(1, blowBlend + cdt * rate)
      else blowBlend = Math.max(0, blowBlend - cdt * rate)
    }
    applyTransform()
  }

  function getProbe(): DutyPropsProbe {
    target.updateMatrixWorld(true)
    tmpChestWorld.copy(chestLocalOffset).applyMatrix4(torsoAnchor.matrixWorld)
    tmpMouthWorld.copy(mouthLocalOffset).applyMatrix4(headAnchor.matrixWorld)
    whistleGroup.getWorldPosition(tmpWhistleWorld)
    flagGroup.getWorldPosition(tmpFlagWorld)
    printerGroup.getWorldPosition(tmpPrinterWorld)

    const effectiveBlend = whistleAlwaysAtMouth ? 1 : blowBlend

    return {
      attached: Boolean(whistleGroup.parent && flagGroup.parent && printerGroup.parent && holsterGroup.parent),
      attachedToSkeleton,
      whistleVisible: whistleGroup.visible,
      flagVisible: flagGroup.visible,
      printerVisible: printerGroup.visible,
      holsterStrapVisible: holsterGroup.visible && strapPivot.visible,
      handSlipVisible: handSlipGroup.visible,
      whistleAlwaysAtMouth,
      whistleMode: whistleAlwaysAtMouth || whistleBlowing || effectiveBlend >= 0.5 ? 'mouth' : 'chest',
      blowBlend: effectiveBlend,
      blowPulse,
      flagMode,
      printerMode,
      printProgress,
      paperTornOff,
      handSide,
      whistleWorldPos: {x: tmpWhistleWorld.x, y: tmpWhistleWorld.y, z: tmpWhistleWorld.z},
      chestWorldPos: {x: tmpChestWorld.x, y: tmpChestWorld.y, z: tmpChestWorld.z},
      mouthWorldPos: {x: tmpMouthWorld.x, y: tmpMouthWorld.y, z: tmpMouthWorld.z},
      flagWorldPos: {x: tmpFlagWorld.x, y: tmpFlagWorld.y, z: tmpFlagWorld.z},
      printerWorldPos: {x: tmpPrinterWorld.x, y: tmpPrinterWorld.y, z: tmpPrinterWorld.z},
      whistleToMouthDist: tmpWhistleWorld.distanceTo(tmpMouthWorld),
      whistleToChestDist: tmpWhistleWorld.distanceTo(tmpChestWorld),
    }
  }

  function dispose(): void {
    lanyardGroup.removeFromParent()
    whistleGroup.removeFromParent()
    flagGroup.removeFromParent()
    holsterGroup.removeFromParent()
    printerGroup.removeFromParent()
    handSlipGroup.removeFromParent()
    for (const g of whistleAssets.geometries) g.dispose()
    for (const m of whistleAssets.materials) m.dispose()
    for (const g of flagAssets.geometries) g.dispose()
    for (const m of flagAssets.materials) m.dispose()
    for (const g of printerAssets.geometries) g.dispose()
    for (const m of printerAssets.materials) m.dispose()
  }

  syncParentAndVisibility()
  applyTransform()

  return {
    whistleGroup,
    flagGroup,
    holsterGroup,
    printerGroup,
    handSlipGroup,
    setVisible(visible: boolean) {
      whistleVisible = visible
      flagVisible = visible
      printerVisible = visible
      syncParentAndVisibility()
    },
    setWhistleVisible(visible: boolean) {
      whistleVisible = visible
      syncParentAndVisibility()
    },
    setFlagVisible(visible: boolean) {
      flagVisible = visible
      syncParentAndVisibility()
    },
    setPrinterVisible(visible: boolean) {
      printerVisible = visible
      syncParentAndVisibility()
    },
    setWhistleAlwaysAtMouth(alwaysAtMouth: boolean) {
      whistleAlwaysAtMouth = alwaysAtMouth
      blowBlend = alwaysAtMouth || whistleBlowing ? 1 : 0
      applyTransform()
    },
    setWhistleBlowing,
    triggerWhistlePulse,
    setFlagMode,
    setPrinterMode,
    setPrintProgress,
    tearOffSlip,
    clearHandSlip,
    isFlagSuppressedByTicket,
    syncFromEmoteId,
    update,
    getProbe,
    dispose,
  }
}

/**
 * 打印机出纸口的世界坐标（给 ticket-handover 的 `printerWorldPos` 用：扯单时手伸到这里，纸从这里出来）。
 * 打印机不可见或不在场景里时返回 null。
 */
export function getDutyPrinterSlotWorldPosition(
  handle: Pick<DutyPropsHandle, 'printerGroup'> | null | undefined,
  out: T.Vector3 = new T.Vector3(),
): T.Vector3 | null {
  const group = handle?.printerGroup
  if (!group || !group.parent) return null
  let o: T.Object3D | null = group
  while (o) {
    if (!o.visible) return null
    o = o.parent
  }
  const anchor = group.getObjectByName('printer_paper_slot_anchor')
  if (!anchor) return null
  anchor.updateWorldMatrix(true, false)
  return out.setFromMatrixPosition(anchor.matrixWorld)
}
