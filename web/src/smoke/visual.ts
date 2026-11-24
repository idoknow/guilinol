import {fingerPose} from '../walk/ebike-grip'
import {rules} from './data'
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
  const grips=[fingerPose(figure,'l',-1),fingerPose(figure,'r',1)]
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
  let previousView:SmokeView|undefined
  let stow=1
  const rightTarget=new THREE.Vector3()
  let previousHolder:THREE.Object3D|undefined
  function tick(dt:number,next:SmokeView,fp=false){
    let view=next
    if(next.phase==='idle'){
      stow=Math.min(1,stow+dt/.2)
      if(stow<1 && previousView){
        view={...previousView,hold:1-stow,carry:previousView.carry*(1-stow),light:previousView.light*(1-stow),
          cig:0,lit:false,flame:0,ember:0}
      }
    }else{
      previousView=next
      stow=0
    }
    kit.setBrand(view.brand)
    const visible=view.phase!=='idle',holder=fp?root:figure
    if(kit.root.parent!==holder){holder.add(kit.root);kit.root.traverse(node=>node.layers.set(fp?2:0))}
    kit.root.visible=visible;root.visible=visible&&fp
    if(visible){
      if(fp&&first&&hands){
        root.position.copy(first.camera.position);root.quaternion.copy(first.camera.quaternion)
        mouth.copy(VIEW_ANCHORS.mouth)
        handL.copy(VIEW_ANCHORS.restL).lerp(VIEW_ANCHORS.handL,view.phase==='draw'?view.progress:view.carry)
        handR.copy(VIEW_ANCHORS.handR)
      }else{
        mouth.set(.01,1.54,-.13)
        handL.copy(SMOKE_ANCHORS.packL)
        if(view.phase==='draw')handL.y-=(1-view.progress)*.22
        handR.copy(SMOKE_ANCHORS.smokeR)
      }
      if(view.carry>.01){
        handR.copy(handL)
        const tear=view.phase==='tear'?Math.max(0,(view.progress-.18)/.82):0
        handR.x+=view.phase==='sealed'?.055:.021+tear*.1
        handR.y+=view.phase==='sealed'?.075:.05-tear*.045
        handR.z+=.005
        if(view.phase==='take')handR.lerp(mouth,view.progress)
      }
      if(view.light>0){
        target.copy(mouth);target.y-=.05;target.z-=.045
        handL.lerp(target,view.light)
      }
      handL.y-=stow*.24
      handR.y-=stow*.24
      if(previousHolder!==holder)rightTarget.copy(handR)
      rightTarget.lerp(handR,1-Math.exp(-dt*24))
      handR.copy(rightTarget)
      previousHolder=holder
      if(fp&&hands){
        hands[0].position.copy(handL)
        hands[0].position.x-=.027
        hands[0].position.y-=.019
        hands[0].position.z-=.013
        hands[1].position.copy(handR)
        hands[1].position.x+=.021
        hands[1].position.y+=.011
        hands[0].rotation.z=-.9
        hands[1].rotation.z=.5
        hands[0].visible=view.carry>.01||view.light>.01
        hands[1].visible=view.carry>.01
        for(const hand of hands)hand.traverse(node=>node.layers.set(2))
      }else{
        if(view.carry>.01||view.light>.01)reach(arms[0],handL)
        if(view.carry>.01)reach(arms[1],handR)
        for(const [side,joints] of grips.entries()){
          const blend=side===0?Math.max(view.carry,view.light):view.carry
          if(!blend)continue
          for(const {joint,rotation} of joints){
            saved.set(joint,joint.quaternion.clone())
            joint.quaternion.slerp(rotation,blend*(side===1&&joint.name.startsWith('index')?.45:1))
          }
        }
      }
      kit.apply(view,{handL,handR,mouth})
      if(view.phase==='light' && view.ember){mist+=dt;if(mist>=.18){kit.tipWorld(tip);plume.emit(tip,1,rules.density*.6);mist=0}}
      if(view.lit){mist+=dt;kit.tipWorld(tip);if(mist*rules.density>=.22){plume.emit(tip,1,.42);mist=0}
        if(lastPuffs!==undefined&&lastPuffs!==view.puffs)plume.emit(tip,Math.round(9*view.strength*rules.density),1.2*view.strength)}
    }
    if(!visible)previousHolder=undefined
    lastPuffs=view.puffs;plume.update(dt);kit.tick(performance.now())
  }
  return {tick,resetPose,drop:(length=0)=>kit.dropStub(figure.position,figure.rotation.y,length),
    dispose(){resetPose();kit.dispose();plume.dispose();parts.dispose();root.removeFromParent()}}
}
