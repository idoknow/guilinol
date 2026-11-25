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
  curtainPlain: [0.0, 0.0, 0.48, 0.84] as AtlasRect,
  curvedCornerFloors: [0.48, 0.0, 0.78, 1.0] as AtlasRect,
  // 宽幅横招 [0..0.48, 0.84..1.0] -> 492x164 (3.0:1) 匹配屋顶「GD 王城·商厦」宽横牌
  rooftopKingBanner: [0.0, 0.84, 0.48, 1.0] as AtlasRect,
  // 东侧突翼 [0.78..1.0, 0.52..0.98] -> 225x471，高清晰不糊字
  supermarketRiser: [0.78, 0.52, 1.0, 0.98] as AtlasRect,
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

  // ─── 1. 外立面招牌图集 (`exteriorSignAtlas` 2048x1024 + 分级夜景发光遮罩 -> 1 次合批) ───
  const drawExteriorCanvas = (ctx: CanvasRenderingContext2D, w: number, h: number, isEmissive: boolean) => {
    const bgRed = isEmissive ? '#4c0208' : '#cc0c1b'
    const bannerRed = isEmissive ? '#820510' : MIXUE_RED
    const inkWhite = '#ffffff'

    ctx.fillStyle = bgRed
    ctx.fillRect(0, 0, w, h)

    // A [0..0.16, 0..1.0]: 转角竖排红柱「蜜 雪 冰 城」（328x1024 -> 比例 1:3.12 零压扁）
    const colW = Math.round(w * 0.16)
    ctx.fillStyle = bgRed
    ctx.fillRect(0, 0, colW, h)
    ctx.strokeStyle = inkWhite
    ctx.lineWidth = isEmissive ? 10 : 8
    ctx.strokeRect(10, 12, colW - 20, h - 24)
    drawSnowflake(ctx, colW * 0.5, 76, 32, inkWhite, isEmissive ? 1.0 : 0.9)
    drawSnowflake(ctx, colW * 0.5, h - 68, 28, inkWhite, isEmissive ? 1.0 : 0.85)
    ctx.fillStyle = inkWhite
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = 'bold 156px "PingFang SC", "Noto Sans SC", sans-serif'
    ;['蜜', '雪', '冰', '城'].forEach((ch, idx) => ctx.fillText(ch, colW * 0.5, 226 + idx * 204))

    // B [0.16..1.0, 0..0.38]: 主巨幅正红横招（1720x389 -> 4.42:1；严格对标桂林王城红墙大字+圆形雪王）
    const bx0 = colW
    const bw = w - colW
    const bh = Math.round(h * 0.38)
    ctx.fillStyle = bgRed
    ctx.fillRect(bx0, 0, bw, bh)
    if (!isEmissive) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)'
      ctx.lineWidth = 4
      for (let gx = bx0 + 280; gx < w; gx += 286) {
        ctx.beginPath()
        ctx.moveTo(gx, 0)
        ctx.lineTo(gx, bh)
        ctx.stroke()
      }
    }
    ctx.strokeStyle = inkWhite
    ctx.lineWidth = isEmissive ? 10 : 8
    ctx.strokeRect(bx0 + 12, 12, bw - 24, bh - 24)
    for (const [sx, sy, sr] of [
      [bx0 + 68, 56, 22],
      [w - 72, 58, 24],
      [w - 130, 312, 20],
      [bx0 + 78, 326, 18],
    ] as const) {
      drawSnowflake(ctx, sx, sy, sr, inkWhite, isEmissive ? 1.0 : 0.9)
    }
    drawSnowKingAvatar(ctx, bx0 + 245, bh * 0.5, 118, !isEmissive)
    ctx.fillStyle = inkWhite
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.font = 'bold 172px "PingFang SC", "Noto Sans SC", sans-serif'
    ctx.fillText('蜜雪冰城', bx0 + 425, 152)
    ctx.fillStyle = isEmissive ? '#ffeed8' : '#fff5ea'
    ctx.font = 'bold 50px "PingFang SC", sans-serif'
    ctx.fillText('MIXUE · SINCE 1997 · ICE CREAM & TEA', bx0 + 432, 294)

    // C [0.16..0.44, 0.38..0.94]: 1:1 正方雪王品牌方牌（573x573）
    const cx0 = colW
    const cy0 = bh
    const cw = Math.round(w * 0.28)
    const ch = Math.round(h * 0.56)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(cx0, cy0, cw, ch)
    ctx.strokeStyle = isEmissive ? '#ff3a4c' : MIXUE_RED
    ctx.lineWidth = 14
    ctx.strokeRect(cx0 + 16, cy0 + 16, cw - 32, ch - 32)
    drawSnowKingAvatar(ctx, cx0 + cw * 0.5, cy0 + ch * 0.42, 138, true)
    ctx.fillStyle = isEmissive ? '#ff293c' : MIXUE_RED
    ctx.textAlign = 'center'
    ctx.font = 'bold 56px "PingFang SC", sans-serif'
    ctx.fillText('MIXUE · 雪王驾到', cx0 + cw * 0.5, cy0 + ch * 0.84)

    // D [0.44..1.0, 0.38..0.62]: 1F 深挑雨棚门头横幅灯箱（1147x246 -> 4.66:1，对标 ref-22/29 桂林旗舰店）
    const dx0 = cx0 + cw
    const dw = w - dx0
    const dh = Math.round(h * 0.24)
    ctx.fillStyle = bannerRed
    ctx.fillRect(dx0, cy0, dw, dh)
    ctx.strokeStyle = inkWhite
    ctx.lineWidth = 8
    ctx.strokeRect(dx0 + 10, cy0 + 10, dw - 20, dh - 20)
    drawSnowKingAvatar(ctx, dx0 + 114, cy0 + dh * 0.5, 68, true)
    ctx.textAlign = 'left'
    ctx.fillStyle = inkWhite
    ctx.font = 'bold 78px "PingFang SC", "Noto Sans SC", sans-serif'
    ctx.fillText(`蜜雪冰城 · ${skin.subLabel}`, dx0 + 206, cy0 + dh * 0.4, dw - 235)
    ctx.fillStyle = isEmissive ? '#ffe07d' : MIXUE_GOLD
    ctx.font = 'bold 34px "PingFang SC", sans-serif'
    ctx.fillText('MIXUE SINCE 1997 · 1F 饮品区 24H · 冰鲜柠檬水 ¥4', dx0 + 208, cy0 + dh * 0.78, dw - 235)

    // E [0.44..0.72, 0.62..1.0]: 高对比巨字极简热销海报（远景也能一眼辨识 `雪王热销 / ¥4 / ¥2`，绝非细碎密集字块）
    const ey0 = cy0 + dh
    const ew = Math.round(w * 0.28)
    const eh = h - ey0
    ctx.fillStyle = isEmissive ? '#5e5e5e' : '#ffffff'
    ctx.fillRect(dx0, ey0, ew, eh)
    ctx.strokeStyle = isEmissive ? '#ff293c' : MIXUE_RED
    ctx.lineWidth = 12
    ctx.strokeRect(dx0 + 10, ey0 + 10, ew - 20, eh - 20)
    ctx.fillStyle = bannerRed
    ctx.fillRect(dx0 + 18, ey0 + 18, ew - 36, 98)
    ctx.fillStyle = inkWhite
    ctx.textAlign = 'center'
    ctx.font = 'bold 62px "PingFang SC", sans-serif'
    ctx.fillText('雪王热销', dx0 + ew * 0.5, ey0 + 68)
    ctx.fillStyle = isEmissive ? '#d81b28' : '#b91c1c'
    ctx.font = 'bold 74px "PingFang SC", sans-serif'
    ctx.fillText('¥4 柠檬水', dx0 + ew * 0.5, ey0 + 186)
    ctx.fillStyle = isEmissive ? '#111827' : '#1e293b'
    ctx.font = 'bold 66px "PingFang SC", sans-serif'
    ctx.fillText('¥2 冰淇淋', dx0 + ew * 0.5, ey0 + 298)

    // F [0.72..1.0, 0.62..1.0]: 「始于1997」红底白字复古方牌
    const fx0 = dx0 + ew
    const fw = w - fx0
    ctx.fillStyle = bannerRed
    ctx.fillRect(fx0, ey0, fw, eh)
    ctx.strokeStyle = MIXUE_CREAM
    ctx.lineWidth = 8
    ctx.strokeRect(fx0 + 14, ey0 + 14, fw - 28, eh - 28)
    ctx.fillStyle = inkWhite
    ctx.font = 'bold 74px "PingFang SC", sans-serif'
    ctx.fillText('始于 1997', fx0 + fw * 0.5, ey0 + 110)
    ctx.fillStyle = isEmissive ? '#ffe07d' : MIXUE_GOLD
    ctx.font = 'bold 36px "PingFang SC", sans-serif'
    ctx.fillText('高质平价 · 现制饮品', fx0 + fw * 0.5, ey0 + 188)
    drawSnowKingAvatar(ctx, fx0 + fw * 0.5, ey0 + 298, 56, true)
  }

  const exteriorAtlasTex = ownTex(makeCanvas(2048, 1024, (ctx, w, h) => drawExteriorCanvas(ctx, w, h, false)))
  const exteriorEmissiveTex = ownTex(makeCanvas(2048, 1024, (ctx, w, h) => drawExteriorCanvas(ctx, w, h, true)))

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

      // 前吧台左点单灯带 [0.67..1.0, 0.38..0.53] (对标 ref-33 跌级「点餐」红横带)
      const px0 = mx0 + mw
      const pw = w - px0
      const pHalfH = Math.round(ch * 0.5)
      ctx.fillStyle = MIXUE_RED
      ctx.fillRect(px0, cy0, pw, pHalfH)
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 5
      ctx.strokeRect(px0 + 8, cy0 + 8, pw - 16, pHalfH - 16)
      ctx.fillStyle = '#ffffff'
      ctx.textAlign = 'center'
      ctx.font = 'bold 62px "PingFang SC", sans-serif'
      ctx.fillText('点餐 · ORDER', px0 + pw * 0.5, cy0 + pHalfH * 0.46, pw - 40)
      ctx.fillStyle = MIXUE_GOLD
      ctx.font = 'bold 24px "PingFang SC", sans-serif'
      ctx.fillText('扫码点单 · 现制饮品 ¥2 起', px0 + pw * 0.5, cy0 + pHalfH * 0.82, pw - 40)

      // 前吧台右取餐灯带 [0.67..1.0, 0.53..0.68]
      const p2y = cy0 + pHalfH
      ctx.fillStyle = MIXUE_RED
      ctx.fillRect(px0, p2y, pw, ch - pHalfH)
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 5
      ctx.strokeRect(px0 + 8, p2y + 8, pw - 16, ch - pHalfH - 16)
      ctx.fillStyle = '#ffffff'
      ctx.font = 'bold 58px "PingFang SC", sans-serif'
      ctx.fillText('取餐 · PICKUP', px0 + pw * 0.5, p2y + pHalfH * 0.46, pw - 40)
      ctx.fillStyle = MIXUE_GOLD
      ctx.font = 'bold 24px "PingFang SC", sans-serif'
      ctx.fillText('凭号取杯 · 冰鲜柠檬水 ¥4', px0 + pw * 0.5, p2y + pHalfH * 0.82, pw - 40)

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

      // 室内侧墙浅奶油规范公示牌 [0.5..1.0, 0.85..1.0]（白底细红框，彻底消除隔窗遥望时的纯红矩形块感）
      const sx0 = Math.round(w * 0.5)
      ctx.fillStyle = '#fff9f5'
      ctx.fillRect(sx0, py0, w - sx0, ph)
      ctx.strokeStyle = MIXUE_RED
      ctx.lineWidth = 10
      ctx.strokeRect(sx0 + 8, py0 + 8, w - sx0 - 16, ph - 16)
      ctx.fillStyle = MIXUE_RED
      ctx.textAlign = 'left'
      ctx.font = 'bold 48px "PingFang SC", sans-serif'
      ctx.fillText('我在蜜雪等着你 · 食品经营规范公示', sx0 + 36, py0 + ph * 0.36, w - sx0 - 60)
      ctx.fillStyle = '#334155'
      ctx.font = 'bold 28px "PingFang SC", sans-serif'
      ctx.fillText('现切鲜果 · 净水制冰 · 营业执照 / 健康证 / SOP', sx0 + 36, py0 + ph * 0.74, w - sx0 - 60)
    }),
  )
  // 室内灯箱专用平衡发光遮罩：保留干净纯白底的同时压制自发光，保证中右菜单屏小字高对比不发虚
  const interiorEmissiveTex = ownTex(
    makeCanvas(1024, 512, (ctx, w, h) => {
      ctx.fillStyle = '#5a5a5a'
      ctx.fillRect(0, 0, w, h)
      const menuH = Math.round(h * 0.38)
      const panelW = w / 4
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = '#e03546'
        ctx.fillRect(i * panelW + 4, 4, panelW - 8, 34)
      }
      ctx.fillStyle = '#e03546'
      ctx.fillRect(0, menuH, Math.round(w * 0.52), 32)
      ctx.fillStyle = '#ef3c4d'
      ctx.fillRect(Math.round(w * 0.67), menuH, Math.round(w * 0.33), Math.round(h * 0.3))
      ctx.fillStyle = '#cf2a3a'
      ctx.fillRect(Math.round(w * 0.5), Math.round(h * 0.85), Math.round(w * 0.5), Math.round(h * 0.15))
    }),
  )

  // ─── 3. 王城·商厦 1-8F 玻璃幕墙与真实转角店招图集 (`mallFacade` 1024x1024 + 夜间分窗发光贴图) ───
  const drawMallCanvas = (ctx: CanvasRenderingContext2D, w: number, h: number, isEmissive: boolean) => {
    // [0..0.48, 0..0.84]: 深灰黑框蓝灰玻璃幕墙（夜间暗蓝玻璃仅亮少数办公窗）
    const leftW = Math.round(w * 0.48)
    const upperCurtH = Math.round(h * 0.84)
    ctx.fillStyle = isEmissive ? '#080e16' : '#314355'
    ctx.fillRect(0, 0, leftW, upperCurtH)
    if (!isEmissive) {
      const grad = ctx.createLinearGradient(0, 0, leftW, upperCurtH)
      grad.addColorStop(0, 'rgba(186, 218, 240, 0.24)')
      grad.addColorStop(0.5, 'rgba(65, 90, 114, 0.08)')
      grad.addColorStop(1, 'rgba(205, 229, 245, 0.2)')
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, leftW, upperCurtH)
    } else {
      // 零星夜间亮灯写字楼窗格
      ctx.fillStyle = '#6b5732'
      for (const [wx, wy] of [
        [28, 84],
        [270, 290],
        [145, 510],
        [390, 490],
      ] as const) {
        ctx.fillRect(wx, wy, Math.round(leftW / 4) - 18, 95)
      }
    }
    for (let row = 0; row < 4; row++) {
      const yBase = Math.round((row * upperCurtH) / 4)
      ctx.fillStyle = isEmissive ? '#04060a' : '#1d242c'
      ctx.fillRect(0, yBase, leftW, 12)
      ctx.fillStyle = isEmissive ? '#05070c' : '#242c36'
      ctx.fillRect(0, yBase + Math.round(upperCurtH / 4) - 42, leftW, 42)
    }
    ctx.fillStyle = isEmissive ? '#04060a' : '#1a2026'
    for (let x = 0; x <= leftW; x += Math.round(leftW / 4)) {
      ctx.fillRect(Math.max(0, x - 5), 0, 10, upperCurtH)
    }

    // [0..0.48, 0.84..1.0]: 屋顶宽幅横牌「GD 王城·商厦」（492x164 -> 3.0:1，对齐实拍 #030）
    const ry0 = upperCurtH
    const rh = h - ry0
    ctx.fillStyle = isEmissive ? '#3a0409' : '#1b2028'
    ctx.fillRect(0, ry0, leftW, rh)
    ctx.fillStyle = isEmissive ? '#f22436' : MIXUE_RED
    ctx.fillRect(8, ry0 + 12, leftW - 16, rh - 24)
    ctx.fillStyle = '#ffffff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = 'bold 64px "PingFang SC", sans-serif'
    ctx.fillText('GD · 王城·商厦', leftW * 0.5, ry0 + rh * 0.5, leftW - 36)

    // [0.48..0.78, 0..1]: 王城·商厦 8 格弧角 1–8F 幕墙与转角招牌
    const cx0 = leftW
    const cw = Math.round(w * 0.3)
    ctx.fillStyle = isEmissive ? '#091019' : '#35485b'
    ctx.fillRect(cx0, 0, cw, h)
    const rowH = h / 8
    for (let f = 0; f < 8; f++) {
      const fy = Math.round(f * rowH)
      ctx.fillStyle = isEmissive ? (f === 7 ? '#4a351e' : '#080e16') : f >= 6 ? '#3a4f62' : '#2f4152'
      ctx.fillRect(cx0, fy, cw, rowH)
      ctx.fillStyle = isEmissive ? '#04060a' : '#1c222a'
      ctx.fillRect(cx0, fy, cw, 10)
      ctx.fillRect(cx0, fy + rowH - 24, cw, 24)
    }
    ctx.fillStyle = isEmissive ? '#04060a' : '#171c22'
    for (let k = 0; k <= 4; k++) {
      ctx.fillRect(cx0 + Math.round((k * cw) / 4) - 4, 0, 8, h)
    }
    // 2F 转角暗调玻璃底衬（由 mesh.ts 前方实心 3D 展示台架+立体迷你雪王+外层透明玻璃呈现真实 3D 橱窗纵深！）
    ctx.fillStyle = isEmissive ? '#080e16' : '#0f1a24'
    ctx.fillRect(cx0 + 12, Math.round(6 * rowH + 14), cw - 24, rowH - 42)
    ctx.fillStyle = isEmissive ? '#241b12' : '#1b2836'
    ctx.fillRect(cx0 + 18, Math.round(6 * rowH + 20), cw - 36, rowH - 54)
    // 3F KING'S PLAZA + 王城·商厦
    ctx.fillStyle = '#ffffff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = 'bold 32px "PingFang SC", sans-serif'
    ctx.fillText('王城·商厦', cx0 + cw * 0.5, 5 * rowH + 44, cw - 24)
    ctx.font = 'bold 17px sans-serif'
    ctx.fillText("KING'S PLAZA", cx0 + cw * 0.5, 5 * rowH + 88, cw - 24)
    // 4F 王城电脑城 5/6楼
    ctx.fillStyle = '#facc15'
    ctx.font = 'bold 26px "PingFang SC", sans-serif'
    ctx.fillText('王城电脑城', cx0 + cw * 0.5, 4 * rowH + 44, cw - 24)
    ctx.font = 'bold 18px "PingFang SC", sans-serif'
    ctx.fillText('5 / 6 楼', cx0 + cw * 0.5, 4 * rowH + 86, cw - 24)
    // 5F 飞扬美学
    ctx.fillStyle = '#f8fafc'
    ctx.font = 'bold 26px "PingFang SC", sans-serif'
    ctx.fillText('飞扬美学', cx0 + cw * 0.5, 3 * rowH + 54, cw - 24)
    // 6F DJI 大疆
    ctx.fillStyle = '#e2e8f0'
    ctx.font = 'bold 26px "PingFang SC", sans-serif'
    ctx.fillText('DJI 大疆', cx0 + cw * 0.5, 2 * rowH + 54, cw - 24)

    // [0.78..1.0, 0.52..0.98]: 东翼「王城超市 / M 麦当劳」高对比不饱和蓝底白字大招牌
    const rx0 = cx0 + cw
    const rw = w - rx0
    ctx.fillStyle = isEmissive ? '#080d14' : '#1e242d'
    ctx.fillRect(rx0, 0, rw, Math.round(h * 0.52))
    const sy0 = Math.round(h * 0.52)
    const sh = Math.round(h * 0.46)
    ctx.fillStyle = isEmissive ? '#0e2868' : '#14388c'
    ctx.fillRect(rx0, sy0, rw, sh)
    ctx.strokeStyle = isEmissive ? '#cbd5e1' : '#ffffff'
    ctx.lineWidth = 6
    ctx.strokeRect(rx0 + 10, sy0 + 10, rw - 20, sh - 20)
    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 54px "PingFang SC", sans-serif'
    ctx.fillText('王城', rx0 + rw * 0.5, sy0 + sh * 0.28, rw - 30)
    ctx.fillText('超市', rx0 + rw * 0.5, sy0 + sh * 0.54, rw - 30)
    ctx.fillStyle = '#facc15'
    ctx.font = 'bold 34px "PingFang SC", sans-serif'
    ctx.fillText('麦当劳 M', rx0 + rw * 0.5, sy0 + sh * 0.8, rw - 28)
  }

  const mallTex = ownTex(makeCanvas(1024, 1024, (ctx, w, h) => drawMallCanvas(ctx, w, h, false)))
  const mallEmissiveTex = ownTex(makeCanvas(1024, 1024, (ctx, w, h) => drawMallCanvas(ctx, w, h, true)))

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

  const roofMat = std({ color: '#f2ede4', roughness: 0.9, emissive: '#fff4e2' }, 0.24, 0.34)
  const wallCreamMat = std({ ...(wallTileTex ? { map: wallTileTex } : {}), color: 0xffffff, roughness: 0.42, emissive: '#fff4e4' }, 0.08, 0.44)
  const wainscotWoodMat = std({ color: '#d8bc93', roughness: 0.65, emissive: '#e6c99b' }, 0.03, 0.28)
  const floorTileMat = std({ ...(floorTex ? { map: floorTex } : {}), color: 0xffffff, roughness: 0.64, emissive: '#fff2db' }, 0.06, 0.4)
  const sidewalkMat = std({ ...(sidewalkTex ? { map: sidewalkTex } : {}), color: 0xffffff, roughness: 0.9, emissive: '#282b30' }, 0.0, 0.05)
  const curbStripeMat = std({ ...(curbTex ? { map: curbTex } : {}), color: 0xffffff, roughness: 0.85, emissive: '#3a3314' }, 0.0, 0.06)
  // 夜间红色铝塑板饱和深正红受光泛红（emissive=#900611，夜间不过曝粉白）
  const podiumRedMat = std({ color: '#d40d1d', roughness: 0.42, emissive: '#900611' }, 0.06, 0.58)
  const podiumTrimCreamMat = std({ color: MIXUE_CREAM, roughness: 0.44, emissive: '#fff3e2' }, 0.08, 0.42)
  const curtainMullionMat = std({ color: '#1b2027', roughness: 0.42, metalness: 0.38, emissive: '#10141a' }, 0, 0.04)
  const curtainGlassMat = std({ color: '#dff1f7', roughness: 0.08, metalness: 0.08, transparent: true, opacity: 0.16, emissive: '#ffdfba' }, 0.03, 0.22)
  const counterTopMat = std({ color: '#f3f5f7', roughness: 0.32, emissive: '#fff8ec' }, 0.06, 0.38)
  const stainlessMat = std({ color: '#c1c9d0', roughness: 0.28, metalness: 0.62, emissive: '#8f98a0' }, 0.03, 0.24)
  const darkEquipmentMat = std({ color: '#242a33', roughness: 0.52, metalness: 0.2, emissive: '#2b323c' }, 0.02, 0.14)
  const goldAccentMat = std({ color: MIXUE_GOLD, roughness: 0.34, metalness: 0.32, emissive: MIXUE_GOLD }, 0.08, 0.46)
  const chairPatioMat = std({ color: MIXUE_ORANGE, roughness: 0.62, emissive: MIXUE_ORANGE }, 0.04, 0.22)
  const crateMat = std({ color: '#c4834b', roughness: 0.82, emissive: '#8e5e32' }, 0.02, 0.16)
  const awningStripeMat = std({ ...(awningTex ? { map: awningTex } : {}), color: 0xffffff, roughness: 0.72, emissive: '#fff0dc' }, 0.04, 0.28)
  const ceilingLampMat = std({ color: '#fffef9', roughness: 0.16, emissive: '#fff1cc' }, 0.86, 1.55)
  // 压低夜间白模自发光，靠真实顶灯/漫反射呈现清晰头部、腕间与肚皮立体光影（告别夜间平白）
  const iceCrownMat = std({ color: '#ffffff', roughness: 0.38, metalness: 0.04, emissive: '#fff4e6' }, 0.03, 0.1)

  // 分级自发光：室外白字雪花灯箱夜间强自发光（海报浅底压控防过曝）、室内菜单屏兼顾清晰字迹对比
  const exteriorSignAtlasMat = std(
    {
      ...(exteriorAtlasTex ? { map: exteriorAtlasTex } : {}),
      ...(exteriorEmissiveTex ? { emissiveMap: exteriorEmissiveTex } : {}),
      color: 0xffffff,
      roughness: 0.36,
      emissive: 0xffffff,
    },
    0.16,
    0.96,
  )
  const interiorSignAtlasMat = std(
    {
      ...(interiorAtlasTex ? { map: interiorAtlasTex } : {}),
      ...(interiorEmissiveTex ? { emissiveMap: interiorEmissiveTex } : {}),
      color: 0xffffff,
      roughness: 0.32,
      emissive: 0xffffff,
    },
    0.34,
    0.58,
  )
  const mallFacadeMat = std(
    {
      ...(mallTex ? { map: mallTex } : {}),
      ...(mallEmissiveTex ? { emissiveMap: mallEmissiveTex } : {}),
      color: 0xffffff,
      roughness: 0.26,
      metalness: 0.34,
      emissive: 0xffffff,
    },
    0.08,
    0.96,
  )

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
