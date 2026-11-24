export interface ObstacleBox {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  minY?: number
  maxY?: number
  label?: string
}

export interface ObstacleArcWall {
  cx: number
  cz: number
  radius: number
  thickness: number
  quadrant: 'nw' | 'ne' | 'sw' | 'se'
  minY?: number
  maxY?: number
  segments?: number
  label?: string
}

export interface ObstacleDoorway {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  maxY?: number
  label?: string
}

export interface ObstaclePartition {
  minX: number
  maxX: number
  zMin: number
  zMax: number
  minY?: number
  maxY?: number
  doorways: readonly ObstacleDoorway[]
  label?: string
}

export interface ObstacleShell {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  minY: number
  maxY: number
  /** Optional interior ceiling height for indoor camera anti-clipping & Rapier ceiling slab */
  ceilingY?: number
  arcCorner?: ObstacleArcWall
  doorways: readonly ObstacleDoorway[]
  partitions?: readonly ObstaclePartition[]
}

export interface ObstacleVolumeSpec {
  id: string
  origin: readonly [number, number, number]
  rotationY: number
  boxes: readonly ObstacleBox[]
  arcs?: readonly ObstacleArcWall[]
  shell?: ObstacleShell
}

export interface RapierCuboidDef {
  hx: number
  hy: number
  hz: number
  x: number
  y: number
  z: number
  yaw: number
  label: string
}

export interface ObstacleStepActor {
  radius: number
  height: number
  halfWidth?: number
  halfLength?: number
  heading?: number
}

export interface ObstacleStepResult {
  blocked: boolean
  normalX: number
  normalZ: number
  label: string
}

export const TIANYUAN_VOLUME_ID = 'tianyuan_mifen_shop'

const HX = 3.5
const HZ = 7.25
const IN_X = 3.26
const BACK_IN_Z = -7.01
const GLASS_Z = 7.1
const ARC_CX = -1.4
const ARC_CZ = 5.0
const ARC_R = 2.1
const PART_Z0 = 0
const PART_Z1 = 0.15
const DOOR_X0 = 0.3
const DOOR_X1 = 1.9
const KDOOR_X0 = -1.6
const KDOOR_X1 = -0.4
const PASS_X0 = 0.5
const PASS_X1 = 2.9
const COUNTER_Z0 = 1.25
const COUNTER_Z1 = 1.85

const WALL_MIN_Y = -0.6
const WALL_MAX_Y = 12.0
const PART_MAX_Y = 3.4
const FIXTURE_MAX_Y = 3.2
const TABLE_MAX_Y = 2.4
const PROP_MAX_Y = 2.0

export function worldToVolumeLocal(
  wx: number,
  wz: number,
  origin: readonly [number, number, number],
  rotationY: number,
): [number, number] {
  const dx = wx - origin[0]
  const dz = wz - origin[2]
  const c = Math.cos(rotationY)
  const s = Math.sin(rotationY)
  return [dx * c - dz * s, dx * s + dz * c]
}

export function volumeLocalToWorld(
  lx: number,
  lz: number,
  origin: readonly [number, number, number],
  rotationY: number,
): [number, number] {
  const c = Math.cos(rotationY)
  const s = Math.sin(rotationY)
  return [origin[0] + lx * c + lz * s, origin[2] - lx * s + lz * c]
}

function localDirToWorld(dx: number, dz: number, rotationY: number): [number, number] {
  const c = Math.cos(rotationY)
  const s = Math.sin(rotationY)
  return [dx * c + dz * s, -dx * s + dz * c]
}

function inArcQuadrant(lx: number, lz: number, arc: ObstacleArcWall, pad = 0): boolean {
  switch (arc.quadrant) {
    case 'nw':
      return lx <= arc.cx + pad && lz >= arc.cz - pad
    case 'ne':
      return lx >= arc.cx - pad && lz >= arc.cz - pad
    case 'sw':
      return lx <= arc.cx + pad && lz <= arc.cz + pad
    case 'se':
      return lx >= arc.cx - pad && lz <= arc.cz + pad
  }
}

export function isInsideShell(lx: number, lz: number, shell: ObstacleShell): boolean {
  if (lx < shell.minX || lx > shell.maxX || lz < shell.minZ || lz > shell.maxZ) return false
  if (shell.arcCorner) {
    const a = shell.arcCorner
    if (inArcQuadrant(lx, lz, a) && Math.hypot(lx - a.cx, lz - a.cz) > a.radius) return false
  }
  return true
}

function arcSectorAngles(quadrant: ObstacleArcWall['quadrant']): [number, number] {
  // Angle a measured from +Z toward -X (matching shop-mesh.ts: x = cx - r*sin(a), z = cz + r*cos(a))
  switch (quadrant) {
    case 'nw':
      return [0, Math.PI / 2]
    case 'sw':
      return [Math.PI / 2, Math.PI]
    case 'se':
      return [Math.PI, (3 * Math.PI) / 2]
    case 'ne':
      return [(3 * Math.PI) / 2, Math.PI * 2]
  }
}

