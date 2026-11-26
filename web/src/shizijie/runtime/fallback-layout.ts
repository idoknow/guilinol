import {
  SZJ_BUDGET,
  SZJ_LAYOUT_LIMITS,
  SZJ_PLAYER,
  SZJ_STAIRWELLS,
  SZJ_STAIR_IDS,
  getStairwell,
  rectHitsStair,
  stairLocalToIndoor,
  validateSzjLayout,
  yawFacing,
  type SzjCorridor,
  type SzjExit,
  type SzjLayout,
  type SzjNpcRole,
  type SzjNpcPose,
  type SzjRect,
  type SzjShop,
  type SzjShopCategory,
  type SzjWalker,
  type SzjXZ,
} from '../contract.ts'

const SHOP_CATALOG: readonly { name: string; category: SzjShopCategory; kind: 'shop' | 'stall' }[] = [
  { name: '漓江老巷米粉', category: 'snack', kind: 'shop' },
  { name: '阳朔鲜果茶室', category: 'drink', kind: 'shop' },
  { name: '桂花冰室甜品', category: 'drink', kind: 'shop' },
  { name: '象山手作麻薯', category: 'snack', kind: 'stall' },
  { name: '港风复古穿搭馆', category: 'clothing', kind: 'shop' },
  { name: '榕城潮流衣社', category: 'clothing', kind: 'shop' },
  { name: '漓风棉麻女装', category: 'clothing', kind: 'shop' },
  { name: '正阳街潮鞋仓', category: 'shoes', kind: 'shop' },
  { name: '八桂手作皮具', category: 'shoes', kind: 'shop' },
  { name: '快修数码配件站', category: 'phone', kind: 'stall' },
  { name: '屏幕贴膜快修坊', category: 'phone', kind: 'stall' },
  { name: '苗银手作饰品屋', category: 'accessory', kind: 'shop' },
  { name: '明眸快配眼镜社', category: 'accessory', kind: 'shop' },
  { name: '山茶香氛美妆屋', category: 'beauty', kind: 'shop' },
  { name: '盲盒谷子潮玩社', category: 'toy', kind: 'shop' },
  { name: '地下便民百货铺', category: 'other', kind: 'shop' },
  { name: '旧时光黑胶明信片', category: 'other', kind: 'stall' },
  { name: '桂林三宝手信店', category: 'snack', kind: 'shop' },
  { name: '独秀文创印章馆', category: 'other', kind: 'stall' },
  { name: '杉湖针织服饰坊', category: 'clothing', kind: 'shop' },
  { name: '叠彩街头帽袜铺', category: 'accessory', kind: 'stall' },
  { name: '伏波冷萃柠檬茶', category: 'drink', kind: 'stall' },
  { name: '七星潮酷壳膜吧', category: 'phone', kind: 'stall' },
  { name: '南溪手作发饰馆', category: 'beauty', kind: 'shop' },
  { name: '靖江复古帆布包', category: 'clothing', kind: 'shop' },
  { name: '虞山手工绿豆糕', category: 'snack', kind: 'stall' },
  { name: '栖霞精品女鞋坊', category: 'shoes', kind: 'shop' },
  { name: '漓水木艺小摆件', category: 'toy', kind: 'stall' },
]

function pt(x: number, z: number): SzjXZ {
  return { x: Math.round(x * 1000) / 1000, z: Math.round(z * 1000) / 1000 }
}

/**
 * 纯函数保底布局生成器：所有空间坐标全部由 contract.ts 的 SZJ_STAIRWELLS / SZJ_LAYOUT_LIMITS 派生，
 * 不含任何硬编码世界或室内坐标字面量，供未注入外部 layout 时的单测与无头核验使用。
 */
