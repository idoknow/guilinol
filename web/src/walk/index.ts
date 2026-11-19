import * as THREE from 'three'
import R from '@dimforge/rapier3d-compat'
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js'
import type {PeaksGroup} from '../peaks'
import type {Manifest} from '../world'
import type {Stream} from '../stream'
import {walkInput} from '../ui/walk'
import {avatar} from '../look/avatar'
import {walkConfig as cfg} from './config'
import {createPhysics} from './physics'
import {look} from '../look/config'
import type {vehicles} from './vehicles'

let rapierReady:Promise<void>|undefined
let avatarReady:Promise<GLTF>|undefined

export function preloadWalk() {
  rapierReady ??= R.init()
  avatarReady ??= new GLTFLoader().loadAsync(avatar.path)
  return Promise.all([rapierReady,avatarReady])
}

function mergeAvatar(root:THREE.Group, tintHex:string|null) {
  if(root.userData.merged) return root.userData.skinned as THREE.SkinnedMesh|undefined
  root.userData.merged = true
  root.position.set(0,0,0); root.rotation.set(0,0,0); root.scale.setScalar(1)
  root.updateMatrixWorld(true)

  const bones:THREE.Bone[] = []
  const boneInverses:THREE.Matrix4[] = []
  const boneIndex = new Map<THREE.Object3D,number>()
  const posList:number[] = [], normList:number[] = [], colList:number[] = []
  const skinIdx:number[] = [], skinWgt:number[] = []
  const oldMeshes:THREE.Mesh[] = []
  const v = new THREE.Vector3(), n = new THREE.Vector3(), col = new THREE.Color()
  const override = tintHex ? new THREE.Color(tintHex) : null

  root.traverse(node=>{
    if(!(node instanceof THREE.Mesh) || (node instanceof THREE.SkinnedMesh)) return
    oldMeshes.push(node)
    const joint = node.parent ?? root
    let bIdx = boneIndex.get(joint)
    if(bIdx===undefined) {
      bIdx = bones.length
      boneIndex.set(joint,bIdx)
      bones.push(joint as unknown as THREE.Bone)
      boneInverses.push(joint.matrixWorld.clone().invert())
    }
    const g = node.geometry.index ? node.geometry.toNonIndexed() : node.geometry
    const pos = g.getAttribute('position'), norm = g.getAttribute('normal')
    const mat = node.material as THREE.MeshStandardMaterial
    col.copy(override ?? mat.color)
    for(let i=0;i<pos.count;i++) {
      v.fromBufferAttribute(pos,i).applyMatrix4(node.matrixWorld)
      posList.push(v.x,v.y,v.z)
      if(norm) n.fromBufferAttribute(norm,i).transformDirection(node.matrixWorld)
      else n.set(0,1,0)
      normList.push(n.x,n.y,n.z)
      colList.push(col.r,col.g,col.b)
      skinIdx.push(bIdx,0,0,0)
      skinWgt.push(1,0,0,0)
    }
    if(g!==node.geometry) g.dispose()
  })
  if(!oldMeshes.length) return undefined
  for(const m of oldMeshes) { m.parent?.remove(m); m.geometry.dispose() }

  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position',new THREE.Float32BufferAttribute(posList,3))
  geom.setAttribute('normal',new THREE.Float32BufferAttribute(normList,3))
  geom.setAttribute('color',new THREE.Float32BufferAttribute(colList,3))
  geom.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(skinIdx,4))
  geom.setAttribute('skinWeight',new THREE.Float32BufferAttribute(skinWgt,4))
  const mat = new THREE.MeshStandardMaterial({vertexColors:true,roughness:.95,metalness:0})
  const skinned = new THREE.SkinnedMesh(geom,mat)
  skinned.frustumCulled = false
  root.add(skinned)
  skinned.bind(new THREE.Skeleton(bones,boneInverses),new THREE.Matrix4())
  root.userData.skinned = skinned
  return skinned
}

