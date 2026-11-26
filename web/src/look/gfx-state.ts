import {gfxDefaults,validGfx,type GfxConfig} from './gfx-config'

export type Tier='low'|'mid'|'high'
export type Options=Omit<GfxConfig,'presets'>
export type Group='ao'|'bloom'|'shadow'|'godrays'|'dof'
const groups:Group[]=['ao','bloom','shadow','godrays','dof']
const tier=(raw:unknown):raw is Tier=>raw==='low'||raw==='mid'||raw==='high'
export function gfxState(params:URLSearchParams){
  const pinned=params.get('gfx')
  let stored:string|null=null
  try{stored=localStorage.getItem('glol.gfx')}catch{}
  let quality:Tier=tier(pinned)?pinned:tier(stored)?stored:matchMedia('(pointer: coarse)').matches?'low':'mid'
  let config=structuredClone(gfxDefaults), slow=0, notified=false, direct=false
  const listeners=new Set<(q:Tier)=>void>()
  function select(next:Tier){if(!tier(next))return;const changed=quality!==next;quality=next;direct=false;slow=0;try{localStorage.setItem('glol.gfx',next)}catch{};if(changed)for(const fn of listeners)fn(next)}
  function subscribe(fn:(q:Tier)=>void){listeners.add(fn);return()=>{listeners.delete(fn)}}
  function set(patch:GfxConfig['presets']['day']){
    const next={...config,...patch}
    for(const group of groups) if(patch[group]) Object.assign(next,{[group]:{...config[group],...patch[group]}})
    if(quality==='low'&&patch.ao?.enabled!==undefined){next.ao.lowEnabled=patch.ao.enabled;next.ao.enabled=config.ao.enabled}
    if(!validGfx(next))throw Error('Invalid graphics settings')
    config=next
  }
  const ready=fetch('/api/gfx').then(response=>response.ok?response.json():null).then(value=>{if(validGfx(value))config=value}).catch(()=>{})
  return {get quality(){return quality},get direct(){return direct},get config(){return config},ready,set,select,subscribe,
    toggle(group:Group){if(groups.includes(group))set({[group]:{enabled:!(group==='ao'&&quality==='low'?config.ao.lowEnabled:config[group].enabled)}})},
    frame(ms:number){
      if((tier(pinned)&&params.has('verify'))||document.hidden||direct)return
      slow=ms>25?slow+ms:0
      if(slow<3000)return
      if(quality==='low'){direct=true;slow=0}else select(quality==='high'?'mid':'low')
      if(!notified){notified=true;dispatchEvent(new CustomEvent('walk:toast',{detail:{text:quality==='low'&&direct?'画面有点卡，已关闭光影特效':`画面有点卡，光影已降到「${quality==='mid'?'中':'低'}」档 · 点「视野」可调`,ms:4200}}))}
    }}
}
export function sample(config:GfxConfig,hour:number):Options{
  const {presets,...base}=config
  const keys=[[0,'night'],[5,'night'],[6,'dusk'],[8,'day'],[16,'day'],[18.1,'dusk'],[20.4,'night'],[24,'night']] as const
  const time=((hour%24)+24)%24
  const index=keys.findIndex(([end])=>end>time)
  const [start,from]=keys[index-1], [end,to]=keys[index]
  const mix=(time-start)/(end-start)
  function blend(defaults:Record<string,unknown>,first:Record<string,unknown>,second:Record<string,unknown>):Record<string,unknown>{
    return Object.fromEntries(Object.entries(defaults).map(([key,value])=>{
      const left=first[key]??value,right=second[key]??value
      if(typeof value==='object')return [key,blend(value as Record<string,unknown>,left as Record<string,unknown>,right as Record<string,unknown>)]
      return [key,typeof left==='number'&&typeof right==='number'&&key!=='mapSize'&&key!=='updateEvery'?left+(right-left)*mix:mix<.5?left:right]
    }))
  }
  return blend(base,presets[from],presets[to]) as Options
}
