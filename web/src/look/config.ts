// Placeholder look for M0; colours follow docs/style.md. M1 settles the final palette.
export const look = {
  sky: 0xcfdde3, fogNear: 1800, fogFar: 6200,
  sunColor: 0xfff6e8, sunPower: 2.2, sunPosition: [1, 3, 2] as const,
  // Sky/ground fill so walls facing away from the sun are not pure black.
  hemiSky: 0xdfe9ee, hemiGround: 0x5f6b5a, hemiPower: 1.4,
  building: 0xe8e4da, roughness: 1, metalness: 0,
}
