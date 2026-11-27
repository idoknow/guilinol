import * as T from 'three'

/**
 * Lighting knobs shared by every toon character material (player, crowd, creator studio). The street uses
 * STREET_LIGHT; a studio (the creator stage) may call setCharacterLight() while it is open and must call
 * resetCharacterLight() when it closes, because the uniforms are shared with the paused city behind it.
 */
export interface CharacterLightSettings {
  /** World-space direction the key light shines FROM (street: high north-west). */
  keyFrom?: T.Vector3Tuple
  /** Fresnel rim strength (0 = off). */
  rim: number
  rimColor: T.ColorRepresentation
  /** World-space direction the rim light shines FROM (usually behind and above the subject). */
  rimFrom: T.Vector3Tuple
  /** Hue of the shadow side of the key ramp. Only the hue is used (normalised to unit luminance). */
  shade: T.ColorRepresentation
  /** Hue of the lit side of the key ramp (normalised like shade). */
  lit: T.ColorRepresentation
  /** How much darker the shadow side is than the lit side (street 0.22; unchanged when omitted). */
  contrast?: number
  /** Hair sheen ("angel ring") strength. */
  sheen: number
  /** Overall brightness of the lit figure (street 1; a dark studio dims it so white clothes don't glow). */
  level?: number
}

export const STREET_LIGHT: Readonly<CharacterLightSettings> = Object.freeze({
  keyFrom: [-0.45, 0.86, -0.36] as T.Vector3Tuple,
  rim: 0.2,
  rimColor: '#dfe9f2',
  rimFrom: [0.35, 0.55, 0.75] as T.Vector3Tuple,
  shade: '#c9cfdc',
  lit: '#fffaf2',
  contrast: 0.22,
  sheen: 0.28,
  level: 1,
})

export const characterLight = {
  uKeyFrom: {value: new T.Vector3(-0.45, 0.86, -0.36).normalize()},
  uRim: {value: 0},
  uRimColor: {value: new T.Color()},
  uRimFrom: {value: new T.Vector3()},
  uShade: {value: new T.Color()},
  uLit: {value: new T.Color()},
  uContrast: {value: 0},
  uSheen: {value: 0},
  uLevel: {value: 1},
}

const unitLuminance = (target: T.Color, value: T.ColorRepresentation) => {
  target.set(value)
  const y = 0.2126 * target.r + 0.7152 * target.g + 0.0722 * target.b
  return y > 1e-4 ? target.multiplyScalar(1 / y) : target.setRGB(1, 1, 1)
}

export function setCharacterLight(settings: Partial<CharacterLightSettings>) {
  const u = characterLight
  if (settings.keyFrom) u.uKeyFrom.value.set(...settings.keyFrom).normalize()
  if (settings.rim !== undefined) u.uRim.value = settings.rim
  if (settings.rimColor !== undefined) u.uRimColor.value.set(settings.rimColor)
  if (settings.rimFrom) u.uRimFrom.value.set(...settings.rimFrom).normalize()
  if (settings.shade !== undefined) unitLuminance(u.uShade.value, settings.shade)
  if (settings.lit !== undefined) unitLuminance(u.uLit.value, settings.lit)
  if (settings.contrast !== undefined) u.uContrast.value = settings.contrast
  if (settings.sheen !== undefined) u.uSheen.value = settings.sheen
  if (settings.level !== undefined) u.uLevel.value = settings.level
}

export function resetCharacterLight() {
  setCharacterLight(STREET_LIGHT)
}

resetCharacterLight()