export function expandVolumeToCuboids(spec: ObstacleVolumeSpec): RapierCuboidDef[] {
  const out: RapierCuboidDef[] = []
  const [ox, oy, oz] = spec.origin
  const rot = spec.rotationY
  for (const box of spec.boxes) {
    const minY = box.minY ?? WALL_MIN_Y
    const maxY = box.maxY ?? FIXTURE_MAX_Y
    const hx = (box.maxX - box.minX) * 0.5
    const hy = (maxY - minY) * 0.5
    const hz = (box.maxZ - box.minZ) * 0.5
    if (hx <= 1e-4 || hy <= 1e-4 || hz <= 1e-4) continue
    const lx = (box.minX + box.maxX) * 0.5
    const lz = (box.minZ + box.maxZ) * 0.5
    const [wx, wz] = volumeLocalToWorld(lx, lz, spec.origin, rot)
    out.push({
      hx,
      hy,
      hz,
      x: wx,
      y: oy + (minY + maxY) * 0.5,
      z: wz,
      yaw: rot,
      label: box.label ?? 'box',
    })
  }
  for (const arc of spec.arcs ?? []) {
    const segs = Math.max(6, arc.segments ?? 12)
    const [aStart, aEnd] = arcSectorAngles(arc.quadrant)
    const minY = arc.minY ?? WALL_MIN_Y
    const maxY = arc.maxY ?? WALL_MAX_Y
    const hy = (maxY - minY) * 0.5
    const rInner = arc.radius - 0.04
    const rOuter = arc.radius + Math.max(0.16, arc.thickness)
    const rMid = (rInner + rOuter) * 0.5
    const halfThick = (rOuter - rInner) * 0.5
    for (let i = 0; i < segs; i++) {
      const a0 = aStart + ((aEnd - aStart) * i) / segs
      const a1 = aStart + ((aEnd - aStart) * (i + 1)) / segs
      const am = (a0 + a1) * 0.5
      const halfChord = rMid * Math.sin(Math.abs(a1 - a0) * 0.5) + 0.08
      const nx = -Math.sin(am)
      const nz = Math.cos(am)
      const lx = arc.cx + nx * rMid
      const lz = arc.cz + nz * rMid
      const [wx, wz] = volumeLocalToWorld(lx, lz, spec.origin, rot)
      out.push({
        hx: halfChord,
        hy,
        hz: halfThick,
        x: wx,
        y: oy + (minY + maxY) * 0.5,
        z: wz,
        yaw: rot - am,
        label: `${arc.label ?? 'arc'}-${i}`,
      })
    }
  }
  const ceilY = spec.shell?.ceilingY
  if (spec.shell && typeof ceilY === 'number') {
    const sh = spec.shell
    const hx = (sh.maxX - sh.minX) * 0.5 + 0.25
    const hz = (sh.maxZ - sh.minZ) * 0.5 + 0.25
    const lx = (sh.minX + sh.maxX) * 0.5
    const lz = (sh.minZ + sh.maxZ) * 0.5
    const [wx, wz] = volumeLocalToWorld(lx, lz, spec.origin, rot)
    out.push({
      hx,
      hy: 0.13,
      hz,
      x: wx,
      y: oy + ceilY + 0.09,
      z: wz,
      yaw: rot,
      label: 'shell:ceiling',
    })
  }
  return out
}

