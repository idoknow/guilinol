import type {PerspectiveCamera} from 'three'

type Point = [number,number,number]
type Preset = [Point,Point] & {walk?:{x:number,z:number,yaw:number}}
export const presets:Record<string,Preset> = {
  lijiang:[[85,173,-340],[-110,180,-810]],
  palace:[[-490,171,-485],[-513,194,-679]],
  elephant:[[-740,171,868],[-855,179,1098]],
  overview:[[-500,1100,2600],[-500,180,-300]],
  south:[[-300,181,3090],[-287,202,2780]],
  foot:[[-450.81,158.3,-729.05],[-499,166,-687]],
}
export function setPreset(camera:PerspectiveCamera,name:string|null) {
  if(name && Object.hasOwn(presets,name)) {
    const [eye,target]=presets[name]
    camera.position.set(...eye); camera.lookAt(...target)
  }
}

// IDOK-105 opening frames. A plain visit draws one of these at random instead of the same fixed
// camera every load: each one sits on the outer ring of the data box, well outside the hand-built
// landmarks, and looks back across the city so the frame is mostly unbuilt ground and karst skyline.
// eye/look are world metres (x east, z south, y absolute elevation), same convention as `presets`.
// Constraints each slot was picked under: >=60 m from every landmark sphere, near-field tile
// development below the city median (47.35), and a clear frame centre. `scripts/spawn-pool.mjs`
// re-shoots all of them; deep links (`?cam=`/`?spawn=`/`?slot=`/...) keep the old fixed behaviour.
export interface SpawnSlot {id:string; eye:Point; look:Point}
export const spawnPool:SpawnSlot[] = [
  {id:'N',  eye:[-620,  521.8,-1780], look:[-300, 160,-1300]},
  {id:'NE', eye:[196,   381.7,-1820], look:[-880, 160,-170]},
  {id:'E',  eye:[1000,  400,   300],  look:[-100, 170,-300]},
  {id:'SE', eye:[700,   397.2, 1420], look:[400,  160, 900]},
  {id:'S',  eye:[-560,  384.2, 1560], look:[-700, 160, 1150]},
  {id:'SW', eye:[-2140, 420,   1840], look:[-1500,190, 700]},
  {id:'W',  eye:[-2015, 382.8, 275],  look:[-1450,160, 220]},
  {id:'NW', eye:[-2050, 400.2,-900],  look:[-1650,160,-500]},
]
// Remembered so two loads in a row never show the same frame; the slot itself is re-drawn each time.
const LAST_SLOT = 'glol.spawn'
export function pickSpawn(store:Pick<Storage,'getItem'|'setItem'>=localStorage):SpawnSlot {
  let last:string|null = null
  try{ last = store.getItem(LAST_SLOT) }catch{ /* private mode: fall back to a plain draw */ }
  const pool = spawnPool.length > 1 ? spawnPool.filter(slot=>slot.id!==last) : spawnPool
  const slot = pool[Math.floor(Math.random()*pool.length)]
  try{ store.setItem(LAST_SLOT,slot.id) }catch{ /* not persisted; still a valid frame */ }
  return slot
}
