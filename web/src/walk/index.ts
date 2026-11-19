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
import {createCameraRig} from './camera'
import {look} from '../look/config'
import {createRiderPose,notifyDismountBlocked} from './ride'
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

function shortestAngle(from:number, to:number) {
  return Math.atan2(Math.sin(to-from),Math.cos(to-from))
}

export async function walk(scene:THREE.Scene,camera:THREE.PerspectiveCamera,canvas:HTMLCanvasElement,manifest:Manifest,stream:Stream,peaks:PeaksGroup,verify:boolean){
  rapierReady ??= R.init()
  avatarReady ??= new GLTFLoader().loadAsync(avatar.path)
  const [sim,model]=await Promise.all([createPhysics(manifest,stream,peaks,rapierReady),avatarReady])
  const rig=createCameraRig(sim)
  const figure=model.scene,skinned=mergeAvatar(figure,avatar.color),traveller=figure.getObjectByName('Traveller'),ridePose=createRiderPose(figure)
  scene.add(figure);figure.visible=false;figure.scale.setScalar(avatar.scale)
  const mixer=new THREE.AnimationMixer(figure),actions=new Map(model.animations.map(clip=>[clip.name,mixer.clipAction(clip)]))
  let action:THREE.AnimationAction|undefined,active=false,yaw=0,pitch=cfg.pitch,arm=cfg.far,facing=0,bankLean=0,strideLean=0,prevSpeed=0
  let vx=0,vz=0,velocity=0,grounded=false,snapEnabled=true,coyoteTimer=0,jumpTimer=0,accumulator=0
  let resets=0,steps=0,physicsMs=0,elapsed=0,lastHits:string[]=[]
  const input=walkInput(canvas,()=>active,(dx,dy)=>{yaw-=dx*cfg.sensitivity;pitch=THREE.MathUtils.clamp(pitch+dy*cfg.sensitivity,-.8,1.3)},
    delta=>{arm=THREE.MathUtils.clamp(arm+delta*.013,cfg.zoomMin,cfg.zoomMax);if(active)follow(0,true)},
    ()=>{arm=arm>(cfg.far+cfg.near)/2?cfg.near:cfg.far;if(active)follow(0,true)})
  const safe=new THREE.Vector3(),posOut=new THREE.Vector3(),wish=new THREE.Vector2();const spawns:object[]=[]
  let external:{x:number,z:number,run:boolean}|null=null,blockedWater=false,held=false
  const still={right:0,forward:0,run:false,jump:false}
  let rides:Awaited<ReturnType<typeof vehicles>>|null=null,loading=false
  function setSnap(on:boolean){if(snapEnabled===on)return;snapEnabled=on;if(on)sim.controller.enableSnapToGround(cfg.snap);else sim.controller.disableSnapToGround()}
  function resetMotion(){vx=vz=velocity=coyoteTimer=jumpTimer=bankLean=strideLean=prevSpeed=0;grounded=false;setSnap(true);figure.rotation.x=figure.rotation.z=0;if(traveller)traveller.rotation.set(0,0,0)}
  function supportAt(x:number,z:number,refY:number){
    const deck=sim.surface(x,z,'deck',refY+.35,1.4)
    const validDeck=deck&&deck.y<=refY+.35?deck:null
    return validDeck??sim.surface(x,z,'sidewalk')??sim.surface(x,z,'ground')
  }
  function loadRides(){if(loading||rides||!active||!manifest.vehicles)return;loading=true
    const file=manifest.vehicles.file
    void import('./vehicles').then(module=>module.vehicles(scene,file,(x,z,bikeHeading,bikeY)=>{sim.sync(x,z)
      if(bikeHeading===undefined)return place(x,z,'dismount')
      const found=sim.findLocalDismount(x,z,bikeHeading,bikeY??safe.y-cfg.height/2)
      if(!found){notifyDismountBlocked();return false}
      const prevFoot=figure.position.clone(),prevYaw=figure.rotation.y
      if(!place(x,z,'dismount',true,found))return false
      facing=bikeHeading+avatar.yaw
      ridePose.startDismount(prevFoot,prevYaw);input.clearRun();return true
    },(bx,by,bz)=>{sim.sync(bx,bz)
      const cur=sim.body.translation(),check=sim.findLocalMount(cur.x,cur.y-cfg.height/2,cur.z,bx,by,bz)
      if(!check.ok){notifyDismountBlocked(check.reason==='blocked'?'中间有遮挡，绕过去再骑':'这里太窄了，挪一挪再骑');return null}
      return check
    },{sim,stream,landFree:spot=>{sim.sync(spot.x,spot.z);rides?.clearBoatPose(figure)
      if(!place(spot.x,spot.z,spot.rule,true,spot))return false
      facing=spot.heading+avatar.yaw;figure.rotation.y=facing;wasBoat=false;input.clearRun();follow(0,true);return true}})).then(loaded=>{rides=loaded;rides.show(active)
      if(active){const p=sim.body.translation();sim.sync(p.x,p.z);loaded.nearby(p.x,p.z,p.y-cfg.height/2)}})
      .catch(error=>console.warn('Vehicles unavailable:',error)).finally(()=>{loading=false})}
  let wasBoat=false,wasBike=false,bikeObstacle=''
  function place(x:number,z:number,reason:string,override=false,prefound?:ReturnType<typeof sim.findWalkableSpawn>){const found=prefound??sim.findWalkableSpawn(x,z,override)
    if(verify)spawns.push({reason,from:[x,z],to:found?[found.x,found.z]:null,distance:found?Math.hypot(found.x-x,found.z-z):null,rule:found?.rule??'none'})
    if(!found)return false
    sim.body.setTranslation(found,true);sim.body.setNextKinematicTranslation(found);sim.world.step();safe.set(found.x,found.y,found.z);resetMotion();return true}
  async function enter(x:number,z:number,heading:number,reason:string,override=false){
    posOut.set(x,0,z);const needed=manifest.chunks.filter(tile=>Math.hypot(Math.max(0,Math.abs(x-tile.x-128)-128),Math.max(0,Math.abs(z-tile.z-128)-128))<=cfg.search)
    const deadline=performance.now()+15000
    while(needed.some(tile=>!stream.loaded.has(tile))&&performance.now()<deadline){stream.tick(posOut);await new Promise(resolve=>setTimeout(resolve,12))}
    sim.sync(x,z);if(!place(x,z,reason,override)){window.dispatchEvent(new CustomEvent('walk:spawn-failed',{detail:{x,z,reason:'no-walkable-support'}}));return false}
    active=true;rides?.show(true);requestAnimationFrame(()=>requestAnimationFrame(loadRides));figure.visible=true
    yaw=heading;facing=yaw+avatar.yaw;figure.rotation.y=facing;input.show(true);accumulator=0;rig.reset(arm)
    camera.near=.08;camera.updateProjectionMatrix();follow(0,true);return true
  }
  function leave(){active=false;rides?.clearBoatPose(figure);rides?.show(false);wasBoat=wasBike=false;bikeObstacle='';ridePose.reset();resetMotion();figure.visible=false;input.show(false);external=null;sim.clear();camera.near=1;camera.updateProjectionMatrix()}
  function follow(dt=0,snap=false){const pos=sim.body.translation();figure.position.set(pos.x,pos.y-cfg.height/2,pos.z)
    if(rides?.boat){figure.position.copy(rides.boat.position);figure.position.y+=rides.boatSeatOffset;figure.rotation.y=rides.heading}
    if(rides?.bike){
      const fx=-Math.sin(rides.heading),fz=-Math.cos(rides.heading),baseY=pos.y-cfg.height/2
      const cSup=supportAt(pos.x,pos.z,baseY)
      const groundY=cSup&&baseY-cSup.y<=.12&&baseY>=cSup.y-.05?cSup.y:baseY-.03
      figure.position.y=groundY
      if(dt>0){
        const fSup=supportAt(pos.x+fx*.55,pos.z+fz*.55,groundY)
        const bSup=supportAt(pos.x-fx*.55,pos.z-fz*.55,groundY)
        rides.setPitch(fSup?.y,bSup?.y,dt)
      }
      rides.park(figure.position)
      ridePose.updateRiding(figure.position,rides.heading,rides.lean,rides.pitch,rides.speed,rides.steerInput,dt)
    }else{
      rides?.park(figure.position)
      ridePose.applyDismount(figure.position,facing,dt)
    }
    rig.update(camera,figure.position,yaw,pitch,arm+ridePose.cameraArm(!!rides?.bike,dt,snap),dt,snap)
  }
  const terrainRay=new THREE.Raycaster(undefined,new THREE.Vector3(0,-1,0))
  function boatClearance(){
    const freeClear=rides?.boatClearance(figure,skinned);if(freeClear)return freeClear
    const boat=rides?.boat;if(!boat)return null
    figure.updateMatrixWorld(true);skinned?.skeleton.update()
    const roof=new THREE.Box3().setFromObject(boat,true).max.y,head=new THREE.Box3().setFromObject(figure,true).max.y
    let underside=Infinity
    for(const along of [-2.3,-1,0,1,2.3])for(const across of [-1,0,1]){const point=boat.localToWorld(new THREE.Vector3(across,0,along)),deck=sim.surface(point.x,point.z,'deck');if(deck)underside=Math.min(underside,deck.y-(deck.thin?.6:look.bridgeDepth))}
    return {kind:boat.name,head,roof,underside,clearance:underside-Math.max(head,roof)}}
  function sit(){mixer.stopAllAction();action=undefined;bankLean=strideLean=0;figure.rotation.x=figure.rotation.z=0;if(traveller)traveller.rotation.set(0,0,0);ridePose.clearJoints()
    for(const side of ['L','R'])for(const [part,value] of Object.entries({Thigh:1.25,Shin:-1.4,Arm:.9,Forearm:.35})){
      const joint=figure.getObjectByName(part+side);if(joint)joint.rotation.x=value}}
  function probe(){const pos=sim.body.translation(),foot=pos.y-cfg.height/2,peak=sim.surface(pos.x,pos.z,'peak')
    const tile=sim.tileAt(pos.x,pos.z),mesh=tile&&stream.loaded.get(tile)?.groundMesh
    terrainRay.ray.origin.set(pos.x,4000,pos.z);mesh?.updateWorldMatrix(true,false)
    const renderY=mesh?terrainRay.intersectObject(mesh,false)[0]?.point.y:undefined
    return {x:pos.x,z:pos.z,foot,renderY,renderClearance:foot-(renderY??Infinity),clearance:foot-(sim.surface(pos.x,pos.z,'ground')?.y??Infinity),inHouse:sim.insideHouse(pos.x,pos.z)||sim.overlaps('building'),
      inPeak:!!peak&&peak.y>foot+.3||sim.overlaps('peak'),deck:sim.surface(pos.x,pos.z,'deck')?.y,wet:sim.wet(pos.x,pos.z),blockedWater,resets,steps,physicsMs,elapsed,hits:lastHits,
      planarSpeed:Math.hypot(vx,vz),grounded,verticalVelocity:velocity,facing,figPos:figure.position.toArray(),figYaw:figure.rotation.y,bikePitch:rides?.bikePitch??0,bikeY:rides?.bikeY??0,
      camDist:rig.distance,camClipped:rig.clipped,camBlocked:rig.blocked,camCeiling:rig.ceilingClearance,camInHouse:sim.insideHouse(camera.position.x,camera.position.z),
      boat:rides?.boatProbe()??null}}
  function tick(dt:number){if(!active)return;const before=performance.now(),start=rides?.boat?.position??sim.body.translation();sim.sync(start.x,start.z);rides?.nearby(start.x,start.z,rides?.boat?start.y:start.y-cfg.height/2)
    if(rides?.freeBoat){
      const read=held?still:input.read(), firstFrame=!wasBoat
      if(firstFrame){yaw=rides.heading;mixer.stopAllAction();action=undefined;bankLean=strideLean=0
        figure.rotation.x=figure.rotation.z=0;if(traveller)traveller.rotation.set(0,0,0);ridePose.clearJoints();input.clearRun()}
      const prevHeading=rides.heading
      if(!held)rides.steerBoat(read.forward,read.right,Math.min(.12,dt))
      yaw+=rides.heading-prevHeading
      rides.poseBoat(figure,read.forward,read.right,Math.min(.12,dt))
      const bpos=rides.freeBoat.position, bp=rides.boatProbe(), wy=bp?bp.y:bpos.y
      sim.body.setTranslation({x:bpos.x,y:wy+cfg.height/2,z:bpos.z},true)
      sim.body.setNextKinematicTranslation({x:bpos.x,y:wy+cfg.height/2,z:bpos.z})
      wasBoat=true;follow(dt,firstFrame);return
    }
    if(rides?.boat){if(!held)rides.advance(Math.min(.25,dt));if(!wasBoat){yaw=rides.heading+.95;sit()}wasBoat=!!rides.boat;follow(dt);return}wasBoat=false
    const read=input.read(),keys=held?still:read
    wish.set(keys.right*Math.cos(yaw)-keys.forward*Math.sin(yaw),-keys.forward*Math.cos(yaw)-keys.right*Math.sin(yaw))
    if(external)wish.set(external.x,external.z)
    const rawLen=wish.length(), inputMag=Math.min(1,rawLen)
    if(rawLen>1e-5)wish.divideScalar(rawLen);else wish.set(0,0)
    const maxSpeed=(external?external.run:keys.run)?cfg.run:cfg.walk
    const step=1/60;let traveled=0,simSteps=0;lastHits=[];blockedWater=false
    let bikeSpeed=rides?.bike?rides.speed:0
    if(rides?.bike&&!wasBike){
      const bx=rides.bike.position.x,bz=rides.bike.position.z,cur=sim.body.translation()
      sim.sync(bx,bz)
      const sup=supportAt(bx,bz,rides.bike.position.y)
      const by=sup?sup.y:rides.bike.position.y
      ridePose.startMount({x:cur.x,y:cur.y-cfg.height/2,z:cur.z},figure.rotation.y)
      const dest={x:bx,y:by+cfg.height/2+.055,z:bz}
      sim.body.setTranslation(dest,true);sim.body.setNextKinematicTranslation(dest);sim.world.step()
      safe.set(dest.x,dest.y,dest.z);resetMotion();input.clearRun()
      mixer.stopAllAction();action=undefined;bikeObstacle='';bikeSpeed=0
    }
    wasBike=!!rides?.bike
    if(keys.jump&&!wasBike)jumpTimer=cfg.jumpBuffer
    accumulator+=Math.min(.12,dt)
    while(accumulator>=step-1e-7){accumulator=Math.max(0,accumulator-step);steps++;simSteps++;elapsed+=step
      if(grounded)coyoteTimer=cfg.coyote;else coyoteTimer=Math.max(0,coyoteTimer-step)
      if(!wasBike&&jumpTimer>0&&coyoteTimer>0){
        velocity=Math.sqrt(-2*cfg.gravity*cfg.jump)
        grounded=false;coyoteTimer=0;jumpTimer=0;setSnap(false)
      }else jumpTimer=Math.max(0,jumpTimer-step)
      if(velocity<=0)setSnap(true)

      if(wasBike&&rides?.bike){
        const previous=rides.heading
        ridePose.advanceMount(step)
        bikeSpeed=rides.steer(keys.forward,keys.right,step,ridePose.mounted)
        wish.set(-Math.sin(rides.heading),-Math.cos(rides.heading))
        if(ridePose.mounted)yaw+=rides.heading-previous
        vx=wish.x*bikeSpeed;vz=wish.y*bikeSpeed
      }else if(!wasBike){
        const tgtSpd=maxSpeed*inputMag
        if(!grounded){
          const targetVx=wish.x*tgtSpd, targetVz=wish.y*tgtSpd
          const dvx=targetVx-vx, dvz=targetVz-vz, diff=Math.hypot(dvx,dvz)
          if(diff>1e-5){
            const maxDelta=(inputMag>1e-3?cfg.airAccel:2.5)*step
            if(diff<=maxDelta){vx=targetVx;vz=targetVz}else{vx+=dvx/diff*maxDelta;vz+=dvz/diff*maxDelta}
          }
        }else if(inputMag<=1e-3){
          const curSpd=Math.hypot(vx,vz), drop=cfg.decel*step
          if(curSpd<=drop||curSpd<.08){vx=vz=0}else{const scale=(curSpd-drop)/curSpd;vx*=scale;vz*=scale}
        }else{
          let along=vx*wish.x+vz*wish.y
          let latX=vx-along*wish.x, latZ=vz-along*wish.y
          const latLen=Math.hypot(latX,latZ), latDrop=cfg.grip*step
          if(latLen<=latDrop){latX=latZ=0}else{const scale=(latLen-latDrop)/latLen;latX*=scale;latZ*=scale}
          if(along<0){
            along=Math.min(tgtSpd,along+cfg.decel*cfg.pivotBoost*step)
          }else if(along<tgtSpd){
            along=Math.min(tgtSpd,along+cfg.accel*step)
          }else if(along>tgtSpd){
            along=Math.max(tgtSpd,along-cfg.decel*step)
          }
          vx=wish.x*along+latX; vz=wish.y*along+latZ
        }
      }

      const pos=sim.body.translation()
      velocity+=(velocity>0?cfg.gravity:cfg.fallGravity)*step
      const stepDx=(wasBike?wish.x*bikeSpeed:vx)*step, stepDz=(wasBike?wish.y*bikeSpeed:vz)*step
      sim.controller.computeColliderMovement(sim.capsule,{x:stepDx,y:velocity*step,z:stepDz})
      const move=sim.controller.computedMovement(),next={x:pos.x+move.x,y:pos.y+move.y,z:pos.z+move.z}
      const nowGrounded=sim.controller.computedGrounded()
      if(velocity<=0){grounded=nowGrounded;if(grounded&&velocity<0)velocity=0}else if(move.y<velocity*step*.25)velocity=0
      if(verify)for(let at=0;at<sim.controller.numComputedCollisions();at++){const coll=sim.controller.computedCollision(at)?.collider;if(coll){const k=sim.kinds.get(coll.handle);lastHits.push(k==='deckThin'?'deck':k??'')}}
      const nextTile=sim.tileAt(next.x,next.z)
      if(nextTile&&!stream.loaded.has(nextTile)){next.x=pos.x;next.z=pos.z;vx=vz=0;rides?.stop();bikeSpeed=0}
      const ground=sim.surface(next.x,next.z,'ground')
      if(!ground||next.y-cfg.height/2<ground.y-3){if(place(safe.x,safe.z,'rescue'))resets++;break}
      if(sim.wet(next.x,next.z)){
        const foot=next.y-cfg.height/2,deck=sim.surface(next.x,next.z,'deck')
        if(!deck||foot<deck.y-.35){
          const tread=sim.surface(next.x,next.z,'landmark',foot+.6,1.4),tile=sim.tileAt(next.x,next.z),water=tile&&stream.loaded.get(tile)?.water
          const level=tile&&water?water[Math.round((next.z-tile.z)/4)*65+Math.round((next.x-tile.x)/4)]/10:Infinity
          if(!tread||tread.y<level){next.x=pos.x;next.z=pos.z;vx=vz=0;blockedWater=true;rides?.stop();bikeSpeed=0}
        }
      }
      if(rides?.bike){
        const res=rides.resolveMove({
          pos,next,move,heading:rides.heading,speed:bikeSpeed,step,
          pavement:rides.pavement,insideHouse:sim.insideHouse,
          blockedAt:(x,y,z)=>sim.isBlockedAt(x,y,z),
          collisionKind:(dirX,dirZ)=>{
            let hit:''|'collision'|'building'=''
            for(let at=0;at<sim.controller.numComputedCollisions();at++){
              const contact=sim.controller.computedCollision(at)
              if(!contact||contact.normal1.y>=Math.cos(cfg.slope))continue
              if(contact.normal1.x*dirX+contact.normal1.z*dirZ>=-.2)continue
              const kind=contact.collider?sim.kinds.get(contact.collider.handle):undefined
              if(kind==='sidewalk')continue
              if(kind==='building')return 'building'
              hit='collision'
            }
            return hit
          },
          stopBike:()=>rides!.stop(),
          dampBike:s=>rides!.dampSpeed(s),
          capOffRoad:(s,lim)=>rides!.capSpeed(s,lim),
        })
        bikeSpeed=res.speed
        if(res.blocked){bikeObstacle=res.reason;vx=vz=0}
        else{vx=wish.x*bikeSpeed;vz=wish.y*bikeSpeed;if(Math.abs(bikeSpeed)>.15)bikeObstacle=''}
      }
      else{
        for(let at=0;at<sim.controller.numComputedCollisions();at++){
          const contact=sim.controller.computedCollision(at)
          if(!contact||contact.normal1.y>=Math.cos(cfg.slope))continue
          const nx=contact.normal1.x, nz=contact.normal1.z, len=Math.hypot(nx,nz)
          if(len<1e-4)continue
          const ux=nx/len, uz=nz/len, dot=vx*ux+vz*uz
          if(dot<0){vx-=dot*ux;vz-=dot*uz}
        }
      }
      traveled+=Math.hypot(next.x-pos.x,next.z-pos.z);sim.body.setNextKinematicTranslation(next);sim.world.step();if(grounded&&!blockedWater)safe.set(next.x,next.y,next.z)
    }
    physicsMs+=performance.now()-before
    const actualSpeed=simSteps>0?traveled/(simSteps*step):Math.hypot(vx,vz)
    let turnDiff=0
    if(!wasBike){
      const velLen=Math.hypot(vx,vz)
      const dirX=velLen>.08?vx/velLen:inputMag>.05?wish.x:0, dirZ=velLen>.08?vz/velLen:inputMag>.05?wish.y:0
      if(dirX||dirZ){
        const goal=Math.atan2(-dirX,-dirZ)+avatar.yaw
        turnDiff=shortestAngle(facing,goal)
        facing+=turnDiff*Math.min(1,cfg.turnRate*Math.min(.12,dt))
      }
      figure.rotation.y=facing
      if(traveller){
        const clampedDt=Math.min(.12,Math.max(1e-4,dt))
        const accelPulse=(actualSpeed-prevSpeed)/clampedDt
        prevSpeed=actualSpeed
        const goalBank=grounded?THREE.MathUtils.clamp(-turnDiff*(actualSpeed/cfg.run)*.22,-.14,.14):0
        const goalStride=grounded?THREE.MathUtils.clamp(-accelPulse*.0018,-.06,.05):0
        bankLean=THREE.MathUtils.damp(bankLean,goalBank,12,clampedDt)
        strideLean=THREE.MathUtils.damp(strideLean,goalStride,14,clampedDt)
        traveller.rotation.z=bankLean
        traveller.rotation.x=strideLean
      }
      const moving=actualSpeed>.14||inputMag>.06
      const running=actualSpeed>5.8||(inputMag>.4&&maxSpeed===cfg.run&&actualSpeed>3.2)
      const clipKey=!grounded?'jump':!moving?'idle':running?'run':'walk'
      const nextAction=actions.get(avatar.clips[clipKey])
      if(nextAction){
        if(action!==nextAction){action?.fadeOut(.12);nextAction.reset().fadeIn(.12).play();action=nextAction}
        action.timeScale=clipKey==='walk'?THREE.MathUtils.clamp(actualSpeed/cfg.walk,.55,1.35):clipKey==='run'?THREE.MathUtils.clamp(actualSpeed/cfg.run,.65,1.25):1
      }
    }
    mixer.update(dt);follow(dt)
  }
  return {enter,leave,tick,spawns,probe,boatClearance,get freeMoorings(){return rides?.freeMoorings()??[]},get boatKind(){return rides?.freeKind??null},get obstacle(){return bikeObstacle},get vehicle(){return rides?.bike?'bike':rides?.boat?'boat':'foot'},get heading(){return rides?.heading??0},get speed(){return rides?.speed??0},get active(){return active},drive(x:number,z:number,run=true){external={x,z,run}},
    get yaw(){return yaw},hold(on:boolean){held=on;external=null;if(on){rides?.stop();vx=vz=0}},face(heading:number,tilt=cfg.pitch){yaw=heading;pitch=tilt;if(active)follow(0,true)},showFigure(on:boolean){figure.visible=on&&active},
    get position(){const pos=rides?.boat?.position??sim.body.translation();return posOut.set(pos.x,pos.y,pos.z)}}
}
