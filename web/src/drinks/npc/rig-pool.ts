import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { getClerkBadgeVisual, getCustomerBadgeVisual, type BadgeVisual } from './palette.ts'
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
  sipProgress: number
  shirtColor: string
  pantsColor: string
  skinColor: string
  hairColor: string
  apronColor: string
  capColor: string
  roleKind: 'clerk' | 'student' | 'office' | 'tourist' | 'local' | 'rider'
  badge: BadgeVisual | null
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
  canvas.width = 192
  canvas.height = 64
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  // Pill background
  ctx.fillStyle = badge.bg
  ctx.beginPath()
  ctx.roundRect(8, 8, 176, 48, 22)
  ctx.fill()

  // Crisp accent border
  ctx.strokeStyle = badge.accent
  ctx.lineWidth = 3
  ctx.stroke()

  // Dot + text
  ctx.fillStyle = badge.accent
  ctx.beginPath()
  ctx.arc(32, 32, 7, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = '#f8fafc'
  ctx.font = 'bold 24px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif'
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.fillText(badge.text, 48, 33)

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.needsUpdate = true
  return tex
}

export class DrinksNpcRigPool {
  readonly group = new THREE.Group()
  readonly capacity: number
  readonly drawCallLayers = 13

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

  private readonly showBadges: boolean
  private readonly badgeGroup = new THREE.Group()
  private readonly badgeSprites: THREE.Sprite[] = []
  private readonly badgeKeys: string[] = []
  private readonly badgeTextureCache = new Map<string, THREE.CanvasTexture>()

  // Reusable math scratch objects (zero per-frame heap allocation)
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

