import type {
  CustomerArchetype,
  InventoryStock,
  MifenBowlOptions,
  MifenRecipe,
  ShopLevel,
  ToppingKey,
} from './types.ts'
import { createDefaultInventory, formatMoney, formatRecipeTitle, roundMoney, type ShopEquipmentBonuses } from './state.ts'
import { createEconomyEventBus, type EconomyEventBus } from './economy/events.ts'
import { settleDineInOrder } from './economy/rush.ts'
import type { MifenSoundId } from './audio/catalog.ts'

/** 物理三工位顺序：后厨煮锅台 -> 后厨肉台 -> 前台明档淋卤出餐 */
export type CookingStation = 'boil' | 'meat' | 'counter'
export type CookingStep = 'boil' | 'meat' | 'broth' | 'plate'
export type CookingStage =
  | 'idle'
  | 'boil'
  | 'carry_to_meat'
  | 'meat'
  | 'carry_to_counter'
  | 'counter'
  | 'serving'

export type StepQuality = 'perfect' | 'good' | 'miss'
export type CookGrade = 'good' | 'medium' | 'poor'

export const COOKING_STATION_ORDER: readonly CookingStation[] = ['boil', 'meat', 'counter']

export const COOKING_STATION_LABELS: Record<CookingStation, string> = {
  boil: '煮锅台',
  meat: '肉台',
  counter: '前台明档',
}

export interface ActiveCookOrder {
  ticketId: string
  customerName: string
  archetype: CustomerArchetype & { roleKind?: string; bidMultiplier?: number }
  recipe: MifenRecipe
}

export interface CookCompletion {
  ticketId: string
  recipe: MifenRecipe
  stars: 1 | 2 | 3
  grade: CookGrade
  score: number
  basePrice: number
  tip: number
  totalPayout: number
  reputationDelta: number
  streak: number
  isMorningRush: boolean
  boilQuality: StepQuality
  meatQuality: StepQuality
  meatOrderExact: boolean
  brineQuality: StepQuality
  addedMeats: ToppingKey[]
  chiliOil: boolean
  bowlOpts: MifenBowlOptions & {
    hasGuoshao: boolean
    hasBeef: boolean
    hasEgg: boolean
    hasToppings: boolean
  }
}

export interface CookingEconomyContext {
  hour: number
  reputation: number
  shopLevel: ShopLevel
  streak: number
  inventory?: Readonly<InventoryStock>
}

export type CookingBowlLocation = 'hidden' | 'boil' | 'carry' | 'meat' | 'counter' | 'serve'

/** 暴露给 3D 工位动画（沸锅竹笊篱、肉台切码菜刀、前台淋卤长勺与实体粉碗）的逐帧进度快照 */
export interface CookingVisualState {
  active: boolean
  ticketId: string | null
  recipeId: string | null
  stage: CookingStage
  currentStep: CookingStep | null
  panelOpen: boolean
  requiredStation: CookingStation | null
  activeStation: CookingStation | null
  completedStations: CookingStation[]
  boil: {
    active: boolean
    done: boolean
    progress: number
    dipPhase: number
    drainProgress: number
    noodleRelax: number
    steamIntensity: number
    quality: StepQuality | null
  }
  meat: {
    active: boolean
    done: boolean
    addedMeats: ToppingKey[]
    requiredMeats: ToppingKey[]
    lastChopped: ToppingKey | null
    chopPulse: number
    chopCount: number
    progress: number
    quality: StepQuality | null
  }
  counter: {
    active: boolean
    done: boolean
    pouring: boolean
    brineLevel: number
    brineTarget: number
    pourStream: number
    ladleTilt: number
    chiliOil: boolean
    servePulse: number
    quality: StepQuality | null
  }
  bowl: {
    visible: boolean
    location: CookingBowlLocation
    hasNoodles: boolean
    meats: ToppingKey[]
    brineLevel: number
    chiliOil: boolean
    brothStyle: MifenRecipe['brothStyle']
    opts: MifenBowlOptions
  }
}

export type StationActionRejectReason =
  | 'NO_ACTIVE_ORDER'
  | 'NO_ACTIVE_ORDER_NEED_BOIL'
  | 'ORDER_IN_PROGRESS'
  | 'WRONG_STATION'
  | 'ALREADY_AT_STATION'

export interface StationActionResult {
  ok: boolean
  stage: CookingStage
  requiredStation: CookingStation | null
  attemptedStation: CookingStation
  reason?: StationActionRejectReason
}

export interface StationAdvanceInfo {
  ticketId: string
  completedStation: CookingStation
  nextStation: CookingStation | null
  stage: CookingStage
}

export interface CookingCallbacks {
  container?: HTMLElement | null
  getBonuses: () => ShopEquipmentBonuses
  onComplete: (result: CookCompletion) => void
  onCancel: (ticketId: string) => void
  onBoilingChange?: (boiling: boolean) => void
  onPouringChange?: (pouring: boolean) => void
  onSound?: (id: MifenSoundId) => void
  onStageChange?: (visual: CookingVisualState) => void
  onStationAdvance?: (info: StationAdvanceInfo) => void
  economyBus?: EconomyEventBus
  getEconomyContext?: () => CookingEconomyContext
}

export interface CookingController {
  /** 开启新订单：默认在煮锅台（boil）启动；显式传入非 boil 工位将被硬拦截 */
  open(order: ActiveCookOrder, station?: CookingStation): StationActionResult
  startOrder(order: ActiveCookOrder, station?: CookingStation): StationActionResult
  /** 在指定物理工位尝试解锁并打开对应步骤面板；错误工位或跳步严格拒绝 */
  openAtStation(station: CookingStation): StationActionResult
  /** 仅校验某物理工位当前是否允许交互，不改状态 */
  canInteractStation(station: CookingStation): StationActionResult
  /** 面板收起但保留当前订单（用于离开工位或查看场景） */
  dismissPanel(): void
  cancel(): void
  step(dt: number): void
  isOpen(): boolean
  hasActiveOrder(): boolean
  isCarrying(): boolean
  isBoiling(): boolean
  getActiveOrder(): ActiveCookOrder | null
  getCurrentStep(): CookingStep | null
  getStage(): CookingStage
  getRequiredStation(): CookingStation | null
  getActiveStation(): CookingStation | null
  getVisualState(): CookingVisualState
  /** 确定性操作 API（严格遵循当前工位约束，错步调用返回 false/null） */
  lockBoilNow(overridePos?: number): boolean
  chopMeatNow(key: ToppingKey): boolean
  confirmMeatNow(): boolean
  pourBrineTo(targetLevel: number, chili?: boolean): boolean
  serveNow(): CookCompletion | null
  /** QA/探针兜底直通结算 */
  completeActivePerfect(): CookCompletion | null
  dispose(): void
}

