export const routeVersion='plaza-v1'
export const cruiseSeconds={low:360,high:280,dynamic:330} as const
export type FlightMode=keyof typeof cruiseSeconds
export function flightClock(now:number,t0:number,mode:FlightMode){
  const elapsed=(now-t0)/1000,cruise=cruiseSeconds[mode]
  const schedule=[['board',-7,4],['start',-3,3],['ascend',0,11],['cruise',11,cruise],['descend',11+cruise,11],['stop',22+cruise,4],['landed',26+cruise,60]] as const
  for(const [phase,start,duration] of schedule)if(elapsed<start+duration)return {phase,clock:Math.max(0,elapsed-start),duration}
  return {phase:'ended' as const,clock:0,duration:0}
}
export const fareForTour=(previous:number)=>previous>0?88:0
