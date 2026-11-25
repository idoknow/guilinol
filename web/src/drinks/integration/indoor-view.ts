import type { DrinkShopLayout } from '../sim/types.ts'
import { worldToShopLocal, type DrinksSiteCandidate } from '../site.ts'

export type DrinksViewMode = 'third' | 'first'

/**
 * View-mode adapter matching `web/src/walk/view-mode.ts` (`isFirstPerson` / `setViewMode`)
 * plus optional scoped indoor first-person override hooks if exposed by host integration.
 */
export interface DrinksViewModeAdapter {
  isFirstPerson(): boolean
  setViewMode(mode: DrinksViewMode): void
  enterIndoorFirstPerson?(ownerId: string): void
  leaveIndoorFirstPerson?(ownerId: string): void
}

export interface DrinksInteriorBounds {
  readonly minX: number
  readonly maxX: number
  readonly minZ: number
  /** Doorway glass facade Z in shop-local meters (interior is `z <= doorZ`). */
  readonly doorZ: number
  /** Inward margin past doorway sill to trigger indoor switch (prevents edge flicker). */
  readonly enterMarginM: number
  /** Outward margin past doorway sill to restore previous view (hysteresis). */
  readonly exitMarginM: number
}

export interface DrinksIndoorViewState {
  readonly inside: boolean
  readonly autoSwitched: boolean
  readonly savedMode: DrinksViewMode | null
  readonly localX: number | null
  readonly localZ: number | null
}

export interface DrinksIndoorViewOptions {
  site: Pick<DrinksSiteCandidate, 'worldX' | 'worldZ' | 'worldYaw'>
  layout?: Pick<DrinkShopLayout, 'width' | 'depth' | 'entrance'>
  bounds?: Partial<DrinksInteriorBounds>
  viewMode: DrinksViewModeAdapter
  ownerId?: string
  bodyDataset?: Record<string, string | undefined> | null
}

export interface DrinksIndoorViewController {
  /**
   * Call once per frame with player's world position (or null when inactive/flying/riding).
   * Crossing inward through the doorway switches to first-person; exiting restores original view.
   */
  update(playerWorldPos: { x: number; z: number } | null, enabled?: boolean): DrinksIndoorViewState
  isInside(): boolean
  getState(): DrinksIndoorViewState
  reset(): void
  dispose(): void
}

/**
 * Derive shop-local interior bounds from `DrinkShopLayout` (`x ∈ [-width/2, +width/2]`,
 * back wall at `-4.6m` or derived from `entrance.z - 7.4`, doorway facade at `entrance.z`).
 */
export function resolveDrinksInteriorBounds(
  layout?: Pick<DrinkShopLayout, 'width' | 'depth' | 'entrance'>,
  overrides?: Partial<DrinksInteriorBounds>,
): DrinksInteriorBounds {
  const halfW = (layout?.width ?? 11.4) * 0.5
  const doorZ = layout?.entrance?.z ?? 2.8
  // Standard patio extends 2.4m in front of doorZ; interior spans back wall to doorZ.
  const interiorDepth = Math.max(4.0, (layout?.depth ?? 9.8) - 2.4)
  return {
    minX: overrides?.minX ?? -halfW,
    maxX: overrides?.maxX ?? halfW,
    minZ: overrides?.minZ ?? doorZ - interiorDepth,
    doorZ: overrides?.doorZ ?? doorZ,
    enterMarginM: overrides?.enterMarginM ?? 0.15,
    exitMarginM: overrides?.exitMarginM ?? 0.22,
  }
}

export function isLocalPointInsideDrinksShop(
  lx: number,
  lz: number,
  bounds: DrinksInteriorBounds,
  wasInside: boolean,
): boolean {
  if (!Number.isFinite(lx) || !Number.isFinite(lz)) return false
  if (!wasInside) {
    return (
      lx >= bounds.minX + bounds.enterMarginM &&
      lx <= bounds.maxX - bounds.enterMarginM &&
      lz >= bounds.minZ + bounds.enterMarginM &&
      lz <= bounds.doorZ - bounds.enterMarginM
    )
  }
  return (
    lx >= bounds.minX - bounds.exitMarginM &&
    lx <= bounds.maxX + bounds.exitMarginM &&
    lz >= bounds.minZ - bounds.exitMarginM &&
    lz <= bounds.doorZ + bounds.exitMarginM
  )
}

