import * as THREE from 'three'
import type { DrinksAudioController } from '../audio/index.ts'
import type { OrderSnapshot, PrepStationKind } from '../sim/types.ts'
import { countObjectTriangles, disposeDrinkProp } from './builder.ts'
import { resolveDrinkSkin, type DrinkSkinConfig, createThermalOrderLabelTexture } from './skins.ts'

export const EQUIPMENT_ACTION_IDS = [
  'ice_cream_dispense',
  'tea_shake',
  'cup_seal',
  'fruit_pour',
  'ice_scoop',
  'label_apply',
] as const

export type EquipmentActionId = (typeof EQUIPMENT_ACTION_IDS)[number]

export interface EquipmentActionSpec {
  readonly id: EquipmentActionId
  readonly label: string
  readonly stationKind: PrepStationKind
  readonly supportedStations: readonly PrepStationKind[]
  readonly soundId: 'ice_cream_dispense' | 'shaker_shake' | 'cup_seal' | 'fruit_pour' | 'ice_scoop' | 'label_apply'
  readonly menuStepIds: readonly string[]
  readonly description: string
}

export const EQUIPMENT_ACTION_CATALOG: Readonly<Record<EquipmentActionId, EquipmentActionSpec>> = {
  ice_cream_dispense: {
    id: 'ice_cream_dispense',
    label: '冰淇淋出料',
    stationKind: 'cream_top',
    supportedStations: ['cream_top'],
    soundId: 'ice_cream_dispense',
    menuStepIds: ['swirl_cream', 'soft_serve_tea'],
    description: '立式冰淇淋机扳把下压、星口螺旋出料成型并回杆收口',
  },
  tea_shake: {
    id: 'tea_shake',
    label: '摇茶',
    stationKind: 'tea_shake',
    supportedStations: ['tea_shake', 'lemon_ice'],
    soundId: 'shaker_shake',
    menuStepIds: ['blend_milk_tea', 'mix_milk', 'grape_slush', 'brew_jasmine', 'pull_espresso', 'shake_seal'],
    description: '雪克杯底座起握、悬空高频斜角震荡融合、落座开盖',
  },
  cup_seal: {
    id: 'cup_seal',
    label: '封口',
    stationKind: 'tea_shake',
    supportedStations: ['tea_shake', 'lemon_ice', 'cream_top'],
    soundId: 'cup_seal',
    menuStepIds: ['seal_cup', 'cap_cup', 'cap_straw', 'shake_dome', 'finish_seal'],
    description: '推盘进舱、热封头下压滚膜亮灯、托盘退出成封口膜',
  },
  fruit_pour: {
    id: 'fruit_pour',
    label: '倒果料',
    stationKind: 'cream_top',
    supportedStations: ['cream_top', 'lemon_ice', 'tea_shake'],
    soundId: 'fruit_pour',
    menuStepIds: [
      'scoop_pulp',
      'smash_lemon',
      'scoop_pearls',
      'taro_base',
      'mango_sago_base',
      'mango_coconut',
      'strawberry_jam',
      'top_pearls_syrup',
      'wall_syrup',
      'steam_milk',
    ],
    description: '定量果料壶抬起倾角、连续果泥流注杯、收壶落位',
  },
  ice_scoop: {
    id: 'ice_scoop',
    label: '加冰',
    stationKind: 'lemon_ice',
    supportedStations: ['lemon_ice', 'tea_shake'],
    soundId: 'ice_scoop',
    menuStepIds: ['ice_syrup', 'pour_tea_ice', 'pour_over_ice'],
    description: '透明冰铲满冰就位、翻铲倾泻冰块落杯、退铲静置',
  },
  label_apply: {
    id: 'label_apply',
    label: '贴杯标',
    stationKind: 'lemon_ice',
    supportedStations: ['lemon_ice', 'tea_shake', 'cream_top'],
    soundId: 'label_apply',
    menuStepIds: ['shake_cap', 'cap_tag', 'serve_spoon'],
    description: '热敏打印机吐纸、机械压臂合拢贴附、压臂归位留标',
  },
}

const STEP_TO_ACTION = new Map<string, EquipmentActionId>()
for (const actionId of EQUIPMENT_ACTION_IDS) {
  for (const stepId of EQUIPMENT_ACTION_CATALOG[actionId].menuStepIds) {
    STEP_TO_ACTION.set(stepId, actionId)
  }
}

