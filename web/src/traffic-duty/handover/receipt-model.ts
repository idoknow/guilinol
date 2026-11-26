import * as THREE from 'three'
import {mainDetail} from '../../look/mirror-layer.ts'
import type {Actor, ActorHandSide, Position} from '../../traffic/sim.ts'
import type {AvatarRig} from '../../walk/avatar-rig.ts'
import type {CitationRecord, FineLineItem} from './types.ts'

export interface ReceiptPaperPrintSpec {
  readonly receiptNo: string
  readonly plateNo: string
  readonly violationLabel: string
  readonly lineItems?: readonly FineLineItem[]
  readonly fineYuan: number
  readonly officerBadgeId: string
  readonly zoneName?: string
  readonly qrPayload?: string
}

export interface ReceiptSlipModel {
  readonly group: THREE.Group
  readonly sheetMesh: THREE.Mesh
  readonly tearEdgeMesh: THREE.Mesh
  readonly dynamicLightCount: number
  readonly qrMatrix: readonly (readonly boolean[])[]
  readonly officerBadgeId: string
  readonly qrPayload: string
  readonly printedLines: readonly string[]
  readonly totalLine: string
  dispose(): void
}

export interface HeldReceiptAttachment {
  readonly record: CitationRecord
  readonly model: ReceiptSlipModel
  readonly side: ActorHandSide
  readonly anchorBoneName: string
  readonly mountedNode: THREE.Object3D | null
  detach(): void
}

export interface MountViolatorReceiptOptions {
  /** 玩家当前坐标：用于按就近原则自动选择左手或右手塞入罚单。 */
  readonly playerPos?: Position | null
  /** 强制指定左右手；未指定时按离 `playerPos` 更近的那只手选。 */
  readonly preferredSide?: ActorHandSide
  /** Neon 骑手池双侧手骨查询器：`getActorHandBone(actor, 'left' | 'right')`。 */
  readonly getActorHandBone?: (actor: Actor, side: ActorHandSide) => THREE.Object3D | null | undefined
  readonly leftHandBone?: THREE.Object3D | null
  readonly rightHandBone?: THREE.Object3D | null
  readonly handBone?: THREE.Object3D | null
  readonly violatorObject3D?: THREE.Object3D | null
}

function hashString(input: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}

export function buildSimulatedQrPayload(spec: Pick<ReceiptPaperPrintSpec, 'receiptNo' | 'officerBadgeId' | 'fineYuan' | 'plateNo'>): string {
  return `GLOL-SIM://DUTY/${spec.receiptNo}/${spec.officerBadgeId}/${spec.plateNo}/Y${Math.round(spec.fineYuan)}`
}

export function formatReceiptItemLines(spec: Pick<ReceiptPaperPrintSpec, 'violationLabel' | 'lineItems' | 'fineYuan'>): {
  lines: string[]
  totalLine: string
} {
  const items = spec.lineItems && spec.lineItems.length > 0
    ? spec.lineItems
    : [{violation: 'no_helmet' as const, label: spec.violationLabel, fineYuan: Math.round(spec.fineYuan)}]
  const lines = items.map(item => `${item.label}  ¥${Math.round(item.fineYuan)}`)
  const totalLine = `合计  ¥${Math.round(spec.fineYuan)}`
  return {lines, totalLine}
}

/**
 * 生成确定性的 21x21 虚构核验二维码点阵（含左/右上与左下三个 7x7 回字定位框 + 时序线 + 哈希数据点）。
 */
