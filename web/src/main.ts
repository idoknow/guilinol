import {onPrefs} from './ui/prefs'
import {bindingLabel, hits} from './input/keymap'
import {nearestPlayable} from '../../lib/play-region'
import {identifyWorld,instrument,operation,record} from './telemetry'
import * as THREE from 'three'
import {bytes, fetchAsset, measureFirstWorldBytes, openingTerrain, startOverview, type Manifest} from './world'
import {Stream} from './stream'
import {flight} from './flight'
import {look} from './look/config'
import {installAtmosphere, outerGround, sky} from './look/atmosphere'
import {startPeaks} from './peaks'
import {presets,setPreset,pickSpawn,spawnPool} from './presets'
import {isDeepLink} from './deeplink'
import {readLastView, saveLastView, consumeRestore, applyLastView} from './lastview'
import {walkConfig} from './walk/config'
import {atmo, env, evaluate, setFogMetrics} from './look/time'
import {prepareMirror, renderMirror, WATER_LAYER} from './look/water'
import {MAIN_DETAIL_LAYER} from './look/mirror-layer'
import {rain} from './look/rain'
import {windowLight} from './look/buildings'
import {skyClock} from './ui/sky'
import type {Host} from './play/host'
import {streamIndicator,veil,type FullLoader,type Veil} from './ui/loading'
import {loadTiles} from './look/tiles'
import {flags} from './debug'
import {deriveRangeMetrics, loadRenderConfig, RenderRangeStore, type RenderRangeConfig} from './render-range'
import {renderRangeControl} from './ui/render-range'
import type {FeedbackView} from '../../lib/feedback-contract'
import {getPlayMode, onPlayMode, soloServices, trafficEnabled} from './game/play-mode'
import {getState} from './game/state'
import {loadLocalSave} from './game/save'
import {isGlobalHotkeyBlocked} from './walk/input-guard'
import {freezeStatic} from './static-freeze'

installAtmosphere()
// The title screen (ui/home.ts) pauses the scene while it covers it: no simulation, no draws.
let paused=false
let modeReady = Promise.resolve()
export const waitForMode = () => modeReady
export function setPaused(on:boolean){paused=on}
import {mountDevHud} from './ui/hud-dev'
import {armOrientationGate} from './ui/orientation'
import {mountStats} from './ui/stats'
import {mountHotkeys} from './ui/hotkeys'
import {mountLazyTianyuanMifen} from './mifen/entry'
import {mountChat} from './ui/chat'
import {mountGuide} from './ui/guide'
import {touchUi} from './ui/input-mode'

