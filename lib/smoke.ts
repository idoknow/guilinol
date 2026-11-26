export interface BrandDef {
  id: string
  name: string
  series: string
  price: number
  pack: string
  accent: string
  lid: string
  tip: string
  ember: number
  filterDot?: string
  length?: number
  faceTexture?: string
}
export type BrandId = string
function brand(id: string, name: string, series: string, price: number, pack: string, accent: string): BrandDef {
  return {id, name, series, price, pack, accent, lid: accent, tip: '#c9a06a', ember: 0xff7a2a, faceTexture: `/smoke/packs/${id}.svg`}
}
export const BRANDS = [
  brand('zhonghua','中桦','指定流通',45,'#973e35','#edcb89'),
  brand('hehua','河花','指定流通',38,'#396251','#d4bd78'),
  brand('bailong','白龙','桂林本地',25,'#edebe1','#68766c'),
  brand('zhenlong','珍龙','广西本地',30,'#5f3546','#dfba86'),
  brand('jiatianxia','甲天霞','桂林本地',35,'#ad654d','#eed99e'),
  brand('lijiang','漓江烟雨','桂林本地',50,'#477078','#dce6d6'),
  {...brand('yidianhong','一点虹','广西本地',12,'#a44336','#e8c89b'), filterDot:'#bc2428'},
  brand('erwujia','二伍甲','桂林本地',25,'#71624c','#dac6a1'),
  brand('bakuai','老八块','实惠促销',8,'#aa9770','#5d513c'),
  {...brand('letu','乐涂·金黄叶','广西本地',20,'#ca9c48','#765231'), length:70},
  brand('hongmei','红玫','指定流通',10,'#a15460','#ecd7be'),
  brand('dangui','丹桂','桂林本地',22,'#ad703f','#f1d8a2'),
]
export const brandOf = (id: string) => BRANDS.find(b => b.id === id) ?? BRANDS[0]
export const smokeDefaults = {
  minSeconds:150, maxSeconds:180, puffSegments:1, doubleChance:0.2, density:1,
  brands:BRANDS.map(({id,price}) => ({id,price})),
}
export function validRules(value: unknown): value is typeof smokeDefaults {
  if (!value || typeof value !== 'object') return false
  const r = value as typeof smokeDefaults
  const between = (v:number,a:number,b:number) => Number.isFinite(v) && v >= a && v <= b
  return between(r.minSeconds,1,1800) && between(r.maxSeconds,r.minSeconds,1800)
    && Number.isInteger(r.puffSegments) && between(r.puffSegments,1,10)
    && between(r.doubleChance,0,1) && between(r.density,0,4)
    && Array.isArray(r.brands) && r.brands.length > 0 && r.brands.length <= BRANDS.length
    && r.brands.every(b => b && BRANDS.some(def => def.id === b.id) && Number.isInteger(b.price) && between(b.price,5,60))
    && new Set(r.brands.map(b => b.id)).size === r.brands.length
}
