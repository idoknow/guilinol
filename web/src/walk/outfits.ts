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
  NPC_ONLY_OUTFIT_ITEMS,
  NPC_ONLY_OUTFIT_ITEMS_BY_ID,
  OFFICER_UNIFORM_OUTFIT,
  OUTFIT_ITEMS_BY_ID,
  resolveOutfitItemDef,
  type EquippedOutfit,
} from '../game/catalog'
import type {AvatarRig} from './avatar-rig'
import {streetShading} from './creator-ink'

export {
  NPC_ONLY_OUTFIT_ITEMS,
  NPC_ONLY_OUTFIT_ITEMS_BY_ID,
  OFFICER_UNIFORM_OUTFIT,
  resolveOutfitItemDef,
}

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

export type ReflectiveVestMode = 'auto' | 'none' | 'volunteer' | 'officer'

export interface VisualOutfitOptions {
  ridingEbike: boolean
  autoHelmetOnRide: boolean
  /** Optional GLSL reflective vest overlay mode (`'auto'` activates `'officer'` on `top_traffic_police_shirt` and `'volunteer'` on `top_traffic_volunteer`). */
  vestMode?: ReflectiveVestMode
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
  top_traffic_volunteer: {primary: '#d8ee1e', sleeve: '#192332', trim: '#d8ee1e', inner: '#192332'},
  top_traffic_police_shirt: {primary: '#7ab8e6', sleeve: '#7ab8e6', trim: '#18253c', inner: '#18253c'},
  top_cover_dusk: {primary: '#d3c19f', sleeve: '#d3c19f', trim: '#bfab86', inner: '#e8decb'},
}

const BOTTOM_RECIPES: Record<string, BottomRecipe> = {
  bottom_default_pants: {main: '#2a2c30', belt: '#1d1e21'},
  bottom_guilin_cargo: {main: '#2d3238', belt: '#1b1f24'},
  bottom_linen_shorts: {main: '#a9977b', belt: '#6f5c43'},
  bottom_rider_pants: {main: '#252a30', belt: '#ffc53d'},
  bottom_lijiang_tech: {main: '#353d44', belt: '#20d6c1'},
  bottom_guochao_drape: {main: '#1c2026', belt: '#b89658'},
  bottom_night_moto: {main: '#181c22', belt: '#20d6c1'},
  bottom_traffic_duty: {main: '#1b2330', belt: '#dce6ee'},
  bottom_police_trousers: {main: '#1a263a', belt: '#1b2028'},
  bottom_cover_dusk: {main: '#34405a', belt: '#1f232b'},
}

const SHOES_RECIPES: Record<string, ShoesRecipe> = {
  shoes_default_sneaker: {upper: '#f2f1ed', accent: '#d9d8d3', sole: '#f6f5f1'},
  shoes_guilin_canvas: {upper: '#d8d4c8', accent: '#35424a', sole: '#8a5b36'},
  shoes_linen_loafer: {upper: '#c8b28e', accent: '#694b36', sole: '#dfd3bd'},
  shoes_rider_boots: {upper: '#1f2326', accent: '#7d858c', sole: '#14171a'},
  shoes_lijiang_trail: {upper: '#2e3839', accent: '#20d6c1', sole: '#1a1f22'},
  shoes_guochao_sneaker: {upper: '#2a2d31', accent: '#d8b46a', sole: '#4a3121'},
  shoes_night_moto: {upper: '#171a1f', accent: '#20d6c1', sole: '#ffc53d'},
  shoes_traffic_duty: {upper: '#16191e', accent: '#2f3844', sole: '#111418'},
  shoes_cover_dusk: {upper: '#efebe3', accent: '#b9a27d', sole: '#f5f2ec'},
}

const STARTER_PATTERNS: Record<string, number> = {
  top_starter_denim: 1,
  top_starter_knit: 1,
  top_starter_plaid: 2,
  top_starter_track: 3,
  top_starter_shell: 4,
  top_starter_hoodie: 5,
  top_cover_dusk: 6,
}

/** The daypack modelled into figure.glb (hidden since IDOK-133; colours kept for the recolour pass). */
const BUILTIN_PACK_COLORS = {body: '#2c2e32', strap: '#1b1c1f'} as const

function resolveTopRecipe(topId: string): TopRecipe {
  if(topId.startsWith('top_starter_')){
    const item=OUTFIT_ITEMS_BY_ID[topId]
    if(item)return {primary:item.colorHex,sleeve:topId==='top_starter_office'?'#e6e1d5':item.colorHex,trim:item.accentHex!,inner:item.colorHex}
  }
  const known = TOP_RECIPES[topId]
  if (known) return known
  const item = resolveOutfitItemDef(topId)
  const primary = item?.colorHex ?? '#f09a4a'
  const accent = item?.accentHex ?? '#f2efe8'
  return {primary, sleeve: primary, trim: accent, inner: accent}
}

function resolveBottomRecipe(bottomId: string): BottomRecipe {
  const known = BOTTOM_RECIPES[bottomId]
  if (known) return known
  const item = resolveOutfitItemDef(bottomId)
  return {main: item?.colorHex ?? '#55708f', belt: item?.accentHex ?? '#262b30'}
}

