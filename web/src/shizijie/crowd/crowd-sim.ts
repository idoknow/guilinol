import { yawFacing } from '../contract.ts'
import { createSeededRng, pickNpcPalette, type SeededRng } from './palette.ts'
import {
  MAX_SHIZIJIE_CROWD_NPCS,
  type SzjAgentState,
  type SzjCrowdLayoutInput,
  type SzjCrowdPose,
  type SzjCrowdRole,
  type SzjNpcSpot,
  type SzjXZ,
} from './types.ts'

interface ResolvedRoute {
  readonly points: readonly SzjXZ[]
  readonly loop: boolean
}

/**
 * 十字街 B1 环形主通道默认闭环（无 layout 时兜底，与 shizijie_underpass.py 尺度一致）。
 */
const DEFAULT_RING_POINTS: readonly SzjXZ[] = [
  { x: 0.0, z: -20.0 },
  { x: 10.5, z: -18.2 },
  { x: 18.2, z: -11.4 },
  { x: 21.8, z: -1.2 },
  { x: 20.5, z: 10.2 },
  { x: 13.8, z: 18.4 },
  { x: 2.4, z: 21.6 },
  { x: -9.8, z: 19.8 },
  { x: -18.6, z: 12.8 },
  { x: -22.2, z: 1.8 },
  { x: -20.4, z: -9.8 },
  { x: -12.4, z: -17.6 },
]

function lerpAngle(a: number, b: number, t: number): number {
  const diff = Math.atan2(Math.sin(b - a), Math.cos(b - a))
  return a + diff * t
}

function buildRoutes(layout?: SzjCrowdLayoutInput): ResolvedRoute[] {
  const routes: ResolvedRoute[] = []
  if (layout?.walkers && layout.walkers.length > 0) {
    for (let i = 0; i < layout.walkers.length; i++) {
      const w = layout.walkers[i]!
      if (w.points && w.points.length >= 2) {
        routes.push({ points: w.points, loop: Boolean(w.loop) })
      }
    }
  }
  if (routes.length === 0 && layout?.corridors && layout.corridors.length > 0) {
    for (let i = 0; i < layout.corridors.length; i++) {
      const c = layout.corridors[i]!
      if (c.points && c.points.length >= 2) {
        routes.push({ points: c.points, loop: c.kind === 'ring' })
      }
    }
  }
  if (routes.length === 0) {
    routes.push({ points: DEFAULT_RING_POINTS, loop: true })
  }
  return routes
}

function createAgent(
  index: number,
  role: SzjCrowdRole,
  pose: SzjCrowdPose,
  x: number,
  y: number,
  z: number,
  yaw: number,
  rng: SeededRng,
  routeIndex: number,
  waypointIndex: number,
  loopDirection: 1 | -1,
  laneOffset: number,
): SzjAgentState {
  const pal = pickNpcPalette(role, rng)
  const hasProp =
    role === 'keeper'
      ? pose === 'tidy' && rng.next() < 0.35
      : role === 'customer'
        ? pose !== 'phone' && rng.next() < 0.65
        : rng.next() < 0.45

  return {
    id: `szj-${role}-${index}`,
    index,
    role,
    pose,
    basePose: pose,
    x,
    y,
    z,
    yaw,
    homeX: x,
    homeZ: z,
    homeYaw: yaw,
    speed: role === 'walker' ? rng.range(0.95, 1.42) : 0,
    walkPhase: rng.range(0, Math.PI * 2),
    actionPhase: rng.range(0, Math.PI * 2),
    stateTimer: rng.range(0, 3.0),
    stateDuration: rng.range(2.6, 5.8),
    heightScale: rng.range(0.93, 1.07),
    widthScale: rng.range(0.94, 1.06),
    hasProp,
    propColor: pal.propColor,
    shirtColor: pal.shirtColor,
    pantsColor: pal.pantsColor,
    skinTint: pal.skinTint,
    routeIndex,
    waypointIndex,
    loopDirection,
    laneOffset,
  }
}

export interface SzjCrowdSim {
  readonly agents: SzjAgentState[]
  readonly routes: readonly ResolvedRoute[]
  readonly keeperCount: number
  readonly customerCount: number
  readonly walkerCount: number
  step(dtSec: number): void
}

