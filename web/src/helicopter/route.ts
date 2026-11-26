import {spots} from '../play/spots'
import {flightTable} from './dynamics'
import {cruiseSeconds} from '../../../lib/helicopter-clock'

export const modes = {
  low: {label:'低空观览', description:'贴近景点，看建筑和街景', seconds:cruiseSeconds.low},
  high: {label:'高空观览', description:'高空俯瞰城市与山水', seconds:cruiseSeconds.high},
  dynamic: {label:'动态观览', description:'景点降高慢行，开阔段拔高提速', seconds:cruiseSeconds.dynamic},
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
    return {x:axis('x'), z:axis('z'), fraction,span}
  }
  const step=0.25, heights:number[]=[]
  for(let tick=0;tick<=duration/step;tick++) {
    const {x,z,fraction,span}=horizontal(tick*step)
    const surface=ceiling(x,z,tick*step)
    if(!Number.isFinite(surface)) throw new Error('Missing tour clearance data')
    const open=mode==='dynamic'&&span>30?Math.min(44,(span-24)*2)*blend(1-Math.abs(2*fraction-1)):0
    heights.push(surface+(mode==='high'?260:55)+open)
  }
  const smooth=heights.map((height,index)=>{
    const window=mode==='dynamic'?124:24
    let sum=0,weight=0
    for(let delta=-window;delta<=window;delta++){const w=window+1-Math.abs(delta);sum+=w*heights[Math.max(0,Math.min(heights.length-1,index+delta))];weight+=w}
    const edge=Math.min(index,heights.length-1-index)*step
    const end=index<heights.length/2?heights[0]:heights[heights.length-1]
    return end+(sum/weight-end+(mode==='high'?3:0))*blend(Math.min(1,Math.max(0,(edge-2)/(mode==='dynamic'?42:10))))
  })
  function position(time:number) {
    const bounded=Math.min(duration,Math.max(0,time)), index=Math.min(heights.length-2,Math.floor(bounded/step))
    const {x,z}=horizontal(bounded)
    return {x,z,y:smooth[index]+(smooth[index+1]-smooth[index])*(bounded/step-index)}
  }
  return {stops,times,duration,pose:flightTable(duration,position,ceiling(pad.x,pad.z,0)),target:position}
}

export function canDisembark(phase:string, contact:boolean, idleRotor:boolean, speed:number) {
  return phase==='landed' && contact && idleRotor && speed===0
}