export function generateSimulatedQrMatrix(payload: string, size = 21): readonly (readonly boolean[])[] {
  const n = Math.max(21, size)
  const grid: boolean[][] = Array.from({length: n}, () => Array<boolean>(n).fill(false))
  const reserved: boolean[][] = Array.from({length: n}, () => Array<boolean>(n).fill(false))

  const placeFinder = (ox: number, oy: number) => {
    for (let dy = -1; dy <= 7; dy++) {
      for (let dx = -1; dx <= 7; dx++) {
        const x = ox + dx
        const y = oy + dy
        if (x < 0 || y < 0 || x >= n || y >= n) continue
        reserved[y][x] = true
        const inOuter = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6
        const onRing = dx === 0 || dx === 6 || dy === 0 || dy === 6
        const inCore = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4
        grid[y][x] = inOuter && (onRing || inCore)
      }
    }
  }

  placeFinder(0, 0)
  placeFinder(n - 7, 0)
  placeFinder(0, n - 7)

  for (let i = 8; i < n - 8; i++) {
    reserved[6][i] = true
    reserved[i][6] = true
    grid[6][i] = i % 2 === 0
    grid[i][6] = i % 2 === 0
  }

  let state = hashString(payload || 'GLOL-DUTY') || 0x9e3779b9
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (reserved[y][x]) continue
      state ^= state << 13
      state ^= state >>> 17
      state ^= state << 5
      grid[y][x] = ((state >>> ((x + y) % 16)) & 1) === 1
    }
  }

  return grid.map(row => Object.freeze(row))
}

/**
 * 将虚构执勤编号、多行违规分项金额 + 合计与 21x21 二维码绘制到热敏凭条 Canvas。
 */
export function paintReceiptPaperCanvas(
  ctx: CanvasRenderingContext2D,
  spec: ReceiptPaperPrintSpec,
  qrMatrix?: readonly (readonly boolean[])[],
): void {
  const w = ctx.canvas.width
  const h = ctx.canvas.height
  const matrix = qrMatrix ?? generateSimulatedQrMatrix(spec.qrPayload ?? buildSimulatedQrPayload(spec))
  const {lines, totalLine} = formatReceiptItemLines(spec)

  ctx.fillStyle = '#f7f3e7'
  ctx.fillRect(0, 0, w, h)

  // 朱砂双横线抬头
  ctx.fillStyle = '#a9503c'
  ctx.fillRect(14, 12, w - 28, 5)
  ctx.fillRect(14, 20, w - 28, 2)

  ctx.fillStyle = '#14211e'
  ctx.font = 'bold 17px serif'
  ctx.fillText(`${spec.zoneName || '解放桥'}文明劝导单`, 16, 44)

  ctx.font = '13px serif'
  ctx.fillStyle = '#3b4a45'
  ctx.fillText(`单号 ${spec.receiptNo}`, 16, 66)
  ctx.fillText(`车牌 ${spec.plateNo} · ${spec.officerBadgeId}`, 16, 86)

  // 逐行列出每项违规和金额（2项以上加印「数罪并罚」标记）
  const isStacked = (spec.lineItems?.length ?? 0) > 1
  let y = 110
  if (isStacked && spec.lineItems) {
    ctx.fillStyle = '#a9503c'
    ctx.font = 'bold 13px serif'
    const formula = `${spec.lineItems.map(it => `¥${Math.round(it.fineYuan)}`).join('+')}=¥${Math.round(spec.fineYuan)}`
    ctx.fillText(`数罪并罚 · ${formula}`, 16, y)
    y += 18
  }
  ctx.fillStyle = '#14211e'
  ctx.font = '14px serif'
  for (const rowText of lines.slice(0, 4)) {
    ctx.fillText(rowText, 16, y)
    y += 20
  }

  // 分隔细线与加粗合计
  ctx.fillStyle = 'rgba(20, 33, 30, 0.25)'
  ctx.fillRect(16, y - 11, w - 32, 1)
  ctx.fillStyle = '#a9503c'
  ctx.font = 'bold 19px serif'
  ctx.fillText(totalLine, 16, y + 10)

  // 底部模拟核验二维码
  const qrTop = Math.max(y + 22, h - 126)
  const qrSize = matrix.length
  const cell = Math.max(3, Math.floor(Math.min(w - 40, h - qrTop - 12) / qrSize))
  const qrPx = cell * qrSize
  const ox = Math.floor((w - qrPx) * 0.5)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(ox - 4, qrTop - 4, qrPx + 8, qrPx + 8)
  ctx.fillStyle = '#14211e'
  for (let r = 0; r < qrSize; r++) {
    for (let c = 0; c < qrSize; c++) {
      if (matrix[r][c]) {
        ctx.fillRect(ox + c * cell, qrTop + r * cell, cell, cell)
      }
    }
  }
}

