import * as THREE from 'three'
import {mainDetail} from '../look/mirror-layer'
import {shareAtmosphere} from '../look/atmosphere'
import type {
  CustomerArchetype,
  MifenRecipe,
  MifenRecipesData,
  ShopLevel,
  ShopSeat,
  TianyuanShopBuildResult,
  ToppingKey,
} from './types'
import { createMifenBowlMesh } from './shop-mesh'
import { getMaxCustomersForLevel, type ShopEquipmentBonuses } from './state'
import type { CookCompletion } from './cooking'
import { computeQueuePatienceRate, getTimeAndTrafficModifiers } from './economy/rush'
import { createFigurePool, driveFigureClips, instantiateFigure, setJoint, solveForearm, type FigureInstance, type FigureTemplate } from './figure-people'
import type { Age } from '../traffic/crowd'

export type CustomerPhase = 'approaching' | 'entering' | 'queuing' | 'pickup' | 'toppings' | 'seated' | 'leaving'
export type CustomerRoleKind = 'student' | 'commuter' | 'tourist' | 'gourmet' | 'rider'

export interface RichCustomerArchetype extends CustomerArchetype {
  roleKind: CustomerRoleKind
  bidMultiplier: number
}

export interface ShopCoordAdapter {
  toWorldPoint(p: [number, number, number], out?: THREE.Vector3): THREE.Vector3
  toLocalPoint(worldPos: THREE.Vector3, out?: THREE.Vector3): THREE.Vector3
  toWorldYaw(yaw: number, refPoint: [number, number, number]): number
  localToWorld(x: number, y: number, z: number, out?: THREE.Vector3): THREE.Vector3
  sampleWalkY(wx: number, wz: number, insideShop: boolean): number
}

export interface QueuedTicketInfo {
  id: string
  customerName: string
  archetype: RichCustomerArchetype
  recipe: MifenRecipe
  patienceRatio: number
  patienceSecLeft: number
  beingCooked: boolean
}

export interface CustomerEvents {
  getShopLevel: () => ShopLevel
  getBonuses: () => ShopEquipmentBonuses
  getActiveCookingTicketId: () => string | null
  getHour?: () => number
  getReputation?: () => number
  /** 仅当剧情已解锁且玩家在店内时为 true；为 false 时不刷顾客、不出票、冻结排队消耗 */
  canEarn?: () => boolean
  onCustomerFinished: (info: {
    customerName: string
    recipeName: string
    stars: 1 | 2 | 3
    revenue: number
    tip: number
    praiseLine: string
  }) => void
  onCustomerImpatient: (info: { customerName: string; line: string }) => void
}

export interface CustomerManager {
  step(dt: number, nearShop: boolean, cameraPos?: THREE.Vector3): void
  onShopChanged(shop: TianyuanShopBuildResult, coords: ShopCoordAdapter): void
  spawnCustomerNow(immediate?: boolean, forceRole?: CustomerRoleKind): { id: string; recipeId: string; name: string } | null
  getQueuedTickets(): QueuedTicketInfo[]
  getTicketById(id: string): QueuedTicketInfo | null
  serveCustomer(completion: CookCompletion): boolean
  getActiveCount(): number
  getQueueCount(): number
  getSeatedCount(): number
  getSummary(): {
    total: number
    queuing: number
    pickup: number
    toppings: number
    seated: number
    leaving: number
  }
  getBubbleMetrics(cameraPos?: THREE.Vector3): Array<{
    id: string
    roleKind: CustomerRoleKind
    roleName: string
    phase: CustomerPhase
    visible: boolean
    dist: number
    scaleX: number
    scaleY: number
    opacity: number
  }>
  setVisible(visible: boolean): void
  clearAll(): void
  dispose(): void
}

interface CustomerRig {
  root: THREE.Group
  bodyPivot: THREE.Group
  head: THREE.Object3D
  leftArm: THREE.Group
  rightArm: THREE.Group
  leftLeg: THREE.Group
  rightLeg: THREE.Group
  bowlAnchor: THREE.Group
  bubbleSprite: THREE.Sprite
  bubbleCanvas: HTMLCanvasElement
  bubbleTexture: THREE.CanvasTexture
  lastBubbleKey: string
  skeleton?: THREE.Skeleton
  disposables: { geometries: THREE.BufferGeometry[]; materials: THREE.Material[] }
  /** 现版本角色（与街上路人同源）；上面的四肢/头/身体只是旧动作代码写入的关节角，由 syncCustomerFigure 换算到骨骼 */
  figure?: { inst: FigureInstance; mode: 'clip' | 'pose'; walkWeight: number; lastX: number; lastZ: number; holdFore: number; seatFore: number }
}

/** 顾客身份对应街上路人的年龄段，穿搭与体态跟着走 */
const ROLE_AGE: Record<CustomerRoleKind, Age> = {
  student: 'student',
  commuter: 'young',
  tourist: 'young',
  gourmet: 'middle',
  rider: 'young',
}
/** 坐凳时骨盆离地高度（与旧方块人坐姿 0.74 - 0.26 对齐） */
const SEATED_PELVIS_Y = 0.5

interface CustomerAgent {
  id: string
  name: string
  roleKind: CustomerRoleKind
  archetype: RichCustomerArchetype
  recipe: MifenRecipe
  phase: CustomerPhase
  rig: CustomerRig
  waypoints: THREE.Vector3[]
  targetPos: THREE.Vector3
  speed: number
  walkPhase: number
  patienceMax: number
  patienceLeft: number
  queueSlot: number
  seatId: string | null
  seatWorldYaw: number
  stateTimer: number
  eatPhase: number
  bowlDelivered: boolean
  served: CookCompletion | null
  bowlMesh: THREE.Group | null
  angry: boolean
  chosenCondiments: string[]
  leaveSide: -1 | 1
}

const ALL_ROLES: readonly CustomerRoleKind[] = ['student', 'commuter', 'tourist', 'gourmet', 'rider']

const FIVE_CUSTOMER_PROFILES: readonly RichCustomerArchetype[] = [
  {
    id: 'guilin_student',
    roleKind: 'student',
    name: '学生',
    shirtColors: ['#6ea8d9', '#dbe4ee', '#7bb292', '#8fa5c6'],
    patienceSec: 76,
    bidMultiplier: 0.95,
    tipMultiplier: 0.85,
    favoriteRecipes: ['lucai_1', 'lucai_2', 'sour_spicy'],
    preferredCondiments: ['scallion', 'sour_long_beans', 'chili_oil'],
    praiseLines: ['实惠顶饱，下课再来', '二两干拌配酸豆角正好'],
    impatientLines: ['快上课了，先走了'],
  },
  {
    id: 'shizijie_commuter',
    roleKind: 'commuter',
    name: '上班族',
    shirtColors: ['#334155', '#475569', '#3b6ea5', '#cbd5e1'],
    patienceSec: 46,
    bidMultiplier: 1.05,
    tipMultiplier: 1.2,
    favoriteRecipes: ['lucai_2', 'guoshao_bowl', 'beef_soup', 'sour_spicy'],
    preferredCondiments: ['scallion', 'sour_long_beans', 'chili_oil'],
    praiseLines: ['出餐利索，赶得上打卡', '卤牛肉切得够厚实'],
    impatientLines: ['赶打卡来不及了'],
  },
  {
    id: 'xhs_tourist',
    roleKind: 'tourist',
    name: '游客',
    shirtColors: ['#e8836b', '#e6b85c', '#5fa8d3', '#9d84b7'],
    patienceSec: 72,
    bidMultiplier: 1.15,
    tipMultiplier: 1.45,
    favoriteRecipes: ['double_combo', 'grand_feast', 'guoshao_bowl', 'beef_soup'],
    preferredCondiments: ['pickled_green_chili', 'sour_long_beans', 'scallion'],
    praiseLines: ['双拼锅烧脆，值得打卡', '老店卤香够正'],
    impatientLines: ['还要赶象鼻山行程，先走了'],
  },
  {
    id: 'sanduo_gourmet',
    roleKind: 'gourmet',
    name: '老饕',
    shirtColors: ['#4a5d52', '#6b5344', '#3f4f63', '#5c5449'],
    patienceSec: 84,
    bidMultiplier: 1.2,
    tipMultiplier: 1.55,
    favoriteRecipes: ['lucai_3', 'grand_feast', 'double_combo', 'beef_soup'],
    preferredCondiments: ['pickled_green_chili', 'radish_strips', 'sour_bamboo'],
    praiseLines: ['火候老卤都到位，地道', '脆锅烧配老卤，明天还来'],
    impatientLines: ['今天队太长，改天再嗦'],
  },
  {
    id: 'delivery_rider',
    roleKind: 'rider',
    name: '外卖骑手',
    shirtColors: ['#d99b1e', '#2b7cc4', '#e0a924', '#3182ce'],
    patienceSec: 38,
    bidMultiplier: 1.1,
    tipMultiplier: 1.3,
    favoriteRecipes: ['lucai_2', 'guoshao_bowl', 'double_combo', 'sour_spicy'],
    preferredCondiments: ['chili_oil', 'pickled_chili', 'scallion'],
    praiseLines: ['准点出单，好评不断', '打包稳当，跑单顺利'],
    impatientLines: ['超时要扣钱，转单走了'],
  },
]

const FALLBACK_RECIPE: MifenRecipe = {
  id: 'erliang-lucai',
  name: '招牌卤菜粉（贰两）',
  portion: '二两',
  price: 10,
  ticketColor: '#e85d3f',
  requiredMeats: ['guoshao', 'beef'],
  brothStyle: 'lucai_dry',
  boilTargetSec: 2.5,
  brineTarget: 0.68,
  description: '锅烧卤牛肉双拼干拌',
}