export function resolveEquipmentActionForStep(
  stepId: string,
  stationKind?: PrepStationKind,
): EquipmentActionId {
  const mapped = STEP_TO_ACTION.get(stepId)
  if (mapped) return mapped
  if (stationKind === 'cream_top') return 'ice_cream_dispense'
  if (stationKind === 'tea_shake') return 'tea_shake'
  return 'ice_scoop'
}

export function resolveEquipmentSequenceForStation(stationKind: PrepStationKind): readonly EquipmentActionId[] {
  if (stationKind === 'lemon_ice') return ['fruit_pour', 'ice_scoop', 'tea_shake', 'label_apply']
  if (stationKind === 'tea_shake') return ['fruit_pour', 'tea_shake', 'cup_seal', 'label_apply']
  return ['fruit_pour', 'ice_cream_dispense', 'cup_seal', 'label_apply']
}

export interface EquipmentSyncResult {
  action: EquipmentActionId
  stepProgress: number
  phase: 'start' | 'mid' | 'end'
}

/** 将 `drinks/sim` 订单 0..1 总进度映射到对应工位设备动作及当前子步骤 0..1 进度 */
export function syncEquipmentFromSimOrder(
  order: Pick<OrderSnapshot, 'progress' | 'status'> & { stationKind?: PrepStationKind; itemSteps?: readonly { id: string; stationKind: PrepStationKind }[] },
): EquipmentSyncResult {
  const stationKind: PrepStationKind = order.stationKind ?? 'tea_shake'
  const totalP = Math.max(0, Math.min(1, Number.isFinite(order.progress) ? order.progress : 0))
  const seq =
    order.itemSteps && order.itemSteps.length > 0
      ? order.itemSteps.map(s => resolveEquipmentActionForStep(s.id, s.stationKind))
      : [...resolveEquipmentSequenceForStation(stationKind)]

  const count = seq.length
  const scaled = Math.min(count - 1e-6, totalP * count)
  const idx = Math.max(0, Math.floor(scaled))
  const stepProgress = order.status === 'ready_for_pickup' || order.status === 'completed' ? 1 : Math.max(0, Math.min(1, scaled - idx))
  const phase: EquipmentSyncResult['phase'] =
    stepProgress < 0.25 ? 'start' : stepProgress < 0.8 ? 'mid' : 'end'
  return {
    action: seq[idx] ?? 'tea_shake',
    stepProgress,
    phase,
  }
}

export function syncDrinksEquipmentAudio(
  audio: Pick<DrinksAudioController, 'syncEquipmentProgress'>,
  action: EquipmentActionId,
  progress: number,
  prevProgress = 0,
): boolean {
  return audio.syncEquipmentProgress(action, progress, prevProgress)
}

export interface EquipmentRigController {
  readonly id: EquipmentActionId
  readonly label: string
  readonly stationKind: PrepStationKind
  readonly group: THREE.Group
  getProgress(): number
  setProgress(progress: number): void
  getPhaseSnapshot(): {
    progress: number
    phase: 'start' | 'mid' | 'end'
    primaryMetric: number
    secondaryMetric: number
  }
  getTriangles(): number
  dispose(): void
}

export interface EquipmentRigOptions {
  skin?: Partial<DrinkSkinConfig>
}

function mat(params: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    flatShading: true,
    roughness: 0.44,
    metalness: 0.14,
    ...params,
  })
}

function addCounterBase(group: THREE.Group, width = 0.36, depth = 0.28): void {
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(width, 0.022, depth),
    mat({ color: '#cfd8df', roughness: 0.38, metalness: 0.55 }),
  )
  base.position.y = 0.011
  const frontTrim = new THREE.Mesh(
    new THREE.BoxGeometry(width + 0.004, 0.014, 0.016),
    mat({ color: '#d9252e', roughness: 0.4 }),
  )
  frontTrim.position.set(0, 0.014, depth * 0.5)
  group.add(base, frontTrim)
}

