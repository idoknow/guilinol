import {Group,Quaternion,Vector3} from 'three'

export function passengerArms(figure:Group){
  const pivot=new Vector3(),direction=new Vector3(),desired=new Vector3(),turn=new Quaternion(),orientation=new Quaternion(),parent=new Quaternion()
  function chain(side:'l'|'r'){
    const joints=['lowerarm','upperarm'].map(name=>figure.getObjectByName(`${name}_${side}`)),hand=figure.getObjectByName(`hand_${side}`)
    return (target:Vector3)=>{
      if(!hand)return
      for(let pass=0;pass<3;pass++)for(const joint of joints){
        if(!joint?.parent)continue
        joint.getWorldPosition(pivot);hand.getWorldPosition(direction).sub(pivot).normalize();desired.subVectors(target,pivot).normalize()
        turn.setFromUnitVectors(direction,desired);joint.getWorldQuaternion(orientation).premultiply(turn)
        joint.quaternion.copy(joint.parent.getWorldQuaternion(parent).invert().multiply(orientation))
      }
    }
  }
  return {left:chain('l'),right:chain('r')}
}
