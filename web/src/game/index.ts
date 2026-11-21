/**
 * Public entry point for `web/src/game/*` (Stage 1A / IDOK-122).
 * Initializes `localStorage['glol.save.v1']` and provides the read-only `window.viewer.game` debug probe.
 */

import * as catalog from './catalog'
import * as commerce from './commerce'
import * as quietZones from './quiet-zones'
import * as save from './save'
import * as shops from './shops'
import {emit, getState, onEvent, onState} from './state'

export * from './catalog'
export * from './commerce'
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

export function createGameDebugProbe() {
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
    }),
    save: Object.freeze({
      getSnapshot: save.getActiveSaveSnapshot,
      loadLocalSave: save.loadLocalSave,
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
    }),
  })
}
