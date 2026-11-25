const base = {
  exposure: 1, saturation: 1, contrast: 1, toneMapping: 'agx' as 'agx'|'aces',
  ao: {enabled:true, intensity:1, radius:2},
  bloom: {enabled:true, intensity:0.6, threshold:0.85},
  shadow: {enabled:true, strength:0.5, softness:1, mapSize:2048},
  godrays: {enabled:true, intensity:1}, dof: {enabled:false, focusRange:0.1, bokeh:1},
}
type Settings = typeof base
type Override = {[Key in keyof Settings]?: Settings[Key] extends object ? Partial<Settings[Key]> : Settings[Key]}
export type GfxConfig = Settings & {presets: Record<'day'|'dusk'|'night',Override>}
export const gfxDefaults: GfxConfig = {...base, presets:{day:{}, dusk:{}, night:{}}}

const record = (value:unknown):value is Record<string,unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
function matches(value:unknown, template:Record<string,unknown>, partial:boolean):boolean {
  if(!record(value)) return false
  if(!partial && Object.keys(template).some(key=>!Object.hasOwn(value,key))) return false
  return Object.entries(value).every(([key,entry])=>{
    if(!Object.hasOwn(template,key)) return false
    const expected=template[key]
    if(record(expected)) return matches(entry,expected,partial)
    if(typeof expected==='boolean') return typeof entry==='boolean'
    if(key==='toneMapping') return entry==='agx' || entry==='aces'
    if(typeof entry!=='number' || !Number.isFinite(entry) || entry<0) return false
    if(key==='mapSize') return [256,512,1024,2048,4096].includes(entry)
    return entry <= (key==='strength' || key==='focusRange' ? 1 : key==='radius' ? 100 : 16)
  })
}
export function validGfx(value:unknown):value is GfxConfig {
  if(!record(value)) return false
  const {presets,...settings}=value
  return matches(settings,base,false) && record(presets) && Object.keys(presets).length===3 &&
    ['day','dusk','night'].every(key=>Object.hasOwn(presets,key) && matches(presets[key],base,true))
}
