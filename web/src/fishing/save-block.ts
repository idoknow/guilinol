import type {Catch} from './engine'

export function emptyFishing(){return {version:1,xp:0,legendary:0,collected:[] as string[],bag:[] as Catch[],
  bait:{bait1:12,bait11:12} as Record<string,number>,owned:['line1','lure1','pole1'],lastSpot:'',streak:0,day:'',income:0}}
export type FishingSave=ReturnType<typeof emptyFishing>
export function readFishing(raw:unknown):FishingSave {
  const base=emptyFishing()
  if(!raw || typeof raw!=='object'|| !('version' in raw)||raw.version!==1)return base
  const data=raw as Partial<FishingSave>
  const count=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:0
  const strings=(value:unknown)=>Array.isArray(value)?[...new Set(value.filter((entry):entry is string=>typeof entry==='string'))]:[]
  return {...base,xp:count(data.xp),legendary:count(data.legendary),streak:count(data.streak),income:count(data.income),
    collected:strings(data.collected),owned:[...new Set([...base.owned,...strings(data.owned)])],
    day:typeof data.day==='string'?data.day:'',lastSpot:typeof data.lastSpot==='string'?data.lastSpot:'',
    bait:Object.fromEntries(Object.entries(data.bait??base.bait).map(([key,value])=>[key,count(value)])),
    bag:Array.isArray(data.bag)?data.bag.filter(item=>item&&typeof item.id==='string'&&typeof item.name==='string'&&count(item.price)>0).map(item=>({...item})):[]}
}
