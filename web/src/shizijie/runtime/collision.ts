import {
  SZJ_FRAME,
  SZJ_PLAYER,
  SZJ_STAIRWELLS,
  SZJ_STAIR_SPEC,
  indoorToStairLocal,
  stairLocalToIndoor,
  stairTreadY,
  type SzjCorridor,
  type SzjLayout,
  type SzjRect,
  type SzjShop,
  type SzjStairId,
  type SzjStairwell,
  type SzjXZ,
} from '../contract.ts'

export interface Aabb2D {
  readonly id: string
  readonly minX: number
  readonly maxX: number
  readonly minZ: number
  readonly maxZ: number
}

export interface CapsuleSegment2D {
  readonly id: string
  readonly ax: number
  readonly az: number
  readonly bx: number
  readonly bz: number
  readonly halfWidth: number
}

export interface SzjIndoorCollisionWorld {
  readonly radiusM: number
  readonly eyeHeightM: number
  readonly ceilingHeightM: number
  readonly minPitchRad: number
  readonly maxPitchRad: number
  readonly corridorSegments: readonly CapsuleSegment2D[]
  readonly shopWalkBoxes: readonly Aabb2D[]
  readonly solidColumns: readonly Aabb2D[]
}

export interface SzjIndoorMoveResult {
  readonly x: number
  readonly footY: number
  readonly z: number
  readonly ceilingClearanceM: number
  readonly hitWall: boolean
  readonly hitIds: readonly string[]
  readonly activeStair: SzjStairwell | null
  readonly activeStairLocalZ: number | null
  readonly activeShopId: string | null
}

export function rectToAabb(id: string, r: SzjRect): Aabb2D {
  return {
    id,
    minX: r.x - r.w * 0.5,
    maxX: r.x + r.w * 0.5,
    minZ: r.z - r.d * 0.5,
    maxZ: r.z + r.d * 0.5,
  }
}

export function closestPointOnSegment(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): { x: number; z: number; t: number; distSq: number } {
  const vx = bx - ax
  const vz = bz - az
  const lenSq = vx * vx + vz * vz
  if (lenSq <= 1e-12) {
    const dx = px - ax
    const dz = pz - az
    return { x: ax, z: az, t: 0, distSq: dx * dx + dz * dz }
  }
  const rawT = ((px - ax) * vx + (pz - az) * vz) / lenSq
  const t = Math.max(0, Math.min(1, rawT))
  const qx = ax + t * vx
  const qz = az + t * vz
  const dx = px - qx
  const dz = pz - qz
  return { x: qx, z: qz, t, distSq: dx * dx + dz * dz }
}

export function closestPointOnCorridor(px: number, pz: number, corr: SzjCorridor): SzjXZ {
  let bestX = corr.points[0]?.x ?? px
  let bestZ = corr.points[0]?.z ?? pz
  let bestDistSq = Infinity
  for (let i = 0; i + 1 < corr.points.length; i++) {
    const a = corr.points[i]!
    const b = corr.points[i + 1]!
    const hit = closestPointOnSegment(px, pz, a.x, a.z, b.x, b.z)
    if (hit.distSq < bestDistSq) {
      bestDistSq = hit.distSq
      bestX = hit.x
      bestZ = hit.z
    }
  }
  return { x: bestX, z: bestZ }
}

