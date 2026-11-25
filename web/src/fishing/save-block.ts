import {basePrice,grades,type Grade} from './grades.ts'
import type {Catch} from './engine'
import {RECENT_ACTION_LIMIT} from './limits'

export function emptyFishing(){return {version:2,xp:0,legendary:0,collected:[] as string[],bag:[] as Catch[],recentActions:[] as string[],
  bait:{bait1:12,bait11:12} as Record<string,number>,owned:['line1','lure1','pole1'],lastSpot:'',streak:0,day:'',income:0}}
export type FishingSave=ReturnType<typeof emptyFishing>
export function readFishing(raw:unknown):FishingSave {
  const base=emptyFishing()
  if(!raw || typeof raw!=='object'|| !('version' in raw)||(raw.version!==1&&raw.version!==2))return base
  const data=raw as Partial<FishingSave>
  const count=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:0
  const strings=(value:unknown)=>Array.isArray(value)?[...new Set(value.filter((entry):entry is string=>typeof entry==='string'))]:[]
  return {...base,xp:count(data.xp),legendary:count(data.legendary),streak:count(data.streak),income:count(data.income),
    recentActions:strings(data.recentActions).slice(-RECENT_ACTION_LIMIT),
    collected:strings(data.collected),owned:[...new Set([...base.owned,...strings(data.owned)])],
    day:typeof data.day==='string'?data.day:'',lastSpot:typeof data.lastSpot==='string'?data.lastSpot:'',
    bait:Object.fromEntries(Object.entries(data.bait??base.bait).map(([key,value])=>[key,count(value)])),
    bag:Array.isArray(data.bag)?data.bag.filter(item=>item&&typeof item.id==='string'&&typeof item.name==='string'&&Number.isSafeInteger(item.price)&&item.price>=0&&(item.grade==='junk'||grades.includes(item.grade as Grade))).map(item=>{
      if(item.grade==='junk')return {...item,price:Math.min(2,item.price)}
      const grade=item.grade as Grade, scale=({'微型':.1,'小型':.7,'中型':3,'大型':16,'巨型':70} as Record<string,number>)[item.size]??1
      const fraction=Math.min(1,Math.max(0,(Number.isFinite(item.weight)?item.weight:0)/scale-.1))
      if(raw.version===2)return {...item,price:Math.min(item.price,basePrice(grade,1))}
      const [low,high]={low:[20,120],medium:[52,200],high:[400,999],legendary:[1200,2000]}[grade]
      const discount=Math.min(1,item.price/Math.round(low+(high-low)*fraction))
      return {...item,price:Math.max(1,Math.round(basePrice(grade,fraction)*discount))}
    }):[]}
}