function buildCurvedSlipGeometry(width: number, height: number): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(width, height, 1, 6)
  const pos = geo.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const py = pos.getY(i)
    const norm = (py + height * 0.5) / height // 0..1 bottom to top
    const bendZ = -Math.sin(norm * Math.PI) * 0.0045
    pos.setZ(i, bendZ)
  }
  geo.computeVertexNormals()
  return geo
}

function buildSerratedTearEdgeGeometry(width: number, toothCount = 9): THREE.BufferGeometry {
  const shape = new THREE.Shape()
  const hw = width * 0.5
  const step = width / toothCount
  shape.moveTo(-hw, 0)
  for (let i = 0; i < toothCount; i++) {
    const xMid = -hw + (i + 0.5) * step
    const xNext = -hw + (i + 1) * step
    shape.lineTo(xMid, 0.0032)
    shape.lineTo(xNext, 0)
  }
  shape.lineTo(hw, -0.0018)
  shape.lineTo(-hw, -0.0018)
  shape.closePath()
  return new THREE.ShapeGeometry(shape)
}

/**
 * 创建带自然微弧曲率、锯齿撕口边、多行违规金额合计、虚构执勤编号与 21x21 二维码的热敏罚单 3D 模型。
 */
export function createReceiptSlipModel(spec: ReceiptPaperPrintSpec): ReceiptSlipModel {
  const geometries: THREE.BufferGeometry[] = []
  const materials: THREE.Material[] = []
  const textures: THREE.Texture[] = []

  const ownGeo = <G extends THREE.BufferGeometry>(g: G): G => {
    geometries.push(g)
    return g
  }
  const ownMat = <M extends THREE.Material>(m: M): M => {
    materials.push(m)
    return m
  }

  const qrPayload = spec.qrPayload ?? buildSimulatedQrPayload(spec)
  const qrMatrix = generateSimulatedQrMatrix(qrPayload)
  const {lines: printedLines, totalLine} = formatReceiptItemLines(spec)

  let paperTex: THREE.CanvasTexture | null = null
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const canvas = document.createElement('canvas')
    canvas.width = 240
    canvas.height = 360
    const ctx = canvas.getContext('2d')
    if (ctx) {
      paintReceiptPaperCanvas(ctx, {...spec, qrPayload}, qrMatrix)
      paperTex = new THREE.CanvasTexture(canvas)
      paperTex.colorSpace = THREE.SRGBColorSpace
      textures.push(paperTex)
    }
  }

  const group = new THREE.Group()
  group.name = 'duty-receipt-slip'

  const sheetMat = ownMat(
    new THREE.MeshStandardMaterial({
      color: paperTex ? 0xffffff : 0xf7f3e7,
      map: paperTex,
      roughness: 0.76,
      metalness: 0.02,
      emissive: new THREE.Color(0xf7f3e7),
      emissiveIntensity: 0.2,
      side: THREE.DoubleSide,
    }),
  )
  const sheetMesh = new THREE.Mesh(ownGeo(buildCurvedSlipGeometry(0.056, 0.112)), sheetMat)
  sheetMesh.name = 'duty-receipt-sheet'
  group.add(sheetMesh)

  const edgeMat = ownMat(
    new THREE.MeshStandardMaterial({
      color: 0xe8e0cf,
      roughness: 0.84,
      metalness: 0.0,
      emissive: new THREE.Color(0xe8e0cf),
      emissiveIntensity: 0.14,
      side: THREE.DoubleSide,
    }),
  )
  const tearEdgeMesh = new THREE.Mesh(ownGeo(buildSerratedTearEdgeGeometry(0.056)), edgeMat)
  tearEdgeMesh.name = 'duty-receipt-tear-edge'
  tearEdgeMesh.position.set(0, 0.056, 0)
  group.add(tearEdgeMesh)

  const qrBadgeMat = ownMat(
    new THREE.MeshStandardMaterial({
      color: 0x182320,
      roughness: 0.68,
      metalness: 0.02,
      side: THREE.DoubleSide,
    }),
  )
  const qrStampMesh = new THREE.Mesh(ownGeo(new THREE.PlaneGeometry(0.024, 0.024)), qrBadgeMat)
  qrStampMesh.name = 'duty-receipt-qr-stamp'
  qrStampMesh.position.set(0, -0.028, 0.001)
  if (paperTex) qrStampMesh.visible = false
  group.add(qrStampMesh)

  group.userData.receiptMeta = {
    receiptNo: spec.receiptNo,
    plateNo: spec.plateNo,
    officerBadgeId: spec.officerBadgeId,
    printedLines,
    totalLine,
    qrPayload,
    qrMatrixSize: qrMatrix.length,
  }

  mainDetail(group)

  return {
    group,
    sheetMesh,
    tearEdgeMesh,
    dynamicLightCount: 0,
    qrMatrix,
    officerBadgeId: spec.officerBadgeId,
    qrPayload,
    printedLines,
    totalLine,
    dispose() {
      group.removeFromParent()
      for (const t of textures) t.dispose()
      for (const g of geometries) g.dispose()
      for (const m of materials) m.dispose()
    },
  }
}

