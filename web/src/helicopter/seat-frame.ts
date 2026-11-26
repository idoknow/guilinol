import {Object3D, Quaternion, Vector3} from 'three'
import {avatar} from '../look/avatar'

const seatToWalker=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),Math.PI+avatar.yaw)

export function passengerOrientation(seat:Object3D,out:Quaternion){
  return seat.getWorldQuaternion(out).multiply(seatToWalker)
}
