import layoutJson from './xiaoxianggang-b1.layout.json' with { type: 'json' }
import {
  XXG_PORTALS,
  validateXxgLayout,
  type XxgLayout,
  type XxgPortalId,
  type XxgRect,
  type XxgXZ,
} from '../contract.ts'

export type XxgDistrictZoneId =
  | 'main-boulevard'
  | 'central-atrium'
  | 'north-terrazzo'
  | 'retro-alley'
  | 'mid-stalls'
  | 'south-boutique'
  | 'escalator-hall'

export interface XxgSkylightBay {
  readonly id: 'skylight-north' | 'skylight-south'
  readonly label: string
  readonly center: XxgXZ
  readonly baseWidthM: number
  readonly vaultHeightM: number
  readonly refPhotos: readonly string[]
}

export interface XxgZoneMeta {
  readonly id: XxgDistrictZoneId
  readonly label: string
  readonly corridorIds: readonly string[]
  readonly clearHeightM: number
  readonly tileModuleM: number
  readonly floorLookKey: string
  readonly refPhotos: readonly string[]
}

/**
 * 小香港地下商业城（B1）正式架构布局。
 * 严格遵循 contract.ts v1 schema，纯数据模块，零 Three 值导入与零 runtime 耦合。
 */
export const XIAOXIANGGANG_B1_LAYOUT: XxgLayout = layoutJson as XxgLayout

/** 600mm 模数、双玻璃金字塔挑空采光井（对应 central_square.py#L268-L270）及分区索引。 */
export const XXG_ARCHITECTURAL_META = {
  tileModuleM: 0.6,
  columnGridPitchRangeM: [3.6, 6.8] as const,
  fireShutterBeamClearHeightM: 2.25,
  skylights: [
    {
      id: 'skylight-north',
      label: '北玻璃金字塔采光井（折返下沉步梯+白球吊灯）',
      center: { x: -38.0, z: -28.0 },
      baseWidthM: 7.8,
      vaultHeightM: 7.8,
      refPhotos: ['01-surface-glass-pyramid-exterior.jpg', '04-skylight-pyramid-interior-stairs.jpg', '05-skylight-landing-stairs-globes.jpg'],
    },
    {
      id: 'skylight-south',
      label: '南玻璃金字塔采光井（宽幅直梯+采光中厅）',
      center: { x: -38.0, z: 28.0 },
      baseWidthM: 7.8,
      vaultHeightM: 7.8,
      refPhotos: ['03-surface-plaza-pyramids-bagui.jpg', '04-skylight-pyramid-interior-stairs.jpg'],
    },
  ] satisfies readonly XxgSkylightBay[],
  zones: [
    {
      id: 'main-boulevard',
      label: '翻新主轴宽通道（#11 铭仕 / 足鼎 / 亨得利）',
      corridorIds: ['corr-main-ew', 'corr-west-ns', 'corr-east-ns', 'corr-skylight-ns'],
      clearHeightM: 2.9,
      tileModuleM: 0.6,
      floorLookKey: 'floorRenovated',
      refPhotos: ['11-corridor-main-hallway-wide.jpg'],
    },
    {
      id: 'central-atrium',
      label: '中心圆盘翻新中庭（#14 我的调调 · ~102㎡ 休闲集散）',
      corridorIds: ['corr-atrium-hub', 'corr-atrium-ns'],
      clearHeightM: 2.9,
      tileModuleM: 0.6,
      floorLookKey: 'floorRenovated',
      refPhotos: ['14-atrium-renovated-rest-area.jpg'],
    },
    {
      id: 'north-terrazzo',
      label: 'A区水磨石女装支巷（#12 优优家 / 玖琳 A316）',
      corridorIds: ['corr-north-terrazzo'],
      clearHeightM: 2.75,
      tileModuleM: 0.6,
      floorLookKey: 'floorTerrazzo',
      refPhotos: ['12-corridor-terrazzo-yuyu-jiulin.jpg'],
    },
    {
      id: 'retro-alley',
      label: '老区密集淘货窄巷（#19/#20 港街 FASHION / 19-49元特价）',
      corridorIds: ['corr-north-retro'],
      clearHeightM: 2.65,
      tileModuleM: 0.6,
      floorLookKey: 'floorTerrazzo',
      refPhotos: ['19-alley-retro-discount-racks.jpg', '20-alley-vintage-hk-street-sign.jpg'],
    },
    {
      id: 'mid-stalls',
      label: '中区 / 二区开放档口廊（#16 依莲 中区12号 / CB2-5-6）',
      corridorIds: ['corr-south-mid'],
      clearHeightM: 2.75,
      tileModuleM: 0.6,
      floorLookKey: 'floorTerrazzo',
      refPhotos: ['16-shop-stall-yilian-mid12.jpg'],
    },
    {
      "id": "south-boutique",
      "label": "B区翻新精品女装廊（#13 1987 / #15 B181 / #17 zhencai / #18 试衣间）",
      "corridorIds": ["corr-south-boutique"],
      "clearHeightM": 2.85,
      "tileModuleM": 0.6,
      "floorLookKey": "floorRenovated",
      "refPhotos": [
        "13-corridor-everyday-shops-1987.jpg",
        "15-shop-boutique-b181-queenshan.jpg",
        "17-shop-boutique-zhencai-floral.jpg",
        "18-shop-interior-boutique-browsing.jpg"
      ]
    },
    {
      id: 'escalator-hall',
      label: '三区玻璃拱顶扶梯门厅（#09/#10 Welcome · CB3-4）',
      corridorIds: ['corr-ne-escalator', 'corr-ne-link'],
      clearHeightM: 3.1,
      tileModuleM: 0.6,
      floorLookKey: 'floorRenovated',
      refPhotos: ['09-portal-escalator-glass-arch-up.jpg', '10-portal-escalator-hall-welcome.jpg'],
    },
  ] satisfies readonly XxgZoneMeta[],
  portalSurfaceNotes: {
    E1: '10号玻璃长廊出入口（靠桂林市体育馆南翼，ref #08）',
    E2: '玻璃拱顶自动扶梯出入口（三区 Welcome 门厅，ref #09/#10）',
    W1: '17号出入口（西南金铜牌，ref #07）',
    W2: '18号出入口（西北深蓝牌，ref #06）',
  } satisfies Readonly<Record<XxgPortalId, string>>,
} as const

export function corridorToRect(c: { from: XxgXZ; to: XxgXZ; width: number }): XxgRect {
  const minX = Math.min(c.from.x, c.to.x)
  const maxX = Math.max(c.from.x, c.to.x)
  const minZ = Math.min(c.from.z, c.to.z)
  const maxZ = Math.max(c.from.z, c.to.z)
  const isHorizontal = Math.abs(c.to.x - c.from.x) >= Math.abs(c.to.z - c.from.z)
  const w = isHorizontal ? maxX - minX : c.width
  const d = isHorizontal ? c.width : maxZ - minZ
  return { x: (minX + maxX) * 0.5, z: (minZ + maxZ) * 0.5, w, d }
}

export function assertValidXxgLayout(layout: XxgLayout = XIAOXIANGGANG_B1_LAYOUT): void {
  const errors = validateXxgLayout(layout)
  if (errors.length > 0) {
    throw new Error(`Invalid Xiaoxianggang B1 layout:\n${errors.join('\n')}`)
  }
}

export { XXG_PORTALS }