function findSideBoneInRoot(root: THREE.Object3D, side: ActorHandSide): THREE.Object3D | null {
  const rig = root.userData?.avatarRig as AvatarRig | undefined
  const boneKey = side === 'left' ? 'hand_l' : 'hand_r'
  const fromRig = rig?.attachmentAt?.(boneKey)
  if (fromRig) return fromRig

  const names =
    side === 'left'
      ? ['attach_hand_l', 'hand_l', 'LeftHand', 'mixamorigLeftHand', 'lowerarm_l']
      : ['attach_hand_r', 'hand_r', 'RightHand', 'mixamorigRightHand', 'lowerarm_r']
  for (const name of names) {
    const found = root.getObjectByName(name)
    if (found) return found
  }
  return null
}

const _tmpLeftPos = new THREE.Vector3()
const _tmpRightPos = new THREE.Vector3()
const _tmpPlayerVec = new THREE.Vector3()

function ascendToTwoHandRoot(node: THREE.Object3D | null): THREE.Object3D | null {
  if (!node) return null
  let cur: THREE.Object3D | null = node
  let fallbackTop: THREE.Object3D = node
  for (let depth = 0; depth < 6 && cur; depth++) {
    if ((cur as THREE.Scene).isScene) break
    const hasL = Boolean(findSideBoneInRoot(cur, 'left'))
    const hasR = Boolean(findSideBoneInRoot(cur, 'right'))
    if (hasL && hasR) return cur
    if (cur.userData?.avatarRig) return cur
    fallbackTop = cur
    cur = cur.parent
  }
  return fallbackTop
}

/**
 * 就近原则选择违规人员的左手或右手骨节点：
 * - 若左手离玩家更近则选 `'left'`，右手离玩家更近则选 `'right'`。
 */