function buildIceCreamDispenseRig(skin: DrinkSkinConfig): EquipmentRigController {
  const group = new THREE.Group()
  group.name = 'equip_ice_cream_dispense'
  addCounterBase(group, 0.34, 0.3)

  const machine = new THREE.Mesh(
    new THREE.BoxGeometry(0.24, 0.34, 0.2),
    mat({ color: skin.creamHex, roughness: 0.42 }),
  )
  machine.position.set(0, 0.19, -0.04)
  const header = new THREE.Mesh(
    new THREE.BoxGeometry(0.244, 0.075, 0.204),
    mat({ color: skin.primaryHex, roughness: 0.38 }),
  )
  header.position.set(0, 0.325, -0.04)

  const dispenserHead = new THREE.Mesh(
    new THREE.BoxGeometry(0.11, 0.09, 0.08),
    mat({ color: '#dce4ea', roughness: 0.25, metalness: 0.65 }),
  )
  dispenserHead.position.set(0, 0.25, 0.09)
  const nozzle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.018, 0.01, 0.036, 8),
    mat({ color: '#272c32', roughness: 0.35 }),
  )
  nozzle.position.set(0, 0.195, 0.1)

  // 可动出料拉杆（围绕头部枢轴旋转）
  const leverPivot = new THREE.Group()
  leverPivot.position.set(0, 0.29, 0.125)
  const leverRod = new THREE.Mesh(
    new THREE.CylinderGeometry(0.007, 0.006, 0.11, 8),
    mat({ color: '#c4cdd6', metalness: 0.7 }),
  )
  leverRod.position.y = 0.055
  const leverKnob = new THREE.Mesh(
    new THREE.SphereGeometry(0.014, 8, 5),
    mat({ color: skin.primaryHex, roughness: 0.3 }),
  )
  leverKnob.position.y = 0.11
  leverPivot.add(leverRod, leverKnob)

  // 圣代接料杯 + 3 圈螺旋出料奶浆
  const cup = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.031, 0.095, 12),
    mat({ color: '#fff8ef', roughness: 0.35 }),
  )
  cup.position.set(0, 0.068, 0.1)
  const cupBand = new THREE.Mesh(
    new THREE.CylinderGeometry(0.042, 0.036, 0.032, 12, 1, true),
    mat({ color: skin.primaryHex, roughness: 0.45 }),
  )
  cupBand.position.set(0, 0.066, 0.1)

  const creamMat = mat({ color: '#fffaf0', roughness: 0.28 })
  const stream = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.013, 0.11, 8), creamMat)
  stream.position.set(0, 0.145, 0.1)
  stream.visible = false

  const tier1 = new THREE.Mesh(new THREE.CylinderGeometry(0.031, 0.038, 0.022, 12), creamMat)
  tier1.position.set(0, 0.118, 0.1)
  const tier2 = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.03, 0.02, 12), creamMat)
  tier2.position.set(0, 0.136, 0.1)
  const tier3 = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.028, 10), creamMat)
  tier3.position.set(0, 0.156, 0.1)

  group.add(machine, header, dispenserHead, nozzle, leverPivot, cup, cupBand, stream, tier1, tier2, tier3)

  let progress = 0
  let primaryMetric = 0
  let secondaryMetric = 0

  function setProgress(p: number): void {
    progress = Math.max(0, Math.min(1, Number.isFinite(p) ? p : 0))
    const pullCurve = Math.sin(progress * Math.PI)
    leverPivot.rotation.x = pullCurve * 0.78
    primaryMetric = Number(leverPivot.rotation.x.toFixed(4))

    const flowActive = progress > 0.15 && progress < 0.85
    stream.visible = flowActive
    stream.scale.set(0.6 + pullCurve * 0.65, Math.max(0.1, pullCurve), 0.6 + pullCurve * 0.65)

    const fill = THREE.MathUtils.smoothstep(progress, 0.12, 0.92)
    secondaryMetric = Number(fill.toFixed(4))
    tier1.visible = fill > 0.05
    tier1.scale.setScalar(Math.min(1, fill * 2.2))
    tier2.visible = fill > 0.35
    tier2.scale.setScalar(Math.min(1, (fill - 0.32) * 2.2))
    tier3.visible = fill > 0.68
    tier3.scale.setScalar(Math.min(1, (fill - 0.65) * 3.0))
    tier3.rotation.y = progress * Math.PI * 2
  }
  setProgress(0)

  return makeRigHandle('ice_cream_dispense', group, setProgress, () => ({ progress, primaryMetric, secondaryMetric }))
}

