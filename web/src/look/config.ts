// M1 look: 青绿山水 · 低多边形. All colours/atmosphere knobs live here; docs/style.md mirrors the palette.
import vesselBounds from '../../../pipeline/vessel-bounds.json'
export const look = {
  // Peaks (M2.5, docs/reference.md R3/R7/R14): canopy-wrapped karst. Deep broadleaf green in clumps
  // (dark under-canopy ↔ sunlit yellow-green), olive scrub at the foot; steep faces are grey-white
  // limestone with dark vertical runnels and ochre rust. 石青 now comes only from aerial perspective.
  peakFoot: 0x5d6b3e, peakGreen: 0x3a6334, peakGreenDark: 0x203d26, peakGreenLight: 0x62873f,
  peakRock: 0xbab8ae, peakRockDark: 0x57544c, peakRockOchre: 0x9f8b60,
  peakRockShare: 1, peakJitter: .05,
  // Band-noise threshold above which steep faces show bare rock; lower = more cliff, higher = more green.
  peakBareFrom: .5,
  // Sky dome gradient.
  // Phase 2 桂林街头 (docs/style.md 第二期): deeper blue sky, clearer air, harder sun, darker fill → more contrast.
  skyZenith: 0x4f8cc0, skyHorizon: 0xd2e0e6, skyGlow: 0xfbeed2, sunDirection: [-.55, .62, .56] as const,
  // Layered atmosphere: near haze → far 石青 blue → horizon. Distances in metres.
  hazeNear: 0xd3dde0, hazeFar: 0x9fb6c4, fogLength: 3800, fogBlueFrom: 500, fogBlueTo: 3200,
  fogHorizonFrom: 4200, fogHorizonTo: 7500,
  heightFogBase: 150, heightFogFalloff: 55, heightFogBoost: 1.3, airScaleHeight: 900,
  // Plain beyond the data box so the world edge sinks into haze instead of floating.
  outerGround: 0x8e9a6c, outerGroundY: 136,
  // IDOK-200 区外郊野 (look/countryside.ts): field patchwork + wood clumps outside the play region.
  countryside: {paddy: 0x7d9150, paddyYoung: 0x93a35e, fallow: 0xa39d78, vegetable: 0x86915a,
    wood: 0x4a6638, woodDark: 0x2f4a2b},
  // IDOK-432 城区地面/退界铺装/草坡/驳岸色板 (calibrated for gradeDay saturation 1.22, contrast 1.12).
  urbanGround: {
    bareA: 0x9b9b96, bareB: 0xa7a49a,
    grassA: 0x5c6d50, grassB: 0x6f7e5b, soil: 0x6e6958,
    rockA: 0x6d6b62, rockB: 0x827f73,
  },
  sunColor: 0xfff0d4, sunPower: 2.7,
  hemiSky: 0xc9dcea, hemiGround: 0x6f6a5e, hemiPower: 1.2,
  // 树木阴影下限（look/trees.ts）：树冠底面和背光树干的顶点色已烘焙暗面，实时光照再压一次会落到调色
  // 对比度的黑位以下，整片变纯黑。按反照率 × 半球天光色 × 此系数给下限，只抬暗面，受光面不变。
  treeShadeFloor: .8,
  exposure: 1.0,
  // Phase 2 colour grade, applied in every fogged material before fog (look/atmosphere.ts):
  // saturation, contrast around mid-grey; per time of day in time.ts (day / night values here).
  gradeDay: [1.22, 1.12] as const, gradeNight: [1.12, 1.1] as const,
  // 石桥 decks (GL03): weathered concrete/tarmac bridge deck, cast-concrete fascia hanging bridgeDepth metres below.
  bridgeTop: 0x7d7f81, bridgeSide: 0x92918a, bridgeDepth: vesselBounds.bridgeDepth,
  // M3 water: jade body under the mirror; night lights.
  waterBody: 0x4f8580, waterBaked: 0x6c9c97, waterBank: 0x8a876f, windowLight: 0xffc27a, roadLight: 0xffe2bc, bridgeLamp: 0xffd08a,
  peakUplightWarm: 0xffd9a0, peakUplightJade: 0x9fd8c0,
  wall: 0xe9e5da, roof: 0x646b6d, roughness: 1, metalness: 0,
  // M2.5 trees (docs/reference.md): crowns #2f5a2c–#4c7a3a, sunlit #6f9445, under-canopy #1f3a22.
  // Each species shades canopyDark → base → lit with height; instances get ±treeJitter hue/value from their seed.
  trees: {
    trunk: 0x4a3f34, canopyDark: 0x19331d, treeJitter: .08,
    lodNear: 64, lodMid: 340,
    camphor: 0x35642f, camphorLit: 0x729b42,
    banyan: 0x2c582a, banyanLit: 0x527f3b,
    osmanthus: 0x2a5428, osmanthusLit: 0x4e7a39,
    palm: 0x4e7b34, palmLit: 0x7ba04b, palmDark: 0x294823, palmTrunk: 0x9e988c,
    conifer: 0x2e5831, coniferLit: 0x5f833e,
    shrub: 0x355e2e, shrubLit: 0x5a843d,
    virens: 0x48803b, virensLit: 0x80b44b,
    bischofia: 0x37642f, bischofiaLit: 0x689040,
    elaeocarpus: 0x2d5b2c, elaeocarpusLit: 0x55803b,
    ginkgo: 0xa4af38, ginkgoLit: 0xdec547,
    willow: 0x638e3c, willowLit: 0x94ba54,
  },
  // M2.5 buildings (look/buildings.ts), indexed by GL04 kind: 0 white-tile flat, 1 old grey-tile pitched,
  // 2 green-glazed hip (R2), 3 campus masonry, 4 sand-coloured Jiefang frontage.
  buildings: {
    walls: [0xe6e3da, 0xd9d4c8, 0xe9e4d6, 0xc9a46a, 0xe3c8aa], roofs: [0xa3a19a, 0x55595b, 0x3c7a55, 0x5d6062, 0xc5bba6],
    glass: 0x4d5b62, glassLit: 0x8d9ea3, timber: 0x6e5444, shop: 0x4a4744, floorLine: .84,
    // Phase 2: saturated shop signs by day; at night the same slot lights as neon (neon[], same index).
    signs: [0xc8322b, 0xe9a21b, 0x1f6fc2, 0x1f9a5a, 0xd23a7a, 0x16a3a8],
    neon: [0xff3b30, 0xffb020, 0x2f8cff, 0x30ff8a, 0xff3fa4, 0x22e5ff], shopGlow: 0xffe2b0, windowWarm: 0xffc979,
  },
  // M2.5 streets (streets.ts): GL04 path kinds 0 carriageway, 1 sidewalk+kerb, 2 lane markings, 3 stone embankment.
  streets: {
    hedge: 0x486544, iron: 0x42624e,
    directionSign: 0x3279a7,
    sharedBike: 0x5e7680,
    awnings: [0x2f8a4a,0x2766b0,0xc23b33,0x8b8e90], shutter:0x8d9391,
    // Phase 2 + IDOK-432: lifted dark urban asphalt (avoid low-angle charcoal crush), cool granite sidewalk, calmer markings & turf.
    surfaces: [0x55595e, 0x908f8b, 0xebe7dc, 0x8c877c, 0x637155, 0x50555a, 0x9b895f],
    wetDarken: .55,
    railing: 0xd9d5ca, lampPole: 0x3e4743, lampHead: 0xe7dcbc,
  },
  // Max lean of slope-planted trees towards the surface normal (radians); trees grow up, not out.
  treeLean: .14,
}
