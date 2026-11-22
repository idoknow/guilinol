/**
 * Character outfit & accessory system (`web/src/walk/outfits.ts`, IDOK-125).
 *
 * Design aligned with `public/avatar/figure.glb` (`CityWalker`, 5,666 vertices, 66 bones, `COLOR_0`, no UV):
 *  1. `+0` Draw Call vertex-color recoloring for `top` / `bottom` / `shoes` via a one-time `Uint8Array` semantic
 *     region table `(COLOR_0, connected component, dominant bone, bindY)` — never touches `LOCKED_SKIN` or `LOCKED_HAIR`.
 *  2. Zero-Z-fighting built-in daypack hiding (`BUILTIN_PACK`, 623 vertices across pack + handle + shoulder straps)
 *     by sorting triangle indices once and toggling `geometry.setDrawRange` when equipping any custom `bag`.
 *  3. Lightweight merged static procedural low-poly meshes (`hat_*`, `bag_*`) parented to `avatarRig.attachments`
 *     (`head` and `spine_02` aligned to `-Z` forward), strictly `<= +2` Draw Calls and `0` dynamic lights.
 *  4. `autoHelmetOnRide` temporary visual helmet override on e-bikes without mutating saved `equipped.hat`.
 */

import * as THREE from 'three'
import {
  DEFAULT_EQUIPPED_OUTFIT,
  OUTFIT_ITEMS_BY_ID,
  type EquippedOutfit,
} from '../game/catalog'
import type {AvatarRig} from './avatar-rig'

export const OUTFIT_ZONE = {
  LOCKED_SKIN: 0,
  LOCKED_HAIR: 1,
  TOP_PRIMARY: 2,
  TOP_SLEEVE: 3,
  TOP_TRIM: 4,
  TOP_INNER: 5,
  BOTTOM_MAIN: 6,
  BOTTOM_BELT: 7,
  SHOES_UPPER: 8,
  SHOES_ACCENT: 9,
  SHOES_SOLE: 10,
  BUILTIN_PACK: 11,
} as const

export type OutfitZoneId = (typeof OUTFIT_ZONE)[keyof typeof OUTFIT_ZONE]

export const SAFETY_HELMET_IDS = new Set<string>(['hat_rider_helmet', 'hat_night_visor'])
export const AUTO_RIDE_HELMET_ID = 'hat_rider_helmet'

export function isSafetyHelmet(hatId: string): boolean {
  return SAFETY_HELMET_IDS.has(hatId)
}

export interface VisualOutfitOptions {
  ridingEbike: boolean
  autoHelmetOnRide: boolean
}

/**
 * Computes the effective visual outfit for rendering without mutating persisted `WardrobeState`.
 * When `autoHelmetOnRide === true` and riding an e-bike with a non-helmet hat (`hat_none` / cap),
 * temporarily wears `hat_rider_helmet`.
 */
export function resolveVisualOutfit(
  equipped: Readonly<EquippedOutfit>,
  opts: VisualOutfitOptions,
): EquippedOutfit {
  const resolved: EquippedOutfit = {...equipped}
  if (opts.autoHelmetOnRide && opts.ridingEbike && !isSafetyHelmet(resolved.hat)) {
    resolved.hat = AUTO_RIDE_HELMET_ID
  }
  return resolved
}

interface TopRecipe {
  primary: string
  sleeve: string
  trim: string
  inner: string
}

interface BottomRecipe {
  main: string
  belt: string
}

interface ShoesRecipe {
  upper: string
  accent: string
  sole: string
}

const TOP_RECIPES: Record<string, TopRecipe> = {
  // IDOK-133 r2 default look (Rock: keep it simple): plain off-white top, black trousers, white trainers, black pack.
  top_default_tee: {primary: '#e9e7e1', sleeve: '#e9e7e1', trim: '#d8d5cd', inner: '#e9e7e1'},
  top_guilin_hoodie: {primary: '#465460', sleeve: '#465460', trim: '#ffc53d', inner: '#d8d4cb'},
  top_linen_shirt: {primary: '#ece5d4', sleeve: '#ece5d4', trim: '#8d9b87', inner: '#f7f4ec'},
  top_rider_vest: {primary: '#d98a2b', sleeve: '#1c2329', trim: '#ffd257', inner: '#1c2329'},
  top_lijiang_shell: {primary: '#1e9d91', sleeve: '#1a7d74', trim: '#14191e', inner: '#28343b'},
  top_guochao_pankou: {primary: '#1c242b', sleeve: '#1c242b', trim: '#d8b46a', inner: '#c84b3c'},
  top_night_moto: {primary: '#161b22', sleeve: '#1f2630', trim: '#20d6c1', inner: '#2b3440'},
}