export function buildTianyuanObstacleVolume(
  origin: readonly [number, number, number],
  rotationY: number,
  level: number,
  extraColliders?: ReadonlyArray<{minX: number; maxX: number; minZ: number; maxZ: number; label?: string}>,
): ObstacleVolumeSpec {
  const lv = level >= 3 ? 3 : level >= 2 ? 2 : 1
  const boxes: ObstacleBox[] = [
    // Outer solid perimeter walls (full building height so jumping can never vault over)
    {minX: -HX - 0.25, maxX: -IN_X, minZ: -HZ - 0.25, maxZ: ARC_CZ + 0.18, minY: WALL_MIN_Y, maxY: WALL_MAX_Y, label: 'wall:west'},
    {minX: IN_X, maxX: HX + 0.25, minZ: -HZ - 0.25, maxZ: GLASS_Z + 0.25, minY: WALL_MIN_Y, maxY: WALL_MAX_Y, label: 'wall:east'},
    {minX: -HX - 0.25, maxX: HX + 0.25, minZ: -HZ - 0.25, maxZ: BACK_IN_Z, minY: WALL_MIN_Y, maxY: WALL_MAX_Y, label: 'wall:back'},
    // Front storefront glass & corner pillars (only front doorway [DOOR_X0, DOOR_X1] open below 2.4m)
    {minX: ARC_CX - 0.18, maxX: DOOR_X0, minZ: GLASS_Z - 0.08, maxZ: GLASS_Z + 0.22, minY: WALL_MIN_Y, maxY: WALL_MAX_Y, label: 'glass:front-west'},
    {minX: DOOR_X1, maxX: HX + 0.25, minZ: GLASS_Z - 0.08, maxZ: GLASS_Z + 0.22, minY: WALL_MIN_Y, maxY: WALL_MAX_Y, label: 'glass:front-east'},
    {minX: DOOR_X0 - 0.05, maxX: DOOR_X1 + 0.05, minZ: GLASS_Z - 0.08, maxZ: GLASS_Z + 0.22, minY: 2.4, maxY: WALL_MAX_Y, label: 'door:front-lintel'},
    {minX: -HX - 0.05, maxX: -IN_X + 0.06, minZ: ARC_CZ - 0.18, maxZ: ARC_CZ + 0.18, minY: WALL_MIN_Y, maxY: WALL_MAX_Y, label: 'pillar:arc-west'},
    {minX: ARC_CX - 0.18, maxX: ARC_CX + 0.18, minZ: GLASS_Z - 0.2, maxZ: GLASS_Z + 0.2, minY: WALL_MIN_Y, maxY: WALL_MAX_Y, label: 'pillar:arc-front'},
    // Hall / kitchen partition wall (only kitchen doorway [KDOOR_X0, KDOOR_X1] open below 2.2m)
    {minX: -HX, maxX: KDOOR_X0, minZ: PART_Z0 - 0.02, maxZ: PART_Z1 + 0.02, minY: WALL_MIN_Y, maxY: PART_MAX_Y, label: 'wall:pass-west'},
    {minX: KDOOR_X1, maxX: HX, minZ: PART_Z0 - 0.02, maxZ: PART_Z1 + 0.02, minY: WALL_MIN_Y, maxY: PART_MAX_Y, label: 'wall:pass-east'},
    {minX: KDOOR_X0 - 0.05, maxX: KDOOR_X1 + 0.05, minZ: PART_Z0 - 0.02, maxZ: PART_Z1 + 0.02, minY: 2.2, maxY: PART_MAX_Y, label: 'door:kitchen-lintel'},
    // Front hall counters, fridge, toppings bar, dining tables
    {minX: 0, maxX: IN_X, minZ: COUNTER_Z0, maxZ: COUNTER_Z1, minY: -0.2, maxY: FIXTURE_MAX_Y, label: 'counter:front'},
    {minX: 2.6, maxX: IN_X, minZ: 5.93, maxZ: 6.87, minY: -0.2, maxY: FIXTURE_MAX_Y, label: 'fridge:drinks'},
    {minX: -IN_X, maxX: -2.62, minZ: 0.52, maxZ: 2.78, minY: -0.2, maxY: FIXTURE_MAX_Y, label: 'toppings:bar'},
    {minX: -IN_X, maxX: -2.66, minZ: 3.2, maxZ: 4.6, minY: -0.2, maxY: TABLE_MAX_Y, label: 'table:west-wall'},
    {minX: -1.2, maxX: 0, minZ: 3.1, maxZ: 3.7, minY: -0.2, maxY: TABLE_MAX_Y, label: 'table:-0.6,3.4'},
    // Kitchen fixtures
    {minX: PASS_X0, maxX: PASS_X1, minZ: -0.7, maxZ: 0, minY: -0.2, maxY: FIXTURE_MAX_Y, label: 'kitchen:pickup-table'},
    {minX: 2.45, maxX: IN_X, minZ: -3.5, maxZ: -1.2, minY: -0.2, maxY: FIXTURE_MAX_Y, label: 'kitchen:boil-range'},
    {minX: 2.5, maxX: IN_X, minZ: -5.2, maxZ: -3.8, minY: -0.2, maxY: FIXTURE_MAX_Y, label: 'kitchen:brine-stove'},
    {minX: -IN_X, maxX: -2.46, minZ: -4.28, maxZ: -1.35, minY: -0.2, maxY: FIXTURE_MAX_Y, label: 'kitchen:meat-table'},
    {minX: -0.5, maxX: 0.5, minZ: -5.3, maxZ: -2.7, minY: -0.2, maxY: FIXTURE_MAX_Y, label: 'kitchen:prep-island'},
    {minX: -IN_X, maxX: -2.56, minZ: -5.6, maxZ: -4.4, minY: -0.2, maxY: FIXTURE_MAX_Y, label: 'kitchen:fridge'},
    {minX: -IN_X, maxX: -2.6, minZ: -6.95, maxZ: -5.8, minY: -0.2, maxY: FIXTURE_MAX_Y, label: 'kitchen:sink'},
    {minX: 1.0, maxX: IN_X, minZ: -7.01, maxZ: -6.55, minY: -0.2, maxY: FIXTURE_MAX_Y, label: 'kitchen:back-shelf'},
    {minX: -1.5, maxX: -0.3, minZ: -7.01, maxZ: -6.5, minY: -0.2, maxY: FIXTURE_MAX_Y, label: 'kitchen:ledger-desk'},
    // Sidewalk soup bucket & west-alley scooters
    {minX: 2.8, maxX: 3.3, minZ: 7.22, maxZ: 7.68, minY: -0.2, maxY: PROP_MAX_Y, label: 'sidewalk:soup-bucket'},
    {minX: -4.68, maxX: -4.08, minZ: -0.5, maxZ: 1.2, minY: -0.2, maxY: PROP_MAX_Y, label: 'sidewalk:scooter-1'},
    {minX: -4.75, maxX: -4.15, minZ: 1.0, maxZ: 2.7, minY: -0.2, maxY: PROP_MAX_Y, label: 'sidewalk:scooter-2'},
  ]

  if (lv >= 2) {
    boxes.push(
      {minX: -1.2, maxX: 0, minZ: 5.15, maxZ: 5.75, minY: -0.2, maxY: TABLE_MAX_Y, label: 'table:-0.6,5.45'},
      {minX: IN_X - 0.4, maxX: IN_X, minZ: 2.3, maxZ: lv >= 3 ? 5.5 : 3.9, minY: -0.2, maxY: TABLE_MAX_Y, label: 'bar:east-wall'},
      {minX: -4.72, maxX: -4.12, minZ: 2.45, maxZ: 4.15, minY: -0.2, maxY: PROP_MAX_Y, label: 'sidewalk:scooter-3'},
    )
  }
  if (lv >= 3) {
    boxes.push(
      {minX: -4.76, maxX: -4.16, minZ: -2.05, maxZ: -0.35, minY: -0.2, maxY: PROP_MAX_Y, label: 'sidewalk:scooter-4'},
      {minX: -3.05, maxX: -2.35, minZ: 8.1, maxZ: 8.7, minY: -0.2, maxY: PROP_MAX_Y, label: 'sidewalk:table-1'},
      {minX: -1.35, maxX: -0.65, minZ: 8.1, maxZ: 8.7, minY: -0.2, maxY: PROP_MAX_Y, label: 'sidewalk:table-2'},
      {minX: 2.55, maxX: 3.25, minZ: 8.2, maxZ: 8.8, minY: -0.2, maxY: PROP_MAX_Y, label: 'sidewalk:table-3'},
    )
  }

  if (extraColliders?.length) {
    const knownLabels = new Set(boxes.map(b => b.label))
    for (const c of extraColliders) {
      if (!c || typeof c.minX !== 'number' || typeof c.maxX !== 'number' || typeof c.minZ !== 'number' || typeof c.maxZ !== 'number') continue
      if (Math.abs(c.minX) >= 120 || Math.abs(c.maxX) >= 120 || Math.abs(c.minZ) >= 120 || Math.abs(c.maxZ) >= 120) continue
      if (c.label && (knownLabels.has(c.label) || c.label.startsWith('glass:corner-'))) continue
      boxes.push({
        minX: c.minX,
        maxX: c.maxX,
        minZ: c.minZ,
        maxZ: c.maxZ,
        minY: -0.2,
        maxY: FIXTURE_MAX_Y,
        label: c.label ?? 'extra',
      })
    }
  }

  const arcCorner: ObstacleArcWall = {
    cx: ARC_CX,
    cz: ARC_CZ,
    radius: ARC_R,
    thickness: 0.26,
    quadrant: 'nw',
    minY: WALL_MIN_Y,
    maxY: WALL_MAX_Y,
    segments: 12,
    label: 'glass:corner-arc',
  }

  return {
    id: TIANYUAN_VOLUME_ID,
    origin: [origin[0], origin[1], origin[2]],
    rotationY,
    boxes,
    arcs: [arcCorner],
    shell: {
      minX: -IN_X,
      maxX: IN_X,
      minZ: BACK_IN_Z,
      maxZ: GLASS_Z,
      minY: WALL_MIN_Y,
      maxY: WALL_MAX_Y,
      ceilingY: 3.2,
      arcCorner,
      doorways: [{minX: DOOR_X0, maxX: DOOR_X1, minZ: GLASS_Z - 0.45, maxZ: GLASS_Z + 0.45, maxY: 2.4, label: 'door:front'}],
      partitions: [
        {
          minX: -IN_X,
          maxX: IN_X,
          zMin: PART_Z0 - 0.02,
          zMax: PART_Z1 + 0.02,
          minY: WALL_MIN_Y,
          maxY: PART_MAX_Y,
          doorways: [{minX: KDOOR_X0, maxX: KDOOR_X1, minZ: PART_Z0 - 0.4, maxZ: PART_Z1 + 0.4, maxY: 2.2, label: 'door:kitchen'}],
          label: 'wall:partition',
        },
      ],
    },
  }
}

