import R from '@dimforge/rapier3d-compat'
import {walkConfig} from './config'

export function trafficPushGuard(world:R.World,capsule:R.Collider,isObstacle:(collider:R.Collider)=>boolean,insideHouse:(x:number,z:number,y:number)=>boolean){
  const car=new R.Cuboid(.86,.48,2.12),bike=new R.Cuboid(.32,.42,.85)
  const identity={x:0,y:0,z:0,w:1}
  return (point:R.Vector,dx:number,dz:number,yaw:number,length:number)=>{
    const foot=point.y-walkConfig.height/2
    if(insideHouse(point.x+dx,point.z+dz,foot+.5))return false
    const hull=length>1?car:bike
    const origin=length?{x:point.x,y:foot+(hull===car?.82:.58),z:point.z}:point
    const rotation=length?{x:0,y:Math.sin(yaw/2),z:0,w:Math.cos(yaw/2)}:identity
    return !world.castShape(origin,rotation,{x:dx,y:0,z:dz},length?hull:capsule.shape,0,1,false,undefined,undefined,capsule,undefined,isObstacle)
  }
}
