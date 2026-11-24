import * as THREE from 'three'
import {SmokeKit, SMOKE_ANCHORS, VIEW_ANCHORS} from './kit'
import {Parts,createMitt,createSmokePlume} from './models'
import type {SmokeView} from './session'

export function smokeVisual(scene:THREE.Scene, figure:THREE.Object3D, first?:{camera:THREE.Camera;skin:string}) {
  const kit=new SmokeKit(scene,'plain'),plume=createSmokePlume(scene,0xffb070),parts=new Parts()
  const root=new THREE.Group(),hands=first?[createMitt(first.skin,false,parts),createMitt(first.skin,true,parts)]:null
  figure.add(kit.root)
  if(first&&hands){root.add(...hands);scene.add(root);first.camera.layers.enable(2)}
  const tip=new THREE.Vector3(),handL=new THREE.Vector3(),handR=new THREE.Vector3(),mouth=new THREE.Vector3()
  const target=new THREE.Vector3(),origin=new THREE.Vector3(),direction=new THREE.Vector3(),delta=new THREE.Quaternion(),parent=new THREE.Quaternion()
  const arms=['l','r'].map(side=>['upperarm_','lowerarm_','hand_'].map(prefix=>figure.getObjectByName(prefix+side)))
  const saved=new Map<THREE.Object3D,THREE.Quaternion>()
  let mist=0,lastPuffs:number|undefined
  function resetPose(){for(const [bone,rotation] of saved)bone.quaternion.copy(rotation);saved.clear()}
  function reach(chain:(THREE.Object3D|undefined)[],goal:THREE.Vector3){
    const [upper,lower,hand]=chain
    if(!upper||!lower||!hand)return
    for(const joint of [upper,lower])saved.set(joint,joint.quaternion.clone())
    target.copy(goal);figure.localToWorld(target)
    for(const joint of [lower,upper,lower]){
      joint.getWorldPosition(origin);hand.getWorldPosition(direction).sub(origin).normalize()
      const wanted=tip.copy(target).sub(origin).normalize()
      joint.parent!.getWorldQuaternion(parent);delta.setFromUnitVectors(direction,wanted)
      joint.quaternion.premultiply(delta.premultiply(parent.clone().invert()).multiply(parent))
    }
    figure.worldToLocal(hand.getWorldPosition(goal))
  }
  function tick(dt:number,view:SmokeView,fp=false){
    const visible=view.phase!=='idle',holder=fp?root:figure
    if(kit.root.parent!==holder){holder.add(kit.root);kit.root.traverse(node=>node.layers.set(fp?2:0))}
    kit.root.visible=visible;root.visible=visible&&fp
    if(visible){
      if(fp&&first&&hands){
        root.position.copy(first.camera.position);root.quaternion.copy(first.camera.quaternion)
        handL.copy(VIEW_ANCHORS.handL);handR.copy(VIEW_ANCHORS.handR).lerp(VIEW_ANCHORS.handRLight,view.light);mouth.copy(VIEW_ANCHORS.mouth)
        handR.lerp(mouth,view.puff);hands[0].position.copy(handL);hands[0].visible=view.carry>.02;hands[1].position.copy(handR)
        for(const hand of hands)hand.traverse(node=>node.layers.set(2))
      }else{
        mouth.set(.01,1.54,-.13);handL.copy(SMOKE_ANCHORS.packL);handR.copy(SMOKE_ANCHORS.smokeR).lerp(mouth,Math.max(view.light,view.puff))
        if(view.carry>.02)reach(arms[0],handL);reach(arms[1],handR)
      }
      kit.apply(view,{handL,handR,mouth})
      if(view.lit){mist+=dt;kit.tipWorld(tip);if(mist>=.22){plume.emit(tip,1,.42);mist=0}
        if(lastPuffs!==undefined&&lastPuffs!==view.puffs)plume.emit(tip,9,1.2)}
    }
    lastPuffs=view.puffs;plume.update(dt);kit.tick(performance.now())
  }
  return {tick,resetPose,drop:()=>kit.dropStub(figure.position,figure.rotation.y),
    dispose(){resetPose();kit.dispose();plume.dispose();parts.dispose();root.removeFromParent()}}
}
