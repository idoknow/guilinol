import {touchUi} from '../ui/input-mode'
import {mainDetail} from '../look/mirror-layer'
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
  moving:boolean,template:number,placed:boolean,lastGx:number,lastGz:number,lastGy:number,groundAcc:number,animAcc:number}

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

// IDOK-253 年龄段：学生 / 青年 / 中年 / 老人，各自的穿搭、发型、身高和体态不同，男女各半。
export type Age='student'|'young'|'middle'|'elder'
type Profile={w:number,looks:Partial<Record<(typeof looks)[number],number>>,hair:{m:string[],f:string[]},height:[number,number],girth:number,hairTint?:string[]}
export const AGE_PROFILES:Record<Age,Profile>={
  student:{w:2,looks:{campus:6,track:3,sport:3,hoodie:2},hair:{m:['m_buzz','m_crop','m_fade'],f:['f_pony','f_bangs','f_bun']},height:[.86,.93],girth:.96},
  young:{w:4,looks:{hoodie:5,shell:4,denim:5,plaid:4,sport:3,track:3,basic:2,knit:2},hair:{m:['m_crop','m_perm','m_fade','m_mullet','m_part'],f:['f_long','f_pony','f_lob','f_wolf','f_bangs']},height:[.98,1.04],girth:1},
  middle:{w:3,looks:{office:5,basic:4,knit:3,plaid:3,outdoor:4,chinese:2},hair:{m:['m_part','m_crop','m_buzz'],f:['f_lob','f_bun','f_long']},height:[.96,1.01],girth:1.07},
  elder:{w:2,looks:{chinese:5,knit:4,basic:3,outdoor:3},hair:{m:['m_buzz','m_crop','m_part'],f:['f_bun','f_lob']},height:[.92,.97],girth:1.05,hairTint:['#8d8a84','#b3afa7','#d3d0c8']},
}

export function randomPasserby(random:()=>number,age?:Age):Avatar&{age:Age,height:number,girth:number,hairTint?:string}{
  const r=(n:number)=>Math.floor(random()*n)
  age??=weighted(Object.fromEntries(Object.entries(AGE_PROFILES).map(([key,p])=>[key,p.w])) as Record<Age,number>,random())
  const profile=AGE_PROFILES[age],body=random()<.5?'m':'f'
  const look=weighted(profile.looks as Record<(typeof looks)[number],number>,random())
  const styles=profile.hair[body].filter(name=>(hairStyles[body] as readonly string[]).includes(name))
  const [lo,hi]=profile.height
  return {v:1,body,skin:[0,1,1,2,2,2,3,3,4][r(9)],face:r(faceNames.length),brows:r(browNames.length),eyes:r(eyeNames.length),
    hair:(styles[r(styles.length)]??hairStyles[body][0]) as Avatar['hair'],hairColor:[0,0,0,1,1,2,3][r(7)],look,createdAt:1,
    age,height:(lo+random()*(hi-lo))*(body==='f'?.96:1),girth:profile.girth,hairTint:profile.hairTint?.[r(profile.hairTint.length)]}
}

