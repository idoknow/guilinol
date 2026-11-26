import * as THREE from 'three'
import {mainDetail} from '../../look/mirror-layer.ts'
import {
  buildSimulatedQrPayload,
  formatReceiptItemLines,
  generateSimulatedQrMatrix,
  paintReceiptPaperCanvas,
} from '../handover/receipt-model.ts'
import type {FineLineItem, TypingProgressSnapshot} from '../handover/types.ts'
import type {FineTerminalSnapshot} from './types.ts'

export type FineTerminalModelUpdateInput = Pick<
  FineTerminalSnapshot,
  'phase' | 'violationLabel' | 'fineYuan' | 'plateNo' | 'receiptNo' | 'printProgress' | 'deliverProgress'
> & {
  readonly lineItems?: readonly FineLineItem[]
  readonly officerBadgeId?: string
  readonly zoneName?: string
  readonly qrPayload?: string
  readonly paperTornOff?: boolean
  readonly typing?: Partial<TypingProgressSnapshot>
}

export interface FineTerminalVisualModel {
  readonly group: THREE.Group
  readonly chassisMesh: THREE.Mesh
  readonly receiptMesh: THREE.Mesh
  readonly cutterMesh: THREE.Mesh
  readonly beltClipMesh: THREE.Mesh
  readonly holsterStrapMesh: THREE.Mesh
  readonly keyMeshes: readonly THREE.Mesh[]
  readonly dynamicLightCount: number
  getReceiptMeta(): {
    officerBadgeId: string
    qrPayload: string
    qrMatrix: readonly (readonly boolean[])[]
    printedLines: readonly string[]
    totalLine: string
    paperTornOff: boolean
  }
  update(snapshot: FineTerminalModelUpdateInput): void
  dispose(): void
}

const BODY_W = 0.084
const BODY_H = 0.172
const BODY_D = 0.028
const PAPER_MAX_EXTEND_M = 0.102

function makeRoundedShape(width: number, height: number, radius: number): THREE.Shape {
  const hw = width * 0.5
  const hh = height * 0.5
  const r = Math.min(radius, hw * 0.9, hh * 0.9)
  const s = new THREE.Shape()
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
  bevel = 0.0028,
): THREE.ExtrudeGeometry {
  const geo = new THREE.ExtrudeGeometry(
    makeRoundedShape(width - bevel * 2, height - bevel * 2, Math.max(0.002, radius - bevel)),
    {
      depth: Math.max(0.002, depth - bevel * 2),
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 3,
      curveSegments: 10,
    },
  )
  geo.center()
  return geo
}

function buildSerratedCutterGeometry(width: number, teeth = 13): THREE.BufferGeometry {
  const shape = new THREE.Shape()
  const hw = width * 0.5
  const step = width / teeth
  shape.moveTo(-hw, -0.0024)
  shape.lineTo(-hw, 0)
  for (let i = 0; i < teeth; i++) {
    shape.lineTo(-hw + (i + 0.5) * step, 0.0044)
    shape.lineTo(-hw + (i + 1) * step, 0)
  }
  shape.lineTo(hw, -0.0024)
  shape.closePath()
  const g = new THREE.ExtrudeGeometry(shape, {depth: 0.0026, bevelEnabled: false})
  g.center()
  return g
}

