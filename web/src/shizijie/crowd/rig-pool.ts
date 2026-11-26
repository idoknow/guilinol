import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import {
  MAX_SHIZIJIE_CROWD_DRAW_CALLS,
  MAX_SHIZIJIE_CROWD_NPCS,
  type SzjAgentState,
} from './types.ts'

function paintGeometry(geo: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const nonIndexed = geo.index ? geo.toNonIndexed() : geo.clone()
  geo.dispose()
  const pos = nonIndexed.getAttribute('position')
  const colors = new Float32Array(pos.count * 3)
  const c = new THREE.Color(hex)
  for (let i = 0; i < pos.count; i++) {
    const o = i * 3
    colors[o] = c.r
    colors[o + 1] = c.g
    colors[o + 2] = c.b
  }
  nonIndexed.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  nonIndexed.deleteAttribute('uv')
  return nonIndexed
}

function buildHeadHairGeometry(): THREE.BufferGeometry {
  const neck = new THREE.CylinderGeometry(0.055, 0.064, 0.085, 6)
  neck.translate(0, -0.105, 0)
  const head = new THREE.IcosahedronGeometry(0.138, 1)
  head.translate(0, 0.02, 0)
  const hair = new THREE.SphereGeometry(0.152, 9, 5, 0, Math.PI * 2, 0, Math.PI * 0.58)
  hair.translate(0, 0.036, -0.008)
  return mergeGeometries([
    paintGeometry(neck, 0xe7bfa0),
    paintGeometry(head, 0xf2ccb0),
    paintGeometry(hair, 0x26201c),
  ])!
}

function buildTorsoGeometry(): THREE.BufferGeometry {
  const chest = new THREE.BoxGeometry(0.40, 0.54, 0.22)
  const hemTrim = new THREE.BoxGeometry(0.415, 0.14, 0.232)
  hemTrim.translate(0, -0.20, 0)
  const collar = new THREE.BoxGeometry(0.22, 0.05, 0.19)
  collar.translate(0, 0.275, 0.01)
  return mergeGeometries([
    paintGeometry(chest, 0xffffff),
    paintGeometry(hemTrim, 0xdedede),
    paintGeometry(collar, 0xf2f0eb),
  ])!
}

function buildArmGeometry(): THREE.BufferGeometry {
  const sleeve = new THREE.BoxGeometry(0.10, 0.35, 0.10)
  sleeve.translate(0, -0.165, 0)
  const hand = new THREE.BoxGeometry(0.082, 0.11, 0.082)
  hand.translate(0, -0.39, 0)
  return mergeGeometries([
    paintGeometry(sleeve, 0xffffff),
    paintGeometry(hand, 0xedc6aa),
  ])!
}

function buildLegShoeGeometry(): THREE.BufferGeometry {
  const leg = new THREE.BoxGeometry(0.135, 0.57, 0.142)
  leg.translate(0, -0.285, 0)
  const shoe = new THREE.BoxGeometry(0.145, 0.092, 0.225)
  shoe.translate(0, -0.605, 0.034)
  return mergeGeometries([
    paintGeometry(leg, 0xffffff),
    paintGeometry(shoe, 0x22201e),
  ])!
}

function buildShoppingPropGeometry(): THREE.BufferGeometry {
  const bag = new THREE.BoxGeometry(0.23, 0.25, 0.095)
  bag.translate(0, -0.13, 0)
  const handle = new THREE.BoxGeometry(0.12, 0.075, 0.024)
  handle.translate(0, 0.025, 0)
  return mergeGeometries([
    paintGeometry(bag, 0xffffff),
    paintGeometry(handle, 0xd8d0c4),
  ])!
}

function countGeoTriangles(geo: THREE.BufferGeometry): number {
  const index = geo.getIndex()
  if (index) return Math.floor(index.count / 3)
  const pos = geo.getAttribute('position')
  return pos ? Math.floor(pos.count / 3) : 0
}

/**
 * 十字街 B1 地下街 6-Draw-Call 实例化人群渲染池（严格对齐 contract.ts SZJ_BUDGET）：
 * 48 名 NPC（keeper 店主 / customer 顾客 / walker 通道行人）压缩在恰好 6 个 InstancedMesh 内：
 *   1. shadowMesh   (48)  - 贴地接触阴影
 *   2. headHairMesh (48)  - 头部+脖颈+发冠（顶点色分层，独立转头/点头）
 *   3. torsoMesh    (48)  - 躯干+衣摆/围裙层次（实例色换装）
 *   4. armsMesh     (96)  - 左右双臂合批（2*i 左臂 / 2*i+1 右臂，支持 idle/tidy/browse/phone/chat/walk 全姿态）
 *   5. legsMesh     (96)  - 左右双腿+深色鞋合批（2*i 左腿 / 2*i+1 右腿）
 *   6. propsMesh    (48)  - 购物袋/货品包裹
 * 注：遵循 contract.ts walkTo 朝向约定（正面朝 (-sin yaw, -cos yaw)），因此网格局部 +Z 旋转角为 yaw + Math.PI。
 */
