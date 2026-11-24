import {Object3D, Quaternion, Vector3} from 'three'
import {steeringZ} from './ebike-mounts'

const shoulder = new Vector3(), elbow = new Vector3(), palm = new Vector3()
const target = new Vector3(), axis = new Vector3(), bend = new Vector3(), elbowTarget = new Vector3()
const from = new Vector3(), to = new Vector3(), delta = new Quaternion(), parentRotation = new Quaternion()
const collar = new Vector3(), reach = new Vector3()

function aim(bone: Object3D, origin: Vector3, end: Vector3, goal: Vector3) {
  parentRotation.copy(bone.parent!.getWorldQuaternion(delta)).invert()
  from.subVectors(end, origin).applyQuaternion(parentRotation).normalize()
  to.subVectors(goal, origin).applyQuaternion(parentRotation).normalize()
  bone.quaternion.premultiply(delta.setFromUnitVectors(from, to))
}

export function createEbikeGripPose(figure: Object3D) {
  const arms = ['l','r'].map((side,index) => ({
    sign: index ? 1 : -1,
    upper: figure.getObjectByName(`upperarm_${side}`), lower: figure.getObjectByName(`lowerarm_${side}`),
    hand: figure.getObjectByName(`hand_${side}`),
  }))
  return (steering: Object3D, blend: number) => {
    for (const {sign,upper,lower,hand} of arms) {
      if (!upper || !lower || !hand || blend <= 0) continue
      upper.getWorldPosition(shoulder); lower.getWorldPosition(elbow)
      hand.localToWorld(palm.set(0,.06,0))
      steering.localToWorld(target.set(sign*.264,1.128,-.262-steeringZ)).lerp(palm,1-blend)
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
      lower.getWorldPosition(elbow); hand.localToWorld(palm.set(0,.06,0))
      aim(lower,elbow,palm,target)
    }
  }
}