function paintLcdCanvas(
  ctx: CanvasRenderingContext2D,
  snap: FineTerminalModelUpdateInput,
): void {
  const w = ctx.canvas.width
  const h = ctx.canvas.height
  ctx.fillStyle = '#12221e'
  ctx.fillRect(0, 0, w, h)

  ctx.fillStyle = snap.phase === 'deliver' ? '#2c6b4f' : '#a9503c'
  ctx.fillRect(0, 0, w, 36)

  ctx.fillStyle = '#f4efe2'
  ctx.font = 'bold 17px serif'
  const header =
    snap.phase === 'input'
      ? '1 核对违法明细'
      : snap.phase === 'printing'
        ? `2 热敏吐纸 ${Math.round(snap.printProgress * 100)}%`
        : snap.phase === 'deliver'
          ? '3 扯下就近塞单'
          : snap.phase === 'done'
            ? '已塞入对方手中'
            : '终端待命'
  ctx.fillText(header, 14, 24)

  ctx.fillStyle = '#d4b47c'
  ctx.font = '13px serif'
  ctx.fillText(`${snap.plateNo || '--'} · ${snap.officerBadgeId || 'GL-JLQ-01'}`, 14, 56)

  const {lines, totalLine} = formatReceiptItemLines({
    violationLabel: snap.violationLabel,
    lineItems: snap.lineItems,
    fineYuan: snap.fineYuan,
  })

  ctx.fillStyle = '#f4efe2'
  ctx.font = '15px serif'
  let y = 84
  for (const row of lines.slice(0, 3)) {
    ctx.fillText(row, 14, y)
    y += 22
  }

  ctx.fillStyle = 'rgba(244, 239, 226, 0.22)'
  ctx.fillRect(14, 152, w - 28, 1)

  ctx.fillStyle = '#e7c17a'
  ctx.font = 'bold 24px serif'
  ctx.fillText(totalLine, 14, 180)

  ctx.fillStyle = '#203630'
  ctx.fillRect(14, 198, w - 28, 10)
  ctx.fillStyle = snap.phase === 'deliver' || snap.phase === 'done' ? '#6cb38a' : '#a9503c'
  const pct =
    snap.phase === 'input'
      ? snap.typing && snap.typing.totalChars
        ? Math.max(0.12, snap.typing.typedChars! / snap.typing.totalChars)
        : 0.12
      : snap.phase === 'printing'
        ? Math.max(0.08, Math.min(1, snap.printProgress))
        : 1
  ctx.fillRect(14, 198, Math.round((w - 28) * pct), 10)
}

/**
 * 重做工业级圆角便携热敏打印机 3D 模型（`MAIN_DETAIL_LAYER = 3`、0 动态光源）：
 * - 圆角倒角机身、双侧橡胶防滑护翼、弧形热敏顶仓、锯齿撕纸刀片、香槟金镶边背光屏、圆角硅胶按键、真皮半包皮套与黄铜扣带。
 * - 根治 `d44`：一旦凭条被扯下（`paperTornOff = true`），相机预览挂件与出纸口纸条立即收起隐藏，绝不在半空残留漂浮白纸！
 */
