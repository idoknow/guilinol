import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { InteractionGesture } from '../sim/types.ts'
import { getInteractionBadgeVisual, type BadgeVisual } from './palette.ts'
import type { DrinksNpcSkinConfig } from './types.ts'

export interface NpcRenderPose {
  key: string
  isClerk: boolean
  x: number
  y: number
  z: number
  yaw: number
  speed: number
  seated: boolean
  making: boolean
  calling: boolean
  holdingCup: boolean
  cupColor: string | null
  holdingCrate: boolean
  cameraProp: boolean
  sipProgress: number
  shirtColor: string
  pantsColor: string
  skinColor: string
  hairColor: string
  apronColor: string
  capColor: string
  roleKind: 'clerk' | 'student' | 'office' | 'tourist' | 'local' | 'rider'
  gesture: InteractionGesture
  badge: BadgeVisual | null
}

export interface TableCupRenderPose {
  x: number
  y: number
  z: number
  cupColor: string
}

function buildCapGeometry(): THREE.BufferGeometry {
  const crown = new THREE.CylinderGeometry(0.155, 0.162, 0.085, 10)
  crown.translate(0, 0.03, 0)
  const visor = new THREE.BoxGeometry(0.19, 0.022, 0.13)
  visor.translate(0, 0.005, 0.14)
  const merged = mergeGeometries([crown.toNonIndexed(), visor.toNonIndexed()])!
  crown.dispose()
  visor.dispose()
  return merged
}

function buildSunHatGeometry(): THREE.BufferGeometry {
  const brim = new THREE.CylinderGeometry(0.27, 0.29, 0.024, 12)
  const crown = new THREE.CylinderGeometry(0.145, 0.165, 0.095, 10)
  crown.translate(0, 0.055, 0)
  const merged = mergeGeometries([brim.toNonIndexed(), crown.toNonIndexed()])!
  brim.dispose()
  crown.dispose()
  return merged
}

function buildCupLidGeometry(): THREE.BufferGeometry {
  const lid = new THREE.CylinderGeometry(0.058, 0.058, 0.02, 10)
  lid.translate(0, 0.088, 0)
  const straw = new THREE.CylinderGeometry(0.008, 0.008, 0.11, 6)
  straw.rotateZ(-0.18)
  straw.translate(0.014, 0.132, 0)
  const merged = mergeGeometries([lid.toNonIndexed(), straw.toNonIndexed()])!
  lid.dispose()
  straw.dispose()
  return merged
}

function createBadgeTexture(badge: BadgeVisual): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 224
  canvas.height = 64
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  ctx.fillStyle = badge.bg
  ctx.beginPath()
  ctx.roundRect(6, 6, 212, 52, 22)
  ctx.fill()

  ctx.strokeStyle = badge.accent
  ctx.lineWidth = 3
  ctx.stroke()

  ctx.fillStyle = badge.accent
  ctx.beginPath()
  ctx.arc(30, 32, 7, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = '#f8fafc'
  ctx.font = 'bold 24px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif'
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.fillText(badge.text, 46, 33)

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.needsUpdate = true
  return tex
}

export class DrinksNpcRigPool {
  readonly group = new THREE.Group()
  readonly capacity: number
  readonly maxVisibleBadges: number
  readonly drawCallLayers = 15

  private readonly geometries: THREE.BufferGeometry[] = []
  private readonly materials: THREE.Material[] = []
  private readonly instancedMeshes: THREE.InstancedMesh[] = []

  private readonly shadowMesh: THREE.InstancedMesh
  private readonly torsoMesh: THREE.InstancedMesh
  private readonly apronMesh: THREE.InstancedMesh
  private readonly headMesh: THREE.InstancedMesh
  private readonly hairMesh: THREE.InstancedMesh
  private readonly capMesh: THREE.InstancedMesh
  private readonly sunHatMesh: THREE.InstancedMesh
  private readonly packMesh: THREE.InstancedMesh
  private readonly armLMesh: THREE.InstancedMesh
  private readonly armRMesh: THREE.InstancedMesh
  private readonly legLMesh: THREE.InstancedMesh
  private readonly legRMesh: THREE.InstancedMesh
  private readonly shoeLMesh: THREE.InstancedMesh
  private readonly shoeRMesh: THREE.InstancedMesh
  private readonly cupMesh: THREE.InstancedMesh
  private readonly cupLidMesh: THREE.InstancedMesh
  private readonly crateMesh: THREE.InstancedMesh
  private readonly cameraPropMesh: THREE.InstancedMesh
  private readonly tableCupMesh: THREE.InstancedMesh
  private readonly tableCupLidMesh: THREE.InstancedMesh

