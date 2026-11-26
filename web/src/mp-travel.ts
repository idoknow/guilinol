import sites from '../../rt/travel-sites.json'
type Handler=(reason:string,x:number,z:number)=>Promise<boolean>
let handler:Handler|undefined
export function bindTravel(value?:Handler){handler=value}
export function allowLanding(reason:string,x:number,z:number){return handler?handler(reason,x,z):Promise.resolve(true)}
export function travelTarget(reason:string,x:number,z:number){
  const group=reason.split(':')[0]
  return Object.entries(sites).find(([id,[tx,tz]])=>(reason===id||group==='map'||group==='flight'||group===id.split(':')[0])&&Math.hypot(tx-x,tz-z)<3)?.[0]
}