const SHARED_ECONOMY_BUS = createEconomyEventBus()

export function getSharedCookingEconomyBus(): EconomyEventBus {
  return SHARED_ECONOMY_BUS
}

const TOPPING_META: Record<ToppingKey, { short: string; keyHint: string }> = {
  guoshao: { short: '锅烧', keyHint: '1' },
  beef: { short: '卤牛肉', keyHint: '2' },
  charsiu: { short: '叉烧', keyHint: '3' },
  egg: { short: '卤蛋', keyHint: '4' },
  youtiao: { short: '油条', keyHint: '5' },
}

const ALL_TOPPINGS: ToppingKey[] = ['guoshao', 'beef', 'charsiu', 'egg', 'youtiao']

const STEP_LABELS: Record<CookingStep, string> = {
  boil: '煮锅烫粉',
  meat: '肉台切码',
  broth: '前台淋卤',
  plate: '前台出餐',
}

const STEP_ORDER: CookingStep[] = ['boil', 'meat', 'broth', 'plate']

const BOIL_DRAIN_SEC = 0.34
const BRINE_SETTLE_SEC = 0.34
const SERVING_PULSE_SEC = 0.65

function qualityLabel(q: StepQuality): string {
  if (q === 'perfect') return '好'
  if (q === 'good') return '中'
  return '差'
}

function gradeLabel(g: CookGrade): string {
  if (g === 'good') return '好'
  if (g === 'medium') return '中'
  return '差'
}

function qualityScore(q: StepQuality): number {
  if (q === 'perfect') return 100
  if (q === 'good') return 72
  return 34
}

function readFallbackHour(): number {
  if (typeof window === 'undefined') return 8.5
  const v = (window as unknown as { viewer?: { clock?: { hour?: number } } }).viewer
  const h = v?.clock?.hour
  return typeof h === 'number' && Number.isFinite(h) ? h : 8.5
}

export function requiredStationForStage(stage: CookingStage): CookingStation | null {
  if (stage === 'boil') return 'boil'
  if (stage === 'carry_to_meat' || stage === 'meat') return 'meat'
  if (stage === 'carry_to_counter' || stage === 'counter') return 'counter'
  return null
}

/**
 * 纯函数校验：检查当前阶段在 attemptedStation 工位是否允许交互或进入。
 * 强制三工位单向物理顺序：boil -> meat -> counter，不可跳步、不可原地重复完成。
 */
export function validateStationTransition(
  hasOrder: boolean,
  stage: CookingStage,
  attemptedStation: CookingStation,
): StationActionResult {
  if (!hasOrder) {
    return {
      ok: false,
      stage: 'idle',
      requiredStation: 'boil',
      attemptedStation,
      reason: attemptedStation === 'boil' ? 'NO_ACTIVE_ORDER' : 'NO_ACTIVE_ORDER_NEED_BOIL',
    }
  }
  const required = requiredStationForStage(stage)
  if (!required || attemptedStation !== required) {
    return {
      ok: false,
      stage,
      requiredStation: required,
      attemptedStation,
      reason: 'WRONG_STATION',
    }
  }
  return {
    ok: true,
    stage,
    requiredStation: required,
    attemptedStation,
  }
}

function buildBowlOptions(
  meats: readonly ToppingKey[],
  brothStyle: MifenRecipe['brothStyle'],
  hasToppings: boolean,
): MifenBowlOptions & {
  hasGuoshao: boolean
  hasBeef: boolean
  hasEgg: boolean
  hasToppings: boolean
} {
  return {
    hasGuoshao: meats.includes('guoshao'),
    hasBeef: meats.includes('beef'),
    hasCharsiu: meats.includes('charsiu'),
    hasEgg: meats.includes('egg'),
    hasYoutiao: meats.includes('youtiao'),
    hasToppings,
    brothStyle,
  }
}

