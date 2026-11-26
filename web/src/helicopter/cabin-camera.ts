import {MathUtils,Object3D,PerspectiveCamera,Quaternion} from 'three'

export function cabinCamera(camera:PerspectiveCamera,seat:Object3D,number:number,yaw:number,pitch:number,airframe:Quaternion){
  const rear=number!==1,side=number===3?-1:1
  camera.position.set(rear?-.18*side:0,rear?.87:.72,rear?.13:.06)
  seat.localToWorld(camera.position)
  const headYaw=MathUtils.clamp(Math.atan2(Math.sin(yaw),Math.cos(yaw)),-1.37,1.37)
  camera.rotation.set(MathUtils.clamp(-pitch,-.85,.73),Math.PI+headYaw-(rear?.29*side:0),0,'YXZ')
  camera.quaternion.premultiply(airframe)
}
