import {services,climbFraction,flightClock,routeVersion,type FlightMode} from '../../../lib/helicopter-clock'
import {helipad} from './site'
import {tourRoute} from './route'
import profiles from './clearance.json'
const routes=new Map<FlightMode,ReturnType<typeof tourRoute>>()
export function routeFor(mode:FlightMode){
  let route=routes.get(mode)
  if(!route){const profile=profiles[mode];route=tourRoute(helipad,mode,(_east,_north,seconds)=>{const time=seconds/ services[mode].cruise*(profile.length-1);if(seconds===services[mode].cruise)return services[mode].arrive-(mode==='high'?260:55);return profile[Math.floor(time)]+(profile[Math.ceil(time)]-profile[Math.floor(time)])*(time%1)});routes.set(mode,route)}return route
}
export function aircraftPose(now:number,t0:number,mode:FlightMode){
  const {phase,clock,duration}=flightClock(now,t0,mode),route=routeFor(mode)
  if(phase==='cruise')return {...route.pose(clock),phase,clock,duration,rpm:1}
  const fraction=Math.min(1,clock/(duration||1)),smooth=fraction**3*(10-15*fraction+6*fraction*fraction),ascent=phase==='ascend',descent=phase==='descend',vertical=ascent||descent?climbFraction(clock,duration,route.pose(descent?route.duration:0).y-helipad.y):0,lift=ascent?vertical:descent?1-vertical:0
  const end=route.pose(descent?route.duration:0),bearing=route.pose(descent?route.duration-.1:.1).yaw
  return {x:helipad.x,z:helipad.z,y:helipad.y+(end.y-helipad.y)*lift,yaw:bearing*lift,roll:0,pitch:(ascent?1:descent?-1:0)*.06*Math.sin(Math.PI*fraction)**2,speed:0,phase,clock,duration,rpm:ascent||descent?1:phase==='start'?smooth:phase==='stop'?1-smooth:0}
}

export function flightReplica(){
  const bounds:{low:number;high:number}[]=[]
  let offset=0
  return {
    sync(sent:number,received:number,server:number){
      if(received<sent)return
      const sample={low:server-received,high:server-sent}
      bounds.push(sample);if(bounds.length>8)bounds.shift()
      let low=Math.max(...bounds.map(value=>value.low)),high=Math.min(...bounds.map(value=>value.high))
      if(low>high){bounds.splice(0,bounds.length-1);({low,high}=sample)}
      offset=(low+high)/2
    },
    pose(local:number,flight:{t0:number;mode:FlightMode;version:string}|null|undefined){
      return flight?.version===routeVersion?aircraftPose(local+offset,flight.t0,flight.mode):null
    },
  }
}
