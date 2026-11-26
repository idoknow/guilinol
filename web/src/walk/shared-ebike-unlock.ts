/**
 * Shared e-bike v1 unlock & v2 lifecycle extension hook.
 *
 * v1 handles immediate wallet-backed unlocking (¥2 upfront in solo mode,
 * explicit tour-mode fallback when solo wallet is inactive). Future v2 can
 * plug in mobile QR scan animation and parking-box return verification via
 * `registerSharedEbikeUnlockHooks` without rewriting vehicle physics.
 */

export type SharedEbikeUnlockPhase =
  | 'idle'
  | 'unlocking'
  | 'active'
  | 'returning'
  | 'insufficient_funds'
  | 'blocked'

export interface SharedEbikeUnlockRequest {
  bikeId: string
  sessionKey: string
  soloEnabled: boolean
  alreadyUnlocked: boolean
  feeYuan?: number
}

export type SharedEbikeUnlockCode =
  | 'OK'
  | 'ALREADY_UNLOCKED'
  | 'INSUFFICIENT_FUNDS'
  | 'TOUR_FREE_FALLBACK'
  | 'IN_PROGRESS'
  | 'BLOCKED'

export interface SharedEbikeUnlockDecision {
  ok: boolean
  code: SharedEbikeUnlockCode
  charged: number
  balanceAfter: number | null
  feeYuan: number
  deficitYuan?: number
  message: string
  phase: SharedEbikeUnlockPhase
}

export interface SharedEbikeReturnRequest {
  bikeId: string
  sessionKey: string
  soloEnabled: boolean
  inParkingZone?: boolean
}

export interface SharedEbikeReturnDecision {
  ok: boolean
  phase: SharedEbikeUnlockPhase
  message?: string
}

export type SharedEbikeUnlockBackend = (req: {
  sessionKey: string
  feeYuan?: number
}) => {
  ok: boolean
  code: 'OK' | 'IDEMPOTENT_REPLAY' | 'INSUFFICIENT_FUNDS' | 'FAILED'
  charged: number
  balanceAfter: number
  feeYuan: number
  deficitYuan: number
  message: string
}

export interface SharedEbikeUnlockHooks {
  /** Override/extend unlock flow (e.g. v2 phone QR scan modal/timer). */
  beforeUnlock?: (req: SharedEbikeUnlockRequest) => SharedEbikeUnlockDecision | null
  /** Override/extend return verification (e.g. v2 designated parking bay check). */
  onReturn?: (req: SharedEbikeReturnRequest) => SharedEbikeReturnDecision | null
}

export const SHARED_EBIKE_V1_DEFAULT_FEE_YUAN = 2

let customHooks: SharedEbikeUnlockHooks = {}

/**
 * Registers v2 UI/flow hooks (phone scan, parking-box return) cleanly while
 * keeping v1 atomic billing + riding physics intact.
 */
export function registerSharedEbikeUnlockHooks(hooks: SharedEbikeUnlockHooks): void {
  customHooks = {...customHooks, ...hooks}
}

export function resetSharedEbikeUnlockHooks(): void {
  customHooks = {}
}

/**
 * Resolves whether mounting a shared e-bike is permitted and performs the
 * atomic v1 unlock fee settlement when riding in solo economy mode.
 */
export function requestSharedEbikeUnlock(
  req: SharedEbikeUnlockRequest,
  chargeSoloUnlock?: SharedEbikeUnlockBackend,
): SharedEbikeUnlockDecision {
  const feeYuan = Math.max(0, Math.round(req.feeYuan ?? SHARED_EBIKE_V1_DEFAULT_FEE_YUAN))

  if (customHooks.beforeUnlock) {
    const hooked = customHooks.beforeUnlock(req)
    if (hooked) return hooked
  }

  if (req.alreadyUnlocked) {
    return {
      ok: true,
      code: 'ALREADY_UNLOCKED',
      charged: 0,
      balanceAfter: null,
      feeYuan,
      message: '',
      phase: 'active',
    }
  }

  if (!req.soloEnabled || !chargeSoloUnlock) {
    return {
      ok: true,
      code: 'TOUR_FREE_FALLBACK',
      charged: 0,
      balanceAfter: null,
      feeYuan: 0,
      message: '',
      phase: 'active',
    }
  }

  const res = chargeSoloUnlock({sessionKey: req.sessionKey, feeYuan})
  if (!res.ok) {
    return {
      ok: false,
      code: res.code === 'INSUFFICIENT_FUNDS' ? 'INSUFFICIENT_FUNDS' : 'BLOCKED',
      charged: 0,
      balanceAfter: res.balanceAfter,
      feeYuan: res.feeYuan,
      deficitYuan: res.deficitYuan,
      message: res.message,
      phase: res.code === 'INSUFFICIENT_FUNDS' ? 'insufficient_funds' : 'blocked',
    }
  }

  return {
    ok: true,
    code: res.code === 'IDEMPOTENT_REPLAY' ? 'ALREADY_UNLOCKED' : 'OK',
    charged: res.charged,
    balanceAfter: res.balanceAfter,
    feeYuan: res.feeYuan,
    message: res.charged > 0 ? `已扣 ¥${res.charged} 解锁共享电动车（限速 18 km/h · 禁翘头）` : '',
    phase: 'active',
  }
}

/**
 * v2 hook placeholder invoked when the player ends a shared bike session.
 */
export function requestSharedEbikeReturn(req: SharedEbikeReturnRequest): SharedEbikeReturnDecision {
  if (customHooks.onReturn) {
    const hooked = customHooks.onReturn(req)
    if (hooked) return hooked
  }
  return {
    ok: true,
    phase: 'idle',
  }
}