function spawnWalkerOnRoute(
  index: number,
  routeIndex: number,
  route: ResolvedRoute,
  rng: SeededRng,
  floorY: number,
): SzjAgentState {
  const pts = route.points
  const segCount = route.loop ? pts.length : Math.max(1, pts.length - 1)
  const segIdx = index % segCount
  const nextIdx = route.loop ? (segIdx + 1) % pts.length : Math.min(pts.length - 1, segIdx + 1)
  const a = pts[segIdx]!
  const b = pts[nextIdx]!
  const t = rng.next()
  const dx = b.x - a.x
  const dz = b.z - a.z
  const len = Math.hypot(dx, dz) || 1
  const nx = -dz / len
  const nz = dx / len
  const dir: 1 | -1 = index % 2 === 0 ? 1 : -1
  const lane = (dir > 0 ? 0.72 : -0.72) + rng.range(-0.35, 0.35)
  const px = a.x + dx * t + nx * lane
  const pz = a.z + dz * t + nz * lane
  const yaw = yawFacing({ x: dx * dir, z: dz * dir })
  const wpIdx = dir > 0 ? nextIdx : segIdx
  return createAgent(index, 'walker', 'walk', px, floorY, pz, yaw, rng, routeIndex, wpIdx, dir, lane)
}

export function createSzjCrowdSim(
  layout: SzjCrowdLayoutInput | undefined,
  maxNpcs: number,
  seed: number | string,
  floorY: number,
): SzjCrowdSim {
  const cap = Math.max(0, Math.min(MAX_SHIZIJIE_CROWD_NPCS, Math.floor(maxNpcs)))
  const rng = createSeededRng(seed)
  const routes = buildRoutes(layout)
  const agents: SzjAgentState[] = []

  const pushSpot = (spot: SzjNpcSpot) => {
    if (agents.length >= cap) return
    const role = spot.role === 'keeper' ? 'keeper' : 'customer'
    const pose: SzjCrowdPose = spot.pose ?? (role === 'keeper' ? 'tidy' : 'browse')
    agents.push(
      createAgent(
        agents.length,
        role,
        pose,
        spot.x,
        floorY,
        spot.z,
        spot.yaw,
        rng,
        0,
        0,
        1,
        0,
      ),
    )
  }

  // 1) 标准契约 layout：优先遍历 layout.shops[].npcSpots 与 layout.walkers[]
  if (layout?.shops && layout.shops.length > 0) {
    for (let i = 0; i < layout.shops.length && agents.length < cap; i++) {
      const spots = layout.shops[i]!.npcSpots
      if (!spots) continue
      for (let j = 0; j < spots.length && agents.length < cap; j++) {
        pushSpot(spots[j]!)
      }
    }
    if (layout.walkers && layout.walkers.length > 0) {
      for (let r = 0; r < layout.walkers.length && agents.length < cap; r++) {
        const w = layout.walkers[r]!
        const route = routes[Math.min(r, routes.length - 1)]!
        const targetCount = Math.max(0, Math.floor(w.count))
        for (let k = 0; k < targetCount && agents.length < cap; k++) {
          agents.push(spawnWalkerOnRoute(agents.length, Math.min(r, routes.length - 1), route, rng, floorY))
        }
      }
    }
  } else if (layout?.npcSpots && layout.npcSpots.length > 0) {
    for (let i = 0; i < layout.npcSpots.length && agents.length < cap; i++) {
      pushSpot(layout.npcSpots[i]!)
    }
  } else {
    // 2) 无 layout 兜底：沿十字街 B1 环廊生成 14 店主 + 16 顾客 + 18 通道行人 = 48 人
    const keeperSlots = Math.min(14, Math.floor(cap * 0.3))
    for (let i = 0; i < keeperSlots && agents.length < cap; i++) {
      const ang = (i / Math.max(1, keeperSlots)) * Math.PI * 2
      const sx = Math.cos(ang) * 24.0
      const sz = Math.sin(ang) * 22.2
      const pose: SzjCrowdPose = i % 2 === 0 ? 'tidy' : 'idle'
      agents.push(
        createAgent(agents.length, 'keeper', pose, sx, floorY, sz, yawFacing({ x: -sx, z: -sz }), rng, 0, 0, 1, 0),
      )
    }
    const custSlots = Math.min(16, Math.floor(cap * 0.34))
    const custPoses: readonly SzjCrowdPose[] = ['browse', 'browse', 'chat', 'phone']
    for (let i = 0; i < custSlots && agents.length < cap; i++) {
      const ang = ((i + 0.35) / Math.max(1, custSlots)) * Math.PI * 2
      const cx = Math.cos(ang) * 22.1
      const cz = Math.sin(ang) * 20.4
      const pose = custPoses[i % custPoses.length]!
      agents.push(
        createAgent(agents.length, 'customer', pose, cx, floorY, cz, yawFacing({ x: cx, z: cz }), rng, 0, 0, -1, 0),
      )
    }
    while (agents.length < cap) {
      const rIdx = agents.length % routes.length
      agents.push(spawnWalkerOnRoute(agents.length, rIdx, routes[rIdx]!, rng, floorY))
    }
  }

  let keeperCount = 0
  let customerCount = 0
  let walkerCount = 0
  for (let i = 0; i < agents.length; i++) {
    const r = agents[i]!.role
    if (r === 'keeper') keeperCount++
    else if (r === 'customer') customerCount++
    else walkerCount++
  }

  function step(dtSec: number): void {
    const dt = Math.min(0.1, Math.max(0, Number.isFinite(dtSec) ? dtSec : 0))
    if (dt === 0) return
    const turnAlpha = Math.min(1, dt * 7.5)

    for (let i = 0; i < agents.length; i++) {
      const a = agents[i]!
      a.actionPhase += dt * 1.35

      if (a.role === 'walker') {
        const route = routes[a.routeIndex]!
        const pts = route.points
        const len = pts.length
        const target = pts[a.waypointIndex]!
        let prevIdx = a.waypointIndex - a.loopDirection
        if (route.loop) {
          prevIdx = (prevIdx + len) % len
        } else {
          prevIdx = Math.max(0, Math.min(len - 1, prevIdx))
        }
        const prev = pts[prevIdx]!
        const segX = target.x - prev.x
        const segZ = target.z - prev.z
        const segLen = Math.hypot(segX, segZ) || 1
        const tx = target.x + (-segZ / segLen) * a.laneOffset
        const tz = target.z + (segX / segLen) * a.laneOffset

        const dx = tx - a.x
        const dz = tz - a.z
        const dist = Math.hypot(dx, dz)

        if (dist < 0.65) {
          if (route.loop) {
            a.waypointIndex = (a.waypointIndex + a.loopDirection + len) % len
          } else {
            const next = a.waypointIndex + a.loopDirection
            if (next >= len) {
              a.loopDirection = -1
              a.waypointIndex = Math.max(0, len - 2)
            } else if (next < 0) {
              a.loopDirection = 1
              a.waypointIndex = Math.min(len - 1, 1)
            } else {
              a.waypointIndex = next
            }
          }
        } else {
          const stepDist = Math.min(dist, a.speed * dt)
          a.x += (dx / dist) * stepDist
          a.z += (dz / dist) * stepDist
          const desiredYaw = yawFacing({ x: dx, z: dz })
          a.yaw = lerpAngle(a.yaw, desiredYaw, turnAlpha)
          a.walkPhase += dt * (a.speed * 5.2)
        }
        continue
      }

      a.stateTimer += dt
      if (a.stateTimer >= a.stateDuration) {
        a.stateTimer = 0
        if (a.role === 'keeper') {
          a.pose = a.pose === 'tidy' ? 'idle' : 'tidy'
        } else if (a.basePose === 'browse') {
          a.pose = a.pose === 'browse' ? 'idle' : 'browse'
        }
      }

      if (a.role === 'keeper') {
        const sideOffset = a.pose === 'tidy' ? Math.sin(a.actionPhase * 0.65) * 0.25 : 0
        const cosY = Math.cos(a.homeYaw)
        const sinY = Math.sin(a.homeYaw)
        const goalX = a.homeX + cosY * sideOffset
        const goalZ = a.homeZ - sinY * sideOffset
        const moveX = goalX - a.x
        const moveZ = goalZ - a.z
        a.x += moveX * Math.min(1, dt * 3.5)
        a.z += moveZ * Math.min(1, dt * 3.5)
        a.speed = Math.hypot(moveX, moveZ) * 2.0
        a.yaw = lerpAngle(a.yaw, a.homeYaw + Math.sin(a.actionPhase * 0.45) * 0.2, turnAlpha)
        if (a.speed > 0.08) a.walkPhase += dt * 4.5
      } else {
        const browseSlide = a.pose === 'browse' ? Math.sin(a.actionPhase * 0.42 + a.index) * 0.36 : 0
        const cosY = Math.cos(a.homeYaw)
        const sinY = Math.sin(a.homeYaw)
        const goalX = a.homeX + cosY * browseSlide
        const goalZ = a.homeZ - sinY * browseSlide
        const moveX = goalX - a.x
        const moveZ = goalZ - a.z
        a.x += moveX * Math.min(1, dt * 2.8)
        a.z += moveZ * Math.min(1, dt * 2.8)
        a.speed = Math.hypot(moveX, moveZ) * 1.8
        a.yaw = lerpAngle(a.yaw, a.homeYaw + Math.cos(a.actionPhase * 0.5) * 0.28, turnAlpha)
        if (a.speed > 0.08) a.walkPhase += dt * 4.2
      }
    }
  }

  return {
    agents,
    routes,
    keeperCount,
    customerCount,
    walkerCount,
    step,
  }
}
