import * as THREE from 'three'
import type { AvatarRig } from '../../walk/avatar-rig.ts'
import {
  buildRecruitStandee,
  createDrinksEquipmentRig,
  type EquipmentActionId,
  type EquipmentRigController,
  type RecruitStandeeController,
} from '../props/index.ts'
import { pickPrepStationAnchor, type DrinksStaffAnchors, type StaffZonePoint } from './anchors.ts'
import type { DrinksStaffStateSnapshot } from './workflow.ts'

export interface DrinksStaffVisualStage {
  readonly group: THREE.Group
  readonly standee: RecruitStandeeController
  sync(snap: DrinksStaffStateSnapshot, dtSec: number): void
  getMetrics(): { triangles: number; lights: number; activeEquipAction: EquipmentActionId | null }
  dispose(): void
}

const EQUIP_ACTIONS: readonly EquipmentActionId[] = [
  'ice_cream_dispense',
  'tea_shake',
  'cup_seal',
  'fruit_pour',
  'ice_scoop',
  'label_apply',
]

function setPosOnZone(obj: THREE.Object3D, pt: StaffZonePoint, yOffset = 0): void {
  obj.position.set(pt.x, (pt.y ?? 0) + yOffset, pt.z)
  obj.rotation.y = pt.yaw
}

function getJointObj(figure: THREE.Object3D, rig: AvatarRig | undefined, name: 'Torso' | 'Head' | 'ArmL' | 'ArmR' | 'ForearmL' | 'ForearmR') {
  return rig?.joints?.[name] ?? figure.getObjectByName(name)
}

export function resetStaffCharacterPose(figure: THREE.Object3D | null, rig?: AvatarRig | null): void {
  if (!figure) return
  if (rig) {
    rig.clearPose()
    return
  }
  for (const name of ['Torso', 'Head', 'ArmL', 'ArmR', 'ForearmL', 'ForearmR'] as const) {
    figure.getObjectByName(name)?.rotation.set(0, 0, 0)
  }
}

/**
 * 同步五步制作手部/头部动作与做错拒绝手势（兼容宿主骨骼 `AvatarRig` 与关节模型 `preview.ts`）。
 */
export function syncStaffCharacterGestures(
  figure: THREE.Object3D | null,
  rig: AvatarRig | undefined,
  snap: DrinksStaffStateSnapshot,
  animTime: number,
): void {
  if (!figure) return
  if (!snap.onDuty) {
    resetStaffCharacterPose(figure, rig)
    return
  }

  const head = getJointObj(figure, rig, 'Head')
  const torso = getJointObj(figure, rig, 'Torso')
  const armL = getJointObj(figure, rig, 'ArmL')
  const armR = getJointObj(figure, rig, 'ArmR')
  const forearmL = getJointObj(figure, rig, 'ForearmL')
  const forearmR = getJointObj(figure, rig, 'ForearmR')

  const mistakeActive = Boolean(snap.lastMistake && snap.lastMistake.expiresAtShiftSec > snap.shiftTimeSec)
  const gestureActive = Boolean(snap.lastStepGesture && snap.lastStepGesture.untilShiftSec > snap.shiftTimeSec)

  if (mistakeActive) {
    // 清晰拒绝反馈：快速摇头 + 右手在胸前(+Z变-Z即正角+X)摆手否定
    head?.rotation.set(0.05, Math.sin(animTime * 28) * 0.28, 0)
    torso?.rotation.set(0, 0, Math.sin(animTime * 20) * 0.05)
    armL?.rotation.set(0.24, 0, -0.06)
    forearmL?.rotation.set(0.35, 0, 0)
    armR?.rotation.set(0.78, 0, -0.14 + Math.sin(animTime * 22) * 0.22)
    forearmR?.rotation.set(0.65, 0, Math.sin(animTime * 24) * 0.34)
    return
  }

  if (snap.phase === 'shake_cup') {
    const wave = Math.sin(animTime * 24)
    const swing = Math.cos(animTime * 24)
    head?.rotation.set(-0.08, 0, 0)
    torso?.rotation.set(-0.06, wave * 0.06, 0)
    armR?.rotation.set(1.06 + wave * 0.34, 0.22, -0.12)
    forearmR?.rotation.set(0.78 + swing * 0.26, 0, 0)
    armL?.rotation.set(0.92 - wave * 0.24, -0.22, 0.1)
    forearmL?.rotation.set(0.68 - swing * 0.2, 0, 0)
    return
  }

  if (snap.phase === 'add_toppings') {
    const pourArc = Math.sin(snap.stepProgress * Math.PI)
    const jitter = Math.sin(animTime * 11) * 0.12
    head?.rotation.set(-0.12, -0.08, 0)
    torso?.rotation.set(-0.07, -0.1, 0)
    armR?.rotation.set(0.88 + pourArc * 0.42, 0.18, -0.1)
    forearmR?.rotation.set(0.48 + jitter, 0, pourArc * 0.22)
    armL?.rotation.set(0.44, -0.14, 0.05)
    forearmL?.rotation.set(0.52, 0, 0)
    return
  }

  if (snap.phase === 'seal_cup') {
    const push = Math.sin(snap.stepProgress * Math.PI)
    head?.rotation.set(-0.08, 0, 0)
    torso?.rotation.set(-0.05, 0, 0)
    armR?.rotation.set(0.76 + push * 0.32, 0.14, -0.06)
    forearmR?.rotation.set(0.46 + push * 0.22, 0, 0)
    armL?.rotation.set(0.32, 0, 0)
    forearmL?.rotation.set(0.36, 0, 0)
    return
  }

  if (snap.phase === 'call_pickup') {
    const reach = gestureActive ? 1.06 : 0.88 + Math.sin(animTime * 4.5) * 0.08
    head?.rotation.set(0, Math.sin(animTime * 2.5) * 0.08, 0)
    torso?.rotation.set(-0.04, 0, 0)
    armR?.rotation.set(reach, 0.08, -0.08)
    forearmR?.rotation.set(0.36, 0, 0)
    armL?.rotation.set(0.24, 0, 0)
    forearmL?.rotation.set(0.3, 0, 0)
    return
  }

  // `accept_order` / `idle_ready`: 站台收银点单微动作
  const tap = gestureActive ? 0.64 + Math.sin(animTime * 12) * 0.14 : 0.34 + Math.sin(animTime * 3) * 0.05
  head?.rotation.set(-0.04, 0, 0)
  torso?.rotation.set(-0.02, 0, 0)
  armR?.rotation.set(tap, 0.06, -0.04)
  forearmR?.rotation.set(0.42, 0, 0)
  armL?.rotation.set(0.18, 0, 0)
  forearmL?.rotation.set(0.22, 0, 0)
}

