import {getActiveSaveSnapshot} from '../game/save'
import {fishingTransaction} from '../game/commerce'
import {accessories, profile, species, tackle, waters} from './config'
import {bait} from './bait'
import type {Catch} from './engine'

export const inventory=()=>getActiveSaveSnapshot().fishing
export const certification=()=>{const save=inventory();return profile(save.xp,save.collected.length,save.legendary)}
export const catalog=[...bait.map((item,index)=>({...item,tab:'鱼饵',price:3+index%10,level:index===10?1:1+Math.floor(index%10/3)*10})),
  ...tackle.flatMap(row=>['line','lure','pole'].map((prefix,index)=>({...row,id:prefix+row.tier,tab:index?'鱼竿':'鱼线',name:['鱼线','路亚竿','台钓竿'][index]+row.tier}))),
  ...accessories.map(row=>({...row,tab:'配件'}))]
export function shop(tab:string){return catalog.filter(row=>row.tab===tab).map(row=>({...row,locked:certification().level<row.level,unlock:`钓鱼等级 ${row.level}`}))}
export function buy(id:string,key=crypto.randomUUID()){
  return fishingTransaction(key,id,save=>{const item=catalog.find(row=>row.id===id)
    if(!item)return 'INVALID_ITEM';if(profile(save.xp,save.collected.length,save.legendary).level<item.level)return 'locked'
    if(item.tab==='鱼饵')save.bait[id]=(save.bait[id]??0)+1
    else if(save.owned.includes(id))return 'ALREADY_OWNED';else save.owned.push(id)
    return -item.price})
}
export function consume(id:string){return fishingTransaction(crypto.randomUUID(),'cast',save=>{
  if(!(save.bait[id]>0))return 'NO_BAIT';save.bait[id]--;return 0}).ok}
export function collect(item:Catch){return fishingTransaction(item.id,'catch',save=>{
  if(item.speciesId){save.streak=save.lastSpot===item.water?save.streak+1:1;save.lastSpot=item.water
    if(!save.collected.includes(item.speciesId))save.collected.push(item.speciesId)
    if(item.grade==='legendary')save.legendary++;save.xp+=({low:18,medium:32,high:75,legendary:160}[item.grade]??0)}
  save.bag.push({...item,price:item.speciesId?Math.max(1,Math.round(item.price*Math.max(.4,1-.12*(save.streak-1)))):item.price});return 0}).ok}
export function removeCatch(ids:string[],sell:boolean,key=crypto.randomUUID()){
  return fishingTransaction(key,sell?'sale':'discard',save=>{
    const selected=new Set(ids),items=save.bag.filter(item=>selected.has(item.id));if(!items.length||items.length!==selected.size)return 'INVALID_ITEM'
    let delta=0
    if(sell){const day=new Date(Date.now()+8*3600000).toISOString().slice(0,10);if(day!==save.day){save.day=day;save.income=0}
      delta=items.reduce((sum,item)=>sum+item.price,0);if(delta+save.income>5000)return '今日渔获收入已达上限';save.income+=delta}
    save.bag=save.bag.filter(item=>!selected.has(item.id));return delta})
}
export function journal(filters:{rarity?:string,size?:string,water?:string,method?:string}={}){
  const collected=inventory().collected,water=waters.find(row=>row.id===filters.water)
  return {collected:collected.length,total:species.length,rows:species.filter(row=>(!filters.rarity||row.rarity===filters.rarity)&&(!filters.size||row.size===filters.size)&&(!filters.water||water?.fish.includes(row.id))&&(!filters.method||row.methods.includes(filters.method))).map(row=>({...row,collected:collected.includes(row.id)}))}
}