  constructor(capacity = 48, showBadges = true) {
    this.capacity = capacity
    this.showBadges = showBadges
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
    const shadowMat = trackMat(
      new THREE.MeshBasicMaterial({
        color: 0x101419,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
      }),
    )

    const makeInst = (geo: THREE.BufferGeometry, mat: THREE.Material): THREE.InstancedMesh => {
      const m = new THREE.InstancedMesh(trackGeo(geo), mat, capacity)
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

    this.cupMesh = makeInst(new THREE.CylinderGeometry(0.054, 0.04, 0.165, 10), baseMat)
    this.cupLidMesh = makeInst(buildCupLidGeometry(), lidMat)
    this.crateMesh = makeInst(new THREE.BoxGeometry(0.32, 0.2, 0.24), crateMat)

    if (this.showBadges && typeof document !== 'undefined') {
      for (let i = 0; i < capacity; i++) {
        const mat = trackMat(
          new THREE.SpriteMaterial({
            transparent: true,
            opacity: 0.94,
            depthTest: true,
            depthWrite: false,
            fog: false,
          }),
        )
        const sprite = new THREE.Sprite(mat)
        sprite.visible = false
        sprite.renderOrder = 2
        sprite.scale.set(0.66, 0.22, 1)
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

  update(poses: readonly NpcRenderPose[], simTimeSec: number, cameraPos?: THREE.Vector3): number {
    const count = Math.min(poses.length, this.capacity)

    for (let i = 0; i < count; i++) {
      const p = poses[i]!
      const walking = p.speed > 0.12 && !p.seated
      const strideFreq = 7.2
      const walkPhase = simTimeSec * strideFreq + i * 1.37
      const strideAmp = walking ? Math.min(0.56, p.speed * 0.28) : 0
      const bobY = walking ? Math.abs(Math.sin(walkPhase)) * 0.028 : Math.sin(simTimeSec * 2.2 + i) * 0.008
      const seatOffsetY = p.seated ? -0.35 : 0
      const bodyY = seatOffsetY + bobY

      // Root world transform
      this.eul.set(0, p.yaw, 0, 'YXZ')
      this.qRot.setFromEuler(this.eul)
      this.vPos.set(p.x, p.y, p.z)
      this.vScale.set(1, 1, 1)
      this.mRoot.compose(this.vPos, this.qRot, this.vScale)

      // Contact shadow stays on ground plane even when seated
      this.composeAt(this.shadowMesh, i, 0, 0.018, 0, 0, 0, 0)

      // Torso, head, hair
      this.composeAt(this.torsoMesh, i, 0, 1.02 + bodyY, 0, p.seated ? -0.04 : 0, 0, 0, 1, 1, 1, p.shirtColor)
      const headLook = p.making ? 0.12 : Math.sin(simTimeSec * 1.4 + i * 2.1) * 0.09
      this.composeAt(this.headMesh, i, 0, 1.49 + bodyY, 0, 0, headLook, 0, 1, 1, 1, p.skinColor)
      this.composeAt(this.hairMesh, i, 0, 1.52 + bodyY, -0.01, 0, headLook, 0, 1, 1, 1, p.hairColor)

      // Clerk apron & cap vs customer accessories
      if (p.isClerk) {
        this.composeAt(this.apronMesh, i, 0, 0.98 + bodyY, 0.008, 0, 0, 0, 1, 1, 1, p.apronColor)
        this.composeAt(this.capMesh, i, 0, 1.595 + bodyY, 0, 0, headLook, 0, 1, 1, 1, p.capColor)
        this.hideSlot(this.sunHatMesh, i)
        this.hideSlot(this.packMesh, i)
      } else {
        this.hideSlot(this.apronMesh, i)
        this.hideSlot(this.capMesh, i)
        if (p.roleKind === 'tourist') {
          this.composeAt(this.sunHatMesh, i, 0, 1.61 + bodyY, 0, 0, headLook, 0, 1, 1, 1, '#dcc48d')
        } else if (p.roleKind === 'rider') {
          this.composeAt(this.sunHatMesh, i, 0, 1.59 + bodyY, 0, 0, headLook, 0, 0.72, 1.25, 0.72, '#e6ab24')
        } else {
          this.hideSlot(this.sunHatMesh, i)
        }
        if (p.roleKind === 'student') {
          this.composeAt(this.packMesh, i, 0, 1.03 + bodyY, -0.19, 0, 0, 0, 1, 1, 1, '#314b60')
        } else if (p.roleKind === 'rider') {
          this.composeAt(this.packMesh, i, 0, 1.08 + bodyY, -0.22, 0, 0, 0, 1.15, 1.08, 1.25, '#2b77c2')
        } else {
          this.hideSlot(this.packMesh, i)
        }
      }

      // Legs & Shoes (right-hand rule: +Z forward => negative rotX swings leg forward)
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
      this.composeAt(this.shoeLMesh, i, -0.105, shoeLy, -shoeLz, legLx, 0, 0)
      this.composeAt(this.shoeRMesh, i, 0.105, shoeRy, -shoeRz, legRx, 0, 0)

      // Wait: double check leg shoe offset sign with right-hand rule around +X!
      // Vector (0, dy, dz) rotated around +X by theta:
      // y' = dy * cos(theta) - dz * sin(theta)
      // z' = dy * sin(theta) + dz * cos(theta)
      // Wait: earlier we proved arm/leg pointing down (0, -1, 0) with rotX = -theta moves z' = -sin(-theta) = +sin(theta) (+Z)!
      // In Matrix4.compose, rotX = theta applies y' = y cos(theta) - z sin(theta), z' = y sin(theta) + z cos(theta).
      // So with dy = -0.675, dz = +0.04 and theta = legLx:
      // y' = -0.675 * cos(legLx) - 0.04 * sin(legLx)
      // z' = -0.675 * sin(legLx) + 0.04 * cos(legLx)!
      // Wait: if legLx = -PI/2 (seated): sin(legLx) = -1 => z' = -0.675 * (-1) = +0.675 (FORWARD +Z)!
      // Let's fix the sign on shoeLz/shoeRz so shoes match the rotated leg tip cleanly!
      const exactShoeLz = shoeLocalY * Math.sin(legLx) + shoeLocalZ * Math.cos(legLx)
      const exactShoeRz = shoeLocalY * Math.sin(legRx) + shoeLocalZ * Math.cos(legRx)
      this.composeAt(this.shoeLMesh, i, -0.105, shoeLy, exactShoeLz, legLx, 0, 0)
      this.composeAt(this.shoeRMesh, i, 0.105, shoeRy, exactShoeRz, legRx, 0, 0)

      // Arms
      let armLx = -legSwing * 0.85
      let armRx = legSwing * 0.85
      if (p.making) {
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
        // Seated guests lift cup cleanly above 0.72m tabletop; standing/walking hold cup clearly in front
        armRx = (p.seated ? -1.06 : -0.82) - sipLift
      }

      this.composeAt(this.armLMesh, i, -0.27, 1.26 + bodyY, 0, armLx, 0, 0.05, 1, 1, 1, p.shirtColor)
      this.composeAt(this.armRMesh, i, 0.27, 1.26 + bodyY, 0, armRx, 0, -0.05, 1, 1, 1, p.shirtColor)
      this.mArmR.copy(this.mPart)

      // Cup + lid/straw in right hand
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

      // Supply crate when restocking
      if (p.holdingCrate) {
        this.composeAt(this.crateMesh, i, 0, 1.04 + bodyY, 0.28, 0, 0, 0)
      } else {
        this.hideSlot(this.crateMesh, i)
      }

      // Status badge sprite (depthTest: true, cached CanvasTexture)
      if (this.showBadges && this.badgeSprites[i]) {
        const sprite = this.badgeSprites[i]!
        if (!p.badge) {
          sprite.visible = false
        } else {
          const badgeY = p.y + (p.seated ? 1.82 : 2.12) + bobY
          let distOk = true
          if (cameraPos) {
            this.vWorldBadge.set(p.x, badgeY, p.z)
            distOk = this.vWorldBadge.distanceToSquared(cameraPos) <= 28 * 28
          }
          if (!distOk) {
            sprite.visible = false
          } else {
            if (this.badgeKeys[i] !== p.badge.key) {
              this.badgeKeys[i] = p.badge.key
              let tex = this.badgeTextureCache.get(p.badge.key)
              if (!tex) {
                tex = createBadgeTexture(p.badge)
                this.badgeTextureCache.set(p.badge.key, tex)
              }
              const mat = sprite.material as THREE.SpriteMaterial
              mat.map = tex
              mat.needsUpdate = true
            }
            sprite.position.set(p.x, badgeY, p.z)
            sprite.visible = true
          }
        }
      }
    }

    // Hide trailing badge sprites beyond count
    for (let i = count; i < this.badgeSprites.length; i++) {
      this.badgeSprites[i]!.visible = false
    }

    for (const mesh of this.instancedMeshes) {
      mesh.count = count
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }

    return count
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
    state: 'idle' | 'walking' | 'taking_order' | 'making' | 'calling' | 'restocking' | 'patrolling'
    x: number
    z: number
    yaw: number
    speed: number
    holdingCup: boolean
    holdingCupColor: string | null
    holdingCrate: boolean
    actionLabel: string
  },
  skin: DrinksNpcSkinConfig,
  worldX: number,
  worldY: number,
  worldZ: number,
  worldYaw: number,
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
    sipProgress: 0,
    shirtColor: skin.clerkShirtColor,
    pantsColor: skin.clerkPantsColor,
    skinColor: '#ecc5a2',
    hairColor: '#1f1b19',
    apronColor: skin.clerkApronColor,
    capColor: skin.clerkCapColor,
    roleKind: 'clerk',
    badge: getClerkBadgeVisual(clerk.state, clerk.actionLabel),
  }
}

export function buildNpcRenderPoseFromCustomer(
  cust: {
    id: string
    roleKind: 'student' | 'office' | 'tourist' | 'local' | 'rider'
    phase: 'entering' | 'browsing_menu' | 'queuing' | 'ordering' | 'waiting_pickup' | 'picking_up' | 'seated' | 'leaving'
    speed: number
    seated: boolean
    holdingCup: boolean
    cupColor: string | null
    sipProgress: number
    patienceRatio: number
    angry: boolean
    shirtColor: string
    pantsColor: string
    skinColor: string
    hairColor: string
  },
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
    sipProgress: cust.sipProgress,
    shirtColor: cust.shirtColor,
    pantsColor: cust.pantsColor,
    skinColor: cust.skinColor,
    hairColor: cust.hairColor,
    apronColor: '#ffffff',
    capColor: '#ffffff',
    roleKind: cust.roleKind,
    badge: getCustomerBadgeVisual(cust.phase, cust.roleKind, cust.angry, cust.patienceRatio),
  }
}
