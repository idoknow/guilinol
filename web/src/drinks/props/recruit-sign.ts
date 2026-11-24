import * as THREE from 'three'
import { disposeDrinkProp } from './builder.ts'

export interface RecruitStandeeSpec {
  readonly widthM: number
  readonly heightM: number
  readonly boardWidthM: number
  readonly boardHeightM: number
  readonly spreadDepthM: number
  readonly tiltRad: number
  readonly primaryRedHex: string
  readonly cardWhiteHex: string
  readonly frameDarkHex: string
  readonly goldAccentHex: string
}

export const DEFAULT_RECRUIT_STANDEE_SPEC: RecruitStandeeSpec = {
  widthM: 0.6,
  heightM: 1.24,
  boardWidthM: 0.52,
  boardHeightM: 0.96,
  spreadDepthM: 0.44,
  tiltRad: 0.145,
  primaryRedHex: '#e60012',
  cardWhiteHex: '#fffcf7',
  frameDarkHex: '#1f2329',
  goldAccentHex: '#f6c33e',
}

/** 门口左外侧默认锚点（位于外开玻璃门扇 z=4.04 前方人行道，完全避开 2.8m 正门中轴通道与玻璃门把手立杆） */
export const RECRUIT_STANDEE_LOCAL_ANCHOR = {
  x: -1.42,
  z: 4.38,
  yaw: 0.22,
} as const

export interface RecruitStandeeOptions {
  brandName?: string
  headline?: string
  rolesLine?: string
  salaryLine?: string
  actionHint?: string
  spec?: Partial<RecruitStandeeSpec>
}

export interface RecruitStandeeController {
  readonly group: THREE.Group
  readonly boardGroup: THREE.Group
  readonly spec: RecruitStandeeSpec
  setHighlighted(near: boolean, onDuty?: boolean): void
  getBounds(): { widthM: number; heightM: number; depthM: number; minY: number; maxY: number }
  getTriangles(): number
  dispose(): void
}