function buildTeaShakeRig(skin: DrinkSkinConfig): EquipmentRigController {
  const group = new THREE.Group()
  group.name = 'equip_tea_shake'
  addCounterBase(group, 0.34, 0.28)

  const tower = new THREE.Mesh(
    new THREE.BoxGeometry(0.14, 0.24, 0.12),
    mat({ color: '#d7dfe6', metalness: 0.6, roughness: 0.3 }),
  )
  tower.position.set(-0.07, 0.14, 0)
  const cradlePivot = new THREE.Group()
  cradlePivot.position.set(0.03, 0.14, 0)

  const clampArm = new THREE.Mesh(
    new THREE.BoxGeometry(0.11, 0.025, 0.08),
    mat({ color: skin.primaryHex, roughness: 0.38 }),
  )
  clampArm.position.set(-0.03, -0.02, 0)

  const shakerBody = new THREE.Mesh(
    new THREE.CylinderGeometry(0.044, 0.033, 0.165, 14),
    mat({ color: '#eef5fb', roughness: 0.2, transparent: true, opacity: 0.72 }),
  )
  shakerBody.position.y = 0.01
  const teaCore = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.03, 0.125, 12),
    mat({ color: '#eb9d38', roughness: 0.26, transparent: true, opacity: 0.88 }),
  )
  teaCore.position.y = -0.005
  const shakerCap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.047, 0.045, 0.028, 14),
    mat({ color: skin.primaryHex, roughness: 0.35 }),
  )
  shakerCap.position.y = 0.105
  const capTop = new THREE.Mesh(
    new THREE.CylinderGeometry(0.022, 0.024, 0.02, 12),
    mat({ color: '#f3f7fa', roughness: 0.3 }),
  )
  capTop.position.y = 0.128

  // 摇晃震荡霜雾环（中段显示）
  const shakeHalo = new THREE.Mesh(
    new THREE.TorusGeometry(0.068, 0.004, 4, 14),
    mat({ color: '#ffffff', roughness: 0.2, transparent: true, opacity: 0.55 }),
  )
  shakeHalo.rotation.x = Math.PI / 2
  shakeHalo.position.y = 0.04
  shakeHalo.visible = false

  cradlePivot.add(clampArm, shakerBody, teaCore, shakerCap, capTop, shakeHalo)
  group.add(tower, cradlePivot)

  let progress = 0
  let primaryMetric = 0
  let secondaryMetric = 0

  function setProgress(p: number): void {
    progress = Math.max(0, Math.min(1, Number.isFinite(p) ? p : 0))
    const midBell = Math.sin(progress * Math.PI)
    const swing = Math.sin(progress * Math.PI * 5)
    cradlePivot.position.y = 0.14 + midBell * 0.065
    cradlePivot.rotation.z = midBell * (0.48 * swing - 0.18)
    cradlePivot.rotation.x = midBell * 0.28 * Math.cos(progress * Math.PI * 5)
    shakeHalo.visible = midBell > 0.45
    shakeHalo.scale.setScalar(0.9 + Math.abs(swing) * 0.22)

    // 收尾开盖弹出动作（progress > 0.82）
    const openPop = THREE.MathUtils.smoothstep(progress, 0.82, 1.0) * 0.024
    shakerCap.position.y = 0.105 + openPop
    capTop.position.y = 0.128 + openPop
    primaryMetric = Number(cradlePivot.position.y.toFixed(4))
    secondaryMetric = Number(Math.abs(cradlePivot.rotation.z).toFixed(4))
  }
  setProgress(0)

  return makeRigHandle('tea_shake', group, setProgress, () => ({ progress, primaryMetric, secondaryMetric }))
}

