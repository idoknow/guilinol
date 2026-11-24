import * as THREE from 'three'
import { DEFAULT_DRINK_SKIN, resolveDrinkSkin, type DrinkSkinConfig } from '../props/skins.ts'

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
  readonly ceilingLampMat: THREE.MeshStandardMaterial
  readonly iceCrownMat: THREE.MeshStandardMaterial
  setNight(night: number): void
  dispose(): void
}

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

function drawCrownEmblem(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, primary: string, cream: string, gold: string): void {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.beginPath()
  ctx.arc(0, 0, r, 0, Math.PI * 2)
  ctx.fillStyle = cream
  ctx.fill()
  ctx.lineWidth = Math.max(3, r * 0.08)
  ctx.strokeStyle = gold
  ctx.stroke()

  ctx.fillStyle = primary
  ctx.beginPath()
  ctx.moveTo(-r * 0.48, r * 0.3)
  ctx.lineTo(-r * 0.52, -r * 0.25)
  ctx.lineTo(-r * 0.2, -r * 0.02)
  ctx.lineTo(0, -r * 0.44)
  ctx.lineTo(r * 0.2, -r * 0.02)
  ctx.lineTo(r * 0.52, -r * 0.25)
  ctx.lineTo(r * 0.48, r * 0.3)
  ctx.closePath()
  ctx.fill()

  ctx.fillStyle = gold
  ctx.beginPath()
  ctx.arc(0, -r * 0.56, r * 0.09, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function drawZoneSign(
  title: string,
  subtitle: string,
  accentHex: string,
  primaryHex: string,
): THREE.CanvasTexture | null {
  return makeCanvas(512, 128, (ctx, w, h) => {
    ctx.fillStyle = '#182029'
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = accentHex
    ctx.fillRect(0, 0, 18, h)
    ctx.strokeStyle = primaryHex
    ctx.lineWidth = 4
    ctx.strokeRect(4, 4, w - 8, h - 8)
    ctx.fillStyle = '#ffffff'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.font = 'bold 42px "PingFang SC", "Noto Sans SC", sans-serif'
    ctx.fillText(title, 38, 48)
    ctx.fillStyle = accentHex
    ctx.font = '600 22px "PingFang SC", "Noto Sans SC", sans-serif'
    ctx.fillText(subtitle, 38, 96)
  })
}

export function createDrinksShopMaterials(skinOverride?: Partial<DrinkSkinConfig>): DrinksShopMaterialPack {
  const skin = resolveDrinkSkin({ ...DEFAULT_DRINK_SKIN, brandLabel: '王城冰茶铺', ...skinOverride })
  const texs: THREE.Texture[] = []
  const mats: THREE.Material[] = []
  const litEntries: Array<{ mat: THREE.MeshStandardMaterial; base: number; nightBoost: number }> = []

  const ownTex = <T extends THREE.Texture | null>(t: T): T => {
    if (t) texs.push(t)
    return t
  }
  const std = (params: THREE.MeshStandardMaterialParameters, base = 0, nightBoost = 0): THREE.MeshStandardMaterial => {
    const m = new THREE.MeshStandardMaterial({
      roughness: 0.78,
      metalness: 0.05,
      emissive: params.color ?? 0xffe4c4,
      emissiveIntensity: base,
      ...params,
    })
    if (m.map && !m.emissiveMap) m.emissiveMap = m.map
    mats.push(m)
    litEntries.push({ mat: m, base, nightBoost })
    return m
  }

  // 主门头红白旗舰巨型招牌（高饱和正红 + 奶油边框 + 几何冰冠徽标）
  const fasciaTex = ownTex(
    makeCanvas(1024, 256, (ctx, w, h) => {
      ctx.fillStyle = skin.primaryHex
      ctx.fillRect(0, 0, w, h)
      ctx.strokeStyle = skin.creamHex
      ctx.lineWidth = 8
      ctx.strokeRect(14, 14, w - 28, h - 28)

      ctx.strokeStyle = 'rgba(255, 247, 238, 0.28)'
      ctx.lineWidth = 3
      for (const [sx, sy, sr] of [
        [92, 68, 22],
        [890, 68, 26],
        [930, 186, 18],
      ] as const) {
        for (let k = 0; k < 3; k++) {
          const a = (k * Math.PI) / 3
          ctx.beginPath()
          ctx.moveTo(sx - Math.cos(a) * sr, sy - Math.sin(a) * sr)
          ctx.lineTo(sx + Math.cos(a) * sr, sy + Math.sin(a) * sr)
          ctx.stroke()
        }
      }

      drawCrownEmblem(ctx, 136, h * 0.52, 64, skin.primaryHex, skin.creamHex, skin.goldHex)

      ctx.fillStyle = '#ffffff'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.font = 'bold 84px "PingFang SC", "Noto Sans SC", sans-serif'
      ctx.fillText(skin.brandLabel, 232, 102)

      ctx.fillStyle = skin.creamHex
      ctx.font = '600 26px "PingFang SC", "Noto Sans SC", sans-serif'
      ctx.fillText('GUILIN FRESH TEA · 鲜果茶 · 冰淇淋 · 现萃茗茶', 236, 186, w - 274)
    }),
  )

  // 转角竖向红色包柱看板（04/06/08 右侧转角竖柱造型）
  const pillarTex = ownTex(
    makeCanvas(256, 768, (ctx, w, h) => {
      ctx.fillStyle = skin.primaryHex
      ctx.fillRect(0, 0, w, h)
      ctx.strokeStyle = skin.creamHex
      ctx.lineWidth = 6
      ctx.strokeRect(12, 12, w - 24, h - 24)
      drawCrownEmblem(ctx, w * 0.5, 118, 52, skin.primaryHex, skin.creamHex, skin.goldHex)

      const chars = [...skin.brandLabel]
      ctx.fillStyle = '#ffffff'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = 'bold 82px "PingFang SC", "Noto Sans SC", sans-serif'
      chars.forEach((ch, idx) => {
        ctx.fillText(ch, w * 0.5, 250 + idx * 96)
      })
    }),
  )

  // 2F 转角竖柱圆角方形徽章（04/06 竖柱下段可见圆角白底方牌）
  const pillarBadgeTex = ownTex(
    makeCanvas(256, 256, (ctx, w, h) => {
      ctx.fillStyle = skin.creamHex
      ctx.fillRect(0, 0, w, h)
      ctx.strokeStyle = skin.primaryHex
      ctx.lineWidth = 10
      ctx.strokeRect(14, 14, w - 28, h - 28)
      drawCrownEmblem(ctx, w * 0.5, h * 0.44, 66, skin.primaryHex, '#ffffff', skin.goldHex)
      ctx.fillStyle = skin.primaryHex
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = 'bold 30px "PingFang SC", sans-serif'
      ctx.fillText('FRESH TEA', w * 0.5, h * 0.84)
    }),
  )

  // 顶部雪花纹理边带
  const snowStripTex = ownTex(
    makeCanvas(512, 128, (ctx, w, h) => {
      ctx.fillStyle = skin.primaryHex
      ctx.fillRect(0, 0, w, h)
      ctx.fillStyle = skin.creamHex
      ctx.fillRect(0, 0, w, 12)
      ctx.fillRect(0, h - 12, w, 12)
      ctx.strokeStyle = 'rgba(255, 247, 238, 0.36)'
      ctx.lineWidth = 3
      for (let x = 44; x < w; x += 84) {
        const y = h * 0.5
        for (let k = 0; k < 3; k++) {
          const a = (k * Math.PI) / 3
          ctx.beginPath()
          ctx.moveTo(x - Math.cos(a) * 20, y - Math.sin(a) * 20)
          ctx.lineTo(x + Math.cos(a) * 20, y + Math.sin(a) * 20)
          ctx.stroke()
        }
      }
    }),
  )

  // 王城·商厦 4F–6F 蓝灰黑框玻璃幕墙纹理（贴合 04/06/08 上部幕墙实拍语言）
  const upperCurtainTex = ownTex(
    makeCanvas(512, 256, (ctx, w, h) => {
      ctx.fillStyle = '#3f5368'
      ctx.fillRect(0, 0, w, h)
      // 玻璃反光斜向渐变高光
      const grad = ctx.createLinearGradient(0, 0, w, h)
      grad.addColorStop(0, 'rgba(195, 224, 244, 0.28)')
      grad.addColorStop(0.45, 'rgba(98, 129, 158, 0.08)')
      grad.addColorStop(1, 'rgba(210, 234, 248, 0.22)')
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, w, h)
      // 4F/5F 水平铝塑板层间梁带
      ctx.fillStyle = '#20262e'
      ctx.fillRect(0, h - 42, w, 42)
      ctx.fillStyle = '#525b66'
      ctx.fillRect(0, h - 38, w, 6)
      // 4 格竖向黑色玻璃分格竖梃
      ctx.fillStyle = '#1b2026'
      for (let x = 0; x <= w; x += 128) {
        ctx.fillRect(Math.max(0, x - 6), 0, 12, h)
      }
      ctx.fillRect(0, 0, w, 10)
    }),
  )
  if (upperCurtainTex) {
    upperCurtainTex.wrapS = THREE.RepeatWrapping
    upperCurtainTex.wrapT = THREE.RepeatWrapping
    upperCurtainTex.repeat.set(3, 2)
  }

  // 红白相间雨棚遮阳布纹理（正阳路沿街候选铺位）
  const awningTex = ownTex(
    makeCanvas(256, 64, (ctx, w, h) => {
      for (let x = 0; x < w; x += 32) {
        ctx.fillStyle = (x / 32) % 2 === 0 ? skin.primaryHex : skin.creamHex
        ctx.fillRect(x, 0, 32, h)
      }
    }),
  )

  // 前台与门前电子价目灯箱（与 sim/menu.ts 原创价目同步）
  const menuTex = ownTex(
    makeCanvas(512, 320, (ctx, w, h) => {
      ctx.fillStyle = '#1b2028'
      ctx.fillRect(0, 0, w, h)
      ctx.fillStyle = skin.primaryHex
      ctx.fillRect(0, 0, w, 58)
      ctx.fillStyle = '#ffffff'
      ctx.font = 'bold 28px "PingFang SC", sans-serif'
      ctx.textBaseline = 'middle'
      ctx.fillText(`${skin.brandLabel} · 招牌饮品`, 22, 30)

      const rows = [
        ['冰鲜柠檬水', '¥4', '招牌鲜果'],
        ['满杯百香果', '¥7', '爽口VC'],
        ['杨枝甘露', '¥9', '浓郁鲜芒'],
        ['珍珠奶茶', '¥7', '现煮茶底'],
        ['黑糖珍珠圣代', '¥6', '现打奶浆'],
        ['冰美式咖啡', '¥5', '鲜萃浓缩'],
      ]
      rows.forEach(([name, price, tag], idx) => {
        const y = 92 + idx * 36
        ctx.fillStyle = idx % 2 === 0 ? 'rgba(255,255,255,0.05)' : 'transparent'
        ctx.fillRect(14, y - 16, w - 28, 32)
        ctx.fillStyle = '#f8f2e6'
        ctx.font = 'bold 21px "PingFang SC", sans-serif'
        ctx.textAlign = 'left'
        ctx.fillText(name, 22, y)
        ctx.fillStyle = '#a7b5c4'
        ctx.font = '16px "PingFang SC", sans-serif'
        ctx.fillText(tag, 250, y)
        ctx.fillStyle = skin.goldHex
        ctx.font = 'bold 22px "PingFang SC", sans-serif'
        ctx.textAlign = 'right'
        ctx.fillText(price, w - 22, y)
      })
    }),
  )

  // 取餐叫号屏幕
  const callTex = ownTex(
    makeCanvas(512, 160, (ctx, w, h) => {
      ctx.fillStyle = '#141a22'
      ctx.fillRect(0, 0, w, h)
      ctx.fillStyle = skin.primaryHex
      ctx.fillRect(0, 0, 156, h)
      ctx.fillStyle = '#ffffff'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = 'bold 34px "PingFang SC", sans-serif'
      ctx.fillText('取餐叫号', 78, h * 0.5)
      ctx.fillStyle = skin.goldHex
      ctx.font = 'bold 42px monospace'
      ctx.fillText('请 A008 取餐', 334, 62)
      ctx.fillStyle = '#d3dde6'
      ctx.font = '21px "PingFang SC", sans-serif'
      ctx.fillText('制作中：A009 · A010 · A011', 334, 120)
    }),
  )

  // 前台吧台正面高亮分区标牌（「收银点单台 ORDER | 取餐处 PICKUP」）
  const counterOrderTex = ownTex(
    makeCanvas(1024, 128, (ctx, w, h) => {
      const splitX = Math.round(w * 0.54)
      ctx.fillStyle = skin.primaryHex
      ctx.fillRect(0, 0, splitX, h)
      ctx.fillStyle = '#1a2330'
      ctx.fillRect(splitX, 0, w - splitX, h)
      ctx.fillStyle = skin.goldHex
      ctx.fillRect(splitX - 5, 0, 10, h)
      ctx.strokeStyle = skin.creamHex
      ctx.lineWidth = 4
      ctx.strokeRect(4, 4, w - 8, h - 8)

      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = '#ffffff'
      ctx.font = 'bold 34px "PingFang SC", "Noto Sans SC", sans-serif'
      ctx.fillText('◀  收银点单台 · ORDER', splitX * 0.5, h * 0.52, splitX - 64)

      ctx.fillStyle = skin.goldHex
      ctx.fillText('取餐处 · PICKUP  ▶', splitX + (w - splitX) * 0.5, h * 0.52, w - splitX - 64)
    }),
  )

  // 后场三区操作指引标牌
  const prepFruitTex = ownTex(drawZoneSign('鲜果碎冰区', 'FRESH FRUIT & CRUSHED ICE', '#ffd058', skin.primaryHex))
  const prepTeaTex = ownTex(drawZoneSign('萃茶摇茶 · 封口区', 'TEA SHAKER & SEALER', '#7ee8c6', skin.primaryHex))
  const prepCreamTex = ownTex(drawZoneSign('冰淇淋 · 奶浆区', 'SOFT SERVE & TOPPINGS', '#ffb8a0', skin.primaryHex))

  // 室内地砖 0.6m 浅暖砖格纹理
  const floorTex = ownTex(
    makeCanvas(256, 256, (ctx, w, h) => {
      ctx.fillStyle = '#ede7db'
      ctx.fillRect(0, 0, w, h)
      ctx.strokeStyle = 'rgba(130, 118, 98, 0.24)'
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
    floorTex.repeat.set(4.5, 3)
  }

  // 正阳路实拍深灰大块石材铺地砖纹（贴合 08_IMG_1397 前景地坪）
  const sidewalkTex = ownTex(
    makeCanvas(256, 256, (ctx, w, h) => {
      ctx.fillStyle = '#82847f'
      ctx.fillRect(0, 0, w, h)
      ctx.strokeStyle = 'rgba(54, 56, 52, 0.32)'
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
    sidewalkTex.repeat.set(6, 2)
  }

  // 黑黄路缘警示条纹（08_IMG_1397 实拍路缘石）
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
    curbTex.repeat.set(6, 1)
  }

  const blindTex = ownTex(
    makeCanvas(256, 64, (ctx, w, h) => {
      ctx.fillStyle = '#d8b740'
      ctx.fillRect(0, 0, w, h)
      ctx.fillStyle = '#c4a22c'
      for (let x = 8; x < w; x += 24) ctx.fillRect(x, 8, 12, h - 16)
    }),
  )

  const roofMat = std({ color: '#e6e1d8', roughness: 0.86, emissive: '#645e56' }, 0.02, 0.14)
  const wallCreamMat = std({ color: '#f6f2ea', roughness: 0.82, emissive: '#fff2de' }, 0.04, 0.34)
  const wainscotWoodMat = std({ color: '#d7be98', roughness: 0.72, emissive: '#e5cc9e' }, 0.03, 0.25)
  const floorTileMat = std({ ...(floorTex ? { map: floorTex } : {}), color: 0xffffff, roughness: 0.72, emissive: '#fff4df' }, 0.03, 0.28)
  const sidewalkMat = std({ ...(sidewalkTex ? { map: sidewalkTex } : {}), color: 0xffffff, roughness: 0.9, emissive: '#585752' }, 0, 0.1)
  const tactilePathMat = std({ ...(blindTex ? { map: blindTex } : {}), color: 0xffffff, roughness: 0.88, emissive: '#c8a62a' }, 0, 0.12)
  const curbStripeMat = std({ ...(curbTex ? { map: curbTex } : {}), color: 0xffffff, roughness: 0.85, emissive: '#5a5020' }, 0, 0.1)
  const podiumRedMat = std({ color: skin.primaryHex, roughness: 0.56, emissive: skin.primaryHex }, 0.1, 0.42)
  const podiumTrimCreamMat = std({ color: skin.creamHex, roughness: 0.62, emissive: '#fff3de' }, 0.08, 0.38)
  const curtainMullionMat = std({ color: '#242930', roughness: 0.45, metalness: 0.35, emissive: '#1e2228' }, 0, 0.1)
  const curtainGlassMat = std({ color: '#dff1f7', roughness: 0.1, metalness: 0.08, transparent: true, opacity: 0.16, emissive: '#ffefd4' }, 0.02, 0.12)
  const upperCurtainMat = std({ ...(upperCurtainTex ? { map: upperCurtainTex } : {}), color: 0xffffff, roughness: 0.28, metalness: 0.35, emissive: '#35485b' }, 0.05, 0.22)
  const doorGlassMat = std({ color: '#c4e3ee', roughness: 0.12, metalness: 0.08, transparent: true, opacity: 0.26, emissive: '#ffe9cb' }, 0.03, 0.16)
  const awningStripeMat = std({ ...(awningTex ? { map: awningTex } : {}), color: 0xffffff, roughness: 0.72, emissive: '#fff0dc' }, 0.04, 0.28)
  const counterBodyMat = std({ color: '#f5efe3', roughness: 0.68, emissive: '#ffeed9' }, 0.04, 0.3)
  const counterTopMat = std({ color: '#ffffff', roughness: 0.36, emissive: '#fff9ef' }, 0.05, 0.34)
  const stainlessMat = std({ color: '#b7c0c7', roughness: 0.32, metalness: 0.55, emissive: '#8f98a0' }, 0.02, 0.22)
  const darkEquipmentMat = std({ color: '#272d36', roughness: 0.55, metalness: 0.18, emissive: '#343c47' }, 0.02, 0.18)
  const goldAccentMat = std({ color: skin.goldHex, roughness: 0.35, metalness: 0.3, emissive: skin.goldHex }, 0.08, 0.45)
  const woodTableMat = std({ color: '#f6f1e6', roughness: 0.58, emissive: '#ffeeda' }, 0.03, 0.28)
  const chairIndoorMat = std({ color: '#d4be9f', roughness: 0.72, emissive: '#e8d2b2' }, 0.03, 0.25)
  const chairPatioMat = std({ color: '#db6e54', roughness: 0.72, emissive: '#eb8066' }, 0.02, 0.22)
  const parasolRedMat = std({ color: skin.primaryHex, roughness: 0.75, side: THREE.DoubleSide, emissive: skin.primaryHex }, 0.04, 0.25)
  const crateMat = std({ color: '#b8844c', roughness: 0.85, emissive: '#8e6437' }, 0.02, 0.18)

  const fasciaSignMat = std({ ...(fasciaTex ? { map: fasciaTex } : {}), color: 0xffffff, roughness: 0.42, emissive: 0xffffff }, 0.32, 0.95)
  const verticalPillarMat = std({ ...(pillarTex ? { map: pillarTex } : {}), color: 0xffffff, roughness: 0.44, emissive: 0xffffff }, 0.3, 0.92)
  const pillarBadgeMat = std({ ...(pillarBadgeTex ? { map: pillarBadgeTex } : {}), color: 0xffffff, roughness: 0.38, emissive: 0xffffff }, 0.24, 0.78)
  const snowflakeStripMat = std({ ...(snowStripTex ? { map: snowStripTex } : {}), color: 0xffffff, roughness: 0.52, emissive: 0xffffff }, 0.18, 0.65)
  const menuBoardMat = std({ ...(menuTex ? { map: menuTex } : {}), color: 0xffffff, roughness: 0.35, emissive: 0xffffff }, 0.45, 0.88)
  const callScreenMat = std({ ...(callTex ? { map: callTex } : {}), color: 0xffffff, roughness: 0.32, emissive: 0xffffff }, 0.5, 0.9)
  const counterOrderSignMat = std({ ...(counterOrderTex ? { map: counterOrderTex } : {}), color: 0xffffff, roughness: 0.36, emissive: 0xffffff }, 0.34, 0.86)
  const prepZoneFruitMat = std({ ...(prepFruitTex ? { map: prepFruitTex } : {}), color: 0xffffff, roughness: 0.35, emissive: 0xffffff }, 0.35, 0.86)
  const prepZoneTeaMat = std({ ...(prepTeaTex ? { map: prepTeaTex } : {}), color: 0xffffff, roughness: 0.35, emissive: 0xffffff }, 0.35, 0.86)
  const prepZoneCreamMat = std({ ...(prepCreamTex ? { map: prepCreamTex } : {}), color: 0xffffff, roughness: 0.35, emissive: 0xffffff }, 0.35, 0.86)
  const ceilingLampMat = std({ color: '#fff8e8', roughness: 0.25, emissive: '#ffefc8' }, 0.62, 0.95)
  const iceCrownMat = std({ color: '#ffffff', roughness: 0.38, emissive: '#fff5e4' }, 0.1, 0.42)

  return {
    skin,
    roofMat,
    wallCreamMat,
    wainscotWoodMat,
    floorTileMat,
    sidewalkMat,
    tactilePathMat,
    curbStripeMat,
    podiumRedMat,
    podiumTrimCreamMat,
    curtainMullionMat,
    curtainGlassMat,
    upperCurtainMat,
    doorGlassMat,
    awningStripeMat,
    counterBodyMat,
    counterTopMat,
    stainlessMat,
    darkEquipmentMat,
    goldAccentMat,
    woodTableMat,
    chairIndoorMat,
    chairPatioMat,
    parasolRedMat,
    crateMat,
    fasciaSignMat,
    verticalPillarMat,
    pillarBadgeMat,
    snowflakeStripMat,
    menuBoardMat,
    callScreenMat,
    counterOrderSignMat,
    prepZoneFruitMat,
    prepZoneTeaMat,
    prepZoneCreamMat,
    ceilingLampMat,
    iceCrownMat,

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
