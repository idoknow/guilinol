const base = {
  exposure: 1, saturation: 1, contrast: 1, toneMapping: 'neutral' as 'neutral'|'agx'|'aces',
  ao: {enabled:true, lowEnabled:false, intensity:1.5, radius:2.5},
  bloom: {enabled:true, intensity:0.5, threshold:0.9},
  shadow: {enabled:true, strength:0.6, softness:1.5, mapSize:2048, updateEvery:3, distance:150, moveThreshold:3},
  godrays: {enabled:true, intensity:1.2}, dof: {enabled:false, focusRange:0.1, bokeh:1},
}
type Settings = typeof base
type Override = {[Key in keyof Settings]?: Settings[Key] extends object ? Partial<Settings[Key]> : Settings[Key]}
export type GfxConfig = Settings & {presets: Record<'day'|'dusk'|'night',Override>}
// IDOK-291 look pass: phase-2 street style already grades in-material, so the global grade stays neutral.
// Day: harder shadows, bloom only on glare. Dusk: softer long shadows, stronger rays. Night: lamps/neon glow, lighter AO.
export const gfxDefaults: GfxConfig = {...base, presets:{
  day: {bloom:{intensity:0.25, threshold:0.95}, shadow:{strength:0.8}},
  dusk: {bloom:{intensity:0.6, threshold:0.8}, godrays:{intensity:1.8}, shadow:{strength:0.5}},
  night: {bloom:{intensity:0.9, threshold:0.7}, ao:{intensity:0.9}},
}}

const record = (value:unknown):value is Record<string,unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
function matches(value:unknown, template:Record<string,unknown>, partial:boolean):boolean {
  if(!record(value)) return false
  if(!partial && Object.keys(template).some(key=>!Object.hasOwn(value,key))) return false
  return Object.entries(value).every(([key,entry])=>{
    if(!Object.hasOwn(template,key)) return false
    const expected=template[key]
    if(record(expected)) return matches(entry,expected,partial)
    if(typeof expected==='boolean') return typeof entry==='boolean'
    if(key==='toneMapping') return entry==='neutral' || entry==='agx' || entry==='aces'
    if(typeof entry!=='number' || !Number.isFinite(entry) || entry<0) return false
    if(key==='mapSize') return [256,512,1024,2048,4096].includes(entry)
    if(key==='updateEvery')return Number.isInteger(entry)&&entry>=1&&entry<=4
    if(key==='distance')return entry>=10&&entry<=300
    return entry <= (key==='strength' || key==='focusRange' ? 1 : key==='radius' ? 100 : 16)
  })
}
export function validGfx(value:unknown):value is GfxConfig {
  if(!record(value)) return false
  const {presets,...settings}=value
  return matches(settings,base,false) && record(presets) && Object.keys(presets).length===3 &&
    ['day','dusk','night'].every(key=>Object.hasOwn(presets,key) && matches(presets[key],base,true))
}
