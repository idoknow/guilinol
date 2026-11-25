import * as THREE from 'three'
import type {Stream} from './stream'

export type Wall = [ax:number, az:number, bx:number, bz:number, low:number, high:number]

// A box is hidden only when it lies entirely beyond the wall and between
// all four planes through its edges. Use the most restrictive plane for
// each edge over the whole camera cell so walking does not expose a gap.
export function wallShadows(stream:Stream, eye:THREE.Vector3, margin:number, nearRadius:number){
  const origins:THREE.Vector3[]=[]
  for(const dx of [-margin,margin])for(const dy of [-margin,margin])for(const dz of [-margin,margin]){
    origins.push(eye.clone().add(new THREE.Vector3(dx,dy,dz)))
  }
  const walls:{wall:Wall, x:number, z:number, score:number}[]=[]
  for(const [tile,item] of stream.loaded){
    if(eye.x<tile.x-64||eye.x>tile.x+320||eye.z<tile.z-64||eye.z>tile.z+320)continue
    for(const wall of (item.batch.walls?.userData.occluders??[]) as Wall[]){
      const [ax,az,bx,bz,lo,hi]=wall
      const mx=tile.x+(ax+bx)/2,mz=tile.z+(az+bz)/2
      const distanceSq=(eye.x-mx)**2+(eye.z-mz)**2+(eye.y-(lo+hi)/2)**2
      if(distanceSq>64**2)continue
      walls.push({wall,x:tile.x,z:tile.z,score:(hi-lo)*Math.hypot(bx-ax,bz-az)/(1+distanceSq)})
    }
  }
  const volumes:THREE.Plane[][]=[]
  const plane=new THREE.Plane()
  // Bound the classification cost and prefer nearby, large faces.
  for(const {wall,x,z} of walls.sort((a,b)=>b.score-a.score).slice(0,24)){
    const [ax,az,bx,bz,lo,hi]=wall
    const points=[[ax,lo,az],[bx,lo,bz],[bx,hi,bz],[ax,hi,az]].map(([px,y,pz])=>new THREE.Vector3(x+px,y,z+pz))
    const face=new THREE.Plane().setFromCoplanarPoints(points[0],points[1],points[2])
    if(face.distanceToPoint(eye)>0)face.negate()
    if(origins.some(o=>face.distanceToPoint(o)>-nearRadius))continue
    const planes=[face]
    for(let i=0;i<4;i++){
      const a=points[i],b=points[(i+1)%4],inside=points[(i+2)%4]
      for(const o of origins){
        plane.setFromCoplanarPoints(a,b,o)
        if(plane.distanceToPoint(inside)<0)plane.negate()
        if(origins.every(p=>plane.distanceToPoint(p)>=-1e-8)){planes.push(plane.clone());break}
      }
    }
    if(planes.length===5)volumes.push(planes)
  }
  // Landmark cluster bounds are immutable. A camera rotation changes the
  // frustum but can reuse these wall tests until the next shadow rebuild.
  const cache=new WeakMap<THREE.Box3,boolean>()
  return (box:THREE.Box3)=>{
    const prior=cache.get(box)
    if(prior!==undefined)return prior
    const hidden=volumes.some(planes=>planes.every(({normal:n,constant:d})=>
    n.x*(n.x>0?box.min.x:box.max.x)+n.y*(n.y>0?box.min.y:box.max.y)+n.z*(n.z>0?box.min.z:box.max.z)+d>.02))
    cache.set(box,hidden)
    return hidden
  }
}
