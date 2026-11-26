import {flightClock,type FlightMode} from '../../../lib/helicopter-clock'
import {helipad} from './site'
import {tourRoute} from './route'
import profiles from './clearance.json'
const routes=new Map<FlightMode,ReturnType<typeof tourRoute>>()
export function routeFor(mode:FlightMode){
  let route=routes.get(mode)
  if(!route){const profile=profiles[mode];route=tourRoute(helipad,mode,(_east,_north,time)=>profile[Math.floor(time)]+(profile[Math.ceil(time)]-profile[Math.floor(time)])*(time%1));routes.set(mode,route)}return route
}
export function aircraftPose(now:number,t0:number,mode:FlightMode){
  const {phase,clock,duration}=flightClock(now,t0,mode),route=routeFor(mode)
  if(phase==='cruise')return {...route.pose(clock),phase,clock,rpm:1}
  const fraction=Math.min(1,clock/duration),smooth=fraction**3*(10-15*fraction+6*fraction*fraction),ascent=phase==='ascend',descent=phase==='descend',lift=ascent?smooth:descent?1-smooth:0
  const end=route.pose(descent?route.duration:0),bearing=route.pose(descent?route.duration-.1:.1).yaw
  return {x:helipad.x,z:helipad.z,y:helipad.y+(end.y-helipad.y)*lift,yaw:bearing*lift,roll:0,pitch:(ascent?1:descent?-1:0)*.06*Math.sin(Math.PI*fraction)**2,speed:0,phase,clock,rpm:ascent||descent?1:phase==='start'?smooth:phase==='stop'?1-smooth:0}
}