export let spawnCreatedCharacter:()=>Promise<void>=async()=>{}
let titleTransition:{signal:AbortSignal;cancel:()=>void;view?:Veil}|undefined
export function setTitleTransition(value:typeof titleTransition){titleTransition=value}
async function start(loader:FullLoader,creatorSpawn=false) {
  const entrySignal=titleTransition?.signal
  mountDevHud()
  armOrientationGate()
  loadLocalSave(undefined, Date.now(), getPlayMode() === 'solo')
  const params = new URLSearchParams(location.search)
  const rangeStore = new RenderRangeStore(loadRenderConfig(params))
  const initialMetrics = rangeStore.getMetrics()
  setFogMetrics(initialMetrics)

  const hasOpening=!!document.getElementById('opening-terrain')
  loader.stage('terrain',0,1)
  const byteStage=(isManifest:boolean)=>(done:number,total:number)=>loader.stage('terrain',
    (isManifest&&hasOpening ? .5 : 0)+(hasOpening ? .5 : 1)*done/Math.max(1,total),1,
    `${(done/1048576).toFixed(1)} / ${(total/1048576).toFixed(1)} MB`)
  async function readManifest(){
    const manifestBytes = await fetchAsset('manifest.json',undefined,byteStage(true)).catch(()=>{
      record('failure',{category:'manifest'})
      record('retry',{category:'manifest'})
      return fetchAsset('manifest.json',undefined,byteStage(true)).catch(error=>{record('failure',{category:'manifest'});throw error})
    })
    identifyWorld(manifestBytes)
    const manifest:Manifest = JSON.parse(new TextDecoder().decode(manifestBytes))
    if(manifest.version!==4 || manifest.chunkSize!==256 || manifest.grid!==4) throw Error('Unsupported world format')
    return manifest
  }
  const terrain=hasOpening
    ? await openingTerrain(byteStage(false)).catch(()=>null)
    : null
  const previousWorld=terrain?null:await readManifest()
  entrySignal?.throwIfAborted()
  const bounds=terrain??previousWorld!
  const renderer = new THREE.WebGLRenderer({antialias:false,powerPreference:'high-performance'})
  renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = look.exposure
  document.body.prepend(renderer.domElement)
  const camera = new THREE.PerspectiveCamera(55,1,1,Math.max(look.fogHorizonTo,initialMetrics.fogHorizonTo)+1200)
  const scene = new THREE.Scene()
  scene.matrixAutoUpdate = false
  scene.fog = new THREE.Fog(look.hazeNear,0,1)
  const dome = sky(), drops = freezeStatic(rain()); scene.add(dome,drops)
  camera.layers.enable(WATER_LAYER)
  camera.layers.enable(MAIN_DETAIL_LAYER)
  const light = new THREE.DirectionalLight(look.sunColor,look.sunPower)
  light.position.set(...look.sunDirection); scene.add(light)
  const hemi = new THREE.HemisphereLight(look.hemiSky,look.hemiGround,look.hemiPower); scene.add(hemi)
  const [left,top,width,depth] = bounds.extent
  scene.add(freezeStatic(outerGround(bounds.extent)))
  // IDOK-105: choose the opening camera pose. The camera is NOT touched here — `flight()` below sets
  // `rotation.order = 'YXZ'` and lookAt()/rotation.set() must run after it, or three.js recomputes the
  // quaternion with the wrong order and every slot gains a roll.
  const openParams = new URLSearchParams(location.search)
  // `?slot=X` pins a specific pool frame (deterministic, for captures and shared links). It is also
  // a deep link, so it skips the title screen, but it must bypass the "deep link → fixed camera"
  // fallback below. Every other deep link keeps the deterministic camera the harnesses measure.
  const forcedSlot = openParams.get('slot')
  // `restoring` is a FeedbackView only when the player picked "回到上次离开的地方" AND a usable view
  // is stored; a stale/cleared record must fall back to pickSpawn(), not the fixed camera.
  const soloStart = getPlayMode() === 'solo'
  const opening = soloStart ? (!isDeepLink(openParams) ? readLastView() : null) : forcedSlot !== null
    ? spawnPool.find(slot => slot.id === forcedSlot) ?? spawnPool[0]
    : isDeepLink(openParams) ? null : consumeRestore() ? readLastView() ?? pickSpawn() : pickSpawn()
  const hasDowntown = left<=-2304 && top<=-2560 && left+width>=1280 && top+depth>=3328
  const framing = hasDowntown ? [-2304,-2560,3584,5888] : bounds.extent
  const [viewX,viewZ,viewWidth,viewDepth] = framing
  let walker:Awaited<ReturnType<typeof import('./walk').walk>>|undefined, switching=false
  let cinema=false
  let walkModPromise:Promise<typeof import('./walk')>|undefined
  const prefetchWalk = ()=>{
    walkModPromise ??= import('./walk').then(mod=>{void mod.preloadWalk();return mod})
    return walkModPromise
  }
  if(soloStart||params.get('mode')==='walk'||params.has('spawn')) void prefetchWalk()
  const controls = flight(camera,renderer.domElement,bounds.extent,()=>getPlayMode()==='tour'&&!paused&&!walker?.active&&!switching&&!cinema)
  // Apply the opening pose here, after flight() has set rotation.order='YXZ'. lookAt()/rotation.set()
  // before that line would be recomputed in the wrong Euler order and leave a permanent roll.
  let playBounds: Pick<Manifest,'bbox'|'region'> = bounds
  function clampOpening() {
    const point=nearestPlayable(playBounds,camera.position.x,camera.position.z)
    camera.position.x=point.x
    camera.position.z=point.z
  }
  function restoreOpening(view:FeedbackView) {
    applyLastView(camera,view)
    clampOpening()
  }
  if(opening) {
    if('eye' in opening) { camera.position.set(...opening.eye); camera.lookAt(...opening.look); clampOpening() }
    else restoreOpening(opening)
  } else {
    camera.position.set(viewX+viewWidth*.55,420,viewZ+viewDepth*.62)
    camera.lookAt(viewX+viewWidth*.47,150,viewZ+viewDepth*.45)
  }
  const dprQuery = params.get('dpr')
  const forcedDprParam = dprQuery && dprQuery !== 'auto' ? parseFloat(dprQuery) : NaN
  const forcedDpr = Number.isFinite(forcedDprParam) && forcedDprParam > 0
    ? Math.min(Math.max(forcedDprParam, 0.5), 2)
    : null
  const adaptiveDprEnabled = forcedDpr === null && (dprQuery === 'auto' || !params.has('verify'))
  function dprBounds() {
    const native = Math.max(0.5, devicePixelRatio || 1)
    if (forcedDpr !== null) return {min: forcedDpr, max: forcedDpr}
    const max = Math.min(native, touchUi() ? 1.25 : 1.5)
    return {min: Math.min(1, max), max}
  }
  let currentDpr = dprBounds().max
  let dprWinSum = 0, dprWinCount = 0, dprLastAdjust = 0
  function applyDpr(next: number) {
    const rounded = Math.round(next * 20) / 20
    if (Math.abs(rounded - currentDpr) < 0.01) return
    currentDpr = rounded
    renderer.setPixelRatio(currentDpr)
  }
  function resize() {
    const {min, max} = dprBounds()
    currentDpr = Math.min(max, Math.max(min, currentDpr))
    renderer.setPixelRatio(currentDpr); renderer.setSize(innerWidth,innerHeight)
    camera.aspect=innerWidth/innerHeight; camera.updateProjectionMatrix()
  }
  resize(); window.addEventListener('resize',resize)
  const clock = skyClock(params)
  if(!soloStart)setPreset(camera,params.get('cam')??params.get('spawn'),bounds.bbox)
  let previous=0, first=0, frame=0, sum=0, samples=0
  const stats = {firstMs:0,readyMs:0,openingRingMs:0,firstWorldBytes:0,ms:0,calls:0,frame:0,loaded:0,pending:0,visited:0,failures:0,
    geometries:0,textures:0,dpr:currentDpr}
  function markFirstFrame(){
    first=performance.now()
    stats.firstMs=first
    measureFirstWorldBytes(first,total=>{stats.firstWorldBytes=total})
    if(stats.openingRingMs)void finishLoading()
  }
  async function finishLoading(){loader.stage('frame',1,1);await loader.finish();stats.readyMs=performance.now()}
  function updateAtmosphere(now:number,elapsed:number){
    clock.tick(elapsed/1000); evaluate(clock.hour,clock.weather,1-Math.exp(-elapsed/clock.blendMs))
    atmo.uTime.value = now/1000
    light.position.copy(env.sunDir); light.color.copy(env.sunColor); light.intensity = env.sunPower
    hemi.color.copy(env.hemiSky); hemi.groundColor.copy(env.hemiGround); hemi.intensity = env.hemiPower
    renderer.toneMappingExposure = env.exposure; windowLight.value = env.night
    dome.update(); drops.update()
  }

  let openingStream:Stream|undefined
  async function presentOpening(){
    // Draw the real terrain with the active flight camera. The second
    // animation callback marks the first presented frame on both paths.
    await new Promise<void>(resolve=>{
      let rendered=false
      renderer.setAnimationLoop(now=>{
        if(rendered && !first){
          markFirstFrame()
          document.querySelector('output')!.value='正在载入街区…'
          resolve()
        }
        const elapsed=previous?now-previous:0
        previous=now
        controls(elapsed/1000)
        updateAtmosphere(now,elapsed)
        openingStream?.updateBatches(camera.position)
        renderer.render(scene,camera)
        rendered=true
      })
    })
  }
  if(terrain){scene.add(terrain.mesh);await presentOpening()}
  async function loadFullScene(){
    const manifest=previousWorld??await readManifest()
    playBounds=manifest
    clampOpening()
    entrySignal?.throwIfAborted()
    if(terrain){
      openingStream=new Stream(scene,manifest,terrain,rangeStore,camera)
      await openingStream.loadOpeningRing(camera.position,ringProgress)
      entrySignal?.throwIfAborted()
    }
    let tasks=0
    loader.stage('overview',0,2)
    const overview=startOverview(manifest), mountains=startPeaks(manifest.peaks)
    const report=<T>(result:T)=>{loader.stage('overview',++tasks,2,`山水 ${tasks} / 2`);return result}
    const [base,peaks]=await Promise.all([overview.finish.then(report),mountains.finish.then(report)])
    return {manifest,base,peaks}
  }
  function ringProgress(done:number,total:number){loader.stage('ring',total?done:1,total||1,`街区 ${done} / ${total}`)}
  const {manifest,base,peaks}=await loadFullScene().finally(()=>{
    if(terrain){renderer.setAnimationLoop(null);terrain.dispose()}
  })
  entrySignal?.throwIfAborted()
  scene.add(base.mesh,peaks)
  const stream = openingStream??new Stream(scene,manifest,base,rangeStore,camera)
  if(!openingStream){
    openingStream=stream
    try{
      await presentOpening()
      entrySignal?.throwIfAborted()
      await stream.loadOpeningRing(camera.position,ringProgress)
      entrySignal?.throwIfAborted()
    }finally{renderer.setAnimationLoop(null)}
  }
  stats.openingRingMs=performance.now()
  if(first)void finishLoading()
  stream.onPendingChange=streamIndicator(()=>stream.pending.size+(stream.updateLandmarks?.pendingCount()??0))
  if(terrain)stream.setTerrainLayer(base)
  const output = document.querySelector('output')!
  let cullLandmarks:ReturnType<typeof import('./landmarks').landmarkCulling>|undefined
  let landmarksPromise:Promise<void>|undefined
  function ensureLandmarks(){
    if(!manifest.landmarks?.length) return Promise.resolve()
    landmarksPromise ??= import('./landmarks').then(module=>{
      cullLandmarks=module.landmarkCulling()
      stream.updateLandmarks=module.landmarkStream(scene,renderer,manifest.landmarks!,stream.landmarks,{
        getMetrics:()=>stream.metrics,
        isInnerBusy:()=>stream.isInnerBusy(),
        onPendingChange:()=>stream.onPendingChange?.(),
      })
    })
    return landmarksPromise
  }
  function primeLanding(x:number, z:number,signal:AbortSignal){
    stream.prioritize(x,z)
    const target=new THREE.Vector3(x,0,z)
    stream.tick(target)
    if(!manifest.landmarks?.length) return
    const supports=(manifest.landmarks??[]).filter(entry=>{
      if(entry.collision==='none') return false
      const [cx,,cz,r]=entry.sphere, a=entry.rotation*Math.PI/180
      const ex=entry.position[0]+cx*Math.cos(a)+cz*Math.sin(a)
      const ez=entry.position[2]-cx*Math.sin(a)+cz*Math.cos(a)
      return Math.hypot(ex-x,ez-z)<=r+walkConfig.search
    })
    void ensureLandmarks().then(()=>{
      if(signal.aborted)return
      for(const entry of supports){
        target.y=entry.position[1]
        stream.updateLandmarks?.(target,entry)
      }
      stream.updateLandmarks?.(target)
    })
  }
  type Walker=Awaited<ReturnType<typeof import('./walk').walk>>
  let loadingWalker:Promise<Walker>|undefined
  function loadWalker():Promise<Walker>{return loadingWalker??=prefetchWalk().then(module=>module.walk(scene,camera,renderer.domElement,manifest,stream,peaks,params.has('verify'))).then(player=>walker=player).catch(error=>{loadingWalker=undefined;throw error})}
  async function walkTo(x:number,z:number,yaw:number,reason:string,name?:string){
    if(switching)return false
    switching=true
    const start=performance.now()
    let completed=false
    const controller=new AbortController(),signal=titleTransition?.signal??controller.signal
    const parent=titleTransition?.view
    const cover=parent??veil(reason==='flight'||reason.startsWith('solo')?'正在落地':reason==='creator'?'正在进入桂林':`正在前往${name?' '+name:'目的地'}`,{onCancel:titleTransition?.cancel??(()=>controller.abort()),destination:name})
    try{
      signal.throwIfAborted();primeLanding(x,z,signal)
      const player=await loadWalker()
      // Travel: let the haze close fully before the camera jumps, so the cut is never seen.
      if(name&&!parent&&!matchMedia('(prefers-reduced-motion: reduce)').matches)await new Promise(resolve=>setTimeout(resolve,450))
      if(signal.aborted)return false
      cover.progress(.3,'步行模块已就绪')
      completed=await player.enter(x,z,yaw,reason,false,signal,cover.progress)
      if(completed)cover.progress(1)
      return completed
    }finally{controller.abort();operation('teleport',start,completed);switching=false;showMode();if(!parent)await cover.done()}
  }
  async function landSolo(initial:boolean) {
    if(walker?.active)return
    const gate = walkConfig.gate
    const point = initial && !opening ? gate : {x:camera.position.x,z:camera.position.z,yaw:camera.rotation.y}
    if(await walkTo(point.x,point.z,point.yaw,'solo'))return
    titleTransition?.signal.throwIfAborted()
    if(await walkTo(gate.x,gate.z,gate.yaw,'solo-fallback'))return
    throw Error('单人模式未找到可落脚的位置')
  }
  function takeFlight() {
    if(getPlayMode()==='solo')return {ok:false,code:'FLIGHT_DISABLED_IN_SOLO'} as const
    walker?.leave()
    showMode()
    return {ok:true} as const
  }
  async function toggle(initial=false){
    if(getPlayMode()==='solo')return
    if(switching)return
    const start=performance.now()
    if(walker?.active){walker.leave();operation('switch',start);return}
    try{
      const name=params.get('spawn'),preset=initial&&name&&Object.hasOwn(presets,name)?presets[name]:null
      const original=camera.clone();if(preset)setPreset(original,name,manifest.bbox)
      const gate=walkConfig.gate,point=preset?.walk??(initial&&!preset?gate:{x:original.position.x,z:original.position.z,yaw:original.rotation.y})
      if(!await walkTo(point.x,point.z,point.yaw,initial?name??'default':'flight')&&initial){
        await walkTo(gate.x,gate.z,gate.yaw,'fallback')
      }
    }finally{operation('switch',start)}
  }
  window.addEventListener('keydown',event=>{
    if(isGlobalHotkeyBlocked(event.target))return
    if(event.code==='KeyV'&&!event.repeat)void toggle().then(showMode)
  })
  const touch=touchUi(),hint=document.querySelector<HTMLElement>('.hint')!,toast=document.querySelector<HTMLElement>('.toast')!
  const modeButton=document.createElement('button');modeButton.className='btn-mode'
  modeButton.addEventListener('pointerenter',()=>void prefetchWalk())
  modeButton.addEventListener('touchstart',()=>void prefetchWalk(),{passive:true})
  function showMode(){const walking=!!walker?.active
    if(!walking&&getPlayMode()==='solo')delete document.body.dataset.mode
    else document.body.dataset.mode=walking?'walk':'fly'
    modeButton.hidden=modeButton.disabled=getPlayMode()==='solo'
    modeButton.textContent=walking?'起飞':'落地步行';modeButton.setAttribute('aria-label',walking?'切换到飞行':'切换到步行')
    const ride=document.body.dataset.ride
    if(walking&&document.body.hasAttribute('data-aboard')&&ride==='car'){
      hint.textContent='WASD 驾驶 · Space 手刹漂移 · 1-3/Q·E 切模式 · L 车灯 · F 下车 · C 视距 · V 起飞'
    }else if(walking&&document.body.hasAttribute('data-aboard')&&ride==='bike'){
      hint.textContent='WASD 骑 · 0/P 驻车 · 1-4/Q·E 挡 · Space 翘头/起 · Shift 压弯 · K 撑 · L 灯 · Z/X/B 转向 · H 喇叭 · U 定速 · G 改 · F 下车 · V 飞'
    }else if(walking&&document.body.hasAttribute('data-aboard')&&ride==='bicycle'){
      hint.textContent='WASD 骑行 · 1-3/Q·E 换挡 · Space 翘头/起身 · Shift 压弯 · K 边撑 · H 铃铛 · F 下车 · V 起飞'
    }else if(walking&&document.body.hasAttribute('data-aboard')&&ride==='boat'){
      hint.textContent='WASD 划船 · F 靠岸下船 · 拖动转视角 · 滚轮远近 · V 起飞'
    }else{
      hint.textContent=walking?`WASD 走 · Shift 跑 · X 蹲 · 空格 跳 · ${bindingLabel('emote')} 表情 · C 视距 · 滚轮远近 · V 起飞 · M 地图 · J 景册 · P 拍照`:'WASD 飞 · Q/E 升降 · Shift 加速 · V 落地步行 · M 地图 · J 景册 · P 拍照 · Esc 菜单'
    }
    if(getPlayMode()==='solo')hint.textContent=hint.textContent?.replace(/ · V (起飞|飞)/g,'') ?? ''
  }
  onPrefs(showMode)
  new MutationObserver(()=>showMode()).observe(document.body,{attributes:true,attributeFilter:['data-aboard','data-ride']})
  let toastTimer=0
  const showToast=(text:string,ms=3200)=>{toast.textContent=text;toast.classList.add('show')
    clearTimeout(toastTimer);toastTimer=window.setTimeout(()=>toast.classList.remove('show'),ms)}
  window.addEventListener('walk:spawn-failed',()=>showToast('这里没有可以落脚的地方，飞近岸边或街道再试'))
  window.addEventListener('walk:toast',event=>{const detail=(event as CustomEvent<{text?:string;message?:string;ms?:number}|string>).detail
    const text=typeof detail==='string'?detail:detail?.text??detail?.message
    if(text)showToast(text,typeof detail==='object'&&detail?.ms?detail.ms:2600)})
  modeButton.onclick=()=>void toggle().then(showMode);document.body.append(modeButton);void touch
  showMode()
  // IDOK-221: 按键卡 + 玩法指南 + 首次进城的新手引导（测试和分享/反馈链接不自动弹引导，?tour 强制）。
  mountGuide({autoTour:params.has('tour')||!(params.has('verify')||params.has('view')||params.has('debug'))})
  // IDOK-234 复位：卡进墙 / 掉进水里时，传送到最近的平地。左上「复位」按钮 + 可改键（默认 R）。
  // 坐在车 / 船上时复位会把载具留在原地，所以要 3 秒内再按一次确认，免得骑车时误触。
  const unstuckButton=document.createElement('button');unstuckButton.type='button';unstuckButton.className='btn-unstuck'
  unstuckButton.innerHTML='<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4.6 8.2A6 6 0 1 1 4 11.4"/><path d="M3.2 4.6l1.4 3.6 3.6-1.3"/><circle cx="10" cy="10.2" r="1.6"/></svg><span>复位</span>'
  const unstuckText=unstuckButton.querySelector('span')!
  let unstuckArmedUntil=0,unstuckTimer=0
  const unstuckTitle=()=>{unstuckButton.title=`复位：卡住或掉进水里时回到最近的平地（${bindingLabel('unstuck')}）`;unstuckButton.setAttribute('aria-label',unstuckButton.title)}
  const disarmUnstuck=()=>{unstuckArmedUntil=0;clearTimeout(unstuckTimer);unstuckButton.classList.remove('armed');unstuckText.textContent='复位'}
  async function unstuck(){
    const player=walker
    if(!player?.active||switching)return
    if(document.body.hasAttribute('data-aboard')&&performance.now()>unstuckArmedUntil){
      const what=document.body.dataset.ride==='boat'?'船':'车'
      unstuckArmedUntil=performance.now()+3000;unstuckButton.classList.add('armed');unstuckText.textContent=`再点一次 · 弃${what}复位`
      clearTimeout(unstuckTimer);unstuckTimer=window.setTimeout(disarmUnstuck,3000)
      showToast(`复位会把${what}留在原地，3 秒内再点一次「复位」或按 ${bindingLabel('unstuck')} 确认`,3000);return
    }
    disarmUnstuck()
    const spot=player.findUnstuck()
    if(!spot){showToast('附近没找到能站稳的平地，打开地图（M）换个地方');return}
    await walkTo(spot.x,spot.z,player.yaw,'unstuck','最近的平地')
  }
  unstuckButton.onclick=()=>void unstuck()
  unstuckTitle();onPrefs(unstuckTitle)
  ;(document.querySelector('.hud-me')??document.body).append(unstuckButton)
  window.addEventListener('keydown',event=>{
    if(event.repeat||isGlobalHotkeyBlocked(event.target)||!hits(event.code,'unstuck'))return
    if(!walker?.active||document.body.hasAttribute('data-home')||document.body.dataset.photo==='on')return
    event.preventDefault();void unstuck()
  })
  let missionGroundRay: THREE.Raycaster | undefined
  const sampleMissionGroundY = (x: number, z: number): number => {
    const tile = manifest.chunks.find(t => x >= t.x && x < t.x + 256 && z >= t.z && z < t.z + 256)
    const mesh = tile && stream.loaded.get(tile)?.groundMesh
    if (!mesh) return NaN
    missionGroundRay ??= new THREE.Raycaster(undefined, new THREE.Vector3(0,-1,0))
    missionGroundRay.ray.origin.set(x, 3000, z)
    mesh.updateWorldMatrix(true, false)
    return missionGroundRay.intersectObject(mesh, false)[0]?.point.y ?? NaN
  }
  let tour:Awaited<ReturnType<typeof import('./play').play>>|undefined
  let solo: Awaited<ReturnType<typeof import('./game/solo-layer').mountSoloLayer>> | undefined
  async function syncSolo() {
    solo?.dispose()
    solo = undefined
    const services = soloServices()
    if (services) {
      const mounted = await services.mountSoloLayer({
        scene, camera, sampleMissionGroundY, walker: () => walker, tour: () => tour, paused: () => paused,
      })
      if (soloServices() === services) solo = mounted
      else mounted.dispose()
    }
  }
  onPlayMode((mode,prev)=>{
    modeReady=(async()=>{
      if(mode==='solo')await landSolo(false)
      else if(prev==='solo' && walker?.active){
        const {x,z}=walker.position
        takeFlight()
        camera.position.x=x
        camera.position.z=z
      }
      await syncSolo()
      showMode()
    })()
  })
  await syncSolo()
  const renderUi = renderRangeControl({
    initial:rangeStore.getConfig(),
    onPreview:(next:RenderRangeConfig)=>{stream.setRenderRange(next,{persist:false,source:next.source})},
    onCommit:(next:RenderRangeConfig)=>{stream.setRenderRange(next.radius,{persist:true});return rangeStore.getConfig()},
    onReset:()=>stream.resetRenderRange(),
    getStats:(rangeRadius)=>{
      const focus = walker?.destination??(walker?.active?walker.position:camera.position)
      let targetCount = 0
      for(const tile of manifest.chunks) if(Math.hypot(tile.x+128-focus.x,tile.z+128-focus.z)<=rangeRadius) targetCount++
      return {target:targetCount,loaded:stream.loaded.size}
    },
  })
  rangeStore.subscribe(nextCfg=>{renderUi.setConfig(nextCfg)})
  // IDOK-178：帧率/网速/在线人数读数与设置热键（都靠 localStorage 记住上次选择）。
  mountStats()
  mountHotkeys()
  const mifen = mountLazyTianyuanMifen(
    {
      scene,
      camera,
      clock,
      getPlayerPos: () => (walker?.active ? walker.position : null),
      walkTo,
      showToast,
      sampleGroundY: sampleMissionGroundY,
      getNightFactor: () => env.night,
    },
    { eagerVerify: params.has('verify') },
  )
  mountChat()
  const tourProbe = {getState, missions: {start: () => ({ok:false, code:'SOLO_MODE_REQUIRED'})}}
  let staticAudit:ReturnType<typeof import('./verify-static').staticVerifier>|undefined
  const publishViewer=()=>Object.assign(window,{viewer:{camera,stream,manifest,stats,walkTo,staticAudit,get game(){return solo?.probe ?? tourProbe},get mifen(){return mifen.getProbe()},
    get trafficCount(){return (scene.getObjectByName('G2 traffic') as THREE.InstancedMesh|undefined)?.count??0},
    get trafficProbe(){return scene.getObjectByName('G2 traffic')?.userData},
    async trafficPixels(){return (await import('./traffic/visibility-probe')).pixelVisible(renderer,scene,camera)},
    async motorPixelCounts(){return (await import('./traffic/visibility-probe')).motorPixelCounts(renderer,scene,camera)},
    stepStreetTraffic(){if(!params.has('verify')||walker?.active||!trafficTick)throw Error('Street traffic probe unavailable');trafficTick(.05)},
    get renderRange(){return rangeStore.getConfig()},
    get rangeMetrics(){return rangeStore.getMetrics()},
    setRenderRange(next:unknown, persist=false){return stream.setRenderRange(next as number|string,{persist})},
    deriveRangeMetrics,
    setView:(view:unknown)=>host.setView(view),
    async photoSupport(x:number,z:number,bridgeRadius?:number){return (await loadWalker()).photoSupport(x,z,bridgeRadius)},
    peaksStats:peaks.stats,clock,env,get tour(){return tour},get walk(){return walker},
    flight: takeFlight,
    setPreset(name:string){if(getPlayMode()==='solo')return {ok:false,code:'FLIGHT_DISABLED_IN_SOLO'}
      setPreset(camera,name,manifest.bbox);camera.updateMatrixWorld();return stats.frame},
    freeze(){return new Promise<void>(resolve=>requestAnimationFrame(()=>{
      renderer.setAnimationLoop(null)
      const gl=renderer.getContext()
      gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(4))
      resolve()
    }))},
    resume(){previous=0;renderer.setAnimationLoop(animate)},
    probeFoot(){
      const ray = new THREE.Raycaster(camera.position,new THREE.Vector3(0,-1,0))
      ray.layers.enable(MAIN_DETAIL_LAYER)
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
    },
    // IDOK-105 test hooks (verify mode only).
    spawnPool,
    saveLastViewNow:()=>host.lastView().then(saveLastView),
    readLastViewNow:()=>readLastView(),
    applyLastViewNow:(view:FeedbackView)=>getPlayMode()==='solo'?{ok:false,code:'FLIGHT_DISABLED_IN_SOLO'}:restoreOpening(view)}})
  function draw(){
    base.update(camera)
    const metrics=stream.metrics
    const ground=!!walker?.active && !cinema
    const mirror=prepareMirror(camera,flags.noMirror||frame<2,ground?walker?.waterSightBlocked:undefined)
    cullLandmarks?.update(stream.landmarks.values(),camera,mirror,metrics.cullHorizon)
    peaks.update(camera,mirror,metrics,!stream.isInnerBusy())
    if(Number.isFinite(mirror))cullLandmarks?.pass(true)
    // Reuse the last reflection while tiles are still streaming: pending work is exactly when the
    // mirror costs the most, and a frame-old reflection is invisible under the ripple distortion.
    renderMirror(renderer,scene,camera,mirror,ground||(!cinema&&clock.weather==='clear'),ground)
    cullLandmarks?.pass(false)
    renderer.render(scene,camera)
  }
  const host:Host={scene,camera,renderer,manifest,stream,peaks,clock,walker:()=>walker,walkTo,draw,refreshMode:showMode,
    captureView:async()=>(await import('./play/feedback-view')).capture(host),
    lastView:async()=>(await import('./play/feedback-view')).currentView(host,'saved'),
    setView:async(view)=>(await import('./play/feedback-view')).setView(host,view),
    fly:takeFlight,get cinema(){return cinema},set cinema(on){cinema=on}}
  const sampleFrame=instrument(renderer,()=>{
    const mode=tour?.map?.active?'map':paused?'menu':walker?.active?(walker.vehicle==='foot'?'walk':'drive'):'fly'
    const position=walker && (mode==='walk'||mode==='drive')?walker.position:camera.position
    return {mode,x:position.x,z:position.z,chunks:stream.loaded.size}
  })
  let playable=false
  let trafficTick:Awaited<ReturnType<typeof import('./traffic').traffic>>|undefined
  let trafficRequested=false
  const trafficOverride=params.get('traffic')
  function animate(now:number){
    if(getPlayMode()==='solo'&&!walker?.active)return
    if((paused||tour?.map?.active)&&frame>2){previous=0;return}
    const elapsed = previous?now-previous:0;previous=now
    if(!switching){if(walker?.active)walker.tick(elapsed/1000);else {controls(elapsed/1000);clampOpening()}}
    if(frame===1) {
      if(!first)markFirstFrame()
      void import('./play').then(mod=>{tour=mod.play(host)})
    }
    if(frame===2) void ensureLandmarks()
    if(frame===2){
      peaks.loadModels(renderer)
      void loadTiles(renderer).catch(error=>console.warn('City textures unavailable',error))
    }
    if(frame>0&&!switching) {
      const showTraffic=trafficEnabled(getPlayMode(),trafficOverride)
      if(showTraffic&&!trafficRequested && camera.position.y<250 && !stream.pending.size){
        trafficRequested=true
        void import('./traffic').then(mod=>mod.traffic(scene,camera,params.has('verify'),(x,z,y,car)=>(car?walker?.carSupportAt(x,z,y):walker?.supportAt(x,z,y))?.y)).then(tick=>{trafficTick=tick}).catch(error=>console.warn('Traffic unavailable',error))
      }
      trafficTick?.(elapsed/1000,walker?.active&&walker.vehicle!=='foot'?walker.position:undefined,
        walker?.active?walker.position:undefined,getPlayMode()==='solo',showTraffic)
      const target=walker?.destination??(walker?.active?walker.position:camera.position)
      stream.tick(target)
      stream.updateLandmarks?.(target)
      if(!walkModPromise && !stream.pending.size && camera.position.y<260) void prefetchWalk()
    }
    updateAtmosphere(now,elapsed)
    tour?.tick(elapsed/1000)
    solo?.step(Math.min(0.1, elapsed/1000))
    mifen.step(Math.min(0.1, elapsed/1000))
    persistView?.()
    draw()
    if(staticAudit && frame%30===0)staticAudit.check()
    sampleFrame(elapsed)
    if(!frame)record('firstFrame',{ms:first||performance.now()})
    if(!playable && first && !paused && !switching && !stream.pending.size && stream.loaded.size){
      const p=walker?.active?walker.position:camera.position
      if(manifest.chunks.every(t=>Math.hypot(t.x+128-p.x,t.z+128-p.z)>stream.radius||stream.loaded.has(t))){
        playable=true;record('playable',{ms:performance.now()})
      }
    }
    frame++; sum+=elapsed;samples++
    if(adaptiveDprEnabled && frame>=45 && !switching && elapsed>0 && elapsed<150){
      dprWinSum+=elapsed; dprWinCount++
      if(dprWinCount>=30){
        const avgMs=dprWinSum/dprWinCount
        dprWinSum=0; dprWinCount=0
        const {min,max}=dprBounds()
        if(now-dprLastAdjust>=2500){
          if(avgMs>22 && currentDpr>min+0.01){applyDpr(Math.max(min,currentDpr-0.15)); dprLastAdjust=now}
          else if(avgMs<13.5 && currentDpr<max-0.01){applyDpr(Math.min(max,currentDpr+0.1)); dprLastAdjust=now}
        }
      }
    }
    Object.assign(stats,{ms:elapsed,calls:renderer.info.render.calls,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,frame,loaded:stream.loaded.size,pending:stream.pending.size,
      visited:stream.visited.size,failures:stream.failures.size,dpr:currentDpr})
    if(sum>=400||frame===1) {
      output.value=`${Math.round(samples*1000/(sum||16.7))} FPS · ${stats.calls} calls · ${stats.loaded} 块 · ${bytes.toLocaleString()} B`
      renderUi.refreshStats()
      sum=0;samples=0
    }
  }
  spawnCreatedCharacter=async()=>{const gate=walkConfig.gate
    if(!await walkTo(gate.x,gate.z,gate.yaw,'creator'))throw Error('出生点暂时无法进入')
    showMode()}
  if(creatorSpawn)await spawnCreatedCharacter()
  else if(soloStart){await landSolo(true);showMode()}
  if(params.has('verify')){
    const {makeStaticVerifier}=await import('./verify-static')
    staticAudit=await makeStaticVerifier(host);publishViewer()
  }
  renderer.setAnimationLoop(animate)
  // IDOK-105: keep the last view fresh so "回到上次离开的地方" can restore it. Deep-linked
  // sessions (`?verify`, `?slot`, shares…) never write it — tests and shared links must not pollute.
  const persistView = isDeepLink(openParams) ? null : (() => {
    let lastWrite = 0
    const write = (force = false) => {
      if (!force && Date.now() - lastWrite < 15000) return
      lastWrite = Date.now()
      void host.lastView().then(saveLastView).catch(() => {})
    }
    addEventListener('pagehide', () => write(true))
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') write(true) })
    return write
  })()
  const token=params.get('view')
  if(soloStart||creatorSpawn)return
  if(token){try{if(token.length>4096)throw Error();await host.setView(JSON.parse(atob(token.replace(/-/g,'+').replace(/_/g,'/'))))}catch{console.warn('Invalid feedback view')}}
  else if(params.get('mode')==='walk'||params.has('spawn')){await toggle(true);showMode()}
}
export const boot=start
