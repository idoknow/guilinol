import {remoteSeat} from './helicopter/remote-seat'
import {ensureAvatarRig,type AvatarRig} from './walk/avatar-rig'
import {createLocomotionAnimator,createRemoteLocomotionFeed,type LocomotionAnimator} from './walk/locomotion-anim'
import {Fighter} from './combat/state'
import {pose as combatPose} from './combat/poses'
import {config,type CombatPacket} from './combat/net'
import {emotePlayback} from './emote/playback'
import {emoteById,emotesEnabled} from './emote/emotes'
import {smokeEnabled} from './citizen/use-item'
import {RemoteSmoke} from './smoke/session'
import {smokeVisual} from './smoke/visual'
import * as THREE from 'three'
import {clone} from 'three/addons/utils/SkeletonUtils.js'
import {defaultAvatar, sanitizeAvatar, type Avatar} from '../../lib/avatar'
import {previewCharacter} from './walk/character'
import {vehicleModel} from './walk/vehicle-model'
import {avatar as figure} from './look/avatar'
import {touchUi} from './ui/input-mode'
import {registerNameplate,removeNameplate} from './look/nameplates'

export interface Pose {foot?:boolean;x:number;y:number;z:number;yaw:number;v:number;gr:number;bike:string;bx:number;bz:number;byaw:number;sc:number;sb:number;sp:number;br:number;sd?:number;ss?:number;sr?:number}
export interface Player extends Pose {hp?:number;dn?:number;helper?:string;progress?:number;remaining?:number;em?:number;es?:number;expires?:number;id:string;uid?:number;jt?:number;name:string;avatar:Avatar}

// 名牌只在「面前」显示（IDOK-222）：40 m 内、在视野里，34 m 起淡出；远近都保持约 22 px 高（贴脸时最小 0.14 m），不会缩成一粒点也不会糊满屏。
const NAME_H=.3, NAME_Y=2.12, NAME_NEAR=34, NAME_FAR=40, NAME_PX=22, NAME_MIN=.14
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
  const sprite=new THREE.Sprite(material);sprite.userData.aspect=w/h;sprite.scale.set(NAME_H*w/h,NAME_H,1);sprite.position.y=NAME_Y;sprite.renderOrder=2
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
  registerNameplate(name)
  root.position.set(player.x,player.y,player.z); root.add(name); bike.visible=false
  return {root,name,bike,rig:undefined as AvatarRig|undefined,posed:false,wasSeated:false,over:undefined as HTMLElement|undefined,played:-1,emote:undefined as ReturnType<typeof emotePlayback>|undefined,smoke:new RemoteSmoke(),kit:undefined as ReturnType<typeof smokeVisual>|undefined,mixer:undefined as THREE.AnimationMixer|undefined,action:undefined as THREE.AnimationAction|undefined,key:'',loco:undefined as LocomotionAnimator|undefined,locoFeed:undefined as ReturnType<typeof createRemoteLocomotionFeed>|undefined}
}