export class ShizijieNpcRigPool {
  readonly group = new THREE.Group()
  readonly capacity: number
  readonly drawCallBudget = MAX_SHIZIJIE_CROWD_DRAW_CALLS

  private readonly geometries: THREE.BufferGeometry[] = []
  private readonly materials: THREE.Material[] = []
  private readonly instancedMeshes: THREE.InstancedMesh[] = []

  private readonly shadowMesh: THREE.InstancedMesh
  private readonly headHairMesh: THREE.InstancedMesh
  private readonly torsoMesh: THREE.InstancedMesh
  private readonly armsMesh: THREE.InstancedMesh
  private readonly legsMesh: THREE.InstancedMesh
  private readonly propsMesh: THREE.InstancedMesh

  private readonly trisPerShadow: number
  private readonly trisPerHead: number
  private readonly trisPerTorso: number
  private readonly trisPerArm: number
  private readonly trisPerLeg: number
  private readonly trisPerProp: number

  private readonly mRoot = new THREE.Matrix4()
  private readonly mPart = new THREE.Matrix4()
  private readonly mLocal = new THREE.Matrix4()
  private readonly mArmR = new THREE.Matrix4()
  private readonly qRot = new THREE.Quaternion()
  private readonly eul = new THREE.Euler(0, 0, 0, 'YXZ')
  private readonly vPos = new THREE.Vector3()
  private readonly vScale = new THREE.Vector3(1, 1, 1)
  private readonly cTmp = new THREE.Color()

  private activeCount = 0
  private activePropCount = 0
  private disposed = false

  constructor(capacity: number = MAX_SHIZIJIE_CROWD_NPCS) {
    this.capacity = Math.max(1, Math.min(MAX_SHIZIJIE_CROWD_NPCS, Math.floor(capacity)))
    this.group.name = 'shizijie-b1-crowd-pool'

    const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
      this.geometries.push(g)
      return g
    }
    const trackMat = <T extends THREE.Material>(m: T): T => {
      this.materials.push(m)
      return m
    }