const BOTTOM_RECIPES: Record<string, BottomRecipe> = {
  bottom_default_pants: {main: '#2a2c30', belt: '#1d1e21'},
  bottom_guilin_cargo: {main: '#2d3238', belt: '#1b1f24'},
  bottom_linen_shorts: {main: '#a9977b', belt: '#6f5c43'},
  bottom_rider_pants: {main: '#252a30', belt: '#ffc53d'},
  bottom_lijiang_tech: {main: '#353d44', belt: '#20d6c1'},
  bottom_guochao_drape: {main: '#1c2026', belt: '#b89658'},
  bottom_night_moto: {main: '#181c22', belt: '#20d6c1'},
}

const SHOES_RECIPES: Record<string, ShoesRecipe> = {
  shoes_default_sneaker: {upper: '#f2f1ed', accent: '#d9d8d3', sole: '#f6f5f1'},
  shoes_guilin_canvas: {upper: '#d8d4c8', accent: '#35424a', sole: '#8a5b36'},
  shoes_linen_loafer: {upper: '#c8b28e', accent: '#694b36', sole: '#dfd3bd'},
  shoes_rider_boots: {upper: '#1f2326', accent: '#7d858c', sole: '#14171a'},
  shoes_lijiang_trail: {upper: '#2e3839', accent: '#20d6c1', sole: '#1a1f22'},
  shoes_guochao_sneaker: {upper: '#2a2d31', accent: '#d8b46a', sole: '#4a3121'},
  shoes_night_moto: {upper: '#171a1f', accent: '#20d6c1', sole: '#ffc53d'},
}

/** The daypack modelled into figure.glb (hidden since IDOK-133; colours kept for the recolour pass). */
const BUILTIN_PACK_COLORS = {body: '#2c2e32', strap: '#1b1c1f'} as const

function resolveTopRecipe(topId: string): TopRecipe {
  const known = TOP_RECIPES[topId]
  if (known) return known
  const item = OUTFIT_ITEMS_BY_ID[topId]
  const primary = item?.colorHex ?? '#f09a4a'
  const accent = item?.accentHex ?? '#f2efe8'
  return {primary, sleeve: primary, trim: accent, inner: accent}
}

function resolveBottomRecipe(bottomId: string): BottomRecipe {
  const known = BOTTOM_RECIPES[bottomId]
  if (known) return known
  const item = OUTFIT_ITEMS_BY_ID[bottomId]
  return {main: item?.colorHex ?? '#55708f', belt: item?.accentHex ?? '#262b30'}
}

function resolveShoesRecipe(shoesId: string): ShoesRecipe {
  const known = SHOES_RECIPES[shoesId]
  if (known) return known
  const item = OUTFIT_ITEMS_BY_ID[shoesId]
  return {upper: item?.colorHex ?? '#eeeae2', accent: item?.accentHex ?? '#343b40', sole: '#6b5742'}
}

// Known palette hexes from pipeline/avatar.py encoded in figure.glb COLOR_0 (linear -> sRGB hex)
const KNOWN_GLB_HEXES: readonly {hex: string; rgb: [number, number, number]}[] = [
  {hex: '#dcb48e', rgb: [0xdc, 0xb4, 0x8e]}, // skin
  {hex: '#1f1b19', rgb: [0x1f, 0x1b, 0x19]}, // hair
  {hex: '#f09a4a', rgb: [0xf0, 0x9a, 0x4a]}, // jacket
  {hex: '#c06a2c', rgb: [0xc0, 0x6a, 0x2c]}, // jacketDark
  {hex: '#f2efe8', rgb: [0xf2, 0xef, 0xe8]}, // tee / sock cuff
  {hex: '#55708f', rgb: [0x55, 0x70, 0x8f]}, // jeans
  {hex: '#eeeae2', rgb: [0xee, 0xea, 0xe2]}, // shoe
  {hex: '#c49a6c', rgb: [0xc4, 0x9a, 0x6c]}, // sole
  {hex: '#66737b', rgb: [0x66, 0x73, 0x7b]}, // pack
  {hex: '#343b40', rgb: [0x34, 0x3b, 0x40]}, // strap / belt / lace
]

function linearToSrgbByte(lin: number): number {
  const c = Math.max(0, Math.min(1, lin))
  const s = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
  return Math.max(0, Math.min(255, Math.round(s * 255)))
}

function matchPaletteHex(rLin: number, gLin: number, bLin: number): string {
  const r = linearToSrgbByte(rLin)
  const g = linearToSrgbByte(gLin)
  const b = linearToSrgbByte(bLin)
  let bestHex = KNOWN_GLB_HEXES[0].hex
  let bestDist = Infinity
  for (const entry of KNOWN_GLB_HEXES) {
    const dr = r - entry.rgb[0]
    const dg = g - entry.rgb[1]
    const db = b - entry.rgb[2]
    const d = dr * dr + dg * dg + db * db
    if (d < bestDist) {
      bestDist = d
      bestHex = entry.hex
    }
  }
  return bestHex
}