export async function walk(scene:THREE.Scene,camera:THREE.PerspectiveCamera,canvas:HTMLCanvasElement,manifest:Manifest,stream:Stream,peaks:PeaksGroup,verify:boolean){
  rapierReady ??= R.init()
  avatarReady ??= new GLTFLoader().loadAsync(avatar.path)
  const [sim,model]=await Promise.all([createPhysics(manifest,stream,peaks,rapierReady),avatarReady])
  const figure=model.scene,skinned=mergeAvatar(figure,avatar.color);scene.add(figure);figure.visible=false;figure.scale.setScalar(avatar.scale)
  const mixer=new THREE.AnimationMixer(figure),actions=new Map(model.animations.map(clip=>[clip.name,mixer.clipAction(clip)]))
  let action:THREE.AnimationAction|undefined,active=false,yaw=0,pitch=cfg.pitch,arm=cfg.far,velocity=0,grounded=false,accumulator=0
  let resets=0,steps=0,physicsMs=0,elapsed=0,lastHits:string[]=[]
  const input=walkInput(canvas,()=>active,(dx,dy)=>{yaw-=dx*cfg.sensitivity;pitch=THREE.MathUtils.clamp(pitch+dy*cfg.sensitivity,-.8,1.3)},
    delta=>{arm=THREE.MathUtils.clamp(arm+delta*.013,cfg.zoomMin,cfg.zoomMax)},()=>{arm=arm>(cfg.far+cfg.near)/2?cfg.near:cfg.far})
  const safe=new THREE.Vector3(),focus=new THREE.Vector3(),direction=new THREE.Vector3();const spawns:object[]=[]
  let external:{x:number,z:number,run:boolean}|null=null,blockedWater=false,held=false
  const still={right:0,forward:0,run:false,jump:false}
  let rides:Awaited<ReturnType<typeof vehicles>>|null=null,loading=false
  function loadRides(){if(loading||rides||!active||!manifest.vehicles)return;loading=true
    const file=manifest.vehicles.file
    void import('./vehicles').then(module=>module.vehicles(scene,file,(x,z)=>{sim.sync(x,z);return place(x,z,'dismount')})).then(loaded=>{rides=loaded;rides.show(active)})
      .catch(error=>console.warn('Vehicles unavailable:',error)).finally(()=>{loading=false})}
  let wasBoat=false,wasBike=false,bikeObstacle=''
  function place(x:number,z:number,reason:string,override=false){const found=sim.findWalkableSpawn(x,z,override)
    if(verify)spawns.push({reason,from:[x,z],to:found?[found.x,found.z]:null,distance:found?Math.hypot(found.x-x,found.z-z):null,rule:found?.rule??'none'})
    if(!found)return false
    sim.body.setTranslation(found,true);sim.body.setNextKinematicTranslation(found);sim.world.step();safe.set(found.x,found.y,found.z);velocity=0;grounded=false;return true}
  async function enter(x:number,z:number,heading:number,reason:string,override=false){
    focus.set(x,0,z);const needed=manifest.chunks.filter(tile=>Math.hypot(Math.max(0,Math.abs(x-tile.x-128)-128),Math.max(0,Math.abs(z-tile.z-128)-128))<=cfg.search)
    const deadline=performance.now()+15000
    while(needed.some(tile=>!stream.loaded.has(tile))&&performance.now()<deadline){stream.tick(focus);await new Promise(resolve=>setTimeout(resolve,12))}
    const bridge=manifest.landmarks?.find(entry=>entry.id==='jiefang_bridge'&&Math.hypot(entry.position[0]-x,entry.position[2]-z)<=entry.sphere[3]+cfg.search)
    if(bridge){
      focus.y=bridge.position[1]
      while(!stream.landmarks.has(bridge)&&performance.now()<deadline){stream.updateLandmarks?.(focus,bridge);await new Promise(resolve=>setTimeout(resolve,12))}
      if(!stream.landmarks.has(bridge))return false
    }
    sim.sync(x,z);if(!place(x,z,reason,override)){window.dispatchEvent(new CustomEvent('walk:spawn-failed',{detail:{x,z,reason:'no-walkable-support'}}));return false}
    active=true;rides?.show(true);requestAnimationFrame(()=>requestAnimationFrame(loadRides));figure.visible=true;yaw=heading;figure.rotation.y=yaw+avatar.yaw;input.show(true);accumulator=0;camera.near=.08;camera.updateProjectionMatrix();follow();return true
  }
  function leave(){active=false;rides?.show(false);wasBoat=wasBike=false;figure.visible=false;input.show(false);external=null;sim.clear();camera.near=1;camera.updateProjectionMatrix()}
  function follow(){const pos=sim.body.translation();figure.position.set(pos.x,pos.y-cfg.height/2,pos.z)
    if(rides?.boat){figure.position.copy(rides.boat.position);figure.position.y+=rides.boat.name==='raft'?-.44:-.18;figure.rotation.y=rides.heading}
    rides?.park(figure.position)
    if(rides?.bike){figure.rotation.y=rides.heading;figure.position.z+=Math.cos(rides.heading)*.23;figure.position.x+=Math.sin(rides.heading)*.23}
    focus.copy(figure.position);focus.y+=1.4;direction.set(Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch))
    const distance=arm+(rides?.bike?2.8:0),hit=sim.world.castRay(new R.Ray(focus,direction),distance,true,undefined,undefined,sim.capsule)
    camera.position.copy(focus).addScaledVector(direction,Math.max(.02,(hit?.timeOfImpact??distance)-.18));camera.lookAt(focus)
  }
  const terrainRay=new THREE.Raycaster(undefined,new THREE.Vector3(0,-1,0))
  function boatClearance(){const boat=rides?.boat;if(!boat)return null
    figure.updateMatrixWorld(true);skinned?.skeleton.update()
    const roof=new THREE.Box3().setFromObject(boat,true).max.y,head=new THREE.Box3().setFromObject(figure,true).max.y
    let underside=Infinity
    for(const along of [-2.3,-1,0,1,2.3])for(const across of [-1,0,1]){const point=boat.localToWorld(new THREE.Vector3(across,0,along)),deck=sim.surface(point.x,point.z,'deck');if(deck)underside=Math.min(underside,deck.y-(deck.thin?.6:look.bridgeDepth))}
    return {kind:boat.name,head,roof,underside,clearance:underside-Math.max(head,roof)}}
  function sit(){mixer.stopAllAction();action=undefined;for(const side of ['L','R'])for(const [part,value] of Object.entries({Thigh:1.25,Shin:-1.4,Arm:.9,Forearm:.35})){
    const joint=figure.getObjectByName(part+side);if(joint)joint.rotation.x=value}}
  function probe(){const pos=sim.body.translation(),foot=pos.y-cfg.height/2,peak=sim.surface(pos.x,pos.z,'peak')
    const tile=sim.tileAt(pos.x,pos.z),mesh=tile&&stream.loaded.get(tile)?.groundMesh
    terrainRay.ray.origin.set(pos.x,4000,pos.z);mesh?.updateWorldMatrix(true,false)
    const renderY=mesh?terrainRay.intersectObject(mesh,false)[0]?.point.y:undefined
    return {x:pos.x,z:pos.z,foot,renderY,renderClearance:foot-(renderY??Infinity),clearance:foot-(sim.surface(pos.x,pos.z,'ground')?.y??Infinity),inHouse:sim.insideHouse(pos.x,pos.z)||sim.overlaps('building'),
      inPeak:!!peak&&peak.y>foot+.3||sim.overlaps('peak'),deck:sim.surface(pos.x,pos.z,'deck')?.y,wet:sim.wet(pos.x,pos.z),blockedWater,resets,steps,physicsMs,elapsed,hits:lastHits}}
  function tick(dt:number){if(!active)return;const before=performance.now(),start=rides?.boat?.position??sim.body.translation();sim.sync(start.x,start.z);rides?.nearby(start.x,start.z)
    if(rides?.boat){if(!held)rides.advance(Math.min(.25,dt));if(!wasBoat){yaw=rides.heading+.95;sit()}wasBoat=!!rides.boat;follow();return}wasBoat=false
    const read=input.read(),keys=held?still:read,delta=new THREE.Vector2(keys.right*Math.cos(yaw)-keys.forward*Math.sin(yaw),-keys.forward*Math.cos(yaw)-keys.right*Math.sin(yaw))
    if(external)delta.set(external.x,external.z);delta.divideScalar(Math.max(1,delta.length()))
    let speed=external?.run??keys.run?cfg.run:cfg.walk;const step=1/60;let traveled=0;lastHits=[];blockedWater=false
    if(rides?.bike){const previous=rides.heading;speed=rides.steer(keys.forward,keys.right,Math.min(.12,dt));delta.set(-Math.sin(rides.heading),-Math.cos(rides.heading));yaw=wasBike?yaw+rides.heading-previous:rides.heading
      if(!wasBike)sit()}
    wasBike=!!rides?.bike
    if(keys.jump&&grounded&&!wasBike)velocity=Math.sqrt(-2*cfg.gravity*cfg.jump)
    accumulator+=Math.min(.12,dt)
    while(accumulator>=step){accumulator-=step;steps++;elapsed+=step
      const pos=sim.body.translation();velocity+=cfg.gravity*step
      sim.controller.computeColliderMovement(sim.capsule,{x:delta.x*speed*step,y:velocity*step,z:delta.y*speed*step})
      const move=sim.controller.computedMovement(),next={x:pos.x+move.x,y:pos.y+move.y,z:pos.z+move.z}
      grounded=sim.controller.computedGrounded();if(grounded&&velocity<0)velocity=0
      if(verify)for(let at=0;at<sim.controller.numComputedCollisions();at++){const coll=sim.controller.computedCollision(at)?.collider;if(coll)lastHits.push(sim.kinds.get(coll.handle)??'')}
      const ground=sim.surface(next.x,next.z,'ground')
      if(!ground||next.y-cfg.height/2<ground.y-3){if(place(safe.x,safe.z,'rescue'))resets++;break}
      if(sim.wet(next.x,next.z)){
        const foot=next.y-cfg.height/2,deck=sim.surface(next.x,next.z,'deck')
        if(!deck||foot<deck.y-.35){
          const tread=sim.surface(next.x,next.z,'landmark',foot+.6,1.4),tile=sim.tileAt(next.x,next.z),water=tile&&stream.loaded.get(tile)?.water
          const level=tile&&water?water[Math.round((next.z-tile.z)/4)*65+Math.round((next.x-tile.x)/4)]/10:Infinity
          if(!tread||tread.y<level){next.x=pos.x;next.z=pos.z;blockedWater=true}
        }
      }
      if(rides?.bike){let obstacle=false
        if(Math.hypot(move.x,move.z)<speed*step*.35)for(let at=0;at<sim.controller.numComputedCollisions();at++){
          const contact=sim.controller.computedCollision(at)
          if(contact&&contact.normal1.y<Math.cos(cfg.slope)){obstacle=true;break}
        }
        const reason=sim.insideHouse(next.x+delta.x*.72,next.z+delta.y*.72)?'building':!rides.pavement(next.x,next.z)?'off-road':obstacle?'collision':''
        if(reason){bikeObstacle=reason;next.x=pos.x;next.z=pos.z;rides.stop();speed=0}}
      traveled+=Math.hypot(next.x-pos.x,next.z-pos.z);sim.body.setNextKinematicTranslation(next);sim.world.step();if(grounded&&!blockedWater)safe.set(next.x,next.y,next.z)
    }
    physicsMs+=performance.now()-before
    if(traveled>.001)figure.rotation.y=Math.atan2(-delta.x,-delta.y)+avatar.yaw
    const nextAction=actions.get(avatar.clips[!grounded?'jump':traveled<.001?'idle':speed===cfg.run?'run':'walk'])
    if(!wasBike&&nextAction&&action!==nextAction){action?.fadeOut(.2);nextAction.reset().fadeIn(.2).play();action=nextAction}
    mixer.update(dt);follow()
  }
  function photoSupport(x:number,z:number,bridgeRadius:number){
    const tile=sim.tileAt(x,z), data=tile&&stream.loaded.get(tile)
    if(!tile||!data)throw Error(`Missing detail at ${x},${z}`)
    sim.sync(x,z)
    const water=data.water[Math.round((z-tile.z)/4)*65+Math.round((x-tile.x)/4)]
    const waterY=water===-32768?-Infinity:water/10
    function deckAt(east:number,south:number){
      const deck=sim.surface(east,south,'deck')
      if(deck)return deck
      // walk.tick also supports landmark treads over water (e.g. the Nine-Bend Bridge).
      if(Number.isFinite(waterY)){
        const tread=sim.surface(east,south,'landmark')
        if(tread && tread.slope<=cfg.slope && tread.y>waterY)return tread
      }
      return null
    }
    const deck=deckAt(x,z)
    if(deck)return {kind:'deck',y:Math.max(deck.y,waterY),sampleDistance:0}
    // Known on-bridge photo, but the recorded point lies beside the narrow span.
    // Borrow only elevation inside the EXIF uncertainty circle. Keep the original X/Z.
    if(bridgeRadius>0 && Number.isFinite(waterY)){
      let nearest:null|{kind:string,y:number,sampleDistance:number}=null
      const steps=Math.ceil(bridgeRadius/.5)
      for(let i=-steps;i<=steps;i++)for(let j=-steps;j<=steps;j++){
        const d=Math.hypot(i,j)*.5
        if(!d||d>bridgeRadius||(nearest&&d>=nearest.sampleDistance))continue
        const hit=deckAt(x+i*.5,z+j*.5)
        if(hit)nearest={kind:'deck',y:Math.max(hit.y,waterY),sampleDistance:d}
      }
      if(nearest)return nearest
    }
    for(const kind of ['sidewalk','ground'] as const){
      const hit=sim.surface(x,z,kind)
      if(hit)return {kind,y:Math.max(hit.y,waterY),sampleDistance:0}
    }
    throw Error(`Missing support at ${x},${z}`)
  }
  return {photoSupport,enter,leave,tick,spawns,probe,boatClearance,get obstacle(){return bikeObstacle},get vehicle(){return rides?.bike?'bike':rides?.boat?'boat':'foot'},get heading(){return rides?.heading??0},get speed(){return rides?.speed??0},get active(){return active},drive(x:number,z:number,run=true){external={x,z,run}},
    get yaw(){return yaw},hold(on:boolean){held=on;external=null;if(on)rides?.stop()},face(heading:number,tilt=cfg.pitch){yaw=heading;pitch=tilt;if(active)follow()},showFigure(on:boolean){figure.visible=on&&active},
    get position(){const pos=rides?.boat?.position??sim.body.translation();return focus.set(pos.x,pos.y,pos.z)}}
}