function buildCupSealRig(skin: DrinkSkinConfig): EquipmentRigController {
  const group = new THREE.Group()
  group.name = 'equip_cup_seal'
  addCounterBase(group, 0.36, 0.32)

  // 红色门架封口机壳体
  const frameLeft = new THREE.Mesh(
    new THREE.BoxGeometry(0.036, 0.3, 0.16),
    mat({ color: skin.primaryHex, roughness: 0.4 }),
  )
  frameLeft.position.set(-0.1, 0.17, -0.02)
  const frameRight = new THREE.Mesh(
    new THREE.BoxGeometry(0.036, 0.3, 0.16),
    mat({ color: skin.primaryHex, roughness: 0.4 }),
  )
  frameRight.position.set(0.1, 0.17, -0.02)
  const topHousing = new THREE.Mesh(
    new THREE.BoxGeometry(0.24, 0.08, 0.18),
    mat({ color: '#242930', roughness: 0.45 }),
  )
  topHousing.position.set(0, 0.32, -0.02)

  // 左右红白卷膜轴
  const spoolL = new THREE.Mesh(
    new THREE.CylinderGeometry(0.036, 0.036, 0.14, 12),
    mat({ color: skin.primaryHex, roughness: 0.35 }),
  )
  spoolL.rotation.z = Math.PI / 2
  spoolL.position.set(-0.075, 0.35, 0.03)
  const spoolR = new THREE.Mesh(
    new THREE.CylinderGeometry(0.036, 0.036, 0.14, 12),
    mat({ color: '#f7eee2', roughness: 0.35 }),
  )
  spoolR.rotation.z = Math.PI / 2
  spoolR.position.set(0.075, 0.35, 0.03)

  // 可上下升降热压封口头
  const platen = new THREE.Group()
  platen.position.set(0, 0.25, -0.02)
  const platenPlate = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, 0.026, 12),
    mat({ color: '#c4cdd6', metalness: 0.72, roughness: 0.22 }),
  )
  const heaterGlow = new THREE.Mesh(
    new THREE.TorusGeometry(0.048, 0.004, 4, 12),
    mat({ color: '#ff962e', emissive: '#ff5500', emissiveIntensity: 0.9 }),
  )
  heaterGlow.rotation.x = Math.PI / 2
  heaterGlow.position.y = -0.013
  heaterGlow.visible = false
  platen.add(platenPlate, heaterGlow)

  // 可前后滑动托盘 + 待封口杯
  const trayGroup = new THREE.Group()
  trayGroup.position.set(0, 0.028, 0.08)
  const tray = new THREE.Mesh(
    new THREE.BoxGeometry(0.14, 0.016, 0.14),
    mat({ color: '#2b3038', metalness: 0.5 }),
  )
  const cup = new THREE.Mesh(
    new THREE.CylinderGeometry(0.042, 0.031, 0.145, 12),
    mat({ color: '#f6fbff', roughness: 0.16, transparent: true, opacity: 0.36, depthWrite: false }),
  )
  cup.position.y = 0.08
  const liquid = new THREE.Mesh(
    new THREE.CylinderGeometry(0.038, 0.029, 0.125, 12),
    mat({ color: '#d9b589', roughness: 0.28 }),
  )
  liquid.position.y = 0.072
  const sealedFilm = new THREE.Mesh(
    new THREE.CylinderGeometry(0.043, 0.043, 0.004, 12),
    mat({ color: skin.primaryHex, roughness: 0.28 }),
  )
  sealedFilm.position.y = 0.153
  sealedFilm.visible = false
  trayGroup.add(tray, liquid, cup, sealedFilm)

  group.add(frameLeft, frameRight, topHousing, spoolL, spoolR, platen, trayGroup)

  let progress = 0
  let primaryMetric = 0
  let secondaryMetric = 0

  function setProgress(p: number): void {
    progress = Math.max(0, Math.min(1, Number.isFinite(p) ? p : 0))
    // 0..0.3 滑入舱内, 0.3..0.7 热压封口, 0.7..1.0 退出成杯
    const inFactor = progress < 0.32 ? 1 - THREE.MathUtils.smoothstep(progress, 0, 0.32) : THREE.MathUtils.smoothstep(progress, 0.68, 1.0)
    trayGroup.position.z = -0.02 + inFactor * 0.115

    const pressBell = progress > 0.28 && progress < 0.72 ? Math.sin(((progress - 0.28) / 0.44) * Math.PI) : 0
    platen.position.y = 0.255 - pressBell * 0.068
    heaterGlow.visible = pressBell > 0.55
    spoolL.rotation.x = progress * Math.PI * 2
    spoolR.rotation.x = progress * Math.PI * 2
    sealedFilm.visible = progress >= 0.54

    primaryMetric = Number(trayGroup.position.z.toFixed(4))
    secondaryMetric = Number(platen.position.y.toFixed(4))
  }
  setProgress(0)

  return makeRigHandle('cup_seal', group, setProgress, () => ({ progress, primaryMetric, secondaryMetric }))
}