  private readonly showBadges: boolean
  private readonly badgeGroup = new THREE.Group()
  private readonly badgeSprites: THREE.Sprite[] = []
  private readonly badgeKeys: string[] = []
  private readonly badgeTextureCache = new Map<string, THREE.CanvasTexture>()
  private visibleBadgeCount = 0

  private readonly mRoot = new THREE.Matrix4()
  private readonly mPart = new THREE.Matrix4()
  private readonly mArmR = new THREE.Matrix4()
  private readonly mLocal = new THREE.Matrix4()
  private readonly mZero = new THREE.Matrix4().makeScale(0, 0, 0)
  private readonly qRot = new THREE.Quaternion()
  private readonly eul = new THREE.Euler(0, 0, 0, 'YXZ')
  private readonly vPos = new THREE.Vector3()
  private readonly vScale = new THREE.Vector3(1, 1, 1)
  private readonly cTmp = new THREE.Color()
  private readonly vWorldBadge = new THREE.Vector3()

  constructor(capacity = 48, showBadges = true, maxVisibleBadges = 8) {
    this.capacity = capacity
    this.showBadges = showBadges
    this.maxVisibleBadges = Math.max(1, maxVisibleBadges)
    this.group.name = 'drinks-npc-pool'
    this.badgeGroup.name = 'drinks-npc-badges'
    this.group.add(this.badgeGroup)

    const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
      this.geometries.push(g)
      return g
    }
    const trackMat = <T extends THREE.Material>(m: T): T => {
      this.materials.push(m)
      return m
    }