const SURNAMES = ['陈', '李', '韦', '覃', '莫', '唐', '周', '黄', '林', '梁', '陆', '彭']
const ROLE_TITLES: Record<CustomerRoleKind, readonly string[]> = {
  student: ['同学', '学弟', '学妹'],
  commuter: ['工', '经理', '女士', '先生'],
  tourist: ['游客', '旅友', '姑娘', '小哥'],
  gourmet: ['叔', '伯', '姐', '师傅'],
  rider: ['骑手', '小哥', '师傅'],
}

const TOPPING_COLORS: Record<ToppingKey, string> = {
  guoshao: '#d99a3c',
  beef: '#a84334',
  charsiu: '#c45b47',
  egg: '#e8dcc4',
  youtiao: '#e6be5c',
}

// 与 mifen-ui.css 的 --mf-surface / --mf-text / --mf-line / --mf-fill-2 / --mf-text-3 / --mf-accent-text 对齐；urgent 满足 WCAG AA (>=4.5:1)
const BUBBLE_INK = {
  surface: 'rgba(22, 36, 33, 0.9)',
  text: '#f4efe2',
  line: 'rgba(244, 239, 226, 0.14)',
  track: 'rgba(244, 239, 226, 0.16)',
  patience: 'rgba(244, 239, 226, 0.4)',
  urgent: '#e57f61',
} as const

const BUBBLE_BASE_W = 0.68
const BUBBLE_BASE_H = 0.27
const BUBBLE_REF_DIST = 6.5
const BUBBLE_MIN_SCALE = 0.34
const BUBBLE_FADE_NEAR_START = 1.6
const BUBBLE_FADE_NEAR_END = 0.7
const BUBBLE_FADE_FAR_START = 14.0
const BUBBLE_FADE_FAR_END = 20.0

function pickRandom<T>(arr: readonly T[], fallback: T): T {
  if (!arr.length) return fallback
  return arr[Math.floor(Math.random() * arr.length)]
}

function readRuntimeHour(events: CustomerEvents): number {
  if (events.getHour) return events.getHour()
  if (typeof window !== 'undefined') {
    const v = (window as unknown as { viewer?: { clock?: { hour?: number } } }).viewer
    const h = v?.clock?.hour
    if (typeof h === 'number' && Number.isFinite(h)) return h
  }
  return 8.5
}

function readRuntimeReputation(events: CustomerEvents): number {
  if (events.getReputation) return events.getReputation()
  return 4.2
}

let sharedCustomerMasterMat: THREE.MeshStandardMaterial | null = null
function getCustomerMasterMat(): THREE.MeshStandardMaterial {
  if (!sharedCustomerMasterMat) {
    sharedCustomerMasterMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.82,
      metalness: 0.04,
      emissive: 0xffe8d0,
      emissiveIntensity: 0.14,
    })
    sharedCustomerMasterMat.name = 'tianyuan_customer_shared_vc'
    sharedCustomerMasterMat.userData.sharedCached = true
    sharedCustomerMasterMat.onBeforeCompile = shader => {
      shareAtmosphere(shader)
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n#ifdef USE_COLOR\ntotalEmissiveRadiance *= vColor.rgb;\n#endif',
      )
    }
    sharedCustomerMasterMat.customProgramCacheKey = () => 'guilinol-mifen-vc-emissive'
  }
  return sharedCustomerMasterMat
}

function disposeObject3D(obj: THREE.Object3D): void {
  obj.traverse(node => {
    const mesh = node as THREE.Mesh
    if (mesh.geometry) mesh.geometry.dispose()
    if (mesh.material) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const m of mats) {
        if (m.userData?.sharedCached) continue
        const std = m as THREE.MeshStandardMaterial
        if (std.map && !std.map.userData?.sharedCached) std.map.dispose()
        m.dispose()
      }
    }
  })
}

function drawRoleGlyph(ctx: CanvasRenderingContext2D, role: CustomerRoleKind, cx: number, cy: number): void {
  ctx.save()
  ctx.strokeStyle = BUBBLE_INK.text
  ctx.fillStyle = BUBBLE_INK.text
  ctx.lineWidth = 3.2
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  if (role === 'student') {
    // Minimal backpack outline
    ctx.beginPath()
    ctx.roundRect(cx - 16, cy - 13, 32, 32, 8)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(cx, cy - 13, 8, Math.PI, 0)
    ctx.stroke()
    ctx.beginPath()
    ctx.roundRect(cx - 10, cy + 1, 20, 11, 3)
    ctx.stroke()
  } else if (role === 'commuter') {
    // Minimal briefcase
    ctx.beginPath()
    ctx.roundRect(cx - 18, cy - 9, 36, 26, 4)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(cx - 7, cy - 9)
    ctx.lineTo(cx - 7, cy - 16)
    ctx.lineTo(cx + 7, cy - 16)
    ctx.lineTo(cx + 7, cy - 9)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(cx - 18, cy + 2)
    ctx.lineTo(cx + 18, cy + 2)
    ctx.stroke()
  } else if (role === 'tourist') {
    // Minimal camera
    ctx.beginPath()
    ctx.roundRect(cx - 18, cy - 10, 36, 25, 5)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(cx - 8, cy - 10)
    ctx.lineTo(cx - 4, cy - 16)
    ctx.lineTo(cx + 4, cy - 16)
    ctx.lineTo(cx + 8, cy - 10)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(cx, cy + 3, 7, 0, Math.PI * 2)
    ctx.stroke()
  } else if (role === 'gourmet') {
    // Minimal five-point star seal
    drawStar(ctx, cx, cy + 1, 16, 7, true)
  } else {
    // Rider helmet + lightning bolt
    ctx.beginPath()
    ctx.arc(cx, cy + 1, 16, Math.PI * 0.92, Math.PI * 2.08)
    ctx.lineTo(cx + 17, cy + 10)
    ctx.lineTo(cx - 17, cy + 10)
    ctx.closePath()
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(cx - 10, cy + 2)
    ctx.lineTo(cx + 11, cy + 2)
    ctx.stroke()
  }
  ctx.restore()
}

function drawStar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  outerR: number,
  innerR: number,
  filled: boolean,
): void {
  ctx.beginPath()
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outerR : innerR
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    const x = cx + Math.cos(a) * r
    const y = cy + Math.sin(a) * r
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
  if (filled) ctx.fill()
  else ctx.stroke()
}

function drawBowlIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  ctx.save()
  ctx.strokeStyle = BUBBLE_INK.text
  ctx.fillStyle = 'rgba(244, 239, 226, 0.16)'
  ctx.lineWidth = 3.5
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(cx - 26, cy - 4)
  ctx.lineTo(cx + 26, cy - 4)
  ctx.arc(cx, cy - 4, 26, 0, Math.PI)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(cx - 12, cy + 24)
  ctx.lineTo(cx + 12, cy + 24)
  ctx.stroke()
  ctx.restore()
}

function drawSteamLines(ctx: CanvasRenderingContext2D, cx: number, baseY: number): void {
  ctx.save()
  ctx.strokeStyle = BUBBLE_INK.text
  ctx.lineWidth = 3
  ctx.lineCap = 'round'
  for (const dx of [-13, 0, 13]) {
    ctx.beginPath()
    ctx.moveTo(cx + dx, baseY)
    ctx.quadraticCurveTo(cx + dx - 5, baseY - 11, cx + dx, baseY - 22)
    ctx.stroke()
  }
  ctx.restore()
}

function drawChopsticks(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  ctx.save()
  ctx.strokeStyle = '#e8dcc4'
  ctx.lineWidth = 3
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(cx - 14, cy - 26)
  ctx.lineTo(cx + 22, cy - 6)
  ctx.moveTo(cx - 4, cy - 30)
  ctx.lineTo(cx + 24, cy - 13)
  ctx.stroke()
  ctx.restore()
}

interface GraphicalBubbleOpts {
  roleKind: CustomerRoleKind
  phase: CustomerPhase
  portionCount: 1 | 2 | 3
  meats: readonly ToppingKey[]
  brothStyle: MifenRecipe['brothStyle']
  cookingNow: boolean
  patienceRatio?: number
  stars?: 1 | 2 | 3
  angry?: boolean
}

/**
 * Pure vector iconographic bubble (ZERO text sentences, ZERO emoji; aligns with docs/design-rules.md).
 */