function resolveShoesRecipe(shoesId: string): ShoesRecipe {
  if(shoesId==='shoes_starter_chinese')return SHOES_RECIPES.shoes_default_sneaker
  const known = SHOES_RECIPES[shoesId]
  if (known) return known
  const item = resolveOutfitItemDef(shoesId)
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

  if (hatId === 'hat_traffic_cap') {
    // Compliant traffic persuasion volunteer cap + dark short undercut hair fringe/nape beneath cap brim
    const crown = new THREE.SphereGeometry(1, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.56)
    crown.scale(0.119, 0.110, 0.138)
    crown.translate(0, 0.112, 0.014)

    const band = new THREE.CylinderGeometry(0.121, 0.122, 0.024, 16)
    band.scale(1, 1, 1.15)
    band.translate(0, 0.112, 0.014)

    const brim = new THREE.BoxGeometry(0.160, 0.011, 0.095)
    brim.rotateX(-0.08)
    brim.translate(0, 0.104, -0.145)

    const badgeStripe = new THREE.BoxGeometry(0.056, 0.016, 0.012)
    badgeStripe.translate(0, 0.132, -0.132)

    // Sideburn/nape hair band sitting cleanly beneath cap rim so wearer never looks bald
    const napeHair = new THREE.CylinderGeometry(0.112, 0.102, 0.068, 16, 1, false, -Math.PI * 0.65, Math.PI * 1.30)
    napeHair.scale(1, 1, 1.13)
    napeHair.translate(0, 0.072, 0.016)

    const sideHairL = new THREE.CapsuleGeometry(0.018, 0.036, 2, 5)
    sideHairL.translate(0.102, 0.080, -0.028)
    const sideHairR = new THREE.CapsuleGeometry(0.018, 0.036, 2, 5)
    sideHairR.translate(-0.102, 0.080, -0.028)

    return mergeColoredParts(
      [
        {geom: crown, hex: '#1b2636'},
        {geom: band, hex: '#d8ee1e'},
        {geom: brim, hex: '#141c28'},
        {geom: badgeStripe, hex: '#eef4f8'},
        {geom: napeHair, hex: '#231c18'},
        {geom: sideHairL, hex: '#231c18'},
        {geom: sideHairR, hex: '#231c18'},
      ],
      'outfit_hat_traffic_cap',
    )
  }

  if (hatId === 'hat_traffic_police_cap') {
    // Head-fitted Chinese traffic police peaked cap (白顶大檐帽 + 藏青帽墙 + 黑色漆皮帽檐 + 素面金盾徽 + 防光头短发兜):
    // Aligned with `docs/research/officer-r10/spec.md` & measured against `figure_m.glb` in `attach_head`
    // (-Z forward, head center z=+0.020, eyebrows y=0.082..0.090, forehead z=-0.095, occiput z=+0.132).
    // Because `creator-hair` is hidden whenever a hat is worn (0 hair poke-through on every hairstyle),
    // charcoal `#1b1a1a` nape + sideburn hair is built neatly under the navy wall so the officer never looks bald.
    const segs = 24
    const centerZ = 0.020
    const buildRingLoft = (
      rings: readonly {y: number; rx: number; rz: number; frontLift: number}[],
      closeTopY?: number,
    ): THREE.BufferGeometry => {
      const positions: number[] = []
      const indices: number[] = []
      const ringSize = segs + 1
      for (const r of rings) {
        for (let i = 0; i <= segs; i++) {
          const ang = (i / segs) * Math.PI * 2
          // ang = 0 -> -Z (front center), ang = PI -> +Z (back center)
          const sinA = Math.sin(ang)
          const cosA = Math.cos(ang)
          const frontFactor = Math.max(0, cosA) ** 1.6
          const x = sinA * r.rx
          const z = centerZ - cosA * r.rz
          const y = r.y + r.frontLift * frontFactor
          positions.push(x, y, z)
        }
      }
      for (let ri = 0; ri + 1 < rings.length; ri++) {
        const a0 = ri * ringSize
        const b0 = (ri + 1) * ringSize
        for (let i = 0; i < segs; i++) {
          // Outward normals (T_ring x T_ang points outward: -Z at front, +X at right, +Z at back)
          indices.push(a0 + i, b0 + i, a0 + i + 1)
          indices.push(a0 + i + 1, b0 + i, b0 + i + 1)
        }
      }
      if (closeTopY !== undefined) {
        const topStart = (rings.length - 1) * ringSize
        const apexIdx = positions.length / 3
        positions.push(0, closeTopY, centerZ - 0.006)
        for (let i = 0; i < segs; i++) {
          // Upward (+Y) crown top normals
          indices.push(topStart + i, apexIdx, topStart + i + 1)
        }
      }
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
      g.setIndex(indices)
      g.computeVertexNormals()
      return g
    }

    // 0. Built-in charcoal-black `#1b1a1a` nape + temple short hair tucked cleanly under the navy cap wall
    const buildNapeHair = (): THREE.BufferGeometry => {
      const nSegs = 14
      const startAng = Math.PI * 0.42
      const endAng = Math.PI * 1.58
      const rings = [
        {y: 0.048, rx: 0.088, rz: 0.106},
        {y: 0.078, rx: 0.101, rz: 0.121},
        {y: 0.104, rx: 0.102, rz: 0.121},
      ]
      const pos: number[] = []
      const idx: number[] = []
      const rowSize = nSegs + 1
      for (const r of rings) {
        for (let i = 0; i <= nSegs; i++) {
          const ang = startAng + (i / nSegs) * (endAng - startAng)
          const sinA = Math.sin(ang)
          const cosA = Math.cos(ang)
          pos.push(sinA * r.rx, r.y, centerZ - cosA * r.rz)
        }
      }
      for (let ri = 0; ri + 1 < rings.length; ri++) {
        const a0 = ri * rowSize
        const b0 = (ri + 1) * rowSize
        for (let i = 0; i < nSegs; i++) {
          idx.push(a0 + i, b0 + i, a0 + i + 1)
          idx.push(a0 + i + 1, b0 + i, b0 + i + 1)
        }
      }
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
      g.setIndex(idx)
      g.computeVertexNormals()
      return g
    }
    const napeHair = buildNapeHair()
    const sideHairL = new THREE.BoxGeometry(0.013, 0.034, 0.032)
    sideHairL.translate(-0.094, 0.085, -0.022)
    const sideHairR = new THREE.BoxGeometry(0.013, 0.034, 0.032)
    sideHairR.translate(0.094, 0.085, -0.022)

    // 1. Deep navy cap wall / band hugging head circumference snugly above eyebrows
    const navyWall = buildRingLoft([
      {y: 0.098, rx: 0.106, rz: 0.124, frontLift: 0.005},
      {y: 0.124, rx: 0.108, rz: 0.126, frontLift: 0.005},
      {y: 0.149, rx: 0.111, rz: 0.129, frontLift: 0.006},
    ])

    // 2. White flared flat-saucer peaked crown (classic crisp front peak lift, flat smooth top)
    const whiteSide = buildRingLoft([
      {y: 0.147, rx: 0.110, rz: 0.128, frontLift: 0.006},
      {y: 0.172, rx: 0.124, rz: 0.142, frontLift: 0.014},
      {y: 0.194, rx: 0.135, rz: 0.153, frontLift: 0.021},
    ])
    const whiteTop = buildRingLoft(
      [
        {y: 0.194, rx: 0.135, rz: 0.153, frontLift: 0.021},
        {y: 0.200, rx: 0.096, rz: 0.111, frontLift: 0.012},
      ],
      0.205,
    )

    // 3. Navy piping trim along outer crown ridge
    const crownPiping = buildRingLoft([
      {y: 0.191, rx: 0.1365, rz: 0.1545, frontLift: 0.021},
      {y: 0.196, rx: 0.1365, rz: 0.1545, frontLift: 0.021},
    ])

    // 4. Curved black patent-leather visor / brim (-68°..+68° around front -Z, sloping cleanly above brows)
    const buildCurvedVisor = (): THREE.BufferGeometry => {
      const vSegs = 16
      const maxAng = 1.18
      const pos: number[] = []
      const idx: number[] = []
      const pushRow = (rScaleX: number, rScaleZ: number, yBase: number, yFrontDrop: number) => {
        const start = pos.length / 3
        for (let i = 0; i <= vSegs; i++) {
          const u = (i / vSegs) * 2 - 1 // -1..+1
          const ang = u * maxAng
          const sinA = Math.sin(ang)
          const cosA = Math.cos(ang)
          const tip = Math.max(0, Math.cos(u * Math.PI * 0.5)) ** 1.15
          const x = sinA * rScaleX
          const z = centerZ - cosA * rScaleZ - tip * (rScaleZ - 0.123) * 0.34
          const y = yBase - tip * yFrontDrop
          pos.push(x, y, z)
        }
        return start
      }
      const inTop = pushRow(0.105, 0.123, 0.105, 0.0)
      const outTop = pushRow(0.119, 0.168, 0.100, 0.017)
      const outBot = pushRow(0.118, 0.167, 0.094, 0.017)
      const inBot = pushRow(0.104, 0.122, 0.100, 0.0)
      const stitch = (r0: number, r1: number) => {
        for (let i = 0; i < vSegs; i++) {
          // Outward/upward normals on visor top, front edge, and underside
          idx.push(r0 + i, r0 + i + 1, r1 + i)
          idx.push(r0 + i + 1, r1 + i + 1, r1 + i)
        }
      }
      stitch(inTop, outTop)
      stitch(outTop, outBot)
      stitch(outBot, inBot)
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
      g.setIndex(idx)
      g.computeVertexNormals()
      return g
    }
    const visor = buildCurvedVisor()

    // 5. Silver-white cap wind strap across front base of navy wall + dual silver side buttons
    const strap = buildRingLoft([
      {y: 0.105, rx: 0.1095, rz: 0.1285, frontLift: 0.005},
      {y: 0.112, rx: 0.1095, rz: 0.1285, frontLift: 0.005},
    ])
    const btnL = new THREE.SphereGeometry(0.0072, 8, 6)
    btnL.translate(0.107, 0.110, -0.010)
    const btnR = new THREE.SphereGeometry(0.0072, 8, 6)
    btnR.translate(-0.107, 0.110, -0.010)

    // 6. Compliant simplified plain gold shield emblem (pure geometric block, zero real insignia or text)
    const badgeShield = new THREE.CylinderGeometry(0.016, 0.011, 0.006, 6)
    badgeShield.rotateX(Math.PI * 0.44)
    badgeShield.translate(0, 0.162, -0.118)

    const mesh = mergeColoredParts(
      [
        {geom: napeHair, hex: '#1b1a1a'},
        {geom: sideHairL, hex: '#1b1a1a'},
        {geom: sideHairR, hex: '#1b1a1a'},
        {geom: navyWall, hex: '#18253c'},
        {geom: whiteSide, hex: '#e8edf3'},
        {geom: whiteTop, hex: '#f6f7f9'},
        {geom: crownPiping, hex: '#18253c'},
        {geom: visor, hex: '#141920'},
        {geom: strap, hex: '#dde5ee'},
        {geom: btnL, hex: '#cfd8e3'},
        {geom: btnR, hex: '#cfd8e3'},
        {geom: badgeShield, hex: '#dfb64c'},
      ],
      'outfit_hat_traffic_police_cap',
      true,
    )
    // Match player's streetShading 3-band sunlit toon lighting so cap & character share one visual style
    const mat = mesh.material as THREE.MeshStandardMaterial
    mat.roughness = 0.72
    mat.metalness = 0.08
    streetShading(mat, false)
    return mesh
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

  if (bagId === 'bag_traffic_flag') {
    // Rounded volunteer crossbody flag quiver + diagonal sash + full yellow pennant streaming backward-outward behind back
    // Strictly obeys check-outfits bounds: minZ >= 0.13, width <= 0.34, local maxY <= 0.24
    const quiver = new THREE.CapsuleGeometry(0.030, 0.16, 3, 7)
    quiver.rotateZ(-0.42)
    quiver.translate(-0.025, -0.02, 0.172)

    const cuff = new THREE.CylinderGeometry(0.035, 0.033, 0.022, 8)
    cuff.rotateZ(-0.42)
    cuff.translate(0.008, 0.055, 0.175)

    const strap = new THREE.CapsuleGeometry(0.015, 0.28, 2, 5)
    strap.rotateZ(-0.56)
    strap.translate(-0.01, 0.06, 0.150)

    const pole = new THREE.CylinderGeometry(0.007, 0.007, 0.26, 6)
    pole.rotateZ(-0.34)
    pole.rotateX(0.32)
    pole.translate(0.065, 0.125, 0.225)

    // Flag billows backward (+Z) and slightly outward (+X) in open air well clear of the vest back
    const flagShape = new THREE.Shape([
      [0.000, 0.115],
      [0.000, 0.225],
      [0.145, 0.180],
    ].map(([zOff, y]) => new THREE.Vector2(zOff, y)))
    const pennant = new THREE.ExtrudeGeometry(flagShape, {
      depth: 0.008,
      steps: 1,
      bevelEnabled: false,
      curveSegments: 1,
    })
    pennant.rotateY(-Math.PI / 2 + 0.38)
    pennant.translate(0.095, 0, 0.255)

    return mergeColoredParts(
      [
        {geom: quiver, hex: '#1c2634'},
        {geom: cuff, hex: '#eef4f8'},
        {geom: strap, hex: '#1c2634'},
        {geom: pole, hex: '#dce2e8'},
        {geom: pennant, hex: '#f5d226'},
      ],
      'outfit_bag_traffic_flag',
      true,
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
  setVestMode?(mode: ReflectiveVestMode): void
  setPreview(preview: Readonly<EquippedOutfit> | null): void
  clearPreview(): void
  getSnapshot(): OutfitControllerSnapshot
  dispose(): void
}

const _tmpColor = new THREE.Color()

let cachedOfficerBackTexture: THREE.Texture | null = null

/**
 * Builds a compact RGBA texture of bold 「桂林交警」 for the back reflective placard of the
 * officer vest GLSL overlay (+0 Draw Calls, works identically in browser Canvas and headless Node).
 */
function getOfficerBackTextTexture(): THREE.Texture {
  if (cachedOfficerBackTexture) return cachedOfficerBackTexture
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 192
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = '900 106px "PingFang SC", "Noto Sans SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'
      ctx.lineJoin = 'round'
      ctx.lineWidth = 4
      ctx.strokeStyle = '#0c1626'
      ctx.fillStyle = '#101d32'
      const chars = ['桂', '林', '交', '警'] as const
      const xs = [78, 196, 314, 434] as const
      for (let i = 0; i < chars.length; i++) {
        ctx.strokeText(chars[i], xs[i], 99)
        ctx.fillText(chars[i], xs[i], 99)
      }
      const tex = new THREE.CanvasTexture(canvas)
      tex.colorSpace = THREE.SRGBColorSpace
      tex.wrapS = THREE.ClampToEdgeWrapping
      tex.wrapT = THREE.ClampToEdgeWrapping
      tex.minFilter = THREE.LinearFilter
      tex.magFilter = THREE.LinearFilter
      tex.generateMipmaps = false
      tex.needsUpdate = true
      cachedOfficerBackTexture = tex
      return tex
    }
  }
  // Headless Node fallback: crisp 128x48 procedural RGBA DataTexture with 4 non-zero 「桂林交警」 glyph columns
  const w = 128
  const h = 48
  const data = new Uint8Array(w * h * 4)
  const fillRect = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = Math.max(0, y0); y <= Math.min(h - 1, y1); y++) {
      for (let x = Math.max(0, x0); x <= Math.min(w - 1, x1); x++) {
        const idx = (y * w + x) * 4
        data[idx] = 16
        data[idx + 1] = 29
        data[idx + 2] = 50
        data[idx + 3] = 255
      }
    }
  }
  // 「桂」 (x=8..28)
  fillRect(11, 8, 14, 39)
  fillRect(8, 28, 17, 31)
  fillRect(18, 30, 27, 33)
  fillRect(21, 22, 24, 39)
  fillRect(17, 21, 28, 24)
  fillRect(18, 12, 27, 15)
  fillRect(21, 8, 24, 21)
  fillRect(16, 8, 28, 11)
  // 「林」 (x=38..58)
  fillRect(42, 8, 45, 39)
  fillRect(38, 28, 47, 31)
  fillRect(52, 8, 55, 39)
  fillRect(48, 28, 58, 31)
  // 「交」 (x=68..88)
  fillRect(76, 36, 80, 40)
  fillRect(69, 31, 87, 34)
  fillRect(70, 21, 75, 28)
  fillRect(81, 21, 86, 28)
  fillRect(72, 9, 84, 20)
  // 「警」 (x=98..120)
  fillRect(99, 34, 119, 38)
  fillRect(101, 24, 117, 31)
  fillRect(100, 18, 118, 21)
  fillRect(102, 8, 116, 15)
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.ClampToEdgeWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.generateMipmaps = false
  tex.needsUpdate = true
  cachedOfficerBackTexture = tex
  return tex
}