export function buildSzjCollisionWorld(
  layout: SzjLayout,
  radiusM: number = SZJ_PLAYER.radius,
  eyeHeightM: number = SZJ_PLAYER.eyeHeight,
): SzjIndoorCollisionWorld {
  const corridorById = new Map<string, SzjCorridor>()
  const corridorSegments: CapsuleSegment2D[] = []

  for (const c of layout.corridors) {
    corridorById.set(c.id, c)
    const halfWidth = Math.max(radiusM + 0.05, c.width * 0.5)
    for (let i = 0; i + 1 < c.points.length; i++) {
      const a = c.points[i]!
      const b = c.points[i + 1]!
      corridorSegments.push({
        id: `${c.id}#${i}`,
        ax: a.x,
        az: a.z,
        bx: b.x,
        bz: b.z,
        halfWidth,
      })
    }
  }

  const shopWalkBoxes: Aabb2D[] = []
  for (const shop of layout.shops) {
    const sb = rectToAabb(shop.id, shop.rect)
    if (sb.maxX - sb.minX > radiusM * 2.2 && sb.maxZ - sb.minZ > radiusM * 2.2) {
      shopWalkBoxes.push({
        id: `${shop.id}-interior`,
        minX: sb.minX + radiusM,
        maxX: sb.maxX - radiusM,
        minZ: sb.minZ + radiusM,
        maxZ: sb.maxZ - radiusM,
      })
    }
    const frontCorr = corridorById.get(shop.frontage)
    if (frontCorr) {
      const near = closestPointOnCorridor(shop.rect.x, shop.rect.z, frontCorr)
      const dx = near.x - shop.rect.x
      const dz = near.z - shop.rect.z
      const facingZ = Math.abs(dz) >= Math.abs(dx)
      if (facingZ) {
        const halfDoor = Math.max(radiusM + 0.1, shop.rect.w * 0.5 - radiusM - 0.08)
        shopWalkBoxes.push({
          id: `${shop.id}-door`,
          minX: shop.rect.x - halfDoor,
          maxX: shop.rect.x + halfDoor,
          minZ: Math.min(shop.rect.z, near.z),
          maxZ: Math.max(shop.rect.z, near.z),
        })
      } else {
        const halfDoor = Math.max(radiusM + 0.1, shop.rect.d * 0.5 - radiusM - 0.08)
        shopWalkBoxes.push({
          id: `${shop.id}-door`,
          minX: Math.min(shop.rect.x, near.x),
          maxX: Math.max(shop.rect.x, near.x),
          minZ: shop.rect.z - halfDoor,
          maxZ: shop.rect.z + halfDoor,
        })
      }
    }
  }

  const solidColumns: Aabb2D[] = []
  if (layout.columns.size > 0) {
    const halfCol = layout.columns.size * 0.5
    for (const cx of layout.columns.xs) {
      for (const cz of layout.columns.zs) {
        const nearStair = SZJ_STAIRWELLS.some(
          st =>
            Math.hypot(st.footIndoor.x - cx, st.footIndoor.z - cz) < st.width + halfCol ||
            Math.hypot(st.indoor.x - cx, st.indoor.z - cz) < st.length * 0.6 + halfCol,
        )
        if (nearStair) continue
        solidColumns.push({
          id: `col-${cx}-${cz}`,
          minX: cx - halfCol,
          maxX: cx + halfCol,
          minZ: cz - halfCol,
          maxZ: cz + halfCol,
        })
      }
    }
  }

  return Object.freeze<SzjIndoorCollisionWorld>({
    radiusM,
    eyeHeightM,
    ceilingHeightM: layout.ceilingHeight,
    minPitchRad: -1.12,
    maxPitchRad: 1.12,
    corridorSegments: Object.freeze(corridorSegments),
    shopWalkBoxes: Object.freeze(shopWalkBoxes),
    solidColumns: Object.freeze(solidColumns),
  })
}

export function locateStairwellAt(
  px: number,
  pz: number,
  extraSideM = 0.05,
): { stair: SzjStairwell; lx: number; lz: number } | null {
  for (const st of SZJ_STAIRWELLS) {
    const l = indoorToStairLocal(st, { x: px, z: pz })
    const hw = st.width * 0.5 + extraSideM
    const minLz = -st.length * 0.5 - 0.6
    const maxLz = st.length * 0.5 + st.profile.landingFoot + 0.1
    if (Math.abs(l.x) <= hw && l.z >= minLz && l.z <= maxLz) {
      return { stair: st, lx: l.x, lz: l.z }
    }
  }
  return null
}

function projectOntoStairWalkable(
  st: SzjStairwell,
  px: number,
  pz: number,
  radiusM: number,
): { x: number; z: number; distSq: number } {
  const l = indoorToStairLocal(st, { x: px, z: pz })
  const maxLx = Math.max(0.05, st.width * 0.5 - radiusM)
  const minLz = -st.length * 0.5
  const maxLz = st.length * 0.5 + st.profile.landingFoot
  const clx = Math.max(-maxLx, Math.min(maxLx, l.x))
  const clz = Math.max(minLz, Math.min(maxLz, l.z))
  const dx = l.x - clx
  const dz = l.z - clz
  const distSq = dx * dx + dz * dz
  if (distSq <= 1e-12) {
    return { x: px, z: pz, distSq: 0 }
  }
  const world = stairLocalToIndoor(st, { x: clx, z: clz })
  return { x: world.x, z: world.z, distSq }
}

