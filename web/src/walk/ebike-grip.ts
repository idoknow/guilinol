import {Matrix4, Object3D, Quaternion, Vector3} from 'three'
import {steeringZ} from './ebike-mounts'

const shoulder = new Vector3(), elbow = new Vector3(), palm = new Vector3()
const target = new Vector3(), axis = new Vector3(), bend = new Vector3(), elbowTarget = new Vector3()
const from = new Vector3(), to = new Vector3(), delta = new Quaternion(), parentRotation = new Quaternion()
const collar = new Vector3(), reach = new Vector3()
const wristRotation = new Quaternion()

export function fingerPose(figure: Object3D, side: string, sign: number) {
  const joints = []
  for (const digit of ['index','middle','ring','pinky','thumb']) {
    const directions = digit === 'thumb'
      ? [[.84,.31,.44],[.16,.68,-.72],[-.40,.32,-.86]]
      : [[.88,.48,0],[.57,-.82,0],[-.30,-.95,0]]
    const parentInHand = new Quaternion()
    for (let index=0; index<directions.length; index++) {
      const joint = figure.getObjectByName(`${digit}_0${index+1}_${side}`)
      if (!joint) break
      const [down,forward,inward] = directions[index]
      const orientation = parentInHand.clone().multiply(joint.quaternion)
      const direction = new Vector3(0,1,0).applyQuaternion(orientation)
      const goal = new Vector3(-sign*down,forward,inward).normalize()
      orientation.premultiply(new Quaternion().setFromUnitVectors(direction,goal))
      joints.push({joint, rotation:parentInHand.clone().invert().multiply(orientation)})
      parentInHand.copy(orientation)
    }
  }
  return joints
}

function aim(bone: Object3D, origin: Vector3, end: Vector3, goal: Vector3) {
  parentRotation.copy(bone.parent!.getWorldQuaternion(delta)).invert()
  from.subVectors(end, origin).applyQuaternion(parentRotation).normalize()
  to.subVectors(goal, origin).applyQuaternion(parentRotation).normalize()
  bone.quaternion.premultiply(delta.setFromUnitVectors(from, to))
}

export function createEbikeGripPose(figure: Object3D) {
  const arms = ['l','r'].map((side,index) => ({
    sign: index ? 1 : -1,
    fingers: fingerPose(figure,side,index ? 1 : -1),
    overhand: new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(
      new Vector3(0,index ? 1 : -1,0),new Vector3(0,0,-1),new Vector3(index ? -1 : 1,0,0))),
    upper: figure.getObjectByName(`upperarm_${side}`), lower: figure.getObjectByName(`lowerarm_${side}`),
    hand: figure.getObjectByName(`hand_${side}`),
  }))
  return (steering: Object3D, blend: number) => {
    for (const {sign,upper,lower,hand,fingers,overhand} of arms) {
      if (!upper || !lower || !hand || blend <= 0) continue
      upper.getWorldPosition(shoulder); lower.getWorldPosition(elbow)
      hand.getWorldPosition(palm)
      steering.localToWorld(target.set(sign*.264,1.128+.027,-.262-steeringZ+.080)).lerp(palm,1-blend)
      const upperLength = shoulder.distanceTo(elbow), lowerLength = elbow.distanceTo(palm)
      const shortfall = shoulder.distanceTo(target) - upperLength - lowerLength
      const clavicle = upper.parent
      if (shortfall > 0 && clavicle) {
        clavicle.getWorldPosition(collar)
        reach.subVectors(target,shoulder).setLength(Math.min(.14,shortfall*1.35)).add(shoulder)
        aim(clavicle,collar,shoulder,reach)
        upper.getWorldPosition(shoulder); lower.getWorldPosition(elbow)
      }
      axis.subVectors(target,shoulder)
      const distance = Math.max(Math.abs(upperLength-lowerLength)+1e-6,Math.min(axis.length(),upperLength+lowerLength-1e-6))
      axis.normalize()
      const along = (distance*distance+upperLength*upperLength-lowerLength*lowerLength)/(2*distance)
      bend.subVectors(elbow,shoulder).addScaledVector(axis,-bend.dot(axis)).normalize()
      elbowTarget.copy(shoulder).addScaledVector(axis,along).addScaledVector(bend,Math.sqrt(Math.max(0,upperLength*upperLength-along*along)))
      aim(upper,shoulder,elbow,elbowTarget)
      lower.getWorldPosition(elbow); hand.getWorldPosition(palm)
      aim(lower,elbow,palm,target)
      lower.getWorldQuaternion(wristRotation).invert().multiply(steering.getWorldQuaternion(delta)).multiply(overhand)
      hand.quaternion.slerp(wristRotation,blend)
      for (const {joint,rotation} of fingers) joint.quaternion.slerp(rotation,blend)
    }
  }
}
