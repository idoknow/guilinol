// M1 look: 青绿山水 · 低多边形. All colours/atmosphere knobs live here; docs/style.md mirrors the palette.
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
  bridgeTop: 0xc4bca8, bridgeSide: 0x938d7e, bridgeDepth: 1.2,
  wall: 0xe9e5da, roof: 0x646b6d, roughness: 1, metalness: 0,
}
