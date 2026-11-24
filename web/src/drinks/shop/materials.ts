import * as THREE from 'three'
import { resolveDrinkSkin, type DrinkSkinConfig } from '../props/skins.ts'

/** UV 规范化子图矩形 `[px0, py0, px1, py1]`（Canvas 像素 0..1：X 自左向右，Y 自顶向下） */
export type AtlasRect = readonly [number, number, number, number]

export const EXTERIOR_ATLAS_RECTS = Object.freeze({
  // 2048x1024 图集：严格按真实 3D 平面宽高比排布，防一切字形拉伸
  // [0..0.16, 0..1.0] -> 328x1024 (~1:3.12) 竖排红柱「蜜雪冰城」
  verticalPillar: [0.0, 0.0, 0.16, 1.0] as AtlasRect,
  // [0.16..1.0, 0..0.38] -> 1720x389 (~4.42:1) 主红门头横招
  mainFascia: [0.16, 0.0, 1.0, 0.38] as AtlasRect,
  // [0.16..0.44, 0.38..0.94] -> 573x573 (1:1 正方) 白底雪王方牌
  squareBadge: [0.16, 0.38, 0.44, 0.94] as AtlasRect,
  // [0.44..1.0, 0.38..0.62] -> 1147x246 (~4.66:1) 1F 入口横幅灯箱
  entranceHeader: [0.44, 0.38, 1.0, 0.62] as AtlasRect,
  // [0.44..0.72, 0.62..1.0] -> 573x389 (~1.47:1) A字热销海报
  aFramePoster: [0.44, 0.62, 0.72, 1.0] as AtlasRect,
  // [0.72..1.0, 0.62..1.0] -> 573x389 (~1.47:1) 「始于1997」装饰牌
  columnIconsAndRetro: [0.72, 0.62, 1.0, 1.0] as AtlasRect,
})

export const INTERIOR_ATLAS_RECTS = Object.freeze({
  // 2048x1024 室内灯箱与吧台标牌图集（各子区精确匹配几何宽高比）
  // [0..0.50, 0..0.38] & [0.50..1.0, 0..0.38] -> 各 1024x389 (~2.63:1) 四联菜单屏（2x2面板）
  menuPanelLeft: [0.0, 0.0, 0.5, 0.38] as AtlasRect,
  menuPanelRight: [0.5, 0.0, 1.0, 0.38] as AtlasRect,
  // [0..0.52, 0.38..0.68] -> 1065x307 (~3.47:1) 分栏叫号取餐屏
  callScreen: [0.0, 0.38, 0.52, 0.68] as AtlasRect,
  // [0.52..0.67, 0.38..0.68] -> 307x307 (1:1 正方) 吧台居中正圆雪王徽章
  counterCenterMedallion: [0.52, 0.38, 0.67, 0.68] as AtlasRect,
  // [0.67..1.0, 0.38..0.53] -> 675x154 (~4.38:1) 收银 ORDER / 取餐 COLLECT 吧台贴牌
  counterOrderPlate: [0.67, 0.38, 1.0, 0.53] as AtlasRect,
  counterCollectPlate: [0.67, 0.53, 1.0, 0.68] as AtlasRect,
  // [0..1.0, 0.68..0.85] -> 682x174 (~3.92:1) 后墙三区大号高亮灯箱牌
  zoneFruit: [0.0, 0.68, 0.333, 0.85] as AtlasRect,
  zoneTea: [0.333, 0.68, 0.666, 0.85] as AtlasRect,
  zoneCream: [0.666, 0.68, 1.0, 0.85] as AtlasRect,
  // [0..0.50, 0.85..1.0] -> 512x154 (~3.33:1) 胶囊导视牌
  hangingCollect: [0.0, 0.85, 0.25, 1.0] as AtlasRect,
  hangingOrder: [0.25, 0.85, 0.5, 1.0] as AtlasRect,
  // [0.50..1.0, 0.85..1.0] -> 1024x154 (~6.6:1 -> 4.2m x 0.82m 或 3.0m x 0.72m 侧墙标语)
  wallSloganAndLicense: [0.5, 0.85, 1.0, 1.0] as AtlasRect,
})

export const MALL_ATLAS_RECTS = Object.freeze({
  curtainPlain: [0.0, 0.0, 0.48, 1.0] as AtlasRect,
  curvedCornerFloors: [0.48, 0.0, 0.84, 1.0] as AtlasRect,
  // [0.84..1.0, 0..0.28] 164x286 / 若改宽牌则放底部 [0..0.48, 0.82..1.0] 专供屋顶横招「GD 王城商厦」
  rooftopKingBanner: [0.84, 0.0, 1.0, 0.45] as AtlasRect,
  supermarketRiser: [0.84, 0.5, 1.0, 1.0] as AtlasRect,
})