    const vertexColorMat = trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        vertexColors: true,
        roughness: 0.84,
        metalness: 0.03,
        flatShading: true,
      }),
    )

    const shadowMat = trackMat(
      new THREE.MeshBasicMaterial({
        color: 0x0b0f14,
        transparent: true,
        opacity: 0.36,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    )

    const makeInst = (
      name: string,
      geo: THREE.BufferGeometry,
      mat: THREE.Material,
      cap: number,
    ): THREE.InstancedMesh => {
      const m = new THREE.InstancedMesh(trackGeo(geo), mat, cap)
      m.name = name
      m.frustumCulled = false
      m.count = 0
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      this.instancedMeshes.push(m)
      this.group.add(m)
      return m
    }

    const shadowGeo = new THREE.CircleGeometry(0.33, 10)
    shadowGeo.rotateX(-Math.PI / 2)
    this.trisPerShadow = countGeoTriangles(shadowGeo)
    this.shadowMesh = makeInst('szj-crowd-shadow', shadowGeo, shadowMat, this.capacity)
    this.shadowMesh.renderOrder = 2

    const headGeo = buildHeadHairGeometry()
    this.trisPerHead = countGeoTriangles(headGeo)
    this.headHairMesh = makeInst('szj-crowd-head', headGeo, vertexColorMat, this.capacity)

    const torsoGeo = buildTorsoGeometry()
    this.trisPerTorso = countGeoTriangles(torsoGeo)
    this.torsoMesh = makeInst('szj-crowd-torso', torsoGeo, vertexColorMat, this.capacity)

    const armGeo = buildArmGeometry()
    this.trisPerArm = countGeoTriangles(armGeo)
    this.armsMesh = makeInst('szj-crowd-arms', armGeo, vertexColorMat, this.capacity * 2)

    const legGeo = buildLegShoeGeometry()
    this.trisPerLeg = countGeoTriangles(legGeo)
    this.legsMesh = makeInst('szj-crowd-legs', legGeo, vertexColorMat, this.capacity * 2)

    const propGeo = buildShoppingPropGeometry()
    this.trisPerProp = countGeoTriangles(propGeo)
    this.propsMesh = makeInst('szj-crowd-props', propGeo, vertexColorMat, this.capacity)
  }

  applyInitialColors(agents: readonly SzjAgentState[]): void {
    if (this.disposed) return
    const n = Math.min(this.capacity, agents.length)
    let propSlot = 0
    for (let i = 0; i < n; i++) {
      const a = agents[i]!
      this.headHairMesh.setColorAt(i, this.cTmp.set(a.skinTint))
      this.torsoMesh.setColorAt(i, this.cTmp.set(a.shirtColor))
      this.armsMesh.setColorAt(i * 2, this.cTmp.set(a.shirtColor))
      this.armsMesh.setColorAt(i * 2 + 1, this.cTmp.set(a.shirtColor))
      this.legsMesh.setColorAt(i * 2, this.cTmp.set(a.pantsColor))
      this.legsMesh.setColorAt(i * 2 + 1, this.cTmp.set(a.pantsColor))
      if (a.hasProp) {
        this.propsMesh.setColorAt(propSlot++, this.cTmp.set(a.propColor))
      }
    }
    for (let i = 0; i < this.instancedMeshes.length; i++) {
      const m = this.instancedMeshes[i]!
      if (m.instanceColor) m.instanceColor.needsUpdate = true
    }
  }

  private setLocalMatrix(
    mesh: THREE.InstancedMesh,
    slot: number,
    lx: number,
    ly: number,
    lz: number,
    rx: number,
    ry: number,
    rz: number,
    sx = 1,
    sy = 1,
    sz = 1,
  ): void {
    this.eul.set(rx, ry, rz)
    this.qRot.setFromEuler(this.eul)
    this.vPos.set(lx, ly, lz)
    this.vScale.set(sx, sy, sz)
    this.mLocal.compose(this.vPos, this.qRot, this.vScale)
    this.mPart.multiplyMatrices(this.mRoot, this.mLocal)
    mesh.setMatrixAt(slot, this.mPart)
  }

  update(agents: readonly SzjAgentState[]): void {
    if (this.disposed) return
    const n = Math.min(this.capacity, agents.length)
    this.activeCount = n
    let propCount = 0

    for (let i = 0; i < n; i++) {
      const a = agents[i]!
      const walking = a.speed > 0.08
      const stride = walking ? Math.sin(a.walkPhase) : 0
      const bounce = walking ? Math.abs(Math.cos(a.walkPhase)) * 0.032 : Math.sin(a.actionPhase * 1.4) * 0.008
      const hs = a.heightScale
      const ws = a.widthScale
      // walkTo yaw 正面为 (-sin yaw, -cos yaw)，网格 +Z 正面需旋转 yaw + PI
      const meshYaw = a.yaw + Math.PI

      this.eul.set(0, meshYaw, 0)
      this.qRot.setFromEuler(this.eul)
      this.vPos.set(a.x, a.y + 0.015, a.z)
      this.vScale.set(ws, 1, ws)
      this.mPart.compose(this.vPos, this.qRot, this.vScale)
      this.shadowMesh.setMatrixAt(i, this.mPart)

      this.vPos.set(a.x, a.y + bounce, a.z)
      this.vScale.set(ws, hs, ws)
      this.mRoot.compose(this.vPos, this.qRot, this.vScale)

      let torsoPitch = 0
      let torsoYaw = 0
      let headYaw = 0
      let headPitch = 0
      let armLX = 0
      let armRX = 0
      let armLZ = 0.06
      let armRZ = -0.06

      if (walking) {
        const swing = stride * 0.56
        armLX = swing
        armRX = a.hasProp ? -0.22 + swing * 0.18 : -swing
        torsoYaw = stride * 0.05
        headYaw = Math.sin(a.actionPhase * 0.7) * 0.14
      } else if (a.pose === 'tidy') {
        const reach = Math.sin(a.actionPhase * 2.4)
        torsoPitch = 0.12 + reach * 0.04
        headPitch = 0.14
        headYaw = Math.sin(a.actionPhase * 1.1) * 0.28
        armLX = -0.82 - reach * 0.26
        armRX = -0.78 + reach * 0.24
        armLZ = -0.12
        armRZ = 0.12
      } else if (a.pose === 'phone') {
        torsoPitch = 0.06
        headPitch = 0.26 + Math.sin(a.actionPhase * 0.8) * 0.04
        headYaw = Math.sin(a.actionPhase * 0.45) * 0.12
        armLX = -0.78
        armLZ = -0.22
        armRX = a.hasProp ? -0.22 : -0.58 + Math.sin(a.actionPhase * 2.1) * 0.08
        armRZ = a.hasProp ? -0.06 : 0.18
      } else if (a.pose === 'chat') {
        const gest = Math.sin(a.actionPhase * 2.2)
        headYaw = Math.sin(a.actionPhase * 1.15) * 0.32
        headPitch = Math.sin(a.actionPhase * 1.8) * 0.09
        armLX = -0.42 + gest * 0.24
        armRX = a.hasProp ? -0.22 : -0.34 - gest * 0.18
        armLZ = -0.08
        armRZ = 0.08
      } else if (a.pose === 'browse') {
        const inspect = Math.sin(a.actionPhase * 1.6)
        torsoPitch = 0.06
        headYaw = Math.sin(a.actionPhase * 0.85) * 0.44
        headPitch = 0.05 + inspect * 0.05
        armLX = -0.44 - inspect * 0.18
        armRX = a.hasProp ? -0.24 : -0.14 + inspect * 0.08
      } else {
        headYaw = Math.sin(a.actionPhase * 0.7) * 0.34
        armLX = -0.10 + Math.sin(a.actionPhase * 1.1) * 0.05
        armRX = -0.10 - Math.sin(a.actionPhase * 1.1) * 0.05
      }

      const legLX = walking ? -stride * 0.52 : 0
      const legRX = walking ? stride * 0.52 : 0

      this.setLocalMatrix(this.torsoMesh, i, 0, 0.94, 0, torsoPitch, torsoYaw, 0)
      this.setLocalMatrix(this.headHairMesh, i, 0, 1.36, torsoPitch * 0.18, headPitch, headYaw, 0)

      this.setLocalMatrix(this.armsMesh, i * 2, -0.255, 1.17, 0, armLX, 0, armLZ)
      this.setLocalMatrix(this.armsMesh, i * 2 + 1, 0.255, 1.17, 0, armRX, 0, armRZ)
      if (a.hasProp) {
        this.mArmR.copy(this.mPart)
      }

      this.setLocalMatrix(this.legsMesh, i * 2, -0.095, 0.66, 0, legLX, 0, 0)
      this.setLocalMatrix(this.legsMesh, i * 2 + 1, 0.095, 0.66, 0, legRX, 0, 0)

      if (a.hasProp) {
        this.eul.set(0, 0, 0)
        this.qRot.setFromEuler(this.eul)
        this.vPos.set(0, -0.43, 0.03)
        this.vScale.set(1, 1, 1)
        this.mLocal.compose(this.vPos, this.qRot, this.vScale)
        this.mPart.multiplyMatrices(this.mArmR, this.mLocal)
        this.propsMesh.setMatrixAt(propCount++, this.mPart)
      }
    }

    this.activePropCount = propCount
    this.shadowMesh.count = n
    this.headHairMesh.count = n
    this.torsoMesh.count = n
    this.armsMesh.count = n * 2
    this.legsMesh.count = n * 2
    this.propsMesh.count = propCount

    for (let i = 0; i < this.instancedMeshes.length; i++) {
      this.instancedMeshes[i]!.instanceMatrix.needsUpdate = true
    }
  }

  getDrawCallCount(): number {
    if (this.disposed || !this.group.visible) return 0
    let draws = 0
    for (let i = 0; i < this.instancedMeshes.length; i++) {
      const m = this.instancedMeshes[i]!
      if (m.visible && m.count > 0) draws++
    }
    return draws
  }

  getTriangleCount(): number {
    if (this.disposed || !this.group.visible) return 0
    const n = this.activeCount
    return (
      n * (this.trisPerShadow + this.trisPerHead + this.trisPerTorso) +
      n * 2 * (this.trisPerArm + this.trisPerLeg) +
      this.activePropCount * this.trisPerProp
    )
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (let i = 0; i < this.instancedMeshes.length; i++) {
      const m = this.instancedMeshes[i]!
      m.count = 0
      m.dispose()
    }
    this.instancedMeshes.length = 0
    for (let i = 0; i < this.geometries.length; i++) {
      this.geometries[i]!.dispose()
    }
    this.geometries.length = 0
    for (let i = 0; i < this.materials.length; i++) {
      this.materials[i]!.dispose()
    }
    this.materials.length = 0
    this.group.clear()
  }
}
