import {
  XXG_PORTALS,
  XXG_TIMING,
  canTransition,
  shouldEnterPortal,
  type XxgPortal,
  type XxgPortalId,
  type XxgState,
  type XxgXZ,
} from '../contract.ts'

export interface XxgRuntimeStateMachine {
  getState(): XxgState
  transitionTo(next: XxgState): boolean
  getActivePortalId(): XxgPortalId | null
  setActivePortalId(id: XxgPortalId | null): void
  getNearbyPortalId(): XxgPortalId | null
  markPortalExitCooldown(id: XxgPortalId, nowMs: number, cooldownMs?: number): void
  detectSurfaceEntry(
    pos: { x: number; y: number; z: number },
    vel: XxgXZ,
    nowMs: number,
  ): { nearbyPortal: XxgPortal | null; triggeredPortal: XxgPortal | null }
  dispose(): void
}

export function createXxgRuntimeStateMachine(
  portals: readonly XxgPortal[] = XXG_PORTALS,
  defaultCooldownMs: number = XXG_TIMING.reenterCooldownMs,
): XxgRuntimeStateMachine {
  let state: XxgState = 'unmounted'
  let activePortalId: XxgPortalId | null = null
  let nearbyPortalId: XxgPortalId | null = null
  const cooldownUntilByPortal = new Map<XxgPortalId, number>()

  return {
    getState: () => state,

    transitionTo(next: XxgState): boolean {
      if (state === next && (next === 'idle' || next === 'disposed')) return true
      if (!canTransition(state, next)) return false
      state = next
      if (next === 'idle' || next === 'unmounted' || next === 'disposed') {
        if (next === 'disposed') {
          activePortalId = null
          nearbyPortalId = null
          cooldownUntilByPortal.clear()
        }
      }
      return true
    },

    getActivePortalId: () => activePortalId,
    setActivePortalId(id) {
      activePortalId = id
    },
    getNearbyPortalId: () => nearbyPortalId,

    markPortalExitCooldown(id, nowMs, cooldownMs = defaultCooldownMs) {
      cooldownUntilByPortal.set(id, nowMs + Math.max(0, cooldownMs))
    },

    detectSurfaceEntry(pos, vel, nowMs) {
      if (state !== 'idle') {
        return { nearbyPortal: null, triggeredPortal: null }
      }

      let closest: XxgPortal | null = null
      let closestDist = Infinity
      for (const p of portals) {
        const d = Math.hypot(pos.x - p.world.x, pos.z - p.world.z)
        if (d < closestDist) {
          closestDist = d
          closest = p
        }
      }
      nearbyPortalId = closest && closestDist <= 6.2 ? closest.id : null

      for (const p of portals) {
        const until = cooldownUntilByPortal.get(p.id) ?? 0
        if (nowMs < until) continue
        if (shouldEnterPortal(p, pos, vel)) {
          return { nearbyPortal: closest && closestDist <= 6.2 ? closest : null, triggeredPortal: p }
        }
      }

      return {
        nearbyPortal: closest && closestDist <= 6.2 ? closest : null,
        triggeredPortal: null,
      }
    },

    dispose() {
      state = 'disposed'
      activePortalId = null
      nearbyPortalId = null
      cooldownUntilByPortal.clear()
    },
  }
}
