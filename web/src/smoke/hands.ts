import * as T from 'three'
import {streetShading} from '../walk/creator-ink'
import {Parts} from './models'

// Coordinates in millimetres relative to the box, lighter, or pinch contact.
// Each row locates the knuckle, hinge and fingertip. The wrist and palm share
// the same frame as the fingers, including while the prop rotates.
type Point = [number,number,number]
type Digit = [Point,Point,Point]
interface Pose {
  palm:Point
  wrist:Point
  palmSize:Point
  digits:Digit[]
}

const box:Pose = {
  palm:[-5,-4,-26], wrist:[-38,-40,-23], palmSize:[34,30,14],
  digits:[
    [[-28,6,-20],[-37,12,9],[-20,16,17]],
    ...[16,4,-8,-19].map((y,i):Digit=>[[14,y,-24],[34,y+2,-17],[34,y+3,9-i*2]]),
  ],
}
const lighter:Pose = {
  palm:[-8,-9,20], wrist:[-44,-43,24], palmSize:[29,27,14],
  digits:[
    [[-23,3,16],[-19,30,6],[-2,31,1]],
    ...[12,1,-10,-20].map((y,i):Digit=>[[9,y,21],[19,y,10],[18,y+1,-6+i]]),
  ],
}
const pinch:Pose = {
  palm:[59,27,2], wrist:[105,19,24], palmSize:[33,23,16],
  digits:[
    [[40,13,15],[23,-3,12],[7,0,2]],
    [[40,38,-5],[10,31,-4],[-6,3,-1]],
    [[43,32,-14],[25,17,-20],[41,11,-13]],
    [[52,26,-17],[35,11,-21],[49,8,-12]],
    [[60,21,-16],[46,9,-18],[58,6,-10]],
  ],
}
const up=new T.Vector3(0,1,0)
export function articulatedHand(skin:string,side:'left'|'right',parts:Parts){
  const root=new T.Group()
  root.name='smoke-hand-'+side
  const material=parts.mat(new T.MeshStandardMaterial({color:skin,roughness:.91}))
  streetShading(material)
  const ball=parts.geo(new T.SphereGeometry(1,16,12))
  const shaft=parts.geo(new T.CylinderGeometry(.87,1,1,12))
  const a=new T.Vector3(), b=new T.Vector3(), c=new T.Vector3(), direction=new T.Vector3()
  const mesh=(geometry:T.BufferGeometry)=>{
    const m=new T.Mesh(geometry,material)
    root.add(m)
    m.layers.set(2)
    return m
  }
  const palm=mesh(ball), wrist=mesh(ball), forearm=mesh(shaft)
  const fingers=pinch.digits.map(()=>({base:mesh(ball),proximal:mesh(shaft),hinge:mesh(ball),distal:mesh(shaft),pad:mesh(ball)}))
  function link(m:T.Mesh,from:T.Vector3,to:T.Vector3,radius:number){
    direction.subVectors(to,from)
    m.scale.set(radius,direction.length(),radius)
    m.position.addVectors(from,to).multiplyScalar(.5)
    m.quaternion.setFromUnitVectors(up,direction.normalize())
  }
  let lastGrip=-1,lastOpening=-1
  function pose(grip:number,opening=0){
    if(grip===lastGrip && opening===lastOpening)return
    lastGrip=grip;lastOpening=opening
    const p=side==='left'?box:pinch, q=side==='left'?lighter:pinch
    function mix(out:T.Vector3,from:Point,to:Point){
      out.set(T.MathUtils.lerp(from[0],to[0],grip),T.MathUtils.lerp(from[1],to[1],grip),T.MathUtils.lerp(from[2],to[2],grip)).multiplyScalar(.001)
    }
    mix(palm.position,p.palm,q.palm)
    mix(palm.scale,p.palmSize,q.palmSize)
    mix(a,p.wrist,q.wrist)
    wrist.position.lerpVectors(a,palm.position,.46)
    wrist.scale.set(.024,wrist.position.distanceTo(a)+.019,.014)
    wrist.quaternion.setFromUnitVectors(up,direction.subVectors(palm.position,a).normalize())
    b.copy(a);b.x+=side==='left'?-.14:.14;b.y-=.16;b.z+=.09
    link(forearm,b,a,.023)
    for(const [i,f] of fingers.entries()){
      mix(a,p.digits[i][0],q.digits[i][0])
      mix(b,p.digits[i][1],q.digits[i][1])
      mix(c,p.digits[i][2],q.digits[i][2])
      if(side==='right' && i<2)c.y+=(i===0?-1:1)*opening*.009
      const radius=[.007,.0059,.0061,.0057,.0049][i]
      f.base.position.copy(a);f.base.scale.setScalar(radius)
      link(f.proximal,a,b,radius)
      f.hinge.position.copy(b);f.hinge.scale.setScalar(radius*.9)
      link(f.distal,b,c,radius*.9)
      f.pad.position.copy(c);f.pad.scale.setScalar(radius*.79)
    }
  }
  pose(0)
  return {root,pose}
}