/**
 * Installs a razor-sharp per-pixel GLSL overlay on `streetShading(..., true)` materials so
 * volunteer & traffic-officer reflective vests, police short-sleeve shirt details (epaulettes,
 * navy collar), back 「桂林交警」 placard, and duty trousers + black duty belt never blur across
 * sparse SkinnedMesh triangles (+0 Draw Calls).
 *
 * Early-returns without touching `onBeforeCompile` or `customProgramCacheKey` when no duty/officer
 * overlay is active, keeping player `DEFAULT_EQUIPPED_OUTFIT` rendering 100% bit-for-bit identical.
 */
function syncVolunteerClothShader(
  mat: THREE.Material,
  vestMode: 'none' | 'volunteer' | 'officer',
  dutyBottomMode: 'none' | 'volunteer' | 'officer',
  officerShirtActive: boolean,
): void {
  const std = mat as THREE.MeshStandardMaterial
  if (!std.userData?.clothing) return
  const vestValue = vestMode === 'officer' ? 2.0 : vestMode === 'volunteer' ? 1.0 : 0.0
  const bottomValue = dutyBottomMode === 'officer' ? 2.0 : dutyBottomMode === 'volunteer' ? 1.0 : 0.0
  const shirtValue = officerShirtActive ? 1.0 : 0.0
  if (vestValue === 0 && bottomValue === 0 && shirtValue === 0 && !std.userData.volunteerUniforms) return
  if (!std.userData.volunteerUniforms) {
    const uniforms = {
      uVolunteerVest: {value: vestValue},
      uDutyBottom: {value: bottomValue},
      uOfficerShirt: {value: shirtValue},
      uOfficerBackMap: {value: getOfficerBackTextTexture()},
    }
    std.userData.volunteerUniforms = uniforms
    const prevCompile = std.onBeforeCompile
    const prevKey = std.customProgramCacheKey
    std.customProgramCacheKey = () => (prevKey ? prevKey.call(std) : 'creator-cloth') + '-volunteer-r10'
    std.onBeforeCompile = (shader, renderer) => {
      prevCompile.call(std, shader, renderer)
      shader.uniforms.uVolunteerVest = uniforms.uVolunteerVest
      shader.uniforms.uDutyBottom = uniforms.uDutyBottom
      shader.uniforms.uOfficerShirt = uniforms.uOfficerShirt
      shader.uniforms.uOfficerBackMap = uniforms.uOfficerBackMap
      if (!shader.fragmentShader.includes('vec3 keyDir =')) return
      shader.fragmentShader =
        'uniform float uVolunteerVest;\nuniform float uDutyBottom;\nuniform float uOfficerShirt;\nuniform sampler2D uOfficerBackMap;\n' +
        shader.fragmentShader.replace(
          'vec3 keyDir =',
          `float _vax = abs(rest.x);
          bool _vFront = rest.z > 0.0;
          if (uVolunteerVest > 0.5 && uVolunteerVest < 1.5 && zone > 0.5 && zone < 1.5) {
            vec3 vNavy = vec3(0.010, 0.017, 0.033);
            vec3 vVest = vec3(0.690, 0.855, 0.014);
            vec3 vSilv = vec3(0.855, 0.905, 0.940);
            vec3 vRed  = vec3(0.675, 0.038, 0.026);
            if (_vax > 0.166) {
              if (rest.x > 0.220 && rest.x < 0.355) {
                diffuseColor.rgb = (abs(rest.x - 0.288) < 0.014 && rest.y > 1.425) ? vSilv : vRed;
              } else {
                diffuseColor.rgb = vNavy;
              }
            } else if (rest.y < 1.032) {
              diffuseColor.rgb = vNavy;
            } else if (_vFront && rest.y > 1.375 + 0.08 * min(1.0, _vax / 0.075)) {
              diffuseColor.rgb = vNavy;
            } else if (_vFront && _vax < 0.007 && rest.y >= 1.032) {
              diffuseColor.rgb = vec3(0.45, 0.49, 0.53);
            } else if ((rest.y >= 1.088 && rest.y <= 1.128) || (rest.y >= 1.248 && rest.y <= 1.288) || (_vax > 0.086 && _vax < 0.122 && rest.y > 1.288 && rest.y < 1.485)) {
              diffuseColor.rgb = vSilv;
            } else {
              diffuseColor.rgb = vVest;
            }
          }
          if (uOfficerShirt > 0.5 && zone > 0.5 && zone < 1.5 && _vax <= sleeve + 0.002) {
            vec3 pShirt = vec3(0.195, 0.479, 0.791);
            vec3 pNavy  = vec3(0.009, 0.019, 0.045);
            vec3 pSilv  = vec3(0.807, 0.855, 0.913);
            vec3 pBelt  = vec3(0.011, 0.014, 0.021);
            vec3 pBuck  = vec3(0.716, 0.776, 0.855);
            vec3 pPants = vec3(0.010, 0.020, 0.042);
            diffuseColor.rgb = pShirt;
            // Subtle dark-navy cuff hem at short-sleeve edge
            if (_vax > 0.340 && _vax <= 0.362) {
              diffuseColor.rgb = pNavy;
            }
            // Minimal dark-navy shield outline on anatomical left outer sleeve (+X in rest coords)
            if (rest.x > 0.232 && rest.x < 0.298 && rest.z < -0.025 && rest.y > 1.405 && rest.y < 1.472) {
              diffuseColor.rgb = pNavy;
            }
            // Navy shoulder epaulettes with dual geometric silver rank bars (zero real numbers)
            if (_vax >= 0.095 && _vax <= 0.214 && rest.y >= 1.445 && abs(rest.z + 0.052) <= 0.036) {
              bool pip = (abs(_vax - 0.138) < 0.009 || abs(_vax - 0.170) < 0.009) && abs(rest.z + 0.052) < 0.018;
              diffuseColor.rgb = pip ? pSilv : pNavy;
            }
            // Navy shirt collar & center tie/placket
            if ((rest.y >= 1.425 && _vax < 0.104) || (_vFront && rest.y >= 1.365 + 0.092 * min(1.0, _vax / 0.078) && _vax < 0.094)) {
              diffuseColor.rgb = pNavy;
            } else if (_vFront && _vax < 0.014 && rest.y >= 1.22 && rest.y < 1.43) {
              diffuseColor.rgb = pNavy;
            }
            // Black duty belt + matte silver buckle on visible outer waist hem (figure_m TOP_PRIMARY spans y=0.927..1.485)
            if (_vax <= 0.175 && rest.y < 0.985) {
              if (rest.y < 0.935) {
                diffuseColor.rgb = pPants;
              } else if (_vFront && _vax < 0.030 && rest.y >= 0.940 && rest.y <= 0.980) {
                bool inner = _vax < 0.016 && rest.y >= 0.948 && rest.y <= 0.972;
                diffuseColor.rgb = inner ? pBelt : pBuck;
              } else {
                diffuseColor.rgb = pBelt;
              }
            }
          }
          if (uVolunteerVest > 1.5 && zone > 0.5 && zone < 1.5 && _vax <= 0.172 && rest.y >= 0.985) {
            bool onEpaulette = _vax >= 0.095 && rest.y >= 1.445 && abs(rest.z + 0.052) <= 0.036;
            bool inFrontVNeck = _vFront && rest.y > 1.335 + 0.105 * min(1.0, _vax / 0.086);
            bool inBackCollar = !_vFront && rest.y >= 1.435 && _vax < 0.096;
            if (!onEpaulette && !inFrontVNeck && !inBackCollar) {
              vec3 oNavy = vec3(0.009, 0.019, 0.045);
              vec3 oVest = vec3(0.604, 0.855, 0.012);
              vec3 oSilv = vec3(0.807, 0.855, 0.913);
              vec3 oZip  = vec3(0.074, 0.095, 0.122);
              vec3 oBadgeNavy = vec3(0.008, 0.020, 0.061);
              vec3 oBlankPlate = vec3(0.624, 0.694, 0.776);
              if (rest.y < 1.003) {
                // Dark-navy vest bottom binding resting flush on top of black duty belt
                diffuseColor.rgb = oNavy;
              } else if (_vFront && _vax < 0.007) {
                diffuseColor.rgb = oZip;
              } else if (!_vFront && _vax <= 0.128 && rest.y >= 1.264 && rest.y <= 1.366) {
                // Back silver reflective placard printed with bold non-mirrored 「桂林交警」
                bool border = _vax > 0.123 || rest.y < 1.270 || rest.y > 1.360;
                if (border) {
                  diffuseColor.rgb = oNavy;
                } else {
                  vec2 _buv = vec2((0.122 - rest.x) / 0.244, (rest.y - 1.270) / 0.090);
                  if (_buv.x >= 0.0 && _buv.x <= 1.0 && _buv.y >= 0.0 && _buv.y <= 1.0) {
                    vec4 _bt = texture2D(uOfficerBackMap, _buv);
                    diffuseColor.rgb = mix(oSilv, _bt.rgb, _bt.a);
                  } else {
                    diffuseColor.rgb = oSilv;
                  }
                }
              } else if (_vFront && rest.x >= 0.030 && rest.x <= 0.080 && rest.y >= 1.285 && rest.y <= 1.318) {
                // Anatomical left chest (+X in rest coords): dark navy officer tab
                diffuseColor.rgb = (rest.y > 1.298 && rest.y < 1.306 && rest.x > 0.036 && rest.x < 0.074) ? oSilv : oBadgeNavy;
              } else if (_vFront && rest.x <= -0.032 && rest.x >= -0.080 && rest.y >= 1.287 && rest.y <= 1.316) {
                // Anatomical right chest (-X in rest coords): blank silver-blue placeholder (zero real IDs)
                bool rBorder = rest.x > -0.036 || rest.x < -0.076 || rest.y < 1.291 || rest.y > 1.312;
                diffuseColor.rgb = rBorder ? oNavy : oBlankPlate;
              } else if ((rest.y >= 1.055 && rest.y <= 1.125) || (_vax >= 0.086 && _vax <= 0.116 && rest.y > 1.125 && rest.y <= 1.448)) {
                // Lengthened spec layout: dual vertical shoulder reflective bands + wide 360° waist reflective band
                diffuseColor.rgb = oSilv;
              } else {
                diffuseColor.rgb = oVest;
              }
            }
          }
          if (uDutyBottom > 0.5 && uDutyBottom < 1.5 && zone > 1.5 && zone < 2.5 && rest.y > 0.125) {
            diffuseColor.rgb = vec3(0.010, 0.017, 0.033);
            if (rest.y > 0.945 && rest.y < 0.985) {
              diffuseColor.rgb = (_vFront && _vax < 0.028) ? vec3(0.68, 0.72, 0.76) : vec3(0.008, 0.011, 0.018);
            }
          }
          if (uDutyBottom > 1.5 && zone > 1.5 && zone < 2.5 && rest.y > 0.125) {
            // Police dark-navy trousers + matte-black duty belt (#1b2028) with silver buckle (#dce4ee)
            vec3 tNavy = vec3(0.010, 0.020, 0.042);
            vec3 tBelt = vec3(0.011, 0.014, 0.021);
            diffuseColor.rgb = (_vax > 0.148 && abs(rest.z + 0.015) < 0.011) ? vec3(0.019, 0.045, 0.112) : tNavy;
            if (rest.y >= 0.940 && rest.y <= 0.996) {
              if (_vFront && _vax < 0.028) {
                diffuseColor.rgb = (_vax < 0.014 && rest.y > 0.950 && rest.y < 0.984) ? tBelt : vec3(0.716, 0.776, 0.855);
              } else {
                diffuseColor.rgb = tBelt;
              }
            }
          }
          vec3 keyDir =`,
        )
    }
    std.needsUpdate = true
  } else {
    const uniforms = std.userData.volunteerUniforms as {
      uVolunteerVest: {value: number}
      uDutyBottom: {value: number}
      uOfficerShirt: {value: number}
      uOfficerBackMap: {value: THREE.Texture}
    }
    uniforms.uVolunteerVest.value = vestValue
    uniforms.uDutyBottom.value = bottomValue
    uniforms.uOfficerShirt.value = shirtValue
  }
}