    const baseMat = trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.84,
        metalness: 0.03,
        flatShading: true,
      }),
    )
    const darkShoeMat = trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x242220,
        roughness: 0.9,
        metalness: 0.02,
        flatShading: true,
      }),
    )
    const lidMat = trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xf9f7f2,
        roughness: 0.6,
        metalness: 0.04,
        flatShading: true,
      }),
    )
    const crateMat = trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xb9854c,
        roughness: 0.86,
        metalness: 0.04,
        flatShading: true,
      }),
    )
    const cameraMat = trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x1e242b,
        roughness: 0.4,
        metalness: 0.25,
        flatShading: true,
      }),
    )
    const shadowMat = trackMat(
      new THREE.MeshBasicMaterial({
        color: 0x101419,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
      }),
    )

    const makeInst = (geo: THREE.BufferGeometry, mat: THREE.Material, customCap = capacity): THREE.InstancedMesh => {
      const m = new THREE.InstancedMesh(trackGeo(geo), mat, customCap)
      m.frustumCulled = false
      m.count = 0
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      this.instancedMeshes.push(m)
      this.group.add(m)
      return m
    }

    const shadowGeo = new THREE.CircleGeometry(0.28, 12)
    shadowGeo.rotateX(-Math.PI / 2)
    this.shadowMesh = makeInst(shadowGeo, shadowMat)

    this.torsoMesh = makeInst(new THREE.BoxGeometry(0.42, 0.56, 0.24), baseMat)
    this.apronMesh = makeInst(new THREE.BoxGeometry(0.435, 0.5, 0.258), baseMat)
    this.headMesh = makeInst(new THREE.IcosahedronGeometry(0.145, 1), baseMat)
    this.hairMesh = makeInst(new THREE.SphereGeometry(0.16, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.56), baseMat)
    this.capMesh = makeInst(buildCapGeometry(), baseMat)
    this.sunHatMesh = makeInst(buildSunHatGeometry(), baseMat)
    this.packMesh = makeInst(new THREE.BoxGeometry(0.3, 0.36, 0.16), baseMat)

    const armGeo = new THREE.BoxGeometry(0.105, 0.46, 0.105)
    armGeo.translate(0, -0.2, 0)
    this.armLMesh = makeInst(armGeo, baseMat)
    this.armRMesh = makeInst(armGeo.clone(), baseMat)

    const legGeo = new THREE.BoxGeometry(0.14, 0.66, 0.15)
    legGeo.translate(0, -0.33, 0)
    this.legLMesh = makeInst(legGeo, baseMat)
    this.legRMesh = makeInst(legGeo.clone(), baseMat)

    const shoeGeo = new THREE.BoxGeometry(0.15, 0.09, 0.23)
    this.shoeLMesh = makeInst(shoeGeo, darkShoeMat)
    this.shoeRMesh = makeInst(shoeGeo.clone(), darkShoeMat)

    const cupGeo = new THREE.CylinderGeometry(0.054, 0.04, 0.165, 10)
    const lidGeo = buildCupLidGeometry()
    this.cupMesh = makeInst(cupGeo, baseMat)
    this.cupLidMesh = makeInst(lidGeo, lidMat)
    this.crateMesh = makeInst(new THREE.BoxGeometry(0.32, 0.2, 0.24), crateMat)
    this.cameraPropMesh = makeInst(new THREE.BoxGeometry(0.11, 0.075, 0.032), cameraMat)
    this.tableCupMesh = makeInst(cupGeo.clone(), baseMat, 16)
    this.tableCupLidMesh = makeInst(lidGeo.clone(), lidMat, 16)

    if (this.showBadges && typeof document !== 'undefined') {
      for (let i = 0; i < capacity; i++) {
        const mat = trackMat(
          new THREE.SpriteMaterial({
            transparent: true,
            opacity: 0.95,
            depthTest: true,
            depthWrite: false,
            fog: false,
          }),
        )
        const sprite = new THREE.Sprite(mat)
        sprite.visible = false
        sprite.renderOrder = 2
        sprite.scale.set(0.76, 0.22, 1)
        this.badgeGroup.add(sprite)
        this.badgeSprites.push(sprite)
        this.badgeKeys.push('')
      }
    }
  }

  private composeAt(
    mesh: THREE.InstancedMesh,
    index: number,
    lx: number,
    ly: number,
    lz: number,
    rx: number,
    ry: number,
    rz: number,
    sx = 1,
    sy = 1,
    sz = 1,
    colorHex?: string,
  ): void {
    this.eul.set(rx, ry, rz, 'YXZ')
    this.qRot.setFromEuler(this.eul)
    this.vPos.set(lx, ly, lz)
    this.vScale.set(sx, sy, sz)
    this.mLocal.compose(this.vPos, this.qRot, this.vScale)
    this.mPart.multiplyMatrices(this.mRoot, this.mLocal)
    mesh.setMatrixAt(index, this.mPart)
    if (colorHex) {
      this.cTmp.set(colorHex)
      mesh.setColorAt(index, this.cTmp)
    }
  }

  private hideSlot(mesh: THREE.InstancedMesh, index: number): void {
    mesh.setMatrixAt(index, this.mZero)
  }

  update(
    poses: readonly NpcRenderPose[],
    simTimeSec: number,
    cameraPos?: THREE.Vector3,
    tableCups: readonly TableCupRenderPose[] = [],
  ): number {
    const count = Math.min(poses.length, this.capacity)

    const badgeCandidates: Array<{
      slotIdx: number
      badge: BadgeVisual
      x: number
      y: number
      z: number
      score: number
    }> = []

    for (let i = 0; i < count; i++) {
      const p = poses[i]!
      const walking = p.speed > 0.12 && !p.seated
      const strideFreq = 7.2
      const walkPhase = simTimeSec * strideFreq + i * 1.37
      const strideAmp = walking ? Math.min(0.56, p.speed * 0.28) : 0
      const bobY = walking ? Math.abs(Math.sin(walkPhase)) * 0.028 : Math.sin(simTimeSec * 2.2 + i) * 0.008
      const seatOffsetY = p.seated ? -0.35 : 0
      const bodyY = seatOffsetY + bobY

      this.eul.set(0, p.yaw, 0, 'YXZ')
      this.qRot.setFromEuler(this.eul)
      this.vPos.set(p.x, p.y, p.z)
      this.vScale.set(1, 1, 1)
      this.mRoot.compose(this.vPos, this.qRot, this.vScale)

      this.composeAt(this.shadowMesh, i, 0, 0.018, 0, 0, 0, 0)

      let torsoPitch = p.seated ? -0.04 : 0
      let headPitch = 0
      let headYaw = p.making ? 0.12 : Math.sin(simTimeSec * 1.4 + i * 2.1) * 0.09
      if (p.gesture === 'look_up') {
        headPitch = -0.32
        headYaw = 0
      } else if (p.gesture === 'chat_nod' || p.gesture === 'talk') {
        headPitch = Math.sin(simTimeSec * 6.5 + i) * 0.12
      } else if (p.gesture === 'angry_stamp') {
        headYaw = Math.sin(simTimeSec * 14 + i) * 0.22
        torsoPitch = -0.08
      } else if (p.gesture === 'clean_wipe' || p.gesture === 'urge_wave') {
        torsoPitch = 0.14
      }

      this.composeAt(this.torsoMesh, i, 0, 1.02 + bodyY, 0, torsoPitch, 0, 0, 1, 1, 1, p.shirtColor)
      this.composeAt(this.headMesh, i, 0, 1.49 + bodyY, 0, headPitch, headYaw, 0, 1, 1, 1, p.skinColor)
      this.composeAt(this.hairMesh, i, 0, 1.52 + bodyY, -0.01, headPitch, headYaw, 0, 1, 1, 1, p.hairColor)

      if (p.isClerk) {
        this.composeAt(this.apronMesh, i, 0, 0.98 + bodyY, 0.008, torsoPitch, 0, 0, 1, 1, 1, p.apronColor)
        this.composeAt(this.capMesh, i, 0, 1.595 + bodyY, 0, headPitch, headYaw, 0, 1, 1, 1, p.capColor)
        this.hideSlot(this.sunHatMesh, i)
        this.hideSlot(this.packMesh, i)
      } else {
        this.hideSlot(this.apronMesh, i)
        this.hideSlot(this.capMesh, i)
        if (p.roleKind === 'tourist') {
          this.composeAt(this.sunHatMesh, i, 0, 1.61 + bodyY, 0, headPitch, headYaw, 0, 1, 1, 1, '#dcc48d')
        } else if (p.roleKind === 'rider') {
          this.composeAt(this.sunHatMesh, i, 0, 1.59 + bodyY, 0, headPitch, headYaw, 0, 0.72, 1.25, 0.72, '#e6ab24')
        } else {
          this.hideSlot(this.sunHatMesh, i)
        }
        if (p.roleKind === 'student') {
          this.composeAt(this.packMesh, i, 0, 1.03 + bodyY, -0.19, torsoPitch, 0, 0, 1, 1, 1, '#314b60')
        } else if (p.roleKind === 'rider') {
          this.composeAt(this.packMesh, i, 0, 1.08 + bodyY, -0.22, torsoPitch, 0, 0, 1.15, 1.08, 1.25, '#2b77c2')
        } else {
          this.hideSlot(this.packMesh, i)
        }
      }

      const legSwing = Math.sin(walkPhase) * strideAmp
      const legLx = p.seated ? -Math.PI * 0.48 : legSwing
      const legRx = p.seated ? -Math.PI * 0.48 : -legSwing
      this.composeAt(this.legLMesh, i, -0.105, 0.72 + bodyY, 0, legLx, 0, 0, 1, 1, 1, p.pantsColor)
      this.composeAt(this.legRMesh, i, 0.105, 0.72 + bodyY, 0, legRx, 0, 0, 1, 1, 1, p.pantsColor)

      const shoeLocalY = -0.675
      const shoeLocalZ = 0.04
      const shoeLy = 0.72 + bodyY + shoeLocalY * Math.cos(legLx) - shoeLocalZ * Math.sin(legLx)
      const shoeLz = shoeLocalY * Math.sin(legLx) + shoeLocalZ * Math.cos(legLx)
      const shoeRy = 0.72 + bodyY + shoeLocalY * Math.cos(legRx) - shoeLocalZ * Math.sin(legRx)
      const shoeRz = shoeLocalY * Math.sin(legRx) + shoeLocalZ * Math.cos(legRx)
      this.composeAt(this.shoeLMesh, i, -0.105, shoeLy, shoeLz, legLx, 0, 0)
      this.composeAt(this.shoeRMesh, i, 0.105, shoeRy, shoeRz, legRx, 0, 0)

      let armLx = -legSwing * 0.85
      let armRx = legSwing * 0.85
      let armLz = 0.05
      let armRz = -0.05
      let armRy = 0

      if (p.gesture === 'take_photo' || p.cameraProp) {
        armLx = -1.32
        armRx = -1.32
        armLz = -0.22
        armRz = 0.22
      } else if (p.gesture === 'handover_cup') {
        armRx = -1.16
        armLx = -0.35
      } else if (p.gesture === 'receive_cup') {
        armLx = -0.98
        armRx = -0.98
      } else if (p.gesture === 'give_change' || p.gesture === 'receive_change') {
        armRx = -0.95
        armLx = -0.18
      } else if (p.gesture === 'greet_wave' || p.gesture === 'claim_wave') {
        armRx = -1.55 + Math.sin(simTimeSec * 9 + i) * 0.25
        armRz = -0.22
      } else if (p.gesture === 'urge_wave') {
        armRx = -1.25 + Math.sin(simTimeSec * 11 + i) * 0.24
      } else if (p.gesture === 'angry_stamp') {
        armLx = -0.55
        armRx = -0.55
        armLz = 0.32
        armRz = -0.32
      } else if (p.gesture === 'clean_wipe') {
        armRx = -0.95
        armRy = Math.sin(simTimeSec * 9 + i) * 0.45
      } else if (p.gesture === 'remind_gesture' || p.gesture === 'yield_step') {
        armRx = -0.82
        armRz = -0.26
      } else if (p.gesture === 'talk' || p.gesture === 'chat_nod') {
        armRx = -0.58 + Math.sin(simTimeSec * 6 + i) * 0.16
      } else if (p.making) {
        const shake = Math.sin(simTimeSec * 10 + i) * 0.24
        armLx = -0.78 + shake
        armRx = -0.78 - shake
      } else if (p.holdingCrate) {
        armLx = -0.82
        armRx = -0.82
      } else if (p.calling) {
        armRx = -1.18 + Math.sin(simTimeSec * 6.5 + i) * 0.12
      } else if (p.holdingCup) {
        const sipLift = p.sipProgress > 0.55 ? Math.sin(((p.sipProgress - 0.55) / 0.45) * Math.PI) * 0.38 : 0
        armRx = (p.seated ? -1.06 : -0.82) - sipLift
      }

      this.composeAt(this.armLMesh, i, -0.27, 1.26 + bodyY, 0, armLx, 0, armLz, 1, 1, 1, p.shirtColor)
      this.composeAt(this.armRMesh, i, 0.27, 1.26 + bodyY, 0, armRx, armRy, armRz, 1, 1, 1, p.shirtColor)
      this.mArmR.copy(this.mPart)

      if (p.holdingCup) {
        this.eul.set(-armRx * 0.72, 0, 0, 'YXZ')
        this.qRot.setFromEuler(this.eul)
        this.vPos.set(0, -0.43, 0.07)
        this.vScale.set(1, 1, 1)
        this.mLocal.compose(this.vPos, this.qRot, this.vScale)
        this.mPart.multiplyMatrices(this.mArmR, this.mLocal)
        this.cupMesh.setMatrixAt(i, this.mPart)
        this.cTmp.set(p.cupColor || '#f5d262')
        this.cupMesh.setColorAt(i, this.cTmp)
        this.cupLidMesh.setMatrixAt(i, this.mPart)
      } else {
        this.hideSlot(this.cupMesh, i)
        this.hideSlot(this.cupLidMesh, i)
      }

      if (p.cameraProp || p.gesture === 'take_photo') {
        this.composeAt(this.cameraPropMesh, i, 0, 1.48 + bodyY, 0.38, -0.15, 0, 0)
      } else {
        this.hideSlot(this.cameraPropMesh, i)
      }

      if (p.holdingCrate) {
        this.composeAt(this.crateMesh, i, 0, 1.04 + bodyY, 0.28, 0, 0, 0)
      } else {
        this.hideSlot(this.crateMesh, i)
      }

      if (this.showBadges && p.badge) {
        const isChat = p.badge.key.startsWith('chat_pair_')
        const badgeY = p.y + (p.isClerk ? 2.18 : p.seated ? 1.82 : isChat ? 2.02 : 1.9) + bobY
        let distSq = 0
        if (cameraPos) {
          this.vWorldBadge.set(p.x, badgeY, p.z)
          distSq = this.vWorldBadge.distanceToSquared(cameraPos)
        }
        if (!cameraPos || distSq <= 26 * 26) {
          badgeCandidates.push({
            slotIdx: i,
            badge: p.badge,
            x: p.x,
            y: badgeY,
            z: p.z,
            score: p.badge.priority * 100 - distSq * 0.5,
          })
        }
      }
    }

    // Dirty table cups (rendered at tabletop height y = 0.78m until clerk cleans table)
    const tableCupCount = Math.min(tableCups.length, 16)
    for (let t = 0; t < tableCupCount; t++) {
      const tc = tableCups[t]!
      this.eul.set(0, 0, 0, 'YXZ')
      this.qRot.setFromEuler(this.eul)
      this.vPos.set(tc.x, tc.y, tc.z)
      this.vScale.set(1, 1, 1)
      this.mPart.compose(this.vPos, this.qRot, this.vScale)
      this.tableCupMesh.setMatrixAt(t, this.mPart)
      this.cTmp.set(tc.cupColor)
      this.tableCupMesh.setColorAt(t, this.cTmp)
      this.tableCupLidMesh.setMatrixAt(t, this.mPart)
    }

    // Apply capped short dialogue badges with screen-angle collision de-overlap
    for (const sp of this.badgeSprites) {
      sp.visible = false
    }
    this.visibleBadgeCount = 0
    if (this.showBadges && badgeCandidates.length > 0) {
      badgeCandidates.sort((a, b) => b.score - a.score)
      const placed: typeof badgeCandidates = []
      const limit = Math.min(this.maxVisibleBadges, this.badgeSprites.length)
      for (let idx = 0; idx < badgeCandidates.length && placed.length < limit; idx++) {
        const cand = badgeCandidates[idx]!
        if (cameraPos) {
          let blocked = false
          for (const prev of placed) {
            const dxP = prev.x - cameraPos.x
            const dyP = prev.y - cameraPos.y
            const dzP = prev.z - cameraPos.z
            const dP = Math.max(0.5, Math.hypot(dxP, dyP, dzP))
            const dxC = cand.x - cameraPos.x
            const dyC = cand.y - cameraPos.y
            const dzC = cand.z - cameraPos.z
            const dC = Math.max(0.5, Math.hypot(dxC, dyC, dzC))
            const angH = Math.hypot(dxC / dC - dxP / dP, dzC / dC - dzP / dP)
            const angV = Math.abs(dyC / dC - dyP / dP)
            const tolH = 0.48 / dP + 0.48 / dC
            const tolV = 0.16 / dP + 0.16 / dC
            if (angH < tolH && angV < tolV) {
              if (cand.badge.priority <= 65) {
                blocked = true
                break
              }
              cand.y += cand.y <= prev.y ? -0.22 : 0.26
            }
          }
          if (blocked) continue
        }
        placed.push(cand)
      }

      for (let b = 0; b < placed.length; b++) {
        const cand = placed[b]!
        const sprite = this.badgeSprites[b]!
        if (this.badgeKeys[b] !== cand.badge.key) {
          this.badgeKeys[b] = cand.badge.key
          let tex = this.badgeTextureCache.get(cand.badge.key)
          if (!tex) {
            tex = createBadgeTexture(cand.badge)
            this.badgeTextureCache.set(cand.badge.key, tex)
          }
          const mat = sprite.material as THREE.SpriteMaterial
          mat.map = tex
          mat.needsUpdate = true
        }
        sprite.position.set(cand.x, cand.y, cand.z)
        sprite.visible = true
        this.visibleBadgeCount++
      }
    }

    for (const mesh of this.instancedMeshes) {
      const isTableCup = mesh === this.tableCupMesh || mesh === this.tableCupLidMesh
      mesh.count = isTableCup ? tableCupCount : count
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }

    return count
  }

  getVisibleBadgeCount(): number {
    return this.visibleBadgeCount
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose()
    for (const m of this.materials) m.dispose()
    for (const tex of this.badgeTextureCache.values()) tex.dispose()
    this.badgeTextureCache.clear()
    this.group.removeFromParent()
  }
}

