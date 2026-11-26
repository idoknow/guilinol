import layoutJson from './shizijie-b1.layout.json' with { type: 'json' }
import {
  SZJ_BUDGET,
  SZJ_FRAME,
  SZJ_STAIRWELLS,
  SZJ_STAIR_SPEC,
  layoutNpcCount,
  validateSzjLayout,
  type SzjCorridor,
  type SzjLayout,
  type SzjStairId,
  type SzjXZ,
} from '../contract.ts'

export type SzjZoneId =
  | 'ring-north'
  | 'ring-east'
  | 'ring-south'
  | 'ring-west'
  | 'inner-islands'
  | 'stair-vestibules'
  | 'corner-galleries'

export interface SzjZoneMeta {
  readonly id: SzjZoneId
  readonly label: string
  readonly corridorIds: readonly string[]
  readonly clearHeightM: number
  readonly floorType: 'terrazzo' | 'granite-tile'
  readonly refSources: readonly string[]
}

/**
 * 十字街地下商业城（B1）正式架构布局。
 * 严格遵循 contract.ts v1 schema，纯数据模块，零 Three 值导入与零 runtime 耦合。
 */
export const SHIZIJIE_B1_LAYOUT: SzjLayout = layoutJson as SzjLayout

/** 十字街 B1 空间分区、OSM 15 条通道映射及 4 座楼梯规格索引。 */
export const SZJ_ARCHITECTURAL_META = {
  tileModuleM: 0.6,
  clearHeightM: 3.15,
  depthFromSurfaceM: SZJ_FRAME.depth,
  stairSpec: SZJ_STAIR_SPEC,
  osmRingWayId: 985734888,
  osmPassageWayIds: [
    985734873, 985734874, 985734875, 985734876, 985734877, 985734878, 985734879,
    985734880, 985734881, 985734882, 985734883, 985734884, 985734885, 985734886,
  ] as const,
  /** 地面十字街与 B1 实测地下十字存在 ~45° 旋转错位，地面 8 口在 B1 实景中按四角成对编号。 */
  crossRotationOffsetDeg: 45,
  realExitPortalPairs: {
    nw: '⑦⑧号口 · 南方大厦 / 新华书店 / 解放西路',
    ne: '⑤⑥号口 · 大世界 / 解放东路 / 桂林电影院 / 七星公园',
    se: '③④号口 · 文化大厦 / 中心广场 / 中山中路 / 解放桥',
    sw: '①②号口 · 微笑堂 / 阳桥 / 艺术馆',
  } satisfies Readonly<Record<SzjStairId, string>>,
  zones: [
    {
      id: 'ring-north',
      label: 'A区 环北粉韵饮品段（米粉 / 茶室 / 麻薯 / 港风服饰）',
      corridorIds: ['corr-ring-985734888'],
      clearHeightM: 3.15,
      floorType: 'terrazzo',
      refSources: ['osm way/985734888', 'docs/research/shizijie-underground.md'],
    },
    {
      id: 'ring-east',
      label: 'B区 环东潮衣数码段（数码配件 / 冰室甜品 / 贴膜 / 女装）',
      corridorIds: ['corr-ring-985734888'],
      clearHeightM: 3.15,
      floorType: 'terrazzo',
      refSources: ['osm way/985734888', 'raw/refpack/shizijie-underpass-gaps/run-edf7pq6w/ne_zhengyang_4views_sheet.jpg'],
    },
    {
      id: 'ring-south',
      label: 'C区 环南鞋包银饰段（银饰 / 美妆 / 潮鞋 / 潮玩盲盒）',
      corridorIds: ['corr-ring-985734888'],
      clearHeightM: 3.15,
      floorType: 'terrazzo',
      refSources: ['osm way/985734888', 'raw/refpack/shizijie-underpass-gaps/run-edf7pq6w/se_wenhua_4views_sheet.jpg'],
    },
    {
      id: 'ring-west',
      label: 'D区 环西百货黑胶段（便民驿站 / 眼镜 / 棉麻 / 黑胶唱片）',
      corridorIds: ['corr-ring-985734888'],
      clearHeightM: 3.15,
      floorType: 'terrazzo',
      refSources: ['osm way/985734888', 'z-test/shizijie-ref-pack/baidu_pano_views/shizijie_center_4views_sheet.jpg'],
    },
    {
      id: 'inner-islands',
      label: 'E区 中庭四象限内岛格子铺（高密岛柜与交叉中廊）',
      corridorIds: [
        'corr-hub-nw-se', 'corr-hub-nw', 'corr-hub-se',
        'corr-hub-sw-n', 'corr-hub-sw-s', 'corr-hub-ne-n', 'corr-hub-ne-s', 'corr-hub-center',
      ],
      clearHeightM: 3.15,
      floorType: 'granite-tile',
      refSources: [
        'osm ways/985734877..985734886',
        'bilibili/BV1GuW9zJEQT_keyframes_sheet.jpg',
        'z-test/shizijie-ref-pack/b1-real/index.json',
        'docs/shizijie/reality-spec.md',
      ],
    },
    {
      id: 'stair-vestibules',
      label: '四角步梯集散门厅（NW 南方大厦 / NE 解放东 / SE 文化大厦 / SW 微笑堂）',
      corridorIds: ['corr-stair-nw', 'corr-stair-nw-east', 'corr-stair-ne', 'corr-stair-ne-north', 'corr-stair-se', 'corr-stair-sw'],
      clearHeightM: 3.15,
      floorType: 'granite-tile',
      refSources: [
        'pipeline/shizijie_underpass.py',
        'web/src/shizijie/contract.ts',
        'z-test/shizijie-ref-pack/b1-real/index.json',
      ],
    },
    {
      id: 'corner-galleries',
      label: '四角过街疏散联络廊（OSM 四翼外延分支）',
      corridorIds: ['corr-gallery-nw', 'corr-gallery-ne-n', 'corr-gallery-ne-s', 'corr-gallery-sw', 'corr-gallery-se'],
      clearHeightM: 3.15,
      floorType: 'terrazzo',
      refSources: ['osm ways/985734873..985734876'],
    },
  ] satisfies readonly SzjZoneMeta[],
  stairEntranceNotes: {
    nw: '南方大厦 · NW出口（局部 -22.5,-38.8，yaw 72°，人字玻璃网架雨棚+灯箱）',
    ne: '解放东路 / 正阳街 · NE出口（局部 +43.0,-23.0，yaw -45°，经 corr-stair-ne 绕开井壁接通东翼）',
    se: '文化大厦 · SE出口（局部 +22.5,+46.5，yaw -158°，直出 0.81m 顺接主轴 985734877）',
    sw: '微笑堂 · SW出口（局部 -46.2,+21.5，yaw -131.2°，立式「地下通道 TUNNEL」红标牌+绕避误导 hint 直联西廊）',
  } satisfies Readonly<Record<SzjStairId, string>>,
} as const

