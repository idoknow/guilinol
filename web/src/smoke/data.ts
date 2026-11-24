export const BURN_TOTAL = 180
export const PUFF_COST = 15
export const PUFF_GAP = 15
export type BrandId = 'plain'
export interface BrandDef {id: BrandId; pack: string; lid: string; tip: string; ember: number}
export const BRANDS: readonly BrandDef[] = [{id:'plain',pack:'#e3ddcc',lid:'#c9c4b6',tip:'#c9a06a',ember:0xff7a2a}]
export const brandOf = (_id: BrandId) => BRANDS[0]
