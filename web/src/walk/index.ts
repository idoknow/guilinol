import * as THREE from 'three'
import R from '@dimforge/rapier3d-compat'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'
import type {Manifest} from '../world'
import type {Stream} from '../stream'
import {walkInput} from '../ui/walk'
import {avatar} from '../look/avatar'
import {walkConfig as cfg} from './config'
import {createPhysics} from './physics'

export async function walk(scene:THREE.Scene,camera:THREE.PerspectiveCamera,canvas:HTMLCanvasElement,manifest:Manifest,stream:Stream,peaks:THREE.Group,verify:boolean){
  const [sim,model]=await Promise.all([createPhysics(manifest,stream,peaks),new GLTFLoader().loadAsync(avatar.path)])
  const figure=model.scene;scene.add(figure);figure.visible=false;figure.scale.setScalar(avatar.scale)
  if(avatar.color)figure.traverse(node=>{if(node instanceof THREE.Mesh)node.material.color.set(avatar.color)})
  const mixer=new THREE.AnimationMixer(figure),actions=new Map(model.animations.map(clip=>[clip.name,mixer.clipAction(clip)]))
  let action:THREE.AnimationAction|undefined,active=false,yaw=0,pitch=cfg.pitch,arm=cfg.far,velocity=0,grounded=false,accumulator=0
  let resets=0,steps=0,physicsMs=0,elapsed=0,lastHits:string[]=[]
  const input=walkInput(canvas,()=>active,(dx,dy)=>{yaw-=dx*cfg.sensitivity;pitch=THREE.MathUtils.clamp(pitch+dy*cfg.sensitivity,-.8,1.3)},
    delta=>{arm=THREE.MathUtils.clamp(arm+delta*.013,cfg.zoomMin,cfg.zoomMax)},()=>{arm=arm>(cfg.far+cfg.near)/2?cfg.near:cfg.far})
  const safe=new THREE.Vector3(),focus=new THREE.Vector3(),direction=new THREE.Vector3();const spawns:object[]=[]
  let external:{x:number,z:number,run:boolean}|null=null,blockedWater=false
  function place(x:number,z:number,reason:string,override=false){const found=sim.findWalkableSpawn(x,z,override)
    if(verify)spawns.push({reason,from:[x,z],to:found?[found.x,found.z]:null,distance:found?Math.hypot(found.x-x,found.z-z):null,rule:found?.rule??'none'})
    if(!found)return false
    sim.body.setTranslation(found,true);sim.body.setNextKinematicTranslation(found);sim.world.step();safe.set(found.x,found.y,found.z);velocity=0;grounded=false;return true}
  async function enter(x:number,z:number,heading:number,reason:string,override=false){
    focus.set(x,0,z);const needed=manifest.chunks.filter(tile=>Math.hypot(Math.max(0,Math.abs(x-tile.x-128)-128),Math.max(0,Math.abs(z-tile.z-128)-128))<=cfg.search)
    const deadline=performance.now()+15000
    while(needed.some(tile=>!stream.loaded.has(tile))&&performance.now()<deadline){stream.tick(focus);await new Promise(resolve=>setTimeout(resolve,12))}
    sim.sync(x,z);if(!place(x,z,reason,override)){window.dispatchEvent(new CustomEvent('walk:spawn-failed',{detail:{x,z,reason:'no-walkable-support'}}));return false}
    active=true;figure.visible=true;yaw=heading;figure.rotation.y=yaw+avatar.yaw;input.show(true);accumulator=0;camera.near=.08;camera.updateProjectionMatrix();follow();return true
  }
  function leave(){active=false;figure.visible=false;input.show(false);external=null;sim.clear();camera.near=1;camera.updateProjectionMatrix()}
  function follow(){const pos=sim.body.translation();figure.position.set(pos.x,pos.y-cfg.height/2,pos.z)
    focus.copy(figure.position);focus.y+=1.4;direction.set(Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch))
    const hit=sim.world.castRay(new R.Ray(focus,direction),arm,true,undefined,undefined,sim.capsule)
    camera.position.copy(focus).addScaledVector(direction,Math.max(.02,(hit?.timeOfImpact??arm)-.18));camera.lookAt(focus)
  }
  const terrainRay=new THREE.Raycaster(undefined,new THREE.Vector3(0,-1,0))
  function probe(){const pos=sim.body.translation(),foot=pos.y-cfg.height/2,peak=sim.surface(pos.x,pos.z,'peak')
    const tile=sim.tileAt(pos.x,pos.z),mesh=tile&&stream.loaded.get(tile)?.groundMesh
    terrainRay.ray.origin.set(pos.x,4000,pos.z);mesh?.updateWorldMatrix(true,false)
    const renderY=mesh?terrainRay.intersectObject(mesh,false)[0]?.point.y:undefined
    return {x:pos.x,z:pos.z,foot,renderY,renderClearance:foot-(renderY??Infinity),clearance:foot-(sim.surface(pos.x,pos.z,'ground')?.y??Infinity),inHouse:sim.insideHouse(pos.x,pos.z)||sim.overlaps('building'),
      inPeak:!!peak&&peak.y>foot+.3||sim.overlaps('peak'),deck:sim.surface(pos.x,pos.z,'deck')?.y,wet:sim.wet(pos.x,pos.z),blockedWater,resets,steps,physicsMs,elapsed,hits:lastHits}}
  function tick(dt:number){if(!active)return;const before=performance.now(),start=sim.body.translation();sim.sync(start.x,start.z)
    const keys=input.read(),delta=new THREE.Vector2(keys.right*Math.cos(yaw)-keys.forward*Math.sin(yaw),-keys.forward*Math.cos(yaw)-keys.right*Math.sin(yaw))
    if(external)delta.set(external.x,external.z);delta.divideScalar(Math.max(1,delta.length()))
    const speed=external?.run??keys.run?cfg.run:cfg.walk,step=1/60;let traveled=0;lastHits=[];blockedWater=false
    if(keys.jump&&grounded)velocity=Math.sqrt(-2*cfg.gravity*cfg.jump)
    accumulator+=Math.min(.12,dt)
    while(accumulator>=step){accumulator-=step;steps++;elapsed+=step
      const pos=sim.body.translation();velocity+=cfg.gravity*step
      sim.controller.computeColliderMovement(sim.capsule,{x:delta.x*speed*step,y:velocity*step,z:delta.y*speed*step})
      const move=sim.controller.computedMovement(),next={x:pos.x+move.x,y:pos.y+move.y,z:pos.z+move.z}
      grounded=sim.controller.computedGrounded();if(grounded&&velocity<0)velocity=0
      if(verify)for(let at=0;at<sim.controller.numComputedCollisions();at++){const coll=sim.controller.computedCollision(at)?.collider;if(coll)lastHits.push(sim.kinds.get(coll.handle)??'')}
      const ground=sim.surface(next.x,next.z,'ground')
      if(!ground||next.y-cfg.height/2<ground.y-3){if(place(safe.x,safe.z,'rescue'))resets++;break}
      if(sim.wet(next.x,next.z)){const deck=sim.surface(next.x,next.z,'deck');if(!deck||next.y-cfg.height/2<deck.y-.35){next.x=pos.x;next.z=pos.z;blockedWater=true}}
      traveled+=Math.hypot(next.x-pos.x,next.z-pos.z);sim.body.setNextKinematicTranslation(next);sim.world.step();if(grounded&&!blockedWater)safe.set(next.x,next.y,next.z)
    }
    physicsMs+=performance.now()-before
    if(traveled>.001)figure.rotation.y=Math.atan2(-delta.x,-delta.y)+avatar.yaw
    const nextAction=actions.get(avatar.clips[!grounded?'jump':traveled<.001?'idle':speed===cfg.run?'run':'walk'])
    if(nextAction&&action!==nextAction){action?.fadeOut(.2);nextAction.reset().fadeIn(.2).play();action=nextAction}
    mixer.update(dt);follow()
  }
  return {enter,leave,tick,spawns,probe,get active(){return active},drive(x:number,z:number,run=true){external={x,z,run}},
    get position(){const pos=sim.body.translation();return focus.set(pos.x,pos.y,pos.z)}}
}
