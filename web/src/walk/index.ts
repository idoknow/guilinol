import * as THREE from 'three'
import R from '@dimforge/rapier3d-compat'
import type {PeaksGroup} from '../peaks'
import type {Manifest} from '../world'
import type {Stream} from '../stream'
import './ride.css'
import {walkInput} from '../ui/walk'
import {attachNet} from '../net'
import {createSmoking} from '../smoke'
import {createFigure, type Figure} from './figure'
import {walkConfig as cfg} from './config'
import {createPhysics} from './physics'
import {look} from '../look/config'
import {sfx, isMuted, toggleMute} from '../audio'
import type {vehicles} from './vehicles'

let rapierReady:Promise<void>|undefined

export function preloadWalk() {
  rapierReady ??= R.init()
  return rapierReady
}


export async function walk(scene:THREE.Scene,camera:THREE.PerspectiveCamera,canvas:HTMLCanvasElement,manifest:Manifest,stream:Stream,peaks:PeaksGroup,verify:boolean,renderer:THREE.WebGLRenderer){
  rapierReady ??= R.init()
  const sim=await createPhysics(manifest,stream,peaks,rapierReady)
  let character:Figure=await createFigure()
  let figure=character.root
  scene.add(figure);figure.visible=false
  let active=false,yaw=0,pitch=cfg.pitch,arm=cfg.far,velocity=0,grounded=false,accumulator=0
  let resets=0,steps=0,physicsMs=0,elapsed=0,lastHits:string[]=[],motion=0
  const input=walkInput(canvas,()=>active,(dx,dy)=>{yaw-=dx*cfg.sensitivity;pitch=THREE.MathUtils.clamp(pitch+dy*cfg.sensitivity,-.8,1.3);lookPitch=THREE.MathUtils.clamp(lookPitch+dy*cfg.sensitivity,-1.15,1.15)},
    delta=>{arm=THREE.MathUtils.clamp(arm+delta*.013,cfg.zoomMin,cfg.zoomMax)},()=>{arm=arm>(cfg.far+cfg.near)/2?cfg.near:cfg.far})
  const safe=new THREE.Vector3(),focus=new THREE.Vector3(),direction=new THREE.Vector3(),rideScratch=new THREE.Vector3(),hipLocal=new THREE.Vector3();const spawns:object[]=[]
  let external:{x:number,z:number,run:boolean}|null=null,blockedWater=false,held=false
  /** 给联机同步用的姿势状态（蹲下 / 是否着地 / 倒地） */
  const poseFlags={crouch:false,grounded:true,down:false}
  // —— 血量 / 体力 / 倒地 / 出拳 / 翘头 ——
  const HP_MAX=100
  let hp=HP_MAX,stamina=1,down=false,downSince=0,downHint=0
  let punchT=0,wheelieAng=0,wheelieWas=false,crashCooldown=0,hpRegen=0
  /** 摔车被甩出去：方向 + 剩余时间；staggerT 是落地后的踉跄时间 */
  let throwT=0,staggerT=0,wheelieHold=0
  const crashDir=new THREE.Vector2()
  /** Space 是否按住（walkInput 的 jump 是一次性脉冲，翘头需要「按住」状态） */
  let spaceHeld=false
  let stepDist=0,wasGrounded=true,wasRiding=false
  const DOWN_WAIT=25000
  const still={right:0,forward:0,run:false,jump:false,crouch:false}
  // —— 手游：蹲 / 翘头 两个「按住生效」的按钮 ——
  let holdCrouch=false, holdWheelie=false
  const touchButtons:HTMLElement[]=[]
  function buildTouchHolds(){
    if(touchButtons.length)return
    for(const [cls,text,set] of [
      ['btn-crouch','蹲',(on:boolean)=>{holdCrouch=on}],
      ['btn-wheelie','翘头',(on:boolean)=>{holdWheelie=on}],
    ] as const){
      const button=document.createElement('button')
      button.type='button';button.className=cls;button.textContent=text
      button.hidden=true
      button.onpointerdown=event=>{event.preventDefault();set(true);button.classList.add('on')}
      const end=()=>{set(false);button.classList.remove('on')}
      button.onpointerup=end;button.onpointercancel=end;button.onpointerleave=end
      document.body.append(button);touchButtons.push(button)
    }
    // —— 清屏：除摇杆/翘头/远近外全部隐藏 ——
    const clear=document.createElement('button')
    clear.type='button';clear.className='btn-clearscreen';clear.textContent='清屏'
    clear.setAttribute('aria-label','清屏（隐藏界面）')
    clear.hidden=true
    clear.onpointerdown=event=>event.preventDefault()
    clear.onclick=()=>{
      const on=document.body.toggleAttribute('data-hud-hidden')
      clear.classList.toggle('on',on)
      clear.textContent=on?'显示':'清屏'
    }
    document.body.append(clear);touchButtons.push(clear)
    // —— 切换人称：单独放右下 ——
    const view=document.createElement('button')
    view.type='button';view.className='btn-viewmode';view.textContent='视角'
    view.setAttribute('aria-label','切换第一/第三人称')
    view.hidden=true
    view.onpointerdown=event=>event.preventDefault()
    view.onclick=()=>window.dispatchEvent(new KeyboardEvent('keydown',{code:'F3',key:'F3'}))
    document.body.append(view);touchButtons.push(view)
  }
  function showTouchHolds(on:boolean){
    buildTouchHolds()
    const coarse=matchMedia('(pointer:coarse)').matches
    for(const button of touchButtons)button.hidden=!(on&&coarse)
  }
  let rides:Awaited<ReturnType<typeof vehicles>>|null=null,loading=false
  function loadRides(){if(loading||rides||!active||!manifest.vehicles)return;loading=true
    const file=manifest.vehicles.file
    void import('./vehicles').then(module=>module.vehicles(scene,file,(x,z)=>{sim.sync(x,z);return place(x,z,'dismount')},renderer,(x,z)=>sim.surface(x,z,'ground')?.y)).then(loaded=>{rides=loaded;rides.show(active)})
      .catch(error=>console.warn('Vehicles unavailable:',error)).finally(()=>{loading=false})}
  let wasBoat=false,wasBike=false,bikeObstacle=''
  function place(x:number,z:number,reason:string,override=false){const found=sim.findWalkableSpawn(x,z,override)
    if(verify)spawns.push({reason,from:[x,z],to:found?[found.x,found.z]:null,distance:found?Math.hypot(found.x-x,found.z-z):null,rule:found?.rule??'none'})
    if(!found)return false
    sim.body.setTranslation(found,true);sim.body.setNextKinematicTranslation(found);sim.world.step();safe.set(found.x,found.y,found.z);velocity=0;grounded=false
    // 人物节点也要就地更新：俯冲入场用的是 figure.position，如果这里不同步，
    // 3 秒俯冲会飞在世界原点，落地才瞬移到真实落点。
    figure.position.set(found.x,found.y-cfg.height/2,found.z)
    return true}
  let destination:THREE.Vector3|null=null
  let compileWarm=false
  // 骑行第一人称用更广的视场，才能看见自己的手臂和大腿
  // 步行/骑行第一人称的视场：骑行用更广的视场才看得见自己的手臂和大腿
  const walkFov=camera.fov,rideFov=88,footFov=64
  /** 走路视角：默认第一人称，按 V 切换 */
  let firstPerson=true
  // —— 香烟：背包 / 快捷栏 / 取烟点烟 / 烟雾 / 联机同步
  const smoking=createSmoking({scene,camera,figure:()=>character,active:()=>active,firstPerson:()=>firstPerson})
  /** 俯冲入场：落地后 1.6 s 从 180 m 降到眼高 */
  const dive={start:0,dur:3000,from:80}
  let lookYaw=0,lookPitch=0
  // —— 传送提示（落地前盖住加载过程，避免看起来像卡死）
  const teleportTip=document.createElement('div')
  teleportTip.className='teleport-tip';teleportTip.hidden=true;teleportTip.style.display='none';teleportTip.remove();teleportTip.style.cssText='display:none'
  teleportTip.innerHTML='<div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);text-align:center;font:600 13px/1.8 system-ui;letter-spacing:.42em;color:rgba(232,244,239,.86);text-indent:.42em">正在进入桂林<br><span style="display:inline-block;width:180px;height:2px;margin-top:14px;background:rgba(255,255,255,.14);overflow:hidden"><i style="display:block;width:40%;height:100%;background:#2fd6a6;animation:tp-load 1.15s infinite"></i></span></div>'
  // 旧的 teleport-tip 已从 DOM 移除；进入加载用独立元素
  /** 进入游戏的全屏加载页 */
  function setEnterProgress(value:number){
    const bar=document.querySelector<HTMLElement>('#enter-screen .es-bar i')
    const v=Math.max(.02,Math.min(1,value))
    if(bar)bar.style.transform='scaleX('+v.toFixed(3)+')'
    const num=document.querySelector<HTMLElement>('#enter-screen .es-num b')
    if(num)num.textContent=String(Math.round(v*100))
  }
  function enterScreen(on:boolean){
    // 上一次 hide 的定时器必须先取消：否则「先 leave 再 enter」时，旧定时器会在新一次进入的遮罩上补一发隐藏
    clearTimeout(enterHideTimer)
    let el=document.getElementById('enter-screen')
    if(on){
      if(!el){
        el=document.createElement('div')
        el.id='enter-screen'
        el.innerHTML='<p class="es-title">正在进入桂林</p><p class="es-sub">GUILIN · LOADING</p><p class="es-num"><b>0</b><small>%</small></p><span class="es-bar"><i></i></span>'
        document.body.append(el)
      }
      el.classList.remove('is-out')
      el.style.backgroundImage="url('./home/elephant.webp')"
      el.style.display='flex'
      return
    }
    if(!el)return
    el.classList.add('is-out')
    enterHideTimer=window.setTimeout(()=>{el!.style.display='none'},420)
  }
  // —— 传送互斥：同一时刻只跑一次 enter。
  // 后到的请求先把 destination 指向自己（正在跑的那一次会在下一个检查点返回 false），
  // 再严格排队执行。这样 toggle() 里「主入口 + fallback」不会互改目标、也不会两套遮罩叠在一起。
  let enterSeq=0,enterBusy=false,enterHideTimer=0
  let enterQueue:Promise<unknown>=Promise.resolve()
  function enter(x:number,z:number,heading:number,reason:string,override=false):Promise<boolean>{
    const seq=++enterSeq
    const target=new THREE.Vector3(x,0,z);destination=target
    enterScreen(true)
    const run=enterQueue.then(()=>seq===enterSeq?enterNow(target,heading,reason,override):false)
    enterQueue=run.catch(()=>undefined)
    return run
  }
  async function enterNow(target:THREE.Vector3,heading:number,reason:string,override:boolean):Promise<boolean>{
    enterBusy=true
    try{return await enterRun(target,heading,reason,override)}finally{enterBusy=false}
  }
  async function enterRun(target:THREE.Vector3,heading:number,reason:string,override:boolean):Promise<boolean>{
    const x=target.x,z=target.z
    teleportTip.hidden=true;teleportTip.style.cssText='display:none'
    // 落地前要等的东西只有一件：流式加载半径以内（Stream.tick 真正会加载的范围）的块。
    // 旧实现按「块外沿 220 m」(≈348 m 覆盖) 去等，永远等不齐 → 每次传送都空转满 15 s，
    // 遮罩进度条停在 0%，看起来就是卡死。
    const half=manifest.chunkSize/2
    const ring=manifest.chunks.filter(tile=>Math.hypot(tile.x+half-x,tile.z+half-z)<=stream.radius)
    // 脚下这块：它的碰撞数据到位后才能落点，否则 findWalkableSpawn 会在 64 m 内随便找个能站的地方，
    // 把玩家从城门「吸附」到几十米外
    const underfoot=manifest.chunks.filter(tile=>Math.abs(x-(tile.x+half))<=half&&Math.abs(z-(tile.z+half))<=half)
    const underfootLoaded=()=>underfoot.every(tile=>stream.loaded.has(tile))
    const missingIn=(list:typeof ring)=>list.reduce((count,tile)=>count+(stream.loaded.has(tile)?0:1),0)
    const ringStart=Math.max(1,missingIn(ring))
    // 传送落地前：暂停树木流式，并按帧推进。不再把解码压到 1 路 ——
    // 真正控制落帧成本的是 Stream 每帧的「上台」预算；压到 1 路只会让手机进游戏多等好几倍。
    const restorePending = stream.maxPending
    stream.holdTrees = true
    let placed=false
    const spawnMark=spawns.length
    try {
      // 落地条件 = 「能站住」+「半径内的块都到位」：只满足前者会站在还没有地形的空地上
      // （probe().renderClearance 会变成 -Infinity，肉眼就是脚下没地面）。
      const deadline=performance.now()+15000
      for(;;){
        if(destination!==target)return false
        sim.sync(x,z)
        if(!placed&&underfootLoaded())placed=place(x,z,reason,override)
        const missing=missingIn(ring)
        if(placed&&missing===0)break
        if(performance.now()>deadline)break
        // 该到的块都到了却还是站不住：这里确实没有落脚点，别干等满 15 s
        if(missing===0&&!placed)break
        stream.tick(target)
        setEnterProgress(.06+.74*(1-missing/ringStart))
        await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()))
      }
    } finally {
      stream.holdTrees = false
      // 落地后 1.5 s 内仍然一块一块地补，别让剩下的解码在落地瞬间一起涌进来
      setTimeout(()=>{if(!enterBusy)stream.maxPending = restorePending},1500)
      // ?verify 的落点记录只保留最后一次尝试，别把上面重试的每一帧都记进去
      if(verify&&spawns.length>spawnMark+1){const last=spawns.pop();spawns.length=spawnMark;if(last)spawns.push(last)}
    }
    // 等不到落脚点：交给上层兜底（首次进游戏会退回城门），别把人吊在半空
    if(!placed){window.dispatchEvent(new CustomEvent('walk:spawn-failed',{detail:{x,z,reason:'no-walkable-support'}}));return false}
    // Register nearby collision surfaces before placing the capsule. The palace
    // forecourt is a 17 cm slab above GL04, and can stream in under a new walker.
    const supports=(manifest.landmarks??[]).filter(entry=>{
      if(entry.collision==='none')return false
      const [cx,,cz,r]=entry.sphere, a=entry.rotation*Math.PI/180
      const ex=entry.position[0]+cx*Math.cos(a)+cz*Math.sin(a)
      const ez=entry.position[2]-cx*Math.sin(a)+cz*Math.cos(a)
      return Math.hypot(ex-x,ez-z)<=r+cfg.search
    })
    const landmarkDeadline=performance.now()+10000
    while(supports.some(entry=>!stream.landmarks.has(entry))&&performance.now()<landmarkDeadline){
      if(destination!==target)return false
      for(const entry of supports)if(!stream.landmarks.has(entry)){
        target.y=entry.position[1];stream.updateLandmarks?.(target,entry)
      }
      setEnterProgress(.78)
      await new Promise(resolve=>setTimeout(resolve,12))
    }
    if(destination!==target)return false
    // 注意：这里先不要清 destination。清早了 main.ts 的 tick 会退回用相机位置推流，
    // 把刚落点附近的块整片淘汰掉（玩家会悬空、probe().renderClearance 变成 -Infinity），
    // 等真正 active 了再交还给「玩家位置」。
    // 地标碰撞体到位后再落一次：王城前庭是高出地面 17 cm 的台面，先落会把人放进台子里
    // （这也是旧实现「先等地标、再落点」的等价行为）。
    sim.sync(x,z)
    if(!place(x,z,reason,override)){window.dispatchEvent(new CustomEvent('walk:spawn-failed',{detail:{x,z,reason:'no-walkable-support'}}));return false}
    // 超时也照常落地：剩下的块交给流式加载继续补，不能因为“没等齐”就把人卡在半空
    if(missingIn(ring)>0||supports.some(entry=>!stream.landmarks.has(entry)))console.warn('teleport: 仍有块未就绪，边落边补')
    // 再等"安静"下来：连续几帧没有新解码在跑，说明几何体上传、首帧着色器编译都做完了，
    // 这些开销全部藏在传送遮罩后面，玩家看见的第一帧就是稳的。
    {
      // 树木流式和解码并行灌进来（仍在遮罩后面），落地后就不必再为「树冒出来」付长帧
      stream.holdTrees = false
      stream.maxPending = restorePending
      // 顺手把落点附近的地标模型也在遮罩后加载完（象鼻山、王城这类地标是独立 GLB，
      // 落地后再加载会一次卡 100 ms 以上）
      const nearbyLandmarks = (manifest.landmarks ?? []).filter(entry => {
        const [cx,,cz,r] = entry.sphere, a = entry.rotation * Math.PI / 180
        const ex = entry.position[0] + cx * Math.cos(a) + cz * Math.sin(a)
        const ez = entry.position[2] - cx * Math.sin(a) + cz * Math.cos(a)
        return Math.hypot(ex - x, ez - z) <= 280 + r
      })
      const settleDeadline = performance.now() + 1600
      let quiet = 0
      let landmarkWait = 0
      while (performance.now() < settleDeadline && quiet < 10) {
        if (destination !== target) return false
        stream.tick(target)
        // 碰撞体也在遮罩后面分帧建好（山体 trimesh 单个就上百毫秒，落地后再建就是肉眼可见的一卡）
        sim.sync(x, z)
        for (const entry of nearbyLandmarks) {
          if (!stream.landmarks.has(entry)) {
            stream.updateLandmarks?.(target, entry)
            quiet = 0
            landmarkWait++
            break
          }
        }
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
        quiet = stream.pending.size === 0 && landmarkWait === 0 ? quiet + 1 : 0
        if (landmarkWait > 0) landmarkWait--
      }
    }
    // 预热：把相机临时挪到落点渲一帧（仍在遮罩后），让水面/镜面/新材质的首帧编译都花在这里，
    // 而不是玩家看见的那一帧。首次传送最容易卡的就是这一步。
    // 预热：把相机临时挪到落点渲一帧（仍在遮罩后），让水面/镜面/新材质的首帧编译都花在这里，
    // 而不是玩家看见的那一帧。每次传送都做，代价是遮罩后面的一帧。
    {
      const savedPosition=camera.position.clone(),savedQuaternion=camera.quaternion.clone()
      try{
        const eye=sim.surface(x,z,'ground')?.y??0
        camera.position.set(x,eye+1.6,z)
        camera.lookAt(x,eye+1.6,z-8)
        if(!compileWarm){compileWarm=true;renderer.compile(scene,camera)}
        renderer.render(scene,camera)
      }catch{/* 预热失败不影响游玩 */}
      camera.position.copy(savedPosition);camera.quaternion.copy(savedQuaternion)
    }
    teleportTip.hidden=false;teleportTip.style.cssText='position:fixed;left:0;top:0;right:0;bottom:0;z-index:200;display:flex;align-items:center;justify-content:center;background:radial-gradient(120% 100% at 50% 30%,#123029,#060f0d 70%)'
    dive.start=performance.now()
    setEnterProgress(0.8)
    // 落点在等碰撞数据的那一段就已经放好了（placed===true），这里不用再放一次
    destination=null
    active=true;setTimeout(()=>enterScreen(false),600);rides?.show(true);requestAnimationFrame(()=>requestAnimationFrame(loadRides));figure.visible=true;yaw=heading;figure.rotation.y=yaw;input.show(true);smoking.show(true);accumulator=0;camera.near=.08;camera.updateProjectionMatrix();follow();sfx.enter();vitals.hidden=false;showTouchHolds(true);hp=Math.max(hp,HP_MAX);stamina=1;down=false;poseFlags.down=false;downPanel.hidden=true;return true
  }
  function leave(){enterSeq++;destination=null;active=false;if(!enterBusy)enterScreen(false);rides?.show(false);wasBoat=wasBike=false;figure.visible=false;input.show(false);smoking.show(false);external=null;sim.clear();camera.near=1;camera.fov=walkFov;camera.updateProjectionMatrix();vitals.hidden=true;downPanel.hidden=true;down=false;poseFlags.down=false;showTouchHolds(false);holdCrouch=holdWheelie=false}
  /** 在角色页换了外形后，就地重建人物（保持位置与朝向）。 */
  async function rebuildCharacter(){
    const position=figure.position.clone(),yawNow=figure.rotation.y,visible=figure.visible
    scene.remove(figure);character.dispose()
    character=await createFigure()
    figure=character.root
    figure.position.copy(position);figure.rotation.y=yawNow;figure.visible=visible
    scene.add(figure)

  }
  // 上游角色页保存后发 glol:avatar；旧菜单发 glol:character。两个都接。
  // 不管当前是否在步行都要重建：从菜单里改完外形再点进入时，人物不能还是旧的。
  addEventListener('glol:character',()=>void rebuildCharacter())
  addEventListener('glol:avatar',()=>void rebuildCharacter())
  /**
   * 青桂电车上的绑定点。
   * 握把取模型实测坐标（qingju/bike/steering.js 里 grips 中心：±0.309, 1.154, 0.186），
   * 而且必须从 `steering` 组取世界坐标——转把时整组绕转向轴转，手才会跟着车把一起转。
   * 座椅/踏板固定在车身上，用车身坐标系。
   */
  /** 翘头：把车身绕「后轮接地点」抬起（park() 会重置 rotation，所以每帧摆完车再调用一次） */
  function applyWheelie(){
    const bike=rides?.bike
    if(!bike)return
    // 后轮接地点在车身局部坐标里是 (0, 0, rearZ)。绕原点转 -θ 之后它会掉到
    //   y' = rearZ·sinθ   （rearZ<0 → 往下沉）
    //   z' = rearZ·cosθ
    // 所以要 y 抬 +|rearZ|·sinθ、z 补 rearZ·(1-cosθ)，接地点才留在地面上。
    // 之前 y 用的是 rearY*(1-cosθ)+rearZ*sinθ，后半项是负的，等于把车往下压 → 后轮陷地。
    const rearZ=-0.62
    if(wheelieAng>.001){
      // 补偿必须沿着「车身自己的局部 +Z」在世界里的方向，不能直接加到世界 z 上，
      // 否则车头朝东西时补偿会推到旁边去。
      const yawBike=bike.rotation.y
      const fwdX=Math.sin(yawBike),fwdZ=Math.cos(yawBike)
      const back=rearZ*(1-Math.cos(wheelieAng))   // 局部 +Z 方向的位移（rearZ<0 → 负）
      bike.position.y+=-rearZ*Math.sin(wheelieAng)
      bike.position.x+=fwdX*back
      bike.position.z+=fwdZ*back
    }
    // 坡度俯仰 + 转弯侧倾 + 翘头角，三者叠在同一个 rotation 上（park() 每帧都会清零）
    const slope=rides!.slopePitch(bike.position.x,bike.position.z)
    bike.rotation.x=-wheelieAng+slope
    bike.rotation.z=rides!.lean
    bike.updateWorldMatrix(true,false)
  }

  /** 撞车（碰撞检测和调试入口共用）：扣血、人被甩出去、车侧倒留在原地 */
  function crash(kind:string,impact:number){
    if(!rides?.bike)return false
    const heading=rides.heading
    crashDir.set(-Math.sin(heading),-Math.cos(heading))
    // 先把车放倒留在原地，再把人甩出去（顺序反了会拿不到 heading）
    if(!rides.crashDown())return false
    throwT=.85;velocity=Math.max(velocity,2.3);staggerT=1.9;wheelieHold=0;wheelieAng=0
    damage(Math.round(14+Math.min(26,impact*1.7)),'crash')
    crashCooldown=1.6;bikeObstacle=kind
    return true
  }

  function rideTargets(bike:THREE.Object3D,heading:number){
    bike.updateWorldMatrix(true,false)
    const steering=bike.getObjectByName('steering')??bike
    if(steering!==bike)steering.updateWorldMatrix(true,false)
    const seat=bike.localToWorld(new THREE.Vector3(0,0.792,-0.20))
    const gripL=steering.localToWorld(new THREE.Vector3(-0.309,1.154,0.186))
    const gripR=steering.localToWorld(new THREE.Vector3(0.309,1.154,0.186))
    const deckL=bike.localToWorld(new THREE.Vector3(-0.11,0.30,0.10))
    const deckR=bike.localToWorld(new THREE.Vector3(0.11,0.30,0.10))
    const forward=new THREE.Vector3(0,0,1).applyAxisAngle(new THREE.Vector3(0,1,0),heading)
    return {seat,gripL,gripR,deckL,deckR,forward}
  }

  // —— 骑行 HUD（速度 / 里程 / 电量）
  const rideHud=document.createElement('div')
  rideHud.className='ride-hud';rideHud.hidden=true
  rideHud.innerHTML='<b class="ride-speed">0</b><span class="ride-unit">km/h</span><em class="ride-meta">0.00 km · 电量 100%</em><button type="button" class="ride-off">下车</button>'
  document.body.append(rideHud)
  const rideSpeedEl=rideHud.querySelector<HTMLElement>('.ride-speed')!
  const rideMetaEl=rideHud.querySelector<HTMLElement>('.ride-meta')!
  rideHud.querySelector<HTMLButtonElement>('.ride-off')!.onclick=()=>{if(rides?.bike)window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyF'}))}

  // —— 血量 / 体力条 + 静音 + 倒地提示 ——
  const vitals=document.createElement('div')
  vitals.className='vitals';vitals.hidden=true
  vitals.innerHTML=`<div class="vital-row"><span class="vital-label">血</span><div class="vital-track hp"><i></i></div></div>`
    +`<div class="vital-row"><span class="vital-label">力</span><div class="vital-track st"><i></i></div><button class="vital-mute" type="button" title="音效开关">${isMuted()?'🔇':'🔊'}</button></div>`
  document.body.append(vitals)
  const hpBar=vitals.querySelector<HTMLElement>('.vital-track.hp > i')!
  const stBar=vitals.querySelector<HTMLElement>('.vital-track.st > i')!
  // 静音键放体力条右侧（原来是绝对定位，和体力条重叠了）
  const muteBtn=vitals.querySelector<HTMLButtonElement>('.vital-mute')!
  muteBtn.onclick=()=>{muteBtn.textContent=toggleMute()?'🔇':'🔊'}
  const downPanel=document.createElement('div')
  downPanel.className='down-panel';downPanel.hidden=true
  downPanel.innerHTML='<b>你倒下了</b><em class="down-tip">等人扶起，或 25 秒后点此重生</em><button type="button" class="down-btn" disabled>重生</button>'
  document.body.append(downPanel)
  const downTip=downPanel.querySelector<HTMLElement>('.down-tip')!
  const downBtn=downPanel.querySelector<HTMLButtonElement>('.down-btn')!
  downBtn.onclick=()=>{if(!down)return;hp=Math.round(HP_MAX*.6);down=false;downPanel.hidden=true;downBtn.disabled=true
    place(cfg.gate.x,cfg.gate.z,'respawn');yaw=cfg.gate.yaw;poseFlags.down=false;sfx.revive()}

  /** 受伤：扣血、飘红、必要时倒地 */
  function damage(amount:number,reason:string){
    if(!active||down)return
    hp=Math.max(0,hp-amount)
    hpRegen=0
    sfx.hurt()
    const flash=document.createElement('div');flash.className='hurt-flash'
    document.body.append(flash);setTimeout(()=>flash.remove(),320)
    if(hp<=0){down=true;downSince=performance.now();downPanel.hidden=false;downTip.textContent='等人扶起，或 25 秒后点此重生'
      downBtn.disabled=true;poseFlags.down=true;sfx.down()
      if(rides?.bike&&rides.bike)rides.stop()}
    else if(reason==='crash')sfx.crash()
  }

  /** 被扶起 / 重生 */
  function revive(by='self'){
    if(!down)return
    down=false;poseFlags.down=false;staggerT=0;throwT=0
    // 强制清掉残留姿态：倒地/踉跄用过的角度全部归零，否则会「一直斜着站不起来」
    figure.rotation.set(0,figure.rotation.y,0,'YXZ')
    hp=Math.max(24,Math.round(HP_MAX*.5));downPanel.hidden=true;downBtn.disabled=true
    if(by!=='self')downTip.textContent='被 '+by+' 扶起来了'
    sfx.revive()
  }

  // ===== 战斗反馈 =====
  // 出手方：屏幕中央的准心确认（打中谁、掉多少血、打倒了谁）
  // 被打方：从挨打方向打过来的一道红弧 + 一行「被 X 打中 -N」
  const hitMarker=document.createElement('div')
  hitMarker.className='hit-marker'
  hitMarker.innerHTML='<span class="hm-x">✕</span><span class="hm-text"></span>'
  document.body.append(hitMarker)
  const hmText=hitMarker.querySelector<HTMLElement>('.hm-text')!
  const hurtArc=document.createElement('div')
  hurtArc.className='hurt-arc'
  document.body.append(hurtArc)
  const hurtText=document.createElement('div')
  hurtText.className='hurt-text'
  document.body.append(hurtText)
  const combatFwd=new THREE.Vector3()
  let hitMarkerTimer=0,hurtArcTimer=0,hurtTextTimer=0
  /** 昵称是别人传来的，进 innerHTML 前必须转义 */
  const escName=(text:string)=>text.replace(/[&<>"']/g,c=>
    c==='&'?'&amp;':c==='<'?'&lt;':c==='>'?'&gt;':c==='"'?'&quot;':'&#39;')

  function flashHitMarker(html:string,hold:number,kill=false){
    clearTimeout(hitMarkerTimer)
    hmText.innerHTML=html
    hitMarker.classList.add('show')
    hitMarker.classList.toggle('kill',kill)
    hitMarkerTimer=window.setTimeout(()=>{hitMarker.classList.remove('show');hitMarker.classList.remove('kill')},hold)
  }

  /** 打中了谁：名字 + 伤害 + 对方是不是蹲着（蹲着伤害 +1，提示一下才知道为什么） */
  function showHitConfirm(hit:{name:string;damage:number;low:boolean}){
    flashHitMarker(`${escName(hit.name)} <b>-${hit.damage}</b>${hit.low?'<small> · 蹲着</small>':''}`,420)
  }

  /** 打倒了谁 */
  function showKnockdown(name:string){
    flashHitMarker(`<b>击倒了 ${escName(name)}</b>`,1000,true)
  }

  /** 挨打：按攻击者相对镜头的方位打一道弧（正前方 = 屏幕上方） */
  function showHurtDir(dmg:number,by:string,from:{x:number;y:number;z:number}|null){
    let angle=0
    if(from){
      const dx=from.x-camera.position.x,dz=from.z-camera.position.z
      camera.getWorldDirection(combatFwd)
      combatFwd.y=0
      if(combatFwd.lengthSq()>1e-6){
        combatFwd.normalize()
        // 镜头右方向 = (-fz, fx)；atan2(右分量, 前分量) 正好对上 CSS 的顺时针旋转
        angle=Math.atan2(dx*-combatFwd.z+dz*combatFwd.x,dx*combatFwd.x+dz*combatFwd.z)
      }
    }
    hurtArc.style.setProperty('--a',angle.toFixed(3)+'rad')
    hurtArc.classList.add('show')
    clearTimeout(hurtArcTimer)
    hurtArcTimer=window.setTimeout(()=>hurtArc.classList.remove('show'),900)
    hurtText.innerHTML=`被 <b>${escName(by)}</b> 打中 <em>-${dmg}</em>`
    hurtText.classList.add('show')
    clearTimeout(hurtTextTimer)
    hurtTextTimer=window.setTimeout(()=>hurtText.classList.remove('show'),1500)
  }

  /** 扫码提示条 */
  const scanTip=document.createElement('div')
  scanTip.className='scan-tip';scanTip.hidden=true
  document.body.append(scanTip)
  let scanTimer=0

  let lastSpeedText='',lastMetaText=''
  function updateRideUi(speed:number,distance:number){
    const riding=!!rides?.bike
    rideHud.hidden=!riding
    if(!riding){if(scanTimer){clearTimeout(scanTimer);scanTimer=0}scanTip.hidden=true;return}
    // 只有数字变了才写 DOM，避免每帧触发布局计算（骑行掉帧的一个来源）
    const speedText=String(Math.round(speed*3.6))
    if(speedText!==lastSpeedText){lastSpeedText=speedText;rideSpeedEl.textContent=speedText}
    const metaText=`${(distance/1000).toFixed(2)} km · 电量 ${Math.max(0,100-Math.floor(distance/60))}%`
    if(metaText!==lastMetaText){lastMetaText=metaText;rideMetaEl.textContent=metaText}
  }
  /** 8 m 内最近的一辆车（实例化后不再逐个做射线检测） */
  function bikeUnderPointer(){
    // 不要求附近有车：从全城停车点里挑离玩家最近的一辆，直接挪过来
    const pool=(rides?.bikes??[]) as {x:number;y:number;z:number;angle:number;paint:number;slots:{mesh:THREE.InstancedMesh;index:number}[];hidden:boolean}[]
    const target=rides?.nearest??pool.reduce<(typeof pool)[number]|null>((best,record)=>{
      const d=Math.hypot(record.x-figure.position.x,record.z-figure.position.z)
      if(!best)return record
      const bd=Math.hypot(best.x-figure.position.x,best.z-figure.position.z)
      return d<bd?record:best
    },null)??null
    if(!target)return null
    const distance=Math.hypot(target.x-figure.position.x,target.z-figure.position.z)
    return distance<=8?{bike:target,distance}:null
  }
  /** 身边 10 m 内站着的那辆车（含手机叫来的那辆）：同步给别人用 */
  function nearbyBike(){
    type Rec={x:number;y:number;z:number;angle:number;hidden:boolean}
    const found:{record:Rec|null;distance:number}={record:null,distance:Infinity}
    const consider=(record:Rec|null|undefined)=>{
      if(!record||record.hidden)return
      const d=Math.hypot(record.x-figure.position.x,record.z-figure.position.z)
      if(d<found.distance){found.distance=d;found.record=record}
    }
    for(const record of (rides?.bikes??[]) as Rec[])consider(record)
    consider(rides?.nearest as Rec|undefined)
    // 手机叫来的那辆是独立模型（不在 parkedAll 里），下车后也要能被别人看见
    consider(rides?.placedBike as Rec|null|undefined)
    return found.record&&found.distance<=10?found.record:null
  }
  function startScan(){
    if(!active||rides?.bike||scanTimer)return
    const target=bikeUnderPointer()
    if(!target)return
    scanTip.hidden=false
    scanTip.textContent='扫码中… 青桂出行'
    scanTimer=window.setTimeout(()=>{
      scanTimer=0
      scanTip.hidden=true
      if(rides?.mount(target.bike)){
        scanTip.textContent='开锁成功，按 W 骑行'
        scanTip.hidden=false
        setTimeout(()=>{scanTip.hidden=true},1800)
      }
    },900)
  }
  canvas.addEventListener('pointerdown',event=>{if(event.button===0&&active&&!rides?.bike)startScan()})
  // —— P：手机（对齐 nanningol 的 phone-open；本轮先做「叫车」）
  const phone=document.createElement('div')
  phone.style.cssText='position:fixed;inset:0;z-index:120;display:none;align-items:center;justify-content:center;background:rgba(8,12,10,.55);backdrop-filter:blur(3px)'
  phone.innerHTML=`
    <div style="width:320px;border-radius:28px;padding:18px;background:linear-gradient(160deg,#173c37,#0d211f);color:#e9f4ef;box-shadow:0 30px 80px rgba(0,0,0,.5);border:1px solid rgba(255,255,255,.12)">
      <div style="display:flex;justify-content:space-between;align-items:center;font:600 12px ui-monospace;letter-spacing:1px;color:#8fb8ad"><span>GUILIN · 12:00</span><span>5G</span></div>
      <div style="margin:14px 0 10px;font:700 20px/1.3 system-ui;color:#fff">青桂出行<small style="display:block;font:400 12px system-ui;color:#8fb8ad;margin-top:4px">扫码 / 叫车</small></div>
      <button data-act="hail" style="width:100%;padding:14px;border-radius:16px;border:0;background:#2fd6a6;color:#06231c;font:700 15px system-ui;cursor:pointer">叫一辆车过来</button>
      <p data-msg style="margin:10px 2px 0;font:400 12px/1.5 system-ui;color:#9fc3b8">会把最近的一辆青桂电车叫到你身边。</p>
      <button data-act="close" style="margin-top:12px;width:100%;padding:10px;border-radius:14px;border:1px solid rgba(255,255,255,.18);background:transparent;color:#cfe4dc;font:500 13px system-ui;cursor:pointer">收起手机 P</button>
    </div>`
  document.body.append(phone)
  const phoneMsg=phone.querySelector('[data-msg]') as HTMLElement
  const closePhone=()=>{phone.style.display='none'}
  phone.addEventListener('click',event=>{if(event.target===phone)closePhone()})
  phone.querySelector('[data-act="close"]')!.addEventListener('click',closePhone)
  phone.querySelector('[data-act="hail"]')!.addEventListener('click',()=>{
    // 不要求附近有车：从全城停车点里挑离玩家最近的一辆，直接挪过来
    const pool=(rides?.bikes??[]) as {x:number;y:number;z:number;angle:number;paint:number;slots:{mesh:THREE.InstancedMesh;index:number}[];hidden:boolean}[]
    const target=rides?.nearest??pool.reduce<(typeof pool)[number]|null>((best,record)=>{
      const d=Math.hypot(record.x-figure.position.x,record.z-figure.position.z)
      if(!best)return record
      const bd=Math.hypot(best.x-figure.position.x,best.z-figure.position.z)
      return d<bd?record:best
    },null)
    if(!target){phoneMsg.textContent='车库里暂时没有可调的车。';return}
    phoneMsg.textContent='骑手正在赶来…'
    window.setTimeout(()=>{
      const px=figure.position.x+Math.cos(yaw)*1.1, pz=figure.position.z-Math.sin(yaw)*1.1
      rides?.summon(target,px,pz)
      phoneMsg.textContent='车到了，就在你旁边，按 E 上车。'
      window.setTimeout(closePhone,350)
    },1400)
  })
  // 用捕获阶段拦下 P，避免同时触发拍照模式
  window.addEventListener('keydown',event=>{
    if(event.code!=='KeyL'||!active||event.repeat)return
    event.preventDefault()
    event.stopImmediatePropagation()
    const open=phone.style.display==='flex'
    phone.style.display=open?'none':'flex'
  },{capture:true})
  window.addEventListener('keydown',event=>{if(event.code==='Enter'&&active&&!rides?.bike){event.preventDefault();startScan()}})
  // —— H 隐藏全部 HUD、V 切换第一/第三人称（对齐 nanningol 的 hud-hide / camera）
  window.addEventListener('keydown',event=>{
    if(!active||event.repeat)return
    if(event.code==='KeyH'){
      event.preventDefault()
      document.body.toggleAttribute('data-hud-hidden')
      return
    }
  })
  // —— F3：切第一/第三人称（V 保留给全局的 飞行/步行 切换，避免一键两用）
  window.addEventListener('keydown',event=>{
    if(event.code!=='F3'||!active||event.repeat)return
    event.preventDefault()
    // 骑车时也允许切视角：第一人称是「胸口前方」，第三人称是「车后上方」
    firstPerson=!firstPerson
    character.setHeadHidden(firstPerson)
  })
  // —— Alt 切换鼠标锁定：锁定后隐藏光标，鼠标移动 = 转头（上下左右）
  window.addEventListener('keydown',event=>{
    if(event.code!=='AltLeft'&&event.code!=='AltRight')return
    event.preventDefault()
    if(document.pointerLockElement===canvas)document.exitPointerLock()
    else void canvas.requestPointerLock()
  })
  window.addEventListener('mousemove',event=>{
    if(!document.pointerLockElement)return
    lookYaw-=event.movementX*0.0025
    lookPitch=THREE.MathUtils.clamp(lookPitch+event.movementY*0.0025,-1.15,1.15)
  })
  // 俯冲入场：相机沿竖直方向从高处落到落点上方，前慢后快再收尾
  // 分段俯冲：每段先慢（停顿感）再快速下压
  const DIVE_Y = [80, 80, 60, 60, 30, 30, 10, 10.4, 1.65]
  const DIVE_T = [0, .13, .20, .38, .45, .62, .69, .84, 1]
  function stepDive(t:number){
    for (let i=1;i<DIVE_T.length;i++){
      if (t<=DIVE_T[i]){
        const span=DIVE_T[i]-DIVE_T[i-1]||1
        const local=(t-DIVE_T[i-1])/span
        const k=local*local*(3-2*local)   // smoothstep：两头慢中间快
        return DIVE_Y[i-1]+(DIVE_Y[i]-DIVE_Y[i-1])*k
      }
    }
    return DIVE_Y[DIVE_Y.length-1]
  }
  function diveCamera(now:number,base:THREE.Vector3){
    const t=Math.min(1,(now-dive.start)/dive.dur)
    const k=1-Math.pow(1-t,3)   // 保留给旧逻辑
    // DIVE_Y 是「相对落点眼高」的高度（1.65 = 眼高，80 = 起点），不是绝对海拔：
    // 直接当绝对 y 用会一头钻进地面以下（桂林市区地面在 150 m 上下），俯冲结束再猛地弹上来。
    const y=stepDive(t)
    camera.position.set(base.x,base.y+y-1.65,base.z)
    if(t>0.84){
      camera.lookAt(base.x,base.y+0.05,base.z-5)
    } else {
      // 俯冲期间低头看落点周围的屋顶/街面，避免高空看到没加载的天空
      camera.lookAt(base.x,Math.max(0.6,base.y-1.2),base.z-13)
    }
    camera.fov=64;camera.updateProjectionMatrix()
    return t>=1
  }
  const civic=JSON.parse(localStorage.getItem('guiling.civic.v1')||'null') as {uid?:string;name?:string}|null
  const mpOn=localStorage.getItem('guiling.mp')==='1'
  const net=mpOn?attachNet(scene,{uid:civic?.uid??'',name:civic?.name??'游客'},camera):null
  ;(window as unknown as {__net?:unknown}).__net=net
  // —— 联机战斗：被人打 / 被人扶起 / 打倒了人 ——
  net?.onHit?.((dmg,by,byId)=>{
    showHurtDir(dmg,by??'陌生人',byId?(net?.peerPosition?.(byId)??null):null)
    damage(Math.max(1,Math.round(dmg)),'hit')
  })
  net?.onRevive?.(by=>revive(by||'同伴'))
  net?.onDown?.(name=>showKnockdown(name))
  // —— 左键出拳：拖动视角不算，短时间内没移动才算一拳 ——
  let pressAt=0,pressX=0,pressY=0
  canvas.addEventListener('pointerdown',event=>{if(event.button!==0)return;pressAt=performance.now();pressX=event.clientX;pressY=event.clientY})
  canvas.addEventListener('pointerup',event=>{
    if(event.button!==0||!active||down||held)return
    if(performance.now()-pressAt>340)return
    if(Math.hypot(event.clientX-pressX,event.clientY-pressY)>7)return
    if(rides?.bike||rides?.boat)return
    punchT=1;sfx.punch()
    const hit=net?.punch?.()??null
    if(hit){sfx.hit();showHitConfirm(hit)}
  })
  // —— E 键：附近有人倒地时优先扶人（原上车/下车逻辑仍走 walkInput）——
  window.addEventListener('keydown',event=>{
    if(event.code==='Space')spaceHeld=true
    if(!active||event.code!=='KeyE'||down)return
    net?.reviveNearest?.()
  })
  window.addEventListener('keyup',event=>{if(event.code==='Space')spaceHeld=false})
  window.addEventListener('blur',()=>{spaceHeld=false})
  function follow(){
    // 联机：上报自己 + 推进其他人
    try{const bk=rides?.bike as unknown as {position?:{x:number;z:number}}|undefined;
      // 身边站着的那辆车（含手机叫来的）也一起同步，否则别人看不见你叫的车
      const near=rides?.bike?null:nearbyBike()
      // 抽烟状态：sc=0 没抽 / 1 点烟 / 2 抽着；sb=剩余可燃时间×10；sp=吸了几口的计数；br=品牌序号
      const smoke=smoking.net()
      net?.tick({x:figure.position.x,y:figure.position.y,z:figure.position.z,yaw:figure.rotation.y,v:(rides?.speed??0),bike:rides?.bike?'bike':'',bx:bk?.position?.x??0,bz:bk?.position?.z??0,byaw:(rides as unknown as {heading?:number})?.heading??0,
        hb:near?1:0,hx:near?.x??0,hz:near?.z??0,hyaw:near?.angle??0,
        cr:poseFlags.crouch?1:0,gr:poseFlags.grounded?1:0,dn:poseFlags.down?1:0,pn:punchT>.02?1:0,wl:Math.round(Math.min(1,wheelieAng/1.55)*100)/100,
        hp:Math.max(0,Math.min(100,Math.round(hp/HP_MAX*100))),
        sc:smoke.sc,sb:smoke.sb,sp:smoke.sp,br:smoke.br},16)}catch{}
    // 俯冲入场期间接管相机
    if(dive.start&&performance.now()-dive.start<dive.dur){
      if(!firstPerson){firstPerson=true;character.setHeadHidden(true)}
      const base=figure.position.clone();base.y+=1.65
      setEnterProgress(0.8+0.17*Math.min(1,(performance.now()-dive.start)/dive.dur))
      diveCamera(performance.now(),base)
      return
    }
    // 俯冲结束：收起遮罩，进入正常第一人称
    if(dive.start&&performance.now()-dive.start>=dive.dur&&teleportTip.style.display!=='none'){
      teleportTip.hidden=true;teleportTip.style.cssText='display:none'
    }
    const pos=sim.body.translation();figure.position.set(pos.x,pos.y-cfg.height/2,pos.z)
    if(rides?.boat){figure.position.copy(rides.boat.position);figure.position.y+=rides.boat.name==='raft'?-.44:-.18;figure.rotation.y=rides.heading}
    rides?.park(figure.position)
    if(rides?.bike){
      // 骑上车：第一人称，但保留自己的手臂/大腿——相机放在头部前方一点，广角把手脚带进画面
      const bike=rides.bike
      applyWheelie()
      bike.updateWorldMatrix(true,false)
      // 人保持直立：之前让身体跟着车一起仰，摄像机会被压到地面以下（看着像「按到地里」）。
      // 车头抬到 ~30° 时车把只到胸口高度，直立着用 IK 就能扶住。
      figure.rotation.set(0,rides.heading,rides.bike?rides.bike.rotation.z*.7:0,'YXZ')
      const seat=bike.localToWorld(new THREE.Vector3(0,0.792,-0.20))
      figure.position.set(seat.x,seat.y-0.91,seat.z)
      figure.visible=true
      if(!firstPerson){
        // 第三人称骑行：镜头在车后上方，人物连头一起画出来
        character.setHeadHidden(false)
        focus.copy(figure.position);focus.y+=1.35
        direction.set(Math.sin(yaw+lookYaw)*Math.cos(pitch+lookPitch),Math.sin(pitch+lookPitch),Math.cos(yaw+lookYaw)*Math.cos(pitch+lookPitch))
        const rear=sim.world.castRay(new R.Ray(focus,direction),arm,true,undefined,undefined,sim.capsule)
        const back=Math.max(.9,(rear?.timeOfImpact??arm)-.18)
        camera.position.copy(focus).addScaledVector(direction,back);camera.lookAt(focus)
        return
      }
      // 第一人称骑行：人物留着（画面下半部能看到自己的手臂和大腿），只藏头。
      // 坐姿由 figure.pose 的 ride 叠加层给（腿前伸、手扶把），所以不会再出现
      // 「站着骑车」或者「整具人被藏掉看不到手」这两种极端。
      character.setHeadHidden(true)
      // 广角（rideFov 之前定义了却没接上）：把手、车把、大腿都收进画面下三分之一
      if(camera.fov!==rideFov){camera.fov=rideFov;camera.updateProjectionMatrix()}
      // 相机放在「头骨前方一点、略低于眼睛」：车把/双手在画面下三分之一，低头能看到大腿。
      // 注意车模型的朝向是 heading+π（见 vehicles.park），所以别再用车辆局部坐标去推相机，
      // 直接用人物头骨 + 前进方向偏移，不受任何模型朝向约定影响。
      // 相机就放在头骨上（头已隐藏，0.001 缩放在镜头里看不见），只往前挪一丁点：
      // 往前挪太多手就跑到镜头正下方了（实测 0.15 m 前/0.36 m 下 → 在 88° 视场外），
      // 放回头部左右手才落在画面下三分之一。
      const eye=character.headPosition(new THREE.Vector3())
      const fwd=new THREE.Vector3(-Math.sin(rides.heading+lookYaw),0,-Math.cos(rides.heading+lookYaw))
      eye.addScaledVector(fwd,-.04);eye.y-=.06
      camera.position.copy(eye)
      // 翘头时视线要跟着抬高一点，否则 50° 以上的车头会糊住整个画面
      const pitchTotal=lookPitch+.2+wheelieAng*.12
      const lookDir=new THREE.Vector3(Math.sin(rides.heading+lookYaw)*Math.cos(pitchTotal),Math.sin(pitchTotal),Math.cos(rides.heading+lookYaw)*Math.cos(pitchTotal))
      camera.lookAt(eye.clone().sub(lookDir))
      focus.copy(eye)
      return
    }
    if(camera.fov!==footFov){camera.fov=footFov;camera.updateProjectionMatrix()}
    figure.visible=true
    character.setRiderView(false)
    figure.visible=true
    figure.visible=true
    if(firstPerson){
      // 走路第一人称：相机放在头骨位置，沿 yaw+lookYaw 看，隐藏自己的头
      const eye=character.headPosition(new THREE.Vector3())
      // 第一人称时人物永远朝镜头方向，避免后退时胸/背挡住相机
      figure.rotation.y=yaw+lookYaw
      eye.addScaledVector(new THREE.Vector3(-Math.sin(yaw+lookYaw),0,-Math.cos(yaw+lookYaw)),0.14)
      eye.y+=0.03
      character.setHeadHidden(true)
      const pitchTotal=lookPitch-0.02
      const look=new THREE.Vector3(Math.sin(yaw+lookYaw)*Math.cos(pitchTotal),Math.sin(pitchTotal),Math.cos(yaw+lookYaw)*Math.cos(pitchTotal))
      camera.position.copy(eye)
      camera.lookAt(eye.clone().sub(look))
      focus.copy(eye)
      return
    }
    character.setHeadHidden(false)
    focus.copy(figure.position);focus.y+=1.4;direction.set(Math.sin(yaw+lookYaw)*Math.cos(pitch+lookPitch),Math.sin(pitch+lookPitch),Math.cos(yaw+lookYaw)*Math.cos(pitch+lookPitch))
    const distance=arm,hit=sim.world.castRay(new R.Ray(focus,direction),distance,true,undefined,undefined,sim.capsule)
    // 撞到墙时把镜头拉近，但始终和人物保持 0.9 m 以上，避免穿进模型里（“灵魂出窍”的观感）
    const reach=Math.max(.9,(hit?.timeOfImpact??distance)-.18)
    camera.position.copy(focus).addScaledVector(direction,reach);camera.lookAt(focus)
  }
  const terrainRay=new THREE.Raycaster(undefined,new THREE.Vector3(0,-1,0))
  /**
   * 看得见的地面高度：物理面（碰撞体）和渲染网格是两套数据，坡上/边缘能差几厘米，
   * 车轮贴在物理面上就会「陷进贴图」。这里对已加载的地面网格打一条竖直线取真实高度。
   */
  function visibleGroundY(x:number,z:number,fallback:number){
    const tile=sim.tileAt(x,z)
    const mesh=tile&&stream.loaded.get(tile)?.groundMesh
    if(!mesh)return fallback
    terrainRay.ray.origin.set(x,4000,z)
    mesh.updateWorldMatrix(true,false)
    const hit=terrainRay.intersectObject(mesh,false)[0]
    return hit?hit.point.y:fallback
  }
  function boatClearance(){const boat=rides?.boat;if(!boat)return null
    figure.updateMatrixWorld(true)
    const roof=new THREE.Box3().setFromObject(boat,true).max.y,head=new THREE.Box3().setFromObject(figure,true).max.y
    let underside=Infinity
    for(const along of [-2.3,-1,0,1,2.3])for(const across of [-1,0,1]){const point=boat.localToWorld(new THREE.Vector3(across,0,along)),deck=sim.surface(point.x,point.z,'deck');if(deck)underside=Math.min(underside,deck.y-(deck.thin?.6:look.bridgeDepth))}
    return {kind:boat.name,head,roof,underside,clearance:underside-Math.max(head,roof)}}
  function probe(){const pos=sim.body.translation(),foot=pos.y-cfg.height/2,peak=sim.surface(pos.x,pos.z,'peak')
    const tile=sim.tileAt(pos.x,pos.z),mesh=tile&&stream.loaded.get(tile)?.groundMesh
    terrainRay.ray.origin.set(pos.x,4000,pos.z);mesh?.updateWorldMatrix(true,false)
    const renderY=mesh?terrainRay.intersectObject(mesh,false)[0]?.point.y:undefined
    return {x:pos.x,z:pos.z,foot,renderY,renderClearance:foot-(renderY??Infinity),clearance:foot-(sim.surface(pos.x,pos.z,'ground')?.y??Infinity),inHouse:sim.insideHouse(pos.x,pos.z)||sim.overlaps('building'),
      inPeak:!!peak&&peak.y>foot+.3||sim.overlaps('peak'),deck:sim.surface(pos.x,pos.z,'deck')?.y,wet:sim.wet(pos.x,pos.z),blockedWater,resets,steps,physicsMs,elapsed,hits:lastHits}}
  function tick(dt:number){if(!active)return;const before=performance.now(),start=rides?.boat?.position??sim.body.translation();sim.sync(start.x,start.z);rides?.nearby(start.x,start.z)
    if(rides?.boat){if(!held)rides.advance(Math.min(.25,dt));if(!wasBoat){yaw=rides.heading+.95}wasBoat=!!rides.boat;follow();return}wasBoat=false
    // 移动方向必须和镜头同一个 yaw（含鼠标转头偏移），否则会出现「镜头朝前、人物侧着走」
    const yawEff=yaw+lookYaw
    const read=input.read(),keys=held?still:read,delta=new THREE.Vector2(keys.right*Math.cos(yawEff)-keys.forward*Math.sin(yawEff),-keys.forward*Math.cos(yawEff)-keys.right*Math.sin(yawEff))
    if(external)delta.set(external.x,external.z);delta.divideScalar(Math.max(1,delta.length()))
    let speed=external?.run??keys.run?cfg.run:cfg.walk;const step=1/60;let traveled=0;lastHits=[];blockedWater=false
    if(rides?.bike){const previous=rides.heading;speed=rides.steer(keys.forward,keys.right,Math.min(.12,dt));delta.set(-Math.sin(rides.heading),-Math.cos(rides.heading));yaw=wasBike?yaw+rides.heading-previous:rides.heading}
    wasBike=!!rides?.bike
    if(keys.jump&&grounded&&!wasBike)velocity=Math.sqrt(-2*cfg.gravity*cfg.jump)
    accumulator+=Math.min(.12,dt)
    // 骑车速度要在物理子步里就记下来：撞上后 rides.stop() 会把速度清零
    const bikeSpeedBefore=rides?.bike?rides.speed:0
    let wallHit=''
    while(accumulator>=step){accumulator-=step;steps++;elapsed+=step
      const pos=sim.body.translation();velocity+=cfg.gravity*step
      sim.controller.computeColliderMovement(sim.capsule,{x:delta.x*speed*step,y:velocity*step,z:delta.y*speed*step})
      const move=sim.controller.computedMovement(),next={x:pos.x+move.x,y:pos.y+move.y,z:pos.z+move.z}
      grounded=sim.controller.computedGrounded();if(grounded&&velocity<0)velocity=0
      // 撞击检测：骑车时也要收集碰撞，不然「撞房子摔车」永远触发不了
      if(verify||rides?.bike)for(let at=0;at<sim.controller.numComputedCollisions();at++){const coll=sim.controller.computedCollision(at)?.collider;if(coll)lastHits.push(sim.kinds.get(coll.handle)??'')}
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
      if(rides?.bike){let obstacle='';const footY=next.y-cfg.height/2
        if(Math.hypot(move.x,move.z)<speed*step*.35)for(let at=0;at<sim.controller.numComputedCollisions();at++){
          const contact=sim.controller.computedCollision(at),ckind=contact?.collider&&sim.kinds.get(contact.collider.handle)
          if(contact&&contact.normal1.y<Math.cos(cfg.slope)){
            if((ckind==='deck'||ckind==='ground'||ckind==='sidewalk')&&contact.witness1.y<=footY+cfg.step+.05)continue
            obstacle=ckind==='building'?'building':'collision';break
          }
        }
        // 骑车不该被「路沿/非人行道」挡住（那就是空气墙）：只挡建筑和水，其余照走
        const offPavement=!rides.pavement(next.x,next.z)
        const reason=sim.insideHouse(next.x+delta.x*.72,next.z+delta.y*.72)?'building':obstacle
        if(reason||(offPavement&&blockedWater)){bikeObstacle=reason||'water';next.x=pos.x;next.z=pos.z;rides.stop();speed=0}
        if(reason){bikeObstacle=reason;next.x=pos.x;next.z=pos.z;rides.stop();speed=0
          // 只有「墙面级别的撞击 + 速度够」才算摔车，压过路沿不算
          if(bikeSpeedBefore>3.2)wallHit=reason}
      }
      traveled+=Math.hypot(next.x-pos.x,next.z-pos.z);sim.body.setNextKinematicTranslation(next);sim.world.step();if(grounded&&!blockedWater)safe.set(next.x,next.y,next.z)
    }
    physicsMs+=performance.now()-before
    // 朝向每帧都要写：联机上报的 yaw 就是 figure.rotation.y，
    // 之前只在第三人称更新，第一人称下别人看到的还是旧朝向（侧身/背身）。
    if(traveled>.001)figure.rotation.set(0,Math.atan2(-delta.x,-delta.y),0,'YXZ')
    else if(firstPerson)figure.rotation.set(0,yaw+lookYaw,0,'YXZ')
    // 用平滑后的实际速度判断是否在走：高刷新率屏幕上物理子步不一定每帧都跑，
    // 只看单帧 traveled 会把走路判成静止，动画就卡住（看起来像不摆臂）。
    const measured=dt>0?Math.min(20,traveled/dt):0
    motion+=(measured-motion)*Math.min(1,dt*10)
    // —— 倒地：不能动，也不能骑 ——
    if(down){
      delta.set(0,0);speed=0
      // 倒地倒计时（真实 25 秒，逐秒刷新）
      const left=Math.max(0,Math.ceil((DOWN_WAIT-(performance.now()-downSince))/1000))
      if(downBtn.disabled&&left<=0){downBtn.disabled=false}
      downTip.textContent=left>0?`等人扶起，或 ${left} 秒后点此重生`:'点「重生」回到正阳门'
    }
    // —— 体力：跑 / 翘头消耗，站着恢复 ——
    if(staggerT>.9){delta.multiplyScalar(.15);speed=Math.min(speed,cfg.walk*.35)}
    const sprinting=!down&&!rides?.bike&&!rides?.boat&&keys.run&&motion>1.1&&grounded
    stamina=sprinting?Math.max(0,stamina-dt*.22):Math.min(1,stamina+dt*(down?.05:.14))
    if(sprinting&&stamina<=.001){speed=Math.min(speed,cfg.walk);if(Math.random()<dt*2)sfx.tired()}
    // —— 翘头：骑行中按 Space，速度够就抬前轮（骑手由 IK 自动跟着车把） ——
    let wheelieTarget=0
    // 拍照冻结（held）时不要衰减翘头，否则一按拍照车头就掉了
    if(held&&wheelieAng>.001){wheelieTarget=wheelieAng}
    else if(rides?.bike&&!down&&(spaceHeld||keys.jump||holdWheelie)&&rides.speed>1.6&&stamina>.04){
      // 按住会一路抬上去：0.2 rad 起，约 1.4 秒到 90°（1.55 rad）封顶；翘过头会摔（见下）
      wheelieHold+=dt
      wheelieTarget=Math.min(1.55,.2+wheelieHold*1.0)
      stamina=Math.max(0,stamina-dt*.12)
    }else wheelieHold=0
    wheelieAng+=(wheelieTarget-wheelieAng)*Math.min(1,dt*(wheelieTarget>wheelieAng?7:9))
    // 翘过头（> 68°）就压不住车了：直接摔车
    if(rides?.bike&&!down&&wheelieAng>1.2&&crashCooldown<=0){crash('wheelie',3.4)}
    if((wheelieAng>.12)!==wheelieWas){wheelieWas=wheelieAng>.12;sfx.wheelie(wheelieWas)}
    // —— 撞车：骑车撞上建筑/树/棚子且速度够 → 扣血、人被甩出去、车侧倒 ——
    crashCooldown=Math.max(0,crashCooldown-dt)
    if(rides?.bike&&!down&&crashCooldown<=0&&wallHit&&bikeSpeedBefore>3.2){
      crash(wallHit,bikeSpeedBefore)
    }
    // 被甩出去的那一小段：带一点前冲 + 弹起，落地后踉跄
    if(throwT>0){
      throwT=Math.max(0,throwT-dt*1.25)
      const push=throwT*3.4
      delta.x+=crashDir.x*push;delta.y+=crashDir.y*push
    }
    staggerT=Math.max(0,staggerT-dt)
    // —— 出拳动画衰减 / 脚步音效 ——
    punchT=Math.max(0,punchT-dt*2.6)
    if(!down&&!rides?.bike&&!rides?.boat&&grounded&&motion>.6){
      stepDist+=motion*dt
      if(stepDist>(keys.run?2.3:1.7)){stepDist=0;sfx.step(keys.run&&motion>cfg.run*.55)}
    }else stepDist=0
    if(!wasGrounded&&grounded&&!down)sfx.land()
    wasGrounded=grounded
    // —— 血量 / 体力条 ——
    if(!vitals.hidden){
      hpBar.style.width=(hp/HP_MAX*100).toFixed(0)+'%'
      stBar.style.width=(stamina*100).toFixed(0)+'%'
      hpBar.classList.toggle('low',hp<=30)
      stBar.classList.toggle('low',stamina<=.22)
    }
    // 骑车时先把人和车都摆到位，再算姿势：
    // 以前 follow() 是在 pose 之后才把人从「脚下坐标」挪到「车座坐标」，
    // 等于姿势按脚下解好、整体又平移一次 → 渲染出来手就离开车把了。
    if(rides?.bike){
      const pos=sim.body.translation()
      figure.position.set(pos.x,pos.y-cfg.height/2,pos.z)
      rides.park(figure.position)
      // 转向/轮子动画必须在算姿势之前推进：车把转了、手的把点才跟着一起转（同帧）
      rides.animate(dt,keys.right)
      rides.bike.updateWorldMatrix(true,false)
      // 翘头：绕后轮接地点抬前轮（车和人都抬，手仍由 IK 绑在车把上）
      applyWheelie()
      // 车轮永远在可见地面之上：物理面和渲染网格是两套数据，差几厘米就「陷进贴图」。
      // 抬到「可见地面 +2 cm」和当前车身高度里的较大值（翘头时车身本来就更高，不会被压回去）。
      const g=visibleGroundY(rides.bike.position.x,rides.bike.position.z,rides.bike.position.y)
      if(Number.isFinite(g)&&rides.bike.position.y<g+.02){
        rides.bike.position.y=g+.02
        rides.bike.updateWorldMatrix(true,false)
      }
      // 注意 localToWorld 的参数是「车身局部坐标」，别把世界坐标传进去
      const seat=rides.bike.localToWorld(rideScratch.set(0,0.792,-0.20))
      // 人保持直立（见 follow 里的说明）：车头抬起后靠手部 IK 扶住车把
      figure.rotation.set(0,rides.heading,rides.bike?rides.bike.rotation.z*.7:0,'YXZ')
      figure.position.set(seat.x,seat.y-0.91,seat.z)
    }
    character.pose(dt,{moving:motion>0.25,speed,grounded,crouch:keys.crouch||holdCrouch,riding:!!rides?.bike||!!rides?.boat,
      ride:rides?.bike?rideTargets(rides.bike,rides.heading):undefined,
      smoke:smoking.pose(),down:down?1:(staggerT>0?Math.min(.96,staggerT*1.5):0),punch:punchT>.02?Math.min(1,punchT*1.5):0})
    // 联机要用的姿势状态：别人也要能看见你在蹲 / 在跳 / 倒在地上
    poseFlags.crouch=!!(keys.crouch||holdCrouch)
    poseFlags.grounded=grounded
    poseFlags.down=down
    wasRiding=!!rides?.bike
    if(rides?.bike){
      updateRideUi(rides.speed,rides.distance)
    }else{
      updateRideUi(0,0)
    }
    follow()
  }
  /** 对外的一帧：先推抽烟状态机（影响姿势），跑完物理和相机之后再摆道具 */
  function frame(dt:number){
    if(!active)return
    smoking.advance(dt)
    tick(dt)
    smoking.place(dt)
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
    for(const kind of ['sidewalk','ground'] as const){
      const hit=sim.surface(x,z,kind)
      if(hit)return {kind,y:Math.max(hit.y,waterY),sampleDistance:0}
    }
    throw Error(`Missing support at ${x},${z}`)
  }
  return {photoSupport,enter,leave,tick:frame,get smoking(){return smoking},get destination(){return destination},spawns,probe,boatClearance,get obstacle(){return bikeObstacle},get vehicle(){return rides?.bike?'bike':rides?.boat?'boat':'foot'},get heading(){return rides?.heading??0},get speed(){return rides?.speed??0},get active(){return active},drive(x:number,z:number,run=true){external={x,z,run}},
    /** 血量/体力/倒地（调试 + 测试用） */
    get vitals(){return {hp,hpMax:HP_MAX,stamina,down,wheelie:wheelieAng,punch:punchT}},
    hurt(amount:number){damage(Math.max(1,Math.round(amount)),'hit')},
    reviveSelf(){revive('self')},
    punchNow(){punchT=1;sfx.punch();const hit=net?.punch?.()??null;if(hit){sfx.hit();showHitConfirm(hit);return hit.id}return null},
    crashTest(impact=7){return crash('building',impact)},
    get yaw(){return yaw},hold(on:boolean){held=on;external=null;if(on)rides?.stop()},face(heading:number,tilt=cfg.pitch){yaw=heading;pitch=tilt;if(active)follow()},showFigure(on:boolean){figure.visible=on&&active},
    get position(){const pos=rides?.boat?.position??sim.body.translation();return focus.set(pos.x,pos.y,pos.z)},get figure(){return figure},get vehicles(){return rides}}
}