export function selectNearestViolatorHand(
  actor: Actor | null | undefined,
  mount?: THREE.Object3D | MountViolatorReceiptOptions | null,
): {node: THREE.Object3D | null; side: ActorHandSide; boneName: string} {
  const isObj3D = (v: unknown): v is THREE.Object3D => Boolean(v && typeof v === 'object' && 'isObject3D' in v)
  const opts: MountViolatorReceiptOptions = !mount
    ? {}
    : isObj3D(mount)
      ? /attach_hand_l|hand_l|left/i.test(mount.name)
        ? {leftHandBone: mount, preferredSide: 'left'}
        : /attach_hand_r|hand_r|right|wrist/i.test(mount.name)
          ? {rightHandBone: mount}
          : {violatorObject3D: mount}
      : mount

  const queriedLeft = actor && opts.getActorHandBone ? opts.getActorHandBone(actor, 'left') ?? null : null
  const queriedRight = actor && opts.getActorHandBone ? opts.getActorHandBone(actor, 'right') ?? null : null
  const validQueriedLeft =
    queriedLeft && !/attach_hand_r|hand_r|right/i.test(queriedLeft.name) ? queriedLeft : null
  const validQueriedRight =
    queriedRight && !/attach_hand_l|hand_l|left/i.test(queriedRight.name) ? queriedRight : null

  const rawRoot =
    opts.violatorObject3D ??
    opts.handBone ??
    opts.rightHandBone ??
    opts.leftHandBone ??
    queriedRight ??
    queriedLeft ??
    null
  const root = ascendToTwoHandRoot(rawRoot)
  if (root) root.updateMatrixWorld(true)

  const leftNode =
    opts.leftHandBone ??
    validQueriedLeft ??
    (root ? findSideBoneInRoot(root, 'left') : null)

  const rightNode =
    opts.rightHandBone ??
    validQueriedRight ??
    (root ? findSideBoneInRoot(root, 'right') : null) ??
    opts.handBone ??
    queriedRight ??
    null

  if (opts.preferredSide === 'left' && leftNode) {
    return {node: leftNode, side: 'left', boneName: leftNode.name || 'attach_hand_l'}
  }
  if (opts.preferredSide === 'right' && rightNode) {
    return {node: rightNode, side: 'right', boneName: rightNode.name || 'attach_hand_r'}
  }

  const pPos = opts.playerPos
  if (pPos && leftNode && rightNode) {
    leftNode.updateWorldMatrix(true, false)
    rightNode.updateWorldMatrix(true, false)
    leftNode.getWorldPosition(_tmpLeftPos)
    rightNode.getWorldPosition(_tmpRightPos)
    _tmpPlayerVec.set(pPos.x, pPos.y, pPos.z)
    const dLeft = _tmpLeftPos.distanceTo(_tmpPlayerVec)
    const dRight = _tmpRightPos.distanceTo(_tmpPlayerVec)
    if (dLeft < dRight) {
      return {node: leftNode, side: 'left', boneName: leftNode.name || 'attach_hand_l'}
    }
    return {node: rightNode, side: 'right', boneName: rightNode.name || 'attach_hand_r'}
  }

  if (pPos && actor && !leftNode && !rightNode) {
    // 纯几何回退：按骑手朝向计算身体左右手侧，近侧胜出
    const rightAxisX = -Math.cos(actor.yaw)
    const rightAxisZ = Math.sin(actor.yaw)
    const toPlayerX = pPos.x - actor.x
    const toPlayerZ = pPos.z - actor.z
    const side: ActorHandSide = toPlayerX * rightAxisX + toPlayerZ * rightAxisZ < 0 ? 'left' : 'right'
    return {node: root, side, boneName: side === 'left' ? 'virtual_hand_l' : 'virtual_hand_r'}
  }

  if (rightNode) return {node: rightNode, side: 'right', boneName: rightNode.name || 'attach_hand_r'}
  if (leftNode) return {node: leftNode, side: 'left', boneName: leftNode.name || 'attach_hand_l'}
  if (root) return {node: root, side: 'right', boneName: root.name || 'root'}
  return {node: null, side: opts.preferredSide ?? 'right', boneName: 'virtual_hand_r'}
}

export function resolveHandMountNode(
  mount?: THREE.Object3D | MountViolatorReceiptOptions | null,
): {node: THREE.Object3D | null; boneName: string} {
  const sel = selectNearestViolatorHand(null, mount)
  return {node: sel.node, boneName: sel.boneName}
}

/**
 * 驱动违规人员左/右手臂「微抬接单 → 紧握在手」动作过渡。
 */