export function crowd(scene:THREE.Scene,camera:THREE.Camera,groundAt?:(x:number,z:number,y:number,car:boolean)=>number|undefined){
  const mobile=touchUi()
  // IDOK-253: 每街只有 4–8 人，视距内的路人全部用带骨骼的角色，不再在近中景露出方块替身
  const LIMIT=mobile?12:28,RANGE=mobile?80:140,POOL=mobile?10:20
  const templates:(Promise<Template>|undefined)[]=new Array(POOL),ready:(Template|undefined)[]=new Array(POOL)
  const assigned=new WeakMap<object,number>(),active=new Map<Walker,View>()
  const frustum=new THREE.Frustum(),proj=new THREE.Matrix4(),bound=new THREE.Sphere()
  let seed=0x2290
  const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/2**32}
  function template(index:number){
    if(!templates[index]){
      const look=randomPasserby(random)
      templates[index]=import('../walk/character').then(async mod=>{
        const model=await mod.previewCharacter(look)
        const hairMesh=model.scene.userData.creatorHair as THREE.Object3D|undefined
        model.scene.userData={}
        // 老人白发 / 花白：发型网格的顶点色是相对底色的比例，换底色即可
        if(look.hairTint)hairMesh?.traverse(node=>{if(node instanceof THREE.Mesh)(node.material as THREE.MeshStandardMaterial).color.set(look.hairTint!)})
        // 身高与体型：绕脚底缩放（角色原点在脚底），不改贴地
        model.scene.scale.set(look.girth*look.height,look.height,look.girth*look.height)
        if(look.age==='student'){
          const torso=model.scene.getObjectByName('attach_torso')
          if(torso){const pack=new THREE.Mesh(new THREE.BoxGeometry(.3,.38,.14),new THREE.MeshStandardMaterial({color:[0x3e4a55,0x2f5d7c,0x7a3b35,0x3f5a4c][Math.floor(random()*4)],roughness:.85,flatShading:true}))
            pack.position.set(0,-.02,.2);pack.name='passer-by backpack';torso.add(pack)}
        }
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
    mainDetail(root)
    const view={root,mixer,walk,idle,moving:true,template:index,placed:false,lastGx:NaN,lastGz:NaN,lastGy:walker.y,groundAcc:0,animAcc:0}
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
      if(!active.size)return
      const alpha=1-Math.exp(-18*dt)
      const cx=camera.position.x,cz=camera.position.z
      camera.updateMatrixWorld()
      proj.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse)
      frustum.setFromProjectionMatrix(proj)
      for(const [walker,view] of active){
        const tx=walker.x+Math.sin(walker.yaw)*walker.speed*lag,tz=walker.z+Math.cos(walker.yaw)*walker.speed*lag
        const pos=view.root.position
        if(!view.placed){pos.set(tx,walker.y,tz);view.root.rotation.y=walker.yaw+Math.PI;view.placed=true}
        else{
          pos.x+=(tx-pos.x)*Math.min(1,alpha*2);pos.z+=(tz-pos.z)*Math.min(1,alpha*2)
          const turn=walker.yaw+Math.PI-view.root.rotation.y // figure.glb faces −z (walk/index.ts uses atan2(-dx,-dz))
          view.root.rotation.y+=Math.atan2(Math.sin(turn),Math.cos(turn))*alpha
        }
        // Rapier 贴地射线节流：首帧、水平位移 >0.35m 或行走中满 200ms (5Hz) 重采样
        const dgx=pos.x-view.lastGx,dgz=pos.z-view.lastGz
        view.groundAcc+=dt
        if(Number.isNaN(view.lastGx)||dgx*dgx+dgz*dgz>.1225||(walker.speed>.15&&view.groundAcc>=.2)){
          view.lastGx=pos.x;view.lastGz=pos.z;view.groundAcc=0
          view.lastGy=groundAt?.(pos.x,pos.z,walker.y,false)??walker.y
        }
        pos.y=view.lastGy
        view.root.scale.setScalar(Math.max(.001,walker.scale))
        const moving=walker.speed>.15
        if(moving!==view.moving&&view.walk&&view.idle){
          view.moving=moving
          if(moving)view.idle.crossFadeTo(view.walk.setEffectiveWeight(1),.25,false)
          else view.walk.crossFadeTo(view.idle.setEffectiveWeight(1),.25,false)
        }
        if(view.walk)view.walk.timeScale=THREE.MathUtils.clamp(walker.speed/STRIDE,.45,1.25)
        // 视锥外路人跳过骨骼动画更新，远距 (>45m) 降频到 25Hz，近景保持逐帧流畅
        bound.center.set(pos.x,pos.y+.9,pos.z);bound.radius=1.8
        if(!frustum.intersectsSphere(bound)){
          view.animAcc=Math.min(.5,view.animAcc+dt)
        }else{
          const distSq=(pos.x-cx)**2+(pos.z-cz)**2
          if(distSq>2025){
            view.animAcc+=dt
            if(view.animAcc>=.04){view.mixer?.update(view.animAcc);view.animAcc=0}
          }else{
            view.mixer?.update(dt+view.animAcc)
            view.animAcc=0
          }
        }
      }
    },
    clear(){for(const [walker,view] of active)release(walker,view)},
    get count(){return active.size},
    probe:()=>[...active.values()].map(v=>[v.root.position.x,v.root.position.y,v.root.position.z,v.root.rotation.y,Number(v.moving)]),
  }
}
