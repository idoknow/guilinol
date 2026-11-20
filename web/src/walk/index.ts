import * as THREE from 'three'
import R from '@dimforge/rapier3d-compat'
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js'
import type {PeaksGroup} from '../peaks'
import type {Manifest} from '../world'
import type {Stream} from '../stream'
import {walkInput} from '../ui/walk'
import {avatar} from '../look/avatar'
import {bikeConfig, carConfig, walkConfig as cfg, type EbikeUpgradeMods} from './config'
import {createPhysics} from './physics'
import {createCameraRig} from './camera'
import {look} from '../look/config'
import {createDriverPose} from './car'
import {createRiderPose,notifyDismountBlocked} from './ride'
import {createDynamicEbike,type EbikeModPreset} from './vehicle-model'
import {
  applyEbikeVisualAndRider,
  createEbikeFxController,
  RIDER_JOINT_NAMES,
  type EbikeCrashReason,
  type EbikeRideControlInput,
  type EbikeTelemetrySnapshot,
  type EbikeVehicleType,
  type ExternalEbikeTelemetry,
  type RiderJointName,
  type RiderJoints,
} from './ebike-fx'
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

  // Single-primitive glTF joint nodes (ThighL/R, ArmL/R) load as Mesh rather than Group; wrap them so joints stay live.
  const jointMeshes:THREE.Mesh[] = []
  root.traverse(n=>{
    if(n instanceof THREE.Mesh && !(n instanceof THREE.SkinnedMesh) && n.name && !n.name.startsWith('mesh_')) jointMeshes.push(n)
  })
  for(const m of jointMeshes) {
    const grp = new THREE.Group()
    grp.name = m.name
    grp.position.copy(m.position); grp.quaternion.copy(m.quaternion); grp.scale.copy(m.scale)
    const prim = new THREE.Mesh(m.geometry, m.material)
    prim.name = 'mesh_' + m.name
    grp.add(prim)
    for(const c of [...m.children]) grp.add(c)
    m.parent?.add(grp); m.parent?.remove(m)
  }
  root.updateMatrixWorld(true)

  const bones:THREE.Bone[] = []
  const boneInverses:THREE.Matrix4[] = []
  const boneIndex = new Map<THREE.Object3D,number>()
  const posList:number[] = [], normList:number[] = [], colList:number[] = []
  const skinIdx:number[] = [], skinWgt:number[] = []
  const oldMeshes:THREE.Mesh[] = []
  const v = new THREE.Vector3(), n = new THREE.Vector3(), col = new THREE.Color()
  const override = tintHex ? new THREE.Color(tintHex) : null
  let bindMinY = Infinity
  const shinVerts = new Map<THREE.Object3D, THREE.Vector3[]>()

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
    const isShin = joint.name === 'ShinL' || joint.name === 'ShinR'
    const invJoint = isShin ? joint.matrixWorld.clone().invert() : null
    const localPts = isShin ? (shinVerts.get(joint) ?? []) : null
    if(isShin && localPts && !shinVerts.has(joint)) shinVerts.set(joint, localPts)
    for(let i=0;i<pos.count;i++) {
      v.fromBufferAttribute(pos,i).applyMatrix4(node.matrixWorld)
      if(v.y < bindMinY) bindMinY = v.y
      if(localPts && invJoint) localPts.push(v.clone().applyMatrix4(invJoint))
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
  const footProbes: {joint:THREE.Object3D; points:THREE.Vector3[]}[] = []
  for(const [joint, pts] of shinVerts) {
    let minY = Infinity
    for(const p of pts) if(p.y < minY) minY = p.y
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
    for(const p of pts) if(p.y <= minY + .02) {
      if(p.x < minX) minX = p.x; if(p.x > maxX) maxX = p.x
      if(p.z < minZ) minZ = p.z; if(p.z > maxZ) maxZ = p.z
    }
    if(Number.isFinite(minX)) {
      footProbes.push({joint, points:[
        new THREE.Vector3(minX, minY, minZ), new THREE.Vector3(maxX, minY, minZ),
        new THREE.Vector3(minX, minY, maxZ), new THREE.Vector3(maxX, minY, maxZ),
      ]})
    }
  }
  if(!oldMeshes.length) {
    const box = new THREE.Box3().setFromObject(root, true)
    root.userData.footMetrics = {soleOffset: Number.isFinite(box.min.y) ? Math.max(0, -box.min.y) : 0, footProbes}
    return undefined
  }
  root.userData.footMetrics = {soleOffset: Number.isFinite(bindMinY) ? Math.max(0, -bindMinY) : 0, footProbes}
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
  const figure=model.scene,skinned=mergeAvatar(figure,avatar.color),traveller=figure.getObjectByName('Traveller'),ridePose=createRiderPose(figure),driverPose=createDriverPose(figure)
  const riderJoints=Object.fromEntries(RIDER_JOINT_NAMES.map(name=>[name,figure.getObjectByName(name)])) as RiderJoints
  const ebikeRig=createDynamicEbike(0)
  ebikeRig.root.visible=false
  scene.add(ebikeRig.root)
  const stuntMode=typeof location!=='undefined'&&new URLSearchParams(location.search).get('stunt')==='1'
  function ebikeModUpgrades(vType:EbikeVehicleType,preset:EbikeModPreset):EbikeUpgradeMods|null{
    if(vType==='shared'||preset==='stock')return null
    return preset==='ghostfire'?{motorLevel:1,controllerLevel:1,batteryLevel:1}:{motorLevel:2,controllerLevel:2,batteryLevel:2}
  }
  const ebikeFx=createEbikeFxController()
  const ZERO_RIDE_INPUT:EbikeRideControlInput={gearDelta:0,gearSelect:null,wheelie:false,tuck:false,recover:false,cycleMod:false}
  const ebikeMountStartPos=new THREE.Vector3(), ebikeMountStartRot=new Map<RiderJointName,[number,number,number]>()
  let ebikeMountStartYaw=0, ebikeMountElapsed=bikeConfig.mountDuration
  let mountedStaticBike:THREE.Object3D|null=null
  let ebikeState:EbikeTelemetrySnapshot|null=null
  function releaseDynamicBike(){
    if(mountedStaticBike){mountedStaticBike.visible=true;mountedStaticBike=null}
    ebikeRig.root.visible=false
    ebikeFx.reset()
    ebikeState=null
  }
  const footMetrics=(figure.userData.footMetrics as {soleOffset:number;footProbes:{joint:THREE.Object3D;points:THREE.Vector3[]}[]}|undefined)??{soleOffset:0,footProbes:[]}
  scene.add(figure);figure.visible=false;figure.scale.setScalar(avatar.scale)
  const soleOffset=footMetrics.soleOffset*avatar.scale, footTmp=new THREE.Vector3()
  const lmFloorCache=new WeakMap<THREE.Group,{grid:Map<string,number[]>;large:number[]}>()
  const _va=new THREE.Vector3(), _vb=new THREE.Vector3(), _vc=new THREE.Vector3(), _im=new THREE.Matrix4(), _inst=new THREE.Matrix4()
  function getLandmarkFloorGrid(root:THREE.Group){
    let cache=lmFloorCache.get(root)
    if(!cache){
      const grid=new Map<string,number[]>(), large:number[]=[]
      root.updateMatrixWorld(true)
      const target=root.getObjectByName('lod0')??root
      const addMeshTris=(pos:THREE.BufferAttribute|THREE.InterleavedBufferAttribute,idx:THREE.TypedArray|undefined,mat:THREE.Matrix4)=>{
        const triCount=idx?idx.length/3:pos.count/3
        for(let t=0;t<triCount;t++){
          const i0=idx?idx[t*3]:t*3, i1=idx?idx[t*3+1]:t*3+1, i2=idx?idx[t*3+2]:t*3+2
          _va.fromBufferAttribute(pos,i0).applyMatrix4(mat)
          _vb.fromBufferAttribute(pos,i1).applyMatrix4(mat)
          _vc.fromBufferAttribute(pos,i2).applyMatrix4(mat)
          const e1x=_vb.x-_va.x, e1y=_vb.y-_va.y, e1z=_vb.z-_va.z
          const e2x=_vc.x-_va.x, e2y=_vc.y-_va.y, e2z=_vc.z-_va.z
          const nx=e1y*e2z-e1z*e2y, ny=e1z*e2x-e1x*e2z, nz=e1x*e2y-e1y*e2x
          const len=Math.hypot(nx,ny,nz)
          if(len<1e-6||Math.abs(ny)/len<.7)continue
          const gx0=Math.floor(Math.min(_va.x,_vb.x,_vc.x)/4), gx1=Math.floor(Math.max(_va.x,_vb.x,_vc.x)/4)
          const gz0=Math.floor(Math.min(_va.z,_vb.z,_vc.z)/4), gz1=Math.floor(Math.max(_va.z,_vb.z,_vc.z)/4)
          if((gx1-gx0+1)*(gz1-gz0+1)>16){
            large.push(_va.x,_va.y,_va.z,_vb.x,_vb.y,_vb.z,_vc.x,_vc.y,_vc.z)
            continue
          }
          for(let gx=gx0;gx<=gx1;gx++)for(let gz=gz0;gz<=gz1;gz++){
            const k=`${gx},${gz}`
            let bucket=grid.get(k)
            if(!bucket){bucket=[];grid.set(k,bucket)}
            bucket.push(_va.x,_va.y,_va.z,_vb.x,_vb.y,_vb.z,_vc.x,_vc.y,_vc.z)
          }
        }
      }
      target.traverse(node=>{
        if(!(node instanceof THREE.Mesh))return
        let p:THREE.Object3D|null=node
        while(p&&p!==root){if(/^collision/i.test(p.name))return;p=p.parent}
        if(/^collision/i.test(node.name))return
        const pos=node.geometry.getAttribute('position'); if(!pos)return
        const idx=(node.geometry.userData.fullIndex as THREE.TypedArray|undefined)??node.geometry.index?.array
        if(node instanceof THREE.InstancedMesh){
          for(let i=0;i<node.count;i++){node.getMatrixAt(i,_inst);_im.multiplyMatrices(node.matrixWorld,_inst);addMeshTris(pos,idx,_im)}
        }else addMeshTris(pos,idx,node.matrixWorld)
      })
      cache={grid,large}
      lmFloorCache.set(root,cache)
    }
    return cache
  }
  function sampleFloorTris(tris:number[],x:number,z:number,baseY:number,best:number){
    for(let i=0;i<tris.length;i+=9){
      const ax=tris[i],ay=tris[i+1],az=tris[i+2],bx=tris[i+3],by=tris[i+4],bz=tris[i+5],cx2=tris[i+6],cy=tris[i+7],cz2=tris[i+8]
      const det=(bx-ax)*(cz2-az)-(cx2-ax)*(bz-az)
      if(Math.abs(det)<1e-6)continue
      const w1=((x-ax)*(cz2-az)-(cx2-ax)*(z-az))/det, w2=((bx-ax)*(z-az)-(x-ax)*(bz-az))/det
      if(w1<-1e-3||w2<-1e-3||w1+w2>1+1e-3)continue
      const y=ay+w1*(by-ay)+w2*(cy-ay)
      if(y>best&&y<=baseY+.15)best=y
    }
    return best
  }
  function visualFloorAt(x:number,z:number,baseY:number){
    let best=baseY
    const cellKey=`${Math.floor(x/4)},${Math.floor(z/4)}`
    for(const [entry,root] of stream.landmarks){
      if(!root.visible)continue
      const [cx,,cz,r]=entry.sphere, a=entry.rotation*Math.PI/180
      const ex=entry.position[0]+cx*Math.cos(a)+cz*Math.sin(a)
      const ez=entry.position[2]-cx*Math.sin(a)+cz*Math.cos(a)
      if(Math.hypot(ex-x,ez-z)>r+2)continue
      const {grid,large}=getLandmarkFloorGrid(root)
      const tris=grid.get(cellKey)
      if(tris)best=sampleFloorTris(tris,x,z,baseY,best)
      if(large.length)best=sampleFloorTris(large,x,z,baseY,best)
    }
    return best
  }
  function liveSoleLocalY(){
    if(!footMetrics.footProbes.length)return -soleOffset
    let minY=Infinity
    for(const entry of footMetrics.footProbes){
      for(const pt of entry.points){
        footTmp.copy(pt)
        let cur:THREE.Object3D|null=entry.joint
        while(cur&&cur!==figure){cur.updateMatrix();footTmp.applyMatrix4(cur.matrix);cur=cur.parent}
        const y=footTmp.y*figure.scale.y
        if(y<minY)minY=y
      }
    }
    return Number.isFinite(minY)?minY:-soleOffset
  }
  function applyFootController(){
    sim.controller.enableAutostep(cfg.step,cfg.stepWidth,false)
    sim.controller.setMaxSlopeClimbAngle(cfg.slope)
    sim.controller.setMinSlopeSlideAngle(cfg.slope)
  }
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
    return validDeck??sim.surface(x,z,'sidewalk')??sim.surface(x,z,'road')??sim.surface(x,z,'ground')
  }
  function carSupportAt(x:number,z:number,refY:number){
    const deck=sim.surface(x,z,'deck',refY+.55,1.8)
    const validDeck=deck&&deck.y<=refY+.55?deck:null
    const lm=sim.surface(x,z,'landmark',refY+.55,1.8)
    const validLm=lm&&lm.y<=refY+.55&&lm.slope<=cfg.slope?lm:null
    const bridgeHit=validDeck&&validLm?(validLm.y>validDeck.y?validLm:validDeck):(validDeck??validLm)
    return bridgeHit??sim.surface(x,z,'road')??sim.surface(x,z,'ground')??sim.surface(x,z,'sidewalk')
  }
  function loadRides(){if(loading||rides||!active||!manifest.vehicles)return;loading=true
    const file=manifest.vehicles.file
    void import('./vehicles').then(module=>module.vehicles(scene,file,(x,z,bikeHeading,bikeY,kind)=>{sim.sync(x,z)
      if(bikeHeading===undefined)return place(x,z,'dismount')
      if(kind==='car'){
        const carY=bikeY??safe.y-cfg.height/2
        const found=sim.findCarDismount(x,z,bikeHeading,carY)
        if(!found){notifyDismountBlocked();return false}
        const prevCarPos=new THREE.Vector3(x,carY,z)
        if(!place(x,z,'dismount',true,found))return false
        facing=bikeHeading+avatar.yaw
        driverPose.startDismount(prevCarPos,bikeHeading,active);input.clearRun();return true
      }
      const found=sim.findLocalDismount(x,z,bikeHeading,bikeY??safe.y-cfg.height/2)
      if(!found){notifyDismountBlocked();return false}
      const prevFoot=figure.position.clone(),prevYaw=figure.rotation.y
      if(!place(x,z,'dismount',true,found))return false
      releaseDynamicBike();input.syncRideHud(null,null)
      facing=bikeHeading+avatar.yaw
      ridePose.startDismount(prevFoot,prevYaw);input.clearRun();return true
    },(bx,by,bz,kind)=>{sim.sync(bx,bz)
      const cur=sim.body.translation()
      if(kind==='car'){
        const check=sim.findCarMount(cur.x,cur.y-cfg.height/2,cur.z,bx,by,bz)
        if(!check.ok){notifyDismountBlocked(check.reason==='blocked'?'中间有遮挡，绕过去再上车':'这里太窄了，换个角度上车');return null}
        return check
      }
      const check=sim.findLocalMount(cur.x,cur.y-cfg.height/2,cur.z,bx,by,bz)
      if(!check.ok){notifyDismountBlocked(check.reason==='blocked'?'中间有遮挡，绕过去再骑':'这里太窄了，挪一挪再骑');return null}
      return check
    },{sim,stream,landFree:spot=>{sim.sync(spot.x,spot.z)
      const prevBoatPos=figure.position.clone(),prevBoatYaw=figure.rotation.y
      if(sim.insideHouse(spot.x,spot.z)||!sim.freeCapsule(spot.x,spot.y,spot.z)||!place(spot.x,spot.z,spot.rule,true,spot))return false
      rides?.clearBoatPose(figure);boatLandFrom.copy(prevBoatPos);boatLandYaw=prevBoatYaw;boatLandElapsed=0;boatBoardElapsed=BOAT_BOARD_DUR
      facing=spot.heading+avatar.yaw;figure.rotation.y=facing;wasBoat=false;input.clearRun();follow(0,false);return true}})).then(loaded=>{rides=loaded;rides.show(active)
      if(active){const p=sim.body.translation();sim.sync(p.x,p.z);loaded.nearby(p.x,p.z,p.y-cfg.height/2)}})
      .catch(error=>console.warn('Vehicles unavailable:',error)).finally(()=>{loading=false})}
  const BOAT_BOARD_DUR=.24, BOAT_LAND_DUR=.20
  const boatBoardFrom=new THREE.Vector3(), boatLandFrom=new THREE.Vector3()
  let boatBoardElapsed=BOAT_BOARD_DUR, boatBoardYaw=0, boatLandElapsed=BOAT_LAND_DUR, boatLandYaw=0
  let wasBoat=false,wasBike=false,wasCar=false,bikeObstacle=''
  function place(x:number,z:number,reason:string,override=false,prefound?:ReturnType<typeof sim.findWalkableSpawn>){const found=prefound??sim.findWalkableSpawn(x,z,override)
    if(verify)spawns.push({reason,from:[x,z],to:found?[found.x,found.z]:null,distance:found?Math.hypot(found.x-x,found.z-z):null,rule:found?.rule??'none'})
    if(!found)return false
    sim.body.setTranslation(found,true);sim.body.setNextKinematicTranslation(found);sim.world.step();safe.set(found.x,found.y,found.z);resetMotion();return true}
  let destination:THREE.Vector3|null=null
  async function enter(x:number,z:number,heading:number,reason:string,override=false){
    const target=new THREE.Vector3(x,0,z);destination=target
    stream.prioritize(x,z)
    const needed=manifest.chunks.filter(tile=>Math.hypot(Math.max(0,Math.abs(x-tile.x-128)-128),Math.max(0,Math.abs(z-tile.z-128)-128))<=cfg.search)
    // Register nearby collision surfaces before placing the capsule. The palace
    // forecourt is a 17 cm slab above GL04, and can stream in under a new walker.
    const supports=(manifest.landmarks??[]).filter(entry=>{
      if(entry.collision==='none')return false
      const [cx,,cz,r]=entry.sphere, a=entry.rotation*Math.PI/180
      const ex=entry.position[0]+cx*Math.cos(a)+cz*Math.sin(a)
      const ez=entry.position[2]-cx*Math.sin(a)+cz*Math.cos(a)
      return Math.hypot(ex-x,ez-z)<=r+cfg.search
    })
    const deadline=performance.now()+15000
    while((needed.some(tile=>!stream.loaded.has(tile))||supports.some(entry=>!stream.landmarks.has(entry)))&&performance.now()<deadline){
      if(destination!==target)return false
      target.y=0;stream.tick(target)
      for(const entry of supports)if(!stream.landmarks.has(entry)){
        target.y=entry.position[1];stream.updateLandmarks?.(target,entry)
      }
      await new Promise(resolve=>setTimeout(resolve,12))
    }
    if(destination!==target)return false
    destination=null
    if(needed.some(tile=>!stream.loaded.has(tile))||supports.some(entry=>!stream.landmarks.has(entry)))return false
    sim.sync(x,z);if(!place(x,z,reason,override)){window.dispatchEvent(new CustomEvent('walk:spawn-failed',{detail:{x,z,reason:'no-walkable-support'}}));return false}
    active=true;rides?.show(true);requestAnimationFrame(()=>requestAnimationFrame(loadRides));figure.visible=true
    yaw=heading;facing=yaw+avatar.yaw;figure.rotation.y=facing;input.show(true);accumulator=0;rig.reset(arm)
    camera.near=.08;camera.updateProjectionMatrix();follow(0,true);return true
  }
  function leave(){destination=null;active=false;releaseDynamicBike();input.syncRideHud(null,null);rides?.clearBoatPose(figure);rides?.show(false);if(wasCar||wasBike)applyFootController();wasBoat=wasBike=wasCar=false;bikeObstacle='';boatBoardElapsed=BOAT_BOARD_DUR;boatLandElapsed=BOAT_LAND_DUR;ridePose.reset();driverPose.reset(false);resetMotion();figure.visible=false;input.show(false);external=null;sim.clear();camera.near=1;camera.updateProjectionMatrix()}
  function follow(dt=0,snap=false){const pos=sim.body.translation(),footY=pos.y-cfg.height/2
    figure.position.set(pos.x,footY,pos.z)
    if(rides?.boat){
      const seatX=rides.boat.position.x, seatY=rides.boat.position.y+rides.boatSeatOffset, seatZ=rides.boat.position.z
      if(rides.freeBoat&&boatBoardElapsed<BOAT_BOARD_DUR){
        if(dt>0)boatBoardElapsed=Math.min(BOAT_BOARD_DUR,boatBoardElapsed+Math.min(.12,dt))
        const u=Math.min(1,boatBoardElapsed/BOAT_BOARD_DUR), t=u*u*(3-2*u)
        figure.position.set(
          THREE.MathUtils.lerp(boatBoardFrom.x,seatX,t),
          Math.min(seatY+.06,THREE.MathUtils.lerp(boatBoardFrom.y,seatY,t)+Math.sin(t*Math.PI)*.08),
          THREE.MathUtils.lerp(boatBoardFrom.z,seatZ,t),
        )
        figure.rotation.y=boatBoardYaw+shortestAngle(boatBoardYaw,rides.heading)*t
      }else{
        figure.position.set(seatX,seatY,seatZ);figure.rotation.y=rides.heading
      }
    }
    if(rides?.car){
      const fx=-Math.sin(rides.heading),fz=-Math.cos(rides.heading),baseY=footY
      const cSup=carSupportAt(pos.x,pos.z,baseY)
      const groundY=cSup&&baseY-cSup.y<=.16&&baseY>=cSup.y-.08?cSup.y:baseY-.03
      figure.position.y=groundY
      if(dt>0){
        const halfWb=carConfig.wheelbase*.5
        const fSup=carSupportAt(pos.x+fx*halfWb,pos.z+fz*halfWb,groundY)
        const bSup=carSupportAt(pos.x-fx*halfWb,pos.z-fz*halfWb,groundY)
        rides.setCarPitch(fSup?.y,bSup?.y,dt)
      }
      rides.park(figure.position)
      driverPose.updateDriving(figure.position,rides.heading,active)
      input.syncRideHud(null,'car')
    }else if(rides?.bike){
      const fx=-Math.sin(rides.heading),fz=-Math.cos(rides.heading),baseY=footY
      const cSup=supportAt(pos.x,pos.z,baseY)
      const groundY=cSup&&baseY-cSup.y<=.12&&baseY>=cSup.y-.05?cSup.y:baseY-.03
      figure.position.y=groundY
      if(dt>0){
        const fSup=supportAt(pos.x+fx*.55,pos.z+fz*.55,groundY)
        const bSup=supportAt(pos.x-fx*.55,pos.z-fz*.55,groundY)
        rides.setPitch(fSup?.y,bSup?.y,dt)
      }
      rides.park(figure.position)
      if(rides.rideKind==='bike'){
        ebikeState ??= ebikeFx.step(0,{speed:rides.speed,heading:rides.heading,lean:rides.lean,steerInput:rides.steerInput,braking:false,obstacle:'',allowAutoCrash:false},ZERO_RIDE_INPUT)
        if(mountedStaticBike!==rides.bike){
          if(mountedStaticBike)mountedStaticBike.visible=true
          mountedStaticBike=rides.bike
        }
        mountedStaticBike.visible=false
        ebikeRig.root.visible=true
        if(dt>0&&ebikeMountElapsed<bikeConfig.mountDuration)ebikeMountElapsed=Math.min(bikeConfig.mountDuration,ebikeMountElapsed+Math.min(.12,dt))
        const u=THREE.MathUtils.clamp(ebikeMountElapsed/bikeConfig.mountDuration,0,1), mountBlend=u*u*(3-2*u)
        applyEbikeVisualAndRider({
          figure,
          joints:riderJoints,
          rig:ebikeRig,
          basePos:figure.position,
          heading:rides.heading,
          groundPitch:rides.pitch,
          snapMountBlend:mountBlend,
          mountStartPos:ebikeMountStartPos,
          mountStartYaw:ebikeMountStartYaw,
          mountStartRot:ebikeMountStartRot,
          fx:ebikeFx,
          state:ebikeState,
          dt,
          supportY:(sx,sz,refY)=>supportAt(sx,sz,refY)?.y??refY,
        })
        input.syncRideHud(ebikeState,'bike')
      }else{
        releaseDynamicBike()
        ridePose.updateRiding(figure.position,rides.heading,rides.lean,rides.pitch,rides.speed,rides.steerInput,dt,rides.rideKind??'bike',rides.bike)
        input.syncRideHud({
          vehicleType:'normal',vehicleLabel:'单车',vehicleBadge:'单车',
          gear:1,gearLabel:'人力',maxKmh:18,speed:rides.speed,kmh:Math.round(Math.abs(rides.speed)*3.6),
          battery:100,lowBattery:false,criticalBattery:false,batteryDepleted:false,
          lean:rides.lean,leanLimit:.45,wheelie:0,steerInput:rides.steerInput,
          tucking:false,braking:false,crashPhase:'none',crashReason:'',crashSide:1,crashElapsed:0,recoverProgress:0,modPreset:'stock',
        },'bicycle')
      }
    }else if(!rides?.boat){
      releaseDynamicBike()
      input.syncRideHud(null,null)
      const liveMinY=liveSoleLocalY()
      const animLift=Math.max(soleOffset,-liveMinY)
      const surf=(grounded||Math.abs(velocity)<.05)?sim.groundSurface(pos.x,pos.z,footY):null
      const rawBase=surf&&Math.abs(surf.y-(footY-cfg.skin))<=.14?surf.y:footY-cfg.skin
      const baseY=(grounded||Math.abs(velocity)<.05)?visualFloorAt(pos.x,pos.z,rawBase):rawBase
      figure.position.y=baseY+(grounded||Math.abs(velocity)<.05?animLift:soleOffset)
      rides?.park(figure.position)
      ridePose.applyDismount(figure.position,facing,dt)
      driverPose.applyDismount(figure.position,facing,dt)
      if(!rides?.boat&&boatLandElapsed<BOAT_LAND_DUR){
        if(dt>0)boatLandElapsed=Math.min(BOAT_LAND_DUR,boatLandElapsed+Math.min(.12,dt))
        const u=Math.min(1,boatLandElapsed/BOAT_LAND_DUR), t=u*u*(3-2*u)
        figure.position.lerpVectors(boatLandFrom,figure.position,t)
        figure.position.y+=Math.sin(t*Math.PI)*.10
        figure.rotation.y=boatLandYaw+shortestAngle(boatLandYaw,facing)*t
      }
    }
    rig.update(camera,figure.position,yaw,pitch,arm+ridePose.cameraArm(!!rides?.bike,dt,snap)+driverPose.cameraArm(!!rides?.car,dt,snap),dt,snap)
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
  function sit(){mixer.stopAllAction();action=undefined;bankLean=strideLean=0;wasBike=false;if(traveller)traveller.rotation.set(0,0,0);ridePose.reset()
    for(const side of ['L','R'])for(const [part,value] of Object.entries({Thigh:1.25,Shin:-1.4,Arm:.9,Forearm:.35})){
      const joint=figure.getObjectByName(part+side);if(joint)joint.rotation.x=value}}
  function probe(){const pos=sim.body.translation(),foot=pos.y-cfg.height/2,peak=sim.surface(pos.x,pos.z,'peak')
    const tile=sim.tileAt(pos.x,pos.z),mesh=tile&&stream.loaded.get(tile)?.groundMesh
    terrainRay.ray.origin.set(pos.x,4000,pos.z);mesh?.updateWorldMatrix(true,false)
    const renderY=mesh?terrainRay.intersectObject(mesh,false)[0]?.point.y:undefined
    const surf=sim.groundSurface(pos.x,pos.z,foot), soleY=figure.position.y+liveSoleLocalY()
    const surfaceY=surf?visualFloorAt(pos.x,pos.z,surf.y):undefined, footSink=surfaceY!==undefined?surfaceY-soleY:0
    return {x:pos.x,z:pos.z,foot,renderY,renderClearance:foot-(renderY??Infinity),clearance:foot-(sim.surface(pos.x,pos.z,'ground')?.y??Infinity),soleY,surfaceY,surfaceKind:surf?.kind,footSink,inHouse:sim.insideHouse(pos.x,pos.z)||sim.overlaps('building'),
      inPeak:!!peak&&peak.y>foot+.3||sim.overlaps('peak'),deck:sim.surface(pos.x,pos.z,'deck')?.y,wet:sim.wet(pos.x,pos.z),blockedWater,resets,steps,physicsMs,elapsed,hits:lastHits,
      planarSpeed:Math.hypot(vx,vz),grounded,verticalVelocity:velocity,facing,figPos:figure.position.toArray(),figYaw:figure.rotation.y,bikePitch:rides?.bikePitch??0,bikeY:rides?.bikeY??0,carPitch:rides?.carPitch??0,carY:rides?.carY??0,
      pedalPhase:ridePose.pedalPhase,thighL:figure.getObjectByName('ThighL')?.rotation.x??0,thighR:figure.getObjectByName('ThighR')?.rotation.x??0,
      ebike:ebikeState,
      ebikeRig:ebikeRig.root.visible?{
        wheelie:ebikeRig.wheeliePivot.rotation.x,
        lean:ebikeRig.leanPivot.rotation.z,
        crashRoll:ebikeRig.crashPivot.rotation.z,
        steer:ebikeRig.frontAssembly.rotation.y,
        frontWheelSpin:ebikeRig.frontWheel.rotation.x,
        rearWheelSpin:ebikeRig.rearWheel.rotation.x,
        seatWorld:ebikeRig.seatAnchor.getWorldPosition(new THREE.Vector3()).toArray(),
      }:null,
      camDist:rig.distance,camClipped:rig.clipped,camBlocked:rig.blocked,camCeiling:rig.ceilingClearance,camInHouse:sim.insideHouse(camera.position.x,camera.position.z,camera.position.y),
      boat:rides?.boatProbe()??null}}
  function tick(dt:number){if(!active)return;const before=performance.now(),start=rides?.boat?.position??sim.body.translation();sim.sync(start.x,start.z);rides?.nearby(start.x,start.z,rides?.boat?start.y:start.y-cfg.height/2)
    if(rides?.freeBoat){
      releaseDynamicBike();input.syncRideHud(null,'boat')
      const read=held?still:input.read(), firstFrame=!wasBoat
      if(firstFrame){boatBoardFrom.copy(figure.position);boatBoardYaw=figure.rotation.y;boatBoardElapsed=0;boatLandElapsed=BOAT_LAND_DUR
        mixer.stopAllAction();action=undefined;bankLean=strideLean=0
        if(wasCar||wasBike)applyFootController()
        wasBike=wasCar=false;if(traveller)traveller.rotation.set(0,0,0);ridePose.reset();driverPose.reset(active);input.clearRun()}
      const prevHeading=rides.heading
      if(!held)rides.steerBoat(read.forward,read.right,Math.min(.12,dt))
      if(boatBoardElapsed<BOAT_BOARD_DUR)yaw+=shortestAngle(yaw,rides.heading)*(1-Math.exp(-12*Math.min(.12,Math.max(1/60,dt))))
      else yaw+=rides.heading-prevHeading
      rides.poseBoat(figure,read.forward,read.right,Math.min(.12,dt))
      const bpos=rides.freeBoat.position, bp=rides.boatProbe(), wy=bp?bp.y:bpos.y
      sim.body.setTranslation({x:bpos.x,y:wy+cfg.height/2,z:bpos.z},true)
      sim.body.setNextKinematicTranslation({x:bpos.x,y:wy+cfg.height/2,z:bpos.z})
      wasBoat=true;follow(dt,false);return
    }
    if(rides?.boat){releaseDynamicBike();input.syncRideHud(null,'boat');if(!held)rides.advance(Math.min(.25,dt));if(!wasBoat){if(wasCar||wasBike){applyFootController();wasCar=wasBike=false;driverPose.reset(active)}yaw=rides.heading+.95;sit()}wasBoat=!!rides.boat;follow(dt);return}wasBoat=false
    const read=input.read(),keys=held?still:read
    const rideCtrl=held?ZERO_RIDE_INPUT:input.readRideControls()
    wish.set(keys.right*Math.cos(yaw)-keys.forward*Math.sin(yaw),-keys.forward*Math.cos(yaw)-keys.right*Math.sin(yaw))
    if(external)wish.set(external.x,external.z)
    const rawLen=wish.length(), inputMag=Math.min(1,rawLen)
    if(rawLen>1e-5)wish.divideScalar(rawLen);else wish.set(0,0)
    const maxSpeed=(external?external.run:keys.run)?cfg.run:cfg.walk
    const step=1/60;let traveled=0,simSteps=0;lastHits=[];blockedWater=false
    let bikeSpeed=(rides?.car||rides?.bike)?rides.speed:0
    if((wasCar&&!rides?.car)||(wasBike&&!rides?.bike)){
      applyFootController()
      if(wasCar&&!rides?.car)figure.visible=active
      if(wasBike&&!rides?.bike){releaseDynamicBike();input.syncRideHud(null,rides?.car?'car':null)}
    }
    if(rides?.car&&!wasCar){
      const cx=rides.car.position.x,cz=rides.car.position.z,cur=sim.body.translation()
      sim.sync(cx,cz)
      const sup=carSupportAt(cx,cz,rides.car.position.y)
      const cy=sup?sup.y:rides.car.position.y
      driverPose.startMount({x:cur.x,y:cur.y-cfg.height/2,z:cur.z},figure.rotation.y)
      sim.controller.enableAutostep(.10,.12,false)
      sim.controller.setMaxSlopeClimbAngle(carConfig.maxSlope)
      sim.controller.setMinSlopeSlideAngle(carConfig.maxSlope)
      const dest={x:cx,y:cy+cfg.height/2+.055,z:cz}
      sim.body.setTranslation(dest,true);sim.body.setNextKinematicTranslation(dest);sim.world.step()
      safe.set(dest.x,dest.y,dest.z);resetMotion();input.clearRun()
      mixer.stopAllAction();action=undefined;bikeObstacle='';bikeSpeed=0
    }
    if(rides?.bike&&!wasBike){
      const bx=rides.bike.position.x,bz=rides.bike.position.z,cur=sim.body.translation()
      sim.sync(bx,bz)
      const sup=supportAt(bx,bz,rides.bike.position.y)
      const by=sup?sup.y:rides.bike.position.y
      ridePose.startMount({x:cur.x,y:cur.y-cfg.height/2,z:cur.z},figure.rotation.y)
      if(rides.rideKind==='bike'){
        ebikeMountStartPos.set(cur.x,cur.y-cfg.height/2,cur.z)
        ebikeMountStartYaw=figure.rotation.y
        ebikeMountElapsed=0
        for(const name of RIDER_JOINT_NAMES){
          const r=riderJoints[name]?.rotation
          ebikeMountStartRot.set(name,r?[r.x,r.y,r.z]:[0,0,0])
        }
        const vType:EbikeVehicleType=rides.vehicleType??(rides.isShared||rides.bike.userData.shared?'shared':'normal')
        const savedBat=(rides.bike.userData.battery as number|undefined)??rides.ebikeBattery??100
        const savedMod:EbikeModPreset=vType==='shared'?'stock':((rides.bike.userData.modPreset as EbikeModPreset|undefined)??'stock')
        ebikeFx.resetForMount(vType,savedBat)
        ebikeFx.setModPreset(savedMod)
        rides.setEbikeUpgrades(ebikeModUpgrades(vType,ebikeFx.modPreset))
        mountedStaticBike=rides.bike
        mountedStaticBike.visible=false
        ebikeRig.root.visible=true
        const paint=(mountedStaticBike.userData.paint as number|undefined)??0
        ebikeRig.setVehicleType(vType,paint)
        ebikeRig.applyMods(ebikeFx.customMods??ebikeFx.modPreset,paint)
      }
      sim.controller.enableAutostep(bikeConfig.step,cfg.stepWidth,false)
      sim.controller.setMaxSlopeClimbAngle(bikeConfig.maxSlope)
      sim.controller.setMinSlopeSlideAngle(bikeConfig.maxSlope)
      const dest={x:bx,y:by+cfg.height/2+.055,z:bz}
      sim.body.setTranslation(dest,true);sim.body.setNextKinematicTranslation(dest);sim.world.step()
      safe.set(dest.x,dest.y,dest.z);resetMotion();input.clearRun()
      mixer.stopAllAction();action=undefined;bikeObstacle='';bikeSpeed=0
    }
    wasCar=!!rides?.car
    wasBike=!!rides?.bike
    if(wasBike&&rides?.bike&&rides.rideKind==='bike'){
      if(rideCtrl.gearSelect!==null)rides.setEbikeGear(rideCtrl.gearSelect)
      else if(rideCtrl.gearDelta!==0)rides.shiftEbikeGear(rideCtrl.gearDelta)
    }
    const aboardGround=wasCar||wasBike
    if(keys.jump&&!aboardGround)jumpTimer=cfg.jumpBuffer
    accumulator+=Math.min(.12,dt)
    while(accumulator>=step-1e-7){accumulator=Math.max(0,accumulator-step);steps++;simSteps++;elapsed+=step
      if(grounded)coyoteTimer=cfg.coyote;else coyoteTimer=Math.max(0,coyoteTimer-step)
      if(!aboardGround&&jumpTimer>0&&coyoteTimer>0){
        velocity=Math.sqrt(-2*cfg.gravity*cfg.jump)
        grounded=false;coyoteTimer=0;jumpTimer=0;setSnap(false)
      }else jumpTimer=Math.max(0,jumpTimer-step)
      if(velocity<=0)setSnap(true)

      if(wasCar&&rides?.car){
        const previous=rides.heading
        driverPose.advanceMount(step)
        bikeSpeed=rides.steerCar(keys.forward,keys.right,step,driverPose.mounted)
        wish.set(-Math.sin(rides.heading),-Math.cos(rides.heading))
        if(driverPose.mounted)yaw+=rides.heading-previous
        else yaw+=shortestAngle(yaw,rides.heading)*(1-Math.exp(-10*step))
        vx=wish.x*bikeSpeed;vz=wish.y*bikeSpeed
      }else if(wasBike&&rides?.bike){
        const previous=rides.heading
        ridePose.advanceMount(step)
        const locked=rides.rideKind==='bike'&&ebikeFx.crashPhase!=='none'
        if(locked)rides.stop()
        const stepCtrl=rides.rideKind==='bike'&&!locked
          ?{wheelie:rideCtrl.wheelie?Math.max(ebikeState?.wheelie??0,.55):(ebikeState?.wheelie??0),tuck:rideCtrl.tuck}
          :undefined
        bikeSpeed=rides.steer(locked?0:keys.forward,locked?0:keys.right,step,ridePose.mounted&&!locked,stepCtrl)
        wish.set(-Math.sin(rides.heading),-Math.cos(rides.heading))
        if(ridePose.mounted&&!locked)yaw+=rides.heading-previous
        else if(!locked)yaw+=shortestAngle(yaw,rides.heading)*(1-Math.exp(-10*step))
        vx=wish.x*bikeSpeed;vz=wish.y*bikeSpeed
      }else if(!aboardGround){
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
      const stepDx=(aboardGround?wish.x*bikeSpeed:vx)*step, stepDz=(aboardGround?wish.y*bikeSpeed:vz)*step
      sim.controller.computeColliderMovement(sim.capsule,{x:stepDx,y:velocity*step,z:stepDz})
      const move=sim.controller.computedMovement(),next={x:pos.x+move.x,y:pos.y+move.y,z:pos.z+move.z}
      const nowGrounded=sim.controller.computedGrounded()
      if(velocity<=0){
        if(nowGrounded){grounded=true;velocity=0}
        else if(move.y>velocity*step*.25&&Math.abs(move.y)<.005){
          const ledge=sim.groundSurface(next.x,next.z,next.y-cfg.height/2)
          if(ledge&&(next.y-cfg.height/2)-ledge.y<=.14){grounded=true;velocity=0}
          else{grounded=false;velocity=Math.max(velocity,-2)}
        }else grounded=false
      }else if(move.y<velocity*step*.25)velocity=0
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
      if(rides?.car){
        const res=rides.resolveCarMove({
          pos,next,move,heading:rides.heading,speed:bikeSpeed,step,
          motorPavement:rides.motorPavement,insideHouse:sim.insideHouse,
          carBlockedAt:(x,footY,z,hdg,sgn)=>sim.carOverlap(x,footY,z,hdg,sgn),
          collisionKind:(dirX,dirZ)=>{
            let hit:''|'collision'|'building'=''
            const footY=next.y-cfg.height/2
            for(let at=0;at<sim.controller.numComputedCollisions();at++){
              const contact=sim.controller.computedCollision(at)
              if(!contact||contact.normal1.y>=Math.cos(carConfig.maxSlope))continue
              if(contact.normal1.x*dirX+contact.normal1.z*dirZ>=-.2)continue
              const kind=contact.collider?sim.kinds.get(contact.collider.handle):undefined
              if((kind==='deck'||kind==='deckThin'||kind==='ground'||kind==='sidewalk'||kind==='road')&&contact.witness1.y<=footY+.15)continue
              if(kind==='building')return 'building'
              hit='collision'
            }
            return hit
          },
          stopCar:()=>rides!.stop(),
          dampCar:s=>rides!.dampCarSpeed(s),
        })
        bikeSpeed=res.speed
        if(res.blocked){bikeObstacle=res.reason;vx=vz=0}
        else{vx=wish.x*bikeSpeed;vz=wish.y*bikeSpeed;if(Math.abs(bikeSpeed)>.15)bikeObstacle=''}
      }
      else if(rides?.bike){
        const res=rides.resolveMove({
          pos,next,move,heading:rides.heading,speed:bikeSpeed,step,
          pavement:rides.pavement,insideHouse:sim.insideHouse,
          blockedAt:(x,y,z)=>sim.isBlockedAt(x,y,z),
          collisionKind:(dirX,dirZ)=>{
            let hit:''|'collision'|'building'=''
            const footY=next.y-cfg.height/2
            for(let at=0;at<sim.controller.numComputedCollisions();at++){
              const contact=sim.controller.computedCollision(at)
              if(!contact||contact.normal1.y>=Math.cos(bikeConfig.maxSlope))continue
              if(contact.normal1.x*dirX+contact.normal1.z*dirZ>=-.2)continue
              const kind=contact.collider?sim.kinds.get(contact.collider.handle):undefined
              if(kind==='sidewalk'||kind==='road')continue
              if((kind==='deck'||kind==='deckThin'||kind==='ground'||kind==='landmark')&&contact.witness1.y<=footY+bikeConfig.step+.05)continue
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
          if(dot<0){
            const stepInto=stepDx*ux+stepDz*uz, moveInto=move.x*ux+move.z*uz
            if(moveInto>stepInto*.5){vx-=dot*ux;vz-=dot*uz}
          }
        }
      }
      traveled+=Math.hypot(next.x-pos.x,next.z-pos.z);sim.body.setNextKinematicTranslation(next);sim.world.step();if(grounded&&!blockedWater)safe.set(next.x,next.y,next.z)
    }
    physicsMs+=performance.now()-before
    if(wasBike&&rides?.bike&&rides.rideKind==='bike'){
      const p=sim.body.translation()
      const refY=p.y-cfg.height/2
      const prevCrashPhase=ebikeFx.crashPhase
      if(rideCtrl.cycleMod){
        const nextPreset=ebikeFx.cycleModPreset()
        rides.setEbikeUpgrades(ebikeModUpgrades(ebikeFx.vehicleType,nextPreset))
        ebikeRig.applyMods(ebikeFx.customMods??nextPreset,(mountedStaticBike?.userData.paint as number|undefined)??0)
        if(mountedStaticBike)mountedStaticBike.userData.modPreset=nextPreset
      }
      const rawTel=rides.ebikeTelemetry
      const extTel:ExternalEbikeTelemetry|undefined=rawTel?{
        vehicleType:rawTel.vehicleType,
        isShared:rawTel.isShared,
        gear:rawTel.gear,
        gearLabel:rawTel.gearLabel,
        maxKmh:rawTel.maxKmh,
        battery:rawTel.batteryPct,
        lowBattery:rawTel.lowBattery,
        criticalBattery:rawTel.criticalBattery,
        batteryDepleted:rawTel.batteryDepleted,
        lean:rawTel.lean,
        leanLimit:rawTel.leanLimit,
        tucking:rawTel.tucking,
        braking:rawTel.braking,
      }:undefined
      ebikeState=ebikeFx.step(dt,{
        speed:rides.speed,
        heading:rides.heading,
        lean:rides.lean,
        steerInput:rides.steerInput,
        braking:keys.forward<-.05&&rides.speed>.2,
        obstacle:bikeObstacle,
        allowAutoCrash:!verify||stuntMode,
      },rideCtrl.cycleMod?{...rideCtrl,cycleMod:false}:rideCtrl,extTel,{
        canPlace:(ox,oz)=>!sim.insideHouse(p.x+ox,p.z+oz)&&!sim.wet(p.x+ox,p.z+oz)&&!sim.isBlockedAt(p.x+ox,refY,p.z+oz),
        supportY:(ox,oz,ry)=>supportAt(p.x+ox,p.z+oz,ry)?.y??ry,
      })
      if(prevCrashPhase==='recovering'&&ebikeState.crashPhase==='none'){
        rides.resetEbikeGearOnRecover()
        const fresh=rides.ebikeTelemetry
        if(fresh)ebikeState={...ebikeState,gear:fresh.gear,gearLabel:fresh.gearLabel,maxKmh:fresh.maxKmh}
      }
      if(mountedStaticBike)mountedStaticBike.userData.battery=ebikeState.battery
    }
    const actualSpeed=simSteps>0?traveled/(simSteps*step):Math.hypot(vx,vz)
    let turnDiff=0
    if(!aboardGround){
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
  function photoSupport(x:number,z:number,bridgeRadius?:number){
    const tile=sim.tileAt(x,z), data=tile&&stream.loaded.get(tile)
    if(!tile||!data)throw Error(`Missing detail at ${x},${z}`)
    sim.sync(x,z)
    const water=data.water[Math.round((z-tile.z)/4)*65+Math.round((x-tile.x)/4)]
    const waterY=water===-32768?-Infinity:water/10
    function deckAt(east:number,south:number){
      const deck=sim.surface(east,south,'deck')
      if(deck)return deck
      // Guanyi's pedestrian promenade is a landmark tread over a dry bank tile.
      if(bridgeRadius!==undefined || Number.isFinite(waterY)){
        const tread=sim.surface(east,south,'landmark')
        if(tread && tread.slope<=cfg.slope && tread.y>waterY)return tread
      }
      return null
    }
    const deck=deckAt(x,z)
    if(deck)return {kind:'deck',y:Math.max(deck.y,waterY),sampleDistance:0}
    // Known on-bridge photo, but the recorded point lies beside the narrow span.
    // Borrow only elevation inside the EXIF uncertainty circle. Keep the original X/Z.
    if(bridgeRadius!==undefined && bridgeRadius>0 && Number.isFinite(waterY)){
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
    for(const kind of ['sidewalk','road','ground'] as const){
      const hit=sim.surface(x,z,kind)
      if(hit)return {kind,y:Math.max(hit.y,waterY),sampleDistance:0}
    }
    throw Error(`Missing support at ${x},${z}`)
  }
  return {photoSupport,enter,leave,tick,get destination(){return destination},spawns,probe,boatClearance,parked(kind?:import('./ride').RideKind|'car'){return rides?.parked(kind)??[]},get freeMoorings(){return rides?.freeMoorings()??[]},get boatKind(){return rides?.freeKind??null},get obstacle(){return bikeObstacle},get vehicle(){return rides?.car?'car':rides?.bike?(rides.rideKind==='bicycle'?'bicycle':'bike'):rides?.boat?'boat':'foot'},get heading(){return rides?.heading??0},get speed(){return rides?.speed??0},get active(){return active},drive(x:number,z:number,run=true){external={x,z,run}},
    ebike:{
      get state(){return ebikeState},
      triggerCrash(reason:Exclude<EbikeCrashReason,''>='lowside',side:-1|1=1){if(rides?.bike&&rides.rideKind==='bike')ebikeFx.triggerCrash(reason,side,rides.heading,Math.max(4.5,Math.abs(rides.speed)))},
      recover(){return ebikeFx.startRecover()},
      setMod(preset:EbikeModPreset){ebikeFx.setModPreset(preset);rides?.setEbikeUpgrades(ebikeModUpgrades(ebikeFx.vehicleType,ebikeFx.modPreset));ebikeRig.applyMods(ebikeFx.modPreset,(mountedStaticBike?.userData.paint as number|undefined)??0);if(mountedStaticBike)mountedStaticBike.userData.modPreset=ebikeFx.modPreset},
      setVehicleType(type:EbikeVehicleType){rides?.setEbikeVehicleType(type);ebikeFx.setVehicleType(type);rides?.setEbikeUpgrades(ebikeModUpgrades(type,ebikeFx.modPreset));const paint=(mountedStaticBike?.userData.paint as number|undefined)??0;ebikeRig.setVehicleType(type,paint);ebikeRig.applyMods(ebikeFx.customMods??ebikeFx.modPreset,paint);if(mountedStaticBike)mountedStaticBike.userData.modPreset=ebikeFx.modPreset},
      setBattery(pct:number){const clamped=rides?.rideKind==='bike'?rides.setEbikeBattery(pct):pct;ebikeFx.setBattery(clamped);if(mountedStaticBike)mountedStaticBike.userData.battery=clamped},
    },
    get yaw(){return yaw},hold(on:boolean){held=on;external=null;if(on){rides?.stop();vx=vz=0}},face(heading:number,tilt=cfg.pitch){yaw=heading;pitch=tilt;if(active)follow(0,true)},showFigure(on:boolean){figure.visible=on&&active},
    get position(){const pos=rides?.boat?.position??sim.body.translation();return posOut.set(pos.x,pos.y,pos.z)}}
}