function drawGraphicalBubble(
  canvas: HTMLCanvasElement,
  texture: THREE.CanvasTexture,
  opts: GraphicalBubbleOpts,
): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const w = canvas.width
  const h = canvas.height
  ctx.clearRect(0, 0, w, h)

  const pad = 12
  const r = 24
  const bh = h - 26
  const urgent = opts.patienceRatio !== undefined && opts.patienceRatio < 0.25

  // Linear glass pill with single hairline border
  ctx.fillStyle = BUBBLE_INK.surface
  ctx.strokeStyle = urgent || opts.angry ? BUBBLE_INK.urgent : BUBBLE_INK.line
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(pad + r, pad)
  ctx.lineTo(w - pad - r, pad)
  ctx.quadraticCurveTo(w - pad, pad, w - pad, pad + r)
  ctx.lineTo(w - pad, bh - r)
  ctx.quadraticCurveTo(w - pad, bh, w - pad - r, bh)
  ctx.lineTo(w / 2 + 12, bh)
  ctx.lineTo(w / 2, h - 5)
  ctx.lineTo(w / 2 - 12, bh)
  ctx.lineTo(pad + r, bh)
  ctx.quadraticCurveTo(pad, bh, pad, bh - r)
  ctx.lineTo(pad, pad + r)
  ctx.quadraticCurveTo(pad, pad, pad + r, pad)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()

  // Left role glyph zone
  const midY = (pad + bh) / 2 - (opts.patienceRatio !== undefined ? 6 : 0)
  drawRoleGlyph(ctx, opts.roleKind, pad + 44, midY)

  // Hairline vertical divider
  ctx.strokeStyle = BUBBLE_INK.line
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(pad + 84, pad + 20)
  ctx.lineTo(pad + 84, bh - (opts.patienceRatio !== undefined ? 28 : 20))
  ctx.stroke()

  // Right iconographic demand / status zone
  const zoneX = pad + 132
  if (opts.phase === 'approaching' || opts.phase === 'entering' || opts.phase === 'queuing') {
    drawBowlIcon(ctx, zoneX, midY + 8)
    if (opts.cookingNow) {
      drawSteamLines(ctx, zoneX, midY - 6)
    } else {
      // Portion pips (1 / 2 / 3) above bowl
      ctx.fillStyle = BUBBLE_INK.text
      const gap = 14
      const startX = zoneX - ((opts.portionCount - 1) * gap) / 2
      for (let i = 0; i < opts.portionCount; i++) {
        ctx.beginPath()
        ctx.arc(startX + i * gap, midY - 18, 4.5, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    // Required meat geometry swatches to the right of bowl
    const meats = opts.meats.slice(0, 5)
    let mx = zoneX + 54
    for (const m of meats) {
      ctx.fillStyle = TOPPING_COLORS[m] ?? '#d8be85'
      ctx.strokeStyle = 'rgba(244, 239, 226, 0.45)'
      ctx.lineWidth = 2
      if (m === 'guoshao') {
        ctx.beginPath()
        ctx.roundRect(mx - 10, midY - 12, 20, 20, 4)
        ctx.fill()
        ctx.stroke()
      } else if (m === 'beef' || m === 'charsiu') {
        ctx.beginPath()
        ctx.ellipse(mx, midY - 2, 11, 7, -0.25, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
      } else if (m === 'egg') {
        ctx.beginPath()
        ctx.ellipse(mx, midY - 2, 8, 11, 0, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
      } else {
        ctx.beginPath()
        ctx.roundRect(mx - 6, midY - 13, 5, 22, 2)
        ctx.roundRect(mx + 2, midY - 13, 5, 22, 2)
        ctx.fill()
      }
      mx += 28
    }

    // Broth style minimal indicator (soup waves / chili diamond)
    if (opts.brothStyle === 'soup') {
      ctx.strokeStyle = 'rgba(244, 239, 226, 0.72)'
      ctx.lineWidth = 2.5
      ctx.beginPath()
      ctx.moveTo(zoneX + 46, midY + 18)
      ctx.quadraticCurveTo(zoneX + 58, midY + 12, zoneX + 70, midY + 18)
      ctx.quadraticCurveTo(zoneX + 82, midY + 24, zoneX + 94, midY + 18)
      ctx.stroke()
    } else if (opts.brothStyle === 'sour_spicy') {
      ctx.fillStyle = BUBBLE_INK.urgent
      ctx.beginPath()
      ctx.moveTo(zoneX + 54, midY + 12)
      ctx.lineTo(zoneX + 66, midY + 18)
      ctx.lineTo(zoneX + 54, midY + 24)
      ctx.lineTo(zoneX + 48, midY + 18)
      ctx.closePath()
      ctx.fill()
    }
  } else if (opts.phase === 'pickup') {
    drawBowlIcon(ctx, zoneX, midY + 8)
    drawSteamLines(ctx, zoneX, midY - 6)
    const stars = opts.stars ?? 3
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = i < stars ? BUBBLE_INK.text : 'transparent'
      ctx.strokeStyle = 'rgba(244, 239, 226, 0.45)'
      ctx.lineWidth = 2.4
      drawStar(ctx, zoneX + 62 + i * 32, midY + 2, 11, 5, i < stars)
    }
  } else if (opts.phase === 'toppings') {
    drawBowlIcon(ctx, zoneX, midY + 8)
    drawChopsticks(ctx, zoneX, midY + 8)
    const condColors = ['#69a85d', '#9ba84c', '#c84b3a']
    condColors.forEach((col, idx) => {
      ctx.fillStyle = col
      ctx.beginPath()
      ctx.arc(zoneX + 58 + idx * 24, midY + 2, 8, 0, Math.PI * 2)
      ctx.fill()
    })
  } else if (opts.phase === 'seated') {
    drawBowlIcon(ctx, zoneX, midY + 8)
    drawChopsticks(ctx, zoneX, midY + 8)
    const stars = opts.stars ?? 3
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = i < stars ? BUBBLE_INK.text : 'transparent'
      ctx.strokeStyle = 'rgba(244, 239, 226, 0.45)'
      ctx.lineWidth = 2.4
      drawStar(ctx, zoneX + 62 + i * 32, midY + 2, 12, 5.5, i < stars)
    }
  } else {
    // Leaving: clean check or vermilion cross
    ctx.save()
    ctx.lineWidth = 6
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    const iconX = zoneX + 42
    if (opts.angry) {
      ctx.strokeStyle = BUBBLE_INK.urgent
      ctx.beginPath()
      ctx.moveTo(iconX - 18, midY - 18)
      ctx.lineTo(iconX + 18, midY + 18)
      ctx.moveTo(iconX + 18, midY - 18)
      ctx.lineTo(iconX - 18, midY + 18)
      ctx.stroke()
    } else {
      ctx.strokeStyle = BUBBLE_INK.text
      ctx.beginPath()
      ctx.moveTo(iconX - 20, midY + 2)
      ctx.lineTo(iconX - 4, midY + 18)
      ctx.lineTo(iconX + 24, midY - 16)
      ctx.stroke()
    }
    ctx.restore()
  }

  // Minimal hairline patience bar (vermilion only when urgent)
  if (opts.patienceRatio !== undefined) {
    const ratio = Math.max(0, Math.min(1, opts.patienceRatio))
    const barX = pad + 20
    const barY = bh - 16
    const barW = w - pad * 2 - 40
    const barH = 6
    ctx.fillStyle = BUBBLE_INK.track
    ctx.beginPath()
    ctx.roundRect(barX, barY, barW, barH, 3)
    ctx.fill()
    ctx.fillStyle = urgent ? BUBBLE_INK.urgent : BUBBLE_INK.patience
    ctx.beginPath()
    ctx.roundRect(barX, barY, Math.max(4, barW * ratio), barH, 3)
    ctx.fill()
  }

  texture.needsUpdate = true
}

// Overhead vector Canvas Sprite bubble (high-DPI compact badge; distance-clamped in step)
function attachBubble(root: THREE.Group, materials: THREE.Material[]) {
  const bubbleCanvas = document.createElement('canvas')
  bubbleCanvas.width = 400
  bubbleCanvas.height = 160
  const bubbleTexture = new THREE.CanvasTexture(bubbleCanvas)
  bubbleTexture.colorSpace = THREE.SRGBColorSpace
  const spriteMat = new THREE.SpriteMaterial({ map: bubbleTexture, transparent: true, opacity: 0.92, depthWrite: false, fog: false })
  materials.push(spriteMat)
  const bubbleSprite = new THREE.Sprite(spriteMat)
  bubbleSprite.position.set(0, 2.04, 0)
  bubbleSprite.scale.set(BUBBLE_BASE_W * 0.55, BUBBLE_BASE_H * 0.55, 1)
  root.add(bubbleSprite)
  return { bubbleSprite, bubbleCanvas, bubbleTexture }
}

/** 现版本顾客：路人同款角色；四肢/头/身体是空节点，只承接旧动作代码写入的角度 */
function buildFigureCustomerRig(template: FigureTemplate): CustomerRig {
  const materials: THREE.Material[] = []
  const root = new THREE.Group()
  const bodyPivot = new THREE.Group()
  const head = new THREE.Group()
  const leftArm = new THREE.Group()
  const rightArm = new THREE.Group()
  const leftLeg = new THREE.Group()
  const rightLeg = new THREE.Group()
  const bowlAnchor = new THREE.Group()
  bowlAnchor.position.set(0, 1.05, 0.36)
  bodyPivot.add(head, leftArm, rightArm, leftLeg, rightLeg, bowlAnchor)
  const inst = instantiateFigure(template)
  root.add(bodyPivot, inst.holder)
  // 按这个人的肩高和臂长解出小臂角，让手腕托在碗底（站着碗高 1.05，坐下随身体降 0.26 到桌面）
  const bowlY = bowlAnchor.position.y - 0.02
  const seatedShoulder = inst.arm.shoulderY + SEATED_PELVIS_Y - inst.pelvisY
  const holdFore = solveForearm(inst, HOLD_ARM, bowlY)
  const seatFore = solveForearm(inst, SEAT_ARM, bowlY - 0.26, seatedShoulder)
  const { bubbleSprite, bubbleCanvas, bubbleTexture } = attachBubble(root, materials)
  return {
    root,
    bodyPivot,
    head,
    leftArm,
    rightArm,
    leftLeg,
    rightLeg,
    bowlAnchor,
    bubbleSprite,
    bubbleCanvas,
    bubbleTexture,
    lastBubbleKey: '',
    disposables: { geometries: [], materials },
    figure: { inst, mode: 'clip', walkWeight: 0, lastX: NaN, lastZ: NaN, holdFore, seatFore },
  }
}

/**
 * 每帧把旧动作代码的关节角落到角色骨骼：空手站立/走路用路人同款 walk/idle 片段；
 * 端碗、伸手、吃粉、坐凳由程序摆姿势（旧方块人面朝 +z、左块在 −x，对应角色右侧）。
 */
function syncCustomerFigure(c: CustomerAgent, dt: number): void {
  const f = c.rig.figure
  if (!f) return
  const rig = c.rig
  const pos = rig.root.position
  const speed = dt > 0 && Number.isFinite(f.lastX) ? Math.hypot(pos.x - f.lastX, pos.z - f.lastZ) / dt : 0
  f.lastX = pos.x
  f.lastZ = pos.z
  const seated = rig.bodyPivot.position.y < -0.1
  const holding = rig.leftArm.rotation.x < -0.5 && rig.rightArm.rotation.x < -0.5
  if (!seated && !holding) {
    f.inst.holder.position.y = 0
    driveFigureClips(f.inst, f, speed, dt)
    return
  }
  f.mode = 'pose'
  const r = f.inst.rig
  const j = r.joints
  // 旧动作以双臂 x = −0.95 为端碗基准；d > 0 为接碗前伸或吃粉抬手（旧 left 在 −x，即角色右手）
  const dR = -rig.leftArm.rotation.x - 0.95
  const dL = -rig.rightArm.rotation.x - 0.95
  const reaching = c.phase === 'pickup'
  const arm = seated ? SEAT_ARM : HOLD_ARM
  const fore = (d: number) => (seated ? f.seatFore : f.holdFore) + (reaching ? -d * 1.5 : d * 1.6)
  r.batch?.(true)
  // 角色关节约定（walk/knockdown.ts）：Arm x+ 前抬，ArmR y+ / ArmL y− 小臂收向中线，ArmR z− / ArmL z+ 内收，Forearm x+ 屈肘
  j.ArmR?.rotation.set(arm + dR, HOLD_TWIST, -HOLD_ARM_IN)
  j.ArmL?.rotation.set(arm + dL, -HOLD_TWIST, HOLD_ARM_IN)
  j.ForearmR?.rotation.set(fore(dR), 0, 0)
  j.ForearmL?.rotation.set(fore(dL), 0, 0)
  setJoint(j.Head, rig.head.rotation.x, 0, 0)
  j.Torso?.rotation.set(0, 0, 0)
  if (seated) {
    setJoint(j.ThighR, rig.leftLeg.rotation.x, 0, 0)
    setJoint(j.ThighL, rig.rightLeg.rotation.x, 0, 0)
    setJoint(j.ShinR, -rig.leftLeg.rotation.x, 0, 0)
    setJoint(j.ShinL, -rig.rightLeg.rotation.x, 0, 0)
    f.inst.holder.position.y = SEATED_PELVIS_Y - f.inst.pelvisY
  } else {
    const swingL = rig.leftLeg.rotation.x
    const swingR = rig.rightLeg.rotation.x
    setJoint(j.ThighR, swingL, 0, 0)
    setJoint(j.ThighL, swingR, 0, 0)
    setJoint(j.ShinR, Math.max(0, swingL) * 0.6, 0, 0)
    setJoint(j.ShinL, Math.max(0, swingR) * 0.6, 0, 0)
    f.inst.holder.position.y = Math.max(0, rig.bodyPivot.position.y)
  }
  r.batch?.(false)
}
// 端碗：上臂微抬、小臂前伸，两手在胸前托住碗底（小臂角按各人臂长解出）；坐着时上臂多抬一点够到桌面
const HOLD_ARM = 0.45
const HOLD_TWIST = 0.3
const HOLD_ARM_IN = 0.06
const SEAT_ARM = 0.6

function buildCustomerRig(shirtHex: string, roleKind: CustomerRoleKind): CustomerRig {
  const geometries: THREE.BufferGeometry[] = []
  const materials: THREE.Material[] = []
  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    geometries.push(g)
    return g
  }
  const trackMat = <T extends THREE.Material>(m: T): T => {
    materials.push(m)
    return m
  }

  const root = new THREE.Group()
  const bodyPivot = new THREE.Group()
  root.add(bodyPivot)

  const skinMat = trackMat(new THREE.MeshStandardMaterial({ color: 0xf1c7a4, roughness: 0.78, metalness: 0.02 }))
  const hairColors = [0x1c1917, 0x2c221e, 0x3b2d26, 0x4b4846]
  const hairMat = trackMat(
    new THREE.MeshStandardMaterial({ color: pickRandom(hairColors, 0x1c1917), roughness: 0.9, metalness: 0.02 }),
  )
  const shirtMat = trackMat(new THREE.MeshStandardMaterial({ color: new THREE.Color(shirtHex), roughness: 0.82, metalness: 0.04 }))
  const pantsColors = [0x2b3648, 0x393c42, 0x5c4f3d, 0x263238]
  const pantsMat = trackMat(
    new THREE.MeshStandardMaterial({ color: pickRandom(pantsColors, 0x2b3648), roughness: 0.88, metalness: 0.02 }),
  )
  const shoeMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x23201e, roughness: 0.92, metalness: 0.02 }))

  // Torso
  const torsoGeo = trackGeo(new THREE.BoxGeometry(0.44, 0.58, 0.26))
  const torso = new THREE.Mesh(torsoGeo, shirtMat)
  torso.position.y = 1.04
  bodyPivot.add(torso)

  // Head + hair cap
  const headGeo = trackGeo(new THREE.SphereGeometry(0.175, 12, 10))
  const head = new THREE.Mesh(headGeo, skinMat)
  head.position.y = 1.52
  bodyPivot.add(head)

  const hairGeo = trackGeo(new THREE.SphereGeometry(0.184, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.58))
  const hair = new THREE.Mesh(hairGeo, hairMat)
  hair.position.y = 0.02
  head.add(hair)

  // Role-distinct lightweight 3D accessories (metalness <= 0.25)
  if (roleKind === 'student') {
    const packMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x2f4858, roughness: 0.85, metalness: 0.05 }))
    const pack = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.32, 0.4, 0.16)), packMat)
    pack.position.set(0, 1.06, -0.21)
    bodyPivot.add(pack)
  } else if (roleKind === 'commuter') {
    const bagMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x2a2623, roughness: 0.72, metalness: 0.15 }))
    const tieMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x8b2e26, roughness: 0.75, metalness: 0.05 }))
    const tie = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.06, 0.3, 0.03)), tieMat)
    tie.position.set(0, 1.08, 0.14)
    const bag = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.09, 0.28, 0.36)), bagMat)
    bag.position.set(-0.34, 0.78, 0.02)
    bodyPivot.add(tie, bag)
  } else if (roleKind === 'tourist') {
    const hatMat = trackMat(new THREE.MeshStandardMaterial({ color: 0xdcc38c, roughness: 0.9, metalness: 0.02 }))
    const brim = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.3, 0.32, 0.03, 14)), hatMat)
    brim.position.set(0, 0.13, 0)
    const crown = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(0.16, 0.18, 0.11, 12)), hatMat)
    crown.position.set(0, 0.19, 0)
    head.add(brim, crown)
    const camMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x242629, roughness: 0.55, metalness: 0.22 }))
    const cam = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.14, 0.1, 0.08)), camMat)
    cam.position.set(0, 1.06, 0.17)
    bodyPivot.add(cam)
  } else if (roleKind === 'gourmet') {
    const frameMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x3b2f24, roughness: 0.5, metalness: 0.22 }))
    const glasses = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.24, 0.05, 0.04)), frameMat)
    glasses.position.set(0, 0.02, 0.16)
    head.add(glasses)
    const trimMat = trackMat(new THREE.MeshStandardMaterial({ color: 0xc29b5a, roughness: 0.75, metalness: 0.1 }))
    const placket = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.05, 0.44, 0.02)), trimMat)
    placket.position.set(0, 1.04, 0.14)
    bodyPivot.add(placket)
  } else if (roleKind === 'rider') {
    const helmetColor = shirtHex.toLowerCase().startsWith('#2') || shirtHex.toLowerCase().startsWith('#3') ? 0x2b7cc4 : 0xe5a91e
    const helmetMat = trackMat(new THREE.MeshStandardMaterial({ color: helmetColor, roughness: 0.42, metalness: 0.2 }))
    const visorMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x1e242b, roughness: 0.28, metalness: 0.25 }))
    const helmet = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(0.21, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.65)), helmetMat)
    helmet.position.set(0, 0.03, 0)
    const visor = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.26, 0.09, 0.06)), visorMat)
    visor.position.set(0, 0.03, 0.18)
    head.add(helmet, visor)
    const box = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.38, 0.38, 0.3)), helmetMat)
    box.position.set(0, 1.1, -0.28)
    const stripeMat = trackMat(new THREE.MeshStandardMaterial({ color: 0xf4efe2, roughness: 0.6, metalness: 0.08 }))
    const stripe = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.39, 0.05, 0.31)), stripeMat)
    stripe.position.set(0, 1.16, -0.28)
    bodyPivot.add(box, stripe)
  }

  // Arms
  const armGeo = trackGeo(new THREE.BoxGeometry(0.12, 0.48, 0.12))
  const leftArm = new THREE.Group()
  leftArm.position.set(-0.29, 1.28, 0)
  const leftArmMesh = new THREE.Mesh(armGeo, shirtMat)
  leftArmMesh.position.y = -0.2
  leftArm.add(leftArmMesh)
  bodyPivot.add(leftArm)

  const rightArm = new THREE.Group()
  rightArm.position.set(0.29, 1.28, 0)
  const rightArmMesh = new THREE.Mesh(armGeo, shirtMat)
  rightArmMesh.position.y = -0.2
  rightArm.add(rightArmMesh)
  bodyPivot.add(rightArm)

  // Legs
  const legGeo = trackGeo(new THREE.BoxGeometry(0.15, 0.68, 0.16))
  const shoeGeo = trackGeo(new THREE.BoxGeometry(0.16, 0.1, 0.24))

  const leftLeg = new THREE.Group()
  leftLeg.position.set(-0.12, 0.74, 0)
  const leftLegMesh = new THREE.Mesh(legGeo, pantsMat)
  leftLegMesh.position.y = -0.34
  const leftShoe = new THREE.Mesh(shoeGeo, shoeMat)
  leftShoe.position.set(0, -0.68, 0.04)
  leftLeg.add(leftLegMesh, leftShoe)
  bodyPivot.add(leftLeg)

  const rightLeg = new THREE.Group()
  rightLeg.position.set(0.12, 0.74, 0)
  const rightLegMesh = new THREE.Mesh(legGeo, pantsMat)
  rightLegMesh.position.y = -0.34
  const rightShoe = new THREE.Mesh(shoeGeo, shoeMat)
  rightShoe.position.set(0, -0.68, 0.04)
  rightLeg.add(rightLegMesh, rightShoe)
  bodyPivot.add(rightLeg)

  // 将顾客全部 12~14 个身体/配饰块合批为 1 个共享主材的 SkinnedMesh（12 draws -> 1 draw）
  const headPivot = new THREE.Group()
  headPivot.position.copy(head.position)
  head.position.set(0, 0, 0)
  bodyPivot.remove(head)
  headPivot.add(head)
  bodyPivot.add(headPivot)

  const boneNodes: THREE.Object3D[] = [bodyPivot, headPivot, leftArm, rightArm, leftLeg, rightLeg]
  const boneMap = new Map<THREE.Object3D, number>(boneNodes.map((n, i) => [n, i]))
  root.updateMatrixWorld(true)
  const boneInverses = boneNodes.map(b => b.matrixWorld.clone().invert())

  const pList: number[] = []
  const nList: number[] = []
  const cList: number[] = []
  const sIdx: number[] = []
  const sWgt: number[] = []
  const tmpMeshes: THREE.Mesh[] = []
  const tv = new THREE.Vector3()
  const tn = new THREE.Vector3()
  const tc = new THREE.Color()

  bodyPivot.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return
    tmpMeshes.push(node)
    let cur: THREE.Object3D | null = node.parent
    let bIdx = 0
    while (cur) {
      const hit = boneMap.get(cur)
      if (hit !== undefined) {
        bIdx = hit
        break
      }
      cur = cur.parent
    }
    const src = node.geometry.index ? node.geometry.toNonIndexed() : node.geometry
    const pos = src.getAttribute('position')
    const nor = src.getAttribute('normal')
    const col = (node.material as THREE.MeshStandardMaterial).color
    tc.copy(col ?? new THREE.Color(0xffffff))
    for (let i = 0; i < pos.count; i++) {
      tv.fromBufferAttribute(pos, i).applyMatrix4(node.matrixWorld)
      pList.push(tv.x, tv.y, tv.z)
      if (nor) tn.fromBufferAttribute(nor, i).transformDirection(node.matrixWorld)
      else tn.set(0, 1, 0)
      nList.push(tn.x, tn.y, tn.z)
      cList.push(tc.r, tc.g, tc.b)
      sIdx.push(bIdx, 0, 0, 0)
      sWgt.push(1, 0, 0, 0)
    }
    if (src !== node.geometry) src.dispose()
  })
  for (const m of tmpMeshes) m.removeFromParent()
  for (const g of geometries) g.dispose()
  for (const m of materials) m.dispose()
  geometries.length = 0
  materials.length = 0

  const bakedGeo = trackGeo(new THREE.BufferGeometry())
  bakedGeo.setAttribute('position', new THREE.Float32BufferAttribute(pList, 3))
  bakedGeo.setAttribute('normal', new THREE.Float32BufferAttribute(nList, 3))
  bakedGeo.setAttribute('color', new THREE.Float32BufferAttribute(cList, 3))
  bakedGeo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(sIdx, 4))
  bakedGeo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sWgt, 4))
  bakedGeo.computeBoundingSphere()

  const customerSkinned = new THREE.SkinnedMesh(bakedGeo, getCustomerMasterMat())
  customerSkinned.frustumCulled = false
  const skeleton = new THREE.Skeleton(boneNodes as unknown as THREE.Bone[], boneInverses)
  customerSkinned.bind(skeleton, new THREE.Matrix4())
  root.add(customerSkinned)

  // Bowl anchor in front of hands
  const bowlAnchor = new THREE.Group()
  bowlAnchor.position.set(0, 1.05, 0.36)
  bodyPivot.add(bowlAnchor)

  const { bubbleSprite, bubbleCanvas, bubbleTexture } = attachBubble(root, materials)

  return {
    root,
    bodyPivot,
    head: headPivot,
    leftArm,
    rightArm,
    leftLeg,
    rightLeg,
    bowlAnchor,
    bubbleSprite,
    bubbleCanvas,
    bubbleTexture,
    lastBubbleKey: '',
    skeleton,
    disposables: { geometries, materials },
  }
}

