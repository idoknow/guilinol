import {cameraHoldLayer} from './camera-hold'
import {emoteWheel} from '../emote/wheel'
import {emotePlayback} from '../emote/playback'
import {interrupted,emotesEnabled} from '../emote/emotes'
import {takeCigaretteIntent, smokeEnabled} from '../citizen/use-item'
import {SmokeSession} from '../smoke/session'
import {smokeVisual} from '../smoke/visual'
import {skinTones} from '../../../lib/avatar'
import {nearestPlayable} from '../../../lib/play-region'
import {mpEnabled} from '../ui/mp-pref'
import * as THREE from 'three'
import {passengerTop} from './passenger-height'
import {tunnelFloor} from '../tunnels'
import {getCarFreeAt, vehicleForbiddenAt} from '../game/car-free'
import R from '@dimforge/rapier3d-compat'
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js'
import type {PeaksGroup} from '../peaks'
import type {Manifest} from '../world'
import type {Stream} from '../stream'
import {walkInput} from '../ui/walk'
import {defaultAvatar} from '../../../lib/avatar'
import {currentAvatar,characterModel,disposeCharacterParts,styleCharacter} from './character'
import {avatar} from '../look/avatar'
import {bikeConfig, carConfig, walkConfig as cfg, type CarDriveMode, type EbikeHeadlightMode, type EbikeTurnSignal, type EbikeUpgradeMods} from './config'
import {createPhysics} from './physics'
import {resolveContact} from '../traffic/contact'
import {createCameraRig} from './camera'
import {isFirstPerson} from './view-mode'
import {createEbikeGripPose} from './ebike-grip'
import {hits} from '../input/keymap'
import {look} from '../look/config'
import {env} from '../look/time'
import {createDriverPose} from './car'
import {createRiderPose,notifyDismountBlocked} from './ride'
import {createEbikeAudioEngine} from './ebike-audio'
import {RIDE_SOUND_EVENT} from './ride-sound-pref'
import {clearAvatarPose, ensureAvatarRig, getAvatarJoint, getAvatarJoints} from './avatar-rig'
import {isGlobalHotkeyBlocked, isModalOrOverlayOpen} from './input-guard'
import {createInteractArbiter} from './interact-arbiter'
import type {ShopCloseReason, ShopOverlayHandle} from '../ui/shop-overlay'
import {getPlayMode, onPlayMode, soloServices} from '../game/play-mode'
import {PERSONAL_EBIKE_MODELS} from '../game/catalog'
import {findNearbyServiceBay, findNearbyShopTrigger, getShop, listShops} from '../game/shops'
import {getQuietZoneAt} from '../game/quiet-zones'
import {emit as emitGameEvent, getState as getGameState, onEvent as onGameEvent, onState,
  setPrompt, updateTravel, type ActiveVehicleState, type EquippedOutfit, type PersistedEbikeVisual,
  type PersonalEbikeModelId, type PlayerMode} from '../game/state'