function pushCircleOutOfBox(
  x: number,
  z: number,
  radius: number,
  box: ObstacleBox,
): {hit: boolean; x: number; z: number; nx: number; nz: number} {
  const closestX = Math.max(box.minX, Math.min(x, box.maxX))
  const closestZ = Math.max(box.minZ, Math.min(z, box.maxZ))
  const dx = x - closestX
  const dz = z - closestZ
  const distSq = dx * dx + dz * dz
  if (distSq >= radius * radius) return {hit: false, x, z, nx: 0, nz: 0}
  if (distSq > 1e-10) {
    const dist = Math.sqrt(distSq)
    const nx = dx / dist
    const nz = dz / dist
    const push = radius - dist
    return {hit: true, x: x + nx * push, z: z + nz * push, nx, nz}
  }
  // Center is inside the box: push to nearest face + radius
  const dLeft = x - box.minX
  const dRight = box.maxX - x
  const dBack = z - box.minZ
  const dFront = box.maxZ - z
  const minPen = Math.min(dLeft, dRight, dBack, dFront)
  if (minPen === dLeft) return {hit: true, x: box.minX - radius, z, nx: -1, nz: 0}
  if (minPen === dRight) return {hit: true, x: box.maxX + radius, z, nx: 1, nz: 0}
  if (minPen === dBack) return {hit: true, x, z: box.minZ - radius, nx: 0, nz: -1}
  return {hit: true, x, z: box.maxZ + radius, nx: 0, nz: 1}
}