/**
 * 零 Z-fighting 的工作杯体：严格区分内层渐变液柱 (r * 0.84)、外层透明杯壁 (r * 1.0) 与外围腰封 (r * 1.045)，
 * 确保加料充液过程和叫号成杯均清晰无闪烁。
 */
function buildStationWorkCup() {
  const group = new THREE.Group()
  group.name = 'drinks-staff-work-cup'

  const cupH = 0.165
  const rTop = 0.056
  const rBot = 0.039

  const wallGeo = new THREE.CylinderGeometry(rTop, rBot, cupH, 18, 1, true)
  const wallMat = new THREE.MeshStandardMaterial({
    color: '#f2f9ff',
    roughness: 0.16,
    metalness: 0.05,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
  const wallMesh = new THREE.Mesh(wallGeo, wallMat)
  wallMesh.position.y = cupH * 0.5
  wallMesh.renderOrder = 3

  const rimGeo = new THREE.TorusGeometry(rTop, 0.004, 6, 18)
  const rimMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.32 })
  const rimMesh = new THREE.Mesh(rimGeo, rimMat)
  rimMesh.rotation.x = Math.PI / 2
  rimMesh.position.y = cupH

  const baseGeo = new THREE.CylinderGeometry(rBot * 0.96, rBot * 0.96, 0.006, 16)
  const baseMesh = new THREE.Mesh(baseGeo, rimMat)
  baseMesh.position.y = 0.003

  // Opaque liquid fill cylinder kept cleanly inside cup wall (0.83x radii, origin at bottom)
  const liqH = cupH - 0.022
  const liqGeo = new THREE.CylinderGeometry(rTop * 0.83, rBot * 0.83, liqH, 16)
  liqGeo.translate(0, liqH * 0.5, 0)
  const liqMat = new THREE.MeshStandardMaterial({
    color: '#ff6b8a',
    roughness: 0.28,
    emissive: new THREE.Color('#4a1220'),
    emissiveIntensity: 0.18,
  })
  const liqMesh = new THREE.Mesh(liqGeo, liqMat)
  liqMesh.position.y = 0.008

  // Waist collar strictly outside wall (r * 1.07, FrontSide) -> zero overlap / zero striping
  const midY = cupH * 0.38
  const midR = rBot + (rTop - rBot) * 0.38
  const bandGeo = new THREE.CylinderGeometry(midR * 1.07, (rBot + (rTop - rBot) * 0.18) * 1.07, cupH * 0.22, 18, 1, true)
  const bandMat = new THREE.MeshStandardMaterial({
    color: '#e60012',
    roughness: 0.42,
    side: THREE.FrontSide,
  })
  const bandMesh = new THREE.Mesh(bandGeo, bandMat)
  bandMesh.position.y = midY
  bandMesh.renderOrder = 4

  // Pearls / pulp chunks at cup base
  const pearlGeo = new THREE.SphereGeometry(0.0085, 8, 6)
  const pearlMat = new THREE.MeshStandardMaterial({ color: '#3b190f', roughness: 0.36 })
  const pearls = new THREE.Group()
  for (const [px, py, pz] of [
    [-0.015, 0.012, -0.01],
    [0.016, 0.012, -0.008],
    [0.0, 0.013, 0.016],
    [-0.01, 0.022, 0.011],
    [0.012, 0.022, 0.012],
  ] as const) {
    const p = new THREE.Mesh(pearlGeo, pearlMat)
    p.position.set(px, py, pz)
    pearls.add(p)
  }

  // Sealed flat red lid + straw (shown after seal)
  const lidGeo = new THREE.CylinderGeometry(rTop * 1.04, rTop * 1.04, 0.008, 18)
  const lidMat = new THREE.MeshStandardMaterial({ color: '#e60012', roughness: 0.34 })
  const lidMesh = new THREE.Mesh(lidGeo, lidMat)
  lidMesh.position.y = cupH + 0.004
  lidMesh.visible = false

  const strawGeo = new THREE.CylinderGeometry(0.005, 0.005, 0.19, 10)
  const strawMesh = new THREE.Mesh(strawGeo, lidMat)
  strawMesh.position.set(0.012, cupH + 0.02, -0.008)
  strawMesh.rotation.z = -0.08
  strawMesh.visible = false

  group.add(baseMesh, pearls, liqMesh, wallMesh, rimMesh, bandMesh, lidMesh, strawMesh)

  return {
    group,
    setStyle(cupColor: string, accentColor: string, sealed: boolean, fillRatio: number) {
      liqMat.color.set(cupColor)
      liqMat.emissive.set(cupColor).multiplyScalar(0.22)
      bandMat.color.set(accentColor === '#fff7f5' ? '#e60012' : accentColor)
      const clamped = Math.max(0.08, Math.min(1, fillRatio))
      liqMesh.scale.set(1, clamped, 1)
      lidMesh.visible = sealed
      strawMesh.visible = sealed
    },
    dispose() {
      for (const g of [wallGeo, rimGeo, baseGeo, liqGeo, bandGeo, pearlGeo, lidGeo, strawGeo]) g.dispose()
      for (const m of [wallMat, rimMat, liqMat, bandMat, pearlMat, lidMat]) m.dispose()
    },
  }
}