function drawCrownMascotBadge(ctx: CanvasRenderingContext2D, cx: number, cy: number, scale: number, goldHex: string): void {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.scale(scale, scale)

  // Red cape / scarf backdrop
  ctx.fillStyle = '#c8101e'
  ctx.beginPath()
  ctx.roundRect(-34, 18, 68, 28, 12)
  ctx.fill()

  // Round white head
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.arc(0, 6, 30, 0, Math.PI * 2)
  ctx.fill()
  ctx.lineWidth = 3
  ctx.strokeStyle = '#18181b'
  ctx.stroke()

  // 3-point white/gold crown
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.moveTo(-20, -18)
  ctx.lineTo(-22, -38)
  ctx.lineTo(-8, -28)
  ctx.lineTo(0, -44)
  ctx.lineTo(8, -28)
  ctx.lineTo(22, -38)
  ctx.lineTo(20, -18)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()

  ctx.fillStyle = goldHex
  ctx.fillRect(-18, -20, 36, 5)

  // Eyes + carrot nose
  ctx.fillStyle = '#1434a4'
  ctx.beginPath()
  ctx.arc(-10, 4, 4, 0, Math.PI * 2)
  ctx.arc(10, 4, 4, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = '#f59e0b'
  ctx.beginPath()
  ctx.moveTo(0, 8)
  ctx.lineTo(13, 12)
  ctx.lineTo(0, 15)
  ctx.closePath()
  ctx.fill()

  ctx.restore()
}

export function createRecruitSignTexture(options: RecruitStandeeOptions = {}): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 960
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const spec: RecruitStandeeSpec = { ...DEFAULT_RECRUIT_STANDEE_SPEC, ...(options.spec ?? {}) }
  const brandName = options.brandName ?? '蜜雪冰城'
  const headline = options.headline ?? '招聘'
  const rolesLine = options.rolesLine ?? '调饮师 · 收银员 · 全/兼职'
  const salaryLine = options.salaryLine ?? '¥4000–6000 · 带薪培训'
  const actionHint = options.actionHint ?? '靠近应聘 · 换装上岗'

  // Base bright red backdrop
  ctx.fillStyle = spec.primaryRedHex
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  // Crisp inner white border inset
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)'
  ctx.lineWidth = 6
  ctx.strokeRect(14, 14, canvas.width - 28, canvas.height - 28)

  // Top header crown crest + brand title
  drawCrownMascotBadge(ctx, canvas.width * 0.5, 118, 1.35, spec.goldAccentHex)

  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = 'bold 54px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif'
  ctx.fillText(brandName, canvas.width * 0.5, 224)

  ctx.fillStyle = 'rgba(255, 252, 247, 0.88)'
  ctx.font = '600 22px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif'
  ctx.fillText('加入我们 · 一起创造甜蜜', canvas.width * 0.5, 272)

  // Giant bold hero "招聘" badge with subtle crisp contrast
  ctx.fillStyle = spec.cardWhiteHex
  ctx.beginPath()
  ctx.roundRect(76, 304, canvas.width - 152, 112, 22)
  ctx.fill()

  ctx.fillStyle = spec.primaryRedHex
  ctx.font = '900 72px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif'
  ctx.fillText(headline, canvas.width * 0.5, 362)

  // Clean central white info card (matches 01/02/08 poster layout)
  ctx.fillStyle = spec.cardWhiteHex
  ctx.beginPath()
  ctx.roundRect(42, 444, canvas.width - 84, 344, 24)
  ctx.fill()

  const rows: readonly { tag: string; value: string }[] = [
    { tag: '岗位', value: rolesLine },
    { tag: '待遇', value: salaryLine },
    { tag: '福利', value: '免费工服 · 弹性排班 · 晋升快' },
  ]
  rows.forEach((row, idx) => {
    const ry = 496 + idx * 96
    // Red chevron pill tag
    ctx.fillStyle = spec.primaryRedHex
    ctx.beginPath()
    ctx.roundRect(68, ry - 22, 88, 44, 10)
    ctx.fill()

    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 26px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(row.tag, 112, ry + 1)

    ctx.fillStyle = '#18181b'
    ctx.font = 'bold 25px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif'
    ctx.textAlign = 'left'
    ctx.fillText(row.value, 174, ry + 1)

    if (idx < rows.length - 1) {
      ctx.strokeStyle = 'rgba(230, 0, 18, 0.22)'
      ctx.setLineDash([8, 6])
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(68, ry + 48)
      ctx.lineTo(canvas.width - 68, ry + 48)
      ctx.stroke()
      ctx.setLineDash([])
    }
  })

  // Bottom dark/gold pill CTA strip
  ctx.fillStyle = '#141416'
  ctx.beginPath()
  ctx.roundRect(56, 822, canvas.width - 112, 82, 41)
  ctx.fill()
  ctx.lineWidth = 3
  ctx.strokeStyle = spec.goldAccentHex
  ctx.stroke()

  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'center'
  ctx.font = 'bold 30px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif'
  ctx.fillText(actionHint, canvas.width * 0.5, 864)

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.generateMipmaps = false
  tex.needsUpdate = true
  return tex
}

/**
 * 构建门口双面 A 字金属招聘立牌（零外部贴图资产、零动态光源）：
 * 参考 `docs/drinks-refs/recruit/recruit_photo_08.jpg` 与 `01/02` 版式，
 * 含烤漆金属门形立架、斜向双面展板与近距离高亮提示态。
 */