function projectIntoWalkableSpace(
  world: SzjIndoorCollisionWorld,
  px: number,
  pz: number,
  lockedStair: SzjStairwell | null,
): { x: number; z: number; clamped: boolean } {
  const r = world.radiusM

  if (lockedStair) {
    const p = projectOntoStairWalkable(lockedStair, px, pz, r)
    return { x: p.x, z: p.z, clamped: p.distSq > 1e-10 }
  }

  // 1. Check exact containment in any corridor segment, stairwell, or shop box
  for (const seg of world.corridorSegments) {
    const allow = Math.max(0.05, seg.halfWidth - r)
    const hit = closestPointOnSegment(px, pz, seg.ax, seg.az, seg.bx, seg.bz)
    if (hit.distSq <= allow * allow) {
      return { x: px, z: pz, clamped: false }
    }
  }
  for (const st of SZJ_STAIRWELLS) {
    const p = projectOntoStairWalkable(st, px, pz, r)
    if (p.distSq <= 1e-10) {
      return { x: px, z: pz, clamped: false }
    }
  }
  for (const box of world.shopWalkBoxes) {
    if (px >= box.minX && px <= box.maxX && pz >= box.minZ && pz <= box.maxZ) {
      return { x: px, z: pz, clamped: false }
    }
  }

  // 2. Project onto closest boundary across all walkable primitives
  let bestX = px
  let bestZ = pz
  let bestDistSq = Infinity

  for (const seg of world.corridorSegments) {
    const allow = Math.max(0.05, seg.halfWidth - r)
    const hit = closestPointOnSegment(px, pz, seg.ax, seg.az, seg.bx, seg.bz)
    const dist = Math.sqrt(hit.distSq)
    const candX = dist > 1e-9 ? hit.x + ((px - hit.x) / dist) * allow : hit.x
    const candZ = dist > 1e-9 ? hit.z + ((pz - hit.z) / dist) * allow : hit.z
    const dSq = (px - candX) * (px - candX) + (pz - candZ) * (pz - candZ)
    if (dSq < bestDistSq) {
      bestDistSq = dSq
      bestX = candX
      bestZ = candZ
    }
  }

  for (const st of SZJ_STAIRWELLS) {
    const p = projectOntoStairWalkable(st, px, pz, r)
    if (p.distSq < bestDistSq) {
      bestDistSq = p.distSq
      bestX = p.x
      bestZ = p.z
    }
  }

  for (const box of world.shopWalkBoxes) {
    const cx = Math.max(box.minX, Math.min(px, box.maxX))
    const cz = Math.max(box.minZ, Math.min(pz, box.maxZ))
    const dSq = (px - cx) * (px - cx) + (pz - cz) * (pz - cz)
    if (dSq < bestDistSq) {
      bestDistSq = dSq
      bestX = cx
      bestZ = cz
    }
  }

  return { x: bestX, z: bestZ, clamped: true }
}

function pushCircleOutOfAabb(
  px: number,
  pz: number,
  r: number,
  box: Aabb2D,
): { x: number; z: number; hit: boolean } {
  const cx = Math.max(box.minX, Math.min(px, box.maxX))
  const cz = Math.max(box.minZ, Math.min(pz, box.maxZ))
  const dx = px - cx
  const dz = pz - cz
  const distSq = dx * dx + dz * dz
  if (distSq >= r * r) return { x: px, z: pz, hit: false }

  if (distSq < 1e-10) {
    const l = px - box.minX + r
    const rt = box.maxX - px + r
    const s = pz - box.minZ + r
    const n = box.maxZ - pz + r
    const m = Math.min(l, rt, s, n)
    if (m === l) return { x: box.minX - r, z: pz, hit: true }
    if (m === rt) return { x: box.maxX + r, z: pz, hit: true }
    if (m === s) return { x: px, z: box.minZ - r, hit: true }
    return { x: px, z: box.maxZ + r, hit: true }
  }

  const dist = Math.sqrt(distSq)
  const pen = r - dist
  return {
    x: px + (dx / dist) * pen,
    z: pz + (dz / dist) * pen,
    hit: true,
  }
}