export function corridorLengthM(corridor: SzjCorridor): number {
  let len = 0
  for (let i = 1; i < corridor.points.length; i++) {
    const a = corridor.points[i - 1]!
    const b = corridor.points[i]!
    len += Math.hypot(b.x - a.x, b.z - a.z)
  }
  return len
}

export function closestDistanceToSegment2D(p: SzjXZ, a: SzjXZ, b: SzjXZ): number {
  const dx = b.x - a.x
  const dz = b.z - a.z
  const l2 = dx * dx + dz * dz
  const t = l2 > 1e-12 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2)) : 0
  return Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz))
}

export function assertValidSzjLayout(layout: SzjLayout = SHIZIJIE_B1_LAYOUT): void {
  const errors = validateSzjLayout(layout)
  if (errors.length > 0) {
    throw new Error(`Invalid Shizijie B1 layout:\n${errors.join('\n')}`)
  }
}

export const SZJ_B1_SUMMARY = {
  corridors: SHIZIJIE_B1_LAYOUT.corridors.length,
  shops: SHIZIJIE_B1_LAYOUT.shops.length,
  npcTotal: layoutNpcCount(SHIZIJIE_B1_LAYOUT),
  npcBudgetMax: SZJ_BUDGET.npcMax,
} as const

export { SZJ_STAIRWELLS }
