import { canTransition, type XxgPortalId, type XxgState } from '../contract.ts'

/** Contract state table plus the portal the player came in through; entry/exit triggers live in the controller. */
export interface XxgRuntimeStateMachine {
  getState(): XxgState
  transitionTo(next: XxgState): boolean
  getActivePortalId(): XxgPortalId | null
  setActivePortalId(id: XxgPortalId | null): void
  dispose(): void
}

export function createXxgRuntimeStateMachine(): XxgRuntimeStateMachine {
  let state: XxgState = 'unmounted'
  let activePortalId: XxgPortalId | null = null

  return {
    getState: () => state,

    transitionTo(next: XxgState): boolean {
      if (state === next && (next === 'idle' || next === 'disposed')) return true
      if (!canTransition(state, next)) return false
      state = next
      if (next === 'disposed') activePortalId = null
      return true
    },

    getActivePortalId: () => activePortalId,
    setActivePortalId(id) {
      activePortalId = id
    },

    dispose() {
      state = 'disposed'
      activePortalId = null
    },
  }
}
