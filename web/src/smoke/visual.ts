import {fingerPose} from '../walk/ebike-grip'
import {rules} from './data'
import * as THREE from 'three'
import {SmokeKit, SMOKE_ANCHORS, VIEW_ANCHORS} from './kit'
import {articulatedHand} from './hands'
import {Parts,createSmokePlume} from './models'
import type {SmokeView} from './session'

export function smokeVisual(scene:THREE.Scene, figure:THREE.Object3D, first?:{camera:THREE.PerspectiveCamera;skin:string}) {
  const kit=new SmokeKit(scene,'plain'),plume=createSmokePlume(scene,0xffb070),parts=new Parts()
  const root=new THREE.Group(),hands=first?[articulatedHand(first.skin,'left',parts),articulatedHand(first.skin,'right',parts)]:null
  figure.add(kit.root)
  if(first&&hands){root.add(...hands.map(hand=>hand.root));if(!first.camera.parent)scene.add(first.camera);first.camera.add(root);first.camera.layers.enable(2)}
  const tip=new THREE.Vector3(),handL=new THREE.Vector3(),handR=new THREE.Vector3(),mouth=new THREE.Vector3()
  const forward=new THREE.Vector3(),gripPoint=new THREE.Vector3()
  const flameOffset=new THREE.Vector3(0,.057,-.0045).applyEuler(new THREE.Euler(.72,0,-.66))
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
        // The filter starts just outside the bottom centre of the near plane.
        mouth.set(0,-1.04,-1).applyMatrix4(first.camera.projectionMatrixInverse)
        forward.set(0,-.08,-1).normalize()
        handL.copy(VIEW_ANCHORS.restL).lerp(VIEW_ANCHORS.handL,view.phase==='draw'?view.progress:view.carry)
        handR.copy(VIEW_ANCHORS.handR)
      }else{
        const lips=figure.getObjectByName('smoke-lips')
        if(lips){
          lips.getWorldPosition(mouth)
          figure.worldToLocal(mouth)
          forward.set(0,-.1,-1)
          figure.worldToLocal(lips.localToWorld(forward)).sub(mouth).normalize()
        }else{
          mouth.set(.004,1.57,-.10)
          forward.set(0,-.1,-1).normalize()
        }
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
        target.copy(mouth).addScaledVector(forward,.079).sub(flameOffset)
        target.y+=.012;target.z+=.016
        handL.lerp(target,view.light)
      }
      handL.y-=stow*.24
      handR.y-=stow*.24
      if(previousHolder!==holder)rightTarget.copy(handR)
      rightTarget.lerp(handR,1-Math.exp(-dt*24))
      handR.copy(rightTarget)
      previousHolder=holder
      if(!fp){
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
      kit.apply(view,{handL,handR,mouth,forward})
      if(fp&&hands){
        const [left,right]=hands
        const withLighter=view.light>view.carry
        const prop=withLighter?kit.lighter:kit.pack
        left.root.position.copy(prop.position)
        left.root.quaternion.copy(prop.quaternion)
        left.root.visible=withLighter?kit.lighter.visible:kit.pack.visible
        left.pose(withLighter?1:0)
        right.root.visible=view.carry>.01 || view.puff>.01
        if(right.root.visible){
          if(view.phase==='take'||view.lit){
            gripPoint.copy(kit.cigarette.position)
            if(view.lit){
              gripPoint.addScaledVector(forward,.031)
              gripPoint.x+=(1-view.puff)*.14
              gripPoint.y-=(1-view.puff)*.10
            }
          }else{
            kit.pinchPoint(view,gripPoint)
            if(view.phase==='draw')gripPoint.x+=(1-view.progress)*.09
          }
          right.root.position.copy(gripPoint)
          right.pose(0,view.phase==='sealed'||view.phase==='open'?1:0)
        }
      }
      if(view.phase==='light' && view.ember){mist+=dt;if(mist>=.18){kit.tipWorld(tip);plume.emit(tip,1,rules.density*.6);mist=0}}
      if(view.lit){mist+=dt;kit.tipWorld(tip);if(mist*rules.density>=.22){plume.emit(tip,1,.42);mist=0}
        if(lastPuffs!==undefined&&lastPuffs!==view.puffs)plume.emit(tip,Math.round(9*view.strength*rules.density),1.2*view.strength)}
    }
    if(!visible)previousHolder=undefined
    lastPuffs=view.puffs;plume.update(dt);kit.tick(performance.now())
  }
  return {tick,resetPose,drop:(length=0)=>kit.dropStub(figure.position,length),
    dispose(){resetPose();kit.dispose();plume.dispose();parts.dispose();root.removeFromParent()}}
}