function buildFruitPourRig(skin: DrinkSkinConfig): EquipmentRigController {
  const group = new THREE.Group()
  group.name = 'equip_fruit_pour'
  addCounterBase(group, 0.36, 0.28)

  // 右侧透明待加料杯
  const cup = new THREE.Mesh(
    new THREE.CylinderGeometry(0.043, 0.031, 0.155, 12),
    mat({ color: '#f8fcff', roughness: 0.15, transparent: true, opacity: 0.34, depthWrite: false }),
  )
  cup.position.set(0.05, 0.1, 0)
  cup.renderOrder = 3
  const cupFill = new THREE.Mesh(
    new THREE.CylinderGeometry(0.037, 0.029, 0.095, 12).translate(0, 0.0475, 0),
    mat({ color: '#f59e24', roughness: 0.24, transparent: true, opacity: 0.88 }),
  )
  cupFill.position.set(0.05, 0.026, 0)
  cupFill.scale.y = 0.05

  // 左侧果料定量倾倒壶
  const pitcherPivot = new THREE.Group()
  pitcherPivot.position.set(-0.075, 0.21, 0)
  const pitcherWall = new THREE.Mesh(
    new THREE.CylinderGeometry(0.036, 0.029, 0.1, 12),
    mat({ color: '#e9f2f7', roughness: 0.25, transparent: true, opacity: 0.65 }),
  )
  const pitcherPulp = new THREE.Mesh(
    new THREE.CylinderGeometry(0.032, 0.027, 0.065, 10),
    mat({ color: '#ff8e1a', roughness: 0.22 }),
  )
  pitcherPulp.position.y = -0.012
  const handle = new THREE.Mesh(
    new THREE.BoxGeometry(0.028, 0.055, 0.012),
    mat({ color: skin.primaryHex, roughness: 0.38 }),
  )
  handle.position.set(-0.044, 0, 0)
  pitcherPivot.add(pitcherWall, pitcherPulp, handle)

  // 注液果料流柱
  const pourStream = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0055, 0.0075, 0.145, 8),
    mat({ color: '#ffa326', roughness: 0.2 }),
  )
  pourStream.position.set(0.024, 0.175, 0)
  pourStream.rotation.z = -0.22
  pourStream.visible = false

  group.add(cupFill, cup, pitcherPivot, pourStream)

  let progress = 0
  let primaryMetric = 0
  let secondaryMetric = 0

  function setProgress(p: number): void {
    progress = Math.max(0, Math.min(1, Number.isFinite(p) ? p : 0))
    const pourCurve = Math.sin(progress * Math.PI)
    pitcherPivot.rotation.z = -pourCurve * 0.96
    pitcherPivot.position.x = -0.075 + pourCurve * 0.052
    pitcherPivot.position.y = 0.21 + pourCurve * 0.045

    const streamOn = progress > 0.18 && progress < 0.84
    pourStream.visible = streamOn
    pourStream.scale.set(0.6 + pourCurve * 0.55, 1, 0.6 + pourCurve * 0.55)

    const fillAmt = 0.06 + THREE.MathUtils.smoothstep(progress, 0.16, 0.88) * 0.94
    cupFill.scale.y = fillAmt
    pitcherPulp.scale.y = Math.max(0.2, 1 - fillAmt * 0.65)
    primaryMetric = Number(Math.abs(pitcherPivot.rotation.z).toFixed(4))
    secondaryMetric = Number(fillAmt.toFixed(4))
  }
  setProgress(0)

  return makeRigHandle('fruit_pour', group, setProgress, () => ({ progress, primaryMetric, secondaryMetric }))
}

