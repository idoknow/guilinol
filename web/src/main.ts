import * as THREE from 'three'
import {bytes, fetchAsset, startOverview, type Manifest} from './world'
import {Stream} from './stream'
import {flight} from './flight'
import {look} from './look/config'
import {installAtmosphere, outerGround, sky} from './look/atmosphere'
import {startPeaks,type PeaksGroup} from './peaks'
import {presets,setPreset} from './presets'
import {walkConfig} from './walk/config'
import {atmo, env, evaluate} from './look/time'
import {currentMirrorLevel, isWaterInView, renderMirror, WATER_LAYER} from './look/water'
import {rain} from './look/rain'
import {windowLight} from './look/buildings'
import {skyClock} from './ui/sky'
import type {Host} from './play/host'
import {bootDismiss, bootLoaded, bootProgress} from './ui/boot'
import {loadTiles} from './look/tiles'
import {flags} from './debug'
import {createRenderer,preferredRenderer} from './look/renderer'
import {installBurgerMenu,installTouchBar} from './ui/touch'
import {probeWebGPU} from './look/webgpu'
import {activeTier,DynamicResolution,isSoftwareRenderer,pixelRatioFor,profileFor,readSetting,rendererName,type Setting,writeSetting} from './look/quality'

installAtmosphere()
// The title screen (ui/home.ts) pauses the scene while it covers it: no simulation, no draws.
let paused=false
export function setPaused(on:boolean){paused=on}
async function start() {
  bootProgress('载入地形', 12)
  const manifest:Manifest = JSON.parse(new TextDecoder().decode(await fetchAsset('manifest.json')))
  if(manifest.version!==4 || manifest.chunkSize!==256 || manifest.grid!==4) throw Error('Unsupported world format')
  const ovTask = startOverview(manifest), pkTask = startPeaks(manifest.peaks)
  await Promise.all([ovTask.dispatched, pkTask.dispatched])
  bootLoaded()
  // 总览地块（几十 KB）先到就先挂上，山体（6 MB）在后台继续解 —— 这段时间正好拿来预热出生点。
  const basePromise = ovTask.finish, peaksPromise = pkTask.finish
  // canvas 必须先挂到 DOM，WebGPU 才能配置 swapchain
  const canvas = document.createElement('canvas')
  document.body.prepend(canvas)
  const renderer = await createRenderer(canvas, preferredRenderer(new URLSearchParams(location.search)))
  // WebGPU 后端要求先 setSize，否则 clear()/render() 时 render target 还不存在
  renderer.setPixelRatio(1)
  renderer.setSize(innerWidth, innerHeight)
  renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = look.exposure
  // 画质：?quality=low|mid|high 覆盖 > 玩家手选 > 按 GPU 自动判断。软件渲染（SwiftShader）直接进省电档。
  const qualityParam = new URLSearchParams(location.search).get('quality')
  const forced = qualityParam==='low'||qualityParam==='mid'||qualityParam==='high'?qualityParam as Setting:null
  let setting:Setting = forced ?? readSetting()
  let tier = activeTier(setting), profile = profileFor(tier), dynamicScale = 1
  const makeDynamic = () => new DynamicResolution({min:profile.minScale,max:profile.maxScale},scale=>{dynamicScale=scale;resize()})
  let dynamic = makeDynamic()
  document.body.prepend(renderer.domElement)
  const camera = new THREE.PerspectiveCamera(55,1,1,look.fogHorizonTo)
  const scene = new THREE.Scene()
  scene.fog = new THREE.Fog(look.hazeNear,0,1)
  const dome = sky(), drops = rain(); scene.add(dome,drops)
  camera.layers.enable(WATER_LAYER)
  const light = new THREE.DirectionalLight(look.sunColor,look.sunPower)
  light.position.set(...look.sunDirection); scene.add(light)
  const hemi = new THREE.HemisphereLight(look.hemiSky,look.hemiGround,look.hemiPower); scene.add(hemi)
  const [left,top,width,depth] = manifest.extent
  scene.add(outerGround(manifest.extent))
  camera.position.set(left+width*.55,420,top+depth*.62)
  let walker:Awaited<ReturnType<typeof import('./walk').walk>>|undefined, switching=false
  let cinema=false
  let walkModPromise:Promise<typeof import('./walk')>|undefined
  const prefetchWalk = ()=>{
    walkModPromise ??= import('./walk').then(mod=>{void mod.preloadWalk();return mod})
    return walkModPromise
  }
  const controls = flight(camera,renderer.domElement,manifest.extent,()=>!walker?.active&&!switching&&!cinema)
  camera.lookAt(left+width*.47,150,top+depth*.45)
  function resize() {
    renderer.setPixelRatio(pixelRatioFor(profile,innerWidth,innerHeight,devicePixelRatio,dynamicScale))
    renderer.setSize(innerWidth,innerHeight)
    camera.aspect=innerWidth/innerHeight; camera.updateProjectionMatrix()
  }
  resize(); window.addEventListener('resize',resize)
  const base = await basePromise
  scene.add(base.mesh)
  const params = new URLSearchParams(location.search)
  const clock = skyClock(params)
  setPreset(camera,params.get('cam'))
  const radius = Number(params.get('radius')??profile.radius)
  const stream = new Stream(scene,manifest,base,THREE.MathUtils.clamp(Number.isFinite(radius)?radius:profile.radius,192,1600),camera)
  stream.forest.reach = profile.trees
  // 这次会自动进步行吗？进的话「出生点」现在就知道，不必等 walk 模块。
  const spawnName=params.get('spawn')
  const autoWalk=params.get('mode')!=='fly'&&!params.has('view')
  const spawnPoint=autoWalk
    ? (spawnName&&Object.hasOwn(presets,spawnName)?{x:presets[spawnName][0][0],z:presets[spawnName][0][2]}:{x:walkConfig.gate.x,z:walkConfig.gate.z})
    : null
  const applyBudget=()=>{
    // ?legacy=1 是对照组：退回「只开 1–2 路解码」的旧行为，方便量出改动前后的差别
    stream.maxPending = flags.legacyStream?(tier==='low'?1:2):(tier==='low'?2:3)
    if(stream.updateLandmarks)stream.updateLandmarks.budget = tier==='low'?2:4
  }
  applyBudget()
  // 出生点先挂上：渲染循环一起来就按这里推流，不必等玩家点进步行。
  if(spawnPoint) stream.prefetch(spawnPoint.x,spawnPoint.z)
  // 山体（6 MB）不再挡着首帧：先把总览地块画出来，相机可以立刻动、街块立刻开始流，
  // 山体到了再挂上（自动步行时这一步藏在进入遮罩后面）。手机上它光下载就要十几秒。
  const peaksPlaceholder=new THREE.Group()
  let peaks:PeaksGroup|undefined
  let peaksReady=false
  const peaksTask=peaksPromise.then(group=>{
    peaks=group
    scene.add(group)
    group.loadModels(renderer)
    peaksReady=true
    bootProgress('载入街区', 96)
    bootDismiss()
    return group
  }).catch(error=>{
    console.warn('山体加载失败',error)
    bootDismiss()
    return undefined
  })
  // 预热 walk 模块（Rapier 的 wasm 有三兆）：这段下载和山体并行，进游戏时就不用再等
  void prefetchWalk()
  bootProgress('载入街区', 78)
  const output = document.querySelector('output')!
  let previous=0, first=0, frame=0, sum=0, samples=0
  const stats = {firstMs:0,firstWorldBytes:0,ms:0,calls:0,frame:0,loaded:0,pending:0,visited:0,failures:0,
    geometries:0,textures:0}
  type Walker=Awaited<ReturnType<typeof import('./walk').walk>>
  async function loadWalker():Promise<Walker>{
    // 步行的山体碰撞要真数据：等山体到齐再建（自动步行时这段藏在加载屏后面）
    const group=await peaksTask
    if(!group) throw Error('山体数据不可用，无法进入步行')
    return walker??=await (await prefetchWalk()).walk(scene,camera,renderer.domElement,manifest,stream,group,params.has('verify'),renderer)
  }
  async function walkTo(x:number,z:number,yaw:number,reason:string){
    if(switching)return false
    switching=true
    // 传送目标一确定就开始抓：落在哪就先流哪，别等遮罩亮起来才开始下载
    stream.prefetch(x,z)
    try{await loadWalker();if(walker!.active)walker!.leave();return await walker!.enter(x,z,yaw,reason)}
    finally{switching=false;if(walker?.active)stream.clearFocus();showMode()}
  }
  async function toggle(initial=false){
    if(switching)return
    if(walker?.active){walker.leave();stream.clearFocus();return}
    switching=true
    try{
      const walking=await loadWalker()
      const name=params.get('spawn'),preset=initial&&name&&Object.hasOwn(presets,name)?presets[name]:null
      const original=camera.clone();if(preset)setPreset(original,name)
      const gate=walkConfig.gate,point=preset?.walk??(initial&&!preset?gate:{x:original.position.x,z:original.position.z,yaw:original.rotation.y})
      stream.prefetch(point.x,point.z)
      const entered=await walking.enter(point.x,point.z,point.yaw,initial?name??'default':'flight',!!preset?.walk)
      if(!entered&&initial)
        await walking.enter(gate.x,gate.z,gate.yaw,'fallback')
    }finally{
      switching=false
      // 只有真的站到那儿了才把推流中心交还给玩家；进不去就还在遮罩/飞行里
      if(walker?.active)stream.clearFocus()
      showMode()
    }
  }
  window.addEventListener('keydown',event=>{if(event.code==='KeyV'&&!event.repeat)void toggle().then(showMode)})
  // F10 / 全屏按钮：切换浏览器全屏
  const toggleFullscreen=()=>{if(document.fullscreenElement)void document.exitFullscreen();else void document.documentElement.requestFullscreen().catch(()=>{})}
  window.addEventListener('keydown',event=>{if(event.code==='F10'&&!event.repeat){event.preventDefault();toggleFullscreen()}})
  // 飞行模式下 Alt 锁定鼠标（步行由 walk 自己处理，这里跳过）
  window.addEventListener('keydown',event=>{
    if(event.code!=='AltLeft'&&event.code!=='AltRight')return
    if(walker?.active)return
    event.preventDefault()
    const canvasNow=renderer.domElement
    if(document.pointerLockElement===canvasNow)document.exitPointerLock()
    else void canvasNow.requestPointerLock?.()?.catch?.(()=>{})
  })
  Object.assign(window,{toggleFullscreen})
  const touch=matchMedia('(pointer:coarse)').matches,hint=document.querySelector<HTMLElement>('.hint')!,toast=document.querySelector<HTMLElement>('.toast')!
  // 底部那条长提示改成左侧一列：按 · 拆成一行一条，读起来不费劲也不挡脚下
  const setHint=(text:string)=>{
    const items=text.split(' · ').map(part=>{const line=document.createElement('i');line.textContent=part;return line})
    hint.replaceChildren(...items)
  }
  const modeButton=document.createElement('button');modeButton.className='btn-mode'
  modeButton.addEventListener('pointerenter',()=>void prefetchWalk())
  modeButton.addEventListener('touchstart',()=>void prefetchWalk(),{passive:true})
  function showMode(){const walking=!!walker?.active;document.body.dataset.mode=walking?'walk':'fly'
    modeButton.textContent=walking?'起飞':'落地步行';modeButton.setAttribute('aria-label',walking?'切换到飞行':'切换到步行')
    setHint(walking?'WASD 走 · Shift 跑 · 空格 跳 · 1–6 香烟 · TAB 香烟背包 · Alt 鼠标 · 拖动转视角 · F3 视角 · L 手机/叫车 · F 上/下车 · Y 拍照 · H 隐藏界面 · M 地图 · F10 全屏 · Esc 菜单':'WASD 飞 · Q/E 升降 · Shift 加速 · V 落地步行 · Alt 鼠标 · M 地图 · F10 全屏 · Esc 菜单')}
  let toastTimer=0
  window.addEventListener('walk:spawn-failed',()=>{toast.textContent='这里没有可以落脚的地方，飞近岸边或街道再试';toast.classList.add('show')
    clearTimeout(toastTimer);toastTimer=window.setTimeout(()=>toast.classList.remove('show'),3200)})
  modeButton.onclick=()=>void toggle().then(showMode);document.body.append(modeButton);void touch
  // 爱发电按钮 + 管理员入口（/admin、?support=admin、#support-admin）在任何页面都生效
  void import('./ui/support').then(module => module.mountSupportButton())
  // 扫到 /#id=450326… 的链接，直接弹大图身份证
  void import('./ui/idcard').then(module => void module.openIdCardFromHash())
  // 老玩家（已开卡但没有身份证物品）补发二代身份证
  void import('./items').then(module => module.ensureIdCardItem())
  // 主菜单要竖屏、游戏内要横屏的方向提示
  void import('./ui/orient').then(module => module.mountOrientHint())
  // 手游：首页全屏门禁
  void import('./ui/fullgate').then(module => module.mountFullGate())
  installTouchBar()
  installBurgerMenu()
  showMode()
  const gpuProbe=probeWebGPU('webgl')
  // ?verify 给自动化测试；?debug 用来在保留首页的情况下也能从控制台看引擎状态
  if(params.has('verify')||params.has('debug')) Object.assign(window,{viewer:{gpu:gpuProbe,camera,stream,manifest,stats,walkTo,
    setView:(view:unknown)=>host.setView(view),
    async photoSupport(x:number,z:number,bridgeRadius?:number){return (await loadWalker()).photoSupport(x,z,bridgeRadius)},
    get peaksStats(){return peaks?.stats},get peaksReady(){return peaksReady},clock,env,get tour(){return tour},get walk(){return walker},
    get smoking(){return walker?.smoking},
    quality:{get tier(){return tier},get setting(){return setting},get scale(){return dynamicScale},get profile(){return profile},
      renderer:rendererName(),software:isSoftwareRenderer(),get radius(){return stream.radius}},
    setPreset(name:string){setPreset(camera,name);camera.updateMatrixWorld();return stats.frame},
    freeze(){return new Promise<void>(resolve=>requestAnimationFrame(()=>{
      renderer.setAnimationLoop(null)
      const gl=renderer.getContext()
      gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(4))
      resolve()
    }))},
    resume(){previous=0;renderer.setAnimationLoop(animate)},
    probeFoot(){
      const ray = new THREE.Raycaster(camera.position,new THREE.Vector3(0,-1,0))
      const clearance = ray.intersectObjects(scene.children)[0]?.distance
      ray.setFromCamera(new THREE.Vector2(0,0),camera)
      const hits = ray.intersectObjects(scene.children)
      const roots=new Map([...stream.landmarks].map(([entry,root])=>[root as THREE.Object3D,entry]))
      let lookingAt:string|undefined
      let landmark:string|undefined
      for(let obj:THREE.Object3D|null=hits[0]?.object??null;obj;obj=obj.parent){
        if(obj.name && !lookingAt) lookingAt=obj.name
        const entry=roots.get(obj)
        if(!entry) continue
        landmark=entry.id
        // A modeled cave or pavilion and the PK02 mesh share the peak's map location.
        const peak=manifest.peaks.entries.find(p=>Math.hypot(p.center[0]-entry.position[0],p.center[2]-entry.position[2])<.1)
        lookingAt=peak?.name??entry.name??entry.id
        break
      }
      return {clearance,lookingAt,landmark,wallDistance:hits[0]?.distance}
    }}})
  let cullLandmarks:ReturnType<typeof import('./landmarks').landmarkCulling>|undefined
  function draw(){
    const mirror = frame>=2 && isWaterInView(camera) ? currentMirrorLevel(camera) : -Infinity
    cullLandmarks?.update(stream.landmarks.values(),camera,mirror)
    peaks?.update(camera,mirror)
    if(Number.isFinite(mirror))cullLandmarks?.pass(true)
    // Reuse the last reflection while tiles are still streaming: pending work is exactly when the
    // mirror costs the most, and a frame-old reflection is invisible under the ripple distortion.
    const mirrorOff = flags.noMirror || !profile.mirror || !Number.isFinite(mirror)
    renderMirror(renderer,scene,camera,mirrorOff,!walker?.active&&!cinema&&clock.weather==='clear')
    cullLandmarks?.pass(false)
    renderer.render(scene,camera)
  }
  const host:Host={scene,camera,renderer,manifest,stream,get peaks(){return peaks??peaksPlaceholder},clock,walker:()=>walker,walkTo,draw,refreshMode:showMode,
    captureView:async()=>(await import('./play/feedback-view')).capture(host),
    setView:async(view)=>(await import('./play/feedback-view')).setView(host,view),
    fly(){if(walker?.active)walker.leave();showMode()},get cinema(){return cinema},set cinema(on){cinema=on}}
  let tour:Awaited<ReturnType<typeof import('./play').play>>|undefined
  const forward=new THREE.Vector3()
  function animate(now:number){
    if(paused&&frame>2){previous=0;return}
    const elapsed = previous?now-previous:0;previous=now
    if(first&&elapsed>0)dynamic.update(elapsed)
    if(walker?.active)walker.tick(elapsed/1000);else if(!switching)controls(elapsed/1000)
    if(frame===1) {
      // 首帧只要求「总览地块到位」：山体还在后面下，别把它算进首帧。
      first=performance.now();stats.firstMs=first;stats.firstWorldBytes=bytes
      void import('./play').then(mod=>{tour=mod.play(host)})
    }
    if(frame===2&&manifest.landmarks?.length)void import('./landmarks').then(module=>{
      cullLandmarks=module.landmarkCulling()
      const streamer=module.landmarkStream(scene,renderer,manifest.landmarks!,stream.landmarks)
      streamer.budget=tier==='low'?2:4
      // 街块还在补的时候，大 GLB 先让路给世界数据
      streamer.urgent=()=>stream.busy
      stream.updateLandmarks=streamer
    })
    if(frame===2){
      void loadTiles(renderer).catch(error=>console.warn('City textures unavailable',error))
    }
    // 切步行/传送时不要停推流：手机上 walk 模块要下几兆，那几秒正好是最需要世界先到的时候。
    // 目标点由 Stream 自己的 focus 兜住（spawnPoint / 传送点），clearFocus 之后交还给相机。
    if(first&&(!switching||!flags.legacyStream)) {
      const target=walker?.destination??(walker?.active?walker.position:camera.position)
      camera.getWorldDirection(forward)
      stream.updateLandmarks?.(target,undefined,forward)
      stream.tick(target)
      if(!walkModPromise && !stream.pending.size && camera.position.y<260) void prefetchWalk()
    }
    clock.tick(elapsed/1000); evaluate(clock.hour,clock.weather,1-Math.exp(-elapsed/1200))
    atmo.uTime.value = now/1000
    light.position.copy(env.sunDir); light.color.copy(env.sunColor); light.intensity = env.sunPower
    hemi.color.copy(env.hemiSky); hemi.groundColor.copy(env.hemiGround); hemi.intensity = env.hemiPower
    renderer.toneMappingExposure = env.exposure; windowLight.value = env.night
    dome.update(); drops.update()
    tour?.tick(elapsed/1000)
    draw()
    frame++; sum+=elapsed;samples++
    Object.assign(stats,{ms:elapsed,calls:renderer.info.render.calls,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,frame,loaded:stream.loaded.size,pending:stream.pending.size,
      visited:stream.visited.size,failures:stream.failures.size})
    if(sum>=400||frame===1) {
      output.value=`${Math.round(samples*1000/(sum||16.7))} FPS · ${stats.calls} calls · ${stats.loaded} 块 · ${bytes.toLocaleString()} B`
      sum=0;samples=0
    }
  }
  // 玩家在标题页/菜单里切换画质时，立刻套用（不用重载页面）。
  addEventListener('glol:quality',event=>{
    const next=(event as CustomEvent<Setting|undefined>).detail
    const target:Setting = next ?? readSetting()
    if(!forced) writeSetting(target)
    setting=target; tier=activeTier(setting); profile=profileFor(tier)
    dynamicScale=1; dynamic=makeDynamic()
    stream.radius=THREE.MathUtils.clamp(profile.radius,192,1600)
    stream.forest.reach = profile.trees
    applyBudget()
    resize()
  })
  renderer.setAnimationLoop(animate)
  const token=params.get('view')
  if(token){try{if(token.length>4096)throw Error();await host.setView(JSON.parse(atob(token.replace(/-/g,'+').replace(/_/g,'/'))))}catch{console.warn('Invalid feedback view')}}
  else if(params.get('mode')!=='fly'){
    await toggle(true)
    const spawnId=localStorage.getItem('guiling.spawn')
    if(spawnId){
      const {spots:allSpots,yawToward}=await import('./play/spots')
      const spot=allSpots.find(item=>item.id===spawnId)
      if(spot)await walkTo(spot.x,spot.z,yawToward(spot.x,spot.z,spot.at),'spawn')
    }
  }
}
export const boot=()=>start().catch(error=>{document.querySelector('output')!.value=`无法加载：${error.message}`;bootProgress(`无法加载：${error.message}`,0);console.error(error)})
