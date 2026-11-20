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
  skyZenith: 0x7aa3bb, skyHorizon: 0xdbe4e0, skyGlow: 0xf4ead2, sunDirection: [-.55, .62, .56] as const,
  // Layered atmosphere: near haze → far 石青 blue → horizon. Distances in metres.
  hazeNear: 0xd6e0dc, hazeFar: 0x9db5bf, fogLength: 2600, fogBlueFrom: 500, fogBlueTo: 3200,
  fogHorizonFrom: 4200, fogHorizonTo: 7500,
  heightFogBase: 150, heightFogFalloff: 55, heightFogBoost: 1.3, airScaleHeight: 900,
  // Plain beyond the data box so the world edge sinks into haze instead of floating.
  outerGround: 0xaeb09b, outerGroundY: 136,
  sunColor: 0xfff0d8, sunPower: 2.1,
  hemiSky: 0xd8e6e6, hemiGround: 0x8a9172, hemiPower: 1.7,
  exposure: 1.0,
  // 石桥 decks (GL03): warm limestone top, shaded fascia hanging bridgeDepth metres below the deck.
  bridgeTop: 0xc4bca8, bridgeSide: 0x938d7e, bridgeDepth: vesselBounds.bridgeDepth,
  // M3 water: jade body under the mirror; night lights.
  waterBody: 0x4f8580, waterBaked: 0x6c9c97, waterBank: 0x8a876f, windowLight: 0xffc27a, roadLight: 0xffb55e, bridgeLamp: 0xffd08a,
  peakUplightWarm: 0xffd9a0, peakUplightJade: 0x9fd8c0,
  wall: 0xe9e5da, roof: 0x646b6d, roughness: 1, metalness: 0,
  // M2.5 trees (docs/reference.md): crowns #2f5a2c–#4c7a3a, sunlit #6f9445, under-canopy #1f3a22.
  // Each species shades canopyDark → base → lit with height; instances get ±treeJitter hue/value from their seed.
  trees: {
    trunk: 0x4a3f33, canopyDark: 0x1a3320, treeJitter: .09,
    camphor: 0x3d6a33, camphorLit: 0x648a40,
    banyan: 0x2e5a2c, banyanLit: 0x4c7a3a,
    osmanthus: 0x2a5229, osmanthusLit: 0x416e35,
    palm: 0x557d36, palmLit: 0x7a9a4a, palmDark: 0x33532a, palmTrunk: 0x857b6b,
    conifer: 0x264a2d, coniferLit: 0x3f6840,
    shrub: 0x375f30, shrubLit: 0x56803c,
  },
  // M2.5 buildings (look/buildings.ts), indexed by GL04 kind: 0 white-tile flat, 1 old grey-tile pitched,
  // 2 green-glazed hip (R2), 3 landmark placeholder (王城 yellow/red, R16).
  buildings: {
    walls: [0xe6e3da, 0xd9d4c8, 0xe9e4d6, 0xc9a46a], roofs: [0xa3a19a, 0x55595b, 0x3c7a55, 0x5d6062],
    glass: 0x4d5b62, glassLit: 0x8d9ea3, timber: 0x6e5444, shop: 0x4a4744, floorLine: .84,
    signs: [0x9a5246, 0xb39452, 0x52708a, 0x5f7d56], windowWarm: 0xffc979,
  },
  // M2.5 streets (streets.ts): GL04 path kinds 0 carriageway, 1 sidewalk+kerb, 2 lane markings, 3 stone embankment.
  streets: {
    hedge: 0x486544, iron: 0x42624e,
    directionSign: 0x3279a7,
    sharedBike: 0x72d5b0,
    awnings: [0x557650,0x506f94,0x9c4a46,0x878981], shutter:0x858b88,
    surfaces: [0x6a6b6b, 0x999894, 0xe6e2d4, 0x8f897b, 0x737962, 0x626365, 0xa18b55],
    railing: 0xd9d5ca, lampPole: 0x3e4743, lampHead: 0xe7dcbc,
  },
  // Max lean of slope-planted trees towards the surface normal (radians); trees grow up, not out.
  treeLean: .14,
  // Trees within this horizontal radius of the camera (and above it) are hidden so crowns never fill the screen.
  treeCameraClear: 7,
}