function buildIceScoopRig(skin: DrinkSkinConfig): EquipmentRigController {
  const group = new THREE.Group()
  group.name = 'equip_ice_scoop'
  addCounterBase(group, 0.38, 0.3)

  // 左侧不锈钢冰槽（含底冰）
  const iceBin = new THREE.Mesh(
    new THREE.BoxGeometry(0.14, 0.085, 0.18),
    mat({ color: '#c8d6e2', metalness: 0.62, roughness: 0.28 }),
  )
  iceBin.position.set(-0.095, 0.062, 0)

  // 右侧透明待加冰杯
  const cup = new THREE.Mesh(
    new THREE.CylinderGeometry(0.043, 0.031, 0.155, 12),
    mat({ color: '#f8fcff', roughness: 0.14, transparent: true, opacity: 0.32, depthWrite: false }),
  )
  cup.position.set(0.085, 0.1, 0)
  cup.renderOrder = 3

  const iceMat = mat({ color: '#e6f8ff', roughness: 0.14, transparent: true, opacity: 0.72 })
  const cubeGeo = new THREE.BoxGeometry(0.015, 0.013, 0.015)

  // 杯内落定冰块组
  const cupIceGroup = new THREE.Group()
  cupIceGroup.position.set(0.085, 0.04, 0)
  const cupCubes: THREE.Mesh[] = []
  for (let i = 0; i < 6; i++) {
    const c = new THREE.Mesh(cubeGeo, iceMat)
    const a = i * 1.15
    c.position.set(Math.cos(a) * 0.015, i * 0.014, Math.sin(a) * 0.015)
    c.rotation.set(0.3 * i, 0.5 * i, 0.2 * i)
    cupIceGroup.add(c)
    cupCubes.push(c)
  }

  // 可移动倾斜冰铲 + 铲内待倾倒冰块
  const scoopPivot = new THREE.Group()
  scoopPivot.position.set(-0.09, 0.14, 0)
  const scoopHead = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.02, 0.075, 10, 1, false, 0, Math.PI * 1.25),
    mat({ color: '#edf9ff', roughness: 0.2, transparent: true, opacity: 0.78 }),
  )
  scoopHead.rotation.z = Math.PI / 2
  const scoopHandle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.007, 0.007, 0.065, 8),
    mat({ color: skin.primaryHex, roughness: 0.38 }),
  )
  scoopHandle.rotation.z = Math.PI / 2
  scoopHandle.position.x = -0.065
  const scoopIceGroup = new THREE.Group()
  scoopIceGroup.position.set(0.01, 0.008, 0)
  for (let i = 0; i < 4; i++) {
    const ic = new THREE.Mesh(cubeGeo, iceMat)
    ic.position.set((i % 2) * 0.016 - 0.008, Math.floor(i / 2) * 0.013, (i % 3) * 0.008 - 0.008)
    scoopIceGroup.add(ic)
  }
  scoopPivot.add(scoopHead, scoopHandle, scoopIceGroup)

  // 半空中下坠碎冰
  const fallingIce = new THREE.Group()
  fallingIce.position.set(0.07, 0.19, 0)
  for (let i = 0; i < 3; i++) {
    const fc = new THREE.Mesh(cubeGeo, iceMat)
    fc.position.set((i - 1) * 0.01, -i * 0.022, 0)
    fallingIce.add(fc)
  }
  fallingIce.visible = false

  group.add(iceBin, cupIceGroup, cup, scoopPivot, fallingIce)

  let progress = 0
  let primaryMetric = 0
  let secondaryMetric = 0

  function setProgress(p: number): void {
    progress = Math.max(0, Math.min(1, Number.isFinite(p) ? p : 0))
    const arc = Math.sin(progress * Math.PI)
    scoopPivot.position.x = THREE.MathUtils.lerp(-0.085, 0.025, arc)
    scoopPivot.position.y = 0.14 + arc * 0.115
    scoopPivot.rotation.z = -arc * 0.84

    scoopIceGroup.visible = progress < 0.56
    fallingIce.visible = progress >= 0.32 && progress <= 0.74
    fallingIce.position.y = 0.215 - ((progress - 0.32) / 0.42) * 0.045

    const droppedCount = Math.floor(THREE.MathUtils.smoothstep(progress, 0.38, 0.92) * cupCubes.length)
    cupCubes.forEach((c, idx) => {
      c.visible = idx < droppedCount
    })
    primaryMetric = Number(scoopPivot.position.x.toFixed(4))
    secondaryMetric = droppedCount
  }
  setProgress(0)

  return makeRigHandle('ice_scoop', group, setProgress, () => ({ progress, primaryMetric, secondaryMetric }))
}