function dominantBoneName(
  skinIdx: THREE.BufferAttribute,
  skinWgt: THREE.BufferAttribute,
  bones: readonly THREE.Bone[],
  vertexIndex: number,
): string {
  const ws = [skinWgt.getX(vertexIndex), skinWgt.getY(vertexIndex), skinWgt.getZ(vertexIndex), skinWgt.getW(vertexIndex)]
  const bs = [skinIdx.getX(vertexIndex), skinIdx.getY(vertexIndex), skinIdx.getZ(vertexIndex), skinIdx.getW(vertexIndex)]
  let bestSlot = 0
  for (let k = 1; k < 4; k++) {
    if (ws[k] > ws[bestSlot]) bestSlot = k
  }
  const bone = bones[Math.round(bs[bestSlot])]
  return bone?.name ?? ''
}

export interface PartitionResult {
  zones: Uint8Array
  originalColors: Float32Array
  bodyIndexCount: number
  totalIndexCount: number
  zoneCounts: Record<string, number>
}

/**
 * Classifies every vertex of `CityWalker` into a disjoint semantic zone and sorts the index buffer once
 * so `BUILTIN_PACK` triangles sit at the tail `[bodyIndexCount .. totalIndexCount)` for instant drawRange hiding.
 */
export function partitionCityWalkerGeometry(skinned: THREE.SkinnedMesh): PartitionResult | null {
  const geom = skinned.geometry
  const posAttr = geom.getAttribute('position') as THREE.BufferAttribute | undefined
  const colAttr = geom.getAttribute('color') as THREE.BufferAttribute | undefined
  const idxAttr = geom.getIndex()
  if (!posAttr || !colAttr || !idxAttr) return null

  const skinIdxAttr = geom.getAttribute('skinIndex') as THREE.BufferAttribute | undefined
  const skinWgtAttr = geom.getAttribute('skinWeight') as THREE.BufferAttribute | undefined
  const bones = skinned.skeleton?.bones ?? []
  const count = posAttr.count
  const zones = new Uint8Array(count)
  const originalColors = new Float32Array(count * 3)
  const vertHex = new Array<string>(count)

  for (let i = 0; i < count; i++) {
    const r = colAttr.getX(i)
    const g = colAttr.getY(i)
    const b = colAttr.getZ(i)
    originalColors[i * 3] = r
    originalColors[i * 3 + 1] = g
    originalColors[i * 3 + 2] = b
    vertHex[i] = matchPaletteHex(r, g, b)
  }

  // Build position-welded connected components so built-in backpack + handle + shoulder straps are detected atomically.
  const posKeys = new Array<string>(count)
  const keyToVerts = new Map<string, number[]>()
  for (let i = 0; i < count; i++) {
    const k = `${Math.round(posAttr.getX(i) * 1e4)},${Math.round(posAttr.getY(i) * 1e4)},${Math.round(posAttr.getZ(i) * 1e4)}`
    posKeys[i] = k
    let bucket = keyToVerts.get(k)
    if (!bucket) {
      bucket = []
      keyToVerts.set(k, bucket)
    }
    bucket.push(i)
  }

  const adj = new Map<string, Set<string>>()
  const link = (a: string, b: string) => {
    let s = adj.get(a)
    if (!s) {
      s = new Set()
      adj.set(a, s)
    }
    s.add(b)
  }
  for (let t = 0; t < idxAttr.count; t += 3) {
    const ka = posKeys[idxAttr.getX(t)]
    const kb = posKeys[idxAttr.getX(t + 1)]
    const kc = posKeys[idxAttr.getX(t + 2)]
    link(ka, kb)
    link(ka, kc)
    link(kb, ka)
    link(kb, kc)
    link(kc, ka)
    link(kc, kb)
  }

  const visited = new Set<string>()
  const builtinPackVerts = new Set<number>()
  for (const key of keyToVerts.keys()) {
    if (visited.has(key)) continue
    visited.add(key)
    const stack = [key]
    const compKeys: string[] = [key]
    while (stack.length) {
      const cur = stack.pop()!
      const nbs = adj.get(cur)
      if (!nbs) continue
      for (const nb of nbs) {
        if (!visited.has(nb)) {
          visited.add(nb)
          compKeys.push(nb)
          stack.push(nb)
        }
      }
    }
    const compVerts: number[] = []
    let minY = Infinity
    let onlyPackOrStrap = true
    let hasPackHex = false
    for (const ck of compKeys) {
      for (const vi of keyToVerts.get(ck)!) {
        compVerts.push(vi)
        const y = posAttr.getY(vi)
        if (y < minY) minY = y
        const hx = vertHex[vi]
        if (hx === '#66737b') hasPackHex = true
        else if (hx !== '#343b40') onlyPackOrStrap = false
      }
    }
    if (onlyPackOrStrap && minY >= 1.0 && (hasPackHex || compVerts.length >= 60)) {
      for (const vi of compVerts) builtinPackVerts.add(vi)
    }
  }

  for (let i = 0; i < count; i++) {
    const hx = vertHex[i]
    const y = posAttr.getY(i)
    const bone = skinIdxAttr && skinWgtAttr ? dominantBoneName(skinIdxAttr, skinWgtAttr, bones, i) : ''
    const isHeadOrNeck = bone === 'head' || bone === 'head_leaf' || y >= 1.51
    const isArmBone =
      bone.startsWith('upperarm_') ||
      bone.startsWith('lowerarm_') ||
      bone.startsWith('hand_')

    if (builtinPackVerts.has(i)) {
      zones[i] = OUTFIT_ZONE.BUILTIN_PACK
    } else if (hx === '#dcb48e') {
      zones[i] = OUTFIT_ZONE.LOCKED_SKIN
    } else if (hx === '#1f1b19') {
      zones[i] = OUTFIT_ZONE.LOCKED_HAIR
    } else if (isHeadOrNeck) {
      // Never allow face/head details to fall into TOP_TRIM regardless of hex.
      zones[i] = OUTFIT_ZONE.LOCKED_SKIN
    } else if (hx === '#f09a4a') {
      zones[i] = isArmBone ? OUTFIT_ZONE.TOP_SLEEVE : OUTFIT_ZONE.TOP_PRIMARY
    } else if (hx === '#c06a2c') {
      zones[i] = y < 0.3 ? OUTFIT_ZONE.SHOES_ACCENT : OUTFIT_ZONE.TOP_TRIM
    } else if (hx === '#f2efe8') {
      zones[i] = y < 0.3 ? OUTFIT_ZONE.SHOES_ACCENT : OUTFIT_ZONE.TOP_INNER
    } else if (hx === '#55708f') {
      zones[i] = OUTFIT_ZONE.BOTTOM_MAIN
    } else if (hx === '#eeeae2') {
      zones[i] = OUTFIT_ZONE.SHOES_UPPER
    } else if (hx === '#c49a6c') {
      zones[i] = OUTFIT_ZONE.SHOES_SOLE
    } else if (hx === '#343b40') {
      zones[i] = y < 0.3 ? OUTFIT_ZONE.SHOES_ACCENT : OUTFIT_ZONE.BOTTOM_BELT
    } else {
      zones[i] = OUTFIT_ZONE.LOCKED_SKIN
    }
  }

  // Sort triangle indices once: body triangles first, BUILTIN_PACK triangles at the tail.
  const bodyIndices: number[] = []
  const packIndices: number[] = []
  for (let t = 0; t < idxAttr.count; t += 3) {
    const a = idxAttr.getX(t)
    const b = idxAttr.getX(t + 1)
    const c = idxAttr.getX(t + 2)
    if (
      zones[a] === OUTFIT_ZONE.BUILTIN_PACK ||
      zones[b] === OUTFIT_ZONE.BUILTIN_PACK ||
      zones[c] === OUTFIT_ZONE.BUILTIN_PACK
    ) {
      packIndices.push(a, b, c)
    } else {
      bodyIndices.push(a, b, c)
    }
  }

  const sorted = new Uint16Array(bodyIndices.length + packIndices.length)
  sorted.set(bodyIndices, 0)
  sorted.set(packIndices, bodyIndices.length)
  geom.setIndex(new THREE.BufferAttribute(sorted, 1))
  geom.setDrawRange(0, sorted.length)

  const names = Object.entries(OUTFIT_ZONE).reduce<Record<number, string>>((acc, [k, v]) => {
    acc[v] = k
    return acc
  }, {})
  const zoneCounts: Record<string, number> = {}
  for (let i = 0; i < zones.length; i++) {
    const name = names[zones[i]] ?? String(zones[i])
    zoneCounts[name] = (zoneCounts[name] ?? 0) + 1
  }

  return {
    zones,
    originalColors,
    bodyIndexCount: bodyIndices.length,
    totalIndexCount: sorted.length,
    zoneCounts,
  }
}

