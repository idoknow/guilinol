import sites from '../../rt/travel-sites.json'
export type TravelReply={ok:boolean;code?:string;leave?:boolean;rejoinAfterMs?:number}
export type LandingPermission=boolean|(()=>void)
type Handler=(reason:string,x:number,z:number)=>Promise<LandingPermission>
let handler:Handler|undefined
export function bindTravel(value?:Handler){handler=value}
export function allowLanding(reason:string,x:number,z:number){return handler?handler(reason,x,z):Promise.resolve(true)}
export async function enterLanding(reason:string,x:number,z:number,enter:()=>Promise<boolean>){
  const permission=await allowLanding(reason,x,z)
  if(!permission)return false
  try{return await enter()}finally{if(typeof permission==='function')permission()}
}
export function travelTarget(reason:string,x:number,z:number){
  const group=reason.split(':')[0]
  return Object.entries(sites).find(([id,[tx,tz]])=>(reason===id||group==='map'||group==='flight'||group===id.split(':')[0])&&Math.hypot(tx-x,tz-z)<3)?.[0]
}
export function rejectTravel(code?:string){
  const messages:Record<string,string>={combat:'战斗中无法传送',cooldown:'传送冷却中，请稍后',site:'此位置不支持联机传送',reason:'此位置不支持联机传送',timeout:'传送请求超时，请重试',busy:'传送请求处理中，请稍后'}
  window.dispatchEvent(new CustomEvent('walk:toast',{detail:messages[code??'']??'联机传送未完成，请重试'}))
  return false as const
}
export async function prepareTravel(reason:string,x:number,z:number,request:(target:string|null)=>Promise<TravelReply>,leave:(delay:number)=>()=>void){
  const target=travelTarget(reason,x,z)??null,reply=await request(target)
  if(!reply.ok)return rejectTravel(reply.code)
  if(target)return true
  if(!reply.leave||typeof reply.rejoinAfterMs!=='number')return rejectTravel()
  return leave(reply.rejoinAfterMs)
}