/**
 * 员工系统 3D 舞台道具与实时制作动效管理器（零外链、零额外光源）：
 * - 门口 A 字招聘立牌（靠近亮边反馈）
 * - 地面极简工位光环提示（引导玩家走向 接单 / 加料 / 封口 / 叫号 工位）
 * - 后厨台面设备动画与清晰无闪烁的工作饮品液位/封膜动效
 */
export function createDrinksStaffVisualStage(anchors: DrinksStaffAnchors): DrinksStaffVisualStage {
  const group = new THREE.Group()
  group.name = 'drinks-staff-stage'

  const standee = buildRecruitStandee()
  standee.group.position.set(anchors.recruitStandee.x, 0, anchors.recruitStandee.z)
  standee.group.rotation.y = anchors.recruitStandee.yaw
  group.add(standee.group)

  // Minimalist glowing floor station guide ring (zero lights)
  const ringGeo = new THREE.RingGeometry(0.42, 0.54, 28)
  const ringMat = new THREE.MeshBasicMaterial({
    color: '#e60012',
    transparent: true,
    opacity: 0.78,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
  const discGeo = new THREE.CircleGeometry(0.42, 24)
  const discMat = new THREE.MeshBasicMaterial({
    color: '#f6c33e',
    transparent: true,
    opacity: 0.2,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
  const guideGroup = new THREE.Group()
  guideGroup.name = 'drinks-staff-guide-ring'
  const ringMesh = new THREE.Mesh(ringGeo, ringMat)
  ringMesh.rotation.x = -Math.PI * 0.5
  ringMesh.position.y = 0.025
  const discMesh = new THREE.Mesh(discGeo, discMat)
  discMesh.rotation.x = -Math.PI * 0.5
  discMesh.position.y = 0.02
  guideGroup.add(ringMesh, discMesh)
  guideGroup.visible = false
  group.add(guideGroup)

  // Live animated workstation equipment rigs (lazily built once per action type)
  const equipRigs = new Map<EquipmentActionId, EquipmentRigController>()
  let activeActionId: EquipmentActionId | null = null
  const workCup = buildStationWorkCup()
  workCup.group.visible = false
  group.add(workCup.group)

  let animTime = 0
  let disposed = false

  function getOrBuildEquip(action: EquipmentActionId): EquipmentRigController {
    let rig = equipRigs.get(action)
    if (!rig) {
      rig = createDrinksEquipmentRig(action)
      rig.group.visible = false
      group.add(rig.group)
      equipRigs.set(action, rig)
    }
    return rig
  }

  function sync(snap: DrinksStaffStateSnapshot, dtSec: number): void {
    if (disposed) return
    animTime += Math.max(0, dtSec)

    standee.setHighlighted(snap.nearRecruit, snap.onDuty)

    // Guide floor ring follows target zone when on duty or right in front of recruit board
    const mistakeActive = Boolean(snap.lastMistake && snap.lastMistake.expiresAtShiftSec > snap.shiftTimeSec)
    const zone = snap.targetZone
    if (zone && (snap.onDuty || snap.nearRecruit)) {
      guideGroup.visible = true
      guideGroup.position.set(zone.x, 0, zone.z)
      const pulseSpeed = mistakeActive ? 16 : 4.5
      const pulseAmp = mistakeActive ? 0.14 : 0.06
      const pulse = 1 + Math.sin(animTime * pulseSpeed) * pulseAmp
      guideGroup.scale.set(pulse, 1, pulse)
      ringMat.color.set(mistakeActive ? '#ff4d00' : snap.onDuty ? '#e60012' : '#f6c33e')
    } else {
      guideGroup.visible = false
    }

    // Active workstation equipment rig & animated progress
    for (const [id, rig] of equipRigs) {
      rig.group.visible = id === snap.activeActionId
    }
    activeActionId = snap.activeActionId

    if (snap.activeActionId && snap.activeTicket) {
      const rig = getOrBuildEquip(snap.activeActionId)
      const isSeal = snap.phase === 'seal_cup'
      const isShake = snap.phase === 'shake_cup'
      const station = isSeal || isShake ? null : pickPrepStationAnchor(anchors, snap.activeTicket.stationKind)
      const anchor = isSeal ? anchors.sealStation : isShake ? anchors.shakeStation : station!
      const dx = !isSeal && !isShake && station?.kind === 'cream_top' ? -0.76 : 0
      // Sit squarely atop the open stainless prep bar deck (y = prepBarHeightM + 0.052, z ≈ -2.99)
      // with equipment facing +Z toward the player & aisle camera (rotation.y = 0)
      rig.group.position.set(anchor.x + dx, anchors.prepBarHeightM + 0.052, anchor.z - 0.64)
      rig.group.rotation.y = 0
      rig.group.scale.setScalar(isSeal ? 1.18 : 1.08)
      rig.group.visible = true
      rig.setProgress(snap.stepProgress)
    }

    // Live work-in-progress cup shown cleanly beside active station in shake_cup/add_toppings and on pickup counter in call_pickup.
    // Hidden during seal_cup because cup_seal equipment rig already slides its own cup inside the sealer cavity!
    if (snap.activeTicket && snap.activeCupPos && snap.phase !== 'seal_cup') {
      workCup.group.visible = true
      workCup.group.scale.setScalar(snap.phase === 'call_pickup' ? 1.15 : 1.28)
      workCup.setStyle(
        snap.activeTicket.cupColor,
        snap.activeTicket.accentColor,
        snap.cupLidSealed,
        snap.activeCupFill,
      )
      const shakeOffset = snap.phase === 'shake_cup' ? Math.abs(Math.sin(animTime * 22)) * 0.018 : 0
      const bob = snap.phase === 'call_pickup' ? Math.abs(Math.sin(animTime * 4.2)) * 0.022 : shakeOffset
      setPosOnZone(workCup.group, snap.activeCupPos, bob)
    } else {
      workCup.group.visible = false
    }
  }

  function getMetrics() {
    let triangles = 0
    let lights = 0
    group.traverse(obj => {
      if ((obj as THREE.Light).isLight) lights++
      const m = obj as THREE.Mesh
      if (m.isMesh && m.geometry) {
        const idx = m.geometry.index
        triangles += idx ? idx.count / 3 : m.geometry.attributes.position.count / 3
      }
    })
    return { triangles: Math.round(triangles), lights, activeEquipAction: activeActionId }
  }

  // Validate supported actions cleanly at build time
  void EQUIP_ACTIONS

  return {
    group,
    standee,
    sync,
    getMetrics,
    dispose() {
      if (disposed) return
      disposed = true
      standee.dispose()
      for (const rig of equipRigs.values()) rig.dispose()
      equipRigs.clear()
      workCup.dispose()
      ringGeo.dispose()
      ringMat.dispose()
      discGeo.dispose()
      discMat.dispose()
      group.removeFromParent()
    },
  }
}