function buildLabelApplyRig(skin: DrinkSkinConfig): EquipmentRigController {
  const group = new THREE.Group()
  group.name = 'equip_label_apply'
  addCounterBase(group, 0.38, 0.28)

  // 左侧白红热敏出单机
  const printerBody = new THREE.Mesh(
    new THREE.BoxGeometry(0.125, 0.125, 0.145),
    mat({ color: skin.creamHex, roughness: 0.42 }),
  )
  printerBody.position.set(-0.095, 0.084, 0)
  const printerRoof = new THREE.Mesh(
    new THREE.BoxGeometry(0.128, 0.025, 0.148),
    mat({ color: skin.primaryHex, roughness: 0.38 }),
  )
  printerRoof.position.set(-0.095, 0.15, 0)

  // 右侧成品杯
  const cup = new THREE.Mesh(
    new THREE.CylinderGeometry(0.043, 0.031, 0.155, 12),
    mat({ color: '#d9b589', roughness: 0.35 }),
  )
  cup.position.set(0.08, 0.1, 0)
  const seal = new THREE.Mesh(
    new THREE.CylinderGeometry(0.044, 0.044, 0.005, 12),
    mat({ color: skin.primaryHex, roughness: 0.3 }),
  )
  seal.position.set(0.08, 0.178, 0)

  // 热敏纸质订单贴标贴片（前半程从出单机滑出，后半程贴附于杯身正面）
  const labelTex = createThermalOrderLabelTexture('#A08', '鲜饮现制')
  const labelMat = mat({
    color: labelTex ? '#ffffff' : '#fff8e8',
    ...(labelTex ? { map: labelTex } : {}),
    roughness: 0.52,
    side: THREE.DoubleSide,
  })
  const ticketPlane = new THREE.Mesh(new THREE.PlaneGeometry(0.046, 0.03), labelMat)

  // 机械压贴臂（绕左侧立轴摆入再归位）
  const armPivot = new THREE.Group()
  armPivot.position.set(-0.025, 0.12, 0.048)
  const armBar = new THREE.Mesh(
    new THREE.BoxGeometry(0.085, 0.014, 0.014),
    mat({ color: '#2b313a', metalness: 0.5 }),
  )
  armBar.position.x = 0.042
  const tampPad = new THREE.Mesh(
    new THREE.BoxGeometry(0.026, 0.034, 0.016),
    mat({ color: skin.primaryHex, roughness: 0.36 }),
  )
  tampPad.position.set(0.082, 0, -0.005)
  armPivot.add(armBar, tampPad)

  group.add(printerBody, printerRoof, cup, seal, armPivot, ticketPlane)

  let progress = 0
  let primaryMetric = 0
  let secondaryMetric = 0

  function setProgress(p: number): void {
    progress = Math.max(0, Math.min(1, Number.isFinite(p) ? p : 0))
    const pressCurve = Math.sin(progress * Math.PI)
    // 压贴臂从开启角度 (-0.68 rad) 摆合压在杯正面 (0 rad) 再抬回
    armPivot.rotation.y = -(1 - pressCurve) * 0.72

    // 贴纸随前段滑向杯腹正面 (+0.042 z)，过半后稳贴杯身不动
    const stickProgress = THREE.MathUtils.smoothstep(progress, 0.1, 0.55)
    ticketPlane.position.set(
      THREE.MathUtils.lerp(-0.025, 0.08, stickProgress),
      THREE.MathUtils.lerp(0.118, 0.108, stickProgress),
      THREE.MathUtils.lerp(0.045, 0.041, stickProgress),
    )
    ticketPlane.rotation.y = THREE.MathUtils.lerp(-0.42, 0, stickProgress)

    primaryMetric = Number(armPivot.rotation.y.toFixed(4))
    secondaryMetric = Number(ticketPlane.position.x.toFixed(4))
  }
  setProgress(0)

  return makeRigHandle('label_apply', group, setProgress, () => ({ progress, primaryMetric, secondaryMetric }))
}

function makeRigHandle(
  id: EquipmentActionId,
  group: THREE.Group,
  setProgress: (p: number) => void,
  readMetrics: () => { progress: number; primaryMetric: number; secondaryMetric: number },
): EquipmentRigController {
  const spec = EQUIPMENT_ACTION_CATALOG[id]
  return {
    id,
    label: spec.label,
    stationKind: spec.stationKind,
    group,
    getProgress: () => readMetrics().progress,
    setProgress,
    getPhaseSnapshot() {
      const m = readMetrics()
      const phase: 'start' | 'mid' | 'end' = m.progress < 0.25 ? 'start' : m.progress < 0.8 ? 'mid' : 'end'
      return { ...m, phase }
    },
    getTriangles: () => countObjectTriangles(group),
    dispose: () => disposeDrinkProp(group),
  }
}

export function createDrinksEquipmentRig(
  actionId: EquipmentActionId,
  opts: EquipmentRigOptions = {},
): EquipmentRigController {
  const skin = resolveDrinkSkin(opts.skin)
  switch (actionId) {
    case 'ice_cream_dispense':
      return buildIceCreamDispenseRig(skin)
    case 'tea_shake':
      return buildTeaShakeRig(skin)
    case 'cup_seal':
      return buildCupSealRig(skin)
    case 'fruit_pour':
      return buildFruitPourRig(skin)
    case 'ice_scoop':
      return buildIceScoopRig(skin)
    case 'label_apply':
      return buildLabelApplyRig(skin)
  }
}