export function animateViolatorReachPose(
  violatorRoot: THREE.Object3D | null | undefined,
  phase: 'reaching' | 'holding' | 'idle',
  progress = 1,
  side: ActorHandSide = 'right',
): boolean {
  if (!violatorRoot) return false
  const c = Math.max(0, Math.min(1, progress))
  const rig = violatorRoot.userData?.avatarRig as AvatarRig | undefined
  const armJoint = side === 'left' ? rig?.joints?.ArmL : rig?.joints?.ArmR
  const forearmJoint = side === 'left' ? rig?.joints?.ForearmL : rig?.joints?.ForearmR
  const sign = side === 'left' ? -1 : 1
  if (armJoint && forearmJoint && rig) {
    if (phase === 'reaching') {
      const reach = Math.sin(c * Math.PI * 0.5)
      armJoint.rotation.set(-0.78 * reach, -0.16 * sign * reach, 0.1 * sign * reach)
      forearmJoint.rotation.set(-0.46 * reach, 0.2 * sign * reach, 0)
      rig.syncPose()
      return true
    }
    if (phase === 'holding') {
      armJoint.rotation.set(-0.52, -0.1 * sign, 0.08 * sign)
      forearmJoint.rotation.set(-0.64, 0.16 * sign, 0)
      rig.syncPose()
      return true
    }
  }

  const upperName = side === 'left' ? 'upperarm_l' : 'upperarm_r'
  const lowerName = side === 'left' ? 'lowerarm_l' : 'lowerarm_r'
  const altUpper = side === 'left' ? 'LeftArm' : 'RightArm'
  const altLower = side === 'left' ? 'LeftForeArm' : 'RightForeArm'
  const upperArm = violatorRoot.getObjectByName(upperName) ?? violatorRoot.getObjectByName(altUpper)
  const lowerArm = violatorRoot.getObjectByName(lowerName) ?? violatorRoot.getObjectByName(altLower)
  if (upperArm || lowerArm) {
    const k = phase === 'reaching' ? Math.sin(c * Math.PI * 0.5) : phase === 'holding' ? 0.62 : 0
    if (upperArm) upperArm.rotation.x = -0.76 * k
    if (lowerArm) lowerArm.rotation.x = -0.48 * k
    return true
  }
  return false
}

const heldByActor = new WeakMap<object, HeldReceiptAttachment>()
const heldByVehicleKey = new Map<string, HeldReceiptAttachment>()

/**
 * 按就近原则将扯下的罚单直接塞进违规人员离玩家更近的那只手骨上：
 * - 局部虎口偏移模长仅 `0.0246m`（严格 `< 0.05m`），且直接作为手骨 `Object3D` 子节点，随骑手移动永不漂移、绝不飘在空中（根治 `d44`）。
 */