// ---- Procedural single-Mesh accessory builder (0 extra textures, 0 dynamic lights, +1 Draw Call per item) ----

interface ColoredGeomPart {
  geom: THREE.BufferGeometry
  hex: string
}

function mergeColoredParts(parts: readonly ColoredGeomPart[], name: string, doubleSide = false): THREE.Mesh {
  let totalVerts = 0
  const expanded: {pos: THREE.BufferAttribute; norm: THREE.BufferAttribute; col: THREE.Color}[] = []

  for (const part of parts) {
    const g = part.geom.index ? part.geom.toNonIndexed() : part.geom
    if (!g.getAttribute('normal')) g.computeVertexNormals()
    const pos = g.getAttribute('position') as THREE.BufferAttribute
    const norm = g.getAttribute('normal') as THREE.BufferAttribute
    totalVerts += pos.count
    expanded.push({pos, norm, col: new THREE.Color(part.hex)})
    if (g !== part.geom) g.dispose()
    part.geom.dispose()
  }

  const posOut = new Float32Array(totalVerts * 3)
  const normOut = new Float32Array(totalVerts * 3)
  const colOut = new Float32Array(totalVerts * 3)
  let offset = 0

  for (const seg of expanded) {
    for (let i = 0; i < seg.pos.count; i++) {
      const idx = (offset + i) * 3
      posOut[idx] = seg.pos.getX(i)
      posOut[idx + 1] = seg.pos.getY(i)
      posOut[idx + 2] = seg.pos.getZ(i)
      normOut[idx] = seg.norm.getX(i)
      normOut[idx + 1] = seg.norm.getY(i)
      normOut[idx + 2] = seg.norm.getZ(i)
      colOut[idx] = seg.col.r
      colOut[idx + 1] = seg.col.g
      colOut[idx + 2] = seg.col.b
    }
    offset += seg.pos.count
  }

  const merged = new THREE.BufferGeometry()
  merged.setAttribute('position', new THREE.BufferAttribute(posOut, 3))
  merged.setAttribute('normal', new THREE.BufferAttribute(normOut, 3))
  merged.setAttribute('color', new THREE.BufferAttribute(colOut, 3))

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.9,
    metalness: 0.05,
    side: doubleSide ? THREE.DoubleSide : THREE.FrontSide,
  })
  const mesh = new THREE.Mesh(merged, mat)
  mesh.name = name
  mesh.castShadow = false
  mesh.receiveShadow = false
  return mesh
}