/**
 * Runtime avatar wardrobe applier attached to `figure` + `AvatarRig`.
 * Handles `+0` Draw Call `COLOR_0` updates, `BUILTIN_PACK` toggling, and cached `head`/`torso` accessories.
 */
export function createAvatarOutfitController(figure: THREE.Group, rig: AvatarRig): AvatarOutfitController {
  const skinned = rig.skinnedMesh
  const partition = skinned && rig.isSkinned ? partitionCityWalkerGeometry(skinned) : null
  const skirt=figure.getObjectByName('creator-skirt')
  const fullIndex=skinned?.geometry.index
  let skirtIndex:THREE.BufferAttribute|undefined
  if(skirt && partition && fullIndex){
    const visible:number[]=[]
    for(let t=0;t<partition.bodyIndexCount;t+=3){
      const tri=[fullIndex.getX(t),fullIndex.getX(t+1),fullIndex.getX(t+2)]
      if(!tri.every(i=>skinned!.geometry.attributes.position.getY(i)>.50 && (partition.zones[i]===OUTFIT_ZONE.BOTTOM_MAIN || partition.zones[i]===OUTFIT_ZONE.BOTTOM_BELT)))visible.push(...tri)
    }
    skirtIndex=new THREE.Uint16BufferAttribute(visible,1)
  }
  const garmentRest = figure.userData.creatorBody && skinned ? skinned.geometry.attributes.position.clone() : null
  const hatCache = new Map<string, THREE.Mesh | null>()
  const bagCache = new Map<string, THREE.Mesh | null>()

  let savedEquipped: EquippedOutfit = {...DEFAULT_EQUIPPED_OUTFIT}
  let previewOutfit: EquippedOutfit | null = null
  let appliedOutfit: EquippedOutfit = {...DEFAULT_EQUIPPED_OUTFIT}
  let ridingEbike = false
  let autoHelmetOnRide = true
  let vestModeOverride: ReflectiveVestMode = 'auto'
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

  function resolveEffectiveVestMode(topId: string): 'none' | 'volunteer' | 'officer' {
    if (vestModeOverride !== 'auto') return vestModeOverride
    if (topId === 'top_traffic_police_shirt') return 'officer'
    if (topId === 'top_traffic_volunteer') return 'volunteer'
    return 'none'
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

    const skin = figure.userData.characterSkin ? new THREE.Color(figure.userData.characterSkin) : null
    const zones = partition.zones
    const orig = partition.originalColors
    const female = figure.userData.creatorBody === 'f'
    const position = skinned.geometry.attributes.position
    if (female && outfit.top === 'top_starter_chinese') cPrimary.set('#dbc8cc')
    if (female && outfit.bottom === 'bottom_starter_sport') cBottom.set('#62778a')
    if (female && outfit.top === 'top_starter_office') cPrimary.set('#e4e1d6')
    // Stored starter IDs predate the street wardrobe. Preserve them for existing saves.
    const summerTop = outfit.top === 'top_starter_sport'
    const shortSleeve =
      summerTop ||
      outfit.top === 'top_starter_outdoor' ||
      (!female && outfit.top === 'top_starter_office') ||
      outfit.top === 'top_traffic_police_shirt'
    const shorts = outfit.bottom === 'bottom_starter_sport' || outfit.bottom === 'bottom_starter_outdoor' || (female && outfit.bottom === 'bottom_starter_knit')
    const wideLeg = female && outfit.bottom === 'bottom_starter_chinese'
    const starterTop = outfit.top.startsWith('top_starter_') || outfit.top === 'top_default_tee'
    const starterBottom = outfit.bottom.startsWith('bottom_starter_') || outfit.bottom === 'bottom_default_pants'
    const uniforms = (skinned.material as THREE.Material).userData?.clothing
    const effectiveVest = resolveEffectiveVestMode(outfit.top)
    const dutyBottomMode: 'none' | 'volunteer' | 'officer' =
      outfit.bottom === 'bottom_police_trousers'
        ? 'officer'
        : outfit.bottom === 'bottom_traffic_duty'
          ? 'volunteer'
          : 'none'
    syncVolunteerClothShader(
      skinned.material as THREE.Material,
      effectiveVest,
      dutyBottomMode,
      outfit.top === 'top_traffic_police_shirt',
    )
    if (uniforms && skin) {
      if (!skinned.geometry.hasAttribute('clothZone')) {
        const ids = Float32Array.from(zones, z => [OUTFIT_ZONE.TOP_PRIMARY,OUTFIT_ZONE.TOP_SLEEVE,OUTFIT_ZONE.TOP_TRIM,OUTFIT_ZONE.TOP_INNER].some(v=>v===z) ? 1 :
          z===OUTFIT_ZONE.BOTTOM_MAIN || z===OUTFIT_ZONE.BOTTOM_BELT ? 2 : z===OUTFIT_ZONE.SHOES_UPPER ? 3 : 0)
        skinned.geometry.setAttribute('clothZone',new THREE.BufferAttribute(ids,1))
      }
      uniforms.schoolTop.value = Number(outfit.top === 'top_starter_campus')
      uniforms.skinTone.value.copy(skin)
      uniforms.sleeve.value = summerTop && !female ? .145 : shortSleeve ? .36 : 1
      uniforms.shortHem.value = shorts ? .56 : 0
      uniforms.sandal.value = Number(outfit.shoes==='shoes_starter_sport')
      // IDOK-229 present-day starter looks: printed detail in the clothing shader (no extra geometry/draws).
      const pattern = STARTER_PATTERNS[outfit.top] ?? 0
      uniforms.pattern.value = pattern
      const accent = resolveOutfitItemDef(outfit.top)?.accentHex ?? '#efece4'
      uniforms.patA.value.set(pattern === 2 ? '#ebe8e0' : accent)
      uniforms.patB.value.set(accent)
      uniforms.legStripe.value = Number(outfit.bottom === 'bottom_starter_track')
    }
    for (let i = 0; i < zones.length; i++) {
      const z = zones[i]
      if (garmentRest && (z === OUTFIT_ZONE.TOP_SLEEVE || z === OUTFIT_ZONE.TOP_PRIMARY) && Math.abs(garmentRest.getX(i)) > .37) {
        const x = garmentRest.getX(i), y = garmentRest.getY(i), depth = garmentRest.getZ(i)
        const scale = shortSleeve ? 1 - .39*THREE.MathUtils.smoothstep(Math.abs(x),.40,.747) : 1
        position.setXYZ(i,x,1.44 + (y-1.44)*scale,-.059+(depth+.059)*scale)
      }
      if (garmentRest && z === OUTFIT_ZONE.BOTTOM_MAIN) {
        const x = garmentRest.getX(i), y = garmentRest.getY(i), depth = garmentRest.getZ(i)
        const scale = y < .85 ? (shorts && y < .55 ? .79 : wideLeg ? 1.16 : 1) : 1
        const mid = Math.sign(x) * .092
        position.setXYZ(i, mid + (x-mid)*scale, y, -.014+(depth+.014)*scale)
      }
      if (z === OUTFIT_ZONE.LOCKED_SKIN || z === OUTFIT_ZONE.LOCKED_HAIR) {
        if (skin && z === OUTFIT_ZONE.LOCKED_SKIN) colAttr.setXYZ(i,skin.r,skin.g,skin.b)
        else colAttr.setXYZ(i, orig[i * 3], orig[i * 3 + 1], orig[i * 3 + 2])
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
      if (skin && figure.userData.creatorBody) {
        const shirt = z === OUTFIT_ZONE.TOP_PRIMARY || z === OUTFIT_ZONE.TOP_SLEEVE || z === OUTFIT_ZONE.TOP_TRIM || z === OUTFIT_ZONE.TOP_INNER
        if (shirt && starterTop) _tmpColor.copy(cPrimary)
        if (z === OUTFIT_ZONE.BOTTOM_BELT && starterBottom) _tmpColor.copy(cBottom)
      }
      if (outfit.top === 'top_traffic_volunteer') {
        const vx = position.getX(i)
        const vy = position.getY(i)
        if (z === OUTFIT_ZONE.TOP_PRIMARY || z === OUTFIT_ZONE.TOP_TRIM || z === OUTFIT_ZONE.TOP_INNER) {
          // Fallback vertex assignment for legacy unshaded figure.glb (live figure_m/f use razor-sharp GLSL overlay)
          if (vy < 1.03 || (vy > 1.38 && Math.abs(vx) < 0.075)) _tmpColor.set('#192332')
          else if (vy >= 1.25 && vy <= 1.33) _tmpColor.set('#eef4f8')
          else _tmpColor.set('#d8ee1e')
        } else if (z === OUTFIT_ZONE.TOP_SLEEVE && vx > 0.22 && vx < 0.36) {
          _tmpColor.set('#d6362c')
        }
      } else if (outfit.top === 'top_traffic_police_shirt') {
        const vx = position.getX(i)
        const vy = position.getY(i)
        if (z === OUTFIT_ZONE.TOP_PRIMARY || z === OUTFIT_ZONE.TOP_TRIM || z === OUTFIT_ZONE.TOP_INNER) {
          if (vy < 0.935) _tmpColor.set('#1a263a')
          else if (vy < 0.985) _tmpColor.set('#1b2028')
          else if (vy >= 1.44 && Math.abs(vx) >= 0.095) _tmpColor.set('#18253c')
          else if (vy > 1.37 && Math.abs(vx) < 0.085) _tmpColor.set('#18253c')
          else if (effectiveVest === 'officer' && vy >= 0.985 && vy <= 1.43 && Math.abs(vx) <= 0.172) {
            if (vy < 1.003) _tmpColor.set('#18253c')
            else if (vy >= 1.055 && vy <= 1.125) _tmpColor.set('#e8eef5')
            else _tmpColor.set('#ccee1c')
          } else {
            _tmpColor.set('#7ab8e6')
          }
        }
      }
      colAttr.setXYZ(i, _tmpColor.r, _tmpColor.g, _tmpColor.b)
    }
    if (garmentRest) position.needsUpdate = true
    colAttr.needsUpdate = true
  }

  function syncAccessories(outfit: Readonly<EquippedOutfit>): void {
    // IDOK-133 (Rock): no backpack by default — the pack modelled into figure.glb is never shown.
    const showBuiltin = false
    builtinPackVisible = showBuiltin
    if (skinned && partition) {
      skinned.geometry.setDrawRange(0, showBuiltin ? partition.totalIndexCount : partition.bodyIndexCount)
    }

    const hair = rig.attachments.head?.getObjectByName('creator-hair')
    if (hair) hair.visible = outfit.hat === 'hat_none'
    if(skirt && skirtIndex && fullIndex && skinned){
      skirt.visible=outfit.bottom==='bottom_starter_outdoor'||outfit.bottom==='bottom_starter_knit'
      // 针织开衫 (female) pairs with a brown pleated midi skirt; 短袖 T 恤 keeps the sage knee skirt.
      ;(((skirt as THREE.Mesh).material) as THREE.MeshStandardMaterial).color.set(outfit.bottom==='bottom_starter_knit'?'#7d604c':'#72776d')
      skinned.geometry.setIndex(skirt.visible?skirtIndex:fullIndex)
      if(skirt.visible)skinned.geometry.setDrawRange(0,skirtIndex.count)
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
    figure.userData.starterDetails?.apply(effective)
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
      if (opts?.vestMode !== undefined) vestModeOverride = opts.vestMode
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
    setVestMode(mode) {
      if (vestModeOverride === mode) return
      vestModeOverride = mode
      render()
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