export function detectActiveSzjShop(layout: SzjLayout, px: number, pz: number): SzjShop | null {
  for (const s of layout.shops) {
    const b = rectToAabb(s.id, s.rect)
    if (px >= b.minX && px <= b.maxX && pz >= b.minZ && pz <= b.maxZ) {
      return s
    }
  }
  return null
}

export function resolveSzjIndoorMovement(
  world: SzjIndoorCollisionWorld,
  layout: SzjLayout,
  prevX: number,
  prevZ: number,
  prevFootY: number,
  dx: number,
  dz: number,
): SzjIndoorMoveResult {
  const totalDist = Math.hypot(dx, dz)
  const maxStep = Math.max(0.08, world.radiusM * 0.45)
  const steps = Math.max(1, Math.ceil(totalDist / maxStep))
  const stepDx = dx / steps
  const stepDz = dz / steps

  let x = prevX
  let z = prevZ
  let footY = prevFootY
  const hitSet = new Set<string>()

  for (let s = 0; s < steps; s++) {
    const prevStairHit = locateStairwellAt(x, z, 0.08)
    // While elevated above the bottom 3 risers of a stairwell, lock laterally inside that stairwell's walls
    const lockedStair =
      prevStairHit && footY > SZJ_STAIR_SPEC.riser * 3 ? prevStairHit.stair : null

    x += stepDx
    z += stepDz

    const proj = projectIntoWalkableSpace(world, x, z, lockedStair)
    if (proj.clamped) {
      x = proj.x
      z = proj.z
      hitSet.add(lockedStair ? `stair-wall-${lockedStair.id}` : 'perimeter-wall')
    }

    if (!lockedStair) {
      for (const col of world.solidColumns) {
        const res = pushCircleOutOfAabb(x, z, world.radiusM, col)
        if (res.hit) {
          x = res.x
          z = res.z
          hitSet.add(col.id)
        }
      }
      const postProj = projectIntoWalkableSpace(world, x, z, null)
      if (postProj.clamped) {
        x = postProj.x
        z = postProj.z
        hitSet.add('perimeter-wall')
      }
    }

    const curStair = locateStairwellAt(x, z, 0.02)
    footY = curStair ? stairTreadY(curStair.stair, curStair.lz) : SZJ_FRAME.indoorFloorY
  }

  const finalStair = locateStairwellAt(x, z, 0.02)
  const finalFootY = finalStair ? stairTreadY(finalStair.stair, finalStair.lz) : SZJ_FRAME.indoorFloorY
  const activeShop = finalStair ? null : detectActiveSzjShop(layout, x, z)
  const clearance =
    finalStair && finalFootY > SZJ_FRAME.indoorFloorY
      ? Math.max(0.8, world.ceilingHeightM - world.eyeHeightM)
      : Math.round((world.ceilingHeightM - world.eyeHeightM) * 1000) / 1000

  return {
    x,
    footY: finalFootY,
    z,
    ceilingClearanceM: clearance,
    hitWall: hitSet.size > 0,
    hitIds: [...hitSet],
    activeStair: finalStair ? finalStair.stair : null,
    activeStairLocalZ: finalStair ? finalStair.lz : null,
    activeShopId: activeShop ? activeShop.id : null,
  }
}

export function clampSzjPitch(world: SzjIndoorCollisionWorld, pitchRad: number): number {
  return Math.max(world.minPitchRad, Math.min(world.maxPitchRad, pitchRad))
}

export function getStairSpeedScale(st: SzjStairwell | null, lz: number | null, vx: number, vz: number): number {
  if (!st || lz === null) return 1
  if (lz >= st.length * 0.5) return 1
  const dot = vx * st.inward.x + vz * st.inward.z
  if (dot < -1e-4) return SZJ_PLAYER.stairUpSpeedScale
  if (dot > 1e-4) return SZJ_PLAYER.stairDownSpeedScale
  return 1
}

export function isValidStairId(id: unknown): id is SzjStairId {
  return id === 'nw' || id === 'ne' || id === 'se' || id === 'sw'
}