export function buildContractDerivedSzjLayout(): SzjLayout {
  const feet = SZJ_STAIRWELLS.map(s => s.footIndoor)
  const minFx = Math.min(...feet.map(p => p.x))
  const maxFx = Math.max(...feet.map(p => p.x))
  const minFz = Math.min(...feet.map(p => p.z))
  const maxFz = Math.max(...feet.map(p => p.z))

  const hubX = (minFx + maxFx) * 0.5
  const hubZ = (minFz + maxFz) * 0.5
  const ringHalfX = (maxFx - minFx) * 0.22
  const ringHalfZ = (maxFz - minFz) * 0.22

  const westX = hubX - ringHalfX
  const eastX = hubX + ringHalfX
  const northZ = hubZ - ringHalfZ
  const southZ = hubZ + ringHalfZ

  const ringW = SZJ_LAYOUT_LIMITS.corridorWidthMin * 1.9
  const mainW = SZJ_LAYOUT_LIMITS.corridorWidthMin * 1.75

  const nwCorner = pt(westX, northZ)
  const neCorner = pt(eastX, northZ)
  const seCorner = pt(eastX, southZ)
  const swCorner = pt(westX, southZ)

  const corridors: SzjCorridor[] = [
    { id: 'corr-ring-n', kind: 'ring', points: [nwCorner, neCorner], width: ringW },
    { id: 'corr-ring-e', kind: 'ring', points: [neCorner, seCorner], width: ringW },
    { id: 'corr-ring-s', kind: 'ring', points: [seCorner, swCorner], width: ringW },
    { id: 'corr-ring-w', kind: 'ring', points: [swCorner, nwCorner], width: ringW },
    { id: 'corr-main-ew', kind: 'main', points: [pt(westX, hubZ), pt(eastX, hubZ)], width: mainW },
    { id: 'corr-main-ns', kind: 'main', points: [pt(hubX, northZ), pt(hubX, southZ)], width: mainW },
  ]

  const cornerByStair = {
    nw: nwCorner,
    ne: neCorner,
    se: seCorner,
    sw: swCorner,
  } as const

  for (const id of SZJ_STAIR_IDS) {
    const st = getStairwell(id)
    const targetCorner = cornerByStair[id]
    corridors.push({
      id: `corr-stair-${id}`,
      kind: 'main',
      points: [pt(st.footIndoor.x, st.footIndoor.z), targetCorner],
      width: Math.max(SZJ_LAYOUT_LIMITS.corridorWidthMin * 1.5, st.width + SZJ_PLAYER.radius * 2),
    })
  }

  const shopSpan = SZJ_LAYOUT_LIMITS.shopSideMin * 2.1
  const shopDepth = SZJ_LAYOUT_LIMITS.shopSideMin * 2.0
  const outwardGap = ringW * 0.5 + shopDepth * 0.5 + SZJ_PLAYER.radius * 0.4
  const poses: readonly SzjNpcPose[] = ['idle', 'tidy', 'browse', 'phone', 'chat']

  interface CandidateBank {
    readonly frontage: string
    readonly count: number
    readonly makeRect: (idx: number, total: number) => { rect: SzjRect; inwardDir: SzjXZ }
  }

  const banks: readonly CandidateBank[] = [
    {
      frontage: 'corr-ring-n',
      count: 7,
      makeRect: (i, n) => {
        const span = (eastX - westX) * 0.62
        const t = n > 1 ? i / (n - 1) - 0.5 : 0
        const sx = hubX + t * span
        const sz = northZ - outwardGap
        return {
          rect: { x: Math.round(sx * 1000) / 1000, z: Math.round(sz * 1000) / 1000, w: shopSpan, d: shopDepth },
          inwardDir: pt(0, 1),
        }
      },
    },
    {
      frontage: 'corr-ring-s',
      count: 7,
      makeRect: (i, n) => {
        const span = (eastX - westX) * 0.62
        const t = n > 1 ? i / (n - 1) - 0.5 : 0
        const sx = hubX + t * span
        const sz = southZ + outwardGap
        return {
          rect: { x: Math.round(sx * 1000) / 1000, z: Math.round(sz * 1000) / 1000, w: shopSpan, d: shopDepth },
          inwardDir: pt(0, -1),
        }
      },
    },
    {
      frontage: 'corr-ring-w',
      count: 7,
      makeRect: (i, n) => {
        const span = (southZ - northZ) * 0.58
        const t = n > 1 ? i / (n - 1) - 0.5 : 0
        const sx = westX - outwardGap
        const sz = hubZ + t * span
        return {
          rect: { x: Math.round(sx * 1000) / 1000, z: Math.round(sz * 1000) / 1000, w: shopDepth, d: shopSpan },
          inwardDir: pt(1, 0),
        }
      },
    },
    {
      frontage: 'corr-ring-e',
      count: 7,
      makeRect: (i, n) => {
        const span = (southZ - northZ) * 0.58
        const t = n > 1 ? i / (n - 1) - 0.5 : 0
        const sx = eastX + outwardGap
        const sz = hubZ + t * span
        return {
          rect: { x: Math.round(sx * 1000) / 1000, z: Math.round(sz * 1000) / 1000, w: shopDepth, d: shopSpan },
          inwardDir: pt(-1, 0),
        }
      },
    },
  ]

  const shops: SzjShop[] = []
  let seq = 0
  for (const bank of banks) {
    for (let i = 0; i < bank.count; i++) {
      const { rect, inwardDir } = bank.makeRect(i, bank.count)
      const hitsAnyStair = SZJ_STAIRWELLS.some(st => rectHitsStair(rect, st, SZJ_LAYOUT_LIMITS.stairClearance * 2))
      if (hitsAnyStair) continue
      const meta = SHOP_CATALOG[seq % SHOP_CATALOG.length]!
      seq += 1
      const noCode = `B1-${String(seq).padStart(3, '0')}`
      const role: SzjNpcRole = seq % 3 === 0 ? 'customer' : 'keeper'
      const pose: SzjNpcPose = poses[seq % poses.length]!
      const spotPos = pt(rect.x + inwardDir.x * (shopDepth * 0.2), rect.z + inwardDir.z * (shopDepth * 0.2))
      shops.push({
        id: `szj-shop-${String(seq).padStart(2, '0')}`,
        kind: meta.kind,
        no: noCode,
        rect,
        frontage: bank.frontage,
        category: meta.category,
        name: meta.name,
        npcSpots: [
          {
            role,
            pose,
            x: spotPos.x,
            z: spotPos.z,
            yaw: yawFacing(inwardDir),
          },
        ],
      })
    }
  }

  const remainingNpcBudget = Math.max(0, SZJ_BUDGET.npcMax - shops.length)
  const ringWalkers = Math.min(8, Math.floor(remainingNpcBudget * 0.6))
  const crossWalkers = Math.min(4, Math.max(0, remainingNpcBudget - ringWalkers))
  const walkers: SzjWalker[] = [
    {
      id: 'walker-ring-loop',
      points: [nwCorner, neCorner, seCorner, swCorner],
      loop: true,
      count: ringWalkers,
    },
    {
      id: 'walker-cross-ew',
      points: [pt(westX, hubZ), pt(eastX, hubZ)],
      loop: false,
      count: crossWalkers,
    },
  ]

  const exits: SzjExit[] = SZJ_STAIR_IDS.map(id => {
    const st = getStairwell(id)
    return {
      stairId: id,
      center: { x: st.indoor.x, z: st.indoor.z },
      yaw: st.yaw,
      foot: { x: st.footIndoor.x, z: st.footIndoor.z },
    }
  })

  const allPoints: SzjXZ[] = []
  for (const st of SZJ_STAIRWELLS) {
    const hw = st.width * 0.5 + SZJ_LAYOUT_LIMITS.stairClearance
    const hl = st.length * 0.5 + st.profile.landingFoot + SZJ_LAYOUT_LIMITS.stairClearance
    allPoints.push(
      stairLocalToIndoor(st, pt(-hw, -hl)),
      stairLocalToIndoor(st, pt(hw, -hl)),
      stairLocalToIndoor(st, pt(hw, hl)),
      stairLocalToIndoor(st, pt(-hw, hl)),
      st.footIndoor,
    )
  }
  for (const s of shops) {
    allPoints.push(
      pt(s.rect.x - s.rect.w * 0.5, s.rect.z - s.rect.d * 0.5),
      pt(s.rect.x + s.rect.w * 0.5, s.rect.z + s.rect.d * 0.5),
    )
  }

  const pad = SZJ_LAYOUT_LIMITS.corridorWidthMin * 2
  const bounds = {
    minX: Math.floor(Math.min(...allPoints.map(p => p.x)) - pad),
    maxX: Math.ceil(Math.max(...allPoints.map(p => p.x)) + pad),
    minZ: Math.floor(Math.min(...allPoints.map(p => p.z)) - pad),
    maxZ: Math.ceil(Math.max(...allPoints.map(p => p.z)) + pad),
  }

  const colOffset = ringHalfX * 0.42
  const colOffsetZ = ringHalfZ * 0.42
  const ceilingHeight = Math.min(
    SZJ_LAYOUT_LIMITS.ceilingHeightMax,
    Math.max(SZJ_LAYOUT_LIMITS.ceilingHeightMin, SZJ_PLAYER.eyeHeight * 2),
  )

  const layout: SzjLayout = {
    version: 1,
    units: 'm',
    ceilingHeight,
    bounds,
    corridors,
    shops,
    walkers,
    columns: {
      xs: [Math.round((hubX - colOffset) * 100) / 100, Math.round((hubX + colOffset) * 100) / 100],
      zs: [Math.round((hubZ - colOffsetZ) * 100) / 100, Math.round((hubZ + colOffsetZ) * 100) / 100],
      size: SZJ_PLAYER.radius * 2,
    },
    exits,
    sources: ['web/src/shizijie/contract.ts (SZJ_STAIRWELLS & SZJ_FRAME derived fallback)'],
  }

  const errs = validateSzjLayout(layout)
  if (errs.length > 0) {
    throw new Error(`Fallback SzjLayout validation failed: ${errs.join('; ')}`)
  }
  return layout
}