export function buildNpcRenderPoseFromClerk(
  clerk: {
    id: string
    state: 'idle' | 'walking' | 'taking_order' | 'making' | 'calling' | 'restocking' | 'cleaning_table' | 'patrolling'
    x: number
    z: number
    yaw: number
    speed: number
    holdingCup: boolean
    holdingCupColor: string | null
    holdingCrate: boolean
    interactionKind: import('../sim/types.ts').InteractionBubbleKind | null
    interactionGesture: InteractionGesture
    interactionTextVar: string | null
  },
  skin: DrinksNpcSkinConfig,
  worldX: number,
  worldY: number,
  worldZ: number,
  worldYaw: number,
  index = 0,
): NpcRenderPose {
  return {
    key: clerk.id,
    isClerk: true,
    x: worldX,
    y: worldY,
    z: worldZ,
    yaw: worldYaw,
    speed: clerk.speed,
    seated: false,
    making: clerk.state === 'making',
    calling: clerk.state === 'calling',
    holdingCup: clerk.holdingCup,
    cupColor: clerk.holdingCupColor,
    holdingCrate: clerk.holdingCrate,
    cameraProp: false,
    sipProgress: 0,
    shirtColor: skin.clerkShirtColor,
    pantsColor: skin.clerkPantsColor,
    skinColor: '#ecc5a2',
    hairColor: '#1f1b19',
    apronColor: skin.clerkApronColor,
    capColor: skin.clerkCapColor,
    roleKind: 'clerk',
    gesture: clerk.interactionGesture,
    badge: getInteractionBadgeVisual(clerk.interactionKind, skin, clerk.interactionTextVar, index),
  }
}

