export const routeVersion='plaza-v2'
export const padElevation=153.97
const preferred={low:360,high:280,dynamic:330}
export type FlightMode=keyof typeof preferred
const maxSpeed=4,maxAcceleration=1.5,margin=2.5
function verticalTime(height:number){
  return height<=maxSpeed**2/maxAcceleration?2*Math.sqrt(height/maxAcceleration):height/maxSpeed+maxSpeed/maxAcceleration
}
export function climbFraction(time:number,duration:number,height:number){
  const minimum=verticalTime(height),ramp=Math.min(maxSpeed/maxAcceleration,minimum/2)
  const elapsed=Math.min(1,Math.max(0,time/duration))*minimum
  const distance=elapsed<ramp?.5*maxAcceleration*elapsed**2:elapsed<=minimum-ramp?maxAcceleration*ramp*(elapsed-ramp/2):height-.5*maxAcceleration*(minimum-elapsed)**2
  return distance/height
}
function service(mode:FlightMode,depart:number,arrive:number){
  const ascend=Math.round(verticalTime(depart-padElevation)+margin),descend=Math.round(verticalTime(arrive-padElevation)+margin)
  const start=3,stop=4,cruise=Math.min(preferred[mode],420-start-ascend-descend-stop)
  return {depart,arrive,start,stop,cruise,ascend,descend,total:start+ascend+cruise+descend+stop}
}
export const services={low:service('low',234,234),high:service('high',439,441),dynamic:service('dynamic',234,234)}
export const cruiseSeconds={low:services.low.cruise,high:services.high.cruise,dynamic:services.dynamic.cruise}
export function queueETA(mode:FlightMode,now:number,start:number,modes:FlightMode[]){
  return Math.ceil(Math.max(0,services[mode].total-(now-start)/1000)+modes.reduce((sum,next)=>sum+services[next].total,0))
}
export function flightClock(now:number,t0:number,mode:FlightMode,version=routeVersion){
  const elapsed=(now-t0)/1000,{start,stop}=services[mode]
  const {ascend,descend,cruise}=version==='plaza-v1'?{ascend:11,descend:11,cruise:preferred[mode]}:services[mode]
  const approach=ascend+cruise,shutdown=approach+descend
  const schedule=[['board',-7,4],['start',-start,start],['ascend',0,ascend],['cruise',ascend,cruise],['descend',approach,descend],['stop',shutdown,stop],['landed',shutdown+stop,60]] as const
  for(const [phase,start,duration] of schedule)if(elapsed<start+duration)return {phase,clock:Math.max(0,elapsed-start),duration}
  return {phase:'ended' as const,clock:0,duration:0}
}
export const fareForTour=(previous:number)=>previous>0?88:0
