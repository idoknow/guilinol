import vehicles from '../drive/vehicles.json'
import camera from '../drive/camera.json'

export const walkConfig = {
  height:1.7, radius:.29, walk:4, run:9, jump:1.2, gravity:-20, fallGravity:-28,
  accel:50, decel:135, grip:220, airAccel:18, pivotBoost:2.2, turnRate:20, coyote:.1, jumpBuffer:.12,
  slope:52*Math.PI/180, step:.62, stepWidth:.08, snap:.65, skin:.025, collisionRadius:384, peakRadius:600, search:64,
  // Camera (M2 look): figure stays small, scenery fills the frame (docs/style.md 原则 6).
  near:4.5, far:11, zoomMin:2.5, zoomMax:22, sensitivity:.003, touchSensitivity:.0046,
  pitch:.3, camRadius:.22, camRecover:9,
  gate:{x:-588,z:-212,yaw:Math.PI},
}

function dynamics<T extends typeof vehicles.ebike | typeof vehicles.sedan>(config:T){
  return {...config,maxSpeed:config.maxKmh/3.6,reverseMax:-config.reverseKmh/3.6,maxSteerAngle:config.steerRad}
}
export const bikeConfig=dynamics(vehicles.ebike)
export const bicycleConfig=dynamics(vehicles.bike)
export const carConfig={...dynamics(vehicles.sedan),cameraArmOffset:camera.distance-walkConfig.near}
export const taxiConfig={...dynamics(vehicles.taxi),cameraArmOffset:carConfig.cameraArmOffset}