function pushCircleOutOfArc(
  x: number,
  z: number,
  radius: number,
  arc: ObstacleArcWall,
  wasInside: boolean,
): {hit: boolean; x: number; z: number; nx: number; nz: number} {
  if (!inArcQuadrant(x, z, arc, radius)) return {hit: false, x, z, nx: 0, nz: 0}
  const dx = x - arc.cx
  const dz = z - arc.cz
  const d = Math.hypot(dx, dz)
  const rInner = arc.radius - 0.04
  const rOuter = arc.radius + Math.max(0.16, arc.thickness)
  if (d < 1e-6) return {hit: false, x, z, nx: 0, nz: 0}
  if (wasInside) {
    // Only clamp once strictly inside the arc quadrant sector
    if (!inArcQuadrant(x, z, arc, 0)) return {hit: false, x, z, nx: 0, nz: 0}
    const maxR = Math.max(0.05, rInner - radius)
    if (d > maxR) {
      const ux = dx / d
      const uz = dz / d
      return {hit: true, x: arc.cx + ux * maxR, z: arc.cz + uz * maxR, nx: -ux, nz: -uz}
    }
    return {hit: false, x, z, nx: 0, nz: 0}
  }
  const minR = rOuter + radius
  if (d < minR && inArcQuadrant(x, z, arc, radius * 0.5)) {
    const ux = dx / d
    const uz = dz / d
    return {hit: true, x: arc.cx + ux * minR, z: arc.cz + uz * minR, nx: ux, nz: uz}
  }
  return {hit: false, x, z, nx: 0, nz: 0}
}

function passesDoorway(
  curX: number,
  curZ: number,
  candX: number,
  candZ: number,
  localFootY: number,
  clearance: number,
  doorways: readonly ObstacleDoorway[],
): boolean {
  for (const d of doorways) {
    const maxY = d.maxY ?? 2.4
    if (localFootY >= maxY - 0.35) continue
    const halfWidth = (d.maxX - d.minX) * 0.5
    if (clearance >= halfWidth - 0.02) continue
    const xMin = d.minX + clearance - 0.02
    const xMax = d.maxX - clearance + 0.02
    const midX = (curX + candX) * 0.5
    const midZ = (curZ + candZ) * 0.5
    if (
      candX >= xMin &&
      candX <= xMax &&
      midX >= xMin &&
      midX <= xMax &&
      midZ >= d.minZ - 0.45 &&
      midZ <= d.maxZ + 0.45
    ) {
      return true
    }
  }
  return false
}

function clampStrictlyInsideShell(x: number, z: number, clearance: number, shell: ObstacleShell): [number, number] {
  let rx = Math.max(shell.minX + clearance, Math.min(shell.maxX - clearance, x))
  let rz = Math.max(shell.minZ + clearance, Math.min(shell.maxZ - clearance, z))
  if (shell.arcCorner) {
    const a = shell.arcCorner
    if (inArcQuadrant(rx, rz, a)) {
      const dx = rx - a.cx
      const dz = rz - a.cz
      const d = Math.hypot(dx, dz)
      const maxR = Math.max(0.05, a.radius - 0.04 - clearance)
      if (d > maxR && d > 1e-6) {
        rx = a.cx + (dx / d) * maxR
        rz = a.cz + (dz / d) * maxR
      }
    }
  }
  return [rx, rz]
}

function pointHitsVolume(
  lx: number,
  lz: number,
  localFootY: number,
  localHeadY: number,
  radius: number,
  volume: ObstacleVolumeSpec,
  wasInsideShell: boolean,
): boolean {
  for (const box of volume.boxes) {
    const minY = box.minY ?? WALL_MIN_Y
    const maxY = box.maxY ?? FIXTURE_MAX_Y
    if (localHeadY <= minY || localFootY >= maxY) continue
    if (pushCircleOutOfBox(lx, lz, radius, box).hit) return true
  }
  for (const arc of volume.arcs ?? []) {
    const minY = arc.minY ?? WALL_MIN_Y
    const maxY = arc.maxY ?? WALL_MAX_Y
    if (localHeadY <= minY || localFootY >= maxY) continue
    if (pushCircleOutOfArc(lx, lz, radius, arc, wasInsideShell).hit) return true
  }
  return false
}