export interface DrinksShopMaterialPack {
  readonly skin: DrinkSkinConfig
  readonly roofMat: THREE.MeshStandardMaterial
  readonly wallCreamMat: THREE.MeshStandardMaterial
  readonly wainscotWoodMat: THREE.MeshStandardMaterial
  readonly floorTileMat: THREE.MeshStandardMaterial
  readonly sidewalkMat: THREE.MeshStandardMaterial
  readonly tactilePathMat: THREE.MeshStandardMaterial
  readonly curbStripeMat: THREE.MeshStandardMaterial
  readonly podiumRedMat: THREE.MeshStandardMaterial
  readonly podiumTrimCreamMat: THREE.MeshStandardMaterial
  readonly curtainMullionMat: THREE.MeshStandardMaterial
  readonly curtainGlassMat: THREE.MeshStandardMaterial
  readonly upperCurtainMat: THREE.MeshStandardMaterial
  readonly doorGlassMat: THREE.MeshStandardMaterial
  readonly awningStripeMat: THREE.MeshStandardMaterial
  readonly counterBodyMat: THREE.MeshStandardMaterial
  readonly counterTopMat: THREE.MeshStandardMaterial
  readonly stainlessMat: THREE.MeshStandardMaterial
  readonly darkEquipmentMat: THREE.MeshStandardMaterial
  readonly goldAccentMat: THREE.MeshStandardMaterial
  readonly woodTableMat: THREE.MeshStandardMaterial
  readonly chairIndoorMat: THREE.MeshStandardMaterial
  readonly chairPatioMat: THREE.MeshStandardMaterial
  readonly parasolRedMat: THREE.MeshStandardMaterial
  readonly crateMat: THREE.MeshStandardMaterial
  readonly exteriorSignAtlasMat: THREE.MeshStandardMaterial
  readonly interiorSignAtlasMat: THREE.MeshStandardMaterial
  readonly mallFacadeMat: THREE.MeshStandardMaterial
  readonly ceilingLampMat: THREE.MeshStandardMaterial
  readonly iceCrownMat: THREE.MeshStandardMaterial
  readonly fasciaSignMat: THREE.MeshStandardMaterial
  readonly verticalPillarMat: THREE.MeshStandardMaterial
  readonly pillarBadgeMat: THREE.MeshStandardMaterial
  readonly snowflakeStripMat: THREE.MeshStandardMaterial
  readonly menuBoardMat: THREE.MeshStandardMaterial
  readonly callScreenMat: THREE.MeshStandardMaterial
  readonly counterOrderSignMat: THREE.MeshStandardMaterial
  readonly prepZoneFruitMat: THREE.MeshStandardMaterial
  readonly prepZoneTeaMat: THREE.MeshStandardMaterial
  readonly prepZoneCreamMat: THREE.MeshStandardMaterial
  setNight(night: number): void
  dispose(): void
}

const MIXUE_RED = '#e40013'
const MIXUE_DARK_RED = '#b80010'
const MIXUE_CREAM = '#fffaf4'
const MIXUE_GOLD = '#f6c33e'
const MIXUE_ORANGE = '#f37b21'

function makeCanvas(w: number, h: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (ctx) draw(ctx, w, h)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.needsUpdate = true
  return tex
}

function drawSnowflake(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, alpha = 0.78): void {
  ctx.save()
  ctx.strokeStyle = color
  ctx.globalAlpha = alpha
  ctx.lineWidth = Math.max(2, r * 0.14)
  ctx.lineCap = 'round'
  for (let k = 0; k < 3; k++) {
    const a = (k * Math.PI) / 3
    const dx = Math.cos(a) * r
    const dy = Math.sin(a) * r
    ctx.beginPath()
    ctx.moveTo(x - dx, y - dy)
    ctx.lineTo(x + dx, y + dy)
    ctx.stroke()
    for (const sign of [-1, 1]) {
      const bx = x + dx * 0.58 * sign
      const by = y + dy * 0.58 * sign
      for (const branch of [-0.55, 0.55]) {
        const ba = a + branch
        ctx.beginPath()
        ctx.moveTo(bx, by)
        ctx.lineTo(bx - Math.cos(ba) * r * 0.28 * sign, by - Math.sin(ba) * r * 0.28 * sign)
        ctx.stroke()
      }
    }
  }
  ctx.restore()
}

