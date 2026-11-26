import {
  XXG_PLAYER,
  type XxgCorridor,
  type XxgExit,
  type XxgLayout,
  type XxgRect,
  type XxgShop,
} from '../contract.ts'

export interface Aabb2D {
  readonly id: string
  readonly minX: number
  readonly maxX: number
  readonly minZ: number
  readonly maxZ: number
}

export interface WalkableRegion2D extends Aabb2D {
  readonly kind: 'corridor' | 'empty-shop'
}

export interface IndoorCollisionWorld {
  readonly radiusM: number
  readonly eyeHeightM: number
  readonly ceilingHeightM: number
  readonly minPitchRad: number
  readonly maxPitchRad: number
  readonly walkableRegions: readonly WalkableRegion2D[]
  readonly shrunkWalkableRegions: readonly WalkableRegion2D[]
  readonly solidObstacles: readonly Aabb2D[]
}

export interface IndoorMoveResult {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly eyeY: number
  readonly ceilingClearanceM: number
  readonly hitWall: boolean
  readonly hitIds: readonly string[]
  readonly activeShopId: string | null
}

export function corridorToAabb(c: XxgCorridor): Aabb2D {
  const dx = Math.abs(c.to.x - c.from.x)
  const dz = Math.abs(c.to.z - c.from.z)
  const halfW = c.width * 0.5
  if (dx >= dz) {
    return {
      id: c.id,
      minX: Math.min(c.from.x, c.to.x),
      maxX: Math.max(c.from.x, c.to.x),
      minZ: (c.from.z + c.to.z) * 0.5 - halfW,
      maxZ: (c.from.z + c.to.z) * 0.5 + halfW,
    }
  }
  return {
    id: c.id,
    minX: (c.from.x + c.to.x) * 0.5 - halfW,
    maxX: (c.from.x + c.to.x) * 0.5 + halfW,
    minZ: Math.min(c.from.z, c.to.z),
    maxZ: Math.max(c.from.z, c.to.z),
  }
}

export function rectToAabb(id: string, r: XxgRect): Aabb2D {
  return {
    id,
    minX: r.x - r.w * 0.5,
    maxX: r.x + r.w * 0.5,
    minZ: r.z - r.d * 0.5,
    maxZ: r.z + r.d * 0.5,
  }
}

/**
 * Determines whether a shop bay is an open walk-in greybox bay (no tenant name yet)
 * and expands its walkable box slightly into its frontage corridor so players can walk smoothly across the threshold.
 */
function buildEmptyShopWalkableRegion(shop: XxgShop, corridorsById: ReadonlyMap<string, Aabb2D>): WalkableRegion2D {
  const base = rectToAabb(shop.id, shop.rect)
  const front = corridorsById.get(shop.frontage)
  const jambInset = Math.min(0.35, Math.min(shop.rect.w, shop.rect.d) * 0.08)
  if (!front) {
    return { ...base, kind: 'empty-shop' }
  }
  const nearX = Math.max(front.minX, Math.min(shop.rect.x, front.maxX))
  const nearZ = Math.max(front.minZ, Math.min(shop.rect.z, front.maxZ))
  const dx = nearX - shop.rect.x
  const dz = nearZ - shop.rect.z

  // Extend 1.1m into the frontage corridor across the shopfront opening so shrunk regions overlap seamlessly
  if (Math.abs(dx) > Math.abs(dz)) {
    return {
      id: shop.id,
      kind: 'empty-shop',
      minX: dx < 0 ? Math.min(base.minX, front.maxX - 1.1) : base.minX,
      maxX: dx > 0 ? Math.max(base.maxX, front.minX + 1.1) : base.maxX,
      minZ: base.minZ + jambInset,
      maxZ: base.maxZ - jambInset,
    }
  }
  return {
    id: shop.id,
    kind: 'empty-shop',
    minX: base.minX + jambInset,
    maxX: base.maxX - jambInset,
    minZ: dz < 0 ? Math.min(base.minZ, front.maxZ - 1.1) : base.minZ,
    maxZ: dz > 0 ? Math.max(base.maxZ, front.minZ + 1.1) : base.maxZ,
  }
}

export function buildIndoorCollisionWorld(
  layout: XxgLayout,
  radiusM: number = XXG_PLAYER.radius,
  eyeHeightM: number = XXG_PLAYER.eyeHeight,
): IndoorCollisionWorld {
  const corridorsById = new Map<string, Aabb2D>()
  const walkableRegions: WalkableRegion2D[] = []

  for (const c of layout.corridors) {
    const box = corridorToAabb(c)
    corridorsById.set(c.id, box)
    walkableRegions.push({ ...box, kind: 'corridor' })
  }

  // Also ensure every exit foot has walkable connector pad to its nearest corridor
  for (const ex of layout.exits) {
    walkableRegions.push({
      id: `exit-pad-${ex.portalId}`,
      kind: 'corridor',
      minX: ex.foot.x - 1.9,
      maxX: ex.foot.x + 1.9,
      minZ: ex.foot.z - 1.9,
      maxZ: ex.foot.z + 1.9,
    })
  }

  const solidObstacles: Aabb2D[] = []

  for (const shop of layout.shops) {
    const isEmptyBay = !shop.name || shop.name.trim().length === 0
    if (isEmptyBay) {
      walkableRegions.push(buildEmptyShopWalkableRegion(shop, corridorsById))
    } else {
      solidObstacles.push(rectToAabb(`shop-${shop.id}`, shop.rect))
    }
  }

  // Exit stairs are solid non-walkable AABBs per contract.ts:308
  for (const ex of layout.exits) {
    solidObstacles.push(rectToAabb(`stair-${ex.portalId}`, ex.stair))
  }

  // Structural column grid AABBs (only those overlapping walkable space matter, keep all for completeness)
  const halfCol = layout.columns.size * 0.5
  for (const cx of layout.columns.xs) {
    for (const cz of layout.columns.zs) {
      // Skip columns that would overlap within 1.2m of an exit foot
      const nearExit = layout.exits.some(e => Math.hypot(e.foot.x - cx, e.foot.z - cz) < 1.2 + halfCol)
      if (nearExit) continue
      solidObstacles.push({
        id: `col-${cx}-${cz}`,
        minX: cx - halfCol,
        maxX: cx + halfCol,
        minZ: cz - halfCol,
        maxZ: cz + halfCol,
      })
    }
  }

  const shrunkWalkableRegions: WalkableRegion2D[] = walkableRegions
    .map(reg => ({
      ...reg,
      minX: reg.minX + radiusM,
      maxX: reg.maxX - radiusM,
      minZ: reg.minZ + radiusM,
      maxZ: reg.maxZ - radiusM,
    }))
    .filter(reg => reg.maxX > reg.minX && reg.maxZ > reg.minZ)

  return Object.freeze<IndoorCollisionWorld>({
    radiusM,
    eyeHeightM,
    ceilingHeightM: layout.ceilingHeight,
    minPitchRad: -1.12,
    maxPitchRad: 1.12,
    walkableRegions: Object.freeze(walkableRegions),
    shrunkWalkableRegions: Object.freeze(shrunkWalkableRegions),
    solidObstacles: Object.freeze(solidObstacles),
  })
}