function resolveSingleVolumeStep(
  prev: {x: number; y: number; z: number},
  next: {x: number; y: number; z: number},
  actor: ObstacleStepActor,
  volume: ObstacleVolumeSpec,
): ObstacleStepResult {
  const [prevLx, prevLz] = worldToVolumeLocal(prev.x, prev.z, volume.origin, volume.rotationY)
  const [targetLx, targetLz] = worldToVolumeLocal(next.x, next.z, volume.origin, volume.rotationY)
  const clearance = Math.max(actor.radius, actor.halfWidth ?? 0)
  const reach = Math.max(clearance, actor.halfLength ?? 0) + 1.5

  // Broadphase reject
  let minBx = Infinity
  let maxBx = -Infinity
  let minBz = Infinity
  let maxBz = -Infinity
  for (const b of volume.boxes) {
    if (b.minX < minBx) minBx = b.minX
    if (b.maxX > maxBx) maxBx = b.maxX
    if (b.minZ < minBz) minBz = b.minZ
    if (b.maxZ > maxBz) maxBz = b.maxZ
  }
  if (volume.shell) {
    minBx = Math.min(minBx, volume.shell.minX)
    maxBx = Math.max(maxBx, volume.shell.maxX)
    minBz = Math.min(minBz, volume.shell.minZ)
    maxBz = Math.max(maxBz, volume.shell.maxZ)
  }
  const segMinX = Math.min(prevLx, targetLx) - reach
  const segMaxX = Math.max(prevLx, targetLx) + reach
  const segMinZ = Math.min(prevLz, targetLz) - reach
  const segMaxZ = Math.max(prevLz, targetLz) + reach
  if (segMaxX < minBx || segMinX > maxBx || segMaxZ < minBz || segMinZ > maxBz) {
    return {blocked: false, normalX: 0, normalZ: 0, label: ''}
  }

  const localFootY = next.y - actor.height * 0.5 - volume.origin[1]
  const localHeadY = localFootY + actor.height
  const shell = volume.shell

  // Multi-point vehicle footprint check (cars & bikes): block cleanly before any nose/tail/corner penetrates
  const halfLen = actor.halfLength ?? 0
  if (halfLen > 0.05) {
    const halfW = actor.halfWidth ?? actor.radius
    const heading = actor.heading ?? 0
    const [fx, fz] = worldToVolumeLocal(
      volume.origin[0] - Math.sin(heading),
      volume.origin[2] - Math.cos(heading),
      volume.origin,
      volume.rotationY,
    )
    const [rx, rz] = worldToVolumeLocal(
      volume.origin[0] + Math.cos(heading),
      volume.origin[2] - Math.sin(heading),
      volume.origin,
      volume.rotationY,
    )
    const sampleRadius = halfW > 0.5 ? 0.16 : Math.min(0.32, halfW)
    const offsets: readonly [number, number, number][] =
      halfW > 0.5
        ? [
            [0, 0, halfW],
            [0, halfLen, sampleRadius],
            [0, -halfLen, sampleRadius],
            [halfW - sampleRadius, halfLen - sampleRadius, sampleRadius],
            [-(halfW - sampleRadius), halfLen - sampleRadius, sampleRadius],
            [halfW - sampleRadius, -(halfLen - sampleRadius), sampleRadius],
            [-(halfW - sampleRadius), -(halfLen - sampleRadius), sampleRadius],
            [halfW - sampleRadius, 0, sampleRadius],
            [-(halfW - sampleRadius), 0, sampleRadius],
          ]
        : [
            [0, 0, halfW],
            [0, halfLen * 0.9, sampleRadius],
            [0, -halfLen * 0.9, sampleRadius],
          ]

    const travel = Math.hypot(targetLx - prevLx, targetLz - prevLz)
    const substeps = Math.max(1, Math.min(64, Math.ceil(travel / 0.08)))
    let safeLx = prevLx
    let safeLz = prevLz
    const startInside = shell ? isInsideShell(prevLx, prevLz, shell) : false
    let hitLabel = ''
    for (let s = 1; s <= substeps; s++) {
      const t = s / substeps
      const cx = prevLx + (targetLx - prevLx) * t
      const cz = prevLz + (targetLz - prevLz) * t
      let stepBlocked = false

      // Shell boundary invariant for vehicle center
      if (shell) {
        const curIn = isInsideShell(cx, cz, shell)
        if (curIn !== startInside && !passesDoorway(safeLx, safeLz, cx, cz, localFootY, halfW, shell.doorways)) {
          stepBlocked = true
          hitLabel = 'shell'
        }
        if (!stepBlocked && startInside && shell.partitions) {
          for (const p of shell.partitions) {
            if (localHeadY <= (p.minY ?? WALL_MIN_Y) || localFootY >= (p.maxY ?? PART_MAX_Y)) continue
            const crossed = (safeLz < p.zMax && cz >= p.zMin && safeLz <= p.zMin) || (safeLz > p.zMin && cz <= p.zMax && safeLz >= p.zMax) || (safeLz < p.zMin && cz > p.zMax) || (safeLz > p.zMax && cz < p.zMin)
            if (crossed && !passesDoorway(safeLx, safeLz, cx, cz, localFootY, halfW, p.doorways)) {
              stepBlocked = true
              hitLabel = p.label ?? 'partition'
              break
            }
          }
        }
      }

      if (!stepBlocked) {
        for (const [lat, lon, r] of offsets) {
          const sx = cx + rx * lat + fx * lon
          const sz = cz + rz * lat + fz * lon
          if (pointHitsVolume(sx, sz, localFootY, localHeadY, r, volume, startInside)) {
            stepBlocked = true
            hitLabel = 'vehicle-obstacle'
            break
          }
          if (shell && isInsideShell(sx, sz, shell) !== startInside) {
            if (!passesDoorway(cx, cz, sx, sz, localFootY, r, shell.doorways)) {
              stepBlocked = true
              hitLabel = 'vehicle-shell'
              break
            }
          }
        }
      }

      if (stepBlocked) {
        const [wx, wz] = volumeLocalToWorld(safeLx, safeLz, volume.origin, volume.rotationY)
        const ddx = next.x - prev.x
        const ddz = next.z - prev.z
        const dLen = Math.hypot(ddx, ddz)
        next.x = wx
        next.z = wz
        return {
          blocked: true,
          normalX: dLen > 1e-6 ? -ddx / dLen : 0,
          normalZ: dLen > 1e-6 ? -ddz / dLen : 0,
          label: hitLabel || 'vehicle-obstacle',
        }
      }
      safeLx = cx
      safeLz = cz
    }
    return {blocked: false, normalX: 0, normalZ: 0, label: ''}
  }

  // Foot actor: continuous substepped push-out + smooth sliding + strict doorway-only shell invariant
  const travel = Math.hypot(targetLx - prevLx, targetLz - prevLz)
  const substeps = Math.max(1, Math.min(48, Math.ceil(travel / 0.08)))
  let curX = prevLx
  let curZ = prevLz
  let anyHit = false
  let normSumX = 0
  let normSumZ = 0
  let hitLabel = ''

  for (let s = 1; s <= substeps; s++) {
    const frac = s === substeps ? 1 : 1 / (substeps - s + 1)
    let candX = curX + (targetLx - curX) * frac
    let candZ = curZ + (targetLz - curZ) * frac
    const prevIn = shell ? isInsideShell(curX, curZ, shell) : false

    for (let iter = 0; iter < 4; iter++) {
      let moved = false
      for (const box of volume.boxes) {
        const minY = box.minY ?? WALL_MIN_Y
        const maxY = box.maxY ?? FIXTURE_MAX_Y
        if (localHeadY <= minY || localFootY >= maxY) continue
        const res = pushCircleOutOfBox(candX, candZ, clearance, box)
        if (res.hit) {
          candX = res.x
          candZ = res.z
          normSumX += res.nx
          normSumZ += res.nz
          hitLabel = box.label ?? 'box'
          anyHit = true
          moved = true
        }
      }
      for (const arc of volume.arcs ?? []) {
        const minY = arc.minY ?? WALL_MIN_Y
        const maxY = arc.maxY ?? WALL_MAX_Y
        if (localHeadY <= minY || localFootY >= maxY) continue
        const res = pushCircleOutOfArc(candX, candZ, clearance, arc, prevIn)
        if (res.hit) {
          candX = res.x
          candZ = res.z
          normSumX += res.nx
          normSumZ += res.nz
          hitLabel = arc.label ?? 'arc'
          anyHit = true
          moved = true
        }
      }
      if (!moved) break
    }

    if (shell) {
      const candIn = isInsideShell(candX, candZ, shell)
      if (prevIn !== candIn) {
        const allowed = passesDoorway(curX, curZ, candX, candZ, localFootY, clearance, shell.doorways)
        if (!allowed) {
          anyHit = true
          hitLabel = hitLabel || 'shell'
          if (prevIn) {
            const [clampedX, clampedZ] = clampStrictlyInsideShell(candX, candZ, clearance, shell)
            const dx = clampedX - candX
            const dz = clampedZ - candZ
            const dl = Math.hypot(dx, dz)
            if (dl > 1e-6) {
              normSumX += dx / dl
              normSumZ += dz / dl
            }
            candX = clampedX
            candZ = clampedZ
          } else {
            const dx = curX - candX
            const dz = curZ - candZ
            const dl = Math.hypot(dx, dz)
            if (dl > 1e-6) {
              normSumX += dx / dl
              normSumZ += dz / dl
            }
            candX = curX
            candZ = curZ
          }
        }
      }

      if (prevIn && isInsideShell(candX, candZ, shell) && shell.partitions) {
        for (const p of shell.partitions) {
          if (localHeadY <= (p.minY ?? WALL_MIN_Y) || localFootY >= (p.maxY ?? PART_MAX_Y)) continue
          const pMid = (p.zMin + p.zMax) * 0.5
          const crossed = (curZ < pMid && candZ >= pMid) || (curZ > pMid && candZ <= pMid)
          if (crossed && !passesDoorway(curX, curZ, candX, candZ, localFootY, clearance, p.doorways)) {
            anyHit = true
            hitLabel = p.label ?? 'partition'
            const sign = curZ < pMid ? -1 : 1
            candZ = curZ < pMid ? Math.min(curZ, p.zMin - clearance) : Math.max(curZ, p.zMax + clearance)
            normSumZ += sign
          }
        }
      }
    }

    curX = candX
    curZ = candZ
  }

  if (!anyHit) return {blocked: false, normalX: 0, normalZ: 0, label: ''}

  const [wx, wz] = volumeLocalToWorld(curX, curZ, volume.origin, volume.rotationY)
  next.x = wx
  next.z = wz
  const nLen = Math.hypot(normSumX, normSumZ)
  if (nLen > 1e-6) {
    const [wnx, wnz] = localDirToWorld(normSumX / nLen, normSumZ / nLen, volume.rotationY)
    return {blocked: true, normalX: wnx, normalZ: wnz, label: hitLabel}
  }
  return {blocked: true, normalX: 0, normalZ: 0, label: hitLabel}
}

