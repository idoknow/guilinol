// M1 look: 青绿山水 · 低多边形. All colours/atmosphere knobs live here; docs/style.md mirrors the palette.
export const look = {
  // Peaks: 赭石 foot → 石绿 body → 石青 crown, bare limestone on steep walls (aRock).
  peakFoot: 0x9a8a63, peakGreen: 0x5a8b5e, peakCrown: 0x4a7f86, peakRock: 0xa3aca0, peakRockDark: 0x7c8780,
  peakRockShare: 1.05, peakJitter: .06,
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
  // M3 water: jade body under the mirror; night lights.
  waterBody: 0x4f8580, windowLight: 0xffc27a, roadLight: 0xffb55e, bridgeLamp: 0xffd08a,
  peakUplightWarm: 0xffd9a0, peakUplightJade: 0x7fe0c4,
  wall: 0xe9e5da, roof: 0x646b6d, roughness: 1, metalness: 0,
}
