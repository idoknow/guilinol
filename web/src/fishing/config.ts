import speciesData from './species.json' with {type:'json'}
import shoreData from './shores.json' with {type:'json'}
import {bait} from './bait.ts'
import {drawGrade, type Grade, probabilities} from './grades.ts'

export type Method = '路亚' | '台钓'
export const species = speciesData.map(row => ({...row, grade:row.grade as Grade}))
export type Species = typeof species[number]
const waterIndices = [
  '01234567','0123468','0124579','0123789','048','015','23456789','02345789','014679',
  '0','012345','04','38','03578','04589','19','27','4','36','0',
  '0','0','123','45678','09','3','59',
]
export const waters = shoreData.map((shore,index) => ({...shore,
  zone:shore.circle.color as keyof typeof probabilities,
  methods:(['lijiang_xiangbi','ronghu','xiaodongjiang'].includes(shore.id)?['路亚','台钓']:['路亚']) as Method[], depth:index < 3 || index === 9 ? [2,8] : [1,4],
  fish:species.filter((_,i)=>waterIndices[i].includes(String(index))).map(row=>row.id),
}))
export type Water = typeof waters[number]
export function nearby(x:number,z:number) {
  return waters.find(({spot,radius})=>Math.hypot(spot.x-x,spot.z-z)<=radius)
}
export const ranks=['钓鱼新手','入门钓手','进阶钓手','资深钓手','钓鱼大师','钓鱼宗师']
export const xpThresholds=Array.from({length:50},(_,i)=>12*i*(i+1))
export function profile(xp:number,collected:number,legendary:number){
  const level=xpThresholds.filter(need=>need<=xp).length
  return {level,rank:level===50 && collected===27 && legendary>=3 ? ranks[5] : ranks[Math.floor(level/10)-1]??'未认证'}
}
export const tabs=['鱼饵','鱼线','配件','鱼竿','其他'] as const
export const tackle=[1,2,3,4].map((tier,index)=>({tier,level:[1,10,30,50][index],
  price:[0,60,260,800][index],force:16+12*tier,snapSeconds:.7+.45*tier}))
export const junk=['碎瓦片','旧鞋','易拉罐','玻璃瓶','废鱼线','锈钥匙','破竹篓','塑料袋']
export const accessories=[{id:'float',name:'浮漂',price:35,level:10,biteBonus:.12},
  {id:'drag',name:'卸力器',price:90,level:20,redBonus:.4}]
export function chooseFish(water:Water,method:Method,baitId:string,line:number,random:()=>number){
  const grade=drawGrade(water.zone,random), targets=bait.find(row=>row.id===baitId)?.targets??[]
  const pool=species.filter(row=>row.grade===grade&&row.methods.includes(method)&&water.fish.includes(row.id))
  const weights=pool.map(row=>(targets.includes(row.id)?2:1)*(['大型','巨型'].includes(row.size)?Math.min(1,line/4):1))
  let cursor=random()*weights.reduce((sum,value)=>sum+value,0)
  return pool.find((_,i)=>(cursor-=weights[i])<0)
}
export const sizes=['微型','小型','中型','大型','巨型']
export function fishForce(row:Species){return 4+5*sizes.indexOf(row.size)+6*['low','medium','high','legendary'].indexOf(row.grade)}

export const dailyIncomeLimit=800
export const castRules={chargeSeconds:1.2,minRange:6,maxRange:30,minWetRange:4,hitSeconds:.7}
export function chargePower(seconds:number){
  const elapsed=seconds-castRules.chargeSeconds
  return elapsed<=0?Math.max(0,seconds/castRules.chargeSeconds):1-.05*(1-Math.abs(elapsed%1*2-1))
}
export type Point={x:number,y:number,z:number}
export function resolveCast(from:Point,angle:number,power:number,waterAt:(x:number,z:number)=>number|null){
  if(!Number.isFinite(power)||power<0||power>1)return null
  for(let distance=castRules.minRange+(castRules.maxRange-castRules.minRange)*power;;distance=Math.max(castRules.minWetRange,distance-.5)){
    const x=from.x+distance*Math.sin(angle),z=from.z+distance*Math.cos(angle),y=waterAt(x,z)
    if(y!==null)return {from,to:{x,y,z},power,distance}
    if(distance===castRules.minWetRange)return null
  }
}
