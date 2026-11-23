import * as THREE from 'three'
import {clone} from 'three/addons/utils/SkeletonUtils.js'
import {defaultAvatar, sanitizeAvatar, type Avatar} from '../../lib/avatar'
import {previewCharacter} from './walk/character'
import {vehicleModel} from './walk/vehicle-model'
import {avatar as figure} from './look/avatar'

export interface Pose {x:number;y:number;z:number;yaw:number;v:number;gr:number;bike:string;bx:number;bz:number;byaw:number}
export interface Player extends Pose {id:string;name:string;avatar:Avatar}

function label(name:string) {
  const canvas=document.createElement('canvas'); canvas.width=384; canvas.height=48
  const ctx=canvas.getContext('2d')!; ctx.font='32px sans-serif'; ctx.textAlign='center'; ctx.fillStyle='white'
  ctx.strokeText(name,192,36,380); ctx.fillText(name,192,36,380)
  const texture=new THREE.CanvasTexture(canvas), material=new THREE.SpriteMaterial({map:texture,fog:false,depthWrite:false})
  const sprite=new THREE.Sprite(material); sprite.scale.set(3,.375,1); sprite.position.y=2.15
  return sprite
}

function template(appearance:Avatar) {
  return previewCharacter(appearance).then(model=>{
    model.scene.userData={}
    return model.scene
  })
}
type Template={model:ReturnType<typeof template>;refs:number}
type Visual=ReturnType<typeof visual>
function visual(player:Player) {
  const root=new THREE.Group(), name=label(player.name), bike=vehicleModel('bike')
  root.position.set(player.x,player.y,player.z); root.add(name); bike.visible=false
  return {root,name,bike,mixer:undefined as THREE.AnimationMixer|undefined,action:undefined as THREE.AnimationAction|undefined,key:''}
}

export function players(scene:THREE.Scene,clips:THREE.AnimationClip[]) {
  const records=new Map<string,Player>(), visible=new Map<string,Visual>(), templates=new Map<string,Template>()
  const limit=matchMedia('(pointer: coarse)').matches?12:30
  let nextSort=0
  function hide(id:string) {
    const view=visible.get(id); if(!view)return
    visible.delete(id); view.root.removeFromParent(); view.bike.removeFromParent()
    view.name.material.map?.dispose(); view.name.material.dispose(); view.mixer?.stopAllAction()
    view.root.traverse(node=>{if(node instanceof THREE.SkinnedMesh)node.skeleton.dispose()})
    const entry=templates.get(view.key)
    if(entry&&!--entry.refs){templates.delete(view.key); void entry.model.then(root=>{
      const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>()
      root.traverse(node=>{if(node instanceof THREE.Mesh){geometries.add(node.geometry);for(const mat of [node.material].flat())materials.add(mat)};if(node instanceof THREE.SkinnedMesh)node.skeleton.dispose()})
      geometries.forEach(item=>item.dispose());materials.forEach(item=>item.dispose())
    },()=>{})}
  }
  function show(player:Player) {
    const view=visual(player); visible.set(player.id,view); scene.add(view.root,view.bike)
    const appearance=sanitizeAvatar(player.avatar)??defaultAvatar(1),key=JSON.stringify({...appearance,createdAt:0}); view.key=key
    let entry=templates.get(key); if(!entry){entry={model:template(appearance),refs:0};templates.set(key,entry)}
    entry.refs++
    void entry.model.then(model=>{if(visible.get(player.id)!==view)return
      const instance=clone(model); view.root.add(instance); view.mixer=new THREE.AnimationMixer(instance)
    }).catch(error=>console.warn('remote character unavailable',error))
  }
  function tick(dt:number,local:Pose) {
    if(performance.now()>=nextSort){nextSort=performance.now()+100
      const distance=(player:Player)=>(player.x-local.x)**2+(player.z-local.z)**2
      const nearest=new Set([...records.values()].sort((a,b)=>distance(a)-distance(b)).slice(0,limit).map(player=>player.id))
      for(const id of visible.keys())if(!nearest.has(id))hide(id)
      for(const id of nearest)if(!visible.has(id))show(records.get(id)!)
    }
    const alpha=1-Math.exp(-20*dt)
    for(const [id,view] of visible){const player=records.get(id)!,pos=view.root.position
      pos.x+=(player.x-pos.x)*alpha;pos.y+=(player.y-pos.y)*alpha;pos.z+=(player.z-pos.z)*alpha
      const angle=player.yaw-view.root.rotation.y;view.root.rotation.y+=Math.atan2(Math.sin(angle),Math.cos(angle))*alpha
      view.bike.visible=!!player.bike
      if(player.bike){view.bike.position.set(pos.x+player.bx-player.x,pos.y,pos.z+player.bz-player.z);view.bike.rotation.y=player.byaw}
      const name=player.bike?'sit':!player.gr?'jump':player.v>3?'run':player.v>.12?'walk':'idle'
      const clip=clips.find(item=>item.name===figure.clips[name]);if(clip&&view.mixer){const action=view.mixer.clipAction(clip)
        if(action!==view.action){view.action?.fadeOut(.12);action.reset().fadeIn(.12).play();view.action=action} view.mixer.update(dt)}
    }
  }
  function remove(id:string){hide(id);records.delete(id);nextSort=0}
  function clear(){for(const id of records.keys())remove(id)}
  return {tick,clear,remove,add(player:Player){remove(player.id);records.set(player.id,player)},
    move(id:string,pose:Pose){const player=records.get(id);if(!player)return
      if(Math.hypot(pose.x-player.x,pose.z-player.z)>25)visible.get(id)?.root.position.set(pose.x,pose.y,pose.z)
      Object.assign(player,pose)},
    avatar(id:string,avatar:Avatar){const player=records.get(id);if(player){hide(id);player.avatar=avatar;nextSort=0}},
    probe:()=>[...visible].map(([id,view])=>({id,name:records.get(id)!.name,avatar:records.get(id)!.avatar,ready:!!view.mixer,position:view.root.position.toArray()}))}
}
