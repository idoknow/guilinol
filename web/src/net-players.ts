import {smokeEnabled} from './citizen/use-item'
import {RemoteSmoke} from './smoke/session'
import {smokeVisual} from './smoke/visual'
import * as THREE from 'three'
import {clone} from 'three/addons/utils/SkeletonUtils.js'
import {defaultAvatar, sanitizeAvatar, type Avatar} from '../../lib/avatar'
import {previewCharacter} from './walk/character'
import {vehicleModel} from './walk/vehicle-model'
import {avatar as figure} from './look/avatar'

export interface Pose {x:number;y:number;z:number;yaw:number;v:number;gr:number;bike:string;bx:number;bz:number;byaw:number;sc:number;sb:number;sp:number;br:number}
export interface Player extends Pose {id:string;name:string;avatar:Avatar}

// 昵称牌（IDOK-192）：墨青玻璃小签 + 宣纸色宋体字，左边一颗青玉点，和 HUD 读数同一套颜色。
const TAG_FONT='600 30px "Noto Serif SC","Source Han Serif SC","Songti SC",serif'
export function label(name:string) {
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d')!
  ctx.font=TAG_FONT
  const text=name.length>12?`${name.slice(0,11)}…`:name
  const h=52,padX=20,dot=10,gap=10,w=Math.ceil(Math.min(420,padX*2+dot+gap+ctx.measureText(text).width))
  canvas.width=w;canvas.height=h
  ctx.font=TAG_FONT
  const r=h/2-4
  ctx.beginPath();ctx.roundRect(2,4,w-4,h-8,r)
  ctx.fillStyle='rgba(24,40,37,.72)';ctx.fill()
  ctx.lineWidth=2;ctx.strokeStyle='rgba(244,239,226,.32)';ctx.stroke()
  ctx.beginPath();ctx.arc(padX+dot/2,h/2,dot/2,0,Math.PI*2);ctx.fillStyle='#8fc1b5';ctx.fill()
  ctx.fillStyle='#f4efe2';ctx.textBaseline='middle';ctx.textAlign='left'
  ctx.fillText(text,padX+dot+gap,h/2+1,w-padX*2-dot-gap)
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4
  const material=new THREE.SpriteMaterial({map:texture,fog:false,depthWrite:false,transparent:true})
  const sprite=new THREE.Sprite(material),height=.3;sprite.scale.set(height*w/h,height,1);sprite.position.y=2.12;sprite.renderOrder=2
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
  return {root,name,bike,smoke:new RemoteSmoke(),kit:undefined as ReturnType<typeof smokeVisual>|undefined,mixer:undefined as THREE.AnimationMixer|undefined,action:undefined as THREE.AnimationAction|undefined,key:''}
}

export function players(scene:THREE.Scene,clips:THREE.AnimationClip[]) {
  const records=new Map<string,Player>(), visible=new Map<string,Visual>(), templates=new Map<string,Template>()
  const limit=matchMedia('(pointer: coarse)').matches?12:30
  const enableSmoke=smokeEnabled()
  let nextSort=0
  function hide(id:string) {
    const view=visible.get(id); if(!view)return
    view.kit?.dispose();visible.delete(id); view.root.removeFromParent(); view.bike.removeFromParent()
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
      view.kit?.resetPose()
      const name=player.bike?'sit':!player.gr?'jump':player.v>3?'run':player.v>.12?'walk':'idle'
      const clip=clips.find(item=>item.name===figure.clips[name]);if(clip&&view.mixer){const action=view.mixer.clipAction(clip)
        if(action!==view.action){view.action?.fadeOut(.12);action.reset().fadeIn(.12).play();view.action=action} view.mixer.update(dt)}
      if(enableSmoke&&view.mixer){
        if(player.sc&&!view.kit)view.kit=smokeVisual(scene,view.root)
        if(view.kit){view.smoke.update(player.sc,player.sb,player.sp,player.br,dt);view.kit.tick(dt,view.smoke.view())}
      }
    }
  }
  function remove(id:string){hide(id);records.delete(id);nextSort=0}
  function clear(){for(const id of records.keys())remove(id)}
  return {tick,clear,remove,add(player:Player){remove(player.id);records.set(player.id,player)},
    move(id:string,pose:Pose){const player=records.get(id);if(!player)return
      if(Math.hypot(pose.x-player.x,pose.z-player.z)>25)visible.get(id)?.root.position.set(pose.x,pose.y,pose.z)
      Object.assign(player,pose)},
    avatar(id:string,avatar:Avatar){const player=records.get(id);if(player){hide(id);player.avatar=avatar;nextSort=0}},
    probe:()=>[...visible].map(([id,view])=>({id,name:records.get(id)!.name,avatar:records.get(id)!.avatar,smoke:view.smoke.view().phase,puffs:view.smoke.view().puffs,ready:!!view.mixer,position:view.root.position.toArray()}))}
}