export function players(scene:THREE.Scene,clips:THREE.AnimationClip[],camera:THREE.Camera) {
  const records=new Map<string,Player>(), visible=new Map<string,Visual>(), templates=new Map<string,Template>()
  const fighters=new Map<string,Fighter>(),screen=new THREE.Vector3()
  const limit=touchUi()?12:30
  const frustum=new THREE.Frustum(), projection=new THREE.Matrix4(), bounds=new THREE.Sphere(new THREE.Vector3(),1.1)
  const enableSmoke=smokeEnabled()
  let nextSort=0
  function hide(id:string) {
    const view=visible.get(id); if(!view)return
    view.over?.remove();view.kit?.dispose();visible.delete(id); view.root.removeFromParent(); view.bike.removeFromParent()
    removeNameplate(view.name);view.name.material.map?.dispose(); view.name.material.dispose(); view.mixer?.stopAllAction()
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
      const instance=clone(model); view.root.add(instance);view.rig=ensureAvatarRig(instance as THREE.Group)
      view.loco=createLocomotionAnimator(instance,appearance.body);view.locoFeed=createRemoteLocomotionFeed(view.loco) // IDOK-602, created at bind rest
      view.mixer=new THREE.AnimationMixer(instance);view.emote=emotePlayback(instance,undefined,view.mixer)
      const idleClip=clips.find(item=>item.name===figure.clips.idle)
      if(idleClip){const idleAct=view.mixer.clipAction(idleClip);idleAct.reset().setEffectiveWeight(1).play();view.action=idleAct;view.mixer.update(0)}
    }).catch(error=>console.warn('remote character unavailable',error))
  }
  function tick(dt:number,local:Pose) {
    if(performance.now()>=nextSort){nextSort=performance.now()+100
      const distance=(player:Player)=>(player.x-local.x)**2+(player.z-local.z)**2
      const nearest=new Set([...records.values()].sort((a,b)=>distance(a)-distance(b)).slice(0,limit).map(player=>player.id))
      for(const id of visible.keys())if(!nearest.has(id))hide(id)
      for(const id of nearest)if(!visible.has(id))show(records.get(id)!)
    }
    camera.updateWorldMatrix(true,false)
    frustum.setFromProjectionMatrix(projection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse))
    const enabled=emotesEnabled()
    const alpha=1-Math.exp(-20*dt)
    let bars=0
    const now=performance.now()
    for(const [id,view] of visible){const player=records.get(id)!,pos=view.root.position
      pos.x+=(player.x-pos.x)*alpha;pos.y+=(player.y-pos.y)*alpha;pos.z+=(player.z-pos.z)*alpha
      const angle=player.yaw-view.root.rotation.y;view.root.rotation.y+=Math.atan2(Math.sin(angle),Math.cos(angle))*alpha
      const seated=!!remoteSeat.uid&&player.uid===remoteSeat.uid
      if(seated){pos.set(remoteSeat.x,remoteSeat.y,remoteSeat.z);view.root.quaternion.copy(remoteSeat.orientation)}
      else if(view.wasSeated)view.root.rotation.set(0,player.yaw,0)
      view.wasSeated=seated
      view.bike.visible=!!player.bike
      if(player.bike){view.bike.position.set(pos.x+player.bx-player.x,pos.y,pos.z+player.bz-player.z);view.bike.rotation.y=player.byaw}
      const away=Math.hypot(pos.x-camera.position.x,pos.z-camera.position.z,pos.y+NAME_Y-camera.position.y)
      view.name.visible=away<NAME_FAR
      if(view.name.visible){
        const fov=(camera as THREE.PerspectiveCamera).fov??60
        const height=Math.max(NAME_MIN,NAME_PX/innerHeight*2*away*Math.tan(fov*Math.PI/360))
        view.name.scale.set(height*view.name.userData.aspect,height,1);view.name.position.y=NAME_Y+height/2-NAME_H/2
        view.name.material.opacity=Math.min(1,(NAME_FAR-away)/(NAME_FAR-NAME_NEAR))
      }
      // Reverse LIFO reset: apply order below is loco.update() -> emote.tick() -> kit.tick().
      if(view.posed){view.rig?.clearPose();view.posed=false}
      view.kit?.resetPose()
      view.emote?.reset()
      view.loco?.reset()
      const inRange=Math.hypot(player.x-local.x,player.z-local.z)<80
      bounds.center.set(player.x,player.y+.9,player.z)
      const eligible=enabled&&view.root.visible&&inRange&&frustum.intersectsSphere(bounds)&&performance.now()<(player.expires??0)
      if(view.emote){
        if(eligible&&player.em&&view.played!==player.es){view.emote.play(player.em,Math.max(0,(emoteById(player.em)?.duration??0)-((player.expires??0)-performance.now())/1000));view.played=player.es??0}
        if(!eligible||!player.em){view.emote.stop();view.played=-1}
      }
      const name=seated||player.bike?'sit':!player.gr?'jump':player.v>3?'run':player.v>.12?'walk':'idle'
      const clip=clips.find(item=>item.name===figure.clips[name])??clips.find(item=>item.name===figure.clips.idle)
      if(clip&&view.mixer){const action=view.mixer.clipAction(clip)
        if(!view.action||!view.action.isRunning()||!view.action.enabled){
          view.mixer.stopAllAction()
          action.reset().setEffectiveWeight(1).play();view.action=action
        }else if(action!==view.action){
          view.action.fadeOut(.12);action.reset().setEffectiveWeight(1).fadeIn(.12).play();view.action=action
        }
        view.mixer.update(dt)}
      // Procedural run/jump: vy and touchdown come from the smoothed root height and gr. No protocol change.
      view.locoFeed?.(dt,pos.y,player.y,!!player.gr,player.v,view.root.rotation.y,!seated&&!player.bike&&!!view.mixer&&away<70)
      view.emote?.tick(dt,player.v>.12)
      if(enableSmoke&&view.mixer){
        if(player.sc&&!view.kit)view.kit=smokeVisual(scene,view.root)
        if(view.kit){view.smoke.update(player.sc,player.sb,player.sp,player.br,dt,player.ss,player.sr);view.kit.tick(dt,view.smoke.view())}
      }
      const fighter=fighters.get(id)!
      const phase=fighter.phase(now,player.v>.1)
      if(view.rig&&phase!=='idle'){
        const drop=combatPose(view.rig,fighter,phase,now,player.yaw,view.mixer?.getRoot() as THREE.Object3D)
        // Offset only the rendered avatar.
        const model=view.mixer?.getRoot()
        if(model instanceof THREE.Object3D)model.position.y=-drop
        view.posed=true
      }else if(view.mixer)(view.mixer.getRoot() as THREE.Object3D).position.y=0
      if(fighter.hpShownUntil>now&&away<20&&bars<4){
        screen.copy(pos);screen.y+=2.35;screen.project(camera)
        if(Math.abs(screen.x)<1&&Math.abs(screen.y)<1&&Math.abs(screen.z)<1){
          if(!view.over){view.over=document.createElement('div');view.over.className='cb-over';document.body.append(view.over)}
          view.over.hidden=false;view.over.style.left=((screen.x+1)*innerWidth/2-21)+'px';view.over.style.top=((1-screen.y)*innerHeight/2)+'px'
          view.over.style.setProperty('--p',String(fighter.hp/config.hpMax));view.over.style.opacity=String(Math.min(1,(fighter.hpShownUntil-now)/500));bars++;continue
        }
      }
      if(view.over)view.over.hidden=true
    }
  }
  function remove(id:string){hide(id);fighters.delete(id);records.delete(id);nextSort=0}
  function clear(){for(const id of records.keys())remove(id)}
  function combat(p:CombatPacket){const fighter=fighters.get(p.id),record=records.get(p.id)
    if(!fighter||!record)return
    fighter.receive(p,performance.now());Object.assign(record,{hp:p.hp,dn:p.dn,helper:p.helper,progress:p.progress})
  }
  function helping(id:string,target:string,progress=0){const f=fighters.get(id);if(f){f.helping=target;f.assistProgress=progress}}
  function reveal(id:string){const f=fighters.get(id);if(f)f.hpShownUntil=performance.now()+config.overheadBarHideSeconds*1000}
  return {tick,clear,remove,combat,helping,reveal,list:()=>[...records.values()],add(player:Player){remove(player.id);const f=new Fighter();fighters.set(player.id,f);f.receive(player as CombatPacket,performance.now());records.set(player.id,{...player,expires:performance.now()+(emoteById(player.em??0)?.duration??0)*1000})},
    emote(id:string,em:number,es:number){const p=records.get(id);if(!p||es<=(p.es??0))return
      Object.assign(p,{em,es,expires:performance.now()+(emoteById(em)?.duration??0)*1000})},
    reconcile(player:Player){const f=fighters.get(player.id);f?.receive(player as CombatPacket,performance.now())},
    move(id:string,pose:Pose){const player=records.get(id);if(!player)return
      if(Math.hypot(pose.x-player.x,pose.z-player.z)>25)visible.get(id)?.root.position.set(pose.x,pose.y,pose.z)
      if(player.sd!==undefined && pose.sd!==undefined && player.sd!==pose.sd){
        const view=visible.get(id)
        view?.kit?.drop(view.smoke.view().length)
      }
      Object.assign(player,pose)},
    avatar(id:string,avatar:Avatar){const player=records.get(id);if(player){hide(id);player.avatar=avatar;nextSort=0}},
    probe:()=>[...visible].map(([id,view])=>({id,name:records.get(id)!.name,avatar:records.get(id)!.avatar,smoke:view.smoke.view().phase,puffs:view.smoke.view().puffs,clip:view.emote?.clip,ready:!!view.mixer,position:view.root.position.toArray()}))}
}