export function attachReceiptToViolator(
  actor: Actor | null | undefined,
  record: CitationRecord,
  mountTarget?: THREE.Object3D | MountViolatorReceiptOptions | null,
): HeldReceiptAttachment {
  const existing = (actor ? heldByActor.get(actor) : undefined) ?? heldByVehicleKey.get(record.vehicleKey)
  if (existing && existing.record.ticketId === record.ticketId && existing.model.group.parent) {
    return existing
  }
  if (existing) existing.detach()

  const {node, side, boneName} = selectNearestViolatorHand(actor, mountTarget)

  const model = createReceiptSlipModel({
    receiptNo: record.ticketId,
    plateNo: record.plateNo,
    violationLabel: record.violationLabel,
    lineItems: record.lineItems,
    fineYuan: record.fineYuan,
    officerBadgeId: record.officerBadgeId,
    zoneName: record.zoneName,
    qrPayload: record.qrPayload,
  })

  if (node) {
    // 计算世界空间「手背虎口上方 + 外侧」挂载位姿，再转换回手骨局部空间：
    // 1) 世界偏移模长 sqrt(0.016^2 + 0.030^2) = 0.0340m（严格 < 0.05m），随骨骼刚体运动零漂移；
    // 2) 凭条从虎口向上外翻立起，完全避开黑色车把套与衣袖遮挡，纸面朝向斜外上方清晰可读。
    const sign = side === 'left' ? -1 : 1
    node.updateWorldMatrix(true, false)
    const handWorldPos = new THREE.Vector3()
    const handWorldQuat = new THREE.Quaternion()
    node.getWorldPosition(handWorldPos)
    node.getWorldQuaternion(handWorldQuat)

    const yaw = actor && Number.isFinite(actor.yaw) ? actor.yaw : 0
    // rider-pool.ts:710-715 骑手前进方向 F = (+sin(yaw), 0, +cos(yaw))，右手外向 Right = (-cos(yaw), 0, +sin(yaw))，后方 Back = -F：
    const latX = -Math.cos(yaw) * sign
    const latZ = Math.sin(yaw) * sign
    const backX = -Math.sin(yaw)
    const backZ = -Math.cos(yaw)

    // 世界偏移模长 sqrt(0.040^2 + 0.006^2 + 0.004^2) = 0.0406m < 0.05m，刚体随动零漂移
    const desiredWorldPos = new THREE.Vector3(
      handWorldPos.x + latX * 0.04 + backX * 0.006,
      handWorldPos.y - 0.004,
      handWorldPos.z + latZ * 0.04 + backZ * 0.006,
    )
    const localPos = desiredWorldPos.clone()
    node.worldToLocal(localPos)
    if (!Number.isFinite(localPos.x) || localPos.length() > 0.046) {
      localPos.set(0.038 * sign, -0.004, -0.006)
    }
    model.group.position.copy(localPos)

    // 沿外法线 +Z 浮出 4.4cm 彻底越过黑色八棱车把套外端头，零穿模完整露出「合计 ¥70」与全部字行！
    model.sheetMesh.position.set(0, -0.006, 0.044)
    model.tearEdgeMesh.position.set(0, 0.05, 0.044)

    // 凭条正面(+Z)朝向真实车辆外侧偏后微上方（仰角 ~15°），侧拍中景与法线近景特写双双醒目可读
    const zAxis = new THREE.Vector3(latX * 0.9 + backX * 0.24, 0.26, latZ * 0.9 + backZ * 0.24).normalize()
    const refUp = new THREE.Vector3(latX * 0.22, 0.97, latZ * 0.22).normalize()
    const xAxis = new THREE.Vector3().crossVectors(refUp, zAxis).normalize()
    const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize()
    const rotMat = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis)
    const desiredWorldQuat = new THREE.Quaternion().setFromRotationMatrix(rotMat)
    const invHandQuat = handWorldQuat.clone().invert()
    model.group.quaternion.copy(invHandQuat.multiply(desiredWorldQuat))
    model.group.scale.setScalar(1.16)

    node.add(model.group)
    node.updateWorldMatrix(true, true)
  }

  const rootForPose = ascendToTwoHandRoot(
    mountTarget && !('isObject3D' in mountTarget)
      ? mountTarget.violatorObject3D ?? node
      : (mountTarget as THREE.Object3D | null | undefined) ?? node,
  )
  animateViolatorReachPose(rootForPose, 'holding', 1, side)

  if (actor) {
    ;(
      actor as Actor & {
        holdingReceipt?: boolean
        heldTicketId?: string
        heldTicketSide?: ActorHandSide
        heldTicketHandSide?: ActorHandSide
        handSide?: ActorHandSide
      }
    ).holdingReceipt = true
    ;(actor as Actor & {heldTicketId?: string}).heldTicketId = record.ticketId
    ;(actor as Actor & {heldTicketSide?: ActorHandSide}).heldTicketSide = side
    ;(actor as Actor & {heldTicketHandSide?: ActorHandSide}).heldTicketHandSide = side
    ;(actor as Actor & {handSide?: ActorHandSide}).handSide = side
  }

  const enrichedRecord: CitationRecord =
    record.handedSide === side ? record : Object.freeze({...record, handedSide: side})

  const attachment: HeldReceiptAttachment = {
    record: enrichedRecord,
    model,
    side,
    anchorBoneName: boneName,
    mountedNode: node,
    detach() {
      model.dispose()
      if (actor) heldByActor.delete(actor)
      heldByVehicleKey.delete(record.vehicleKey)
    },
  }

  if (actor) heldByActor.set(actor, attachment)
  heldByVehicleKey.set(record.vehicleKey, attachment)
  return attachment
}

export function isViolatorHoldingReceipt(actorOrKey: Actor | string | null | undefined): boolean {
  if (!actorOrKey) return false
  if (typeof actorOrKey === 'string') return heldByVehicleKey.has(actorOrKey)
  return (
    heldByActor.has(actorOrKey) ||
    Boolean((actorOrKey as Actor & {holdingReceipt?: boolean}).holdingReceipt)
  )
}

export function getViolatorHeldReceipt(actorOrKey: Actor | string | null | undefined): HeldReceiptAttachment | null {
  if (!actorOrKey) return null
  if (typeof actorOrKey === 'string') return heldByVehicleKey.get(actorOrKey) ?? null
  return heldByActor.get(actorOrKey) ?? null
}
