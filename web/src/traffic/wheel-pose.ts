import type {Object3D} from 'three'

type Wheel={x:number,y:number,z:number}
type Ground=(x:number,z:number,reference:number,car:boolean)=>number|undefined

export function alignWheels(pose:Object3D,wheels:readonly Wheel[],ground:Ground,car:boolean){
  if(!wheels.length)return
  const scale=pose.scale.x, yaw=pose.rotation.y, cosine=Math.cos(yaw), sine=Math.sin(yaw)
  const {x,y,z}=pose.position
  let sumX=0,sumZ=0,sumY=0,sumXX=0,sumZZ=0,sumXY=0,sumZY=0
  for(const wheel of wheels){
    const lateral=wheel.x*scale,forward=wheel.z*scale
    const support=ground(x+cosine*lateral+sine*forward,z-sine*lateral+cosine*forward,y,car)
    if(support===undefined)return
    const height=support-y-wheel.y*scale
    sumX+=lateral;sumZ+=forward;sumY+=height;sumXX+=lateral*lateral;sumZZ+=forward*forward
    sumXY+=lateral*height;sumZY+=forward*height
  }
  const count=wheels.length,widthVariance=sumXX-sumX*sumX/count,lengthVariance=sumZZ-sumZ*sumZ/count
  const lateral=widthVariance>1e-8?(sumXY-sumX*sumY/count)/widthVariance:0
  const longitudinal=lengthVariance>1e-8?(sumZY-sumZ*sumY/count)/lengthVariance:0
  pose.rotation.set(-Math.atan(longitudinal),yaw,Math.atan(lateral/Math.hypot(1,longitudinal)),'YXZ')
  pose.position.y+=(sumY-sumX*lateral-sumZ*longitudinal)/count
}