export function createCookingController(callbacks: CookingCallbacks): CookingController {
  const hasDom = typeof document !== 'undefined' && Boolean(callbacks.container)
  const panel: HTMLElement | null = hasDom ? document.createElement('section') : null
  if (panel && callbacks.container) {
    panel.className = 'mifen-cook-panel mifen-cook-modal'
    panel.hidden = true
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-label', '做粉工位')
    callbacks.container.append(panel)
  }

  const bus = callbacks.economyBus ?? SHARED_ECONOMY_BUS

  let activeOrder: ActiveCookOrder | null = null
  let stage: CookingStage = 'idle'
  let currentStep: CookingStep = 'boil'
  let panelVisible = false
  let localStreak = 0

  // Step 1: 煮锅台（boil）烫粉与竹笊篱涮煮/沥水动画
  let boilPos = 0.08
  let boilDir = 1
  let boilLocked = false
  let boilDone = false
  let boilDrainTimer = 0
  let boilDipPhase = 0
  let boilNoodleRelax = 0
  let boilQuality: StepQuality = 'good'
  let boilFeedback = ''
  let boilGoldMin = 0.4
  let boilGoldMax = 0.64

  // Step 2: 肉台（meat）切码顺序与菜刀剁切脉冲动画
  let addedMeats: ToppingKey[] = []
  let meatLocked = false
  let meatDone = false
  let meatQuality: StepQuality = 'miss'
  let meatOrderExact = false
  let meatFeedback = ''
  let lastChopped: ToppingKey | null = null
  let chopPulse = 0
  let chopCount = 0

  // Step 3: 前台明档（counter）长勺淋卤与直接出餐
  let brineLevel = 0
  let brinePouring = false
  let brineLocked = false
  let brineDone = false
  let brineSettleTimer = 0
  let pourStream = 0
  let ladleTilt = 0
  let brineQuality: StepQuality = 'good'
  let brineFeedback = ''
  let brineTarget = 0.68
  let brineHalfBand = 0.09
  let chiliOil = true

  // Serving transition pulse (brief visual handoff on counter after finishAndServe)
  let servePulseTimer = 0
  let lastServedMeats: ToppingKey[] = []
  let lastServedBrine = 0
  let lastServedChili = false
  let lastServedBrothStyle: MifenRecipe['brothStyle'] = 'lucai_dry'

  let boilCursorEl: HTMLElement | null = null
  let brineFillEl: HTMLElement | null = null
  let brineReadoutEl: HTMLElement | null = null

  function emitBoiling(on: boolean): void {
    callbacks.onBoilingChange?.(on)
  }

  function emitPouring(on: boolean): void {
    callbacks.onPouringChange?.(on)
  }

  function emitSound(id: MifenSoundId): void {
    callbacks.onSound?.(id)
  }

  function resolveEconomyContext(): CookingEconomyContext {
    if (callbacks.getEconomyContext) return callbacks.getEconomyContext()
    return {
      hour: readFallbackHour(),
      reputation: 4.2,
      shopLevel: 1,
      streak: localStreak,
    }
  }

  function getActiveStation(): CookingStation | null {
    if (!activeOrder || !panelVisible) return null
    if (stage === 'boil') return 'boil'
    if (stage === 'meat') return 'meat'
    if (stage === 'counter') return 'counter'
    return null
  }

  function computeCompletedStations(): CookingStation[] {
    const out: CookingStation[] = []
    if (boilDone) out.push('boil')
    if (meatDone) out.push('meat')
    if (brineDone) out.push('counter')
    return out
  }

  function getVisualState(): CookingVisualState {
    const req = activeOrder?.recipe.requiredMeats ?? []
    const reqSet = new Set(req)
    const matchedReq = addedMeats.filter(k => reqSet.has(k)).length
    const meatProgress = req.length > 0 ? Math.min(1, matchedReq / req.length) : meatDone ? 1 : 0
    const drainProgress = boilDone ? 1 : boilLocked ? Math.min(1, Math.max(0, 1 - boilDrainTimer / BOIL_DRAIN_SEC)) : 0
    const servePulse = servePulseTimer > 0 ? Math.min(1, servePulseTimer / SERVING_PULSE_SEC) : 0

    let bowlLocation: CookingBowlLocation = 'hidden'
    let bowlVisible = false
    let hasNoodles = false
    let bowlMeats: ToppingKey[] = []
    let bowlBrine = 0
    let bowlChili = false
    let brothStyle: MifenRecipe['brothStyle'] = activeOrder?.recipe.brothStyle ?? lastServedBrothStyle

    if (activeOrder) {
      bowlVisible = true
      hasNoodles = boilDone || drainProgress > 0.45
      bowlMeats = [...addedMeats]
      bowlBrine = brineLevel
      bowlChili = stage === 'counter' && (brineLevel > 0.05 || brineDone) ? chiliOil : false
      if (stage === 'boil') bowlLocation = 'boil'
      else if (stage === 'carry_to_meat' || stage === 'carry_to_counter') bowlLocation = 'carry'
      else if (stage === 'meat') bowlLocation = 'meat'
      else if (stage === 'counter') bowlLocation = 'counter'
    } else if (stage === 'serving' && servePulseTimer > 0) {
      bowlVisible = true
      bowlLocation = 'serve'
      hasNoodles = true
      bowlMeats = [...lastServedMeats]
      bowlBrine = lastServedBrine
      bowlChili = lastServedChili
      brothStyle = lastServedBrothStyle
    }

    return {
      active: activeOrder !== null,
      ticketId: activeOrder?.ticketId ?? null,
      recipeId: activeOrder?.recipe.id ?? null,
      stage,
      currentStep: activeOrder ? currentStep : null,
      panelOpen: activeOrder !== null && panelVisible,
      requiredStation: activeOrder ? requiredStationForStage(stage) : null,
      activeStation: getActiveStation(),
      completedStations: computeCompletedStations(),
      boil: {
        active: activeOrder !== null && stage === 'boil',
        done: boilDone,
        progress: boilPos,
        dipPhase: boilDipPhase,
        drainProgress,
        noodleRelax: boilNoodleRelax,
        steamIntensity: activeOrder !== null && stage === 'boil' ? (boilLocked ? 0.55 : 1) : 0.2,
        quality: boilLocked || boilDone ? boilQuality : null,
      },
      meat: {
        active: activeOrder !== null && stage === 'meat',
        done: meatDone,
        addedMeats: [...addedMeats],
        requiredMeats: [...req],
        lastChopped,
        chopPulse,
        chopCount,
        progress: meatProgress,
        quality: meatDone || addedMeats.length > 0 ? meatQuality : null,
      },
      counter: {
        active: activeOrder !== null && stage === 'counter',
        done: brineDone,
        pouring: brinePouring,
        brineLevel,
        brineTarget,
        pourStream,
        ladleTilt,
        chiliOil,
        servePulse,
        quality: brineLocked || brineDone ? brineQuality : null,
      },
      bowl: {
        visible: bowlVisible,
        location: bowlLocation,
        hasNoodles,
        meats: bowlMeats,
        brineLevel: bowlBrine,
        chiliOil: bowlChili,
        brothStyle,
        opts: buildBowlOptions(bowlMeats, brothStyle, stage === 'counter' || stage === 'serving'),
      },
    }
  }

  function notifyStageChange(): void {
    const snap = getVisualState()
    callbacks.onStageChange?.(snap)
    if (typeof window !== 'undefined' && typeof CustomEvent === 'function') {
      window.dispatchEvent(new CustomEvent('mifen:cooking-stage', { detail: snap }))
    }
  }

  function configureTargetsForOrder(order: ActiveCookOrder): void {
    const bonuses = callbacks.getBonuses()
    const targetSec = Math.max(1.4, Math.min(5.5, order.recipe.boilTargetSec || 2.5))
    const center = Math.min(0.74, Math.max(0.32, 0.36 + (targetSec - 1.8) * 0.1))
    const halfWidth = Math.min(0.22, 0.1 + bonuses.boilZoneBonus * 0.48)
    boilGoldMin = Math.max(0.14, center - halfWidth)
    boilGoldMax = Math.min(0.86, center + halfWidth)

    const rawBrine = order.recipe.brineTarget
    brineTarget =
      rawBrine > 1 ? Math.min(0.84, Math.max(0.36, rawBrine / 100)) : Math.min(0.84, Math.max(0.36, rawBrine || 0.68))
    brineHalfBand = Math.min(0.16, 0.085 + bonuses.brineZoneBonus * 0.5)
  }

  function evaluateMeatSequence(): { quality: StepQuality; orderExact: boolean } {
    if (!activeOrder) return { quality: 'miss', orderExact: false }
    const req = activeOrder.recipe.requiredMeats
    if (!req.length) return { quality: 'perfect', orderExact: true }

    const reqSet = new Set(req)
    const clickedReqSeq = addedMeats.filter(k => reqSet.has(k))
    const matched = clickedReqSeq.length
    const allPresent = matched >= req.length
    const orderExact = allPresent && req.every((key, idx) => clickedReqSeq[idx] === key)

    if (orderExact) return { quality: 'perfect', orderExact: true }
    if (allPresent || matched >= Math.ceil(req.length * 0.5)) return { quality: 'good', orderExact: false }
    return { quality: 'miss', orderExact: false }
  }

  function buildCompletion(forcedPerfect = false): CookCompletion {
    const order = activeOrder!
    const bonuses = callbacks.getBonuses()
    const econCtx = resolveEconomyContext()

    const bq: StepQuality = forcedPerfect ? 'perfect' : boilQuality
    const meatEval = forcedPerfect ? { quality: 'perfect' as StepQuality, orderExact: true } : evaluateMeatSequence()
    const mq: StepQuality = meatEval.quality
    const lq: StepQuality = forcedPerfect ? 'perfect' : brineQuality
    const meats: ToppingKey[] = forcedPerfect
      ? Array.from(new Set([...order.recipe.requiredMeats]))
      : [...addedMeats]

    const rawScore = qualityScore(bq) * 0.36 + qualityScore(mq) * 0.32 + qualityScore(lq) * 0.32
    const equipLift = bonuses.qualityBonus * 14
    const score = Math.min(100, Math.round(rawScore + equipLift))
    const grade: CookGrade = score >= 85 ? 'good' : score >= 60 ? 'medium' : 'poor'
    const stars: 1 | 2 | 3 = grade === 'good' ? 3 : grade === 'medium' ? 2 : 1

    // 单源结算：严格复用 economy/rush.ts settleDineInOrder，面板展示小费与账本入账 1:1 一致
    const settled = settleDineInOrder({
      recipe: order.recipe,
      stars,
      streak: econCtx.streak,
      hour: econCtx.hour,
      reputation: econCtx.reputation,
      shopLevel: econCtx.shopLevel,
      inventory: econCtx.inventory ?? createDefaultInventory(),
      bonuses,
    })

    const basePrice = Math.max(0, roundMoney(settled.gross - settled.tip))

    return {
      ticketId: order.ticketId,
      recipe: order.recipe,
      stars,
      grade,
      score,
      basePrice,
      tip: settled.tip,
      totalPayout: settled.gross,
      reputationDelta: settled.reputationDelta,
      streak: settled.nextStreak,
      isMorningRush: settled.isMorningRush,
      boilQuality: bq,
      meatQuality: mq,
      meatOrderExact: meatEval.orderExact,
      brineQuality: lq,
      addedMeats: meats,
      chiliOil,
      bowlOpts: buildBowlOptions(meats, order.recipe.brothStyle, true),
    }
  }

  function emitEconomySettled(result: CookCompletion): void {
    localStreak = result.streak
    const rawCost = roundMoney(result.basePrice * 0.28)
    bus.emit('dine_in:settled', {
      recipeId: result.recipe.id,
      stars: result.stars,
      gross: result.totalPayout,
      rawCost,
      tip: result.tip,
      net: roundMoney(result.totalPayout - rawCost),
      usedEmergencyBrine: false,
      isMorningRush: result.isMorningRush,
      streak: result.streak,
    })
  }

  function setPanelVisible(vis: boolean): void {
    panelVisible = vis
    if (panel) panel.hidden = !vis
  }

  function finalizeBoilStation(): void {
    if (!activeOrder || stage !== 'boil' || !boilLocked || boilDone) return
    boilDone = true
    boilNoodleRelax = 1
    boilDrainTimer = 0
    stage = 'carry_to_meat'
    currentStep = 'meat'
    setPanelVisible(false)
    emitBoiling(false)
    callbacks.onStationAdvance?.({
      ticketId: activeOrder.ticketId,
      completedStation: 'boil',
      nextStation: 'meat',
      stage,
    })
    notifyStageChange()
  }

  function lockBoil(overridePos?: number): boolean {
    if (!activeOrder || stage !== 'boil' || currentStep !== 'boil' || !panelVisible || boilLocked) return false
    if (typeof overridePos === 'number' && Number.isFinite(overridePos)) {
      boilPos = Math.max(0, Math.min(1, overridePos))
    }
    boilLocked = true
    boilDrainTimer = BOIL_DRAIN_SEC
    emitBoiling(false)
    if (boilPos >= boilGoldMin && boilPos <= boilGoldMax) {
      boilQuality = 'perfect'
      boilFeedback = '弹滑'
      emitSound('boil_lock_perfect')
    } else if (boilPos >= boilGoldMin - 0.12 && boilPos <= boilGoldMax + 0.12) {
      boilQuality = 'good'
      boilFeedback = boilPos < boilGoldMin ? '偏嫩' : '偏软'
      emitSound('boil_lock_miss')
    } else {
      boilQuality = 'miss'
      boilFeedback = boilPos < boilGoldMin ? '夹生' : '过火'
      emitSound('boil_lock_miss')
    }
    render()
    notifyStageChange()
    return true
  }

  function chopMeat(key: ToppingKey): boolean {
    if (!activeOrder || stage !== 'meat' || currentStep !== 'meat' || !panelVisible || meatLocked) return false
    if (!addedMeats.includes(key)) {
      addedMeats.push(key)
    }
    lastChopped = key
    chopPulse = 1
    chopCount += 1
    emitSound('meat_chop')

    const req = activeOrder.recipe.requiredMeats
    const reqSet = new Set(req)
    const clickedReq = addedMeats.filter(k => reqSet.has(k))
    const stepPos = clickedReq.length - 1
    if (reqSet.has(key)) {
      meatFeedback = req[stepPos] === key ? '顺序' : '乱序'
    } else {
      meatFeedback = '加码'
    }
    const evalRes = evaluateMeatSequence()
    meatQuality = evalRes.quality
    meatOrderExact = evalRes.orderExact
    render()
    notifyStageChange()
    return true
  }

  /** 肉台装碗完成：锁定肉码并收起面板，强制端碗前往前台明档（counter）淋卤 */
  function commitMeatForCounter(): boolean {
    if (!activeOrder || stage !== 'meat' || currentStep !== 'meat' || !panelVisible || meatLocked) return false
    const evalRes = evaluateMeatSequence()
    meatQuality = evalRes.quality
    meatOrderExact = evalRes.orderExact
    meatLocked = true
    meatDone = true
    stage = 'carry_to_counter'
    currentStep = 'broth'
    brineLevel = 0
    brinePouring = false
    brineLocked = false
    brineDone = false
    brineSettleTimer = 0
    pourStream = 0
    ladleTilt = 0
    brineFeedback = ''
    setPanelVisible(false)
    emitSound('meat_plate')
    callbacks.onStationAdvance?.({
      ticketId: activeOrder.ticketId,
      completedStation: 'meat',
      nextStation: 'counter',
      stage,
    })
    notifyStageChange()
    return true
  }

  function startBrinePour(): boolean {
    if (!activeOrder || stage !== 'counter' || currentStep !== 'broth' || !panelVisible || brineLocked) return false
    brinePouring = true
    brineFeedback = ''
    emitPouring(true)
    const btn = panel?.querySelector<HTMLButtonElement>('[data-action="pour-brine"] span')
    if (btn) btn.textContent = '松手收勺'
    notifyStageChange()
    return true
  }

  function evaluateAndLockBrine(): void {
    brinePouring = false
    brineLocked = true
    brineSettleTimer = BRINE_SETTLE_SEC
    emitPouring(false)
    emitSound('brine_stop')
    const diff = Math.abs(brineLevel - brineTarget)
    if (diff <= brineHalfBand) {
      brineQuality = 'perfect'
      brineFeedback = '刚好'
    } else if (diff <= brineHalfBand + 0.13) {
      brineQuality = 'good'
      brineFeedback = brineLevel < brineTarget ? '偏淡' : '偏浓'
    } else {
      brineQuality = 'miss'
      brineFeedback = brineLevel < brineTarget ? '太淡' : '偏咸'
    }
    render()
    notifyStageChange()
  }

  function stopBrinePour(): boolean {
    if (!activeOrder || stage !== 'counter' || currentStep !== 'broth' || !brinePouring || brineLocked) return false
    evaluateAndLockBrine()
    return true
  }

  function finalizeBrineIntoPlate(): void {
    if (!activeOrder || stage !== 'counter' || currentStep !== 'broth' || !brineLocked || brineDone) return
    brineDone = true
    brineSettleTimer = 0
    currentStep = 'plate'
    render()
    notifyStageChange()
  }

  function finishAndServe(): CookCompletion | null {
    if (!activeOrder || stage !== 'counter' || currentStep !== 'plate' || !panelVisible) return null
    const result = buildCompletion(false)
    lastServedMeats = [...result.addedMeats]
    lastServedBrine = brineLevel
    lastServedChili = result.chiliOil
    lastServedBrothStyle = result.recipe.brothStyle

    activeOrder = null
    stage = 'serving'
    servePulseTimer = SERVING_PULSE_SEC
    setPanelVisible(false)
    emitBoiling(false)
    emitPouring(false)
    emitSound('serve_complete')
    callbacks.onStationAdvance?.({
      ticketId: result.ticketId,
      completedStation: 'counter',
      nextStation: null,
      stage,
    })
    emitEconomySettled(result)
    callbacks.onComplete(result)
    notifyStageChange()
    return result
  }

  function cancel(): void {
    if (!activeOrder) return
    const id = activeOrder.ticketId
    activeOrder = null
    stage = 'idle'
    currentStep = 'boil'
    boilLocked = false
    boilDone = false
    boilDrainTimer = 0
    meatLocked = false
    meatDone = false
    brinePouring = false
    brineLocked = false
    brineDone = false
    brineSettleTimer = 0
    pourStream = 0
    ladleTilt = 0
    chopPulse = 0
    setPanelVisible(false)
    emitBoiling(false)
    emitPouring(false)
    callbacks.onCancel(id)
    notifyStageChange()
  }

  function dismissPanel(): void {
    if (!activeOrder || !panelVisible) return
    setPanelVisible(false)
    emitBoiling(false)
    emitPouring(false)
    notifyStageChange()
  }

  function syncPanelDataAttrs(preview?: CookCompletion): void {
    if (!panel) return
    const reqStation = activeOrder ? requiredStationForStage(stage) : null
    panel.dataset.stage = stage
    panel.dataset.step = currentStep
    panel.dataset.station = getActiveStation() ?? ''
    panel.dataset.requiredStation = reqStation ?? ''
    panel.dataset.boilPos = boilPos.toFixed(3)
    panel.dataset.boilGoldMin = boilGoldMin.toFixed(3)
    panel.dataset.boilGoldMax = boilGoldMax.toFixed(3)
    panel.dataset.brineLevel = brineLevel.toFixed(3)
    panel.dataset.brineTarget = brineTarget.toFixed(3)
    panel.dataset.brineBand = brineHalfBand.toFixed(3)
    panel.dataset.requiredOrder = activeOrder ? activeOrder.recipe.requiredMeats.join(',') : ''
    if (preview) {
      panel.dataset.grade = preview.grade
      panel.dataset.stars = String(preview.stars)
      panel.dataset.tip = String(preview.tip)
    } else {
      delete panel.dataset.grade
      delete panel.dataset.stars
      delete panel.dataset.tip
    }
  }

  function render(): void {
    if (!panel) return
    if (!activeOrder || !panelVisible) {
      panel.hidden = true
      syncPanelDataAttrs()
      return
    }
    panel.hidden = false
    const { recipe } = activeOrder
    const stepIndex = STEP_ORDER.indexOf(currentStep)
    const req = recipe.requiredMeats
    const reqSet = new Set(req)
    const allReqDone = req.every(m => addedMeats.includes(m))
    const nextReqKey = req.find(m => !addedMeats.includes(m)) ?? null
    const stationTag =
      stage === 'boil' ? '后厨 · 煮锅台' : stage === 'meat' ? '后厨 · 肉台' : '前台明档'

    const actionButton = (
      action: string,
      label: string,
      primary: boolean,
      disabled = false,
      extraAttrs = '',
    ) => `
      <button type="button" class="mifen-btn${primary ? ' mifen-btn--primary' : ''}" data-action="${action}" ${extraAttrs} ${disabled ? 'disabled' : ''}>
        <span>${label}</span><kbd>Space</kbd>
      </button>
    `

    let stageHtml = ''
    let footerStatus = ''
    let footerActionHtml = ''
    let preview: CookCompletion | undefined

    if (currentStep === 'boil') {
      const goldLeftPct = (boilGoldMin * 100).toFixed(1)
      const goldWidthPct = ((boilGoldMax - boilGoldMin) * 100).toFixed(1)
      const markerPct = (boilPos * 100).toFixed(1)
      stageHtml = `
        <div class="mifen-boil-gauge">
          <div class="mifen-boil-sweetspot" style="left:${goldLeftPct}%;width:${goldWidthPct}%"></div>
          <div class="mifen-boil-cursor" data-role="boil-cursor" style="left:${markerPct}%"></div>
        </div>
      `
      footerStatus = boilFeedback
      footerActionHtml = actionButton('lock-boil', boilLocked ? '沥水中' : '起锅去肉台', true, boilLocked)
    } else if (currentStep === 'meat') {
      const buttons = ALL_TOPPINGS.map(key => {
        const meta = TOPPING_META[key]
        const orderIdx = req.indexOf(key)
        const isReq = reqSet.has(key)
        const isDone = addedMeats.includes(key)
        const isNext = nextReqKey === key
        const tag = isDone ? '已切' : isReq ? `序${orderIdx + 1}` : '加码'
        return `
          <button type="button"
            class="mifen-topping-btn${isDone ? ' is-selected' : ''}"
            data-meat="${key}"
            data-order="${isReq ? orderIdx + 1 : 0}"
            aria-pressed="${isDone}"
            ${isNext ? 'aria-current="step"' : ''}>
            <kbd>${meta.keyHint}</kbd>
            <span>${meta.short}</span>
            <small>${tag}</small>
          </button>
        `
      }).join('')
      stageHtml = `<div class="mifen-topping-grid">${buttons}</div>`
      footerStatus = meatFeedback
      footerActionHtml = actionButton('commit-meat', '装碗去前台', allReqDone, false, 'data-mifen-act="confirm-meats"')
    } else if (currentStep === 'broth') {
      const targetLeftPct = (Math.max(0, brineTarget - brineHalfBand) * 100).toFixed(1)
      const targetWidthPct = (Math.min(1, brineHalfBand * 2) * 100).toFixed(1)
      const fillPct = (brineLevel * 100).toFixed(1)
      stageHtml = `
        <div class="mifen-brine-meter">
          <div class="mifen-brine-track">
            <div class="mifen-brine-fill" data-role="brine-fill" style="width:${fillPct}%"></div>
            <div class="mifen-brine-target-mark" style="left:${targetLeftPct}%;width:${targetWidthPct}%"></div>
          </div>
          <span data-role="brine-readout">${Math.round(brineLevel * 100)}%</span>
        </div>
        <div class="mifen-condiment-row">
          <button type="button" class="mifen-condiment-chip${chiliOil ? ' is-selected' : ''}" data-action="toggle-chili" aria-pressed="${chiliOil}">辣椒油</button>
        </div>
      `
      footerStatus = brineFeedback
      footerActionHtml = actionButton(
        'pour-brine',
        brineLocked ? '已收勺' : brinePouring ? '松手收勺' : '按住淋卤',
        true,
        brineLocked,
        'data-mifen-act="brine"',
      )
    } else {
      preview = buildCompletion(false)
      const starsText = '★'.repeat(preview.stars) + '☆'.repeat(3 - preview.stars)
      const isDelivery = activeOrder.ticketId.startsWith('dlv_')
      const tipSpan = isDelivery ? '' : ` <span>小费 ¥${formatMoney(preview.tip)}</span>`
      stageHtml = `
        <div class="mifen-plate-summary">
          <div class="mifen-plate-stars">${starsText} ${gradeLabel(preview.grade)}${tipSpan}</div>
          <div class="mifen-plate-line">
            烫粉 <b>${qualityLabel(preview.boilQuality)}</b> · 切码 <b>${qualityLabel(preview.meatQuality)}</b> · 老卤 <b>${qualityLabel(preview.brineQuality)}</b>
          </div>
        </div>
      `
      footerActionHtml = actionButton('serve-bowl', '前台出餐', true, false, 'data-mifen-act="serve"')
    }

    panel.innerHTML = `
      <div class="mifen-cook-head">
        <h3 class="mifen-cook-title">${formatRecipeTitle(recipe)} <small>${activeOrder.archetype.name} · ${stationTag}</small></h3>
        <button type="button" class="mifen-btn" data-action="cancel-cook">放弃</button>
      </div>
      <div class="mifen-cook-steps">
        ${STEP_ORDER.map(
          (step, i) =>
            `<div class="mifen-step-pill${i === stepIndex ? ' is-current' : i < stepIndex ? ' is-done' : ''}"${i === stepIndex ? ' aria-current="step"' : ''}>${STEP_LABELS[step]}</div>`,
        ).join('')}
      </div>
      ${stageHtml}
      <div class="mifen-cook-footer">
        <span class="mifen-cook-hint" role="status">${footerStatus}</span>
        ${footerActionHtml}
      </div>
    `

    syncPanelDataAttrs(preview)

    boilCursorEl = panel.querySelector<HTMLElement>('[data-role="boil-cursor"]')
    brineFillEl = panel.querySelector<HTMLElement>('[data-role="brine-fill"]')
    brineReadoutEl = panel.querySelector<HTMLElement>('[data-role="brine-readout"]')

    panel.querySelector('[data-action="cancel-cook"]')?.addEventListener('click', () => cancel())
    panel.querySelector('[data-action="lock-boil"]')?.addEventListener('click', () => lockBoil())
    panel.querySelector('[data-action="commit-meat"]')?.addEventListener('click', () => commitMeatForCounter())
    panel.querySelector('[data-action="serve-bowl"]')?.addEventListener('click', () => finishAndServe())
    panel.querySelector('[data-action="toggle-chili"]')?.addEventListener('click', () => {
      chiliOil = !chiliOil
      emitSound('condiment_add')
      render()
      notifyStageChange()
    })

    for (const btn of Array.from(panel.querySelectorAll<HTMLButtonElement>('[data-meat]'))) {
      btn.addEventListener('click', () => {
        chopMeat(btn.dataset.meat as ToppingKey)
      })
    }

    const pourBtn = panel.querySelector<HTMLButtonElement>('[data-action="pour-brine"]')
    if (pourBtn) {
      pourBtn.addEventListener('pointerdown', e => {
        e.preventDefault()
        startBrinePour()
      })
      pourBtn.addEventListener('pointerup', () => stopBrinePour())
      pourBtn.addEventListener('pointerleave', () => {
        if (brinePouring) stopBrinePour()
      })
    }
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (!activeOrder || !panelVisible) return
    const target = e.target as HTMLElement | null
    if (target && target.closest('input,textarea,select,[contenteditable]')) return

    if (e.code === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      cancel()
      return
    }

    if (stage === 'boil' && currentStep === 'boil' && (e.code === 'Space' || e.code === 'Enter')) {
      e.preventDefault()
      e.stopPropagation()
      if (!e.repeat) lockBoil()
      return
    }

    if (stage === 'meat' && currentStep === 'meat') {
      const digitMap: Record<string, ToppingKey> = {
        Digit1: 'guoshao',
        Digit2: 'beef',
        Digit3: 'charsiu',
        Digit4: 'egg',
        Digit5: 'youtiao',
      }
      if (digitMap[e.code]) {
        e.preventDefault()
        e.stopPropagation()
        chopMeat(digitMap[e.code])
        return
      }
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        if (!e.repeat) commitMeatForCounter()
        return
      }
    }

    if (stage === 'counter' && currentStep === 'broth' && (e.code === 'Space' || e.code === 'Enter')) {
      e.preventDefault()
      e.stopPropagation()
      if (!e.repeat) startBrinePour()
      return
    }

    if (stage === 'counter' && currentStep === 'plate' && (e.code === 'Space' || e.code === 'Enter')) {
      e.preventDefault()
      e.stopPropagation()
      if (!e.repeat) finishAndServe()
    }
  }

  function onKeyUp(e: KeyboardEvent): void {
    if (!activeOrder || !panelVisible) return
    if (stage === 'counter' && currentStep === 'broth' && (e.code === 'Space' || e.code === 'Enter')) {
      e.preventDefault()
      e.stopPropagation()
      stopBrinePour()
    }
  }

  if (typeof window !== 'undefined' && hasDom) {
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
  }

  function startOrder(order: ActiveCookOrder, station: CookingStation = 'boil'): StationActionResult {
    if (activeOrder) {
      return {
        ok: false,
        stage,
        requiredStation: requiredStationForStage(stage),
        attemptedStation: station,
        reason: 'ORDER_IN_PROGRESS',
      }
    }
    if (station !== 'boil') {
      return {
        ok: false,
        stage: 'idle',
        requiredStation: 'boil',
        attemptedStation: station,
        reason: 'WRONG_STATION',
      }
    }

    activeOrder = order
    stage = 'boil'
    currentStep = 'boil'
    boilPos = 0.08
    boilDir = 1
    boilLocked = false
    boilDone = false
    boilDrainTimer = 0
    boilDipPhase = 0
    boilNoodleRelax = 0
    boilFeedback = ''

    addedMeats = []
    meatLocked = false
    meatDone = false
    meatQuality = 'miss'
    meatOrderExact = false
    meatFeedback = ''
    lastChopped = null
    chopPulse = 0
    chopCount = 0

    brineLevel = 0
    brinePouring = false
    brineLocked = false
    brineDone = false
    brineSettleTimer = 0
    pourStream = 0
    ladleTilt = 0
    brineFeedback = ''
    chiliOil = order.recipe.brothStyle !== 'soup'
    servePulseTimer = 0

    configureTargetsForOrder(order)
    setPanelVisible(true)
    emitBoiling(true)
    emitSound('boil_dip')
    render()
    notifyStageChange()
    return {
      ok: true,
      stage: 'boil',
      requiredStation: 'boil',
      attemptedStation: 'boil',
    }
  }

  function canInteractStation(station: CookingStation): StationActionResult {
    return validateStationTransition(activeOrder !== null, stage, station)
  }

  function openAtStation(station: CookingStation): StationActionResult {
    const check = canInteractStation(station)
    if (!check.ok || !activeOrder) return check

    if (station === 'boil') {
      if (stage !== 'boil') {
        return {
          ok: false,
          stage,
          requiredStation: requiredStationForStage(stage),
          attemptedStation: station,
          reason: 'WRONG_STATION',
        }
      }
      setPanelVisible(true)
      emitBoiling(!boilLocked)
      render()
      notifyStageChange()
      return { ok: true, stage, requiredStation: 'boil', attemptedStation: station }
    }

    if (station === 'meat') {
      if (stage === 'carry_to_meat') {
        stage = 'meat'
        currentStep = 'meat'
      }
      if (stage !== 'meat') {
        return {
          ok: false,
          stage,
          requiredStation: requiredStationForStage(stage),
          attemptedStation: station,
          reason: 'WRONG_STATION',
        }
      }
      setPanelVisible(true)
      emitBoiling(false)
      render()
      notifyStageChange()
      return { ok: true, stage, requiredStation: 'meat', attemptedStation: station }
    }

    // station === 'counter'
    if (stage === 'carry_to_counter') {
      stage = 'counter'
      currentStep = 'broth'
    }
    if (stage !== 'counter') {
      return {
        ok: false,
        stage,
        requiredStation: requiredStationForStage(stage),
        attemptedStation: station,
        reason: 'WRONG_STATION',
      }
    }
    setPanelVisible(true)
    emitBoiling(false)
    render()
    notifyStageChange()
    return { ok: true, stage, requiredStation: 'counter', attemptedStation: station }
  }

  return {
    open: startOrder,
    startOrder,
    openAtStation,
    canInteractStation,
    dismissPanel,
    cancel,
    step(dt) {
      const safeDt = Math.min(0.1, Math.max(0, dt))
      if (servePulseTimer > 0) {
        servePulseTimer = Math.max(0, servePulseTimer - safeDt)
        if (servePulseTimer === 0 && !activeOrder && stage === 'serving') {
          stage = 'idle'
          notifyStageChange()
        }
      }

      if (!activeOrder) return
      const bonuses = callbacks.getBonuses()

      if (chopPulse > 0) {
        const decaySpeed = 3.8 * (bonuses.sliceSpeedMultiplier ?? 1)
        chopPulse = Math.max(0, chopPulse - safeDt * decaySpeed)
      }

      if (stage === 'boil') {
        if (!boilLocked && panelVisible) {
          const rhythm = 0.85 + 0.3 * Math.sin(boilPos * Math.PI)
          const speed = 0.9 * rhythm * bonuses.boilSpeedScale
          boilPos += boilDir * speed * safeDt
          if (boilPos >= 0.98) {
            boilPos = 0.98
            boilDir = -1
          } else if (boilPos <= 0.02) {
            boilPos = 0.02
            boilDir = 1
          }
          boilDipPhase = (boilDipPhase + safeDt * 3.4) % (Math.PI * 2)
          boilNoodleRelax = Math.min(0.85, boilNoodleRelax + safeDt * 0.45)
          if (panel) panel.dataset.boilPos = boilPos.toFixed(3)
          if (boilCursorEl) boilCursorEl.style.left = `${(boilPos * 100).toFixed(2)}%`
        } else if (boilLocked && !boilDone) {
          boilDrainTimer = Math.max(0, boilDrainTimer - safeDt)
          boilNoodleRelax = Math.min(1, boilNoodleRelax + safeDt * 1.6)
          if (boilDrainTimer <= 0) {
            finalizeBoilStation()
          }
        }
      } else if (stage === 'counter') {
        if (currentStep === 'broth' && brinePouring && !brineLocked && panelVisible) {
          brineLevel = Math.min(1, brineLevel + 0.58 * safeDt)
          pourStream = Math.min(1, pourStream + safeDt * 8.5)
          ladleTilt = Math.min(1, ladleTilt + safeDt * 6.0)
          if (panel) panel.dataset.brineLevel = brineLevel.toFixed(3)
          if (brineFillEl) brineFillEl.style.width = `${(brineLevel * 100).toFixed(1)}%`
          if (brineReadoutEl) brineReadoutEl.textContent = `${Math.round(brineLevel * 100)}%`
          if (brineLevel >= 0.995) {
            stopBrinePour()
          }
        } else {
          pourStream = Math.max(0, pourStream - safeDt * 5.0)
          ladleTilt = Math.max(0, ladleTilt - safeDt * 3.8)
          if (currentStep === 'broth' && brineLocked && !brineDone) {
            brineSettleTimer = Math.max(0, brineSettleTimer - safeDt)
            if (brineSettleTimer <= 0) {
              finalizeBrineIntoPlate()
            }
          }
        }
      }
    },
    isOpen() {
      return activeOrder !== null && panelVisible
    },
    hasActiveOrder() {
      return activeOrder !== null
    },
    isCarrying() {
      return activeOrder !== null && (stage === 'carry_to_meat' || stage === 'carry_to_counter')
    },
    isBoiling() {
      return activeOrder !== null && stage === 'boil' && !boilDone
    },
    getActiveOrder() {
      return activeOrder
    },
    getCurrentStep() {
      return activeOrder ? currentStep : null
    },
    getStage() {
      return stage
    },
    getRequiredStation() {
      return activeOrder ? requiredStationForStage(stage) : null
    },
    getActiveStation,
    getVisualState,
    lockBoilNow(overridePos) {
      return lockBoil(overridePos)
    },
    chopMeatNow(key) {
      return chopMeat(key)
    },
    confirmMeatNow() {
      return commitMeatForCounter()
    },
    pourBrineTo(targetLevel, chili) {
      if (!activeOrder || stage !== 'counter' || currentStep !== 'broth' || !panelVisible || brineLocked) {
        return false
      }
      if (typeof chili === 'boolean') chiliOil = chili
      brineLevel = Math.max(0, Math.min(1, targetLevel))
      pourStream = 1
      ladleTilt = 1
      evaluateAndLockBrine()
      return true
    },
    serveNow() {
      return finishAndServe()
    },
    completeActivePerfect() {
      if (!activeOrder) return null
      const result = buildCompletion(true)
      lastServedMeats = [...result.addedMeats]
      lastServedBrine = brineTarget
      lastServedChili = result.chiliOil
      lastServedBrothStyle = result.recipe.brothStyle

      activeOrder = null
      stage = 'serving'
      servePulseTimer = SERVING_PULSE_SEC
      boilDone = true
      meatDone = true
      brineDone = true
      brinePouring = false
      setPanelVisible(false)
      emitBoiling(false)
      emitEconomySettled(result)
      callbacks.onComplete(result)
      notifyStageChange()
      return result
    },
    dispose() {
      if (typeof window !== 'undefined' && hasDom) {
        window.removeEventListener('keydown', onKeyDown, true)
        window.removeEventListener('keyup', onKeyUp, true)
      }
      emitBoiling(false)
      emitPouring(false)
      panel?.remove()
    },
  }
}