export function createFineTerminalModel(): FineTerminalVisualModel {
  const geometries: THREE.BufferGeometry[] = []
  const materials: THREE.Material[] = []
  const textures: THREE.Texture[] = []

  const ownGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    geometries.push(g)
    return g
  }
  const ownMat = <T extends THREE.Material>(m: T): T => {
    materials.push(m)
    return m
  }

  const root = new THREE.Group()
  root.name = 'traffic-fine-terminal'

  const holdPivot = new THREE.Group()
  holdPivot.name = 'fine-terminal-pivot'
  holdPivot.position.set(0, -0.025, -0.015)
  holdPivot.rotation.set(-0.32, -0.14, 0.05)
  root.add(holdPivot)

  // 1) 圆角青黛磨砂机身 + 防滑软胶侧翼与凸棱（高辨识度自发光补光，逆光不死黑）
  const shellMat = ownMat(
    new THREE.MeshStandardMaterial({
      color: 0x33554b,
      roughness: 0.34,
      metalness: 0.18,
      emissive: 0x27433b,
      emissiveIntensity: 0.52,
    }),
  )
  const chassis = new THREE.Mesh(ownGeo(makeRoundedExtrude(BODY_W, BODY_H, BODY_D, 0.017, 0.0038)), shellMat)
  chassis.name = 'fine-terminal-chassis'
  chassis.position.set(0, 0.045, 0)
  holdPivot.add(chassis)

  const gripMat = ownMat(
    new THREE.MeshStandardMaterial({
      color: 0x1b2b26,
      roughness: 0.76,
      metalness: 0.05,
      emissive: 0x15221e,
      emissiveIntensity: 0.34,
    }),
  )
  const gripRibMat = ownMat(
    new THREE.MeshStandardMaterial({
      color: 0x62877b,
      roughness: 0.45,
      metalness: 0.1,
      emissive: 0x4b6b60,
      emissiveIntensity: 0.45,
    }),
  )
  const gripGeo = ownGeo(makeRoundedExtrude(0.0095, 0.096, 0.023, 0.0038, 0.0015))
  const gripL = new THREE.Mesh(gripGeo, gripMat)
  gripL.name = 'fine-terminal-grip-left'
  gripL.position.set(-BODY_W * 0.5 - 0.0022, 0.036, 0)
  const gripR = new THREE.Mesh(gripGeo, gripMat)
  gripR.name = 'fine-terminal-grip-right'
  gripR.position.set(BODY_W * 0.5 + 0.0022, 0.036, 0)
  holdPivot.add(gripL, gripR)

  const ribGeo = ownGeo(new THREE.BoxGeometry(0.0032, 0.0042, 0.018))
  for (let r = 0; r < 4; r++) {
    const ry = 0.012 + r * 0.016
    const ribL = new THREE.Mesh(ribGeo, gripRibMat)
    ribL.position.set(-BODY_W * 0.5 - 0.0062, ry, 0.001)
    const ribR = new THREE.Mesh(ribGeo, gripRibMat)
    ribR.position.set(BODY_W * 0.5 + 0.0062, ry, 0.001)
    holdPivot.add(ribL, ribR)
  }

  // 2) 鞍棕真皮腰挂半包皮套背托 + 扣带 + 亮黄铜按扣
  const leatherMat = ownMat(
    new THREE.MeshStandardMaterial({
      color: 0x7c4e2b,
      roughness: 0.58,
      metalness: 0.06,
      emissive: 0x5e391e,
      emissiveIntensity: 0.5,
    }),
  )
  const beltClipMesh = new THREE.Mesh(
    ownGeo(makeRoundedExtrude(BODY_W + 0.01, 0.084, BODY_D + 0.011, 0.015, 0.0028)),
    leatherMat,
  )
  beltClipMesh.name = 'fine-terminal-belt-clip'
  beltClipMesh.position.set(0, -0.002, -0.002)
  holdPivot.add(beltClipMesh)

  const strapMat = ownMat(
    new THREE.MeshStandardMaterial({
      color: 0x9c653b,
      roughness: 0.5,
      metalness: 0.08,
      emissive: 0x784b29,
      emissiveIntensity: 0.52,
    }),
  )
  const holsterStrapMesh = new THREE.Mesh(
    ownGeo(makeRoundedExtrude(0.025, 0.046, BODY_D + 0.016, 0.0055, 0.0016)),
    strapMat,
  )
  holsterStrapMesh.name = 'fine-terminal-holster-strap'
  holsterStrapMesh.position.set(-0.024, 0.036, 0)
  holdPivot.add(holsterStrapMesh)

  const brassMat = ownMat(
    new THREE.MeshStandardMaterial({
      color: 0xf5c85c,
      roughness: 0.22,
      metalness: 0.26,
      emissive: 0xd9a132,
      emissiveIntensity: 0.58,
    }),
  )
  const brassSnap = new THREE.Mesh(ownGeo(new THREE.CylinderGeometry(0.0064, 0.0064, 0.004, 14)), brassMat)
  brassSnap.name = 'fine-terminal-brass-snap'
  brassSnap.rotation.x = Math.PI * 0.5
  brassSnap.position.set(-0.024, 0.027, BODY_D * 0.5 + 0.0085)
  holdPivot.add(brassSnap)

  // 3) 顶部圆弧热敏打印头仓盖 + 凹陷出纸口 + 外露亮银锯齿撕纸刀片 + 状态灯珠
  const hoodMat = ownMat(
    new THREE.MeshStandardMaterial({
      color: 0xc25942,
      roughness: 0.34,
      metalness: 0.14,
      emissive: 0x9e4430,
      emissiveIntensity: 0.44,
    }),
  )
  const printerHood = new THREE.Mesh(
    ownGeo(makeRoundedExtrude(BODY_W - 0.002, 0.032, BODY_D + 0.005, 0.011, 0.0026)),
    hoodMat,
  )
  printerHood.name = 'fine-terminal-printer-hood'
  printerHood.position.set(0, 0.045 + BODY_H * 0.5 - 0.004, 0.001)
  holdPivot.add(printerHood)

  const slotMat = ownMat(new THREE.MeshStandardMaterial({color: 0x090d0c, roughness: 0.9}))
  const slotMesh = new THREE.Mesh(ownGeo(new THREE.BoxGeometry(0.062, 0.0055, 0.012)), slotMat)
  slotMesh.name = 'fine-terminal-paper-slot'
  slotMesh.position.set(0, 0.045 + BODY_H * 0.5 + 0.012, 0.008)
  holdPivot.add(slotMesh)

  const cutterMat = ownMat(
    new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      roughness: 0.18,
      metalness: 0.26,
      emissive: 0xdbeafe,
      emissiveIntensity: 0.68,
    }),
  )
  const cutterMesh = new THREE.Mesh(ownGeo(buildSerratedCutterGeometry(0.06, 13)), cutterMat)
  cutterMesh.name = 'fine-terminal-serrated-cutter'
  cutterMesh.position.set(0, 0.045 + BODY_H * 0.5 + 0.0145, 0.0148)
  holdPivot.add(cutterMesh)

  const ledMat = ownMat(
    new THREE.MeshStandardMaterial({
      color: 0x52d68a,
      roughness: 0.2,
      metalness: 0.04,
      emissive: 0x34d399,
      emissiveIntensity: 0.85,
    }),
  )
  const ledMesh = new THREE.Mesh(ownGeo(new THREE.SphereGeometry(0.0035, 10, 8)), ledMat)
  ledMesh.name = 'fine-terminal-status-led'
  ledMesh.position.set(0.028, 0.045 + BODY_H * 0.5 - 0.002, BODY_D * 0.5 + 0.0042)
  holdPivot.add(ledMesh)

  // 4) 香槟金外框 + 前置自发光高清背光 LCD 屏幕（杜绝外框遮挡内屏）
  const bezelMat = ownMat(
    new THREE.MeshStandardMaterial({
      color: 0xdfc082,
      roughness: 0.28,
      metalness: 0.25,
      emissive: 0xb59454,
      emissiveIntensity: 0.45,
    }),
  )
  const bezelMesh = new THREE.Mesh(ownGeo(makeRoundedExtrude(0.073, 0.063, 0.0024, 0.007, 0.0008)), bezelMat)
  bezelMesh.name = 'fine-terminal-screen-bezel'
  bezelMesh.position.set(0, 0.045 + 0.036, BODY_D * 0.5 + 0.001)
  holdPivot.add(bezelMesh)

  let lcdCanvas: HTMLCanvasElement | null = null
  let lcdCtx: CanvasRenderingContext2D | null = null
  let lcdTexture: THREE.CanvasTexture | null = null
  let paperCanvas: HTMLCanvasElement | null = null
  let paperCtx: CanvasRenderingContext2D | null = null
  let paperTexture: THREE.CanvasTexture | null = null

  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    lcdCanvas = document.createElement('canvas')
    lcdCanvas.width = 320
    lcdCanvas.height = 224
    lcdCtx = lcdCanvas.getContext('2d')
    if (lcdCtx) {
      lcdTexture = new THREE.CanvasTexture(lcdCanvas)
      lcdTexture.colorSpace = THREE.SRGBColorSpace
      textures.push(lcdTexture)
    }

    paperCanvas = document.createElement('canvas')
    paperCanvas.width = 240
    paperCanvas.height = 360
    paperCtx = paperCanvas.getContext('2d')
    if (paperCtx) {
      paperTexture = new THREE.CanvasTexture(paperCanvas)
      paperTexture.colorSpace = THREE.SRGBColorSpace
      textures.push(paperTexture)
    }
  }

  const screenMat = ownMat(
    new THREE.MeshStandardMaterial({
      color: lcdTexture ? 0xffffff : 0x203c35,
      map: lcdTexture,
      emissive: lcdTexture ? 0xffffff : 0x265448,
      emissiveMap: lcdTexture,
      emissiveIntensity: 0.92,
      roughness: 0.18,
      metalness: 0.04,
    }),
  )
  const screenMesh = new THREE.Mesh(ownGeo(new THREE.PlaneGeometry(0.063, 0.053)), screenMat)
  screenMesh.name = 'fine-terminal-screen'
  screenMesh.position.set(0, 0.045 + 0.036, BODY_D * 0.5 + 0.0036)
  holdPivot.add(screenMesh)

  // 5) 圆角硅胶实体按键阵列
  const keyMat = ownMat(new THREE.MeshStandardMaterial({color: 0xdfd8ca, roughness: 0.46, emissive: 0xbab2a2, emissiveIntensity: 0.14}))
  const confirmKeyMat = ownMat(new THREE.MeshStandardMaterial({color: 0xb2523d, roughness: 0.38, emissive: 0x8f3e2d, emissiveIntensity: 0.26}))
  const keyGeo = ownGeo(makeRoundedExtrude(0.015, 0.0095, 0.0045, 0.003, 0.0008))
  const keyRestZ = BODY_D * 0.5 + 0.0022
  const keyMeshes: THREE.Mesh[] = []
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const k = new THREE.Mesh(keyGeo, keyMat)
      k.name = `fine-terminal-key-${row}-${col}`
      k.position.set((col - 1) * 0.02, 0.045 - 0.012 - row * 0.0135, keyRestZ)
      holdPivot.add(k)
      keyMeshes.push(k)
    }
  }
  const confirmBtn = new THREE.Mesh(ownGeo(makeRoundedExtrude(0.042, 0.013, 0.0052, 0.004, 0.001)), confirmKeyMat)
  confirmBtn.name = 'fine-terminal-confirm-btn'
  confirmBtn.position.set(0, 0.045 - 0.056, BODY_D * 0.5 + 0.0025)
  holdPivot.add(confirmBtn)

  // 6) 出纸口动态吐出的热敏凭条（扯下前在出纸口伸展；一旦扯下立即隐藏，杜绝 d44 悬空漂浮！）
  const paperMat = ownMat(
    new THREE.MeshStandardMaterial({
      color: paperTexture ? 0xffffff : 0xf7f3e7,
      map: paperTexture,
      roughness: 0.76,
      metalness: 0.0,
      emissive: 0xf7f3e7,
      emissiveIntensity: 0.18,
      side: THREE.DoubleSide,
    }),
  )
  const receiptGeo = ownGeo(new THREE.BoxGeometry(0.054, 1.0, 0.0013))
  const receiptMesh = new THREE.Mesh(receiptGeo, paperMat)
  receiptMesh.name = 'fine-terminal-receipt-paper'
  receiptMesh.visible = false
  holdPivot.add(receiptMesh)

  mainDetail(root)
  root.traverse(node => {
    if ('isMesh' in node && node.isMesh) {
      node.frustumCulled = false
    }
  })

  const slotTopY = 0.045 + BODY_H * 0.5 + 0.013
  let lastLcdKey = ''
  let lastPaperKey = ''
  let currentBadgeId = 'GL-JLQ-01'
  let currentQrPayload = buildSimulatedQrPayload({
    receiptNo: 'JLQ-0001',
    officerBadgeId: currentBadgeId,
    fineYuan: 50,
    plateNo: '桂C·电模1001',
  })
  let currentQrMatrix = generateSimulatedQrMatrix(currentQrPayload)
  let currentLines: string[] = []
  let currentTotalLine = '合计  ¥50'
  let currentTornOff = false

  return {
    group: root,
    chassisMesh: chassis,
    receiptMesh,
    cutterMesh,
    beltClipMesh,
    holsterStrapMesh,
    keyMeshes,
    dynamicLightCount: 0,
    getReceiptMeta() {
      return {
        officerBadgeId: currentBadgeId,
        qrPayload: currentQrPayload,
        qrMatrix: currentQrMatrix,
        printedLines: currentLines,
        totalLine: currentTotalLine,
        paperTornOff: currentTornOff,
      }
    },
    update(snap) {
      currentBadgeId = snap.officerBadgeId || 'GL-JLQ-01'
      currentTornOff = Boolean(snap.paperTornOff ?? (snap.phase === 'deliver' || snap.phase === 'done'))
      currentQrPayload =
        snap.qrPayload ||
        buildSimulatedQrPayload({
          receiptNo: snap.receiptNo || 'JLQ-0001',
          officerBadgeId: currentBadgeId,
          fineYuan: snap.fineYuan,
          plateNo: snap.plateNo || '--',
        })

      const formatted = formatReceiptItemLines({
        violationLabel: snap.violationLabel,
        lineItems: snap.lineItems,
        fineYuan: snap.fineYuan,
      })
      currentLines = formatted.lines
      currentTotalLine = formatted.totalLine

      const activeKey = snap.phase === 'input' ? snap.typing?.activeKeyIndex ?? null : null
      for (let i = 0; i < keyMeshes.length; i++) {
        keyMeshes[i].position.z = activeKey === i ? keyRestZ - 0.0022 : keyRestZ
      }
      confirmBtn.position.z =
        snap.phase === 'printing' && snap.printProgress < 0.15 ? keyRestZ - 0.002 : BODY_D * 0.5 + 0.0025

      const paperKey = `${snap.receiptNo}|${snap.plateNo}|${currentLines.join(';')}|${snap.fineYuan}|${currentBadgeId}|${currentQrPayload}`
      if (paperKey !== lastPaperKey) {
        lastPaperKey = paperKey
        currentQrMatrix = generateSimulatedQrMatrix(currentQrPayload)
        receiptMesh.userData.receiptMeta = {
          officerBadgeId: currentBadgeId,
          printedLines: currentLines,
          totalLine: currentTotalLine,
          qrPayload: currentQrPayload,
          qrMatrixSize: currentQrMatrix.length,
        }
        if (paperCtx && paperTexture) {
          paintReceiptPaperCanvas(
            paperCtx,
            {
              receiptNo: snap.receiptNo || 'JLQ-0001',
              plateNo: snap.plateNo || '--',
              violationLabel: snap.violationLabel,
              lineItems: snap.lineItems,
              fineYuan: snap.fineYuan,
              officerBadgeId: currentBadgeId,
              zoneName: snap.zoneName || '解放桥',
              qrPayload: currentQrPayload,
            },
            currentQrMatrix,
          )
          paperTexture.needsUpdate = true
        }
      }

      // 彻底根治 d44：凭条一旦扯下归回腰侧，相机/手部终端整体收起，出纸口绝不残留悬空纸片！
      const stowedAfterTear = currentTornOff && (snap.phase === 'deliver' || snap.phase === 'done')
      root.visible = !stowedAfterTear

      const printExt = snap.phase === 'printing' && !currentTornOff ? Math.max(0.02, Math.min(1, snap.printProgress)) : 0
      const paperLen = printExt * PAPER_MAX_EXTEND_M
      if (paperLen > 0.002 && !stowedAfterTear) {
        receiptMesh.visible = true
        receiptMesh.scale.set(1, paperLen, 1)
        receiptMesh.position.set(0, slotTopY + paperLen * 0.5, 0.0085 + printExt * 0.003)
        receiptMesh.rotation.set(-0.15 * printExt, 0, 0)
      } else {
        receiptMesh.visible = false
      }

      holdPivot.position.set(0, -0.025, -0.015)
      holdPivot.rotation.set(-0.32, -0.14, 0.05)

      if (lcdCtx && lcdTexture) {
        const typedCount = snap.typing?.typedChars ?? -1
        const key = `${snap.phase}|${snap.plateNo}|${currentLines.join(';')}|${snap.fineYuan}|${currentBadgeId}|${typedCount}|${Math.round(snap.printProgress * 20)}`
        if (key !== lastLcdKey) {
          lastLcdKey = key
          paintLcdCanvas(lcdCtx, snap)
          lcdTexture.needsUpdate = true
        }
      }
    },
    dispose() {
      root.removeFromParent()
      for (const t of textures) t.dispose()
      for (const g of geometries) g.dispose()
      for (const m of materials) m.dispose()
    },
  }
}
