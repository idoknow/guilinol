import {
  SZJ_STAIRWELLS,
  SZJ_TIMING,
   SZJ_TRIGGER,
  canTransition,
  shouldEnterStair,
  type SzjStairId,
  type SzjStairwell,
  type SzjState,
  type SzjXZ,
} from '../contract.ts'

export interface SzjRuntimeStateMachine {
  getState(): SzjState
  transitionTo(next: SzjState): boolean
  getActiveStairId(): SzjStairId | null
  setActiveStairId(id: SzjStairId | null): void
  getNearbyStairId(): SzjStairId | null
  markStairExitCooldown(id: SzjStairId, nowMs: number, cooldownMs?: number): void
  detectSurfaceEntry(
    pos: { x: number; y: number; z: number },
    vel: SzjXZ,
    nowMs: number,
  ): { nearbyStair: SzjStairwell | null; triggeredStair: SzjStairwell | null }
  dispose(): void
}

export function createSzjRuntimeStateMachine(
  stairwells: readonly SzjStairwell[] = SZJ_STAIRWELLS,
  defaultCooldownMs: number = SZJ_TIMING.reenterCooldownMs,
): SzjRuntimeStateMachine {
  let state: SzjState = 'unmounted'
  let activeStairId: SzjStairId | null = null
  let nearbyStairId: SzjStairId | null = null
  const cooldownUntilByStair = new Map<SzjStairId, number>()

  return {
    getState: () => state,

    transitionTo(next: SzjState): boolean {
      if (state === next && (next === 'idle' || next === 'disposed')) return true
      if (!canTransition(state, next)) return false
      state = next
      if (next === 'disposed') {
        activeStairId = null
        nearbyStairId = null
        cooldownUntilByStair.clear()
      }
      return true
    },

    getActiveStairId: () => activeStairId,
    setActiveStairId(id) {
      activeStairId = id
    },
    getNearbyStairId: () => nearbyStairId,

    markStairExitCooldown(id, nowMs, cooldownMs = defaultCooldownMs) {
      cooldownUntilByStair.set(id, nowMs + Math.max(0, cooldownMs))
    },

    detectSurfaceEntry(pos, vel, nowMs) {
      if (state !== 'idle') {
        return { nearbyStair: null, triggeredStair: null }
      }

      let closest: SzjStairwell | null = null
      let closestDist = Infinity
      let promptRadius = 7
      for (const st of stairwells) {
        const d = Math.hypot(pos.x - st.world.x, pos.z - st.world.z)
        if (d < closestDist) {
          closestDist = d
          closest = st
          promptRadius = st.length * 0.5 + SZJ_TRIGGER.landingOut * 2
        }
      }
      nearbyStairId = closest && closestDist <= promptRadius ? closest.id : null

      for (const st of stairwells) {
        const until = cooldownUntilByStair.get(st.id) ?? 0
        if (nowMs < until) continue
        if (shouldEnterStair(st, pos, vel)) {
          return {
            nearbyStair: closest && closestDist <= promptRadius ? closest : null,
            triggeredStair: st,
          }
        }
      }

      return {
        nearbyStair: closest && closestDist <= promptRadius ? closest : null,
        triggeredStair: null,
      }
    },

    dispose() {
      state = 'disposed'
      activeStairId = null
      nearbyStairId = null
      cooldownUntilByStair.clear()
    },
  }
}
