import {getPlayMode} from '../game/play-mode'
import R from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import {look} from '../look/config'
import {walkConfig as cfg} from './config'
import {nearbyTunnels,tunnelCeiling,type Tunnel} from '../station-tunnels'
import type {createPhysics} from './physics'
import driveCamera from '../drive/camera.json' with {type:'json'}

type Physics = Awaited<ReturnType<typeof createPhysics>>
const identity = {x:0,y:0,z:0,w:1}

export function createCameraRig(sim:Physics, tunnels:Tunnel[] = []) {
  const roofs=tunnels.filter(section=>!section.openCut)
  const ball = new R.Ball(cfg.camRadius), ray = new R.Ray({x:0,y:0,z:0},{x:0,y:1,z:0})
  const focus = new THREE.Vector3(), dir = new THREE.Vector3(), goal = new THREE.Vector3(), check = new THREE.Vector3()
  const filter = (coll:R.Collider)=>{const kind=sim.kinds.get(coll.handle);return kind!==undefined&&kind!=='tree'}
  let currentDist = cfg.far, lastClipped = false, lastBlocked = false, lastCeiling = Infinity, initialized = false

  function ceilingAt(x:number, z:number, footY:number) {
    const deck = sim.hasDeck(x,z)?sim.surface(x,z,'deck',footY+18,20):null
    const underside=deck && footY<deck.y-.55?deck.y-(deck.thin?.6:look.bridgeDepth):Infinity
    return Math.min(underside,tunnelCeiling(roofs,x,z,footY))-cfg.camRadius
  }

  function castClear(direction:THREE.Vector3, maxDist:number) {
    let safe = maxDist
    ray.origin.x = focus.x; ray.origin.y = focus.y; ray.origin.z = focus.z
    ray.dir.x = direction.x; ray.dir.y = direction.y; ray.dir.z = direction.z
    const rayHit = sim.world.castRay(ray,maxDist,true,undefined,undefined,sim.capsule,undefined,filter)
    if(rayHit) safe = Math.min(safe,Math.max(.12,rayHit.timeOfImpact-cfg.camRadius-.03))
    const shapeHit = sim.world.castShape(focus,identity,direction,ball,.02,maxDist,false,undefined,undefined,sim.capsule,undefined,filter)
    if(shapeHit) safe = Math.min(safe,Math.max(.12,shapeHit.time_of_impact-.02))
    return safe
  }

  let priorFov:number|undefined
  function update(camera:THREE.PerspectiveCamera, figurePos:THREE.Vector3, yaw:number, pitch:number, desiredDist:number, dt:number, snap=false,driving=false,first=false,lowerFocus=0) {
    if(driving && priorFov===undefined){priorFov=camera.fov;camera.fov=driveCamera.fov;camera.updateProjectionMatrix()}
    else if(!driving && priorFov!==undefined){camera.fov=priorFov;priorFov=undefined;camera.updateProjectionMatrix()}
    // IDOK-178 第一人称：相机直接落在眼睛上，不做第三人称那一整套防穿透/天花板收束（那条路径会
    // 把相机顶到 0.12m 的最小安全距离上，玩家会看到自己后脑勺）。
    if(first){
      focus.set(figurePos.x,figurePos.y+1.62-lowerFocus,figurePos.z)
      // 第三人称默认俯视 cfg.pitch；第一人称把它减掉，默认平视，仰视余量也够看山顶。
      const eyePitch=pitch-cfg.pitch
      dir.set(Math.sin(yaw)*Math.cos(eyePitch),Math.sin(eyePitch),Math.cos(yaw)*Math.cos(eyePitch))
      // dir 指向身后（第三人称相机在 focus+dir·dist、看向 focus），所以第一人称要朝 -dir 看。
      camera.position.copy(focus).addScaledVector(dir,-.08)
      camera.lookAt(focus.x-dir.x,focus.y-dir.y,focus.z-dir.z)
      currentDist=0;lastClipped=false;lastBlocked=false;lastCeiling=Infinity;initialized=false
      return
    }
    const footY = figurePos.y
    let focusY = footY+(driving?driveCamera.height:1.4)-lowerFocus
    const hasStartDeck = sim.hasDeck(figurePos.x,figurePos.z)
    const headCeil = ceilingAt(figurePos.x,figurePos.z,footY)
    if(Number.isFinite(headCeil)) focusY = Math.max(footY+.85,Math.min(focusY,headCeil-.04))
    ray.origin.x = figurePos.x; ray.origin.y = footY+.55; ray.origin.z = figurePos.z
    ray.dir.x = 0; ray.dir.y = 1; ray.dir.z = 0
    const overhead = sim.world.castRay(ray,document.body.hasAttribute('data-aboard')?1.15:.95,false,undefined,undefined,sim.capsule,undefined,filter)
    if(overhead) focusY = Math.max(footY+.85,Math.min(focusY,footY+.55+overhead.timeOfImpact-cfg.camRadius))

    focus.set(figurePos.x,focusY,figurePos.z)
    dir.set(Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch))
    if(getPlayMode()==='solo' && dir.y>0)desiredDist=Math.min(desiredDist,5/dir.y)
    goal.copy(focus).addScaledVector(dir,desiredDist)

    const anyDeck = hasStartDeck||sim.hasDeck(goal.x,goal.z)||sim.hasDeck((focus.x+goal.x)*.5,(focus.z+goal.z)*.5)
    const anyRoof = anyDeck || nearbyTunnels(roofs,focus.x,focus.z).length>0 || nearbyTunnels(roofs,goal.x,goal.z).length>0
    let activeCeil = headCeil
    if(anyRoof) {
      const span = Math.hypot(goal.x-focus.x,goal.z-focus.z), samples = Math.max(4,Math.min(20,Math.ceil(span/1.1)))
      for(let i=1;i<=samples;i++) {
        const frac = i/samples
        const ceil = ceilingAt(focus.x+(goal.x-focus.x)*frac,focus.z+(goal.z-focus.z)*frac,footY)
        if(ceil<activeCeil) activeCeil = ceil
      }
    }
    let targetDist = desiredDist, ducked = false
    if(Number.isFinite(activeCeil) && goal.y>activeCeil) {
      goal.y = activeCeil
      dir.subVectors(goal,focus)
      const len = dir.length()
      if(len>1e-3){dir.divideScalar(len);targetDist = len}
      ducked = true
    }

    const safeDist = castClear(dir,targetDist)

    lastClipped = ducked || safeDist<desiredDist-.05
    if(!initialized || snap || safeDist<=currentDist) {
      currentDist = safeDist
      initialized = true
    } else {
      currentDist = THREE.MathUtils.damp(currentDist,safeDist,cfg.camRecover,Math.min(.1,Math.max(0,dt)))
    }

    camera.position.copy(focus).addScaledVector(dir,currentDist)
    let clampedY = false
    const endCeil = anyRoof?Math.min(activeCeil,ceilingAt(camera.position.x,camera.position.z,footY)):Infinity
    if(Number.isFinite(endCeil) && camera.position.y>endCeil) { camera.position.y = endCeil; clampedY = true }

    const camDeck = anyDeck?sim.surface(camera.position.x,camera.position.z,'deck',footY+18,20):null
    const underDeck = !!camDeck && footY<camDeck.y-.55
    const floor = (!underDeck?camDeck:null)??sim.surface(camera.position.x,camera.position.z,'sidewalk')??sim.surface(camera.position.x,camera.position.z,'road')??sim.surface(camera.position.x,camera.position.z,'ground')
    if(floor) {
      const minY = floor.y+cfg.camRadius
      if(camera.position.y<minY) { camera.position.y = Number.isFinite(endCeil)?Math.min(minY,endCeil):minY; clampedY = true }
    }

    if(clampedY) {
      check.subVectors(camera.position,focus)
      const len = check.length()
      if(len>1e-3) {
        check.divideScalar(len)
        const rechecked = castClear(check,len)
        if(rechecked<len) {
          camera.position.copy(focus).addScaledVector(check,rechecked)
          const reCeil = anyRoof?Math.min(activeCeil,ceilingAt(camera.position.x,camera.position.z,footY)):Infinity
          if(Number.isFinite(reCeil) && camera.position.y>reCeil) camera.position.y = reCeil
          const reDeck = anyDeck?sim.surface(camera.position.x,camera.position.z,'deck',footY+18,20):null
          const reUnder = !!reDeck && footY<reDeck.y-.55
          const reFloor = (!reUnder?reDeck:null)??sim.surface(camera.position.x,camera.position.z,'sidewalk')??sim.surface(camera.position.x,camera.position.z,'road')??sim.surface(camera.position.x,camera.position.z,'ground')
          if(reFloor) {
            const reMinY = reFloor.y+cfg.camRadius
            if(camera.position.y<reMinY) camera.position.y = Number.isFinite(reCeil)?Math.min(reMinY,reCeil):reMinY
          }
        }
      }
    }

    const finalCeil = anyRoof?Math.min(activeCeil,ceilingAt(camera.position.x,camera.position.z,footY)):Infinity
    lastCeiling = Number.isFinite(finalCeil)?finalCeil+cfg.camRadius-camera.position.y:Infinity
    check.subVectors(camera.position,focus)
    const losLen = check.length()
    if(losLen>.18) {
      check.divideScalar(losLen)
      ray.origin.x = focus.x+check.x*.04; ray.origin.y = focus.y+check.y*.04; ray.origin.z = focus.z+check.z*.04
      ray.dir.x = check.x; ray.dir.y = check.y; ray.dir.z = check.z
      lastBlocked = !!sim.world.castRay(ray,losLen-.08,false,undefined,undefined,sim.capsule,undefined,filter)
    } else lastBlocked = false

    camera.lookAt(focus)
  }

  return {
    update,
    focus,
    reset(dist:number){currentDist=dist;initialized=false},
    get distance(){return currentDist},
    get clipped(){return lastClipped},
    get blocked(){return lastBlocked},
    get ceilingClearance(){return lastCeiling},
  }
}