/** 2D 蜜雪雪王经典头像徽章（亮白面容+三齿白冠+胡萝卜鼻+微笑弧+红披风） */
function drawSnowKingAvatar(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, withBadgeBg = true): void {
  ctx.save()
  ctx.translate(cx, cy)
  if (withBadgeBg) {
    ctx.beginPath()
    ctx.arc(0, 0, r * 1.12, 0, Math.PI * 2)
    ctx.fillStyle = '#ffffff'
    ctx.fill()
    ctx.lineWidth = Math.max(3, r * 0.08)
    ctx.strokeStyle = MIXUE_RED
    ctx.stroke()
  }

  // 三齿白皇冠
  ctx.fillStyle = '#ffffff'
  ctx.strokeStyle = '#1f2937'
  ctx.lineWidth = Math.max(2, r * 0.05)
  ctx.beginPath()
  ctx.moveTo(-r * 0.48, -r * 0.34)
  ctx.lineTo(-r * 0.54, -r * 0.78)
  ctx.lineTo(-r * 0.22, -r * 0.54)
  ctx.lineTo(0, -r * 0.88)
  ctx.lineTo(r * 0.22, -r * 0.54)
  ctx.lineTo(r * 0.54, -r * 0.78)
  ctx.lineTo(r * 0.48, -r * 0.34)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()

  // 红披风肩领
  ctx.fillStyle = MIXUE_RED
  ctx.beginPath()
  ctx.ellipse(0, r * 0.58, r * 0.68, r * 0.34, 0, 0, Math.PI * 2)
  ctx.fill()

  // 圆润雪白面庞
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.ellipse(0, r * 0.08, r * 0.58, r * 0.5, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()

  // 有神深蓝黑眼 + 小腮红
  ctx.fillStyle = '#162033'
  for (const ex of [-r * 0.21, r * 0.21]) {
    ctx.beginPath()
    ctx.arc(ex, -r * 0.02, r * 0.075, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.fillStyle = 'rgba(244, 114, 134, 0.55)'
  for (const cx2 of [-r * 0.34, r * 0.34]) {
    ctx.beginPath()
    ctx.arc(cx2, r * 0.14, r * 0.08, 0, Math.PI * 2)
    ctx.fill()
  }
  // 橙色胡萝卜尖鼻
  ctx.fillStyle = MIXUE_ORANGE
  ctx.beginPath()
  ctx.moveTo(-r * 0.05, r * 0.04)
  ctx.lineTo(r * 0.2, r * 0.1)
  ctx.lineTo(-r * 0.03, r * 0.17)
  ctx.closePath()
  ctx.fill()
  // 弯月黑微笑弧线
  ctx.strokeStyle = '#162033'
  ctx.lineWidth = Math.max(2, r * 0.055)
  ctx.beginPath()
  ctx.arc(0, r * 0.21, r * 0.15, 0.18 * Math.PI, 0.82 * Math.PI)
  ctx.stroke()

  ctx.restore()
}

function paintZoneStrip(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  title: string,
  sub: string,
  accent: string,
): void {
  ctx.fillStyle = '#141a24'
  ctx.fillRect(x, y, w, h)
  ctx.fillStyle = MIXUE_RED
  ctx.fillRect(x, y, 22, h)
  ctx.strokeStyle = accent
  ctx.lineWidth = 5
  ctx.strokeRect(x + 4, y + 4, w - 8, h - 8)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 54px "PingFang SC", "Noto Sans SC", sans-serif'
  ctx.fillText(title, x + 42, y + h * 0.37, w - 58)
  ctx.fillStyle = accent
  ctx.font = 'bold 26px "PingFang SC", sans-serif'
  ctx.fillText(sub, x + 42, y + h * 0.76, w - 58)
}

export function createDrinksShopMaterials(skinOverride?: Partial<DrinkSkinConfig>): DrinksShopMaterialPack {
  const skin = resolveDrinkSkin({
    brandLabel: '蜜雪冰城',
    subLabel: 'SINCE 1997 · 桂林旗舰店',
    primaryHex: MIXUE_RED,
    secondaryHex: MIXUE_DARK_RED,
    creamHex: MIXUE_CREAM,
    goldHex: MIXUE_GOLD,
    ...skinOverride,
  })
  const texs: THREE.Texture[] = []
  const mats: THREE.Material[] = []
  const litEntries: Array<{ mat: THREE.MeshStandardMaterial; base: number; nightBoost: number }> = []

  const ownTex = <T extends THREE.Texture | null>(t: T): T => {
    if (t) texs.push(t)
    return t
  }
  const std = (params: THREE.MeshStandardMaterialParameters, base = 0, nightBoost = 0): THREE.MeshStandardMaterial => {
    const m = new THREE.MeshStandardMaterial({
      roughness: 0.76,
      metalness: 0.04,
      emissive: params.color ?? 0xffe4c4,
      emissiveIntensity: base,
      ...params,
    })
    if (m.map && !m.emissiveMap) m.emissiveMap = m.map
    mats.push(m)
    litEntries.push({ mat: m, base, nightBoost })
    return m
  }

  // ─── 1. 外立面招牌图集 (`exteriorSignAtlas` 2048x1024 -> 1 次合批) ───
  const exteriorAtlasTex = ownTex(
    makeCanvas(2048, 1024, (ctx, w, h) => {
      ctx.fillStyle = MIXUE_RED
      ctx.fillRect(0, 0, w, h)

      // A [0..0.16, 0..1.0]: 转角竖排红柱「蜜 雪 冰 城」（328x1024 -> 比例 1:3.12 零压扁）
      const colW = Math.round(w * 0.16)
      ctx.fillStyle = MIXUE_RED
      ctx.fillRect(0, 0, colW, h)
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 8
      ctx.strokeRect(10, 12, colW - 20, h - 24)
      drawSnowflake(ctx, colW * 0.5, 76, 32, '#ffffff', 0.85)
      ctx.fillStyle = '#ffffff'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = 'bold 148px "PingFang SC", "Noto Sans SC", sans-serif'
      ;['蜜', '雪', '冰', '城'].forEach((ch, idx) => ctx.fillText(ch, colW * 0.5, 224 + idx * 204))

      // B [0.16..1.0, 0..0.38]: 主巨幅正红横招（1720x389 -> 4.42:1；雪花严格避让笔画）
      const bx0 = colW
      const bw = w - colW
      const bh = Math.round(h * 0.38)
      ctx.fillStyle = MIXUE_RED
      ctx.fillRect(bx0, 0, bw, bh)
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 12
      ctx.strokeRect(bx0 + 14, 14, bw - 28, bh - 28)
      // 雪花置于四角外缘留白，绝不压汉字
      for (const [sx, sy, sr] of [
        [bx0 + 68, 56, 20],
        [w - 72, 58, 22],
        [w - 110, 260, 18],
      ] as const) {
        drawSnowflake(ctx, sx, sy, sr, '#ffffff', 0.82)
      }
      drawSnowKingAvatar(ctx, bx0 + 210, bh * 0.5, 102, true)
      ctx.fillStyle = '#ffffff'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.font = 'bold 142px "PingFang SC", "Noto Sans SC", sans-serif'
      ctx.fillText('蜜雪冰城', bx0 + 368, 134)
      ctx.fillStyle = '#fff5ea'
      ctx.font = 'bold 42px "PingFang SC", sans-serif'
      ctx.fillText('MIXUE · SINCE 1997 · ICE CREAM & TEA', bx0 + 372, 246)
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(bx0 + 370, 298, 1210, 46)
      ctx.fillStyle = MIXUE_RED
      ctx.textAlign = 'center'
      ctx.font = 'bold 28px "PingFang SC", sans-serif'
      ctx.fillText(`你爱我 ♥ 我爱你  蜜雪冰城甜蜜蜜 · ${skin.subLabel}`, bx0 + 975, 322, 1180)

      // C [0.16..0.44, 0.38..0.94]: 1:1 正方白底雪王方牌（573x573，零椭圆）
      const cx0 = colW
      const cy0 = bh
      const cw = Math.round(w * 0.28)
      const ch = Math.round(h * 0.56)
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(cx0, cy0, cw, ch)
      ctx.strokeStyle = MIXUE_RED
      ctx.lineWidth = 14
      ctx.strokeRect(cx0 + 16, cy0 + 16, cw - 32, ch - 32)
      drawSnowKingAvatar(ctx, cx0 + cw * 0.5, cy0 + ch * 0.42, 138, true)
      ctx.fillStyle = MIXUE_RED
      ctx.font = 'bold 58px "PingFang SC", sans-serif'
      ctx.fillText('MIXUE · 雪王驾到', cx0 + cw * 0.5, cy0 + ch * 0.84)

      // D [0.44..1.0, 0.38..0.62]: 1F 入口上方横幅灯箱（1147x246 -> 4.66:1）
      const dx0 = cx0 + cw
      const dw = w - dx0
      const dh = Math.round(h * 0.24)
      ctx.fillStyle = MIXUE_RED
      ctx.fillRect(dx0, cy0, dw, dh)
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 8
      ctx.strokeRect(dx0 + 10, cy0 + 10, dw - 20, dh - 20)
      drawSnowKingAvatar(ctx, dx0 + 116, cy0 + dh * 0.5, 68, true)
      ctx.textAlign = 'left'
      ctx.fillStyle = '#ffffff'
      ctx.font = 'bold 82px "PingFang SC", "Noto Sans SC", sans-serif'
      ctx.fillText('蜜雪冰城', dx0 + 216, cy0 + dh * 0.38)
      ctx.fillStyle = MIXUE_GOLD
      ctx.font = 'bold 34px "PingFang SC", sans-serif'
      ctx.fillText('SINCE 1997 · 冰鲜柠檬水 ¥4 · 新鲜冰淇淋 ¥2', dx0 + 218, cy0 + dh * 0.77, dw - 245)

      // E [0.44..0.72, 0.62..1.0]: 门前红框 A 字立牌（573x389 -> 高锐度，控制发光不过曝）
      const ey0 = cy0 + dh
      const ew = Math.round(w * 0.28)
      const eh = h - ey0
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(dx0, ey0, ew, eh)
      ctx.strokeStyle = MIXUE_RED
      ctx.lineWidth = 10
      ctx.strokeRect(dx0 + 10, ey0 + 10, ew - 20, eh - 20)
      ctx.fillStyle = MIXUE_RED
      ctx.fillRect(dx0 + 18, ey0 + 18, ew - 36, 84)
      ctx.fillStyle = '#ffffff'
      ctx.textAlign = 'center'
      ctx.font = 'bold 46px "PingFang SC", sans-serif'
      ctx.fillText('雪王热销榜', dx0 + ew * 0.5, ey0 + 60)
      ctx.fillStyle = '#b91c1c'
      ctx.font = 'bold 46px "PingFang SC", sans-serif'
      ctx.fillText('冰鲜柠檬水  ¥4', dx0 + ew * 0.5, ey0 + 165)
      ctx.fillText('新鲜冰淇淋  ¥2', dx0 + ew * 0.5, ey0 + 235)
      ctx.fillStyle = '#1e293b'
      ctx.font = 'bold 34px "PingFang SC", sans-serif'
      ctx.fillText('扫码点单 · 欢迎进店', dx0 + ew * 0.5, ey0 + 322)

      // F [0.72..1.0, 0.62..1.0]: 「始于1997」红底白字复古方牌
      const fx0 = dx0 + ew
      const fw = w - fx0
      ctx.fillStyle = MIXUE_RED
      ctx.fillRect(fx0, ey0, fw, eh)
      ctx.strokeStyle = MIXUE_CREAM
      ctx.lineWidth = 8
      ctx.strokeRect(fx0 + 14, ey0 + 14, fw - 28, eh - 28)
      ctx.fillStyle = '#ffffff'
      ctx.font = 'bold 74px "PingFang SC", sans-serif'
      ctx.fillText('始于 1997', fx0 + fw * 0.5, ey0 + 110)
      ctx.fillStyle = MIXUE_GOLD
      ctx.font = 'bold 36px "PingFang SC", sans-serif'
      ctx.fillText('高质平价 · 现制饮品', fx0 + fw * 0.5, ey0 + 188)
      drawSnowKingAvatar(ctx, fx0 + fw * 0.5, ey0 + 298, 56, true)
    }),
  )

  // ─── 2. 室内发光菜单灯箱/叫号屏/吧台贴图集 (`interiorSignAtlas` 2048x1024 -> 1 次合批) ───
  const interiorAtlasTex = ownTex(
    makeCanvas(2048, 1024, (ctx, w, h) => {
      ctx.fillStyle = '#fff5f5'
      ctx.fillRect(0, 0, w, h)

      // 菜单灯箱墙 [0..1.0, 0..0.38]（1024x389 -> 2.63:1）
      const menuH = Math.round(h * 0.38)
      ctx.fillStyle = '#fff7f4'
      ctx.fillRect(0, 0, w, menuH)
      const panelW = w / 4
      const panels = [
        {
          hdr: 'TOP 爆款榜 · 鲜果茶',
          bg: '#fff0f2',
          items: [
            ['TOP1 冰鲜柠檬水', '¥4', '#f6c33e'],
            ['TOP2 棒打鲜橙', '¥6', '#f37b21'],
            ['TOP3 满杯百香果', '¥7', '#e85d04'],
            ['TOP4 芋圆葡萄', '¥8', '#8338ec'],
          ],
        },
        {
          hdr: '招牌奶茶 · 鲜萃原叶',
          bg: '#fff9f2',
          items: [
            ['黑糖珍珠奶茶', '¥7', '#8b5e34'],
            ['珍珠奶茶', '¥7', '#c68b59'],
            ['蜜桃四季春', '¥7', '#ff758f'],
            ['脆脆奶盖红茶', '¥6', '#d97706'],
          ],
        },
        {
          hdr: '冰淇淋 · 雪王圣代',
          bg: '#fff0f4',
          items: [
            ['新鲜冰淇淋', '¥2', '#fff1c1'],
            ['黑糖珍珠圣代', '¥6', '#b45309'],
            ['草莓啵啵圣代', '¥6', '#ef476f'],
            ['奥利奥圣代', '¥6', '#334155'],
          ],
        },
        {
          hdr: '鲜果特饮 · 现磨咖啡',
          bg: '#eff9ff',
          items: [
            ['杨枝甘露', '¥9', '#f59e0b'],
            ['草莓摇摇奶昔', '¥6', '#e11d48'],
            ['冰美式咖啡', '¥5', '#573d2e'],
            ['拿铁咖啡', '¥7', '#7c5840'],
          ],
        },
      ]
      panels.forEach((p, idx) => {
        const px = idx * panelW
        ctx.fillStyle = p.bg
        ctx.fillRect(px + 8, 8, panelW - 16, menuH - 16)
        ctx.fillStyle = MIXUE_RED
        ctx.fillRect(px + 8, 8, panelW - 16, 64)
        drawSnowKingAvatar(ctx, px + 44, 40, 22, true)
        ctx.fillStyle = '#ffffff'
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        ctx.font = 'bold 28px "PingFang SC", sans-serif'
        ctx.fillText(p.hdr, px + 76, 40, panelW - 96)

        p.items.forEach(([name, price, dotColor], rowIdx) => {
          const ry = 104 + rowIdx * 66
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(px + 18, ry - 22, panelW - 36, 54)
          ctx.strokeStyle = 'rgba(228, 0, 19, 0.25)'
          ctx.lineWidth = 2
          ctx.strokeRect(px + 18, ry - 22, panelW - 36, 54)

          ctx.fillStyle = dotColor
          ctx.beginPath()
          ctx.arc(px + 48, ry + 5, 16, 0, Math.PI * 2)
          ctx.fill()

          ctx.fillStyle = '#1f2937'
          ctx.textAlign = 'left'
          ctx.font = 'bold 25px "PingFang SC", sans-serif'
          ctx.fillText(name, px + 76, ry + 5, panelW - 180)

          ctx.fillStyle = MIXUE_RED
          ctx.textAlign = 'right'
          ctx.font = 'bold 32px "PingFang SC", sans-serif'
          ctx.fillText(price, px + panelW - 28, ry + 5)
        })
      })

      // 分栏叫号取餐屏 [0..0.52, 0.38..0.68]（1065x307 -> 3.47:1）
      const cy0 = menuH
      const ch = Math.round(h * 0.3)
      const cw = Math.round(w * 0.52)
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, cy0, cw, ch)
      ctx.fillStyle = MIXUE_RED
      ctx.fillRect(0, cy0, cw, 62)
      drawSnowKingAvatar(ctx, 48, cy0 + 31, 22, true)
      ctx.fillStyle = '#ffffff'
      ctx.textAlign = 'left'
      ctx.font = 'bold 34px "PingFang SC", sans-serif'
      ctx.fillText('取餐叫号 · PICKUP SCREEN', 84, cy0 + 32)
      ctx.fillStyle = '#fff1f2'
      ctx.fillRect(20, cy0 + 80, cw * 0.48 - 26, ch - 96)
      ctx.fillStyle = MIXUE_RED
      ctx.textAlign = 'center'
      ctx.font = 'bold 30px "PingFang SC", sans-serif'
      ctx.fillText('请取餐 READY', cw * 0.24 + 4, cy0 + 114)
      ctx.font = 'bold 74px monospace'
      ctx.fillText('A008', cw * 0.24 + 4, cy0 + 190)
      ctx.font = 'bold 26px "PingFang SC", sans-serif'
      ctx.fillText('A006 · A007', cw * 0.24 + 4, cy0 + 252)

      ctx.fillStyle = '#f1f5f9'
      ctx.fillRect(cw * 0.5, cy0 + 80, cw * 0.48 - 10, ch - 96)
      ctx.fillStyle = '#1e293b'
      ctx.font = 'bold 28px "PingFang SC", sans-serif'
      ctx.fillText('制作中 PREPARING', cw * 0.74 - 2, cy0 + 114)
      ctx.fillStyle = '#334155'
      ctx.font = 'bold 34px monospace'
      ctx.fillText('A009  A010', cw * 0.74 - 2, cy0 + 182)
      ctx.fillText('A011  A012', cw * 0.74 - 2, cy0 + 238)

      // 吧台居中正方 1:1 雪王徽标 [0.52..0.67, 0.38..0.68] (307x307 -> 绝对正圆！)
      const mx0 = cw
      const mw = Math.round(w * 0.15)
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(mx0, cy0, mw, ch)
      ctx.fillStyle = MIXUE_RED
      ctx.fillRect(mx0, cy0 + 20, mw, 10)
      ctx.fillRect(mx0, cy0 + ch - 30, mw, 10)
      drawSnowKingAvatar(ctx, mx0 + mw * 0.5, cy0 + ch * 0.5, 114, true)

      // 前吧台左收银卡 [0.67..1.0, 0.38..0.53] (675x154 -> 4.38:1，匹配 2.4m x 0.54m!)
      const px0 = mx0 + mw
      const pw = w - px0
      const pHalfH = Math.round(ch * 0.5)
      ctx.fillStyle = MIXUE_RED
      ctx.fillRect(px0, cy0, pw, pHalfH)
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 6
      ctx.strokeRect(px0 + 8, cy0 + 8, pw - 16, pHalfH - 16)
      ctx.fillStyle = '#ffffff'
      ctx.textAlign = 'center'
      ctx.font = 'bold 54px "PingFang SC", sans-serif'
      ctx.fillText('◀ 收银点单 · ORDER', px0 + pw * 0.5, cy0 + pHalfH * 0.38, pw - 40)
      ctx.fillStyle = MIXUE_GOLD
      ctx.font = 'bold 30px "PingFang SC", sans-serif'
      ctx.fillText('扫码点单 · 冰鲜柠檬水 ¥4', px0 + pw * 0.5, cy0 + pHalfH * 0.78, pw - 40)

      // 前吧台右取餐卡 [0.67..1.0, 0.53..0.68] (675x154 -> 4.38:1，匹配 2.4m x 0.54m!)
      const p2y = cy0 + pHalfH
      ctx.fillStyle = '#1e293b'
      ctx.fillRect(px0, p2y, pw, ch - pHalfH)
      ctx.strokeStyle = MIXUE_RED
      ctx.lineWidth = 6
      ctx.strokeRect(px0 + 8, p2y + 8, pw - 16, ch - pHalfH - 16)
      ctx.fillStyle = MIXUE_GOLD
      ctx.font = 'bold 54px "PingFang SC", sans-serif'
      ctx.fillText('取餐出杯 · COLLECT ▶', px0 + pw * 0.5, p2y + pHalfH * 0.38, pw - 40)
      ctx.fillStyle = '#ffffff'
      ctx.font = 'bold 30px "PingFang SC", sans-serif'
      ctx.fillText('雪王推荐 · 现场现制取杯', px0 + pw * 0.5, p2y + pHalfH * 0.78, pw - 40)

      // 后墙制茶三区高亮灯箱 [0..1.0, 0.68..0.85]
      const zy0 = Math.round(h * 0.68)
      const zh = Math.round(h * 0.17)
      const zw = Math.round(w / 3)
      paintZoneStrip(ctx, 0, zy0, zw, zh, '鲜果碎冰区', 'FRESH LEMONADE & ICE', '#ffd058')
      paintZoneStrip(ctx, zw, zy0, zw, zh, '萃茶摇茶 · 封口区', 'TEA SHAKER & SEALER', '#7ee8c6')
      paintZoneStrip(ctx, zw * 2, zy0, w - zw * 2, zh, '冰淇淋 · 奶浆区', 'SOFT SERVE & BOBA', '#ffb8a0')

      // 悬挂胶囊导视牌 [0..0.5, 0.85..1.0]
      const py0 = Math.round(h * 0.85)
      const ph = h - py0
      const hw = Math.round(w * 0.25)
      for (const [hx, label, sub] of [
        [0, 'COLLECT · 取餐', '◀ 出杯递餐口'],
        [hw, 'ORDER HERE · 点单', '收银点单台 ▶'],
      ] as const) {
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(hx + 6, py0 + 6, hw - 12, ph - 12)
        ctx.strokeStyle = MIXUE_RED
        ctx.lineWidth = 10
        ctx.strokeRect(hx + 12, py0 + 12, hw - 24, ph - 24)
        ctx.fillStyle = MIXUE_RED
        ctx.textAlign = 'center'
        ctx.font = 'bold 42px "PingFang SC", sans-serif'
        ctx.fillText(label, hx + hw * 0.5, py0 + ph * 0.38, hw - 40)
        ctx.fillStyle = '#334155'
        ctx.font = 'bold 26px "PingFang SC", sans-serif'
        ctx.fillText(sub, hx + hw * 0.5, py0 + ph * 0.74, hw - 40)
      }

      // 室内红墙标语「我在蜜雪等着你」+ 营业执照 SOP 框 [0.5..1.0, 0.85..1.0]
      const sx0 = Math.round(w * 0.5)
      ctx.fillStyle = MIXUE_RED
      ctx.fillRect(sx0, py0, w - sx0, ph)
      ctx.fillStyle = '#ffffff'
      ctx.textAlign = 'left'
      ctx.font = 'bold 46px "PingFang SC", sans-serif'
      ctx.fillText('我在蜜雪等着你 ♥ 食品经营规范公示', sx0 + 36, py0 + ph * 0.36, w - sx0 - 60)
      ctx.fillStyle = MIXUE_GOLD
      ctx.font = 'bold 28px "PingFang SC", sans-serif'
      ctx.fillText('现切鲜果 · 净水制冰 · 营业执照 / 健康证 / SOP', sx0 + 36, py0 + ph * 0.74, w - sx0 - 60)
    }),
  )

  // ─── 3. 王城·商厦 1-8F 玻璃幕墙与真实转角店招图集 (`mallFacade` 1024x1024 -> 1 次合批) ───
  const mallTex = ownTex(
    makeCanvas(1024, 1024, (ctx, w, h) => {
      // [0..0.48, 0..1]: 深灰黑框蓝灰玻璃幕墙
      const leftW = Math.round(w * 0.48)
      ctx.fillStyle = '#334556'
      ctx.fillRect(0, 0, leftW, h)
      const grad = ctx.createLinearGradient(0, 0, leftW, h)
      grad.addColorStop(0, 'rgba(186, 218, 240, 0.24)')
      grad.addColorStop(0.5, 'rgba(65, 90, 114, 0.08)')
      grad.addColorStop(1, 'rgba(205, 229, 245, 0.2)')
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, leftW, h)
      for (let row = 0; row < 4; row++) {
        const yBase = Math.round((row * h) / 4)
        ctx.fillStyle = '#1d242c'
        ctx.fillRect(0, yBase, leftW, 12)
        ctx.fillStyle = '#242c36'
        ctx.fillRect(0, yBase + Math.round(h / 4) - 46, leftW, 46)
      }
      ctx.fillStyle = '#1a2026'
      for (let x = 0; x <= leftW; x += Math.round(leftW / 4)) {
        ctx.fillRect(Math.max(0, x - 5), 0, 10, h)
      }

      // [0.48..0.84, 0..1]: 王城·商厦 8 格弧角 1–8F 幕墙与转角招牌（完整无遮挡！）
      const cx0 = leftW
      const cw = Math.round(w * 0.36)
      ctx.fillStyle = '#35485b'
      ctx.fillRect(cx0, 0, cw, h)
      const rowH = h / 8
      for (let f = 0; f < 8; f++) {
        const fy = Math.round(f * rowH)
        ctx.fillStyle = f >= 6 ? '#3a4f62' : '#2f4152'
        ctx.fillRect(cx0, fy, cw, rowH)
        ctx.fillStyle = '#1c222a'
        ctx.fillRect(cx0, fy, cw, 10)
        ctx.fillRect(cx0, fy + rowH - 24, cw, 24)
      }
      ctx.fillStyle = '#171c22'
      for (let k = 0; k <= 4; k++) {
        ctx.fillRect(cx0 + Math.round((k * cw) / 4) - 4, 0, 8, h)
      }
      // 2F 亮橱窗毛绒雪王展台（ref/04_IMG_1393）
      ctx.fillStyle = '#e0f2fe'
      ctx.fillRect(cx0 + 12, Math.round(6 * rowH + 14), cw - 24, rowH - 42)
      drawSnowKingAvatar(ctx, cx0 + cw * 0.35, 6 * rowH + 58, 28, false)
      drawSnowKingAvatar(ctx, cx0 + cw * 0.65, 6 * rowH + 62, 24, false)
      // 3F KING'S PLAZA + 王城·商厦
      ctx.fillStyle = '#ffffff'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = 'bold 42px "PingFang SC", sans-serif'
      ctx.fillText('王城·商厦', cx0 + cw * 0.5, 5 * rowH + 46, cw - 24)
      ctx.font = 'bold 20px sans-serif'
      ctx.fillText("KING'S PLAZA", cx0 + cw * 0.5, 5 * rowH + 102, cw - 24)
      // 4F 王城电脑城 5/6楼
      ctx.fillStyle = '#facc15'
      ctx.font = 'bold 40px "PingFang SC", sans-serif'
      ctx.fillText('王城电脑城', cx0 + cw * 0.5, 4 * rowH + 48, cw - 24)
      ctx.font = 'bold 22px "PingFang SC", sans-serif'
      ctx.fillText('5 / 6 楼', cx0 + cw * 0.5, 4 * rowH + 92, cw - 24)
      // 5F 飞扬美学
      ctx.fillStyle = '#f8fafc'
      ctx.font = 'bold 34px "PingFang SC", sans-serif'
      ctx.fillText('飞扬美学', cx0 + cw * 0.5, 3 * rowH + 54, cw - 24)
      // 6F DJI 大疆
      ctx.fillStyle = '#e2e8f0'
      ctx.font = 'bold 34px "PingFang SC", sans-serif'
      ctx.fillText('DJI 大疆', cx0 + cw * 0.5, 2 * rowH + 54, cw - 24)

      // [0.84..1.0, 0..1]: 屋顶「GD 王城商厦」方版 + 东翼「王城超市」（1:1 比例方框无压扁！）
      const rx0 = cx0 + cw
      const rw = w - rx0
      // 上部 [0.84..1.0, 0..0.45]: 屋顶牌（匹配 6.8m x 2.3m 比例则绘制竖向/分两行大字? 不, 写醒目红底两行「GD · 王城商厦」）
      ctx.fillStyle = '#1e242d'
      ctx.fillRect(rx0, 0, rw, Math.round(h * 0.45))
      ctx.fillStyle = MIXUE_RED
      ctx.fillRect(rx0 + 6, 12, rw - 12, Math.round(h * 0.45) - 24)
      ctx.fillStyle = '#ffffff'
      ctx.font = 'bold 38px "PingFang SC", sans-serif'
      ctx.fillText('GD', rx0 + rw * 0.5, 90, rw - 20)
      ctx.font = 'bold 34px "PingFang SC", sans-serif'
      ctx.fillText('王城', rx0 + rw * 0.5, 210, rw - 20)
      ctx.fillText('商厦', rx0 + rw * 0.5, 330, rw - 20)

      // 下部 [0.84..1.0, 0.50..1.0]: 「王城超市」方形蓝底广告牌（贴于 2.4m x 2.6m 方形看板，1:1 不拉扁！）
      const sy0 = Math.round(h * 0.5)
      const sh = h - sy0
      ctx.fillStyle = '#1d4ed8'
      ctx.fillRect(rx0, sy0, rw, sh)
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 6
      ctx.strokeRect(rx0 + 8, sy0 + 8, rw - 16, sh - 16)
      ctx.fillStyle = '#ffffff'
      ctx.font = 'bold 36px "PingFang SC", sans-serif'
      ctx.fillText('王城', rx0 + rw * 0.5, sy0 + sh * 0.34, rw - 24)
      ctx.fillText('超市', rx0 + rw * 0.5, sy0 + sh * 0.58, rw - 24)
      ctx.fillStyle = '#facc15'
      ctx.font = 'bold 26px "PingFang SC", sans-serif'
      ctx.fillText('M 麦当劳', rx0 + rw * 0.5, sy0 + sh * 0.82, rw - 24)
    }),
  )

  // 红白相间雨棚（仅 poi_zhengyang208 使用）
  const awningTex = ownTex(
    makeCanvas(256, 64, (ctx, w, h) => {
      for (let x = 0; x < w; x += 32) {
        ctx.fillStyle = (x / 32) % 2 === 0 ? MIXUE_RED : MIXUE_CREAM
        ctx.fillRect(x, 0, 32, h)
      }
    }),
  )

  // 600x600 米白防滑地砖
  const floorTex = ownTex(
    makeCanvas(256, 256, (ctx, w, h) => {
      ctx.fillStyle = '#ece6da'
      ctx.fillRect(0, 0, w, h)
      ctx.fillStyle = 'rgba(155, 145, 130, 0.14)'
      for (let i = 0; i < 64; i++) ctx.fillRect((i * 37) % w, (i * 53) % h, 3, 3)
      ctx.strokeStyle = 'rgba(122, 112, 98, 0.28)'
      ctx.lineWidth = 3
      for (let g = 0; g <= w; g += 64) {
        ctx.beginPath()
        ctx.moveTo(g, 0)
        ctx.lineTo(g, h)
        ctx.moveTo(0, g)
        ctx.lineTo(w, g)
        ctx.stroke()
      }
    }),
  )
  if (floorTex) {
    floorTex.wrapS = THREE.RepeatWrapping
    floorTex.wrapT = THREE.RepeatWrapping
    floorTex.repeat.set(5.5, 4.0)
  }

  // 室内白釉地铁砖墙
  const wallTileTex = ownTex(
    makeCanvas(256, 256, (ctx, w, h) => {
      ctx.fillStyle = '#f8f6f2'
      ctx.fillRect(0, 0, w, h)
      ctx.strokeStyle = 'rgba(182, 186, 192, 0.42)'
      ctx.lineWidth = 2
      for (let y = 0; y <= h; y += 32) {
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(w, y)
        ctx.stroke()
      }
      for (let x = 0; x <= w; x += 64) {
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, h)
        ctx.stroke()
      }
    }),
  )
  if (wallTileTex) {
    wallTileTex.wrapS = THREE.RepeatWrapping
    wallTileTex.wrapT = THREE.RepeatWrapping
    wallTileTex.repeat.set(4, 2)
  }

  // 街头深灰矩形大板石材铺装
  const sidewalkTex = ownTex(
    makeCanvas(256, 256, (ctx, w, h) => {
      ctx.fillStyle = '#7e807b'
      ctx.fillRect(0, 0, w, h)
      ctx.strokeStyle = 'rgba(48, 50, 46, 0.34)'
      ctx.lineWidth = 4
      for (let g = 0; g <= w; g += 64) {
        ctx.beginPath()
        ctx.moveTo(g, 0)
        ctx.lineTo(g, h)
        ctx.moveTo(0, g)
        ctx.lineTo(w, g)
        ctx.stroke()
      }
    }),
  )
  if (sidewalkTex) {
    sidewalkTex.wrapS = THREE.RepeatWrapping
    sidewalkTex.wrapT = THREE.RepeatWrapping
    sidewalkTex.repeat.set(6.5, 2.2)
  }

  // 黑黄路缘
  const curbTex = ownTex(
    makeCanvas(256, 64, (ctx, w, h) => {
      for (let x = 0; x < w; x += 64) {
        ctx.fillStyle = (x / 64) % 2 === 0 ? '#272a2e' : '#d8b434'
        ctx.fillRect(x, 0, 64, h)
      }
    }),
  )
  if (curbTex) {
    curbTex.wrapS = THREE.RepeatWrapping
    curbTex.wrapT = THREE.RepeatWrapping
    curbTex.repeat.set(6.5, 1)
  }

  const roofMat = std({ color: '#e6e1d8', roughness: 0.86, emissive: '#645e56' }, 0.02, 0.14)
  const wallCreamMat = std({ ...(wallTileTex ? { map: wallTileTex } : {}), color: 0xffffff, roughness: 0.42, emissive: '#fff6ea' }, 0.05, 0.32)
  const wainscotWoodMat = std({ color: '#d8bc93', roughness: 0.65, emissive: '#e6c99b' }, 0.03, 0.25)
  const floorTileMat = std({ ...(floorTex ? { map: floorTex } : {}), color: 0xffffff, roughness: 0.66, emissive: '#fff4df' }, 0.04, 0.28)
  const sidewalkMat = std({ ...(sidewalkTex ? { map: sidewalkTex } : {}), color: 0xffffff, roughness: 0.9, emissive: '#585752' }, 0, 0.1)
  const curbStripeMat = std({ ...(curbTex ? { map: curbTex } : {}), color: 0xffffff, roughness: 0.85, emissive: '#5a5020' }, 0, 0.1)
  const podiumRedMat = std({ color: MIXUE_RED, roughness: 0.46, emissive: MIXUE_RED }, 0.12, 0.48)
  const podiumTrimCreamMat = std({ color: MIXUE_CREAM, roughness: 0.45, emissive: '#fff5e6' }, 0.08, 0.36)
  const curtainMullionMat = std({ color: '#1e232a', roughness: 0.42, metalness: 0.38, emissive: '#1e2228' }, 0, 0.1)
  const curtainGlassMat = std({ color: '#dff1f7', roughness: 0.1, metalness: 0.08, transparent: true, opacity: 0.18, emissive: '#ffefd4' }, 0.02, 0.12)
  const counterTopMat = std({ color: '#f3f5f7', roughness: 0.32, emissive: '#fffbf2' }, 0.05, 0.32)
  const stainlessMat = std({ color: '#c1c9d0', roughness: 0.28, metalness: 0.62, emissive: '#98a1a8' }, 0.02, 0.22)
  const darkEquipmentMat = std({ color: '#242a33', roughness: 0.52, metalness: 0.2, emissive: '#343c47' }, 0.02, 0.18)
  const goldAccentMat = std({ color: MIXUE_GOLD, roughness: 0.34, metalness: 0.32, emissive: MIXUE_GOLD }, 0.08, 0.44)
  const chairPatioMat = std({ color: MIXUE_ORANGE, roughness: 0.62, emissive: MIXUE_ORANGE }, 0.04, 0.24)
  const crateMat = std({ color: '#c4834b', roughness: 0.82, emissive: '#8e5e32' }, 0.02, 0.16)
  const awningStripeMat = std({ ...(awningTex ? { map: awningTex } : {}), color: 0xffffff, roughness: 0.72, emissive: '#fff0dc' }, 0.04, 0.28)
  const ceilingLampMat = std({ color: '#fffdf7', roughness: 0.2, emissive: '#fff3d6' }, 0.72, 1.0)
  const iceCrownMat = std({ color: '#ffffff', roughness: 0.26, metalness: 0.05, emissive: '#fff7ea' }, 0.1, 0.42)

  // 适度自发光：室外招牌夜亮日不刺眼过曝（base=0.22），室内菜单灯箱常亮清晰（base=0.42）
  const exteriorSignAtlasMat = std({ ...(exteriorAtlasTex ? { map: exteriorAtlasTex } : {}), color: 0xffffff, roughness: 0.38, emissive: 0xffffff }, 0.22, 0.88)
  const interiorSignAtlasMat = std({ ...(interiorAtlasTex ? { map: interiorAtlasTex } : {}), color: 0xffffff, roughness: 0.34, emissive: 0xffffff }, 0.42, 0.88)
  const mallFacadeMat = std({ ...(mallTex ? { map: mallTex } : {}), color: 0xffffff, roughness: 0.28, metalness: 0.32, emissive: 0xffffff }, 0.1, 0.38)

  return {
    skin,
    roofMat,
    wallCreamMat,
    wainscotWoodMat,
    floorTileMat,
    sidewalkMat,
    tactilePathMat: sidewalkMat,
    curbStripeMat,
    podiumRedMat,
    podiumTrimCreamMat,
    curtainMullionMat,
    curtainGlassMat,
    upperCurtainMat: mallFacadeMat,
    doorGlassMat: curtainGlassMat,
    awningStripeMat,
    counterBodyMat: podiumTrimCreamMat,
    counterTopMat,
    stainlessMat,
    darkEquipmentMat,
    goldAccentMat,
    woodTableMat: wainscotWoodMat,
    chairIndoorMat: wainscotWoodMat,
    chairPatioMat,
    parasolRedMat: podiumRedMat,
    crateMat,
    exteriorSignAtlasMat,
    interiorSignAtlasMat,
    mallFacadeMat,
    ceilingLampMat,
    iceCrownMat,
    fasciaSignMat: exteriorSignAtlasMat,
    verticalPillarMat: exteriorSignAtlasMat,
    pillarBadgeMat: exteriorSignAtlasMat,
    snowflakeStripMat: exteriorSignAtlasMat,
    menuBoardMat: interiorSignAtlasMat,
    callScreenMat: interiorSignAtlasMat,
    counterOrderSignMat: interiorSignAtlasMat,
    prepZoneFruitMat: interiorSignAtlasMat,
    prepZoneTeaMat: interiorSignAtlasMat,
    prepZoneCreamMat: interiorSignAtlasMat,

    setNight(night: number) {
      const n = THREE.MathUtils.clamp(Number.isFinite(night) ? night : 0, 0, 1)
      for (const item of litEntries) {
        item.mat.emissiveIntensity = item.base + n * item.nightBoost
      }
    },

    dispose() {
      for (const m of mats) m.dispose()
      for (const t of texs) t.dispose()
    },
  }
}