import {
  KICKSTAND_REST_ROLL_RAD,
  computeParkedRoll,
  computePickupRoll,
  createInitialTwoWheelOpState,
  nextHeadlightMode,
  resolveTwoWheelTransition,
  type TwoWheelHeadlightMode,
  type TwoWheelOperationalState,
} from './ebike-state-coupling'
import {
  createDynamicBicycle,
  createDynamicCar,
  createDynamicEbike,
  vehicleModel,
  type EbikeModPreset,
  type StaticBikeVisualOptions,
  type TwoWheelVisualRig,
} from './vehicle-model'
import {
  applyEbikeVisualAndRider,
  createEbikeFxController,
  RIDER_JOINT_NAMES,
  type EbikeCrashPhase,
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

function solveBicyclePedalIK(phase:number):[number,number]{
  const dy=(.33+.15*Math.cos(phase))-.88
  const dz=(.05-.15*Math.sin(phase))-.23
  const d=THREE.MathUtils.clamp(Math.hypot(dy,dz),.24,.88)
  const alpha=Math.atan2(-dz,-dy)
  const L1=.45, L2=.45
  const cosKnee=THREE.MathUtils.clamp((L1*L1+L2*L2-d*d)/(2*L1*L2),-1,1)
  const beta=Math.acos(THREE.MathUtils.clamp((L1*L1+d*d-L2*L2)/(2*L1*d),-1,1))
  return [alpha+beta,-(Math.PI-Math.acos(cosKnee))]
}

type DownedBikeEntry={
  mesh:THREE.Mesh
  kind:'bike'|'bicycle'
  x:number
  y:number
  z:number
  yaw:number
  side:-1|1
  roll:number
  lift:number
  vehicleType:EbikeVehicleType
  battery:number
  modPreset:EbikeModPreset
  paint:number
  hazardOverlay?:THREE.Group
}

function setRiderJoints(joints:RiderJoints,targets:Partial<Record<RiderJointName,[number,number,number]>>,blend=1){
  for(const name of RIDER_JOINT_NAMES){
    const j=joints[name], tgt=targets[name]
    if(!j||!tgt)continue
    if(blend>=1)j.rotation.set(tgt[0],tgt[1],tgt[2])
    else j.rotation.set(tgt[0]*blend,tgt[1]*blend,tgt[2]*blend)
  }
}

function applySprawledCrashPose(
  figure:THREE.Group,joints:RiderJoints,fallT:number,side:-1|1,
  rx:number,ry:number,rz:number,heading:number,seatPos:THREE.Vector3,
){
  figure.position.set(
    THREE.MathUtils.lerp(seatPos.x,rx,fallT),
    THREE.MathUtils.lerp(seatPos.y,ry+.24*fallT,fallT),
    THREE.MathUtils.lerp(seatPos.z,rz,fallT),
  )
  figure.rotation.set(1.36*fallT,heading+side*.45*fallT,side*.28*fallT,'YXZ')
  setRiderJoints(joints,{
    Hips:[0,0,0],
    Torso:[.18*fallT,side*.20*fallT,0],
    Head:[-.44*fallT,-side*.30*fallT,0],
    ArmL:[1.38*fallT,.32*fallT,-.46*fallT],
    ArmR:[1.38*fallT,-.32*fallT,.46*fallT],
    ForearmL:[1.12*fallT,0,0],
    ForearmR:[1.12*fallT,0,0],
    ThighL:[.68*fallT,0,-.22*fallT],
    ThighR:[.90*fallT,0,.22*fallT],
    ShinL:[-.98*fallT,0,0],
    ShinR:[-1.20*fallT,0,0],
  })
}

function applyStandUpAnimation(
  figure:THREE.Group,joints:RiderJoints,progress:number,side:-1|1,
  x:number,groundY:number,z:number,startYaw:number,targetYaw:number,
){
  const u=THREE.MathUtils.clamp(progress,0,1)
  const pushT=THREE.MathUtils.smoothstep(u,0,.38)
  const riseT=THREE.MathUtils.smoothstep(u,.32,.78)
  const settleT=THREE.MathUtils.smoothstep(u,.74,1)
  const bodyPitch=THREE.MathUtils.lerp(THREE.MathUtils.lerp(1.36,.52,pushT),0,riseT)
  const bodyRoll=THREE.MathUtils.lerp(side*.28,0,riseT)+Math.sin(riseT*Math.PI)*(-side*.09)
  const crouchDrop=Math.sin(riseT*Math.PI)*.10
  figure.position.set(x,groundY+THREE.MathUtils.lerp(.24,0,riseT)-crouchDrop,z)
  figure.rotation.set(bodyPitch,startYaw+shortestAngle(startYaw,targetYaw)*riseT,bodyRoll,'YXZ')
  const dustSweep=Math.sin(settleT*Math.PI)
  const kneelBlend=(1-settleT)*Math.sin(THREE.MathUtils.clamp((u-.12)/.66,0,1)*Math.PI)
  setRiderJoints(joints,{
    Hips:[0,0,0],
    Torso:[THREE.MathUtils.lerp(.18,-.34,pushT)*(1-riseT)-.10*kneelBlend,dustSweep*.10,0],
    Head:[THREE.MathUtils.lerp(-.44,.16,pushT)*(1-settleT),0,0],
    ArmL:[THREE.MathUtils.lerp(1.38,.78,pushT)*(1-riseT)+dustSweep*.45,0,-.12*(1-riseT)],
    ArmR:[THREE.MathUtils.lerp(1.38,.78,pushT)*(1-riseT)+dustSweep*.45,0,.12*(1-riseT)],
    ForearmL:[THREE.MathUtils.lerp(1.12,.52,pushT)*(1-riseT)+dustSweep*.40,0,0],
    ForearmR:[THREE.MathUtils.lerp(1.12,.52,pushT)*(1-riseT)+dustSweep*.40,0,0],
    ThighL:[THREE.MathUtils.lerp(.68,.95,pushT)*(1-riseT)+.42*kneelBlend,0,-.10*(1-riseT)],
    ThighR:[THREE.MathUtils.lerp(.90,.55,pushT)*(1-riseT)+.22*kneelBlend,0,.10*(1-riseT)],
    ShinL:[THREE.MathUtils.lerp(-.98,-1.35,pushT)*(1-riseT)-.55*kneelBlend,0,0],
    ShinR:[THREE.MathUtils.lerp(-1.20,-.65,pushT)*(1-riseT)-.30*kneelBlend,0,0],
  })
}

function applyPickupBikeAnimation(
  figure:THREE.Group,joints:RiderJoints,progress:number,
  pos:{x:number;y:number;z:number},yaw:number,rec:DownedBikeEntry,
){
  const u=THREE.MathUtils.clamp(progress,0,1)
  const crouch=THREE.MathUtils.smoothstep(u,0,.38)*(1-THREE.MathUtils.smoothstep(u,.48,1))
  const liftT=THREE.MathUtils.smoothstep(u,.30,.92)
  rec.mesh.position.set(rec.x,rec.y+rec.lift*(1-liftT),rec.z)
  rec.mesh.rotation.set(0,rec.yaw,computePickupRoll(rec.roll,u,rec.kind==='bike'),'YXZ')
  figure.position.set(pos.x,pos.y-crouch*.08,pos.z)
  figure.rotation.set(crouch*.18,yaw,0,'YXZ')
  const pull=Math.sin(THREE.MathUtils.clamp((u-.22)/.72,0,1)*Math.PI)
  setRiderJoints(joints,{
    Hips:[0,0,0],
    Torso:[-.46*crouch-.16*pull,0,0],
    Head:[.18*crouch,0,0],
    ArmL:[1.12*crouch+.62*pull,0,-.12*crouch],
    ArmR:[1.12*crouch+.62*pull,0,.12*crouch],
    ForearmL:[.34*crouch+.48*pull,0,0],
    ForearmR:[.34*crouch+.48*pull,0,0],
    ThighL:[.58*crouch+.18*pull,0,-.06*crouch],
    ThighR:[.58*crouch+.18*pull,0,.06*crouch],
    ShinL:[-.88*crouch-.26*pull,0,0],
    ShinR:[-.88*crouch-.26*pull,0,0],
  })
}

export async function walk(scene:THREE.Scene,camera:THREE.PerspectiveCamera,canvas:HTMLCanvasElement,manifest:Manifest,stream:Stream,peaks:PeaksGroup,verify:boolean){
  rapierReady ??= R.init()
  avatarReady ??= new GLTFLoader().loadAsync(avatar.path)
  const profile=currentAvatar()??defaultAvatar()
  let net:ReturnType<typeof import('../net').attachNet>|undefined
  const [sim,source,model,preloadedNet]=await Promise.all([createPhysics(manifest,stream,peaks,rapierReady),avatarReady,characterModel(profile),mpEnabled()?import('../net'):undefined])
  let netModule=preloadedNet
  model.animations.push(...source.animations.filter(c=>!model.animations.some(other=>other.name===c.name)))
  const rig=createCameraRig(sim)
  const figure=model.scene,legacySkinned=mergeAvatar(figure,avatar.color),avatarRig=ensureAvatarRig(figure,avatar.color),skinned=legacySkinned??avatarRig.skinnedMesh,traveller=figure.getObjectByName('Traveller')??avatarRig.traveller,ridePose=createRiderPose(figure),driverPose=createDriverPose(figure)
  const cigarette=new SmokeSession()
  let smoking:ReturnType<typeof smokeVisual>|undefined,puffSeq=0
  let outfitController=styleCharacter(figure,avatarRig,profile)
  let appearanceVersion=0
  window.addEventListener('glol:avatar-change',async()=>{
    const a=currentAvatar(),version=++appearanceVersion
    if(!a||!avatarRig.skinnedMesh)return
    const fresh=await characterModel(a)
    if(version!==appearanceVersion){disposeCharacterParts(fresh.scene);disposeCharacterParts(fresh.scene.userData.creatorHair);return}
    const mesh=fresh.scene.getObjectByProperty('isSkinnedMesh',true) as THREE.SkinnedMesh
    outfitController.dispose()
    for(const name of ['creator-body-outline','creator-face','creator-hair','creator-skirt']){
      const part=figure.getObjectByName(name)
      if(part){part.removeFromParent();disposeCharacterParts(part)}
    }
    avatarRig.skinnedMesh.geometry.dispose();avatarRig.skinnedMesh.geometry=mesh.geometry
    const oldMaterial=avatarRig.skinnedMesh.material
    for(const mat of Array.isArray(oldMaterial)?oldMaterial:[oldMaterial])mat.dispose()
    avatarRig.skinnedMesh.material=mesh.material
    figure.getObjectByName('CreatorProportions')!.scale.copy(fresh.scene.getObjectByName('CreatorProportions')!.scale)
    figure.userData.creatorHair=fresh.scene.userData.creatorHair
    outfitController=styleCharacter(figure,avatarRig,a)
    outfitController.applyEquipped(getGameState().wardrobe.equipped,{autoHelmetOnRide:getGameState().wardrobe.autoHelmetOnRide,ridingEbike:Boolean(rides?.bike&&rides.rideKind!=='bicycle')})
  })
  {
    const initialWardrobe=getGameState().wardrobe
    outfitController.applyEquipped(initialWardrobe.equipped,{ridingEbike:false,autoHelmetOnRide:initialWardrobe.autoHelmetOnRide})
  }
  const riderJoints=getAvatarJoints(figure) as RiderJoints
  const applyGripPose=createEbikeGripPose(figure)
  const ebikeRig=createDynamicEbike(0)
  ebikeRig.root.visible=false
  scene.add(ebikeRig.root)
  const bicycleRig=createDynamicBicycle(0)
  bicycleRig.root.visible=false
  scene.add(bicycleRig.root)
  const carRig=createDynamicCar(0)
  carRig.root.visible=false
  scene.add(carRig.root)
  scene.add(carRig.smokeGroup)
  const searchParams=typeof location!=='undefined'?new URLSearchParams(location.search):null
  const stuntMode=searchParams?.get('stunt')==='1'
  const gtaCarParam=searchParams?.get('gtacar')==='1'
  const defaultCarGta=!verify||gtaCarParam
  let carGtaOverride:boolean|undefined=undefined
  let carShake=0, carShakePhase=0, carSpeedArm=0
  function ebikeModUpgrades(vType:EbikeVehicleType,preset:EbikeModPreset):EbikeUpgradeMods|null{
    if(vType==='shared'||preset==='stock')return null
    return preset==='ghostfire'?{motorLevel:1,controllerLevel:1,batteryLevel:1}:{motorLevel:2,controllerLevel:2,batteryLevel:2}
  }
  const ebikeFx=createEbikeFxController()
  const ebikeAudio=createEbikeAudioEngine()
  window.addEventListener(RIDE_SOUND_EVENT,event=>ebikeAudio.setMuted((event as CustomEvent<boolean>).detail))
  const ZERO_RIDE_INPUT:EbikeRideControlInput={gearDelta:0,gearSelect:null,wheelie:false,tuck:false,recover:false,cycleMod:false,parkToggle:false,kickstandToggle:false,headlightCycle:false,turnLeftToggle:false,turnRightToggle:false,hazardToggle:false,horn:false,hornPulse:false,cruiseToggle:false}
  const ebikeMountStartPos=new THREE.Vector3(), ebikeMountStartRot=new Map<RiderJointName,[number,number,number]>()
  let ebikeMountStartYaw=0, ebikeMountElapsed=bikeConfig.mountDuration
  let mountedStaticBike:THREE.Object3D|null=null
  let mountedStaticCar:THREE.Object3D|null=null
  let ebikeState:EbikeTelemetrySnapshot|null=null
  let autoCrashOverride:boolean|undefined=undefined
  const downedBikes=new Set<DownedBikeEntry>()
  const _seatTmp=new THREE.Vector3(), _rigPosTmp=new THREE.Vector3()
  let prevAudioPark=false, prevAudioGear=2, prevAudioLight:EbikeHeadlightMode='off', prevAudioBlink=false, prevAudioHorn=false
  type CrashSession={
    mesh:THREE.Mesh
    kind:'bike'|'bicycle'
    vehicleType:EbikeVehicleType
    paint:number
    modPreset:EbikeModPreset
    battery:number
    side:-1|1
    heading:number
    bikeOriginX:number
    bikeOriginZ:number
    bikeSlideX:number
    bikeSlideZ:number
    riderOffsetX:number
    riderOffsetZ:number
    slideSpeed:number
    elapsed:number
    reason:Exclude<EbikeCrashReason,''>
  }
  type StandUpSession={elapsed:number;duration:number;side:-1|1;x:number;y:number;z:number;startYaw:number;targetYaw:number}
  type PickupSession={rec:DownedBikeEntry;elapsed:number;duration:number;startYaw:number}
  let crashSession:CrashSession|null=null
  let standUpSession:StandUpSession|null=null
  let pickupSession:PickupSession|null=null
  let crashRecoverQueued=false
  let twoWheelOp:TwoWheelOperationalState=createInitialTwoWheelOpState()
  let carHeadlight:TwoWheelHeadlightMode='off'
  let carHeadlightManual=false

  // Unified `.vehicle-action` button shared with `vehicles.ts` and owned by `interact-arbiter.ts`.
  const actionButton=document.querySelector<HTMLButtonElement>('.vehicle-action')??(()=>{
    const b=document.createElement('button')
    b.className='vehicle-action'
    b.setAttribute('aria-keyshortcuts','F')
    b.hidden=true
    document.body.append(b)
    return b
  })()

  // Subtle zero-light ground hint rings for registered commercial venues (docs/commerce-shops-spec.md §2.1).
  const shopHintGroup=new THREE.Group()
  const shopRingGeo=new THREE.RingGeometry(1.15,1.45,32).rotateX(-Math.PI/2)
  const shopRings=listShops().map(shop=>{
    const mat=new THREE.MeshBasicMaterial({
      color:shop.kind==='clothing'?0xffc53d:0x20d6c1,
      transparent:true,
      opacity:.48,
      depthWrite:false,
      side:THREE.DoubleSide,
      fog:false,
    })
    const ring=new THREE.Mesh(shopRingGeo,mat)
    ring.renderOrder=4
    ring.visible=false
    shopHintGroup.add(ring)
    return {shop,ring,mat}
  })
  shopHintGroup.visible=false


  // IDOK-127: Front-of-shop 3-tier exhibition bikes reusing vehicleModel() on Shizijie raised plinths (0 dynamic lights).
  const SHOWROOM_SIGNATURES:Record<PersonalEbikeModelId,StaticBikeVisualOptions>={
    lijiang_light:{paintColor:0x6e9eb5,windshield:'clear',topbox:'none',headlightTier:0},
    city_range:{paintColor:0x266c7a,windshield:'clear',topbox:'delivery',angelEye:true,angelEyeColor:0x58f7ff,goldShock:true,headlightTier:1},
    xiangshan_gt:{paintColor:0x5c2e8a,windshield:'tinted',topbox:'none',underglow:true,underglowColor:0x20d6c1,angelEye:true,angelEyeColor:0xffc53d,goldShock:true,tailWing:true,exhaust:true,headlightTier:2},
  }
  const ebikeShowroomGroup=new THREE.Group()
  ebikeShowroomGroup.name='shizijie-ebike-showroom'
  const showroomBikes=listShops().flatMap(shop=>(shop.displayStands??[]).map((stand,idx)=>{
    const visual=SHOWROOM_SIGNATURES[stand.modelId]
    const mesh=vehicleModel('bike',idx,{visual})
    mesh.name=`showroom-${stand.modelId}`
    mesh.position.set(stand.pos[0],stand.pos[1]+stand.plinthHeight,stand.pos[2])
    mesh.rotation.set(0,stand.yaw,KICKSTAND_REST_ROLL_RAD,'YXZ')
    mesh.userData.showroomStand=stand.id
    mesh.userData.modelId=stand.modelId
    mesh.userData.paintColor=visual.paintColor
    ebikeShowroomGroup.add(mesh)
    return {shop,stand,mesh,snapped:false}
  }))
  ebikeShowroomGroup.visible=false
  scene.add(ebikeShowroomGroup)

  // Live 360° showcase e-bike rig positioned at `stagePos` (d=+4.2m) only while e-bike shop/garage overlay is open.
  const shopEbikeShowcaseRig=createDynamicEbike(0,undefined,'normal')
  shopEbikeShowcaseRig.root.name='shop-ebike-showcase'
  shopEbikeShowcaseRig.root.visible=false


  interface SavedStreetPose {
    yaw:number
    pitch:number
    arm:number
    figurePos:THREE.Vector3
    figureYaw:number
    camPos:THREE.Vector3
    camQuat:THREE.Quaternion
    fov:number
  }
  interface ActiveShopCamera {
    stagePos:THREE.Vector3
    subjectYaw:number
    orbitYaw:number
    orbitPitch:number
    orbitRadius:number
    minRadius:number
    maxRadius:number
    targetHeightOffset:number
    fovDeg:number
  }
  let savedStreetPose:SavedStreetPose|null=null
  let shopCam:ActiveShopCamera|null=null
  const shopLookTarget=new THREE.Vector3()
  let rides:Awaited<ReturnType<typeof vehicles>>|null=null,loading=false
  let testRideBrakeTimer=0
  let testRideOobSince=0

  function finishActiveTestRide(reason:'timeout'|'out_of_bounds'|'user'|'dismount_far'|'mode_switch'|'purchase'){
    const trial=getGameState().garage.activeTestRide
    if(!trial||!rides)return
    testRideBrakeTimer=0
    testRideOobSince=0
    const restoreFoot=rides.bikeOwnership==='test_ride'||(!rides.bike&&!rides.car&&!rides.boat)
    if(restoreFoot){
      crashSession=null;crashRecoverQueued=false
      standUpSession=null;pickupSession=null
    }
    for(const rec of downedBikes){
      if(rec.mesh.userData.instanceId!==trial.instanceId)continue
      removeDownedHazard(rec)
      downedBikes.delete(rec)
    }
    const ended=rides.endTestRide(reason)
    if(ended){
      if(restoreFoot){
        releaseDynamicBike()
        ridePose.reset()
        resetMotion()
        mixer.stopAllAction();action=undefined
        twoWheelOp=createInitialTwoWheelOpState()
        input.clearRun();input.syncRideHud(null,null)
        applyFootController()
        wasBike=false
      }
      if((!verify||stuntMode)&&reason!=='mode_switch'&&reason!=='purchase'){
        const label=reason==='timeout'?'试驾时间已到，车辆已安全归还车行'
          :reason==='out_of_bounds'?'超出试驾范围，车辆已安全归还车行'
            :reason==='dismount_far'?'已离开试驾车，试驾自动结束'
              :'已结束免费试驾，欢迎回「漓行电驴行」选购'
        window.dispatchEvent(new CustomEvent('walk:toast',{detail:{text:label,ms:2800}}))
      }
    }
  }

  function summonPersonalWithToast(vehicleId?:string){
    if(!soloServices()||!rides)return {ok:false as const,code:'NOT_ON_FOOT' as const}
    const p=sim.body.translation()
    const res=rides.summonPersonalBike({x:p.x,y:p.y-cfg.height/2,z:p.z},yaw,vehicleId)
    if(!verify||stuntMode){
      const msg=res.ok
        ?'个人电摩已送达路边（已挂 P 档并支好边撑），按 F 上车'
        :res.code==='QUIET_ZONE_BLOCKED'
          ?'校园安静区内禁止召唤个人电摩，请走到校外路边'
          :res.code==='COOLDOWN'
            ?`召唤冷却中（剩余 ${Math.ceil((res.cooldownRemainingMs??0)/1000)} 秒）`
            :res.code==='NO_OWNED_VEHICLE'
              ?'车库暂空，前往十字街「漓行电驴行」选购个人电摩'
              :res.code==='NOT_ON_FOOT'
                ?'请先下车到路边步行状态再召唤个人电摩'
                :res.code==='IN_TEST_RIDE'
                  ?'试驾进行中无法召唤个人电摩'
                  :'当前周围空间不足，挪到开阔路边再试'
      window.dispatchEvent(new CustomEvent('walk:toast',{detail:{text:msg,ms:2500}}))
    }
    return res
  }

  onGameEvent(ev=>{
    if(!soloServices())return
    if(ev.type==='shop:buy'){
      ebikeAudio.unlock()
      ebikeAudio.playShopBuySuccess()
      if(!verify||stuntMode){
        window.dispatchEvent(new CustomEvent('walk:toast',{detail:{text:`成交通知：已购入，当前余额 ¥${getGameState().money}`,ms:2600}}))
      }
      if(ev.itemType==='ebike_model'){
        if(getGameState().garage.activeTestRide)finishActiveTestRide('purchase')
        const activeId=getGameState().garage.activeVehicleId
        if(activeId)rides?.spawnPersonalBikeAtBay(ev.shopId,activeId)
      }
    }else if(ev.type==='garage:mod'||ev.type==='garage:service'){
      rides?.refreshPersonalBikeVisual(ev.vehicleId)
      const owned=getGameState().garage.vehicles[ev.vehicleId]
      if(owned&&mountedStaticBike&&mountedStaticBike.userData.instanceId===ev.vehicleId){
        ebikeRig.applyMods(owned.visual,(mountedStaticBike.userData.paint as number|undefined)??0)
      }
    }else if(ev.type==='outfit:equip'||ev.type==='save:loaded'){
      const w=getGameState().wardrobe
      outfitController.applyEquipped(w.equipped,{
        ridingEbike:Boolean(rides?.bike&&rides.rideKind!=='bicycle'),
        autoHelmetOnRide:w.autoHelmetOnRide,
      })
    }
  })

  onState((s,changed)=>{
    if(changed.has('wardrobe')){
      outfitController.applyEquipped(s.wardrobe.equipped,{
        ridingEbike:Boolean(rides?.bike&&rides.rideKind!=='bicycle'),
        autoHelmetOnRide:s.wardrobe.autoHelmetOnRide,
      })
    }
  })

  function openSafeWardrobe(){
    if(!active||!shopOverlay)return false
    if(rides?.car||crashSession||standUpSession||pickupSession){
      if(!verify||stuntMode){
        window.dispatchEvent(new CustomEvent('walk:toast',{detail:{text:'请先下车或站稳后再打开随身衣橱',ms:2200}}))
      }
      return false
    }
    return shopOverlay?.openWardrobe()
  }

  const openGarage = ()=>{ if(active)shopOverlay?.openGarage() }

  function syncShopShowcaseBike(){
    if(!shopCam||!shopEbikeShowcaseRig.root.visible)return
    shopEbikeShowcaseRig.update({
      pos:shopCam.stagePos,
      heading:shopCam.subjectYaw,
      groundPitch:0,
      lean:0,
      wheelie:0,
      steerInput:0,
      speed:0,
      kickstandDown:true,
      headlight:env.night>.35?'low':'off',
      night:env.night,
      dt:0,
    })
  }

  const shopRay=new R.Ray({x:0,y:0,z:0},{x:0,y:1,z:0})
  const shopBall=new R.Ball(.22)
  const shopCamDir=new THREE.Vector3()
  const shopCamId={x:0,y:0,z:0,w:1}
  const shopWallFilter=(coll:R.Collider)=>{const kind=sim.kinds.get(coll.handle);return kind!==undefined&&kind!=='tree'}
  function updateShopShowcaseCamera(){
    if(!shopCam)return
    syncShopShowcaseBike()
    const focusY=shopCam.stagePos.y+shopCam.targetHeightOffset
    shopLookTarget.set(shopCam.stagePos.x,focusY,shopCam.stagePos.z)
    const cosP=Math.cos(shopCam.orbitPitch)
    shopCamDir.set(
      Math.sin(shopCam.orbitYaw)*cosP,
      Math.sin(shopCam.orbitPitch),
      Math.cos(shopCam.orbitYaw)*cosP,
    ).normalize()
    let dist=shopCam.orbitRadius
    shopRay.origin={x:shopLookTarget.x,y:shopLookTarget.y,z:shopLookTarget.z}
    shopRay.dir={x:shopCamDir.x,y:shopCamDir.y,z:shopCamDir.z}
    const rayHit=sim.world.castRay(shopRay,dist,true,undefined,undefined,sim.capsule,undefined,shopWallFilter)
    if(rayHit)dist=Math.min(dist,Math.max(.75,rayHit.timeOfImpact-.22))
    const shapeHit=sim.world.castShape(shopLookTarget,shopCamId,shopCamDir,shopBall,.02,dist,false,undefined,undefined,sim.capsule,undefined,shopWallFilter)
    if(shapeHit)dist=Math.min(dist,Math.max(.75,shapeHit.time_of_impact-.05))
    camera.position.copy(shopLookTarget).addScaledVector(shopCamDir,dist)
    camera.lookAt(shopLookTarget)
  }

  let shopOverlay: ShopOverlayHandle | undefined
  function mountOverlay(mountShopOverlay: typeof import('../ui/shop-overlay').mountShopOverlay){
    return mountShopOverlay({
    onBeforeOpen(shop,overlayMode){
      input.clearTransientInput(true)
      held=true;external=null;rides?.stop();vx=vz=0
      savedStreetPose={
        yaw,pitch,arm,
        figurePos:figure.position.clone(),
        figureYaw:figure.rotation.y,
        camPos:camera.position.clone(),
        camQuat:camera.quaternion.clone(),
        fov:camera.fov,
      }
      if(!rides?.bike&&!rides?.boat&&!rides?.car&&!crashSession&&!standUpSession&&!pickupSession&&(overlayMode==='wardrobe'||shop?.kind==='clothing')){
        const idleAct=actions.get(avatar.clips.idle)
        if(idleAct){
          if(action!==idleAct){
            action?.fadeOut(0)
            idleAct.reset().setLoop(THREE.LoopRepeat,Infinity).fadeIn(0).play()
            action=idleAct
          }
          activeClipName=avatar.clips.idle
        }
        mixer.update(0)
      }
      const isEbikeShowcase=shop?.kind==='ebike'||overlayMode==='garage'||overlayMode==='service'
      if(shop){
        const sx=shop.cameraRig.stagePos[0], sz=shop.cameraRig.stagePos[2]
        const sy=supportAt(sx,sz,shop.cameraRig.stagePos[1])?.y??figure.position.y
        shopCam={
          stagePos:new THREE.Vector3(sx,sy,sz),
          subjectYaw:shop.facingYaw,
          orbitYaw:shop.cameraRig.stageYaw,
          orbitPitch:shop.cameraRig.pitchRad,
          orbitRadius:shop.cameraRig.orbitRadius,
          minRadius:shop.cameraRig.minRadius,
          maxRadius:shop.cameraRig.maxRadius,
          targetHeightOffset:shop.cameraRig.targetHeightOffset,
          fovDeg:shop.cameraRig.fovDeg,
        }
        if(shop.kind==='clothing'){
          shopEbikeShowcaseRig.root.visible=false
          figure.position.set(sx,sy+soleOffset,sz)
          figure.rotation.y=shop.cameraRig.stageYaw+avatar.yaw
          figure.visible=true
        }else if(isEbikeShowcase){
          figure.visible=false
          shopEbikeShowcaseRig.root.visible=true
        }
        camera.fov=shopCam.fovDeg
        camera.updateProjectionMatrix()
        updateShopShowcaseCamera()
      }else if(overlayMode==='wardrobe'){
        shopEbikeShowcaseRig.root.visible=false
        shopCam={
          stagePos:figure.position.clone(),
          subjectYaw:figure.rotation.y,
          orbitYaw:figure.rotation.y+Math.PI+0.16,
          orbitPitch:.12,
          orbitRadius:2.55,
          minRadius:1.75,
          maxRadius:4.0,
          targetHeightOffset:.96,
          fovDeg:40,
        }
        camera.fov=shopCam.fovDeg
        camera.updateProjectionMatrix()
        updateShopShowcaseCamera()
      }else{
        shopCam={
          stagePos:figure.position.clone(),
          subjectYaw:yaw+Math.PI*.75,
          orbitYaw:yaw+Math.PI,
          orbitPitch:.18,
          orbitRadius:isEbikeShowcase?2.9:3.1,
          minRadius:2.0,
          maxRadius:4.6,
          targetHeightOffset:isEbikeShowcase?.72:1.05,
          fovDeg:44,
        }
        if(isEbikeShowcase){
          figure.visible=false
          shopEbikeShowcaseRig.root.visible=true
        }else{
          shopEbikeShowcaseRig.root.visible=false
        }
        camera.fov=shopCam.fovDeg
        camera.updateProjectionMatrix()
        updateShopShowcaseCamera()
      }
    },
    onPreviewEbike(preview){
      const paintIdx=preview.modelId==='lijiang_light'?0:preview.modelId==='city_range'?2:3
      shopEbikeShowcaseRig.setVehicleType('normal',paintIdx)
      shopEbikeShowcaseRig.applyMods(preview.visual,paintIdx)
      syncShopShowcaseBike()
    },
    onOrbitDrag(dx,dy){
      if(!shopCam)return
      shopCam.orbitYaw-=dx*.008
      shopCam.orbitPitch=THREE.MathUtils.clamp(shopCam.orbitPitch+dy*.005,.04,.65)
      updateShopShowcaseCamera()
    },
    onOrbitZoom(delta){
      if(!shopCam)return
      shopCam.orbitRadius=THREE.MathUtils.clamp(shopCam.orbitRadius+delta*.003,shopCam.minRadius,shopCam.maxRadius)
      updateShopShowcaseCamera()
    },
    onPreviewOutfit(equipped){
      outfitController.setPreview(equipped)
    },
    onPreviewRollback(equipped){
      outfitController.clearPreview()
      outfitController.applyEquipped(equipped,{
        ridingEbike:Boolean(rides?.bike&&rides.rideKind!=='bicycle'),
        autoHelmetOnRide:getGameState().wardrobe.autoHelmetOnRide,
      })
    },
    onStartTestRide(shopId,modelId){
      if(!rides)return
      const res=rides.startTestRide(shopId,modelId)
      if(res.ok){
        testRideBrakeTimer=0
        testRideOobSince=0
        if(!verify||stuntMode){
          window.dispatchEvent(new CustomEvent('walk:toast',{detail:{text:`免费试驾「${PERSONAL_EBIKE_MODELS[modelId].name}」已发车（限时 90 秒 / 350 米范围）`,ms:2800}}))
        }
      }else if(!verify||stuntMode){
        window.dispatchEvent(new CustomEvent('walk:toast',{detail:{text:'当前无法开启试驾，请稍后重试',ms:2200}}))
      }
    },
    onSummonVehicle(vehicleId){
      summonPersonalWithToast(vehicleId)
    },
    onAfterClose(_shopId,reason:ShopCloseReason){
      const restored=savedStreetPose
      savedStreetPose=null
      shopCam=null
      shopEbikeShowcaseRig.root.visible=false
      figure.visible=active
      if(restored){
        camera.fov=restored.fov
        camera.updateProjectionMatrix()
        if(reason!=='fly'&&reason!=='teleport'&&reason!=='testride'){
          yaw=restored.yaw;pitch=restored.pitch;arm=restored.arm
          figure.position.copy(restored.figurePos)
          figure.rotation.y=restored.figureYaw
          camera.position.copy(restored.camPos)
          camera.quaternion.copy(restored.camQuat)
          if(active)follow(0,true)
        }
      }
      held=false
      input.clearTransientInput(true)
    },
  })

  }
  function syncShopOverlay(){
    shopOverlay?.dispose()
    const services=soloServices()
    if (services) {
      shopOverlay=mountOverlay(services.mountShopOverlay)
      scene.add(shopHintGroup, shopEbikeShowcaseRig.root)
      window.addEventListener('game:open-garage', openGarage)
      window.addEventListener('game:open-wardrobe', openSafeWardrobe)
    } else {
      shopOverlay=undefined
      scene.remove(shopHintGroup, shopEbikeShowcaseRig.root)
      window.removeEventListener('game:open-garage', openGarage)
      window.removeEventListener('game:open-wardrobe', openSafeWardrobe)
    }
  }
  syncShopOverlay()
  onPlayMode(mode=>{
    if(mode==='tour'){
      shopHintGroup.visible=false
      if(getGameState().garage.activeTestRide) finishActiveTestRide('mode_switch')
    }
    syncShopOverlay()
  })

  function buildInteractionContext(){
    const pos=rides?.boat?.position??sim.body.translation()
    const footY=rides?.boat?pos.y:pos.y-cfg.height/2
    const quietZone=getQuietZoneAt(pos.x,pos.z)
    const vSnap=rides?.getInteractSnapshot()??{
      aboardKind:null,tourDisembarkQueued:false,nearDownedVehicle:null,nearVehicle:null,nearBoat:null,
    }
    const soloEnabled=getPlayMode()==='solo'
    const shopHit=soloEnabled && findNearbyShopTrigger(pos.x,pos.z,footY,{playerInQuietZone:!!quietZone})
    const serviceHit=soloEnabled && findNearbyServiceBay(pos.x,pos.z,footY,{playerInQuietZone:!!quietZone})
    return {
      active, soloEnabled,
      modalOrOverlayBlocked:isModalOrOverlayOpen()||document.body.dataset.photo==='on'||!!shopOverlay?.isOpen(),
      crashed:!!crashSession||document.body.dataset.rideCrash==='1',
      standingUp:!!standUpSession,
      pickingUpKind:pickupSession?pickupSession.rec.kind:null,
      aboardKind:vSnap.aboardKind,
      tourDisembarkQueued:vSnap.tourDisembarkQueued,
      inQuietZone:!!quietZone,
      nearDownedVehicle:vSnap.nearDownedVehicle,
      nearShop:shopHit?{shopId:shopHit.shop.shopId,brandName:shopHit.shop.brandName,displayName:shopHit.shop.displayName,distance:shopHit.distance}:null,
      nearServiceBay:serviceHit?{shopId:serviceHit.shop.shopId,displayName:serviceHit.shop.displayName,distance:serviceHit.distance}:null,
      nearVehicle:vSnap.nearVehicle,
      nearBoat:vSnap.nearBoat,
    }
  }

  const interactArbiter=createInteractArbiter({
    getContext:buildInteractionContext,
    onOpenShop(shopId){
      const shop=getShop(shopId)
      if(!shop)return
      shopOverlay?.openShop(shop.shopId)
    },
    onOpenService(shopId){
      shopOverlay?.openServiceBay(shopId)
    },
    onVehicleOrBoatInteract(){
      rides?.interact()
    },
    onSoftHint(text){
      window.dispatchEvent(new CustomEvent('walk:toast',{detail:{text,ms:2200}}))
    },
    onDecisionChange(decision){
      if(decision.label&&!decision.disabled){
        const kind=decision.action==='open_shop'?'shop':decision.action==='open_service'?'service':decision.action==='dismount'?'dismount':decision.action==='pickup_downed'?'pickup':decision.action==='board_boat'?'boat':'vehicle'
        setPrompt({key:'F',text:decision.label,kind})
      }else{
        setPrompt(null)
      }
    },
  })
  actionButton.onclick=()=>interactArbiter.trigger()

  function syncGameTravelState(){
    const pos=rides?.boat?.position??sim.body.translation()
    const quietZone=getQuietZoneAt(pos.x,pos.z)
    let mode:PlayerMode='foot'
    let vehicleState:ActiveVehicleState|null=null
    if(rides?.car){
      mode='car'
      const tel=rides.carTelemetry
      vehicleState={
        kind:'car',
        id:`car_world:${rides.car.uuid}`,
        speedKmh:tel?.kmh??Math.round(Math.abs(rides.speed)*3.6),
        gear:tel?.gearLabel==='R'?'R':tel?.gearLabel==='N'?'N':'D',
        damage:0,
      }
    }else if(rides?.bike){
      const isBicycle=rides.rideKind==='bicycle'
      mode=isBicycle?'bike':'ebike'
      const tel=rides.ebikeTelemetry
      const ownership=(rides.bike.userData.ownership as ActiveVehicleState['ownership']|undefined)??(rides.isShared?'shared':'personal')
      const gearLabel=(tel?.parkLocked?'P':tel?.gearLabel) as ActiveVehicleState['gearLabel']|undefined
      const instanceId=rides.bikeInstanceId
      const ownedDur=instanceId?getGameState().garage.vehicles[instanceId]?.durabilityPct:undefined
      const durabilityPct=ownedDur??rides.bikeDurabilityPct
      vehicleState={
        kind:isBicycle?'bike':'ebike',
        id:instanceId??`${rides.isShared?'shared_ebike':'world_ebike'}:${rides.bike.uuid}`,
        speedKmh:tel?.kmh??Math.round(Math.abs(rides.speed)*3.6),
        gear:tel?.parkLocked?'N':'D',
        damage:THREE.MathUtils.clamp(1-durabilityPct/100,0,1),
        ownership,
        modelId:rides.bikeModelId??undefined,
        gearLabel,
        batteryPct:tel?.batteryPct??rides.ebikeBattery,
        durabilityPct,
        parkLocked:tel?.parkLocked??false,
      }
    }else if(rides?.boat){
      mode='boat'
      vehicleState={kind:'boat',id:rides.freeKind??'tour_boat',speedKmh:Math.round(Math.abs(rides.speed)*3.6),damage:0}
    }
    outfitController.setRidingEbike(Boolean(rides?.bike&&rides.rideKind!=='bicycle'))
    updateTravel(mode,vehicleState,{quiet:!!quietZone,name:quietZone?.name,carFree:!!getCarFreeAt(pos.x,pos.z)})
  }

  function updateShopHintRings(x:number,z:number,footY:number){
    let anyShowroomVisible=false
    for(const item of showroomBikes){
      const d=Math.hypot(item.stand.pos[0]-x,item.stand.pos[2]-z)
      const show=active&&d<115
      item.mesh.visible=show
      if(show){
        anyShowroomVisible=true
        if(!item.snapped){
          const lmHit=sim.surface(item.stand.pos[0],item.stand.pos[2],'landmark',item.stand.pos[1]+1.2,2.4)
          if(lmHit){
            item.mesh.position.y=lmHit.y
            item.snapped=true
          }else{
            const baseY=supportAt(item.stand.pos[0],item.stand.pos[2],footY)?.y??item.stand.pos[1]
            item.mesh.position.y=baseY+item.stand.plinthHeight
          }
        }
      }
    }
    ebikeShowroomGroup.visible=anyShowroomVisible
    const onFoot=getPlayMode()==='solo'&&active&&!rides?.car&&!rides?.bike&&!rides?.boat&&!shopOverlay?.isOpen()
    shopHintGroup.visible=onFoot
    if(!onFoot)return
    const wave=.5+.5*Math.sin(performance.now()*.0045)
    for(const item of shopRings){
      const dist=Math.hypot(item.shop.triggerPos[0]-x,item.shop.triggerPos[2]-z)
      if(dist>item.shop.hintRadius){item.ring.visible=false;continue}
      const gy=supportAt(item.shop.triggerPos[0],item.shop.triggerPos[2],footY)?.y??item.shop.triggerPos[1]
      const inReach=dist<=item.shop.triggerRadius
      item.ring.visible=true
      item.ring.position.set(item.shop.triggerPos[0],gy+.08,item.shop.triggerPos[2])
      item.ring.scale.setScalar(inReach?1+.06*wave:1.05+.08*wave)
      item.mat.opacity=inReach?.72+.18*wave:.28+.15*wave
    }
  }
  // Shared-bike hail: L on keyboard, .btn-hail on touch (walk:hail). Returns false when not applicable on foot.
  function hailSharedBike(boardHint:string){
    if(!active||isModalOrOverlayOpen()||shopOverlay?.isOpen()||!rides||rides.bike||rides.car||rides.boat)return false
    const position=sim.body.translation()
    const ok=rides.hailBike({x:position.x,y:position.y-cfg.height/2,z:position.z},yaw)
    window.dispatchEvent(new CustomEvent('walk:toast',{detail:{text:ok?`共享电车已送达，${boardHint}`:'附近没有可调度的共享车或安全停车位',ms:2400}}))
    return true
  }
  window.addEventListener('walk:hail',()=>{hailSharedBike('点「骑电动车」出发')})
  window.addEventListener('keydown',event=>{
    if(active&&cigarette.active&&!event.repeat&&!isGlobalHotkeyBlocked(event.target)&&!isModalOrOverlayOpen()){
      if(event.code==='Escape'){cigarette.stop()}
      else if(hits(event.code,'useItem')){if(!cigarette.light()&&cigarette.puff())puffSeq=(puffSeq+1)%1000}
    }
    if(active)ebikeAudio.unlock()
    if(active && event.code==='KeyL' && !event.repeat && !isGlobalHotkeyBlocked(event.target) && hailSharedBike('按 F 上车'))return
    if(active&&!event.repeat&&event.code==='KeyO'&&!isGlobalHotkeyBlocked(event.target)&&!isModalOrOverlayOpen()&&!shopOverlay?.isOpen()){
      openSafeWardrobe()
      return
    }
    if(!active||!crashSession||event.repeat)return
    if(isGlobalHotkeyBlocked(event.target))return
    if((['jump','forward','back','left','right'] as const).some(action=>hits(event.code,action)))crashRecoverQueued=true
  })
  let prevTwoWheelSpeed=0
  let bicyclePedalPhase=0, bicycleFootWeight=1
  let prevCarSpeed=0, prevCarObstacle='', lastCarBraking=false
  let actionButtonEl:HTMLButtonElement|null=null
  const downedHazardGeo=new THREE.BoxGeometry(.08,.055,.07)
  const downedHazardMat=new THREE.MeshBasicMaterial({color:0xffa824})
  function attachDownedHazard(mesh:THREE.Mesh){
    const g=new THREE.Group()
    g.name='downed-hazard-flashers'
    for(const sx of [-.17,.17]){
      const front=new THREE.Mesh(downedHazardGeo,downedHazardMat)
      front.position.set(sx,.72,-.54)
      const rear=new THREE.Mesh(downedHazardGeo,downedHazardMat)
      rear.position.set(sx,.64,.52)
      g.add(front,rear)
    }
    mesh.add(g)
    return g
  }
  function removeDownedHazard(rec:DownedBikeEntry){
    if(rec.hazardOverlay){rec.hazardOverlay.removeFromParent();rec.hazardOverlay=undefined}
  }
  function findDownedNear(x:number,z:number,radius=.95):DownedBikeEntry|null{
    let best:DownedBikeEntry|null=null, bestD=radius
    for(const rec of downedBikes){
      const d=Math.hypot(rec.x-x,rec.z-z)
      if(d<bestD){bestD=d;best=rec}
    }
    return best
  }
  function syncAllDownedPoses(){
    const flashOn=((performance.now()*.0018)%1)<.5
    for(const rec of downedBikes){
      if(rec.hazardOverlay)rec.hazardOverlay.visible=flashOn
      if(pickupSession?.rec===rec)continue
      rec.mesh.visible=true
      rec.mesh.position.set(rec.x,rec.y+rec.lift,rec.z)
      rec.mesh.rotation.set(0,rec.yaw,rec.roll,'YXZ')
    }
  }
  function clearAllDowned(){
    for(const rec of downedBikes){
      removeDownedHazard(rec)
      rec.mesh.userData.downed=false
      rec.mesh.position.set(rec.x,rec.y,rec.z)
      rec.mesh.rotation.set(0,rec.yaw,0,'YXZ')
    }
    downedBikes.clear()
  }
  function releaseDynamicCar(){
    if(mountedStaticCar){mountedStaticCar.visible=true;mountedStaticCar=null}
    carRig.root.visible=false
    carRig.clearEffects()
    prevCarSpeed=0;prevCarObstacle='';lastCarBraking=false;carShake=0;carSpeedArm=0
  }
  function releaseDynamicBike(){
    if(mountedStaticBike){mountedStaticBike.visible=true;mountedStaticBike=null}
    ebikeRig.root.visible=false
    bicycleRig.root.visible=false
    ebikeFx.reset()
    ebikeAudio.stopContinuous()
    ebikeState=null
    prevTwoWheelSpeed=0
    bicyclePedalPhase=0;bicycleFootWeight=1
    prevAudioPark=false;prevAudioGear=2;prevAudioLight='off';prevAudioBlink=false;prevAudioHorn=false
  }
  const footMetrics={soleOffset:avatarRig.soleOffset,footProbes:avatarRig.footProbes}
  let firstPersonHidden=false
  scene.add(figure);figure.visible=false;figure.scale.setScalar(1)
  const soleOffset=footMetrics.soleOffset, footTmp=new THREE.Vector3()
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
  let action:THREE.AnimationAction|undefined,activeClipName='idle',active=false,yaw=0,pitch=cfg.pitch,arm=cfg.far,facing=0,bankLean=0,strideLean=0,prevSpeed=0
  const emote=emotePlayback(figure,id=>net?.emote(id),mixer)
  const canEmote=()=>active&&!rides?.bike&&!rides?.boat&&!rides?.car&&!cigarette.active&&!isFirstPerson()&&!isModalOrOverlayOpen()
  const wheel=emoteWheel(canEmote,id=>emote.play(id))
  canvas.addEventListener('pointerdown',event=>{if(event.pointerType==='mouse'&&event.button===0)emote.stop()})
  let vx=0,vz=0,velocity=0,grounded=false,wasGroundedFoot=true,crouching=false,jumpStage:'none'|'start'|'air'|'land'='none',jumpStageTimer=0,snapEnabled=true,coyoteTimer=0,jumpTimer=0,accumulator=0
  let resets=0,steps=0,physicsMs=0,elapsed=0,lastHits:string[]=[],wasLandmarkHit=false
  const input=walkInput(canvas,()=>active,(dx,dy)=>{yaw-=dx*cfg.sensitivity;pitch=THREE.MathUtils.clamp(pitch+dy*cfg.sensitivity,-.8,1.3)},
    delta=>{arm=THREE.MathUtils.clamp(arm+delta*.013,cfg.zoomMin,cfg.zoomMax);if(active)follow(0,true)},
    ()=>{arm=arm>(cfg.far+cfg.near)/2?cfg.near:cfg.far;if(active)follow(0,true)})
  const safe=new THREE.Vector3(),posOut=new THREE.Vector3(),wish=new THREE.Vector2();const spawns:object[]=[]
  let external:{x:number,z:number,run:boolean}|null=null,blockedWater=false,held=false
  const still={right:0,forward:0,run:false,crouch:false,jump:false}
  function setSnap(on:boolean){if(snapEnabled===on)return;snapEnabled=on;if(on)sim.controller.enableSnapToGround(cfg.snap);else sim.controller.disableSnapToGround()}
  function resetMotion(){vx=vz=velocity=coyoteTimer=jumpTimer=bankLean=strideLean=prevSpeed=jumpStageTimer=0;grounded=false;wasGroundedFoot=true;crouching=false;wasLandmarkHit=false;jumpStage='none';setSnap(true);figure.rotation.x=figure.rotation.z=0;if(traveller)traveller.rotation.set(0,0,0)}
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
        releaseDynamicCar()
        facing=bikeHeading+avatar.yaw
        driverPose.startDismount(prevCarPos,bikeHeading,active);input.clearRun();return true
      }
      if(crashSession){
        if(crashSession.elapsed>=.28)beginStandUpFromCrash()
        else crashRecoverQueued=true
        return false
      }
      const found=sim.findLocalDismount(x,z,bikeHeading,bikeY??safe.y-cfg.height/2)
      if(!found){notifyDismountBlocked();return false}
      const prevFoot=figure.position.clone(),prevYaw=figure.rotation.y
      if(!place(x,z,'dismount',true,found))return false
      twoWheelOp=resolveTwoWheelTransition(twoWheelOp,{type:'dismount',kind:rides?.rideKind==='bicycle'?'bicycle':'bike'}).state
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
      if(standUpSession||pickupSession)return null
      const downed=findDownedNear(bx,bz,.95)
      if(downed){
        twoWheelOp=resolveTwoWheelTransition(twoWheelOp,{type:'pickup_start',kind:downed.kind}).state
        pickupSession={rec:downed,elapsed:0,duration:.56,startYaw:facing}
        action?.fadeOut(.08);action=undefined
        if(traveller)traveller.rotation.set(0,0,0)
        return null
      }
      const check=sim.findLocalMount(cur.x,cur.y-cfg.height/2,cur.z,bx,by,bz)
      if(!check.ok){notifyDismountBlocked(check.reason==='blocked'?'中间有遮挡，绕过去再骑':'这里太窄了，挪一挪再骑');return null}
      return check
    },{sim,stream,actionButton,externalArbiter:true,isFootAnimBusy:()=>!!(standUpSession||pickupSession||crashSession),supportYAt:(x,z,refY)=>supportAt(x,z,refY)?.y??refY,landFree:spot=>{sim.sync(spot.x,spot.z)
      const prevBoatPos=figure.position.clone(),prevBoatYaw=figure.rotation.y
      if(sim.insideHouse(spot.x,spot.z)||!sim.freeCapsule(spot.x,spot.y,spot.z)||!place(spot.x,spot.z,spot.rule,true,spot))return false
      rides?.clearBoatPose(figure);boatLandFrom.copy(prevBoatPos);boatLandYaw=prevBoatYaw;boatLandElapsed=0;boatBoardElapsed=BOAT_BOARD_DUR
      facing=spot.heading+avatar.yaw;figure.rotation.y=facing;wasBoat=false;input.clearRun();follow(0,false);return true}})).then(loaded=>{rides=loaded;rides.setExternalArbiter(true);rides.show(active)
      if(active){const p=sim.body.translation();sim.sync(p.x,p.z);loaded.nearby(p.x,p.z,p.y-cfg.height/2);interactArbiter.sync(actionButton)}})
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
  const bridge=manifest.landmarks?.find(entry=>entry.id==='jiefang_bridge'),bridgeEye=new THREE.Vector3()
  const bridgeCenter=bridge&&new THREE.Vector3(...bridge.sphere.slice(0,3)).applyAxisAngle(new THREE.Vector3(0,1,0),THREE.MathUtils.degToRad(bridge.rotation)).add(new THREE.Vector3(...bridge.position))
  const bridgeDistance=(x:number,z:number)=>bridge&&bridgeCenter?Math.hypot(x-bridgeCenter.x,z-bridgeCenter.z)-bridge.sphere[3]:Infinity
  const collisionBounds=(manifest.landmarks??[]).filter(entry=>entry.collision!=='none').map(entry=>{
    const [cx,,cz,r]=entry.sphere, angle=THREE.MathUtils.degToRad(entry.rotation)
    return {entry,x:entry.position[0]+cx*Math.cos(angle)+cz*Math.sin(angle),z:entry.position[2]-cx*Math.sin(angle)+cz*Math.cos(angle),r}
  })
  function vehicleCollisionReady(x:number,y:number,z:number){
    let ready=true
    for(const dx of [-16,16])for(const dz of [-16,16]){
      const tile=sim.tileAt(x+dx,z+dz)
      if(tile&&!stream.loaded.has(tile)){stream.prioritize(x,z);ready=false}
    }
    for(const bound of collisionBounds){
      if(Math.hypot(x-bound.x,z-bound.z)>bound.r+16||stream.landmarks.has(bound.entry))continue
      stream.updateLandmarks?.(bridgeEye.set(x,y,z),bound.entry);ready=false
    }
    return ready
  }
  async function enter(x:number,z:number,heading:number,reason:string,override=false,signal?:AbortSignal,progress?:(fraction:number,detail:string)=>void){
    if(!sim.withinBounds(x,z)){
      if(!manifest.region)return false
      const point=nearestPlayable(manifest,x,z)
      x=point.x;z=point.z
    }
    if(shopOverlay?.isOpen())shopOverlay?.close('teleport')
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
    const deadline=performance.now()+(signal?60000:15000)
    let reported=''
    while((needed.some(tile=>!stream.loaded.has(tile))||supports.some(entry=>!stream.landmarks.has(entry)))&&performance.now()<deadline){
      if(signal?.aborted){if(destination===target)destination=null;return false}
      if(destination!==target)return false
      if(progress){const tiles=needed.filter(tile=>stream.loaded.has(tile)).length,landmarks=supports.filter(entry=>stream.landmarks.has(entry)).length
        const key=`${tiles}:${landmarks}`;if(key!==reported){reported=key;progress(.3+.6*tiles/Math.max(1,needed.length)+.1*landmarks/Math.max(1,supports.length),`街区 ${tiles} / ${needed.length}`)}}
      target.y=0;stream.tick(target)
      for(const entry of supports)if(!stream.landmarks.has(entry)){
        target.y=entry.position[1];stream.updateLandmarks?.(target,entry)
      }
      await new Promise(resolve=>setTimeout(resolve,12))
    }
    if(destination!==target)return false
    destination=null
    if(signal?.aborted)return false
    if(needed.some(tile=>!stream.loaded.has(tile))||supports.some(entry=>!stream.landmarks.has(entry)))return false
    if(active)resetWalk()
    sim.sync(x,z);if(!place(x,z,reason,override)){disconnect();window.dispatchEvent(new CustomEvent('walk:spawn-failed',{detail:{x,z,reason:'no-walkable-support'}}));return false}
    active=true;rides?.show(true);requestAnimationFrame(()=>requestAnimationFrame(loadRides));figure.visible=true;firstPersonHidden=false
    yaw=heading;facing=yaw+avatar.yaw;figure.rotation.y=facing;input.show(true);accumulator=0;rig.reset(arm)
    camera.near=.08;camera.updateProjectionMatrix();follow(0,true)
    if(takeCigaretteIntent(sessionStorage)&&smokeEnabled()){
      smoking=smokeVisual(scene,figure,{camera,skin:skinTones[(currentAvatar()??profile).skin]});cigarette.start('plain','cigarette')
    }
    attachMp()
    return true
  }
  // 同城联机：首页开关随时生效（IDOK-192）。预载过就同步连上，没预载就先拉模块，回来时还在步行才连。
  function attachMp(){
    if(!mpEnabled()||!active||net)return
    if(!netModule){void import('../net').then(module=>{netModule=module;attachMp()}).catch(error=>console.warn('multiplayer unavailable',error));return}
    {
        net=netModule.attachNet(scene,model.animations,()=>({x:figure.position.x,y:figure.position.y,z:figure.position.z,
          yaw:figure.rotation.y,v:rides?.bike?Math.abs(rides.speed):Math.hypot(vx,vz),gr:Number(grounded),
          sc:cigarette.lit?2:cigarette.active?1:0,sb:Math.round(cigarette.burn*10),sp:puffSeq,br:0,
          bike:rides?.bike?'bike':'',bx:rides?.bike?.position.x??0,bz:rides?.bike?.position.z??0,byaw:rides?.heading??0}),()=>currentAvatar()??profile,camera)
        net.emote(emote.id);net.tick(0)
    }
  }
  addEventListener('glol:mp-pref',()=>{if(mpEnabled())attachMp();else disconnect()})
  function disconnect(){net?.dispose();net=undefined}
  function leave(){disconnect();resetWalk()}
  function resetWalk(){emote.stop();emote.reset();holdLayer.reset();camHoldBlend=0;wheel.close();smoking?.dispose();smoking=undefined;cigarette.stop();if(shopOverlay?.isOpen())shopOverlay?.close('fly');outfitController.setRidingEbike(false);finishActiveTestRide('mode_switch');shopHintGroup.visible=false;ebikeShowroomGroup.visible=false;shopEbikeShowcaseRig.root.visible=false;for(const item of showroomBikes)item.snapped=false;destination=null;active=false;crashSession=null;standUpSession=null;pickupSession=null;crashRecoverQueued=false;twoWheelOp=createInitialTwoWheelOpState();carHeadlight='off';carHeadlightManual=false;clearAllDowned();releaseDynamicCar();releaseDynamicBike();input.syncRideHud(null,null);rides?.clearBoatPose(figure);rides?.show(false);actionButton.hidden=true;setPrompt(null);updateTravel('fly',null);if(wasCar||wasBike)applyFootController();wasBoat=wasBike=wasCar=false;bikeObstacle='';boatBoardElapsed=BOAT_BOARD_DUR;boatLandElapsed=BOAT_LAND_DUR;ridePose.reset();driverPose.reset(false);clearAvatarPose(figure);mixer.stopAllAction();action=undefined;resetMotion();figure.visible=false;input.show(false);external=null;sim.clear();camera.near=1;camera.updateProjectionMatrix()}
  function canPlaceCrashOffset(x:number,z:number,refY:number,fromX?:number,fromZ?:number){
    if(!sim.withinBounds(x,z))return false
    if(sim.insideHouse(x,z,refY+.4))return false
    const sup=supportAt(x,z,refY)
    if(!sup||Math.abs(sup.y-refY)>1.25)return false
    const dryBridge=!!sim.surface(x,z,'deck',refY+.4,1.5)||!!sim.surface(x,z,'landmark',refY+.4,1.5)
    if(sim.wet(x,z)&&!dryBridge)return false
    const cy=sup.y+cfg.height/2+.055
    if(sim.isBlockedAt(x,cy,z))return false
    if(fromX!==undefined&&fromZ!==undefined&&sim.pathBlocked(fromX,fromZ,x,z,sup.y+.45))return false
    return true
  }
  function triggerTwoWheelCrash(reason:Exclude<EbikeCrashReason,''>,side:-1|1){
    if(crashSession||!rides?.bike)return
    const kind=rides.rideKind==='bicycle'?'bicycle':'bike'
    const p=sim.body.translation(), refY=p.y-cfg.height/2
    const sideX=Math.cos(rides.heading)*side, sideZ=-Math.sin(rides.heading)*side
    const paint=(rides.bike.userData.paint as number|undefined)??0
    const vehicleType:EbikeVehicleType=kind==='bike'?(rides.vehicleType??(rides.isShared||rides.bike.userData.shared?'shared':'normal')):'normal'
    const battery=kind==='bike'?(rides.ebikeBattery??ebikeFx.battery):100
    const modPreset=kind==='bike'?ebikeFx.modPreset:'stock'
    const fx=-Math.sin(rides.heading), fz=-Math.cos(rides.heading)
    const candidates:[number,number][]=reason==='loopout'
      ?[
        [-fx*.95-sideX*.45,-fz*.95-sideZ*.45],[-sideX*.85,-sideZ*.85],[sideX*.85,sideZ*.85],
        [-fx*.95,-fz*.95],[-fx*1.2-sideX*.6,-fz*1.2-sideZ*.6],[fx*.95,fz*.95],
      ]
      :[
        [-sideX*.85+fx*.18,-sideZ*.85+fz*.18],[-sideX*.65,-sideZ*.65],[-sideX*1.15,-sideZ*1.15],
        [sideX*.85,sideZ*.85],[-fx*.95-sideX*.45,-fz*.95-sideZ*.45],[-fx*.95,-fz*.95],[fx*.95,fz*.95],
      ]
    for(const rad of [.9,1.3]){
      for(let a=0;a<8;a++){const ang=a*Math.PI/4;candidates.push([Math.cos(ang)*rad,Math.sin(ang)*rad])}
    }
    let rx=0, rz=0
    for(const [cx,cz] of candidates){
      if(canPlaceCrashOffset(p.x+cx,p.z+cz,refY,p.x,p.z)){rx=cx;rz=cz;break}
    }
    crashSession={
      mesh:rides.bike as THREE.Mesh,
      kind,vehicleType,paint,modPreset,battery,side,
      heading:rides.heading,
      bikeOriginX:p.x,bikeOriginZ:p.z,
      bikeSlideX:0,bikeSlideZ:0,
      riderOffsetX:rx,riderOffsetZ:rz,
      slideSpeed:THREE.MathUtils.clamp(Math.max(4.0,Math.abs(prevTwoWheelSpeed||rides.speed)),4.0,12.5),
      elapsed:0,reason,
    }
    rides.stop()
    const crashSeverity=THREE.MathUtils.clamp((crashSession.slideSpeed-3.5)/9,0.1,1)
    if(kind==='bike'){
      rides.applyPersonalCrashDamage(crashSeverity)
      emitGameEvent({type:'crash',severity:crashSeverity,vehicleId:rides.bikeInstanceId??undefined})
      rides.setEbikePark(false,true)
      rides.setEbikeHazard(true)
    }else{
      rides.setEbikeKickstand(false,true)
    }
    twoWheelOp=resolveTwoWheelTransition(twoWheelOp,{type:'crash',kind}).state
    ebikeAudio.stopContinuous()
    ebikeAudio.playCrashImpact(crashSession.slideSpeed)
    crashRecoverQueued=false
    if(kind==='bike'&&ebikeFx.crashPhase==='none'){
      ebikeFx.triggerCrash(reason,side,rides.heading,crashSession.slideSpeed)
    }else if(!verify||stuntMode){
      window.dispatchEvent(new CustomEvent('walk:toast',{detail:{
        text:reason==='lowside'?'压弯过急打滑摔车！按空格或方向键先起身，再去扶车'
          :reason==='loopout'?'翘头过猛翻车！按空格或方向键先起身，再去扶车'
            :'撞击摔车倒地！按空格或方向键先起身，再去扶车',
        ms:2600,
      }}))
    }
  }
  function resolveSafeRiderSpot(rx:number,rz:number,bx:number,bz:number,refY:number,yawTarget:number){
    const trySpot=(tx:number,tz:number)=>{
      const sup=supportAt(tx,tz,refY)
      const rawSy=sup?sup.y:refY
      const sy=Math.abs(rawSy-refY)<=1.2?rawSy:refY
      const cy=sy+cfg.height/2+.055
      if(sim.insideHouse(tx,tz))return null
      if(sim.wet(tx,tz)&&!sim.surface(tx,tz,'deck',refY+.6,1.8)&&!sim.surface(tx,tz,'landmark',refY+.6,1.8))return null
      if(!sim.freeCapsule(tx,cy,tz))return null
      return {x:tx,y:cy,z:tz,heading:yawTarget,rule:'crash-rider'}
    }
    const direct=trySpot(rx,rz)
    if(direct)return direct
    for(const rad of [.45,.9,1.35]){
      for(let a=0;a<8;a++){
        const ang=a*Math.PI/4
        const alt=trySpot(rx+Math.cos(ang)*rad,rz+Math.sin(ang)*rad)
        if(alt)return alt
      }
    }
    const local=sim.findLocalDismount(bx,bz,crashSession?.heading??0,refY)
    if(local)return {...local,heading:yawTarget}
    const cy=refY+cfg.height/2+.055
    return {x:safe.x,y:safe.y||cy,z:safe.z,heading:yawTarget,rule:'crash-safe'}
  }
  function beginStandUpFromCrash(){
    if(!crashSession||!rides?.bike)return false
    const c=crashSession
    const p=sim.body.translation(), refY=p.y-cfg.height/2
    let bx=c.bikeOriginX+c.bikeSlideX, bz=c.bikeOriginZ+c.bikeSlideZ
    const rawBy=supportAt(bx,bz,refY)?.y??refY
    let by=Math.abs(rawBy-refY)<=1.2?rawBy:refY
    const rx=c.bikeOriginX+c.riderOffsetX, rz=c.bikeOriginZ+c.riderOffsetZ
    const riderYaw=c.heading+c.side*.45
    const lookToBikeYaw=Math.atan2(rx-bx,rz-bz)+avatar.yaw
    const spot=resolveSafeRiderSpot(rx,rz,bx,bz,by,lookToBikeYaw)
    if(!canPlaceCrashOffset(bx,bz,by)){
      if(canPlaceCrashOffset(c.bikeOriginX,c.bikeOriginZ,refY)){
        bx=c.bikeOriginX;bz=c.bikeOriginZ;by=supportAt(bx,bz,refY)?.y??refY
      }else{
        bx=spot.x;bz=spot.z;by=spot.y-cfg.height/2
      }
    }
    if(!place(spot.x,spot.z,'crash-standup',true,spot))return false
    const entry:DownedBikeEntry={
      mesh:c.mesh,
      kind:c.kind,
      x:bx,y:by,z:bz,
      yaw:c.heading+c.side*.18,
      side:c.side,
      roll:-c.side*1.43,
      lift:.19,
      vehicleType:c.vehicleType,
      battery:c.battery,
      modPreset:c.modPreset,
      paint:c.paint,
      hazardOverlay:c.kind==='bike'&&c.battery>0?attachDownedHazard(c.mesh):undefined,
    }
    if(c.kind==='bike')rides.resetEbikeGearOnRecover()
    rides.dismountDownedBike(bx,by,bz,entry.yaw,entry.roll,entry.lift)
    entry.mesh.userData.downedSide=c.side
    downedBikes.add(entry)
    twoWheelOp=resolveTwoWheelTransition(twoWheelOp,{type:'standup',kind:c.kind}).state
    releaseDynamicBike()
    input.syncRideHud(null,null)
    facing=spot.heading
    input.clearRun()
    crashSession=null
    standUpSession={
      elapsed:0,duration:.68,side:c.side,
      x:spot.x,y:spot.y-cfg.height/2,z:spot.z,
      startYaw:riderYaw,targetYaw:lookToBikeYaw,
    }
    action?.fadeOut(.08);action=undefined
    if(traveller)traveller.rotation.set(0,0,0)
    if(!verify||stuntMode){
      window.dispatchEvent(new CustomEvent('walk:toast',{detail:{
        text:`先爬起身站稳，再走近按 F 扶起${c.kind==='bicycle'?'单车':'电动车'}`,
        ms:2200,
      }}))
    }
    return true
  }
  function follow(dt=0,snap=false){const pos=sim.body.translation(),footY=pos.y-cfg.height/2
    figure.position.set(pos.x,footY,pos.z)
    if(downedBikes.size>0)syncAllDownedPoses()
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
      releaseDynamicBike()
      if(mountedStaticCar!==rides.car){
        if(mountedStaticCar)mountedStaticCar.visible=true
        mountedStaticCar=rides.car
        carRig.setPaint((mountedStaticCar.userData.paint as number|undefined)??0)
      }
      mountedStaticCar.visible=false
      carRig.root.visible=true
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
      const carTel=rides.carTelemetry
      carRig.update({
        pos:figure.position,
        heading:rides.heading,
        groundPitch:rides.pitch,
        speed:rides.speed,
        steerInput:rides.steerInput,
        braking:carTel?.braking??lastCarBraking,
        reversing:carTel?.reversing??rides.speed<-.05,
        dynRoll:carTel?.dynRoll,
        dynPitch:carTel?.dynPitch,
        driftIntensity:carTel?.driftIntensity??0,
        handbrake:carTel?.handbrake??false,
        headlight:carHeadlight,
        night:env.night,
        dt,
      })
      driverPose.updateDriving(figure.position,rides.heading,active)
      input.syncCarHud(carTel,carHeadlight)
      const targetSpeedArm=carTel?.gtaPhysics?Math.min(carConfig.speedCameraPull,Math.max(0,(Math.hypot(rides.carVelX,rides.carVelZ)-8.5)*.095)):0
      carSpeedArm=dt>0?THREE.MathUtils.damp(carSpeedArm,targetSpeedArm,4.5,Math.min(.12,dt)):targetSpeedArm
      if(dt>0&&carShake>0){carShake=Math.max(0,carShake-3.8*Math.min(.12,dt));carShakePhase+=Math.min(.12,dt)*46}
    }else if(rides?.bike){
      releaseDynamicCar()
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
      if(mountedStaticBike!==rides.bike){
        if(mountedStaticBike)mountedStaticBike.visible=true
        mountedStaticBike=rides.bike
        if(rides.rideKind==='bicycle')bicycleRig.setPaint((mountedStaticBike.userData.paint as number|undefined)??0)
      }
      mountedStaticBike.visible=false
      if(crashSession){
        const c=crashSession
        const cdt=Math.min(.12,Math.max(0,dt))
        const u=THREE.MathUtils.clamp(c.elapsed/.28,0,1), fallT=u*u*(3-2*u)
        const bounce=c.elapsed>.22&&c.elapsed<.45?Math.sin(((c.elapsed-.22)/.23)*Math.PI)*.08:0
        const bikeRoll=-c.side*1.43*fallT+c.side*bounce
        const bikeLift=.19*fallT
        const bx=c.bikeOriginX+c.bikeSlideX, bz=c.bikeOriginZ+c.bikeSlideZ
        const by=supportAt(bx,bz,figure.position.y)?.y??figure.position.y
        const rigObj:TwoWheelVisualRig=c.kind==='bicycle'?bicycleRig:ebikeRig
        ebikeRig.root.visible=c.kind==='bike'
        bicycleRig.root.visible=c.kind==='bicycle'
        rigObj.update({
          pos:_rigPosTmp.set(bx,by,bz),
          heading:c.heading+c.side*.18*fallT,
          groundPitch:rides.pitch*(1-fallT),
          lean:0,wheelie:0,steerInput:0,speed:0,braking:false,
          crashRoll:bikeRoll,crashLift:bikeLift,
          kickstandDown:false,
          headlight:c.kind==='bike'?twoWheelOp.headlight:'off',
          night:env.night,
          crashed:true,
          hazard:twoWheelOp.hazard,
          dt:cdt,
        })
        rigObj.seatAnchor.getWorldPosition(_seatTmp)
        const rx=c.bikeOriginX+c.riderOffsetX, rz=c.bikeOriginZ+c.riderOffsetZ
        const ry=supportAt(rx,rz,by)?.y??by
        applySprawledCrashPose(figure,riderJoints,fallT,c.side,rx,ry,rz,c.heading,_seatTmp)
        if(c.kind==='bike'){
          const base=ebikeState??ebikeFx.step(0,{speed:0,heading:c.heading,lean:0,steerInput:0,braking:false,obstacle:'',allowAutoCrash:false},ZERO_RIDE_INPUT)
          const dispSpd=c.slideSpeed<.15?0:c.slideSpeed
          ebikeState={...base,speed:dispSpd,kmh:Math.round(dispSpd*3.6),crashPhase:'crashed',crashReason:c.reason,crashSide:c.side,crashElapsed:c.elapsed}
          input.syncRideHud(ebikeState,'bike')
        }else{
          const bcTel=rides.ebikeTelemetry
          const dispSpd=c.slideSpeed<.15?0:c.slideSpeed
          ebikeState={
            vehicleType:'normal',vehicleLabel:'单车',vehicleBadge:'单车',
            gear:bcTel?.gear??rides.ebikeGear,gearCount:bcTel?.gearCount??3,gearLabel:bcTel?.gearLabel??'2挡',gearHint:bcTel?.gearHint??'巡航',maxKmh:bcTel?.maxKmh??21,speed:dispSpd,kmh:Math.round(dispSpd*3.6),
            battery:100,lowBattery:false,criticalBattery:false,batteryDepleted:false,
            lean:0,leanLimit:bcTel?.leanLimit??.31,crashRisk:0,wheelie:0,steerInput:0,
            tucking:false,braking:false,crashPhase:'crashed',crashReason:c.reason,crashSide:c.side,crashElapsed:c.elapsed,recoverProgress:0,modPreset:'stock',
          }
          input.syncRideHud(ebikeState,'bicycle')
        }
        actionButtonEl ??= document.querySelector<HTMLButtonElement>('.vehicle-action')
        if(actionButtonEl)actionButtonEl.hidden=true
      }else if(rides.rideKind==='bike'){
        bicycleRig.root.visible=false
        ebikeRig.root.visible=true
        ebikeState ??= ebikeFx.step(0,{speed:rides.speed,heading:rides.heading,lean:rides.lean,steerInput:rides.steerInput,braking:false,obstacle:'',allowAutoCrash:false},ZERO_RIDE_INPUT)
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
          night:env.night,
          supportY:(sx,sz,refY)=>supportAt(sx,sz,refY)?.y??refY,
        })
        if(ebikeState.crashPhase==='none')applyGripPose(ebikeRig.frontAssembly,mountBlend)
        input.syncRideHud(ebikeState,'bike')
      }else{
        ebikeRig.root.visible=false
        bicycleRig.root.visible=true
        const cdt=Math.min(.12,Math.max(0,dt))
        if(cdt>0){
          bicyclePedalPhase=(bicyclePedalPhase+(rides.speed/.33)*cdt*.48)%(Math.PI*2)
          if(bicyclePedalPhase<0)bicyclePedalPhase+=Math.PI*2
        }
        const bcTel=rides.ebikeTelemetry
        const totalLean=THREE.MathUtils.clamp(bcTel?.lean??rides.lean,-.62,.62)
        const totalWheelie=bcTel?.wheelie??0
        bicycleRig.update({
          pos:figure.position,
          heading:rides.heading,
          groundPitch:rides.pitch,
          lean:totalLean,
          wheelie:totalWheelie,
          steerInput:rides.steerInput,
          speed:rides.speed,
          pedalPhase:bicyclePedalPhase,
          kickstandDown:!!bcTel?.kickstandDown,
          dt:cdt,
        })
        bicycleRig.seatAnchor.getWorldPosition(_seatTmp)
        if(dt>0&&ebikeMountElapsed<bikeConfig.mountDuration)ebikeMountElapsed=Math.min(bikeConfig.mountDuration,ebikeMountElapsed+Math.min(.12,dt))
        const mu=THREE.MathUtils.clamp(ebikeMountElapsed/bikeConfig.mountDuration,0,1), mountBlend=mu*mu*(3-2*mu)
        const swing=mountBlend<1?Math.sin(mountBlend*Math.PI):0
        if(mountBlend<1){
          figure.position.set(
            THREE.MathUtils.lerp(ebikeMountStartPos.x,_seatTmp.x,mountBlend),
            THREE.MathUtils.lerp(ebikeMountStartPos.y,_seatTmp.y,mountBlend)+swing*.18,
            THREE.MathUtils.lerp(ebikeMountStartPos.z,_seatTmp.z,mountBlend),
          )
          figure.rotation.set(0,ebikeMountStartYaw+shortestAngle(ebikeMountStartYaw,rides.heading)*mountBlend,-swing*.10,'YXZ')
        }else{
          figure.position.copy(_seatTmp)
          figure.rotation.set(rides.pitch*.45+totalWheelie*.78,rides.heading,totalLean*.92,'YXZ')
        }
        const idleRaw=(.35-Math.abs(rides.speed))/.35
        const idleT=bcTel?.kickstandDown?1:THREE.MathUtils.clamp(idleRaw,0,1)
        bicycleFootWeight=THREE.MathUtils.damp(bicycleFootWeight,idleT*idleT*(3-2*idleT),10,cdt)
        const [tlPedal,slPedal]=solveBicyclePedalIK(bicyclePedalPhase)
        const [trPedal,srPedal]=solveBicyclePedalIK(bicyclePedalPhase+Math.PI)
        const wheelieFactor=THREE.MathUtils.clamp(totalWheelie/.62,0,1.25)
        const leanRatio=THREE.MathUtils.clamp(totalLean/.56,-1.2,1.2)
        const cadenceSway=(1-bicycleFootWeight)*Math.sin(bicyclePedalPhase)*.035*THREE.MathUtils.clamp(Math.abs(rides.speed)/2.5,0,1)
        const kneeFlareL=leanRatio>.25?-(leanRatio-.25)*.34*(1-bicycleFootWeight):0
        const kneeFlareR=leanRatio<-.25?(-leanRatio-.25)*.34*(1-bicycleFootWeight):0
        const spdRatio=Math.max(0,rides.speed)/5.0
        const bTargets:Record<RiderJointName,[number,number,number]>={
          Hips:[0,0,0],
          Torso:[-.14-spdRatio*.08+wheelieFactor*.22,cadenceSway*.5-rides.steerInput*.06,cadenceSway+leanRatio*.22],
          Head:[.05-wheelieFactor*.26,-rides.steerInput*.20,-leanRatio*.48],
          ArmL:[.86+rides.steerInput*.14+wheelieFactor*.18,-rides.steerInput*.12,-.03],
          ArmR:[.86-rides.steerInput*.14+wheelieFactor*.18,-rides.steerInput*.12,.03],
          ForearmL:[.32+wheelieFactor*.32,0,0],
          ForearmR:[.32+wheelieFactor*.32,0,0],
          ThighL:[THREE.MathUtils.lerp(tlPedal,.52,bicycleFootWeight)-wheelieFactor*.12,0,THREE.MathUtils.lerp(kneeFlareL,-.20,bicycleFootWeight)],
          ThighR:[trPedal-wheelieFactor*.12,0,kneeFlareR],
          ShinL:[THREE.MathUtils.lerp(slPedal,-.50,bicycleFootWeight)+wheelieFactor*.10,0,0],
          ShinR:[srPedal+wheelieFactor*.10,0,0],
        }
        for(const name of RIDER_JOINT_NAMES){
          const j=riderJoints[name]; if(!j)continue
          const [tx,ty,tz]=bTargets[name]
          if(mountBlend<1){
            const from=ebikeMountStartRot.get(name)??[0,0,0]
            j.rotation.set(THREE.MathUtils.lerp(from[0],tx,mountBlend),THREE.MathUtils.lerp(from[1],ty,mountBlend),THREE.MathUtils.lerp(from[2],tz,mountBlend))
          }else j.rotation.set(tx,ty,tz)
        }
        if(swing>1e-4){
          if(riderJoints.ThighR){riderJoints.ThighR.rotation.x+=swing*.35;riderJoints.ThighR.rotation.z-=swing*.55}
          if(riderJoints.ShinR)riderJoints.ShinR.rotation.x-=swing*.30
          if(riderJoints.Torso)riderJoints.Torso.rotation.x-=swing*.14
        }
        ebikeState={
          vehicleType:'normal',vehicleLabel:'单车',vehicleBadge:'单车',
          gear:bcTel?.gear??rides.ebikeGear,gearCount:bcTel?.gearCount??3,gearLabel:bcTel?.gearLabel??'2挡',gearHint:bcTel?.gearHint??'巡航',
          maxKmh:bcTel?.maxKmh??21,speed:rides.speed,kmh:Math.round(Math.abs(rides.speed)*3.6),
          battery:100,lowBattery:false,criticalBattery:false,batteryDepleted:false,
          lean:totalLean,leanLimit:bcTel?.leanLimit??.48,leanRateDegPerSec:bcTel?.leanRateDegPerSec,
          mandatoryFallLeanRad:bcTel?.mandatoryFallLeanRad,effectiveFallLeanRad:bcTel?.effectiveFallLeanRad,
          leanDangerRatio:bcTel?.leanDangerRatio,crashRisk:bcTel?.crashRisk??0,wheelieTip:bcTel?.wheelieTip,
          wheelie:totalWheelie,steerInput:rides.steerInput,
          tucking:bcTel?.tucking??false,braking:bcTel?.braking??false,
          parkLocked:false,kickstandDown:bcTel?.kickstandDown??false,headlight:'off',hazard:false,turnSignal:'off',
          crashPhase:'none',crashReason:'',crashSide:1,crashElapsed:0,recoverProgress:0,modPreset:'stock',
        }
        input.syncRideHud(ebikeState,'bicycle')
      }
    }else if(!rides?.boat){
      releaseDynamicCar()
      releaseDynamicBike()
      input.syncRideHud(null,null)
      if(standUpSession){
        const gy=supportAt(standUpSession.x,standUpSession.z,standUpSession.y)?.y??standUpSession.y
        applyStandUpAnimation(figure,riderJoints,standUpSession.elapsed/standUpSession.duration,standUpSession.side,standUpSession.x,gy,standUpSession.z,standUpSession.startYaw,standUpSession.targetYaw)
        actionButtonEl ??= document.querySelector<HTMLButtonElement>('.vehicle-action')
        if(actionButtonEl)actionButtonEl.hidden=true
      }else if(pickupSession){
        const gy=supportAt(pos.x,pos.z,footY)?.y??footY
        applyPickupBikeAnimation(figure,riderJoints,pickupSession.elapsed/pickupSession.duration,{x:pos.x,y:gy,z:pos.z},facing,pickupSession.rec)
        actionButtonEl ??= document.querySelector<HTMLButtonElement>('.vehicle-action')
        if(actionButtonEl){
          actionButtonEl.hidden=false
          actionButtonEl.textContent=pickupSession.rec.kind==='bicycle'?'正在扶起单车':'正在扶起电动车'
        }
      }else{
        const liveMinY=liveSoleLocalY()
        const animLift=Math.max(soleOffset,-liveMinY)
        const surf=(grounded||Math.abs(velocity)<.05)?sim.groundSurface(pos.x,pos.z,footY):null
        const rawBase=surf&&Math.abs(surf.y-(footY-cfg.skin))<=.14?surf.y:footY-cfg.skin
        const baseY=(grounded||Math.abs(velocity)<.05)?visualFloorAt(pos.x,pos.z,rawBase):rawBase
        figure.position.y=baseY+(grounded||Math.abs(velocity)<.05?animLift:soleOffset)
        rides?.park(figure.position)
        const dismountDone=ridePose.applyDismount(figure.position,facing,dt)||driverPose.applyDismount(figure.position,facing,dt)
        if(dismountDone&&action)mixer.update(0)
        if(!rides?.boat&&boatLandElapsed<BOAT_LAND_DUR){
          if(dt>0)boatLandElapsed=Math.min(BOAT_LAND_DUR,boatLandElapsed+Math.min(.12,dt))
          const u=Math.min(1,boatLandElapsed/BOAT_LAND_DUR), t=u*u*(3-2*u)
          figure.position.lerpVectors(boatLandFrom,figure.position,t)
          figure.position.y+=Math.sin(t*Math.PI)*.10
          figure.rotation.y=boatLandYaw+shortestAngle(boatLandYaw,facing)*t
        }
      }
    }
    const shakeYaw=rides?.car&&carShake>.01?Math.sin(carShakePhase)*carShake*.018:0
    const shakePitch=rides?.car&&carShake>.01?Math.cos(carShakePhase*1.3)*carShake*.012:0
    // IDOK-178: 第一人称只在落地步行时生效，骑车/开车/坐船一律回到第三人称，免得镜头钻进车壳。
    const firstPerson=isFirstPerson()&&!rides?.bike&&!rides?.car&&!rides?.boat
    rig.update(camera,figure.position,yaw+shakeYaw,pitch+shakePitch,arm+ridePose.cameraArm(!!rides?.bike,dt,snap)+driverPose.cameraArm(!!rides?.car,dt,snap)+(rides?.car?carSpeedArm:0),dt,snap,!!rides?.car,firstPerson)
    // 只在切换的那一下动 figure.visible，不每帧覆盖拍照模式「隐藏人物」、商店展台等别处的设定。
    if(firstPerson!==firstPersonHidden){firstPersonHidden=firstPerson;figure.visible=active&&!firstPerson}
  }
  const terrainRay=new THREE.Raycaster(undefined,new THREE.Vector3(0,-1,0))
  function boatClearance(){
    const freeClear=rides?.boatClearance(figure,skinned);if(freeClear)return freeClear
    const boat=rides?.boat;if(!boat)return null
    figure.updateMatrixWorld(true);skinned?.skeleton.update()
    const roof=new THREE.Box3().setFromObject(boat,true).max.y,head=passengerTop(figure)
    let underside=Infinity
    for(const along of [-2.3,-1,0,1,2.3])for(const across of [-1,0,1]){const point=boat.localToWorld(new THREE.Vector3(across,0,along)),deck=sim.surface(point.x,point.z,'deck');if(deck)underside=Math.min(underside,deck.y-(deck.thin?.6:look.bridgeDepth))}
    return {kind:boat.name,head,roof,underside,clearance:underside-Math.max(head,roof)}}
  function sit(){mixer.stopAllAction();action=undefined;bankLean=strideLean=0;wasBike=false;if(traveller)traveller.rotation.set(0,0,0);ridePose.reset()
    for(const side of ['L','R'] as const)for(const [part,value] of Object.entries({Thigh:1.25,Shin:-1.4,Arm:.9,Forearm:.35})){
      const joint=riderJoints[(part+side) as keyof RiderJoints];if(joint)joint.rotation.x=value}}
  function probe(){const pos=sim.body.translation(),foot=pos.y-cfg.height/2,peak=sim.surface(pos.x,pos.z,'peak')
    const tile=sim.tileAt(pos.x,pos.z),mesh=tile&&stream.loaded.get(tile)?.groundMesh
    terrainRay.ray.origin.set(pos.x,4000,pos.z);mesh?.updateWorldMatrix(true,false)
    const inBore=tunnelFloor(manifest.tunnels,pos.x,pos.z,foot)!==undefined
    const floorMesh=inBore&&tile?stream.loaded.get(tile)?.tunnel?.floor:undefined
    floorMesh?.updateWorldMatrix(true,false)
    const fringe=tile&&stream.loaded.get(tile)?.tunnel?.fringe
    fringe?.updateWorldMatrix(true,false)
    const surfaces=floorMesh?[floorMesh]:[...(mesh?[mesh]:[]),...(fringe?[fringe]:[])]
    const renderY=terrainRay.intersectObjects(surfaces,false)[0]?.point.y
    const surf=sim.groundSurface(pos.x,pos.z,foot), soleY=figure.position.y+liveSoleLocalY()
    const surfaceY=surf?visualFloorAt(pos.x,pos.z,surf.y):undefined, footSink=surfaceY!==undefined?surfaceY-soleY:0
    return {x:pos.x,z:pos.z,foot,renderY,renderClearance:foot-(renderY??Infinity),clearance:foot-(sim.surface(pos.x,pos.z,'ground')?.y??Infinity),soleY,surfaceY,surfaceKind:surf?.kind,footSink,inHouse:sim.insideHouse(pos.x,pos.z)||sim.overlaps('building'),
      inPeak:(!inBore&&!!peak&&peak.y>foot+.3)||sim.overlaps('peak'),deck:sim.surface(pos.x,pos.z,'deck')?.y,wet:sim.wet(pos.x,pos.z),blockedWater,resets,steps,physicsMs,elapsed,hits:lastHits,
      contactSources:verify?Array.from({length:sim.controller.numComputedCollisions()},(_,index)=>{
        const contact=sim.controller.computedCollision(index),handle=contact?.collider?.handle
        return handle===undefined?null:{source:sim.sources.get(handle)??sim.kinds.get(handle),point:contact!.witness1,normal:contact!.normal1}
      }):[],
      planarSpeed:Math.hypot(vx,vz),grounded,verticalVelocity:velocity,crouching,animClip:activeClipName,facing,figPos:figure.position.toArray(),figYaw:figure.rotation.y,bikePitch:rides?.bikePitch??0,bikeY:rides?.bikeY??0,carPitch:rides?.carPitch??0,carY:rides?.carY??0,
      pedalPhase:rides?.rideKind==='bicycle'?bicyclePedalPhase:ridePose.pedalPhase,thighL:getAvatarJoint(figure,'ThighL')?.rotation.x??0,thighR:getAvatarJoint(figure,'ThighR')?.rotation.x??0,
      figPitch:figure.rotation.x,figRoll:figure.rotation.z,
      ebike:ebikeState,
      ebikeAudio:ebikeAudio.probe(),
      ebikeRig:ebikeRig.root.visible?{
        wheelie:ebikeRig.wheeliePivot.rotation.x,
        longPitch:ebikeState?.longPitch??0,
        lean:ebikeRig.leanPivot.rotation.z,
        crashRoll:ebikeRig.crashPivot.rotation.z,
        steer:ebikeRig.frontAssembly.rotation.y,
        frontWheelSpin:ebikeRig.frontWheel.rotation.x,
        rearWheelSpin:ebikeRig.rearWheel.rotation.x,
        kickstandAngle:ebikeRig.kickstandAngle,
        headlight:ebikeRig.beamProbe().mode,
        headlightIntensity:ebikeRig.beamProbe().intensity,
        beamActive:ebikeRig.beamProbe().beamActive,
        beamDrawCalls:ebikeRig.beamProbe().drawCalls,
        leftSignalLit:ebikeRig.signalProbe().leftSignalLit,
        rightSignalLit:ebikeRig.signalProbe().rightSignalLit,
        brakeLight:ebikeRig.signalProbe().brakeLight,
        signalDrawCalls:ebikeRig.signalProbe().signalDrawCalls,
        drawCallStats:ebikeRig.drawCallStats(),
        modDrawCallDelta:ebikeRig.drawCallStats().modDrawCallDelta,
        visibleModMeshes:ebikeRig.drawCallStats().visibleModMeshes,
        seatWorld:ebikeRig.seatAnchor.getWorldPosition(new THREE.Vector3()).toArray(),
      }:null,
      bicycleRig:bicycleRig.root.visible?{
        wheelie:bicycleRig.wheeliePivot.rotation.x,
        lean:bicycleRig.leanPivot.rotation.z,
        crashRoll:bicycleRig.crashPivot.rotation.z,
        steer:bicycleRig.frontAssembly.rotation.y,
        frontWheelSpin:bicycleRig.frontWheel.rotation.x,
        rearWheelSpin:bicycleRig.rearWheel.rotation.x,
        seatWorld:bicycleRig.seatAnchor.getWorldPosition(new THREE.Vector3()).toArray(),
      }:null,
      carRig:carRig.root.visible?carRig.probe():null,
      carTelemetry:rides?.carTelemetry??null,
      twoWheelFlow:crashSession?'crashed':standUpSession?'standing_up':pickupSession?'picking_up':rides?.bike?'riding':'foot',
      downedCount:downedBikes.size,
      downedBikes:Array.from(downedBikes).map(r=>({kind:r.kind,x:r.x,z:r.z,roll:r.roll,dist:Math.hypot(r.x-pos.x,r.z-pos.z)})),
      camDist:rig.distance,camClipped:rig.clipped,camBlocked:rig.blocked,camCeiling:rig.ceilingClearance,camInHouse:sim.insideHouse(camera.position.x,camera.position.z,camera.position.y),
      outfit:outfitController.getSnapshot(),
      boat:rides?.boatProbe()??null}}
  function tick(dt:number){wheel.sync();if(!active)return;emote.reset();holdLayer.reset();
    if(emote.id&&(rides?.boat||rides?.car||rides?.bike)){emote.stop();emote.tick(.24,false)}
    smoking?.resetPose();const before=performance.now(),start=rides?.boat?.position??sim.body.translation();sim.sync(start.x,start.z);const footYNow=rides?.boat?start.y:start.y-cfg.height/2;rides?.nearby(start.x,start.z,footYNow);interactArbiter.sync(actionButton);syncGameTravelState();updateShopHintRings(start.x,start.z,footYNow)
    if(shopOverlay?.isOpen()){updateShopShowcaseCamera();return}
    // Test-ride 90s timer & 350m / quiet-zone boundary watchdog (with 1.5s gentle decel when >15 km/h)
    const activeTr=getGameState().garage.activeTestRide
    if(activeTr){
      const nowMs=Date.now()
      const distFromOrigin=Math.hypot(start.x-activeTr.origin[0],start.z-activeTr.origin[1])
      const inQuiet=Boolean(getQuietZoneAt(start.x,start.z))
      const isRidingTr=rides?.bikeOwnership==='test_ride'
      const oob=distFromOrigin>activeTr.maxRadiusM||inQuiet
      if(oob){
        if(!testRideOobSince){
          testRideOobSince=nowMs
          if(!verify||stuntMode)window.dispatchEvent(new CustomEvent('walk:toast',{detail:{text:inQuiet?'前方为校园安静区，5 秒后将自动结束试驾':'超出 350m 试驾范围，请 5 秒内折返',ms:2200}}))
        }
      }else{
        testRideOobSince=0
      }
      const timedOut=nowMs>=activeTr.expiresAt
      const oobExpired=testRideOobSince>0&&nowMs-testRideOobSince>=5000
      if(!isRidingTr&&distFromOrigin>15&&rides?.bike===null){
        finishActiveTestRide('dismount_far')
      }else if(timedOut||oobExpired){
        const endReason:'timeout'|'out_of_bounds'=timedOut?'timeout':'out_of_bounds'
        if(isRidingTr&&Math.abs(rides?.speed??0)>15/3.6&&testRideBrakeTimer<1.5){
          testRideBrakeTimer+=Math.min(.12,dt)
          const limit=Math.max(0,(15/3.6)*(1-testRideBrakeTimer/1.5))
          rides?.capSpeed(Math.min(.12,dt),limit)
        }else{
          finishActiveTestRide(endReason)
        }
      }
    }
    if(rides?.freeBoat){
      releaseDynamicBike();input.syncRideHud(null,'boat')
      const read=held?still:input.read(dt), firstFrame=!wasBoat
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
    if((rides?.car||rides?.bike)&&!vehicleCollisionReady(start.x,start.y,start.z)){
      rides.stop();vx=vz=accumulator=0;bikeObstacle='streaming';return
    }
    const read=input.read(dt),keys=held?still:read
    const rideCtrl=held?ZERO_RIDE_INPUT:input.readRideControls()
    const busyFootAnim=!!(standUpSession||pickupSession)
    wish.set(keys.right*Math.cos(yaw)-keys.forward*Math.sin(yaw),-keys.forward*Math.cos(yaw)-keys.right*Math.sin(yaw))
    if(external)wish.set(external.x,external.z)
    if(busyFootAnim)wish.set(0,0)
    const rawLen=wish.length(), inputMag=busyFootAnim?0:Math.min(1,rawLen)
    if(rawLen>1e-5)wish.divideScalar(rawLen);else wish.set(0,0)
    const maxSpeed=(external?external.run:keys.run)?cfg.run:(keys.crouch&&grounded)?cfg.crouch:cfg.walk
    crouching=!rides?.car&&!rides?.bike&&!rides?.boat&&!busyFootAnim&&grounded&&!!keys.crouch&&!keys.run&&!external?.run
    const step=1/60;let traveled=0,simSteps=0;lastHits=[];blockedWater=false
    let bikeSpeed=(rides?.car||rides?.bike)?rides.speed:0
    if((wasCar&&!rides?.car)||(wasBike&&!rides?.bike)){
      applyFootController()
      if(wasCar&&!rides?.car){releaseDynamicCar();figure.visible=active}
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
      mountedStaticCar=rides.car;mountedStaticCar.visible=false
      carRig.setPaint((mountedStaticCar.userData.paint as number|undefined)??0)
      carRig.root.visible=true;prevCarSpeed=0;prevCarObstacle='';lastCarBraking=false;carShake=0;carSpeedArm=0
      const useCarGta=carGtaOverride??defaultCarGta
      rides.setCarGtaPhysics(useCarGta)
      rides.setCarMode(useCarGta?'street':'cruise')
      carHeadlightManual=false
      carHeadlight=env.night>=.45?'low':'off'
    }
    if(rides?.bike&&!wasBike){
      const bx=rides.bike.position.x,bz=rides.bike.position.z,cur=sim.body.translation()
      sim.sync(bx,bz)
      const sup=supportAt(bx,bz,rides.bike.position.y)
      const by=sup?sup.y:rides.bike.position.y
      ridePose.startMount({x:cur.x,y:cur.y-cfg.height/2,z:cur.z},figure.rotation.y)
      ebikeMountStartPos.set(cur.x,cur.y-cfg.height/2,cur.z)
      ebikeMountStartYaw=figure.rotation.y
      ebikeMountElapsed=0
      for(const name of RIDER_JOINT_NAMES){
        const r=riderJoints[name]?.rotation
        ebikeMountStartRot.set(name,r?[r.x,r.y,r.z]:[0,0,0])
      }
      mountedStaticBike=rides.bike
      mountedStaticBike.visible=false
      const paint=(mountedStaticBike.userData.paint as number|undefined)??0
      const rKind=rides.rideKind==='bicycle'?'bicycle':'bike'
      rides.setEbikeEnvironmentHour(env.hour)
      const initTel=rides.ebikeTelemetry
      twoWheelOp=resolveTwoWheelTransition(twoWheelOp,{type:'mount',kind:rKind,verifyMode:verify,nightLevel:env.night,parkStart:initTel?.parkLocked}).state
      if(initTel){
        twoWheelOp={...twoWheelOp,parkLocked:initTel.parkLocked,kickstandDown:initTel.kickstandDown,headlight:initTel.headlight,hazard:initTel.hazard}
        prevAudioPark=initTel.parkLocked
        prevAudioGear=initTel.gear
        prevAudioLight=initTel.headlight
        prevAudioBlink=initTel.blinkOn
        prevAudioHorn=initTel.hornActive
      }
      ebikeAudio.playPowerOn(rKind)
      if(rides.rideKind==='bike'){
        const vType:EbikeVehicleType=rides.vehicleType??(rides.isShared||rides.bike.userData.shared?'shared':'normal')
        const savedBat=(rides.bike.userData.battery as number|undefined)??rides.ebikeBattery??100
        const visualMods=rides.bike.userData.visualMods as PersistedEbikeVisual|undefined
        const isPersonalOrTest=rides.bikeOwnership==='personal'||rides.bikeOwnership==='test_ride'
        const savedMod:EbikeModPreset=vType==='shared'?'stock':(visualMods?.preset??(rides.bike.userData.modPreset as EbikeModPreset|undefined)??'stock')
        ebikeFx.resetForMount(vType,savedBat)
        ebikeFx.setModPreset(savedMod)
        if(!isPersonalOrTest){
          rides.setEbikeUpgrades(ebikeModUpgrades(vType,ebikeFx.modPreset))
        }
        bicycleRig.root.visible=false
        ebikeRig.root.visible=true
        ebikeRig.setVehicleType(vType,paint)
        ebikeRig.applyMods(visualMods??ebikeFx.customMods??ebikeFx.modPreset,paint)
      }else{
        ebikeRig.root.visible=false
        bicycleRig.root.visible=true
        bicycleRig.setPaint(paint)
      }
      crashSession=null;prevTwoWheelSpeed=0
      bicyclePedalPhase=0;bicycleFootWeight=1
      rides.setAutoCrash(autoCrashOverride??(!verify||stuntMode))
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
    if(wasBike&&rides?.bike&&!crashSession){
      rides.setEbikeEnvironmentHour(env.hour)
      // Consume one-shot pulse inputs ONCE per rendered frame (never inside multi-substep physics loop).
      if(rideCtrl.parkToggle)rides.toggleEbikePark()
      if(rideCtrl.kickstandToggle)rides.toggleEbikeKickstand()
      if(rideCtrl.headlightCycle){
        const nextHl=rides.cycleEbikeHeadlight()
        if(!verify||stuntMode){
          const hlText=nextHl==='high'?'远光灯已开启':nextHl==='low'?'近光灯已开启':'车灯已关闭'
          window.dispatchEvent(new CustomEvent('walk:toast',{detail:{text:hlText,ms:1600}}))
        }
      }
      if(rideCtrl.turnLeftToggle)rides.toggleEbikeTurnSignal('left')
      if(rideCtrl.turnRightToggle)rides.toggleEbikeTurnSignal('right')
      if(rideCtrl.hazardToggle)rides.toggleEbikeHazard()
      if(rideCtrl.hornPulse)rides.pulseEbikeHorn()
      if(rideCtrl.cruiseToggle)rides.toggleEbikeCruise()
      if(rideCtrl.gearSelect!==null)rides.setEbikeGear(rideCtrl.gearSelect)
      else if(rideCtrl.gearDelta!==0)rides.shiftEbikeGear(rideCtrl.gearDelta)
    }else if(wasCar&&rides?.car){
      if(!carHeadlightManual){
        carHeadlight=env.night>=.45?'low':'off'
      }
      if(rideCtrl.headlightCycle){
        carHeadlight=nextHeadlightMode(carHeadlight)
        carHeadlightManual=true
        if(!verify||stuntMode){
          const hlText=carHeadlight==='high'?'轿车远光灯已开启':carHeadlight==='low'?'轿车近光灯已开启':'轿车大灯已关闭'
          window.dispatchEvent(new CustomEvent('walk:toast',{detail:{text:hlText,ms:1600}}))
        }
      }
      if(rideCtrl.gearSelect!==null)rides.setCarModeByIndex(rideCtrl.gearSelect)
      else if(rideCtrl.gearDelta!==0)rides.shiftCarMode(rideCtrl.gearDelta)
    }
    const aboardGround=wasCar||wasBike
    if(keys.jump&&!aboardGround&&!busyFootAnim)jumpTimer=cfg.jumpBuffer
    accumulator+=Math.min(.12,dt)
    while(accumulator>=step-1e-7){accumulator=Math.max(0,accumulator-step);steps++;simSteps++;elapsed+=step
      if(grounded)coyoteTimer=cfg.coyote;else coyoteTimer=Math.max(0,coyoteTimer-step)
      if(!aboardGround&&!busyFootAnim&&jumpTimer>0&&coyoteTimer>0){
        velocity=Math.sqrt(-2*cfg.gravity*cfg.jump)
        grounded=false;coyoteTimer=0;jumpTimer=0;crouching=false;jumpStage='start';jumpStageTimer=0;setSnap(false)
      }else jumpTimer=Math.max(0,jumpTimer-step)
      if(velocity<=0)setSnap(true)

      if(wasCar&&rides?.car){
        const previous=rides.heading
        driverPose.advanceMount(step)
        bikeSpeed=rides.steerCar(keys.forward,keys.right,step,driverPose.mounted,{handbrake:rideCtrl.wheelie})
        wish.set(-Math.sin(rides.heading),-Math.cos(rides.heading))
        vx=rides.carVelX;vz=rides.carVelZ
        const carTel=rides.carTelemetry
        if(driverPose.mounted){
          if(carTel?.gtaPhysics){
            const planar=Math.hypot(vx,vz)
            const dHeading=shortestAngle(previous,rides.heading)
            // GTA chase camera: trails drifting tail slightly, then smoothly swings back behind velocity vector.
            yaw+=dHeading*(1-Math.min(.55,rides.carDrift*.68))
            if(planar>3.5){
              const travelHeading=Math.atan2(-vx,-vz)
              const goalYaw=rides.speed>=0
                ?rides.heading+shortestAngle(rides.heading,travelHeading)*(rides.carDrift>.12?.55:.20)
                :rides.heading
              yaw+=shortestAngle(yaw,goalYaw)*(1-Math.exp(-(rides.carDrift>.15?4.6:2.6)*step))
            }
          }else{
            yaw+=rides.heading-previous
          }
        }else{
          yaw+=shortestAngle(yaw,rides.heading)*(1-Math.exp(-10*step))
        }
      }else if(wasBike&&rides?.bike){
        const previous=rides.heading
        ridePose.advanceMount(step)
        // Only lock steering input while actively crashed; ride.ts natively handles P-gear/kickstand interlock and brake-hold unlock!
        const crashLocked=!!crashSession||(rides.rideKind==='bike'&&ebikeFx.crashPhase!=='none')
        if(crashLocked)rides.stop()
        const stepCtrl=!crashLocked&&(rides.rideKind==='bike'||rides.rideKind==='bicycle')
          ?{wheelie:rideCtrl.wheelie?1:0,tuck:rideCtrl.tuck,horn:rideCtrl.horn}
          :undefined
        bikeSpeed=rides.steer(crashLocked?0:keys.forward,crashLocked?0:keys.right,step,ridePose.mounted&&!crashLocked,stepCtrl)
        wish.set(-Math.sin(rides.heading),-Math.cos(rides.heading))
        if(ridePose.mounted&&!crashLocked)yaw+=rides.heading-previous
        else if(!crashLocked)yaw+=shortestAngle(yaw,rides.heading)*(1-Math.exp(-10*step))
        vx=wish.x*bikeSpeed;vz=wish.y*bikeSpeed
      }else if(!aboardGround){
        if(busyFootAnim){vx=vz=0}
        else{
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
      }

      const pos=sim.body.translation()
      velocity+=(velocity>0?cfg.gravity:cfg.fallGravity)*step
      const stepDx=(wasCar?vx:aboardGround?wish.x*bikeSpeed:vx)*step, stepDz=(wasCar?vz:aboardGround?wish.y*bikeSpeed:vz)*step
      const foot=pos.y-cfg.height/2
      const surfLm=!wasCar&&sim.surface(pos.x,pos.z,'landmark',foot+.25,.7)
      const flushRoad=!wasCar&&!surfLm&&sim.surface(pos.x,pos.z,'road',foot+.25,.45)
      const overheadRoad=!wasCar&&!surfLm&&!flushRoad&&sim.surface(pos.x,pos.z,'road',foot+2.2,1.4)
      const onLandmark=!wasCar&&(!!surfLm||(wasLandmarkHit&&(!flushRoad||Math.abs(flushRoad.y-foot)>.28))||(!!overheadRoad&&overheadRoad.y>foot+.8))
      const filterRoad=onLandmark?(coll:import('@dimforge/rapier3d-compat').Collider)=>sim.kinds.get(coll.handle)!=='road':undefined
      const horzDist=Math.hypot(stepDx,stepDz)
      const spatialSubs=aboardGround&&horzDist>.14?Math.min(6,Math.ceil(horzDist/.14)):1
      const inspectBikeCollisions=(dirX:number,dirZ:number,footY:number):{hit:''|'collision'|'building',minDot:number}=>{
        let hit:''|'collision'|'building'='', minDot=1
        for(let at=0;at<sim.controller.numComputedCollisions();at++){
          const contact=sim.controller.computedCollision(at)
          if(!contact||contact.normal1.y>=Math.cos(bikeConfig.maxSlope))continue
          const dot=contact.normal1.x*dirX+contact.normal1.z*dirZ
          if(dot>=-.2)continue
          const kind=contact.collider?sim.kinds.get(contact.collider.handle):undefined
          if(kind==='sidewalk'||kind==='road')continue
          if((kind==='deck'||kind==='deckThin'||kind==='ground'||kind==='landmark')&&contact.witness1.y<=footY+bikeConfig.step+.05)continue
          if(dot<minDot)minDot=dot
          if(kind==='building')hit='building'
          else if(!hit)hit='collision'
        }
        return {hit,minDot}
      }
      const classifyBikeCollision=(dirX:number,dirZ:number,footY:number):''|'collision'|'building'=>inspectBikeCollisions(dirX,dirZ,footY).hit
      let move={x:0,y:0,z:0}
      let next={x:pos.x,y:pos.y,z:pos.z}
      let substepHit:''|'collision'|'building'=''
      let substepBlocked=false
      if(spatialSubs===1){
        sim.controller.computeColliderMovement(sim.capsule,{x:stepDx,y:velocity*step,z:stepDz},undefined,undefined,filterRoad)
        move=sim.controller.computedMovement()
        next={x:pos.x+move.x,y:pos.y+move.y,z:pos.z+move.z}
        if(rides?.bike&&Math.abs(bikeSpeed)>1e-4){
          const bikeSign=bikeSpeed>=0?1:-1,dirX=wish.x*bikeSign,dirZ=wish.y*bikeSign
          const subDist=Math.hypot(stepDx,stepDz),subFwd=move.x*dirX+move.z*dirZ
          const col=inspectBikeCollisions(dirX,dirZ,next.y-cfg.height/2)
          if(col.hit&&(col.minDot<=-.45||subFwd<subDist*.65)){substepHit=col.hit;substepBlocked=true}
          const rayHit=sim.bikePathBlocked(pos.x,pos.z,next.x,next.z,Math.max(foot,next.y-cfg.height/2)+.45,bikeConfig.maxSlope)
          if(rayHit){
            if(rayHit==='building'||!substepHit)substepHit=rayHit
            substepBlocked=true
            next={x:pos.x,y:pos.y,z:pos.z};move={x:0,y:0,z:0}
          }
        }
      }else{
        const subDx=stepDx/spatialSubs, subDy=(velocity*step)/spatialSubs, subDz=stepDz/spatialSubs
        const bikeSign=bikeSpeed>=0?1:-1
        const dirX=wish.x*bikeSign,dirZ=wish.y*bikeSign
        const subDist=Math.hypot(subDx,subDz)
        for(let sub=0;sub<spatialSubs;sub++){
          const cur=sim.body.translation()
          sim.controller.computeColliderMovement(sim.capsule,{x:subDx,y:subDy,z:subDz},undefined,undefined,filterRoad)
          const subMove=sim.controller.computedMovement()
          const cand={x:cur.x+subMove.x,y:cur.y+subMove.y,z:cur.z+subMove.z}
          const candFoot=cand.y-cfg.height/2
          const subFwd=subMove.x*dirX+subMove.z*dirZ
          if(rides?.bike&&sim.controller.numComputedCollisions()>0){
            const col=inspectBikeCollisions(dirX,dirZ,candFoot)
            if(col.hit==='building'||(!substepHit&&col.hit))substepHit=col.hit
            if(col.hit&&(col.minDot<=-.45||subFwd<subDist*.65||Math.hypot(subMove.x,subMove.z)<subDist*.55)){
              substepBlocked=true
              next={x:cur.x,y:cur.y,z:cur.z}
              move={x:next.x-pos.x,y:next.y-pos.y,z:next.z-pos.z}
              break
            }
          }
          const rayHit=rides?.bike
            ?sim.bikePathBlocked(cur.x,cur.z,cand.x,cand.z,Math.max(cur.y-cfg.height/2,candFoot)+.45,bikeConfig.maxSlope)
            :(sim.pathBlocked(cur.x,cur.z,cand.x,cand.z,Math.max(cur.y-cfg.height/2,candFoot)+.45)?'collision':'')
          const houseBlocked=sim.insideHouse(cand.x,cand.z,cand.y)
          if(rayHit||houseBlocked){
            if(houseBlocked)substepHit='building'
            else if(rayHit==='building'||!substepHit)substepHit=rayHit
            substepBlocked=true
            next={x:cur.x,y:cur.y,z:cur.z}
            move={x:next.x-pos.x,y:next.y-pos.y,z:next.z-pos.z}
            break
          }
          next=cand
          move={x:next.x-pos.x,y:next.y-pos.y,z:next.z-pos.z}
          if(sub<spatialSubs-1){
            sim.body.setTranslation(next,true)
            sim.body.setNextKinematicTranslation(next)
            sim.world.step()
          }
          if(sim.controller.numComputedCollisions()>0&&Math.hypot(subMove.x,subMove.z)<subDist*.55){substepBlocked=true;break}
        }
      }
      if(aboardGround&&sim.insideHouse(next.x,next.z,next.y)){
        if(rides?.bike){
          substepHit='building';substepBlocked=true
          next={x:pos.x,y:pos.y,z:pos.z};move={x:0,y:0,z:0};vx=vz=0
        }else{
          next={x:pos.x,y:pos.y,z:pos.z};vx=vz=0;rides?.stop();bikeSpeed=0;bikeObstacle='building'
        }
      }
      if(bridge&&!stream.landmarks.has(bridge)){
        const distance=bridgeDistance(pos.x,pos.z)
        if(distance<cfg.collisionRadius){
          stream.updateLandmarks?.(bridgeEye.set(pos.x,pos.y,pos.z),bridge)
          const ahead=bridgeDistance(next.x,next.z)
          if(ahead<=0&&ahead<distance){next.x=pos.x;next.z=pos.z}
        }
      }
      const nowGrounded=sim.controller.computedGrounded()
      if(velocity<=0){
        if(nowGrounded){grounded=true;velocity=0}
        else if(move.y>velocity*step*.25&&Math.abs(move.y)<.005){
          const ledge=sim.groundSurface(next.x,next.z,next.y-cfg.height/2)
          if(ledge&&(next.y-cfg.height/2)-ledge.y<=.14){grounded=true;velocity=0}
          else{grounded=false;velocity=Math.max(velocity,-2)}
        }else grounded=false
      }else if(move.y<velocity*step*.25)velocity=0
      let touchedLandmark=false
      for(let at=0;at<sim.controller.numComputedCollisions();at++){const coll=sim.controller.computedCollision(at)?.collider;if(coll){const k=sim.kinds.get(coll.handle);if(k==='landmark')touchedLandmark=true;if(verify)lastHits.push(k==='deckThin'?'deck':k??'')}}
      wasLandmarkHit=touchedLandmark
      const nextTile=sim.tileAt(next.x,next.z)
      if(nextTile&&!stream.loaded.has(nextTile)){next.x=pos.x;next.z=pos.z;vx=vz=0;rides?.stop();bikeSpeed=0}
      const inBore=tunnelFloor(manifest.tunnels,next.x,next.z,next.y-cfg.height/2)!==undefined
      const ground=inBore?sim.surface(next.x,next.z,'road',next.y+1,5):sim.surface(next.x,next.z,'ground')
      if(!ground||next.y-cfg.height/2<ground.y-3){if(place(safe.x,safe.z,'rescue'))resets++;break}
      if(sim.wet(next.x,next.z)){
        const foot=next.y-cfg.height/2,deck=sim.surface(next.x,next.z,'deck')
        if(!deck||foot<deck.y-.35){
          // A raised carriageway can cross a wet terrain cell without a
          // separate bridge deck. Require solid support above the waterline.
          const tread=sim.surface(next.x,next.z,'landmark',foot+.6,1.4)
            ?? sim.groundSurface(next.x,next.z,foot)
          const tile=sim.tileAt(next.x,next.z),water=tile&&stream.loaded.get(tile)?.water
          const level=tile&&water?water[Math.round((next.z-tile.z)/4)*65+Math.round((next.x-tile.x)/4)]/10:Infinity
          if(!tread||tread.y<level){next.x=pos.x;next.z=pos.z;vx=vz=0;blockedWater=true;if(!rides?.bike||!substepHit){rides?.stop();bikeSpeed=0}}
        }
      }
      if(rides?.car){
        const res=rides.resolveCarMove({
          pos,next,move,heading:rides.heading,speed:bikeSpeed,step,
          motorPavement:(x,z)=>tunnelFloor(manifest.tunnels,x,z,foot)!==undefined||rides!.motorPavement(x,z),insideHouse:sim.insideHouse,
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
        vx=rides.carVelX;vz=rides.carVelZ
        const impactPulse=rides.consumeCarImpact()
        if(impactPulse>0){
          carRig.triggerImpact(impactPulse)
          carShake=Math.max(carShake,Math.min(1.35,impactPulse*.85))
        }
        if(res.blocked){bikeObstacle=res.reason}
        else if(Math.hypot(vx,vz)>.15){bikeObstacle=''}
      }
      else if(rides?.bike){
        const res=rides.resolveMove({
          pos,next,move,heading:rides.heading,speed:bikeSpeed,step,
          pavement:rides.pavement,insideHouse:sim.insideHouse,
          blockedAt:(x,y,z)=>sim.isBlockedAt(x,y,z),
          wetSurface:sim.wet(next.x,next.z),
          collisionBlocked:substepBlocked,
          collisionKind:(dirX,dirZ)=>substepHit||classifyBikeCollision(dirX,dirZ,next.y-cfg.height/2),
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
      const preContactSpeed=rides?.bike?Math.abs(bikeSpeed):0
      if(resolveContact(next,next.y-cfg.height/2,rides?.heading??0,rides?.car?.86:rides?.bike?.32:cfg.radius,rides?.car?2.12:rides?.bike?.85:0)){
        vx=vz=bikeSpeed=0
        if(rides?.bike){
          rides.tryBikeImpactCrash(preContactSpeed)
          rides.stop()
          bikeObstacle='collision'
        }else if(rides?.car){
          rides.stop()
          bikeObstacle='collision'
        }
      }
      if((rides?.bike||rides?.car)&&vehicleForbiddenAt(next.x,next.z)){
        next.x=pos.x;next.y=pos.y;next.z=pos.z;rides.stop();bikeSpeed=vx=vz=0;bikeObstacle='restricted'
      }
      if(!sim.withinBounds(next.x,next.z)){
        next.x=pos.x;next.z=pos.z;vx=vz=bikeSpeed=0
        if(rides?.bike||rides?.car)rides.stop()
      }
      traveled+=Math.hypot(next.x-pos.x,next.z-pos.z);sim.body.setNextKinematicTranslation(next);sim.world.step();if(grounded&&!blockedWater)safe.set(next.x,next.y,next.z)
    }
    physicsMs+=performance.now()-before
    const clampedFrameDt=Math.min(.12,Math.max(0,dt))
    if(standUpSession){
      standUpSession.elapsed+=clampedFrameDt
      if(standUpSession.elapsed>=standUpSession.duration){
        facing=standUpSession.targetYaw
        standUpSession=null
        figure.rotation.x=figure.rotation.z=0
        clearAvatarPose(figure)
      }
    }else if(pickupSession){
      pickupSession.elapsed+=clampedFrameDt
      const p=sim.body.translation()
      const goalYaw=Math.atan2(p.x-pickupSession.rec.x,p.z-pickupSession.rec.z)+avatar.yaw
      facing+=shortestAngle(facing,goalYaw)*Math.min(1,12*clampedFrameDt)
      if(pickupSession.elapsed>=pickupSession.duration){
        const rec=pickupSession.rec
        const curFootY=p.y-cfg.height/2
        let rx=rec.x, ry=rec.y, rz=rec.z
        if(!sim.findLocalMount(p.x,curFootY,p.z,rx,ry,rz).ok){
          const pullCandidates:[number,number][]=[
            [THREE.MathUtils.lerp(rec.x,p.x,.45),THREE.MathUtils.lerp(rec.z,p.z,.45)],
            [THREE.MathUtils.lerp(rec.x,p.x,.90),THREE.MathUtils.lerp(rec.z,p.z,.90)],
          ]
          for(const rad of [.6,1.0,1.45]){
            for(let a=0;a<8;a++){const ang=a*Math.PI/4;pullCandidates.push([rec.x+Math.cos(ang)*rad,rec.z+Math.sin(ang)*rad])}
          }
          for(const [cx,cz] of pullCandidates){
            const rawCy=supportAt(cx,cz,curFootY)?.y??curFootY
            const cy=Math.abs(rawCy-curFootY)<=1.2?rawCy:curFootY
            if(sim.findLocalMount(p.x,curFootY,p.z,cx,cy,cz).ok){rx=cx;ry=cy;rz=cz;break}
          }
        }
        const completed=resolveTwoWheelTransition(twoWheelOp,{type:'pickup_complete',kind:rec.kind}).state
        twoWheelOp=completed
        removeDownedHazard(rec)
        ebikeAudio.playPickupComplete()
        const restRoll=computeParkedRoll(false,0,rec.kind==='bike'&&completed.kickstandDown)
        if(rides){
          rides.relocateParkedBike(rec.mesh,rx,ry,rz,rec.yaw,restRoll,{parkLocked:completed.parkLocked,kickstandDown:completed.kickstandDown})
        }else{
          rec.mesh.userData.downed=false
          rec.mesh.position.set(rx,ry,rz)
          rec.mesh.rotation.set(0,rec.yaw,restRoll,'YXZ')
        }
        downedBikes.delete(rec)
        pickupSession=null
        figure.rotation.x=figure.rotation.z=0
        clearAvatarPose(figure)
        if(!verify||stuntMode){
          window.dispatchEvent(new CustomEvent('walk:toast',{detail:{
            text:`${rec.kind==='bicycle'?'单车':'电动车'}已扶正立好边撑，按 F 上车`,
            ms:2000,
          }}))
        }
      }
    }
    if(wasCar&&rides?.car){
      const curSpd=rides.speed
      lastCarBraking=(keys.forward<-.05&&curSpd>.25)||(Math.abs(curSpd)<Math.abs(prevCarSpeed)-.04&&curSpd>.35)
      if(bikeObstacle&&bikeObstacle!==prevCarObstacle&&Math.abs(prevCarSpeed)>2.0){
        carRig.triggerImpact(Math.min(2.2,Math.abs(prevCarSpeed)*.18+.35))
      }
      prevCarSpeed=curSpd
      prevCarObstacle=bikeObstacle
    }
    if(wasBike&&rides?.bike){
      const p=sim.body.translation()
      const refY=p.y-cfg.height/2
      const allowAutoCrash=autoCrashOverride??(!verify||stuntMode)
      if(crashSession){
        rides.stop()
        crashSession.elapsed+=clampedFrameDt
        if(crashSession.slideSpeed>.05&&clampedFrameDt>0){
          const fwdX=-Math.sin(crashSession.heading), fwdZ=-Math.cos(crashSession.heading)
          const sideX=Math.cos(crashSession.heading)*crashSession.side, sideZ=-Math.sin(crashSession.heading)*crashSession.side
          const bStep=crashSession.slideSpeed*.34*clampedFrameDt
          const rStep=crashSession.slideSpeed*.76*clampedFrameDt
          const curBx=crashSession.bikeOriginX+crashSession.bikeSlideX, curBz=crashSession.bikeOriginZ+crashSession.bikeSlideZ
          const nextBx=crashSession.bikeSlideX+fwdX*bStep+sideX*bStep*.42
          const nextBz=crashSession.bikeSlideZ+fwdZ*bStep+sideZ*bStep*.42
          let moved=false
          if(canPlaceCrashOffset(crashSession.bikeOriginX+nextBx,crashSession.bikeOriginZ+nextBz,refY,curBx,curBz)){
            crashSession.bikeSlideX=nextBx;crashSession.bikeSlideZ=nextBz;moved=true
          }
          const curRx=crashSession.bikeOriginX+crashSession.riderOffsetX, curRz=crashSession.bikeOriginZ+crashSession.riderOffsetZ
          const nextRx=crashSession.riderOffsetX+fwdX*rStep-sideX*rStep*.62
          const nextRz=crashSession.riderOffsetZ+fwdZ*rStep-sideZ*rStep*.62
          if(canPlaceCrashOffset(crashSession.bikeOriginX+nextRx,crashSession.bikeOriginZ+nextRz,refY,curRx,curRz)){
            crashSession.riderOffsetX=nextRx;crashSession.riderOffsetZ=nextRz;moved=true
          }
          crashSession.slideSpeed=moved?Math.max(0,crashSession.slideSpeed-8.5*clampedFrameDt):0
          if(crashSession.slideSpeed<.15)crashSession.slideSpeed=0
        }
        if(rideCtrl.recover||keys.jump)crashRecoverQueued=true
        const wantStandUp=crashSession.elapsed>=.28&&(crashRecoverQueued||Math.abs(keys.forward)>.2||Math.abs(keys.right)>.2)
        if(wantStandUp){crashRecoverQueued=false;beginStandUpFromCrash()}
      }else if(rides.rideKind==='bike'){
        if(rideCtrl.cycleMod){
          const nextPreset=ebikeFx.cycleModPreset()
          rides.setEbikeUpgrades(ebikeModUpgrades(ebikeFx.vehicleType,nextPreset))
          ebikeRig.applyMods(ebikeFx.customMods??nextPreset,(mountedStaticBike?.userData.paint as number|undefined)??0)
          if(mountedStaticBike)mountedStaticBike.userData.modPreset=nextPreset
        }
        const rawTel=rides.ebikeTelemetry
        if(rawTel){
          twoWheelOp={...twoWheelOp,parkLocked:rawTel.parkLocked,kickstandDown:rawTel.kickstandDown,headlight:rawTel.headlight,hazard:rawTel.hazard}
          if(rawTel.parkLocked!==prevAudioPark){ebikeAudio.playParkToggle(rawTel.parkLocked);prevAudioPark=rawTel.parkLocked}
          if(!rawTel.parkLocked&&rawTel.gear!==prevAudioGear){ebikeAudio.playGearShift(rawTel.gear,'bike');prevAudioGear=rawTel.gear}
          if(rawTel.headlight!==prevAudioLight){ebikeAudio.playLightSwitch(rawTel.headlight);prevAudioLight=rawTel.headlight}
          const blinkerActive=rawTel.hazard||rawTel.turnSignal!=='off'
          if(blinkerActive&&rawTel.blinkOn!==prevAudioBlink)ebikeAudio.playTurnRelay(rawTel.blinkOn)
          prevAudioBlink=blinkerActive?rawTel.blinkOn:false
          if(rawTel.hornActive!==prevAudioHorn){ebikeAudio.setHorn(rawTel.hornActive,'bike');prevAudioHorn=rawTel.hornActive}
          ebikeAudio.updateContinuous({
            active:true,rideKind:'bike',speed:rawTel.speed,throttle:keys.forward,
            braking:rawTel.braking,parked:rawTel.parkLocked||rawTel.kickstandDown,
            leanRisk:rawTel.leanDangerRatio,dt:clampedFrameDt,
          })
        }
        const extTel:ExternalEbikeTelemetry|undefined=rawTel?{
          vehicleType:rawTel.vehicleType,
          isShared:rawTel.isShared,
          gear:rawTel.gear,
          gearCount:rawTel.gearCount,
          gearLabel:rawTel.gearLabel,
          gearHint:rawTel.gearHint,
          maxKmh:rawTel.maxKmh,
          battery:rawTel.batteryPct,
          lowBattery:rawTel.lowBattery,
          criticalBattery:rawTel.criticalBattery,
          batteryDepleted:rawTel.batteryDepleted,
          wheelie:rawTel.wheelie,
          longPitch:rawTel.longPitch,
          lean:rawTel.lean,
          leanLimit:rawTel.leanLimit,
          leanRateDegPerSec:rawTel.leanRateDegPerSec,
          mandatoryFallLeanRad:rawTel.mandatoryFallLeanRad,
          effectiveFallLeanRad:rawTel.effectiveFallLeanRad,
          leanDangerRatio:rawTel.leanDangerRatio,
          crashRisk:rawTel.crashRisk,
          wheelieTip:rawTel.wheelieTip,
          tucking:rawTel.tucking,
          braking:rawTel.braking,
          parkLocked:rawTel.parkLocked,
          kickstandDown:rawTel.kickstandDown,
          throttleBlockedByPark:rawTel.throttleBlockedByPark,
          parkWarnSeq:rawTel.parkWarnSeq,
          headlight:rawTel.headlight,
          taillight:rawTel.taillight,
          brakeLight:rawTel.brakeLight,
          turnSignal:rawTel.turnSignal,
          leftSignalLit:rawTel.leftSignalLit,
          rightSignalLit:rawTel.rightSignalLit,
          hazard:rawTel.hazard,
          blinkOn:rawTel.blinkOn,
          hornActive:rawTel.hornActive,
          hornSeq:rawTel.hornSeq,
          cruiseControl:rawTel.cruiseControl,
          cruiseTargetKmh:rawTel.cruiseTargetKmh,
        }:undefined
        ebikeState=ebikeFx.step(dt,{
          speed:rides.speed,
          heading:rides.heading,
          lean:rides.lean,
          steerInput:rides.steerInput,
          braking:keys.forward<-.05&&rides.speed>.2,
          obstacle:bikeObstacle,
          allowAutoCrash:false,
        },rideCtrl.cycleMod?{...rideCtrl,cycleMod:false}:rideCtrl,extTel,{
          canPlace:(ox,oz)=>canPlaceCrashOffset(p.x+ox,p.z+oz,refY,p.x,p.z),
          supportY:(ox,oz,ry)=>supportAt(p.x+ox,p.z+oz,ry)?.y??ry,
        })
        if(mountedStaticBike)mountedStaticBike.userData.battery=ebikeState.battery
        if(rawTel&&rawTel.crashPhase!=='none'){
          triggerTwoWheelCrash(rawTel.crashReason||'lowside',rawTel.crashSide??(rides.lean>=0?1:-1))
        }
        prevTwoWheelSpeed=Math.abs(rides.speed)
      }else{
        const rawTel=rides.ebikeTelemetry
        if(rawTel){
          twoWheelOp={...twoWheelOp,parkLocked:false,kickstandDown:rawTel.kickstandDown,headlight:'off',hazard:false}
          if(rawTel.gear!==prevAudioGear){ebikeAudio.playGearShift(rawTel.gear,'bicycle');prevAudioGear=rawTel.gear}
          if(rawTel.hornActive!==prevAudioHorn){ebikeAudio.setHorn(rawTel.hornActive,'bicycle');prevAudioHorn=rawTel.hornActive}
          ebikeAudio.updateContinuous({
            active:true,rideKind:'bicycle',speed:rawTel.speed,throttle:keys.forward,
            braking:rawTel.braking,parked:rawTel.kickstandDown,
            leanRisk:rawTel.leanDangerRatio,dt:clampedFrameDt,
          })
          if(rawTel.crashPhase!=='none'){
            triggerTwoWheelCrash(rawTel.crashReason||'lowside',rawTel.crashSide??(rides.lean>=0?1:-1))
          }
        }
        prevTwoWheelSpeed=Math.abs(rides.speed)
      }
    }
    const actualSpeed=simSteps>0?traveled/(simSteps*step):Math.hypot(vx,vz)
    let turnDiff=0
    if(!aboardGround&&!standUpSession&&!pickupSession){
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
      const sprinting=actualSpeed>7.4||(running&&inputMag>.8&&actualSpeed>6.8)
      if(!wasGroundedFoot&&grounded){
        jumpStage=moving?'none':'land'
        jumpStageTimer=0
      }
      wasGroundedFoot=grounded

      let clipKey:keyof typeof avatar.clips='idle'
      if(!grounded){
        jumpStageTimer+=clampedFrameDt
        if(jumpStage==='start'&&jumpStageTimer<.16&&velocity>1.2)clipKey='jumpStart'
        else{jumpStage='air';clipKey='jumpAir'}
      }else if(jumpStage==='land'){
        jumpStageTimer+=clampedFrameDt
        if(!moving&&jumpStageTimer<.22)clipKey='jumpLand'
        else{jumpStage='none'}
      }
      if(grounded&&jumpStage!=='land'){
        clipKey=crouching?(!moving?'crouchIdle':'crouchWalk'):!moving?'idle':sprinting?'sprint':running?'run':'walk'
      }
      const resolvedName=(actions.has(avatar.clips[clipKey])?avatar.clips[clipKey]:undefined)
        ??(!grounded?avatar.clips.jump:crouching?avatar.clips.walk:moving&&sprinting?avatar.clips.run:avatar.clips[clipKey])
        ??avatar.clips.idle
      activeClipName=resolvedName
      const nextAction=actions.get(resolvedName)
      if(nextAction){
        const isOneShot=clipKey==='jumpStart'||clipKey==='jumpLand'
        if(action!==nextAction){
          action?.fadeOut(isOneShot?.06:.12)
          nextAction.setLoop(isOneShot?THREE.LoopOnce:THREE.LoopRepeat,isOneShot?1:Infinity)
          nextAction.clampWhenFinished=isOneShot
          nextAction.reset().fadeIn(isOneShot?.06:.12).play()
          action=nextAction
        }
        nextAction.timeScale=clipKey==='crouchWalk'?THREE.MathUtils.clamp(actualSpeed/cfg.crouch,.55,1.35)
          :clipKey==='walk'?THREE.MathUtils.clamp(actualSpeed/cfg.walk,.55,1.35)
          :clipKey==='run'?THREE.MathUtils.clamp(actualSpeed/6.4,.65,1.3)
          :clipKey==='sprint'?THREE.MathUtils.clamp(actualSpeed/cfg.run,.72,1.25):1
      }
    }
    if(!standUpSession&&!pickupSession)mixer.update(dt)
    applyCameraHold(dt)
    follow(dt)
    if(smoking){if(rides?.bike||rides?.boat||rides?.car)cigarette.stop();if(cigarette.advance(dt))smoking.drop();smoking.tick(dt,cigarette.view(),isFirstPerson())}
    const emoteMoving=!!(keys.right||keys.forward||external?.x||external?.z)
    if(emote.id&&interrupted(emote.id,emoteMoving,!emotesEnabled()||!canEmote()||keys.jump||!grounded))emote.stop()
    emote.tick(dt,emoteMoving)
    net?.tick(dt)
  }
  let cameraHold=false,camHoldBlend=0
  let holdAim={forward:.32,up:.13,side:-.04}
  const holdLayer=cameraHoldLayer(figure),holdTarget=holdLayer.target,holdEffector=new THREE.Vector3()
  function applyCameraHold(dt:number){
    const target=cameraHold?1:0
    camHoldBlend+=Math.sign(target-camHoldBlend)*Math.min(Math.abs(target-camHoldBlend),Math.max(dt,.001)*5)
    holdLayer.apply(camHoldBlend,holdAim)
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
  return {emote,get net(){return net},photoSupport,enter,leave,tick,get destination(){return destination},spawns,probe,boatClearance,parked(kind?:import('./ride').RideKind|'car'){return rides?.parked(kind)??[]},get freeMoorings(){return rides?.freeMoorings()??[]},get boatKind(){return rides?.freeKind??null},get obstacle(){return bikeObstacle},get vehicle(){return rides?.car?'car':rides?.bike?(rides.rideKind==='bicycle'?'bicycle':'bike'):rides?.boat?'boat':'foot'},get heading(){return rides?.heading??0},get speed(){return rides?.speed??0},get active(){return active},drive(x:number,z:number,run=true){external={x,z,run}},
    ebike:{
      get state(){return ebikeState},
      triggerCrash(reason:Exclude<EbikeCrashReason,''>='lowside',side:-1|1=1){if(rides?.bike)triggerTwoWheelCrash(reason,side)},
      recover(){return crashSession?beginStandUpFromCrash():false},
      pickupNearest(){
        if(rides?.bike||rides?.car||rides?.boat||standUpSession||pickupSession)return false
        const p=sim.body.translation(), rec=findDownedNear(p.x,p.z,4.5)
        if(!rec)return false
        twoWheelOp=resolveTwoWheelTransition(twoWheelOp,{type:'pickup_start',kind:rec.kind}).state
        pickupSession={rec,elapsed:0,duration:.56,startYaw:facing}
        action?.fadeOut(.08);action=undefined
        if(traveller)traveller.rotation.set(0,0,0)
        return true
      },
      setMod(preset:EbikeModPreset){ebikeFx.setModPreset(preset);rides?.setEbikeUpgrades(ebikeModUpgrades(ebikeFx.vehicleType,ebikeFx.modPreset));ebikeRig.applyMods(ebikeFx.modPreset,(mountedStaticBike?.userData.paint as number|undefined)??0);if(mountedStaticBike)mountedStaticBike.userData.modPreset=ebikeFx.modPreset},
      setVehicleType(type:EbikeVehicleType){rides?.setEbikeVehicleType(type);ebikeFx.setVehicleType(type);rides?.setEbikeUpgrades(ebikeModUpgrades(type,ebikeFx.modPreset));const paint=(mountedStaticBike?.userData.paint as number|undefined)??0;ebikeRig.setVehicleType(type,paint);ebikeRig.applyMods(ebikeFx.customMods??ebikeFx.modPreset,paint);if(mountedStaticBike)mountedStaticBike.userData.modPreset=ebikeFx.modPreset},
      setBattery(pct:number){const clamped=rides?.rideKind==='bike'?rides.setEbikeBattery(pct):pct;ebikeFx.setBattery(clamped);if(mountedStaticBike)mountedStaticBike.userData.battery=clamped},
      setGear(gear:number){return rides?.setEbikeGear(gear)??2},
      shiftGear(delta:number){return rides?.shiftEbikeGear(delta)??2},
      setAutoCrash(on:boolean|undefined){autoCrashOverride=on;rides?.setAutoCrash(on)},
      togglePark(silent=false){if(crashSession)return false;return rides?.toggleEbikePark(silent)??false},
      setPark(on:boolean,silent=false){if(crashSession)return false;return rides?.setEbikePark(on,silent)??false},
      toggleKickstand(silent=false){if(crashSession)return false;return rides?.toggleEbikeKickstand(silent)??false},
      setKickstand(on:boolean,silent=false){if(crashSession)return false;return rides?.setEbikeKickstand(on,silent)??false},
      cycleLight(){if(crashSession)return 'off' as EbikeHeadlightMode;return rides?.cycleEbikeHeadlight()??'off'},
      cycleHeadlight(){if(crashSession)return 'off' as EbikeHeadlightMode;return rides?.cycleEbikeHeadlight()??'off'},
      setHeadlight(mode:TwoWheelHeadlightMode){if(crashSession)return 'off' as EbikeHeadlightMode;return rides?.setEbikeHeadlight(mode,true)??'off'},
      setTurnSignal(dir:EbikeTurnSignal){return rides?.setEbikeTurnSignal(dir)??'off'},
      toggleTurnSignal(dir:Exclude<EbikeTurnSignal,'off'>){return rides?.toggleEbikeTurnSignal(dir)??'off'},
      setHazard(on:boolean){return rides?.setEbikeHazard(on)??false},
      toggleHazard(){return rides?.toggleEbikeHazard()??false},
      setHorn(pressed:boolean){return rides?.setEbikeHorn(pressed)??false},
      pulseHorn(){return rides?.pulseEbikeHorn()??0},
      setCruise(on:boolean,silent=false){return rides?.setEbikeCruise(on,silent)??false},
      toggleCruise(silent=false){return rides?.toggleEbikeCruise(silent)??false},
      get audioStats(){return ebikeAudio.probe()},
    },
    car:{
      get telemetry(){return rides?.carTelemetry??null},
      setMode(mode:CarDriveMode){return rides?.setCarMode(mode)??mode},
      shiftMode(delta:number){return rides?.shiftCarMode(delta)??'street'},
      setGtaPhysics(on:boolean|undefined){carGtaOverride=on;if(on!==undefined)rides?.setCarGtaPhysics(on)},
      cycleLight(){carHeadlight=nextHeadlightMode(carHeadlight);carHeadlightManual=true;return carHeadlight},
      setHeadlight(mode:TwoWheelHeadlightMode){carHeadlight=mode;carHeadlightManual=true;return carHeadlight},
    },
    shop:{
      open:(shopId:string,tab?:string)=>shopOverlay?.openShop(shopId,tab),
      openService:(shopId:string)=>shopOverlay?.openServiceBay(shopId),
      openWardrobe:()=>openSafeWardrobe(),
      openGarage:()=>shopOverlay?.openGarage(),
      close:(reason?:ShopCloseReason)=>shopOverlay?.close(reason),
      isOpen:()=>shopOverlay?.isOpen(),
      triggerInteract:()=>interactArbiter.trigger(),
      getInteractDecision:()=>interactArbiter.getLastDecision(),
      getShowroomStands:()=>showroomBikes.map(item=>({
        id:item.stand.id,
        modelId:item.stand.modelId,
        visible:item.mesh.visible,
        snapped:item.snapped,
        pos:item.mesh.position.toArray(),
        yaw:item.mesh.rotation.y,
        paintColor:item.mesh.userData.paintColor as number|undefined,
      })),
      ringsVisible:()=>shopHintGroup.visible&&shopRings.some(item=>item.ring.visible),
      showcaseVisible:()=>shopEbikeShowcaseRig.root.visible,
    },
    outfit:{
      getSnapshot:()=>outfitController.getSnapshot(),
      setPreview:(equipped:EquippedOutfit|null)=>outfitController.setPreview(equipped),
      setRidingEbike:(riding:boolean)=>outfitController.setRidingEbike(riding),
    },
    garage:{
      summon:(vehicleId?:string)=>summonPersonalWithToast(vehicleId),
      spawnAtBay:(shopId:string,vehicleId:string)=>rides?.spawnPersonalBikeAtBay(shopId,vehicleId)??false,
      refreshVisual:(vehicleId:string)=>rides?.refreshPersonalBikeVisual(vehicleId)??false,
      startTestRide:(shopId:string,modelId:PersonalEbikeModelId)=>rides?.startTestRide(shopId,modelId)??{ok:false,code:'INVALID_SHOP'},
      endTestRide:(reason:'timeout'|'out_of_bounds'|'user'|'dismount_far'|'mode_switch'|'purchase'='user')=>{finishActiveTestRide(reason)},
    },
    get yaw(){return yaw},hold(on:boolean){held=on;external=null;if(on){rides?.stop();vx=vz=0}},face(heading:number,tilt=cfg.pitch){yaw=heading;pitch=tilt;if(active)follow(0,true)},showFigure(on:boolean){figure.visible=on&&active},
    // IDOK-182: 右手挂点给相机用（axis-aligned，-Z 朝前）；没有骨骼时回落到 figure 本身。
    handAnchor(){return avatarRig.attachmentAt?.('hand_r')??figure.getObjectByName('hand_r')??figure},
    raycastObstacle:verify?(x:number,y:number|undefined,z:number,dx:number,dy:number,dz:number,maxDist=160)=>{
      sim.sync(x,z)
      const footY=sim.body.translation().y-cfg.height/2
      const baseY=y??((supportAt(x,z,footY)?.y??footY)+.55)
      return sim.raycastObstacle(x,baseY,z,dx,dy,dz,maxDist)
    }:undefined,
    pavementAt:verify?(x:number,z:number)=>Boolean(rides?.pavement(x,z)):undefined,
    insideHouseAt:verify?(x:number,z:number,y?:number)=>sim.insideHouse(x,z,y):undefined,
    // IDOK-188: 持机时把右手抬到胸前；aim 是相对脊柱的身体坐标偏移（米），现场微调用。
    setCameraHold(on:boolean,pose?:{aim?:{forward?:number;up?:number;side?:number}}){
      cameraHold=on
      if(pose?.aim)holdAim={...holdAim,...pose.aim}
    },
    cameraHoldPose(pose?:{aim?:{forward?:number;up?:number;side?:number}}){
      if(pose?.aim)holdAim={...holdAim,...pose.aim}
      figure.getObjectByName('hand_r')?.getWorldPosition(holdEffector)
      return {aim:{...holdAim},blend:camHoldBlend,hand:[holdEffector.x,holdEffector.y,holdEffector.z],target:[holdTarget.x,holdTarget.y,holdTarget.z]}
    },
    get position(){const pos=rides?.boat?.position??sim.body.translation();return posOut.set(pos.x,pos.y,pos.z)}}
}