export function createCustomerManager(
  scene: THREE.Scene,
  recipesData: MifenRecipesData,
  initialShop: TianyuanShopBuildResult,
  initialCoords: ShopCoordAdapter,
  events: CustomerEvents,
): CustomerManager {
  const container = new THREE.Group()
  container.name = 'tianyuan-mifen-customers'
  scene.add(container)
  // 与街上路人同源的角色模板，每个年龄段预热 2 个（手机端 1 个），未就绪时退回旧方块人
  const figurePool = createFigurePool(matchMedia('(pointer: coarse)').matches ? 1 : 2, 0x7d1a)

  let shop = initialShop
  let coords = initialCoords
  const customers: CustomerAgent[] = []
  let seq = 1
  let spawnCooldown = 1.6
  let leftAngryCount = 0
  let queueTurnawayCount = 0
  const spawnedByRole: Record<CustomerRoleKind, number> = {
    student: 0,
    commuter: 0,
    tourist: 0,
    gourmet: 0,
    rider: 0,
  }

  // Fair 5-role bag ensures all 5 distinct customer types appear quickly without drought
  let roleBag: CustomerRoleKind[] = [...ALL_ROLES]

  const tmpVec = new THREE.Vector3()
  const tmpLocal = new THREE.Vector3()
  const tmpBubbleWorld = new THREE.Vector3()

  // Merge recipes.json praise/impatient lines into the 5 canonical profiles where matching
  const profiles: RichCustomerArchetype[] = FIVE_CUSTOMER_PROFILES.map(base => {
    const ext = (recipesData.customerTypes ?? []).find(
      c =>
        (base.roleKind === 'commuter' && c.id === 'shizijie_commuter') ||
        (base.roleKind === 'tourist' && c.id === 'xhs_tourist') ||
        (base.roleKind === 'gourmet' && (c.id === 'sanduo_neighbor' || c.id === 'late_night_foodie')),
    )
    if (!ext) return base
    return {
      ...base,
      favoriteRecipes: ext.favoriteRecipes?.length ? ext.favoriteRecipes : base.favoriteRecipes,
      preferredCondiments: ext.preferredCondiments?.length ? ext.preferredCondiments : base.preferredCondiments,
    }
  })

  const condimentNameMap = new Map<string, string>(
    (recipesData.condiments ?? []).map(item => [item.id, item.name]),
  )

  function resolveCondimentName(idOrName: string): string {
    return condimentNameMap.get(idOrName) ?? idOrName
  }

  function nextRole(hour: number): CustomerRoleKind {
    if (!roleBag.length) {
      const timeMod = getTimeAndTrafficModifiers(hour, readRuntimeReputation(events))
      roleBag = [...ALL_ROLES]
      if (timeMod.isMorningRush) {
        roleBag.push('commuter', 'rider', 'student')
      } else if (timeMod.phase === 'midday' || timeMod.phase === 'afternoon') {
        roleBag.push('tourist', 'rider')
      } else if (timeMod.phase === 'evening') {
        roleBag.push('gourmet', 'rider')
      }
      // Fisher-Yates shuffle
      for (let i = roleBag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        const t = roleBag[i]
        roleBag[i] = roleBag[j]
        roleBag[j] = t
      }
    }
    return roleBag.shift() ?? 'student'
  }

  function updateRosterUserData(): void {
    const activeByRole: Record<CustomerRoleKind, number> = {
      student: 0,
      commuter: 0,
      tourist: 0,
      gourmet: 0,
      rider: 0,
    }
    for (const c of customers) {
      if (c.phase !== 'leaving') activeByRole[c.roleKind] += 1
    }
    container.userData.rosterSummary = {
      activeByRole,
      spawnedByRole: { ...spawnedByRole },
      leftAngryCount,
      queueTurnawayCount,
      queueCount: customers.filter(c => c.phase === 'queuing' || c.phase === 'entering').length,
      totalActive: customers.filter(c => c.phase !== 'leaving').length,
    }
  }

  function updateBubbleTransform(c: CustomerAgent, cameraPos?: THREE.Vector3): void {
    const sprite = c.rig.bubbleSprite
    const seatedPose = c.rig.bodyPivot.position.y < -0.1
    const yOffset = seatedPose ? 1.84 : 2.04
    sprite.position.y = yOffset

    if (!cameraPos) {
      sprite.visible = true
      sprite.scale.set(BUBBLE_BASE_W * 0.65, BUBBLE_BASE_H * 0.65, 1)
      ;(sprite.material as THREE.SpriteMaterial).opacity = 0.92
      return
    }

    tmpBubbleWorld.set(c.rig.root.position.x, c.rig.root.position.y + yOffset, c.rig.root.position.z)
    const dist = tmpBubbleWorld.distanceTo(cameraPos)
    if (dist >= BUBBLE_FADE_FAR_END) {
      sprite.visible = false
      return
    }

    sprite.visible = true
    const distFactor = Math.max(BUBBLE_MIN_SCALE, Math.min(1, dist / BUBBLE_REF_DIST))
    sprite.scale.set(BUBBLE_BASE_W * distFactor, BUBBLE_BASE_H * distFactor, 1)

    const farAlpha =
      dist <= BUBBLE_FADE_FAR_START
        ? 1
        : Math.max(0, 1 - (dist - BUBBLE_FADE_FAR_START) / (BUBBLE_FADE_FAR_END - BUBBLE_FADE_FAR_START))
    const nearAlpha =
      dist >= BUBBLE_FADE_NEAR_START
        ? 1
        : 0.35 + 0.65 * Math.max(0, (dist - BUBBLE_FADE_NEAR_END) / (BUBBLE_FADE_NEAR_START - BUBBLE_FADE_NEAR_END))
    ;(sprite.material as THREE.SpriteMaterial).opacity = 0.92 * Math.min(farAlpha, nearAlpha)
  }

  function getEntranceLocal(): THREE.Vector3 {
    const w = coords.toWorldPoint(shop.entrance, new THREE.Vector3())
    return coords.toLocalPoint(w, new THREE.Vector3())
  }

  function clampHallLocal(lx: number, lz: number): [number, number] {
    const wb = shop.walkBounds
    if (Math.abs(wb.minX) < 120) {
      const minX = wb.minX + 0.55
      const maxX = wb.maxX - 0.55
      const minZ = Math.max(wb.minZ + 0.55, 0.55)
      const maxZ = wb.maxZ - 0.45
      return [Math.min(maxX, Math.max(minX, lx)), Math.min(maxZ, Math.max(minZ, lz))]
    }
    return [lx, lz]
  }

  function getQueueWorldPos(slotIndex: number): THREE.Vector3 {
    const pts = shop.queuePoints
    const lateralStagger = slotIndex === 0 ? 0 : slotIndex % 2 === 1 ? -0.22 : 0.22
    if (pts.length > 0) {
      const clamped = Math.min(pts.length - 1, Math.max(0, slotIndex))
      const base = coords.toWorldPoint(pts[clamped], new THREE.Vector3())
      const loc = coords.toLocalPoint(base, new THREE.Vector3())
      loc.x += lateralStagger
      if (slotIndex >= pts.length) {
        loc.z += (slotIndex - pts.length + 1) * 0.92
      }
      const entLoc = getEntranceLocal()
      if (loc.z < entLoc.z - 0.3) {
        const [cx, cz] = clampHallLocal(loc.x, loc.z)
        loc.x = cx
        loc.z = cz
      }
      return coords.localToWorld(loc.x, loc.y, loc.z, new THREE.Vector3())
    }
    const entLoc = getEntranceLocal()
    return coords.localToWorld(entLoc.x - 0.8 + lateralStagger, 0, entLoc.z - 1.2 + slotIndex * 0.9, new THREE.Vector3())
  }

  function getCounterPickupWorldPos(): THREE.Vector3 {
    const cWorld = coords.toWorldPoint(shop.stations.counter, new THREE.Vector3())
    const cLoc = coords.toLocalPoint(cWorld, new THREE.Vector3())
    // 前台明档柜台占 x∈[0,3.35], z∈[1.25,1.85]，顾客站在柜台外侧客区（z≈2.28）伸手接碗，绝不穿柜体
    const [px, pz] = clampHallLocal(Math.max(1.2, Math.min(2.25, cLoc.x - 0.1)), Math.max(2.25, cLoc.z + 1.56))
    return coords.localToWorld(px, cLoc.y, pz, new THREE.Vector3())
  }

  function getToppingStandWorldPos(agentIndex: number): THREE.Vector3 {
    const tWorld = coords.toWorldPoint(shop.stations.toppings, new THREE.Vector3())
    const tLoc = coords.toLocalPoint(tWorld, new THREE.Vector3())
    // 自助小料台靠西墙（-X），严格在柜台东侧通道（+X）按 Z 轴错位站定，避免插穿墙体或小料台
    const zOffset = ((agentIndex % 3) - 1) * 0.48
    const [tx, tz] = clampHallLocal(tLoc.x + 0.55, tLoc.z + zOffset)
    return coords.localToWorld(tx, tLoc.y, tz, new THREE.Vector3())
  }

  function reassignQueueSlots(): void {
    const queued = customers.filter(
      c => c.phase === 'approaching' || c.phase === 'entering' || c.phase === 'queuing',
    )
    queued.forEach((c, idx) => {
      c.queueSlot = idx
      const slotPos = getQueueWorldPos(idx)
      if (c.phase === 'queuing') {
        c.targetPos.copy(slotPos)
      } else if (c.waypoints.length > 0) {
        c.waypoints[c.waypoints.length - 1].copy(slotPos)
      }
    })
  }

  function pickFreeSeat(): ShopSeat | null {
    const used = new Set(customers.map(c => c.seatId).filter((id): id is string => !!id))
    const free = shop.seats.filter(s => !used.has(s.id))
    if (!free.length) return null
    return free[Math.floor(Math.random() * free.length)]
  }

  function portionToCount(p: MifenRecipe['portion']): 1 | 2 | 3 {
    if (p === '三两') return 3
    if (p === '一两') return 1
    return 2
  }

  function updateBubble(c: CustomerAgent): void {
    const cookingNow = events.getActiveCookingTicketId() === c.id
    let patienceRatio: number | undefined
    let key = ''
    let stars: 1 | 2 | 3 | undefined

    if (c.phase === 'queuing') {
      const ratio = Math.max(0, Math.min(1, c.patienceLeft / Math.max(1, c.patienceMax)))
      const bucket = Math.round(ratio * 20)
      patienceRatio = ratio
      key = `q:${c.roleKind}:${c.recipe.id}:${bucket}:${cookingNow ? 1 : 0}`
    } else if (c.phase === 'pickup') {
      stars = c.served?.stars ?? 3
      key = `pickup:${c.roleKind}:${stars}`
    } else if (c.phase === 'seated') {
      stars = c.served?.stars ?? 3
      key = `eat:${c.roleKind}:${stars}`
    } else if (c.phase === 'leaving') {
      key = `leave:${c.roleKind}:${c.angry ? 1 : 0}`
    } else {
      key = `${c.phase}:${c.roleKind}:${c.recipe.id}`
    }

    if (c.rig.lastBubbleKey !== key) {
      c.rig.lastBubbleKey = key
      drawGraphicalBubble(c.rig.bubbleCanvas, c.rig.bubbleTexture, {
        roleKind: c.roleKind,
        phase: c.phase,
        portionCount: portionToCount(c.recipe.portion),
        meats: c.recipe.requiredMeats,
        brothStyle: c.recipe.brothStyle,
        cookingNow,
        patienceRatio,
        stars,
        angry: c.angry,
      })
    }
  }

  function removeCustomer(index: number): void {
    const c = customers[index]
    if (!c) return
    if (c.bowlMesh) {
      disposeObject3D(c.bowlMesh)
      c.bowlMesh.removeFromParent()
      c.bowlMesh = null
    }
    c.rig.skeleton?.dispose()
    c.rig.figure?.inst.dispose()
    c.rig.bubbleTexture.dispose()
    for (const g of c.rig.disposables.geometries) g.dispose()
    for (const m of c.rig.disposables.materials) if (!m.userData?.sharedCached) m.dispose()
    c.rig.root.removeFromParent()
    customers.splice(index, 1)
    updateRosterUserData()
  }

  function getEffectiveCap(level: ShopLevel, isRush: boolean): number {
    const base = getMaxCustomersForLevel(level)
    return isRush ? base + 2 : base
  }

  function isEarningEnabled(): boolean {
    return events.canEarn ? Boolean(events.canEarn()) : true
  }

  function spawnCustomerNow(
    immediate = false,
    forceRole?: CustomerRoleKind,
  ): { id: string; recipeId: string; name: string } | null {
    if (!forceRole && !isEarningEnabled()) return null
    const hour = readRuntimeHour(events)
    const timeMod = getTimeAndTrafficModifiers(hour, readRuntimeReputation(events))
    const maxCap = getEffectiveCap(events.getShopLevel(), timeMod.isMorningRush)
    const activeNonLeaving = customers.filter(c => c.phase !== 'leaving').length
    const queueLimit = Math.max(3, shop.queuePoints.length + (timeMod.isMorningRush ? 2 : 0))
    const currentQueue = customers.filter(
      c => c.phase === 'approaching' || c.phase === 'entering' || c.phase === 'queuing',
    ).length

    if (!forceRole && activeNonLeaving >= maxCap) return null

    const roleKind = forceRole ?? nextRole(hour)
    const archetype = profiles.find(p => p.roleKind === roleKind) ?? profiles[0]
    const favPool = (recipesData.recipes ?? []).filter(r => archetype.favoriteRecipes?.includes(r.id))
    const recipe = pickRandom(favPool.length ? favPool : recipesData.recipes ?? [], FALLBACK_RECIPE)
    const shirt = pickRandom(archetype.shirtColors, '#3b6ea5')
    const bonuses = events.getBonuses()

    const id = `cust-${seq++}`
    const titleSuffix = pickRandom(ROLE_TITLES[roleKind], archetype.name)
    const displayName = `${pickRandom(SURNAMES, '陈')}${titleSuffix}·${archetype.name}`
    const figureTemplate = figurePool.take(ROLE_AGE[roleKind])
    const rig = figureTemplate ? buildFigureCustomerRig(figureTemplate) : buildCustomerRig(shirt, roleKind)

    const entLocal = getEntranceLocal()
    const side: -1 | 1 = Math.random() < 0.5 ? -1 : 1
    const startLocalX = immediate ? entLocal.x + side * 1.3 : entLocal.x + side * (9.0 + Math.random() * 4.0)
    const sidewalkZ = entLocal.z + (immediate ? 1.8 : 3.2 + Math.random() * 0.9)
    const spawnWorld = coords.localToWorld(startLocalX, 0, sidewalkZ, new THREE.Vector3())
    spawnWorld.y = coords.sampleWalkY(spawnWorld.x, spawnWorld.z, false)

    rig.root.position.copy(spawnWorld)
    container.add(rig.root)
    mainDetail(rig.root)

    // Queue overflow turnaway during peak rush (does not block forced test spawns)
    if (!forceRole && !immediate && currentQueue >= queueLimit) {
      queueTurnawayCount += 1
      const glancePoint = coords.localToWorld(entLocal.x + side * 1.1, 0, entLocal.z + 2.2, new THREE.Vector3())
      const leavePoint = coords.localToWorld(entLocal.x - side * 15.0, 0, entLocal.z + 3.4, new THREE.Vector3())
      const turnaway: CustomerAgent = {
        id,
        name: displayName,
        roleKind,
        archetype,
        recipe,
        phase: 'leaving',
        rig,
        waypoints: [glancePoint, leavePoint],
        targetPos: glancePoint.clone(),
        speed: 1.7,
        walkPhase: Math.random() * Math.PI * 2,
        patienceMax: 20,
        patienceLeft: 0,
        queueSlot: -1,
        seatId: null,
        seatWorldYaw: 0,
        stateTimer: 0,
        eatPhase: 0,
        bowlDelivered: false,
        served: null,
        bowlMesh: null,
        angry: true,
        chosenCondiments: [],
        leaveSide: side === 1 ? -1 : 1,
      }
      customers.push(turnaway)
      spawnedByRole[roleKind] += 1
      updateBubble(turnaway)
      updateRosterUserData()
      return { id: turnaway.id, recipeId: turnaway.recipe.id, name: turnaway.name }
    }

    const doorOutside = coords.localToWorld(entLocal.x, 0, entLocal.z + 1.4, new THREE.Vector3())
    const doorInside = coords.localToWorld(entLocal.x, 0, entLocal.z - 0.8, new THREE.Vector3())
    const queueSlot = currentQueue
    const queuePos = getQueueWorldPos(queueSlot)

    const condimentPool = archetype.preferredCondiments?.length
      ? archetype.preferredCondiments.map(resolveCondimentName)
      : (recipesData.condiments ?? []).map(c => c.name)
    const chosenCondiments = condimentPool.slice(0, 2)

    // Rider & commuter move brisker and have tighter rush patience
    const baseSpeed = roleKind === 'rider' ? 2.05 : roleKind === 'commuter' ? 1.85 : 1.55
    const patienceMax = Math.max(
      24,
      Math.round((archetype.patienceSec || 60) * bonuses.patienceMultiplier + bonuses.patienceBonusSec),
    )

    const agent: CustomerAgent = {
      id,
      name: displayName,
      roleKind,
      archetype,
      recipe,
      phase: immediate ? 'entering' : 'approaching',
      rig,
      waypoints: immediate ? [doorInside, queuePos] : [doorOutside, doorInside, queuePos],
      targetPos: (immediate ? doorInside : doorOutside).clone(),
      speed: baseSpeed + Math.random() * 0.25,
      walkPhase: Math.random() * Math.PI * 2,
      patienceMax,
      patienceLeft: patienceMax,
      queueSlot,
      seatId: null,
      seatWorldYaw: 0,
      stateTimer: 0,
      eatPhase: 0,
      bowlDelivered: false,
      served: null,
      bowlMesh: null,
      angry: false,
      chosenCondiments,
      leaveSide: side === 1 ? -1 : 1,
    }

    customers.push(agent)
    spawnedByRole[roleKind] += 1
    reassignQueueSlots()
    updateBubble(agent)
    updateRosterUserData()
    return { id: agent.id, recipeId: agent.recipe.id, name: agent.name }
  }

  function startLeaving(c: CustomerAgent, angry: boolean, keepBowl = false): void {
    c.phase = 'leaving'
    c.angry = angry
    c.seatId = null
    if (angry) leftAngryCount += 1
    if (!keepBowl && c.bowlMesh) {
      disposeObject3D(c.bowlMesh)
      c.bowlMesh.removeFromParent()
      c.bowlMesh = null
    }
    c.rig.bodyPivot.position.y = 0
    c.rig.leftLeg.rotation.x = 0
    c.rig.rightLeg.rotation.x = 0

    const entLocal = getEntranceLocal()
    const curLocal = coords.toLocalPoint(c.rig.root.position, tmpLocal)
    const exitPoints: THREE.Vector3[] = []
    if (curLocal.z < entLocal.z + 0.8) {
      exitPoints.push(coords.localToWorld(entLocal.x, 0, entLocal.z + 1.4, new THREE.Vector3()))
    }
    exitPoints.push(
      coords.localToWorld(entLocal.x + c.leaveSide * 15.5, 0, entLocal.z + 3.4, new THREE.Vector3()),
    )
    c.waypoints = exitPoints
    c.targetPos.copy(exitPoints[0])
    updateBubble(c)
    reassignQueueSlots()
    updateRosterUserData()
  }

  function moveTowardTarget(c: CustomerAgent, dt: number): boolean {
    const pos = c.rig.root.position
    const dx = c.targetPos.x - pos.x
    const dz = c.targetPos.z - pos.z
    const dist = Math.hypot(dx, dz)

    if (dist < 0.16) {
      pos.x = c.targetPos.x
      pos.z = c.targetPos.z
      c.rig.leftLeg.rotation.x *= 0.7
      c.rig.rightLeg.rotation.x *= 0.7
      if (!c.bowlMesh) {
        c.rig.leftArm.rotation.x *= 0.7
        c.rig.rightArm.rotation.x *= 0.7
      }
      return true
    }

    const stepDist = Math.min(dist, c.speed * dt)
    pos.x += (dx / dist) * stepDist
    pos.z += (dz / dist) * stepDist

    const loc = coords.toLocalPoint(pos, tmpLocal)
    const entLoc = getEntranceLocal()
    const inside = loc.z <= entLoc.z + 0.45
    pos.y = coords.sampleWalkY(pos.x, pos.z, inside)

    const targetYaw = Math.atan2(dx, dz)
    const diff = Math.atan2(Math.sin(targetYaw - c.rig.root.rotation.y), Math.cos(targetYaw - c.rig.root.rotation.y))
    c.rig.root.rotation.y += diff * Math.min(1, dt * 10)

    c.walkPhase += dt * c.speed * 5.2
    const swing = Math.sin(c.walkPhase) * 0.55
    c.rig.leftLeg.rotation.x = swing
    c.rig.rightLeg.rotation.x = -swing
    if (c.bowlMesh) {
      c.rig.leftArm.rotation.x = -0.95
      c.rig.rightArm.rotation.x = -0.95
    } else {
      c.rig.leftArm.rotation.x = -swing * 0.7
      c.rig.rightArm.rotation.x = swing * 0.7
    }
    c.rig.bodyPivot.position.y = Math.abs(Math.sin(c.walkPhase)) * 0.04
    return false
  }

  function advanceWaypoints(c: CustomerAgent): boolean {
    if (c.waypoints.length > 1) {
      c.waypoints.shift()
      c.targetPos.copy(c.waypoints[0])
      return false
    }
    return true
  }

  function attachDeliveredBowl(c: CustomerAgent, completion: CookCompletion): void {
    if (c.bowlMesh) {
      disposeObject3D(c.bowlMesh)
      c.bowlMesh.removeFromParent()
    }
    const bowl = createMifenBowlMesh(completion.bowlOpts)
    bowl.scale.setScalar(1.0)
    c.rig.bowlAnchor.add(bowl)
    c.bowlMesh = bowl
    c.bowlDelivered = true
    c.rig.leftArm.rotation.x = -0.95
    c.rig.rightArm.rotation.x = -0.95
  }

  function serveCustomer(completion: CookCompletion): boolean {
    const c = customers.find(
      item =>
        item.id === completion.ticketId &&
        (item.phase === 'approaching' || item.phase === 'entering' || item.phase === 'queuing'),
    )
    if (!c) return false

    c.served = completion
    c.bowlDelivered = false
    c.phase = 'pickup'
    c.stateTimer = 0.55

    const pickupWorld = getCounterPickupWorldPos()
    const entLocal = getEntranceLocal()
    const curLocal = coords.toLocalPoint(c.rig.root.position, tmpLocal)
    const path: THREE.Vector3[] = []
    if (curLocal.z > entLocal.z - 0.1) {
      path.push(coords.localToWorld(entLocal.x, 0, entLocal.z - 0.65, new THREE.Vector3()))
    }
    path.push(pickupWorld)
    c.waypoints = path
    c.targetPos.copy(path[0])

    updateBubble(c)
    reassignQueueSlots()
    updateRosterUserData()
    return true
  }

  return {
    step(dt, nearShop, cameraPos) {
      const safeDt = Math.min(0.1, Math.max(0, dt))
      const earning = isEarningEnabled()
      if (!earning) {
        for (const c of customers) {
          syncCustomerFigure(c, safeDt)
          updateBubbleTransform(c, cameraPos)
        }
        return
      }
      const level = events.getShopLevel()
      const bonuses = events.getBonuses()
      const hour = readRuntimeHour(events)
      const timeMod = getTimeAndTrafficModifiers(hour, readRuntimeReputation(events))
      const maxCap = getEffectiveCap(level, timeMod.isMorningRush)

      // 仅当剧情已解锁且玩家在店内时刷客；否则不刷客且保持门禁静默
      if (earning) {
        const rushSpawnFactor = Math.max(0.5, timeMod.trafficMultiplier)
        spawnCooldown -= safeDt * bonuses.spawnRateMultiplier * rushSpawnFactor
        const activeCount = customers.filter(c => c.phase !== 'leaving').length
        if (spawnCooldown <= 0 && activeCount < maxCap) {
          spawnCustomerNow(false)
          const baseInterval = nearShop ? (level === 3 ? 4.8 : level === 2 ? 6.2 : 7.8) : 12.0
          spawnCooldown = baseInterval + Math.random() * 2.4
        }
      }

      const activeCookingId = events.getActiveCookingTicketId()
      const counterWorld = coords.toWorldPoint(shop.stations.counter, tmpVec)
      const queueLength = customers.filter(c => c.phase === 'queuing' || c.phase === 'entering').length
      const crowdPatienceRate = computeQueuePatienceRate(queueLength, bonuses.patienceMultiplier)

      for (let i = customers.length - 1; i >= 0; i--) {
        const c = customers[i]

        if (c.phase === 'approaching') {
          if (moveTowardTarget(c, safeDt) && advanceWaypoints(c)) {
            c.phase = 'queuing'
            updateBubble(c)
          } else if (c.waypoints.length <= 2) {
            c.phase = 'entering'
            updateBubble(c)
          }
        } else if (c.phase === 'entering') {
          if (moveTowardTarget(c, safeDt) && advanceWaypoints(c)) {
            c.phase = 'queuing'
            updateBubble(c)
          }
        } else if (c.phase === 'queuing') {
          const arrived = moveTowardTarget(c, safeDt)
          if (arrived) {
            const lookYaw = Math.atan2(counterWorld.x - c.rig.root.position.x, counterWorld.z - c.rig.root.position.z)
            const diff = Math.atan2(Math.sin(lookYaw - c.rig.root.rotation.y), Math.cos(lookYaw - c.rig.root.rotation.y))
            c.rig.root.rotation.y += diff * Math.min(1, safeDt * 8)
            c.rig.bodyPivot.position.y = Math.sin(performance.now() * 0.004 + i) * 0.012
          }

          if (earning) {
            // Peak queue compound drain; active cooking slows drain for that ticket
            const slotPressure = 1 + Math.max(0, c.queueSlot - 1) * 0.08
            const drainRate = activeCookingId === c.id ? 0.2 : crowdPatienceRate * slotPressure
            c.patienceLeft = Math.max(0, c.patienceLeft - safeDt * drainRate)
            updateBubble(c)

            if (c.patienceLeft <= 0) {
              const line = pickRandom(c.archetype.impatientLines ?? [], '等太久先走了')
              events.onCustomerImpatient({ customerName: c.name, line })
              startLeaving(c, true)
            }
          }
        } else if (c.phase === 'pickup') {
          if (moveTowardTarget(c, safeDt) && advanceWaypoints(c)) {
            const lookYaw = Math.atan2(counterWorld.x - c.rig.root.position.x, counterWorld.z - c.rig.root.position.z)
            const diff = Math.atan2(Math.sin(lookYaw - c.rig.root.rotation.y), Math.cos(lookYaw - c.rig.root.rotation.y))
            c.rig.root.rotation.y += diff * Math.min(1, safeDt * 12)
            // 前台明档接碗动作：双臂前伸接过热粉
            if (!c.bowlDelivered && c.served) {
              attachDeliveredBowl(c, c.served)
            }
            c.stateTimer -= safeDt
            const reach = Math.sin(Math.max(0, c.stateTimer / 0.55) * Math.PI) * 0.22
            c.rig.leftArm.rotation.x = -0.95 - reach
            c.rig.rightArm.rotation.x = -0.95 - reach
            c.rig.head.rotation.x = reach * 0.6

            if (c.stateTimer <= 0) {
              c.rig.head.rotation.x = 0
              c.rig.leftArm.rotation.x = -0.95
              c.rig.rightArm.rotation.x = -0.95
              if (c.roleKind === 'rider' && c.served) {
                const praise = pickRandom(c.archetype.praiseLines, '准点出单')
                events.onCustomerFinished({
                  customerName: c.name,
                  recipeName: c.recipe.name,
                  stars: c.served.stars,
                  revenue: c.served.basePrice,
                  tip: c.served.tip,
                  praiseLine: praise,
                })
                startLeaving(c, false, true)
              } else {
                c.phase = 'toppings'
                c.stateTimer = 2.2 + Math.random() * 1.0
                const toppingStand = getToppingStandWorldPos(i)
                c.waypoints = [toppingStand]
                c.targetPos.copy(toppingStand)
                updateBubble(c)
                updateRosterUserData()
              }
            }
          }
        } else if (c.phase === 'toppings') {
          if (moveTowardTarget(c, safeDt)) {
            const topWorld = coords.toWorldPoint(shop.stations.toppings, tmpVec)
            const lookYaw = Math.atan2(topWorld.x - c.rig.root.position.x, topWorld.z - c.rig.root.position.z)
            const diff = Math.atan2(Math.sin(lookYaw - c.rig.root.rotation.y), Math.cos(lookYaw - c.rig.root.rotation.y))
            c.rig.root.rotation.y += diff * Math.min(1, safeDt * 8)

            c.stateTimer -= safeDt
            c.eatPhase += safeDt * 6.5
            c.rig.head.rotation.x = 0.14 + Math.sin(c.eatPhase) * 0.12
            c.rig.rightArm.rotation.x = -0.95 + Math.sin(c.eatPhase) * 0.22
            if (c.stateTimer <= 0) {
              c.rig.head.rotation.x = 0
              c.rig.rightArm.rotation.x = -0.95
              const seat = pickFreeSeat()
              if (seat) {
                c.seatId = seat.id
                c.seatWorldYaw = coords.toWorldYaw(seat.yaw, seat.pos)
                const seatWorld = coords.toWorldPoint(seat.pos, new THREE.Vector3())
                const entLoc = getEntranceLocal()
                if (seat.zone === 'sidewalk') {
                  const doorOut = coords.localToWorld(entLoc.x, 0, entLoc.z + 1.2, new THREE.Vector3())
                  c.waypoints = [doorOut, seatWorld]
                } else {
                  c.waypoints = [seatWorld]
                }
                c.targetPos.copy(c.waypoints[0])
              } else {
                const entLoc = getEntranceLocal()
                const spot = coords.localToWorld(entLoc.x + (i % 2 === 0 ? -2.2 : 2.2), 0, entLoc.z + 2.1, new THREE.Vector3())
                c.waypoints = [spot]
                c.targetPos.copy(spot)
                c.seatWorldYaw = shop.group.rotation.y
              }
              c.phase = 'seated'
              c.stateTimer = 6.0 + Math.random() * 2.5
              updateBubble(c)
              updateRosterUserData()
            }
          }
        } else if (c.phase === 'seated') {
          if (moveTowardTarget(c, safeDt) && advanceWaypoints(c)) {
            const diff = Math.atan2(
              Math.sin(c.seatWorldYaw - c.rig.root.rotation.y),
              Math.cos(c.seatWorldYaw - c.rig.root.rotation.y),
            )
            c.rig.root.rotation.y += diff * Math.min(1, safeDt * 8)
            c.rig.bodyPivot.position.y = -0.26
            c.rig.leftLeg.rotation.x = -1.25
            c.rig.rightLeg.rotation.x = -1.25
            c.eatPhase += safeDt * 5.8
            c.rig.head.rotation.x = 0.18 + Math.sin(c.eatPhase) * 0.14
            c.rig.rightArm.rotation.x = -0.95 + Math.sin(c.eatPhase) * 0.18

            c.stateTimer -= safeDt
            if (c.stateTimer <= 0) {
              c.rig.head.rotation.x = 0
              const result = c.served
              if (result) {
                const praise = pickRandom(c.archetype.praiseLines ?? [], '地道桂林味')
                events.onCustomerFinished({
                  customerName: c.name,
                  recipeName: c.recipe.name,
                  stars: result.stars,
                  revenue: result.basePrice,
                  tip: result.tip,
                  praiseLine: praise,
                })
              }
              startLeaving(c, false)
            }
          }
        } else if (c.phase === 'leaving') {
          if (moveTowardTarget(c, safeDt) && advanceWaypoints(c)) {
            removeCustomer(i)
            continue
          }
        }
        syncCustomerFigure(c, safeDt)
        updateBubbleTransform(c, cameraPos)
      }
    },

    onShopChanged(nextShop, nextCoords) {
      shop = nextShop
      coords = nextCoords
      reassignQueueSlots()
      for (const c of customers) {
        if (c.seatId && !shop.seats.some(s => s.id === c.seatId)) {
          const replacement = pickFreeSeat()
          if (replacement) {
            c.seatId = replacement.id
            c.seatWorldYaw = coords.toWorldYaw(replacement.yaw, replacement.pos)
            c.targetPos.copy(coords.toWorldPoint(replacement.pos, new THREE.Vector3()))
          } else {
            c.seatId = null
          }
        }
      }
    },

    spawnCustomerNow,

    getQueuedTickets() {
      if (!isEarningEnabled()) return []
      const cookingId = events.getActiveCookingTicketId()
      return customers
        .filter(c => c.phase === 'queuing' || c.phase === 'entering')
        .sort((a, b) => a.queueSlot - b.queueSlot)
        .map(c => ({
          id: c.id,
          customerName: c.name,
          archetype: c.archetype,
          recipe: c.recipe,
          patienceRatio: Math.max(0, Math.min(1, c.patienceLeft / Math.max(1, c.patienceMax))),
          patienceSecLeft: Math.ceil(c.patienceLeft),
          beingCooked: cookingId === c.id,
        }))
    },

    getTicketById(id) {
      return this.getQueuedTickets().find(t => t.id === id) ?? null
    },

    serveCustomer,

    getActiveCount() {
      return customers.filter(c => c.phase !== 'leaving').length
    },

    getQueueCount() {
      return customers.filter(c => c.phase === 'queuing' || c.phase === 'entering').length
    },

    getSeatedCount() {
      return customers.filter(c => c.phase === 'seated').length
    },

    getSummary() {
      let queuing = 0
      let pickup = 0
      let toppings = 0
      let seated = 0
      let leaving = 0
      for (const c of customers) {
        if (c.phase === 'queuing' || c.phase === 'entering' || c.phase === 'approaching') queuing++
        else if (c.phase === 'pickup') pickup++
        else if (c.phase === 'toppings') toppings++
        else if (c.phase === 'seated') seated++
        else leaving++
      }
      return { total: customers.length, queuing, pickup, toppings, seated, leaving }
    },

    getBubbleMetrics(cameraPos) {
      return customers.map(c => {
        const s = c.rig.bubbleSprite
        tmpBubbleWorld.set(c.rig.root.position.x, c.rig.root.position.y + s.position.y, c.rig.root.position.z)
        const dist = cameraPos ? tmpBubbleWorld.distanceTo(cameraPos) : 0
        return {
          id: c.id,
          roleKind: c.roleKind,
          roleName: c.archetype.name,
          phase: c.phase,
          visible: s.visible,
          dist: Math.round(dist * 100) / 100,
          scaleX: Math.round(s.scale.x * 1000) / 1000,
          scaleY: Math.round(s.scale.y * 1000) / 1000,
          opacity: Math.round((s.material as THREE.SpriteMaterial).opacity * 100) / 100,
        }
      })
    },

    setVisible(visible: boolean) {
      if (container.visible !== visible) container.visible = visible
    },

    clearAll() {
      for (let i = customers.length - 1; i >= 0; i--) {
        removeCustomer(i)
      }
      spawnCooldown = 0.6
      updateRosterUserData()
    },

    dispose() {
      for (let i = customers.length - 1; i >= 0; i--) {
        removeCustomer(i)
      }
      figurePool.dispose()
      container.removeFromParent()
    },
  }
}
