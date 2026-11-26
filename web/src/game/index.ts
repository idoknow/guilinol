/**
 * Public entry point for `web/src/game/*` (Stage 1A / IDOK-122).
 * Initializes `localStorage['glol.save.v1']` and provides the read-only `window.viewer.game` debug probe.
 */

import * as catalog from './catalog'
import * as commerce from './commerce'
import * as quietZones from './quiet-zones'
import * as save from './save'
import * as shops from './shops'
import {emit, getState, onEvent, onState, setActiveShop} from './state'

export * from './catalog'
export * from './commerce'
export * from './missions'
export * from './quiet-zones'
export * from './save'
export * from './shops'
export * from './state'

let initialized = false

export function initGame(): save.LoadSaveResult {
  if (initialized) {
    return {
      save: save.cloneSave(save.getActiveSaveSnapshot()),
      source: 'local',
      corruptBackedUp: false,
    }
  }
  initialized = true
  return save.loadLocalSave()
}

export function createGameDebugProbe(extra?: {missions?: Record<string, unknown>}) {
  return Object.freeze({
    getState,
    onState,
    onEvent,
    emit,
    commerce: Object.freeze({
      executePurchase: commerce.executePurchase,
      creditReward: commerce.creditReward,
      applyFine: commerce.applyFine,
      quotePurchasePrice: commerce.quotePurchasePrice,
      equipOutfitItem: commerce.equipOutfitItem,
      equipOutfitPreset: commerce.equipOutfitPreset,
      setAutoHelmetOnRide: commerce.setAutoHelmetOnRide,
      selectActivePersonalVehicle: commerce.selectActivePersonalVehicle,
      updatePersonalVehicleTelemetry: commerce.updatePersonalVehicleTelemetry,
      recordSpotFound: commerce.recordSpotFound,
      SPOT_BOUNTY_YUAN: commerce.SPOT_BOUNTY_YUAN,
      SHARED_EBIKE_FEE_YUAN: commerce.SHARED_EBIKE_FEE_YUAN,
      SHARED_EBIKE_FREE_SECONDS: commerce.SHARED_EBIKE_FREE_SECONDS,
      hasClaimedSpotBounty: commerce.hasClaimedSpotBounty,
      hasClaimedMissionFirstClear: commerce.hasClaimedMissionFirstClear,
      claimSpotBounty: commerce.claimSpotBounty,
      computeMissionPayout: commerce.computeMissionPayout,
      settleMissionReward: commerce.settleMissionReward,
      unlockSharedEbike: commerce.unlockSharedEbike,
      chargeSharedRideFee: commerce.chargeSharedRideFee,
      getActiveDeliverySoupSpillMultiplier: commerce.getActiveDeliverySoupSpillMultiplier,
    }),
    save: Object.freeze({
      getSnapshot: save.getActiveSaveSnapshot,
      loadLocalSave: save.loadLocalSave,
      reload: save.reloadSaveFromStorage,
      reset: save.resetSaveForTesting,
      setActiveShop,
      flushThrottledSave: save.flushThrottledSave,
      mergeCloudAndLocalSave: save.mergeCloudAndLocalSave,
      validateCloudPayload: save.validateCloudPayload,
    }),
    shops: Object.freeze({
      list: shops.listShops,
      get: shops.getShop,
      findNearbyShopTrigger: shops.findNearbyShopTrigger,
      findNearbyServiceBay: shops.findNearbyServiceBay,
    }),
    catalog: Object.freeze({
      outfitItems: catalog.OUTFIT_ITEMS,
      outfitPresets: catalog.OUTFIT_PRESETS,
      ebikeModels: catalog.PERSONAL_EBIKE_MODELS,
      ebikeUpgrades: catalog.EBIKE_UPGRADE_CATALOG,
      ebikeVisuals: catalog.EBIKE_VISUAL_CATALOG,
      ebikeServices: catalog.EBIKE_SERVICE_CATALOG,
      resolvePersonalEbikeProfile: catalog.resolvePersonalEbikeProfile,
      calcFullServiceCost: catalog.calcFullServiceCost,
    }),
    quietZones: Object.freeze({
      zones: quietZones.QUIET_ZONES,
      isPointInQuietZone: quietZones.isPointInQuietZone,
      getQuietZoneAt: quietZones.getQuietZoneAt,
      findQuietZoneAt: quietZones.findQuietZoneAt,
      isPointInQuietZones: quietZones.isPointInQuietZones,
    }),
    quiet: Object.freeze({
      findQuietZoneAt: quietZones.findQuietZoneAt,
      isPointInQuietZones: quietZones.isPointInQuietZones,
    }),
    ...(extra?.missions ? {missions: Object.freeze({...extra.missions})} : {}),
  })
}