export function resolveObstacleVolumesStep(
  prev: {x: number; y: number; z: number},
  next: {x: number; y: number; z: number},
  actor: ObstacleStepActor,
  volumes: Iterable<ObstacleVolumeSpec>,
): ObstacleStepResult {
  let blocked = false
  let nx = 0
  let nz = 0
  let label = ''
  for (const volume of volumes) {
    const res = resolveSingleVolumeStep(prev, next, actor, volume)
    if (res.blocked) {
      blocked = true
      nx += res.normalX
      nz += res.normalZ
      if (!label) label = res.label
    }
  }
  const len = Math.hypot(nx, nz)
  return {
    blocked,
    normalX: len > 1e-6 ? nx / len : 0,
    normalZ: len > 1e-6 ? nz / len : 0,
    label,
  }
}

/**
 * Keeps camera strictly inside exterior walls, curved corner arc, and ceiling whenever the player is indoors.
 * Ray-clips along player -> camera first so the view stays on-axis without jarring lateral jumps.
 */
export function clampCameraToObstacleVolumes(
  playerPos: {x: number; y: number; z: number},
  camPos: {x: number; y: number; z: number},
  camMargin: number,
  volumes: Iterable<ObstacleVolumeSpec>,
): boolean {
  let clamped = false
  const margin = Math.max(0.14, camMargin)
  for (const volume of volumes) {
    const shell = volume.shell
    if (!shell) continue
    const [pLx, pLz] = worldToVolumeLocal(playerPos.x, playerPos.z, volume.origin, volume.rotationY)
    const pLy = playerPos.y - volume.origin[1]
    const ceilY = shell.ceilingY ?? shell.maxY
    if (!isInsideShell(pLx, pLz, shell) || pLy < shell.minY || pLy >= ceilY) continue

    const [cLx, cLz] = worldToVolumeLocal(camPos.x, camPos.z, volume.origin, volume.rotationY)
    const cLy = camPos.y - volume.origin[1]
    const innerMinX = shell.minX + margin
    const innerMaxX = shell.maxX - margin
    const innerMinZ = shell.minZ + margin
    const innerMaxZ = shell.maxZ - margin
    const innerMaxY = ceilY - Math.max(0.16, margin * 0.85)
    const arc = shell.arcCorner
    const arcMaxR = arc ? Math.max(0.1, arc.radius - 0.04 - margin) : Infinity

    const insideWithMargin = (lx: number, ly: number, lz: number): boolean => {
      if (lx < innerMinX || lx > innerMaxX || lz < innerMinZ || lz > innerMaxZ || ly > innerMaxY) return false
      if (arc && inArcQuadrant(lx, lz, arc) && Math.hypot(lx - arc.cx, lz - arc.cz) > arcMaxR) return false
      return true
    }

    if (insideWithMargin(cLx, cLy, cLz)) continue

    // Binary search along eye -> camPos ray to find furthest strictly-indoor point
    const eyeY = Math.min(innerMaxY, pLy + 1.55)
    const startX = Math.max(innerMinX, Math.min(innerMaxX, pLx))
    const startZ = Math.max(innerMinZ, Math.min(innerMaxZ, pLz))
    let lo = 0
    let hi = 1
    for (let i = 0; i < 14; i++) {
      const mid = (lo + hi) * 0.5
      const mx = startX + (cLx - startX) * mid
      const my = eyeY + (cLy - eyeY) * mid
      const mz = startZ + (cLz - startZ) * mid
      if (insideWithMargin(mx, my, mz)) lo = mid
      else hi = mid
    }
    const [finalLx, finalLz] = clampStrictlyInsideShell(
      startX + (cLx - startX) * lo,
      startZ + (cLz - startZ) * lo,
      margin,
      shell,
    )
    const finalLy = Math.min(innerMaxY, eyeY + (cLy - eyeY) * lo)
    const [wx, wz] = volumeLocalToWorld(finalLx, finalLz, volume.origin, volume.rotationY)
    camPos.x = wx
    camPos.y = volume.origin[1] + finalLy
    camPos.z = wz
    clamped = true
  }
  return clamped
}