export function buildNpcRenderPoseFromCustomer(
  cust: {
    id: string
    roleKind: 'student' | 'office' | 'tourist' | 'local' | 'rider'
    phase:
      | 'entering'
      | 'browsing_menu'
      | 'queuing'
      | 'ordering'
      | 'waiting_pickup'
      | 'picking_up'
      | 'claiming_seat'
      | 'seated'
      | 'leaving'
    speed: number
    seated: boolean
    holdingCup: boolean
    cupColor: string | null
    cameraProp: boolean
    sipProgress: number
    shirtColor: string
    pantsColor: string
    skinColor: string
    hairColor: string
    variant: number
    interactionKind: import('../sim/types.ts').InteractionBubbleKind | null
    interactionGesture: InteractionGesture
    interactionTextVar: string | null
  },
  skin: DrinksNpcSkinConfig,
  worldX: number,
  worldY: number,
  worldZ: number,
  worldYaw: number,
): NpcRenderPose {
  return {
    key: cust.id,
    isClerk: false,
    x: worldX,
    y: worldY,
    z: worldZ,
    yaw: worldYaw,
    speed: cust.speed,
    seated: cust.seated,
    making: false,
    calling: false,
    holdingCup: cust.holdingCup,
    cupColor: cust.cupColor,
    holdingCrate: false,
    cameraProp: cust.cameraProp,
    sipProgress: cust.sipProgress,
    shirtColor: cust.shirtColor,
    pantsColor: cust.pantsColor,
    skinColor: cust.skinColor,
    hairColor: cust.hairColor,
    apronColor: '#ffffff',
    capColor: '#ffffff',
    roleKind: cust.roleKind,
    gesture: cust.interactionGesture,
    badge: getInteractionBadgeVisual(cust.interactionKind, skin, cust.interactionTextVar, cust.variant),
  }
}