/**
 * Automatic doorway first-person view controller for Wangcheng drinks shop:
 * - Crossing inward past the doorway automatically switches third-person -> first-person.
 * - Stepping back outside restores the exact view mode the player had before entering
 *   (preserves manual first-person if the player was already in first-person).
 * - Uses doorway threshold hysteresis to prevent rapid view flickering on the sill.
 * - Leaving walk mode, mounting a vehicle (`enabled = false`), `reset()`, or `dispose()`
 *   always cleanly restores the original view mode.
 */
export function createDrinksIndoorViewController(
  opts: DrinksIndoorViewOptions,
): DrinksIndoorViewController {
  const bounds = resolveDrinksInteriorBounds(opts.layout, opts.bounds)
  const ownerId = opts.ownerId ?? 'drinks_shop'
  let inside = false
  let autoSwitched = false
  let savedMode: DrinksViewMode | null = null
  let lastLocalX: number | null = null
  let lastLocalZ: number | null = null
  let disposed = false

  function writeBodyFlag(val: '1' | '0' | null): void {
    const ds = opts.bodyDataset !== undefined
      ? opts.bodyDataset
      : typeof document !== 'undefined' && document.body
        ? (document.body.dataset as Record<string, string | undefined>)
        : null
    if (!ds) return
    if (val === null) delete ds.drinksIndoor
    else ds.drinksIndoor = val
  }

  function enterInterior(): void {
    inside = true
    writeBodyFlag('1')
    if (typeof opts.viewMode.enterIndoorFirstPerson === 'function') {
      savedMode = opts.viewMode.isFirstPerson() ? 'first' : 'third'
      autoSwitched = true
      opts.viewMode.enterIndoorFirstPerson(ownerId)
      return
    }
    const alreadyFirst = opts.viewMode.isFirstPerson()
    savedMode = alreadyFirst ? 'first' : 'third'
    if (!alreadyFirst) {
      autoSwitched = true
      opts.viewMode.setViewMode('first')
    } else {
      autoSwitched = false
    }
  }

  function exitInterior(deleteFlag = false): void {
    const wasAuto = autoSwitched
    const restoreTo = savedMode
    inside = false
    autoSwitched = false
    savedMode = null
    writeBodyFlag(deleteFlag ? null : '0')
    if (!wasAuto) return
    if (typeof opts.viewMode.leaveIndoorFirstPerson === 'function') {
      opts.viewMode.leaveIndoorFirstPerson(ownerId)
    } else if (restoreTo) {
      opts.viewMode.setViewMode(restoreTo)
    }
  }

  function snapshot(): DrinksIndoorViewState {
    return {
      inside,
      autoSwitched,
      savedMode,
      localX: lastLocalX,
      localZ: lastLocalZ,
    }
  }

  return {
    update(playerWorldPos, enabled = true): DrinksIndoorViewState {
      if (disposed) return snapshot()
      if (!enabled || !playerWorldPos) {
        lastLocalX = null
        lastLocalZ = null
        if (inside) exitInterior(false)
        return snapshot()
      }
      const local = worldToShopLocal(opts.site, playerWorldPos.x, playerWorldPos.z)
      lastLocalX = Math.round(local.x * 1000) / 1000
      lastLocalZ = Math.round(local.z * 1000) / 1000
      const nextInside = isLocalPointInsideDrinksShop(local.x, local.z, bounds, inside)
      if (nextInside && !inside) {
        enterInterior()
      } else if (!nextInside && inside) {
        exitInterior(false)
      }
      return snapshot()
    },

    isInside: () => inside,
    getState: snapshot,

    reset() {
      if (inside) exitInterior(false)
      lastLocalX = null
      lastLocalZ = null
    },

    dispose() {
      if (disposed) return
      disposed = true
      if (inside) exitInterior(true)
      else writeBodyFlag(null)
      lastLocalX = null
      lastLocalZ = null
    },
  }
}