function projectIntoWalkableUnion(
  regions: readonly WalkableRegion2D[],
  px: number,
  pz: number,
): { x: number; z: number; clamped: boolean } {
  for (const r of regions) {
    if (px >= r.minX && px <= r.maxX && pz >= r.minZ && pz <= r.maxZ) {
      return { x: px, z: pz, clamped: false }
    }
  }
  let bestX = px
  let bestZ = pz
  let bestDistSq = Infinity
  for (const r of regions) {
    const cx = Math.max(r.minX, Math.min(px, r.maxX))
    const cz = Math.max(r.minZ, Math.min(pz, r.maxZ))
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

export function detectActiveShop(layout: XxgLayout, x: number, z: number): string | null {
  for (const shop of layout.shops) {
    const b = rectToAabb(shop.id, shop.rect)
    if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) {
      return shop.id
    }
  }
  return null
}

/**
 * Sub-stepped indoor collision solver on arbitrary XxgLayout:
 * 1) Constrains player disk strictly within walkable corridors + open empty shop bays (smooth wall sliding, zero tunneling);
 * 2) Pushes player disk out of stairs, columns, and closed shop AABBs;
 * 3) Clamps eye height strictly below ceilingHeight.
 */
export function resolveIndoorMovement(
  world: IndoorCollisionWorld,
  layout: XxgLayout,
  startX: number,
  startZ: number,
  deltaX: number,
  deltaZ: number,
): IndoorMoveResult {
  const totalDist = Math.hypot(deltaX, deltaZ)
  const steps = Math.max(1, Math.ceil(totalDist / 0.1))
  const stepDx = deltaX / steps
  const stepDz = deltaZ / steps

  let x = startX
  let z = startZ
  const hitSet = new Set<string>()

  for (let s = 0; s < steps; s++) {
    x += stepDx
    z += stepDz

    for (let iter = 0; iter < 3; iter++) {
      const proj = projectIntoWalkableUnion(world.shrunkWalkableRegions, x, z)
      if (proj.clamped) {
        x = proj.x
        z = proj.z
        hitSet.add('perimeter-wall')
      }
      let obsHit = false
      for (const obs of world.solidObstacles) {
        const res = pushCircleOutOfAabb(x, z, world.radiusM, obs)
        if (res.hit) {
          x = res.x
          z = res.z
          hitSet.add(obs.id)
          obsHit = true
        }
      }
      if (!obsHit) break
    }

    const finalProj = projectIntoWalkableUnion(world.shrunkWalkableRegions, x, z)
    if (finalProj.clamped) {
      x = finalProj.x
      z = finalProj.z
      hitSet.add('perimeter-wall')
    }
  }

  const eyeY = Math.min(world.eyeHeightM, world.ceilingHeightM - 0.45)
  return {
    x,
    y: 0,
    z,
    eyeY,
    ceilingClearanceM: Math.round((world.ceilingHeightM - eyeY) * 1000) / 1000,
    hitWall: hitSet.size > 0,
    hitIds: [...hitSet],
    activeShopId: detectActiveShop(layout, x, z),
  }
}

export function clampIndoorPitch(world: IndoorCollisionWorld, pitchRad: number): number {
  return Math.max(world.minPitchRad, Math.min(world.maxPitchRad, pitchRad))
}

/**
 * Checks whether the player is within exitTriggerRadius (1.5m) of any indoor exit foot
 * AND moving outward toward that exit's stairwell.
 */
export function findTriggeredExit(
  layout: XxgLayout,
  x: number,
  z: number,
  vx: number,
  vz: number,
  triggerRadiusM: number = XXG_PLAYER.exitTriggerRadius,
): XxgExit | null {
  for (const ex of layout.exits) {
    const dist = Math.hypot(x - ex.foot.x, z - ex.foot.z)
    if (dist > triggerRadiusM) continue
    const toStairX = ex.stair.x - ex.foot.x
    const toStairZ = ex.stair.z - ex.foot.z
    const len = Math.hypot(toStairX, toStairZ) || 1
    const dot = vx * (toStairX / len) + vz * (toStairZ / len)
    if (dot > 0.05) return ex
  }
  return null
}
