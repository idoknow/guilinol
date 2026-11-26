import { createSzjCrowdSim } from './crowd-sim.ts'
import { ShizijieNpcRigPool } from './rig-pool.ts'
import {
  DEFAULT_INDOOR_FLOOR_Y,
  MAX_SHIZIJIE_CROWD_DRAW_CALLS,
  MAX_SHIZIJIE_CROWD_NPCS,
  MAX_SHIZIJIE_CROWD_STEP_MS,
  type SzjAgentSnapshot,
  type SzjCrowdHandle,
  type SzjCrowdLiveProbe,
  type SzjCrowdMetrics,
  type SzjCrowdOptions,
} from './types.ts'

export {
  DEFAULT_INDOOR_FLOOR_Y,
  MAX_SHIZIJIE_CROWD_DRAW_CALLS,
  MAX_SHIZIJIE_CROWD_NPCS,
  MAX_SHIZIJIE_CROWD_STEP_MS,
} from './types.ts'
export type {
  SzjAgentSnapshot,
  SzjAgentState,
  SzjCorridor,
  SzjCrowdHandle,
  SzjCrowdLayoutInput,
  SzjCrowdLiveProbe,
  SzjCrowdMetrics,
  SzjCrowdOptions,
  SzjCrowdPose,
  SzjCrowdRole,
  SzjLayout,
  SzjNpcPose,
  SzjNpcRole,
  SzjNpcSpot,
  SzjShop,
  SzjWalker,
  SzjXZ,
} from './types.ts'
export { ShizijieNpcRigPool } from './rig-pool.ts'
export { createSeededRng, pickNpcPalette } from './palette.ts'

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

let activeLiveProbe: SzjCrowdLiveProbe | null = null

export function getActiveSzjCrowdProbe(): SzjCrowdLiveProbe | null {
  return activeLiveProbe
}

function publishGlobalCrowdProbe(probe: SzjCrowdLiveProbe | null, expected?: SzjCrowdLiveProbe): void {
  const g = globalThis as Record<string, unknown>
  if (probe) {
    g.__szjCrowdProbe = probe
  } else if (!expected || g.__szjCrowdProbe === expected) {
    delete g.__szjCrowdProbe
  }
}

/**
 * 创建十字街 B1 地下街非交互式背景人群（对齐 contract.ts v1）：
 * - 直接接受 contract.ts 的 SzjLayout（layout.shops[].npcSpots + layout.walkers[]）；
 * - 严格实例化渲染（48 名 NPC 合计仅 <= 6 drawCalls）；
 * - 支持 keeper（idle/tidy）、customer（browse/phone/chat/idle）与 walker（loop/往返通道步行）；
 * - dispose() 彻底释放所有几何与材质，零泄漏。
 */
export function createShizijieCrowd(options: SzjCrowdOptions = {}): SzjCrowdHandle {
  const capacity = Math.max(
    1,
    Math.min(MAX_SHIZIJIE_CROWD_NPCS, Math.floor(options.maxNpcs ?? MAX_SHIZIJIE_CROWD_NPCS)),
  )
  const layoutFloorY =
    options.layout && 'floorY' in options.layout && typeof options.layout.floorY === 'number'
      ? options.layout.floorY
      : DEFAULT_INDOOR_FLOOR_Y
  const floorY = options.floorY ?? layoutFloorY
  const seed = options.seed ?? 'shizijie-b1-crowd-v1'

  const sim = createSzjCrowdSim(options.layout, capacity, seed, floorY)
  const pool = new ShizijieNpcRigPool(capacity)
  pool.applyInitialColors(sim.agents)
  pool.update(sim.agents)

  let disposed = false
  let lastStepMs = 0
  let totalStepMs = 0
  let stepSamples = 0

  function step(dtSeconds: number): void {
    if (disposed) return
    const t0 = nowMs()
    sim.step(dtSeconds)
    pool.update(sim.agents)
    const elapsed = Math.max(0, nowMs() - t0)
    lastStepMs = elapsed
    totalStepMs += elapsed
    stepSamples += 1
  }

  function setVisible(visible: boolean): void {
    if (disposed) return
    pool.group.visible = Boolean(visible)
  }

  function getMetrics(): SzjCrowdMetrics {
    return {
      activeCount: disposed ? 0 : sim.agents.length,
      capacity,
      keeperCount: disposed ? 0 : sim.keeperCount,
      customerCount: disposed ? 0 : sim.customerCount,
      walkerCount: disposed ? 0 : sim.walkerCount,
      drawCalls: pool.getDrawCallCount(),
      triangles: pool.getTriangleCount(),
      lastStepMs: Math.round(lastStepMs * 10000) / 10000,
      avgStepMs: stepSamples > 0 ? Math.round((totalStepMs / stepSamples) * 10000) / 10000 : 0,
      stepSamples,
      disposed,
    }
  }

  function getAgentSnapshots(): readonly SzjAgentSnapshot[] {
    if (disposed) return []
    return sim.agents.map(a => ({
      id: a.id,
      role: a.role,
      pose: a.pose,
      x: Math.round(a.x * 1000) / 1000,
      y: Math.round(a.y * 1000) / 1000,
      z: Math.round(a.z * 1000) / 1000,
      yaw: Math.round(a.yaw * 10000) / 10000,
      speed: Math.round(a.speed * 1000) / 1000,
      hasProp: a.hasProp,
    }))
  }

  const liveProbe: SzjCrowdLiveProbe = Object.freeze({
    getMetrics,
    setVisible,
    isVisible: () => !disposed && pool.group.visible,
  })
  pool.group.userData.szjCrowdProbe = liveProbe
  activeLiveProbe = liveProbe
  publishGlobalCrowdProbe(liveProbe)

  function dispose(): void {
    if (disposed) return
    disposed = true
    delete pool.group.userData.szjCrowdProbe
    if (activeLiveProbe === liveProbe) activeLiveProbe = null
    publishGlobalCrowdProbe(null, liveProbe)
    pool.dispose()
  }

  return {
    group: pool.group,
    capacity,
    step,
    setVisible,
    getMetrics,
    getAgentSnapshots,
    dispose,
  }
}
