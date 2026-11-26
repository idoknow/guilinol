import {spots} from '../play/spots'

export const modes = {
  low: {label:'低空观览', description:'贴近景点，看建筑和街景', seconds:360},
  high: {label:'高空观览', description:'高空俯瞰城市与山水', seconds:280},
  dynamic: {label:'动态观览', description:'景点降高慢行，开阔段拔高提速', seconds:330},
}
export type TourMode = keyof typeof modes
interface Point {x:number; z:number}
const limit = (value:number, max:number) => Math.min(max, Math.max(-max, value))
const blend = (fraction:number) => fraction ** 3 * (10 + fraction * (-15 + 6 * fraction))

export function tourRoute(pad:Point, mode:TourMode, ceiling:(x:number,z:number,seconds:number)=>number) {
  const stops = [pad, ...spots, pad]
  const lengths = stops.slice(1).map((stop,index)=>Math.hypot(stop.x-stops[index].x, stop.z-stops[index].z))
  const total = lengths.reduce((sum,length)=>sum + length, 0)
  const duration = modes[mode].seconds
  const times = [0]
  for (const length of lengths) times.push(times[times.length-1] + duration * length / total)
  const tangent = (index:number, axis:'x'|'z') => index===0 || index===stops.length-1 ? 0 :
    (stops[index+1][axis]-stops[index-1][axis])/(times[index+1]-times[index-1]) * (mode==='dynamic'?0.28:0.72)
  function horizontal(time:number) {
    let leg=0
    while(leg<lengths.length-1 && times[leg+1]<time) leg++
    const span=times[leg+1]-times[leg], fraction=Math.max(0,Math.min(1,(time-times[leg])/span))
    const from=stops[leg], to=stops[leg+1], reverse=1-fraction
    const slope=(u:number)=>u*(1-u)**3*(1+3*u)
    const axis=(key:'x'|'z')=>from[key]+(to[key]-from[key])*blend(fraction)+span*(tangent(leg,key)*slope(fraction)-tangent(leg+1,key)*slope(reverse))
    return {x:axis('x'), z:axis('z'), fraction}
  }
  const step=0.25, heights:number[]=[]
  for(let tick=0;tick<=duration/step;tick++) {
    const {x,z,fraction}=horizontal(tick*step)
    const surface=ceiling(x,z,tick*step)
    if(!Number.isFinite(surface)) throw new Error('Missing tour clearance data')
    heights.push(surface+(mode==='high'?260:mode==='low'?55:55+135*Math.sin(Math.PI*fraction)**4))
  }
  function position(time:number) {
    const bounded=Math.min(duration,Math.max(0,time)), index=Math.min(heights.length-2,Math.floor(bounded/step))
    const {x,z}=horizontal(bounded)
    return {x,z,y:heights[index]+(heights[index+1]-heights[index])*blend(bounded/step-index)}
  }
  function pose(time:number) {
    const delta=0.1, before=position(time-delta), center=position(time), after=position(time+delta)
    const vx=(after.x-before.x)/(2*delta), vz=(after.z-before.z)/(2*delta), speed=Math.hypot(vx,vz)
    const ax=(after.x+before.x-2*center.x)/delta**2, az=(after.z+before.z-2*center.z)/delta**2
    return {...center, speed, yaw:Math.atan2(vx,vz), roll:limit(Math.atan2(vz*ax-vx*az,Math.max(0.01,speed)*9.81),25*Math.PI/180),
      pitch:limit(Math.atan2(after.y-before.y,Math.max(1,speed)*2*delta)-Math.atan((vx*ax+vz*az)/(9.81*Math.max(1,speed))),Math.PI/18)}
  }
  return {stops, times, duration, pose}
}

export function canDisembark(phase:string, contact:boolean, idleRotor:boolean, speed:number) {
  return phase==='landed' && contact && idleRotor && speed===0
}
