import type {FlightMode} from '../../../lib/helicopter-clock'
export interface QueueState {code:string;now:number;state:string;mine:null|{ticket:string;offered:boolean;mode:FlightMode};ahead:number;eta:number;flight:null|{t0:number;mode:FlightMode;version:string;passengerUid:number;seat:number}}
export async function queueCommand(action:string,fields:Record<string,string>={}):Promise<QueueState>{
  const response=await fetch('/api/helicopter',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...fields}),signal:AbortSignal.timeout(6000)})
  if(!response.ok)throw Error(response.status===401?'请先登录后排队':'排队服务暂不可用')
  return response.json()
}
