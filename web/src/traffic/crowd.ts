import * as THREE from 'three'
import {clone} from 'three/addons/utils/SkeletonUtils.js'
import {browNames, eyeNames, faceNames, hairStyles, looks, type Avatar} from '../../../lib/avatar'
import {avatar as figure} from '../look/avatar'

// IDOK-229 路人: pedestrians near the camera are drawn with the same rigged character, face/hair system
// and starter looks as players, and actually walk (walk clip, stride matched to their speed). Far
// pedestrians stay in the traffic BatchedMesh as one-draw stand-ins.

type Walker = {x:number,y:number,z:number,yaw:number,speed:number,scale:number,down:number,kind:string,leaving:boolean}
type Template = {scene:THREE.Object3D,clips:THREE.AnimationClip[]}
type View = {root:THREE.Group,mixer?:THREE.AnimationMixer,walk?:THREE.AnimationAction,idle?:THREE.AnimationAction,
  moving:boolean,template:number,placed:boolean}

// Street mix — present-day casual first; uniforms/office are a minority.
const LOOK_WEIGHTS:Record<(typeof looks)[number],number>={basic:5,sport:8,outdoor:9,chinese:6,office:4,campus:3,
  hoodie:6,shell:6,denim:6,plaid:5,knit:5,track:5}
const STRIDE=1.65 // m/s the walk clip is authored for (pipeline/avatar_walk.py)

function weighted<T extends string>(table:Record<T,number>,u:number){
  const entries=Object.entries(table) as [T,number][]
  let total=0;for(const [,w] of entries)total+=w
  u*=total;for(const [key,w] of entries){if((u-=w)<0)return key}
  return entries[entries.length-1][0]
}

export function randomPasserby(random:()=>number):Avatar{
  const r=(n:number)=>Math.floor(random()*n)
  const body=random()<.5?'m':'f'
  let look=weighted(LOOK_WEIGHTS,random())
  if(look==='campus'&&random()<.5)look='sport'
  return {v:1,body,skin:[0,1,1,2,2,2,3,3,4][r(9)],face:r(faceNames.length),brows:r(browNames.length),eyes:r(eyeNames.length),
    hair:hairStyles[body][r(6)],hairColor:[0,0,0,1,1,2,3][r(7)],look,createdAt:1}
}

export function crowd(scene:THREE.Scene,camera:THREE.Camera){
  const mobile=matchMedia('(pointer: coarse)').matches
  const LIMIT=mobile?6:14,RANGE=mobile?45:70,POOL=mobile?8:16
  const templates:(Promise<Template>|undefined)[]=new Array(POOL),ready:(Template|undefined)[]=new Array(POOL)
  const assigned=new WeakMap<object,number>(),active=new Map<Walker,View>()
  let seed=0x2290
  const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/2**32}
  function template(index:number){
    if(!templates[index]){
      const look=randomPasserby(random)
      templates[index]=import('../walk/character').then(async mod=>{
        const model=await mod.previewCharacter(look)
        model.scene.userData={}
        const t={scene:model.scene,clips:model.animations}
        ready[index]=t
        return t
      })
      templates[index]!.catch(error=>{templates[index]=undefined;console.warn('passer-by unavailable',error)})
    }
    return ready[index]
  }
  function release(walker:Walker,view:View){
    active.delete(walker);view.root.removeFromParent();view.mixer?.stopAllAction()
    view.root.traverse(node=>{if(node instanceof THREE.SkinnedMesh)node.skeleton.dispose()})
  }
  function build(walker:Walker):View|undefined{
    let index=assigned.get(walker)
    if(index===undefined){index=Math.floor(Math.random()*POOL);assigned.set(walker,index)}
    const t=template(index);if(!t)return
    const root=new THREE.Group(),instance=clone(t.scene)
    root.name='G2 passer-by';root.add(instance)
    const mixer=new THREE.AnimationMixer(instance)
    const clip=(name:string)=>t.clips.find(item=>item.name===name)
    const walkClip=clip(figure.clips.walk),idleClip=clip(figure.clips.idle)
    const walk=walkClip?mixer.clipAction(walkClip):undefined,idle=idleClip?mixer.clipAction(idleClip):undefined
    walk?.play();walk?.setEffectiveWeight(1)
    walk&&(walk.time=Math.random()*walk.getClip().duration)
    idle?.play();idle?.setEffectiveWeight(0)
    scene.add(root)
    const view={root,mixer,walk,idle,moving:true,template:index,placed:false}
    active.set(walker,view)
    return view
  }
  return {
    /** Picks which pedestrians get a character this step; returns the set the batch must hide. */
    select(actors:readonly Walker[]){
      const cx=camera.position.x,cz=camera.position.z
      const near=actors.filter(a=>a.kind==='person'&&!a.down&&(a.x-cx)**2+(a.z-cz)**2<RANGE**2)
        .sort((a,b)=>((a.x-cx)**2+(a.z-cz)**2)-((b.x-cx)**2+(b.z-cz)**2)).slice(0,LIMIT)
      const keep=new Set(near)
      for(const [walker,view] of active)if(!keep.has(walker))release(walker,view)
      const shown=new Set<object>()
      for(const walker of near){if(active.has(walker)||build(walker))shown.add(walker)}
      return shown
    },
    /** Every frame: extrapolate along the heading between 20 Hz sim steps, blend walk/idle, advance clips. */
    animate(dt:number,lag:number){
      const alpha=1-Math.exp(-18*dt)
      for(const [walker,view] of active){
        const tx=walker.x+Math.sin(walker.yaw)*walker.speed*lag,tz=walker.z+Math.cos(walker.yaw)*walker.speed*lag
        const pos=view.root.position
        if(!view.placed){pos.set(tx,walker.y,tz);view.root.rotation.y=walker.yaw+Math.PI;view.placed=true}
        else{
          pos.x+=(tx-pos.x)*Math.min(1,alpha*2);pos.z+=(tz-pos.z)*Math.min(1,alpha*2);pos.y+=(walker.y-pos.y)*alpha
          const turn=walker.yaw+Math.PI-view.root.rotation.y // figure.glb faces −z (walk/index.ts uses atan2(-dx,-dz))
          view.root.rotation.y+=Math.atan2(Math.sin(turn),Math.cos(turn))*alpha
        }
        view.root.scale.setScalar(Math.max(.001,walker.scale))
        const moving=walker.speed>.15
        if(moving!==view.moving&&view.walk&&view.idle){
          view.moving=moving
          if(moving)view.idle.crossFadeTo(view.walk.setEffectiveWeight(1),.25,false)
          else view.walk.crossFadeTo(view.idle.setEffectiveWeight(1),.25,false)
        }
        if(view.walk)view.walk.timeScale=THREE.MathUtils.clamp(walker.speed/STRIDE,.45,1.25)
        view.mixer?.update(dt)
      }
    },
    clear(){for(const [walker,view] of active)release(walker,view)},
    get count(){return active.size},
    probe:()=>[...active.values()].map(v=>[v.root.position.x,v.root.position.y,v.root.position.z,v.root.rotation.y,Number(v.moving)]),
  }
}
