import {BRANDS, smokeDefaults} from '../../../lib/smoke.ts'
export {BRANDS, brandOf, smokeDefaults, validRules, type BrandDef, type BrandId} from '../../../lib/smoke.ts'

export const rules = structuredClone(smokeDefaults)
export const SMOKE_LOW_LENGTH = 0.2
export interface Pack {brand:string; remaining:number; opened:boolean}
export function readPacks(raw:unknown):Pack[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(p => p && BRANDS.some(b => b.id === p.brand) && Number.isInteger(p.remaining) && p.remaining > 0 && p.remaining <= 20)
    .slice(0,3).map(({brand,remaining,opened}) => ({brand,remaining,opened:opened===true || remaining<20}))
}
export function isLowSmokeBurn(length:number):boolean {
  return length > 0 && length <= SMOKE_LOW_LENGTH + 1e-6
}
export function formatSmokeCount(remaining:number, packCount:number, context:'hud'|'backpack'='hud'):string {
  if (context === 'backpack') {
    if (packCount <= 0) return '已抽完'
    return packCount > 1 ? `剩余 ${remaining} / 20 · 共 ${packCount} 盒` : `剩余 ${remaining} / 20`
  }
  const base = `剩余 ${remaining} / 20`
  if (remaining > 0 && packCount > 1) return `${base} · 共 ${packCount} 盒`
  if (remaining === 0 && packCount > 0) return `${base} · 另 ${packCount} 盒`
  return base
}