function buildHatMesh(hatId: string): THREE.Mesh | null {
  if (hatId === 'hat_none') return null

  if (hatId === 'hat_guilin_cap') {
    // Head-relative coords (origin at head bone ~(0, 1.5685, -0.0114), -Z forward, hair top +0.2065):
    // Crown clears hair cleanly without piercing boat/raft/rowboat vessel-bounds.
    const crown = new THREE.SphereGeometry(1, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.54)
    crown.scale(0.119, 0.112, 0.138)
    crown.translate(0, 0.112, 0.014)

    const band = new THREE.CylinderGeometry(0.120, 0.121, 0.022, 16)
    band.scale(1, 1, 1.15)
    band.translate(0, 0.110, 0.014)

    const brim = new THREE.BoxGeometry(0.158, 0.011, 0.095)
    brim.rotateX(-0.08)
    brim.translate(0, 0.104, -0.145)

    const button = new THREE.SphereGeometry(0.011, 8, 6)
    button.translate(0, 0.224, 0.014)

    return mergeColoredParts(
      [
        {geom: crown, hex: '#20998d'},
        {geom: band, hex: '#166e65'},
        {geom: brim, hex: '#187c72'},
        {geom: button, hex: '#ffc53d'},
      ],
      'outfit_hat_guilin_cap',
    )
  }

  if (hatId === 'hat_rider_helmet') {
    // Open-ended arcs (openEnded=true) avoid flat horizontal cap discs slicing through the head.
    const shell = new THREE.SphereGeometry(1, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.58)
    shell.scale(0.124, 0.116, 0.142)
    shell.translate(0, 0.110, 0.012)

    const backGuard = new THREE.CylinderGeometry(0.127, 0.118, 0.052, 18, 1, true, -Math.PI * 0.62, Math.PI * 1.24)
    backGuard.scale(1, 1, 1.14)
    backGuard.translate(0, 0.064, 0.014)

    // Curved crest arc hugging the dome surface smoothly instead of a flat overhanging box
    const crest = new THREE.TorusGeometry(0.125, 0.009, 6, 16, Math.PI * 0.66)
    crest.rotateZ(Math.PI * 0.17)
    crest.rotateY(Math.PI / 2)
    crest.scale(1, 0.94, 1.13)
    crest.translate(0, 0.112, 0.012)

    const visor = new THREE.CylinderGeometry(0.129, 0.129, 0.048, 16, 1, true, Math.PI * 0.68, Math.PI * 0.64)
    visor.scale(1, 1, 1.12)
    visor.translate(0, 0.090, -0.008)

    return mergeColoredParts(
      [
        {geom: shell, hex: '#e6b235'},
        {geom: backGuard, hex: '#1d2228'},
        {geom: crest, hex: '#1d2228'},
        {geom: visor, hex: '#222b33'},
      ],
      'outfit_hat_rider_helmet',
      true,
    )
  }

  if (hatId === 'hat_night_visor') {
    const shell = new THREE.SphereGeometry(1, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.62)
    shell.scale(0.126, 0.118, 0.144)
    shell.translate(0, 0.108, 0.012)

    const chin = new THREE.CylinderGeometry(0.125, 0.116, 0.046, 16, 1, true, Math.PI * 0.72, Math.PI * 0.56)
    chin.scale(1, 1, 1.14)
    chin.translate(0, 0.036, -0.008)

    const visor = new THREE.CylinderGeometry(0.130, 0.130, 0.052, 16, 1, true, Math.PI * 0.68, Math.PI * 0.64)
    visor.scale(1, 1, 1.13)
    visor.translate(0, 0.084, -0.008)

    const aeroLip = new THREE.BoxGeometry(0.096, 0.018, 0.036)
    aeroLip.rotateX(0.28)
    aeroLip.translate(0, 0.134, 0.134)

    const accentLeft = new THREE.BoxGeometry(0.010, 0.014, 0.105)
    accentLeft.translate(-0.123, 0.092, 0.016)
    const accentRight = new THREE.BoxGeometry(0.010, 0.014, 0.105)
    accentRight.translate(0.123, 0.092, 0.016)

    return mergeColoredParts(
      [
        {geom: shell, hex: '#151920'},
        {geom: chin, hex: '#1b2028'},
        {geom: visor, hex: '#20d6c1'},
        {geom: aeroLip, hex: '#20d6c1'},
        {geom: accentLeft, hex: '#20d6c1'},
        {geom: accentRight, hex: '#20d6c1'},
      ],
      'outfit_hat_night_visor',
      true,
    )
  }

  return null
}

