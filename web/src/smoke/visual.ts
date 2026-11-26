import * as THREE from 'three'
import {SmokeKit, LIGHTER_ROTATION, VIEW_ANCHORS} from './kit'
import {smokingHand} from './hands'
import {firstPersonArms} from './first-person-arms'
import {rules} from './data'
import {cigaretteLength,createSmokePlume} from './models'
import type {SmokeView} from './session'

export function smokeVisual(scene:THREE.Scene,figure:THREE.Object3D,camera?:THREE.PerspectiveCamera){
  const kit=new SmokeKit(scene,'plain'),plume=createSmokePlume(scene,0xffb070)
  figure.add(kit.root)
  const left=smokingHand(figure,'l'),right=smokingHand(figure,'r')
  const mask=camera?firstPersonArms(figure,kit.root):undefined
  const pinch=new THREE.Group()
  kit.root.add(pinch)
  const mouth=new THREE.Vector3(),handL=new THREE.Vector3(),handR=new THREE.Vector3()
  const forward=new THREE.Vector3(0,-.08,-1).normalize(),tip=new THREE.Vector3()
  const flameOffset=new THREE.Vector3(0,.057,-.0045).applyEuler(LIGHTER_ROTATION)
  const rotation=new THREE.Quaternion(),parent=new THREE.Quaternion(),eye=new THREE.Vector3()
  const lastTip=new THREE.Vector3()
  let emitted=false
  let mist=0,lastPuffs:number|undefined
  function resetPose(){left?.reset();right?.reset()}
  function setFirstPerson(on:boolean){mask?.show(on)}
  function freeProps(){
    for(const prop of [kit.pack,kit.lighter,kit.cigarette])if(prop.parent!==kit.root){kit.root.add(prop);prop.scale.setScalar(1)}
  }
  function tick(dt:number,view:SmokeView,fp=false){
    freeProps()
    mask?.show(fp&&view.phase!=='idle')
    kit.setBrand(view.brand)
    const visible=view.phase!=='idle'
    kit.root.visible=visible
    if(!visible){
      kit.resetState()
      emitted=false;mist=0
    }else{
      const lips=figure.getObjectByName('smoke-lips')??figure.getObjectByName('head')??figure
      if(fp&&camera){
        camera.getWorldPosition(eye);camera.getWorldQuaternion(rotation)
        mouth.set(0,-1.04,-1).applyMatrix4(camera.projectionMatrixInverse)
      }else{
        mouth.set(0,-.044,-.08)
        lips.getWorldQuaternion(rotation)
        eye.copy(mouth).applyQuaternion(rotation).negate().add(lips.getWorldPosition(tip))
      }
      kit.root.position.copy(figure.worldToLocal(eye))
      kit.root.quaternion.copy(figure.getWorldQuaternion(parent).invert().multiply(rotation))
      handL.copy(VIEW_ANCHORS.restL).lerp(VIEW_ANCHORS.handL,view.carry)
      if((view.phase==='draw'||view.phase==='drawOpened'))handL.lerpVectors(VIEW_ANCHORS.restL,VIEW_ANCHORS.handL,THREE.MathUtils.smoothstep(view.progress,0,.35))
      // Lower the box into the chest workspace; preserve visibility in the eye camera.
      // 第一人称：烟盒要举到画面下 1/3 内、物品栏之上，正面看得见（手机上物品栏更占地方）
      handL.y-=(fp ? -.045 : .16)*view.carry
      if(fp){handL.z+=.05*view.carry;handL.x-=.035*view.carry}
      handR.copy(VIEW_ANCHORS.handR)
      if(view.light>0){
        tip.copy(mouth).addScaledVector(forward,cigaretteLength(kit.brand)-.0065).sub(flameOffset)
        tip.y+=.012;tip.z+=.016
        const approach=view.phase==='light'?1-THREE.MathUtils.smoothstep(view.progress,.18,.50):1
        if(fp){
          tip.z-=.14*approach;tip.x-=.07*approach
        }else{
          tip.y-=.031*approach;tip.x-=.025*approach
        }
        handL.lerp(tip,view.light)
      }
      kit.apply(view,{handL,handR,mouth,forward})
      // Drive the original mesh and its skeleton, then mount each prop onto
      // the corresponding animated bone, preserving its solved world pose.
      const withLighter=view.light>view.carry&&view.light>.05
      if(left){
        if(withLighter&&kit.lighter.visible){
          left.apply('lighter',kit.lighter,THREE.MathUtils.smoothstep(view.light,.05,.25),view.phase==='light'?THREE.MathUtils.smoothstep(view.progress,.2,.34):0)
        }else if(!withLighter&&kit.pack.visible&&view.carry>.01){
          const packBlend=(view.phase==='draw'||view.phase==='drawOpened')?THREE.MathUtils.smoothstep(view.progress,0,.22):THREE.MathUtils.smoothstep(view.carry,.01,.25)
          left.apply('box',kit.pack,packBlend)
        }
      }
      if((view.carry>.01||view.puff>.01)&&right){
        if(view.phase==='take' && view.progress<.48 ||view.lit){
          pinch.position.copy(kit.cigarette.position)
          if(view.lit){
            pinch.position.addScaledVector(forward,fp ? .15 : 0)
            if(fp){pinch.position.x+=.042;pinch.position.y-=.064}
            pinch.position.x+=(1-view.puff)*.14
            pinch.position.y-=(1-view.puff)*.10
          }
        }else{
          kit.pinchPoint(view,pinch.position)
          if(view.phase==='take')pinch.position.lerp(kit.cigarette.position,1-THREE.MathUtils.smoothstep(view.progress,.48,.65))
        }
        const rightBlend=view.lit
          ?THREE.MathUtils.smoothstep(view.puff,.01,.35)
          :(view.phase==='draw'||view.phase==='drawOpened')?THREE.MathUtils.smoothstep(view.progress,0,.22)
          :view.phase==='take'?THREE.MathUtils.smoothstep(view.carry,.01,.3)
          :1
        const pushing=view.phase==='draw'||view.phase==='drawOpened'
        if(pushing)pinch.quaternion.copy(kit.pack.quaternion)
        else pinch.quaternion.identity()
        right.apply(pushing?'push':view.lit?'puff':'pinch',pinch,rightBlend)
      }
      if(left && kit.pack.visible)left.attachment.attach(kit.pack)
      if(left && kit.lighter.visible)left.attachment.attach(kit.lighter)
      if(kit.cigarette.visible)(view.phase==='take'&&view.progress<.48&&right?right.attachment:lips).attach(kit.cigarette)
      if(view.phase==='light' && view.ember){mist+=dt;if(mist>=.18){kit.tipWorld(tip);plume.emit(tip,1,rules.density*.6);mist=0}}
      if(view.lit){mist+=dt;kit.tipWorld(tip);if(rules.density>0 && (mist*rules.density>=.11 || emitted && lastTip.distanceToSquared(tip)>.0064)){
          plume.emit(tip,1,.62);mist=0;lastTip.copy(tip);emitted=true
        }
        if(lastPuffs!==undefined&&lastPuffs!==view.puffs)plume.emit(tip,Math.round(9*view.strength*rules.density),1.2*view.strength)}
    }
    lastPuffs=view.puffs;plume.update(dt);kit.tick(performance.now())
  }
  return {tick,resetPose,setFirstPerson,drop:(length=0)=>kit.dropStub(figure.position,length),
    dispose(){freeProps();mask?.dispose();left?.dispose();right?.dispose();kit.dispose();plume.dispose()}}
}
