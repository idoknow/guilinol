import {playableBounds} from './projection'

type Pair = [number, number]
export interface Region {
  local: Pair[]
  geographic: Pair[]
  chunks: Pair[]
}
interface Bounds {bbox: [number,number,number,number]; region?: Region}

function project(x:number,z:number,a:Pair,b:Pair) {
  const dx=b[0]-a[0], dz=b[1]-a[1]
  const t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz || 1)))
  return {x:a[0]+t*dx,z:a[1]+t*dz}
}

export function inRegion(bounds:Bounds,x:number,z:number) {
  if(!bounds.region){
    const {min,max}=playableBounds(bounds.bbox)
    return x>=min.x && x<=max.x && z>=min.z && z<=max.z
  }
  const ring=bounds.region.local
  let inside=false
  for(let i=1;i<ring.length;i++){
    const a=ring[i-1], b=ring[i]
    if((a[1]>z)!==(b[1]>z) && x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])inside=!inside
    if(x>=Math.min(a[0],b[0])-1e-6 && x<=Math.max(a[0],b[0])+1e-6 &&
       z>=Math.min(a[1],b[1])-1e-6 && z<=Math.max(a[1],b[1])+1e-6){
      const p=project(x,z,a,b)
      if(Math.hypot(p.x-x,p.z-z)<1e-6)return true
    }
  }
  return inside
}

export function nearestPlayable(bounds:Bounds,x:number,z:number) {
  if(!bounds.region){
    const {min,max}=playableBounds(bounds.bbox)
    return {x:Math.max(min.x,Math.min(max.x,x)),z:Math.max(min.z,Math.min(max.z,z))}
  }
  if(inRegion(bounds,x,z))return {x,z}
  const ring=bounds.region.local
  let best={x:ring[0][0],z:ring[0][1]}, distance=Infinity
  for(let i=1;i<ring.length;i++){
    const point=project(x,z,ring[i-1],ring[i])
    const d=(point.x-x)**2+(point.z-z)**2
    if(d<distance){best=point;distance=d}
  }
  return best
}