function buildBagMesh(bagId: string): THREE.Mesh | null {
  if (bagId === 'bag_none') return null

  // Torso-relative coords (origin at spine_02 ~(0, 1.1405, +0.0089); jacket back +0.138, hood starts y=+0.298).
  // All bags sit cleanly at z >= +0.143 (outside jacket back) and clear the arm swing corridor.
  if (bagId === 'bag_linen_tote') {
    const body = new THREE.BoxGeometry(0.21, 0.25, 0.085)
    body.rotateZ(-0.14)
    body.translate(0.03, 0.02, 0.188)

    const flap = new THREE.BoxGeometry(0.214, 0.065, 0.092)
    flap.rotateZ(-0.14)
    flap.translate(0.015, 0.115, 0.188)

    const strap = new THREE.BoxGeometry(0.036, 0.34, 0.025)
    strap.rotateZ(-0.56)
    strap.translate(-0.01, 0.14, 0.145)

    return mergeColoredParts(
      [
        {geom: body, hex: '#ded5c0'},
        {geom: flap, hex: '#2d5f59'},
        {geom: strap, hex: '#2d5f59'},
      ],
      'outfit_bag_linen_tote',
    )
  }

  if (bagId === 'bag_rider_pack') {
    // Original Guilin insulated rice-noodle delivery box (no real-world brand colors)
    const box = new THREE.BoxGeometry(0.28, 0.28, 0.175)
    box.translate(0, 0.08, 0.232)

    const lid = new THREE.BoxGeometry(0.29, 0.04, 0.185)
    lid.translate(0, 0.225, 0.232)

    const goldStripe = new THREE.BoxGeometry(0.286, 0.032, 0.022)
    goldStripe.translate(0, 0.115, 0.314)

    const badge = new THREE.BoxGeometry(0.09, 0.055, 0.014)
    badge.translate(0, 0.17, 0.320)

    return mergeColoredParts(
      [
        {geom: box, hex: '#29343b'},
        {geom: lid, hex: '#1e262b'},
        {geom: goldStripe, hex: '#ffc53d'},
        {geom: badge, hex: '#20d6c1'},
      ],
      'outfit_bag_rider_pack',
    )
  }

  if (bagId === 'bag_lijiang_sling') {
    const shell = new THREE.BoxGeometry(0.18, 0.28, 0.09)
    shell.rotateZ(0.32)
    shell.translate(0, 0.09, 0.192)

    const ridge = new THREE.BoxGeometry(0.12, 0.21, 0.026)
    ridge.rotateZ(0.32)
    ridge.translate(0, 0.09, 0.238)

    const accent = new THREE.BoxGeometry(0.022, 0.20, 0.018)
    accent.rotateZ(0.32)
    accent.translate(0.025, 0.09, 0.248)

    return mergeColoredParts(
      [
        {geom: shell, hex: '#1d272b'},
        {geom: ridge, hex: '#2b3940'},
        {geom: accent, hex: '#20d6c1'},
      ],
      'outfit_bag_lijiang_sling',
    )
  }

  if (bagId === 'bag_guochao_satchel') {
    const body = new THREE.BoxGeometry(0.22, 0.19, 0.08)
    body.rotateZ(-0.08)
    body.translate(0.01, 0.04, 0.186)

    const flap = new THREE.BoxGeometry(0.226, 0.085, 0.086)
    flap.rotateZ(-0.08)
    flap.translate(0.005, 0.092, 0.188)

    const clasp = new THREE.BoxGeometry(0.044, 0.036, 0.018)
    clasp.rotateZ(-0.08)
    clasp.translate(0.01, 0.048, 0.228)

    const trim = new THREE.BoxGeometry(0.228, 0.014, 0.018)
    trim.rotateZ(-0.08)
    trim.translate(0.004, 0.06, 0.228)

    return mergeColoredParts(
      [
        {geom: body, hex: '#242930'},
        {geom: flap, hex: '#1a1e24'},
        {geom: clasp, hex: '#d8b46a'},
        {geom: trim, hex: '#c84b3c'},
      ],
      'outfit_bag_guochao_satchel',
    )
  }

  return null
}