export function buildRecruitStandee(options: RecruitStandeeOptions = {}): RecruitStandeeController {
  const spec: RecruitStandeeSpec = { ...DEFAULT_RECRUIT_STANDEE_SPEC, ...(options.spec ?? {}) }
  const group = new THREE.Group()
  group.name = 'drinks-recruit-standee'

  const boardGroup = new THREE.Group()
  boardGroup.name = 'drinks-recruit-board-assembly'
  group.add(boardGroup)

  const frameMat = new THREE.MeshStandardMaterial({
    color: spec.frameDarkHex,
    roughness: 0.45,
    metalness: 0.42,
    flatShading: true,
  })
  const trimRedMat = new THREE.MeshStandardMaterial({
    color: spec.primaryRedHex,
    roughness: 0.46,
    metalness: 0.08,
    emissive: new THREE.Color('#2a0406'),
    emissiveIntensity: 0.25,
    flatShading: true,
  })
  const signTex = createRecruitSignTexture(options)
  const faceMat = new THREE.MeshStandardMaterial({
    ...(signTex ? { map: signTex } : { color: spec.primaryRedHex }),
    roughness: 0.42,
    metalness: 0.04,
    emissive: new THREE.Color('#ffffff'),
    emissiveMap: signTex ?? null,
    emissiveIntensity: 0.22,
  })
  const crownGoldMat = new THREE.MeshStandardMaterial({
    color: spec.goldAccentHex,
    roughness: 0.34,
    metalness: 0.28,
    emissive: new THREE.Color('#3b2800'),
    emissiveIntensity: 0.2,
    flatShading: true,
  })

  const legLen = spec.heightM - 0.04
  const legW = 0.026
  const legGeo = new THREE.BoxGeometry(legW, legLen, legW)
  const footGeo = new THREE.BoxGeometry(0.056, 0.024, 0.064)
  const topBarGeo = new THREE.BoxGeometry(spec.widthM + 0.02, 0.032, 0.036)
  const boardGeo = new THREE.BoxGeometry(spec.boardWidthM, spec.boardHeightM, 0.02)
  const faceGeo = new THREE.PlaneGeometry(spec.boardWidthM - 0.022, spec.boardHeightM - 0.022)
  const crestGeo = new THREE.BoxGeometry(spec.boardWidthM * 0.72, 0.075, 0.036)

  // Top-hinged A-frame wings: all geometry sits below hinge (y <= 0) so rear panel NEVER intersects front upper title!
  const hingeY = spec.heightM - 0.035
  const panelCenterY = -spec.boardHeightM * 0.5 - 0.055
  for (const sgnZ of [1, -1] as const) {
    const legWing = new THREE.Group()
    legWing.position.set(0, hingeY, sgnZ * 0.012)
    legWing.rotation.x = sgnZ * -spec.tiltRad

    for (const sgnX of [-1, 1] as const) {
      const leg = new THREE.Mesh(legGeo, frameMat)
      leg.position.set(sgnX * (spec.widthM * 0.5 - 0.015), -legLen * 0.5, 0)
      legWing.add(leg)

      const foot = new THREE.Mesh(footGeo, frameMat)
      foot.position.set(sgnX * (spec.widthM * 0.5 - 0.015), -legLen + 0.012, 0)
      legWing.add(foot)
    }

    const panel = new THREE.Mesh(boardGeo, trimRedMat)
    panel.position.set(0, panelCenterY, sgnZ * 0.014)
    legWing.add(panel)

    const face = new THREE.Mesh(faceGeo, faceMat)
    face.position.set(0, panelCenterY, sgnZ * 0.031)
    if (sgnZ < 0) face.rotation.y = Math.PI
    legWing.add(face)

    boardGroup.add(legWing)
  }

  // Top A-frame hinge cap & gold accent crest bar
  const topBar = new THREE.Mesh(topBarGeo, frameMat)
  topBar.position.set(0, hingeY, 0)
  const crest = new THREE.Mesh(crestGeo, crownGoldMat)
  crest.position.set(0, hingeY + 0.044, 0)
  boardGroup.add(topBar, crest)

  // Floor alignment: shift assembly so lowest foot rests cleanly at y = 0
  group.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(group)
  if (Number.isFinite(box.min.y) && Math.abs(box.min.y) > 1e-4) {
    boardGroup.position.y -= box.min.y
  }

  let highlighted = false
  let onDutyState = false

  function setHighlighted(near: boolean, onDuty = false): void {
    if (highlighted === near && onDutyState === onDuty) return
    highlighted = near
    onDutyState = onDuty
    if (onDuty) {
      faceMat.emissiveIntensity = 0.16
      trimRedMat.emissiveIntensity = 0.2
      crownGoldMat.emissiveIntensity = 0.18
    } else if (near) {
      faceMat.emissiveIntensity = 0.42
      trimRedMat.emissiveIntensity = 0.58
      crownGoldMat.emissiveIntensity = 0.55
    } else {
      faceMat.emissiveIntensity = 0.22
      trimRedMat.emissiveIntensity = 0.25
      crownGoldMat.emissiveIntensity = 0.2
    }
  }

  function getBounds() {
    group.updateMatrixWorld(true)
    const b = new THREE.Box3().setFromObject(group)
    const size = b.getSize(new THREE.Vector3())
    return {
      widthM: Math.round(size.x * 1000) / 1000,
      heightM: Math.round(size.y * 1000) / 1000,
      depthM: Math.round(size.z * 1000) / 1000,
      minY: Math.round(b.min.y * 1000) / 1000,
      maxY: Math.round(b.max.y * 1000) / 1000,
    }
  }

  function getTriangles(): number {
    let tris = 0
    group.traverse(obj => {
      const m = obj as THREE.Mesh
      if (m.isMesh && m.geometry) {
        const idx = m.geometry.index
        tris += idx ? idx.count / 3 : m.geometry.attributes.position.count / 3
      }
    })
    return Math.round(tris)
  }

  return {
    group,
    boardGroup,
    spec,
    setHighlighted,
    getBounds,
    getTriangles,
    dispose() {
      disposeDrinkProp(group)
    },
  }
}
