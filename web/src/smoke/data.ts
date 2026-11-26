import {BRANDS, smokeDefaults} from '../../../lib/smoke.ts'
export {BRANDS, brandOf, smokeDefaults, validRules, type BrandDef, type BrandId} from '../../../lib/smoke.ts'

export const rules = structuredClone(smokeDefaults)
export interface Pack {brand:string; remaining:number; opened:boolean}
export function readPacks(raw:unknown):Pack[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(p => p && BRANDS.some(b => b.id === p.brand) && Number.isInteger(p.remaining) && p.remaining > 0 && p.remaining <= 20)
    .slice(0,3).map(({brand,remaining,opened}) => ({brand,remaining,opened:opened===true || remaining<20}))
}