export interface OutfitControllerSnapshot {
  equipped: EquippedOutfit
  applied: EquippedOutfit
  preview: EquippedOutfit | null
  ridingEbike: boolean
  autoHelmetOnRide: boolean
  builtinPackVisible: boolean
  attachedHat: string | null
  attachedBag: string | null
  drawCallDelta: number
  zoneCounts: Record<string, number>
}

export interface AvatarOutfitController {
  applyEquipped(equipped: Readonly<EquippedOutfit>, opts?: Partial<VisualOutfitOptions>): void
  setRidingEbike(riding: boolean): void
  setAutoHelmet(enabled: boolean): void
  setPreview(preview: Readonly<EquippedOutfit> | null): void
  clearPreview(): void
  getSnapshot(): OutfitControllerSnapshot
  dispose(): void
}

const _tmpColor = new THREE.Color()

/**
 * Runtime avatar wardrobe applier attached to `figure` + `AvatarRig`.
 * Handles `+0` Draw Call `COLOR_0` updates, `BUILTIN_PACK` toggling, and cached `head`/`torso` accessories.
 */
export function createAvatarOutfitController(figure: THREE.Group, rig: AvatarRig): AvatarOutfitController {
  const skinned = rig.skinnedMesh
  const partition = skinned && rig.isSkinned ? partitionCityWalkerGeometry(skinned) : null
  const hatCache = new Map<string, THREE.Mesh | null>()
  const bagCache = new Map<string, THREE.Mesh | null>()

  let savedEquipped: EquippedOutfit = {...DEFAULT_EQUIPPED_OUTFIT}
  let previewOutfit: EquippedOutfit | null = null
  let appliedOutfit: EquippedOutfit = {...DEFAULT_EQUIPPED_OUTFIT}
  let ridingEbike = false
  let autoHelmetOnRide = true
  let currentHatId: string | null = null
  let currentBagId: string | null = null
  let builtinPackVisible = false

  function getOrBuildHat(hatId: string): THREE.Mesh | null {
    if (!hatCache.has(hatId)) hatCache.set(hatId, buildHatMesh(hatId))
    return hatCache.get(hatId) ?? null
  }

  function getOrBuildBag(bagId: string): THREE.Mesh | null {
    if (!bagCache.has(bagId)) bagCache.set(bagId, buildBagMesh(bagId))
    return bagCache.get(bagId) ?? null
  }

  function applyColorZones(outfit: Readonly<EquippedOutfit>): void {
    if (!skinned || !partition) return
    const colAttr = skinned.geometry.getAttribute('color') as THREE.BufferAttribute | undefined
    if (!colAttr) return

    const top = resolveTopRecipe(outfit.top)
    const bottom = resolveBottomRecipe(outfit.bottom)
    const shoes = resolveShoesRecipe(outfit.shoes)

    const cPrimary = new THREE.Color(top.primary)
    const cSleeve = new THREE.Color(top.sleeve)
    const cTrim = new THREE.Color(top.trim)
    const cInner = new THREE.Color(top.inner)
    const cBottom = new THREE.Color(bottom.main)
    const cBelt = new THREE.Color(bottom.belt)
    const cShoe = new THREE.Color(shoes.upper)
    const cShoeAcc = new THREE.Color(shoes.accent)
    const cSole = new THREE.Color(shoes.sole)
    const cPackBody = new THREE.Color(BUILTIN_PACK_COLORS.body)
    const cPackStrap = new THREE.Color(BUILTIN_PACK_COLORS.strap)

    const zones = partition.zones
    const orig = partition.originalColors
    for (let i = 0; i < zones.length; i++) {
      const z = zones[i]
      if (z === OUTFIT_ZONE.LOCKED_SKIN || z === OUTFIT_ZONE.LOCKED_HAIR) {
        colAttr.setXYZ(i, orig[i * 3], orig[i * 3 + 1], orig[i * 3 + 2])
        continue
      }
      // Every zone, the default outfit included, takes its colour from the recipes (the glb palette is only
      // the zone key). Built-in daypack: body vs. the darker straps/handle by source luminance.
      if (z === OUTFIT_ZONE.BUILTIN_PACK) _tmpColor.copy(orig[i * 3] > 0.07 ? cPackBody : cPackStrap)
      else if (z === OUTFIT_ZONE.TOP_PRIMARY) _tmpColor.copy(cPrimary)
      else if (z === OUTFIT_ZONE.TOP_SLEEVE) _tmpColor.copy(cSleeve)
      else if (z === OUTFIT_ZONE.TOP_TRIM) _tmpColor.copy(cTrim)
      else if (z === OUTFIT_ZONE.TOP_INNER) _tmpColor.copy(cInner)
      else if (z === OUTFIT_ZONE.BOTTOM_MAIN) _tmpColor.copy(cBottom)
      else if (z === OUTFIT_ZONE.BOTTOM_BELT) _tmpColor.copy(cBelt)
      else if (z === OUTFIT_ZONE.SHOES_UPPER) _tmpColor.copy(cShoe)
      else if (z === OUTFIT_ZONE.SHOES_ACCENT) _tmpColor.copy(cShoeAcc)
      else _tmpColor.copy(cSole)
      colAttr.setXYZ(i, _tmpColor.r, _tmpColor.g, _tmpColor.b)
    }
    colAttr.needsUpdate = true
  }

  function syncAccessories(outfit: Readonly<EquippedOutfit>): void {
    // IDOK-133 (Rock): no backpack by default — the pack modelled into figure.glb is never shown.
    const showBuiltin = false
    builtinPackVisible = showBuiltin
    if (skinned && partition) {
      skinned.geometry.setDrawRange(0, showBuiltin ? partition.totalIndexCount : partition.bodyIndexCount)
    }

    const headAnchor = rig.attachments.head
    if (headAnchor) {
      for (const mesh of hatCache.values()) {
        if (mesh) mesh.visible = false
      }
      const nextHat = getOrBuildHat(outfit.hat)
      if (nextHat) {
        if (nextHat.parent !== headAnchor) headAnchor.add(nextHat)
        nextHat.visible = true
        currentHatId = outfit.hat
      } else {
        currentHatId = null
      }
    } else {
      currentHatId = null
    }

    const torsoAnchor = rig.attachments.torso
    if (torsoAnchor) {
      for (const mesh of bagCache.values()) {
        if (mesh) mesh.visible = false
      }
      const nextBag = getOrBuildBag(outfit.bag)
      if (nextBag) {
        if (nextBag.parent !== torsoAnchor) torsoAnchor.add(nextBag)
        nextBag.visible = true
        currentBagId = outfit.bag
      } else {
        currentBagId = null
      }
    } else {
      currentBagId = null
    }
  }

  function render(): void {
    const effective = previewOutfit
      ? {...previewOutfit}
      : resolveVisualOutfit(savedEquipped, {ridingEbike, autoHelmetOnRide})
    appliedOutfit = effective
    applyColorZones(effective)
    syncAccessories(effective)
    figure.userData.appliedOutfit = {...effective}
  }

  render()

  return {
    applyEquipped(equipped, opts) {
      savedEquipped = {...equipped}
      if (opts?.ridingEbike !== undefined) ridingEbike = opts.ridingEbike
      if (opts?.autoHelmetOnRide !== undefined) autoHelmetOnRide = opts.autoHelmetOnRide
      render()
    },
    setRidingEbike(riding) {
      if (ridingEbike === riding) return
      ridingEbike = riding
      if (!previewOutfit) render()
    },
    setAutoHelmet(enabled) {
      if (autoHelmetOnRide === enabled) return
      autoHelmetOnRide = enabled
      if (!previewOutfit) render()
    },
    setPreview(preview) {
      previewOutfit = preview ? {...preview} : null
      render()
    },
    clearPreview() {
      if (!previewOutfit) return
      previewOutfit = null
      render()
    },
    getSnapshot(): OutfitControllerSnapshot {
      const drawCallDelta = (currentHatId ? 1 : 0) + (currentBagId ? 1 : 0)
      return {
        equipped: {...savedEquipped},
        applied: {...appliedOutfit},
        preview: previewOutfit ? {...previewOutfit} : null,
        ridingEbike,
        autoHelmetOnRide,
        builtinPackVisible,
        attachedHat: currentHatId,
        attachedBag: currentBagId,
        drawCallDelta,
        zoneCounts: partition ? {...partition.zoneCounts} : {},
      }
    },
    dispose() {
      for (const mesh of [...hatCache.values(), ...bagCache.values()]) {
        if (!mesh) continue
        mesh.removeFromParent()
        mesh.geometry.dispose()
        ;(mesh.material as THREE.Material).dispose()
      }
      hatCache.clear()
      bagCache.clear()
    },
  }
}
