import {playableBounds} from '../../lib/projection'
import {identifyWorld,instrument,operation,record} from './telemetry'
import * as THREE from 'three'
import {bytes, fetchAsset, startOverview, type Manifest} from './world'
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
import {currentMirrorLevel, isWaterInView, renderMirror, WATER_LAYER} from './look/water'
import {rain} from './look/rain'
import {windowLight} from './look/buildings'
import {skyClock} from './ui/sky'
import type {Host} from './play/host'
import {bootDismiss, bootLoaded, bootProgress} from './ui/boot'
import {loadTiles} from './look/tiles'
import {flags} from './debug'
import {deriveRangeMetrics, loadRenderConfig, RenderRangeStore, type RenderRangeConfig} from './render-range'
import {renderRangeControl} from './ui/render-range'
import type {FeedbackView} from '../../lib/feedback-contract'
import {
  createGameDebugProbe,
  createMissionBeacon,
  getState,
  initGame,
  listMissionsForUi,
  MissionRunnerEngine,
  onState,
  type PlayerMode,
} from './game'
import {mountMissionUi} from './game/mission-ui'
import {isGlobalHotkeyBlocked} from './walk/input-guard'

installAtmosphere()
// The title screen (ui/home.ts) pauses the scene while it covers it: no simulation, no draws.
let paused=false
export function setPaused(on:boolean){paused=on}
async function start() {
  initGame()
  const params = new URLSearchParams(location.search)
  const rangeStore = new RenderRangeStore(loadRenderConfig(params))
  const initialMetrics = rangeStore.getMetrics()
  setFogMetrics(initialMetrics)

  bootProgress('载入地形', 12)
  const manifestBytes = await fetchAsset('manifest.json').catch(()=>{
    record('failure',{category:'manifest'})
    record('retry',{category:'manifest'})
    return fetchAsset('manifest.json').catch(error=>{record('failure',{category:'manifest'});throw error})
  })
  identifyWorld(manifestBytes)
  const manifest:Manifest = JSON.parse(new TextDecoder().decode(manifestBytes))
  if(manifest.version!==4 || manifest.chunkSize!==256 || manifest.grid!==4) throw Error('Unsupported world format')
  const ovTask = startOverview(manifest), pkTask = startPeaks(manifest.peaks)
  await Promise.all([ovTask.dispatched, pkTask.dispatched])
  bootLoaded()
  const basePromise = Promise.all([ovTask.finish, pkTask.finish])
  const renderer = new THREE.WebGLRenderer({antialias:false,powerPreference:'high-performance'})
  renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = look.exposure
  document.body.prepend(renderer.domElement)
  const camera = new THREE.PerspectiveCamera(55,1,1,Math.max(look.fogHorizonTo,initialMetrics.fogHorizonTo)+1200)
  const scene = new THREE.Scene()
  scene.fog = new THREE.Fog(look.hazeNear,0,1)
  const dome = sky(), drops = rain(); scene.add(dome,drops)
  camera.layers.enable(WATER_LAYER)
  const light = new THREE.DirectionalLight(look.sunColor,look.sunPower)
  light.position.set(...look.sunDirection); scene.add(light)
  const hemi = new THREE.HemisphereLight(look.hemiSky,look.hemiGround,look.hemiPower); scene.add(hemi)
  const [left,top,width,depth] = manifest.extent
  scene.add(outerGround(manifest.extent))
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
  const opening = forcedSlot !== null
    ? spawnPool.find(slot => slot.id === forcedSlot) ?? spawnPool[0]
    : isDeepLink(openParams) ? null : consumeRestore() ? readLastView() ?? pickSpawn() : pickSpawn()
  const hasDowntown = left<=-2304 && top<=-2560 && left+width>=1280 && top+depth>=3328
  const framing = hasDowntown ? [-2304,-2560,3584,5888] : manifest.extent
  const [viewX,viewZ,viewWidth,viewDepth] = framing
  let walker:Awaited<ReturnType<typeof import('./walk').walk>>|undefined, switching=false
  let cinema=false
  let walkModPromise:Promise<typeof import('./walk')>|undefined
  const prefetchWalk = ()=>{
    walkModPromise ??= import('./walk').then(mod=>{void mod.preloadWalk();return mod})
    return walkModPromise
  }
  if(params.get('mode')==='walk'||params.has('spawn')) void prefetchWalk()
  const controls = flight(camera,renderer.domElement,manifest.extent,()=>!walker?.active&&!switching&&!cinema)
  // Apply the opening pose here, after flight() has set rotation.order='YXZ'. lookAt()/rotation.set()
  // before that line would be recomputed in the wrong Euler order and leave a permanent roll.
  const {min,max} = playableBounds(manifest.bbox)
  function clampOpening() {
    camera.position.x = THREE.MathUtils.clamp(camera.position.x,min.x,max.x)
    camera.position.z = THREE.MathUtils.clamp(camera.position.z,min.z,max.z)
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
  function resize() {
    renderer.setPixelRatio(Math.min(devicePixelRatio,1.5)); renderer.setSize(innerWidth,innerHeight)
    camera.aspect=innerWidth/innerHeight; camera.updateProjectionMatrix()
  }
  resize(); window.addEventListener('resize',resize)
  bootProgress('载入山体', 45)
  const [base,peaks] = await basePromise
  scene.add(base.mesh,peaks)
  bootProgress('载入街区', 78)
  const clock = skyClock(params)
  setPreset(camera,params.get('cam')??params.get('spawn'),manifest.bbox)
  const stream = new Stream(scene,manifest,base,rangeStore,camera)
  const output = document.querySelector('output')!
  let previous=0, first=0, frame=0, sum=0, samples=0
  const stats = {firstMs:0,firstWorldBytes:0,ms:0,calls:0,frame:0,loaded:0,pending:0,visited:0,failures:0,
    geometries:0,textures:0}
  let cullLandmarks:ReturnType<typeof import('./landmarks').landmarkCulling>|undefined
  let landmarksPromise:Promise<void>|undefined
  function ensureLandmarks(){
    if(!manifest.landmarks?.length) return Promise.resolve()
    landmarksPromise ??= import('./landmarks').then(module=>{
      cullLandmarks=module.landmarkCulling()
      stream.updateLandmarks=module.landmarkStream(scene,renderer,manifest.landmarks!,stream.landmarks,{
        getMetrics:()=>stream.metrics,
        isInnerBusy:()=>stream.isInnerBusy(),
      })
    })
    return landmarksPromise
  }
  function primeLanding(x:number, z:number){
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
      for(const entry of supports){
        target.y=entry.position[1]
        stream.updateLandmarks?.(target,entry)
      }
      stream.updateLandmarks?.(target)
    })
  }
  type Walker=Awaited<ReturnType<typeof import('./walk').walk>>
  async function loadWalker():Promise<Walker>{return walker??=await (await prefetchWalk()).walk(scene,camera,renderer.domElement,manifest,stream,peaks,params.has('verify'))}
  async function walkTo(x:number,z:number,yaw:number,reason:string){
    if(switching)return false
    switching=true
    const start=performance.now()
    let completed=false
    try{
      primeLanding(x,z)
      const player=await loadWalker()
      if(player.active)player.leave()
      completed=await player.enter(x,z,yaw,reason)
      return completed
    }finally{operation('teleport',start,completed);switching=false;showMode()}
  }
  async function toggle(initial=false){
    if(switching)return
    const start=performance.now()
    if(walker?.active){walker.leave();operation('switch',start);return}
    switching=true
    try{
      const name=params.get('spawn'),preset=initial&&name&&Object.hasOwn(presets,name)?presets[name]:null
      const original=camera.clone();if(preset)setPreset(original,name,manifest.bbox)
      const gate=walkConfig.gate,point=preset?.walk??(initial&&!preset?gate:{x:original.position.x,z:original.position.z,yaw:original.rotation.y})
      primeLanding(point.x,point.z)
      const walking=await loadWalker()
      if(!await walking.enter(point.x,point.z,point.yaw,initial?name??'default':'flight')&&initial){
        primeLanding(gate.x,gate.z)
        await walking.enter(gate.x,gate.z,gate.yaw,'fallback')
      }
    }finally{operation('switch',start);switching=false}
  }
  window.addEventListener('keydown',event=>{
    if(isGlobalHotkeyBlocked(event.target))return
    if(event.code==='KeyV'&&!event.repeat)void toggle().then(showMode)
  })
  const touch=matchMedia('(pointer:coarse)').matches,hint=document.querySelector<HTMLElement>('.hint')!,toast=document.querySelector<HTMLElement>('.toast')!
  const modeButton=document.createElement('button');modeButton.className='btn-mode'
  modeButton.addEventListener('pointerenter',()=>void prefetchWalk())
  modeButton.addEventListener('touchstart',()=>void prefetchWalk(),{passive:true})
  function showMode(){const walking=!!walker?.active;document.body.dataset.mode=walking?'walk':'fly'
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
      hint.textContent=walking?'WASD 走 · Shift 跑 · X 蹲 · 空格 跳 · C 视距 · 滚轮远近 · V 起飞 · M 地图 · J 景册 · P 拍照':'WASD 飞 · Q/E 升降 · Shift 加速 · V 落地步行 · M 地图 · J 景册 · P 拍照 · Esc 菜单'
    }
  }
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
  const missionGroundRay = new THREE.Raycaster(undefined, new THREE.Vector3(0, -1, 0))
  const sampleMissionGroundY = (x: number, z: number): number => {
    const tile = manifest.chunks.find(t => x >= t.x && x < t.x + 256 && z >= t.z && z < t.z + 256)
    const mesh = tile && stream.loaded.get(tile)?.groundMesh
    if (!mesh) return NaN
    missionGroundRay.ray.origin.set(x, 3000, z)
    mesh.updateWorldMatrix(true, false)
    return missionGroundRay.intersectObject(mesh, false)[0]?.point.y ?? NaN
  }
  let tour:Awaited<ReturnType<typeof import('./play').play>>|undefined
  const missionRunner = new MissionRunnerEngine()
  const missionBeacon = createMissionBeacon(scene, sampleMissionGroundY)
  const missionUi = mountMissionUi(missionRunner, () => walker?.active ? {x: walker.position.x, z: walker.position.z} : undefined)
  onState((s, changed) => {
    if (changed.has('mission')) {
      const pos = walker?.active ? walker.position : camera.position
      missionBeacon.sync(s.mission?.target, pos, !!tour?.photo?.active || paused, 0)
    }
  })
  window.addEventListener('game:open-missions', () => missionUi.openBoard())
  const syncMissionLoop = (dt: number) => {
    const walking = !!walker?.active
    const activePos = walking ? walker!.position : camera.position
    const mode: PlayerMode = !walking
      ? 'fly'
      : walker!.vehicle === 'bike'
        ? 'ebike'
        : walker!.vehicle === 'bicycle'
          ? 'bike'
          : walker!.vehicle
    const eb = walking ? walker!.ebike?.state : null
    const speedMs = walking ? Math.abs(walker!.speed) : 0
    missionRunner.step({
      dt,
      x: activePos.x,
      y: activePos.y,
      z: activePos.z,
      mode,
      speedMs,
      braking: Boolean(eb?.braking),
      parkLocked: Boolean(eb?.parkLocked),
      crashPhase: eb?.crashPhase ?? 'none',
      frozen: paused || !!tour?.map?.active || !!tour?.photo?.active || missionUi.boardOpen || getState().activeShop !== null,
    })
    missionBeacon.sync(getState().mission?.target, activePos, !!tour?.photo?.active || paused, dt)
  }
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
  const gameProbe = createGameDebugProbe({
    missions: {
      list: listMissionsForUi,
      start: (id: string) => missionRunner.start(id, walker?.active ? {x: walker.position.x, z: walker.position.z} : undefined),
      abandon: () => missionRunner.abandon(),
      status: () => missionRunner.getSnapshot(),
      forceSpill: (drop: number) => missionRunner.forceSpillDrop(drop),
      advanceTimerForTest: (seconds: number) => {
        const steps = Math.max(1, Math.ceil(seconds / 0.1))
        const stepDt = seconds / steps
        const pos = walker?.active ? walker.position : camera.position
        const mode: PlayerMode = !walker?.active ? 'fly' : walker.vehicle === 'bike' ? 'ebike' : walker.vehicle === 'bicycle' ? 'bike' : walker.vehicle
        const eb = walker?.ebike?.state ?? null
        for (let i = 0; i < steps; i++) {
          missionRunner.step({
            dt: stepDt,
            x: pos.x,
            y: pos.y,
            z: pos.z,
            mode,
            speedMs: Math.abs(walker?.speed ?? 0),
            braking: Boolean(eb?.braking),
            parkLocked: Boolean(eb?.parkLocked),
            crashPhase: eb?.crashPhase ?? 'none',
          })
        }
      },
      beaconVisible: () => missionBeacon.isVisible(),
      beaconTarget: () => missionBeacon.getTarget(),
      openBoard: () => missionUi.openBoard(),
      closeBoard: () => missionUi.closeBoard(),
    },
  })
  if(params.has('verify')) Object.assign(window,{viewer:{camera,stream,manifest,stats,walkTo,game:gameProbe,
    get renderRange(){return rangeStore.getConfig()},
    get rangeMetrics(){return rangeStore.getMetrics()},
    setRenderRange(next:unknown, persist=false){return stream.setRenderRange(next as number|string,{persist})},
    deriveRangeMetrics,
    setView:(view:unknown)=>host.setView(view),
    async photoSupport(x:number,z:number,bridgeRadius?:number){return (await loadWalker()).photoSupport(x,z,bridgeRadius)},
    peaksStats:peaks.stats,clock,env,get tour(){return tour},get walk(){return walker},
    setPreset(name:string){setPreset(camera,name,manifest.bbox);camera.updateMatrixWorld();return stats.frame},
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
    },
    // IDOK-105 test hooks (verify mode only).
    spawnPool,
    saveLastViewNow:()=>host.lastView().then(saveLastView),
    readLastViewNow:()=>readLastView(),
    applyLastViewNow:restoreOpening}})
  function draw(){
    base.update(camera)
    const metrics=stream.metrics
    const mirror = frame>=2 && isWaterInView(camera) ? currentMirrorLevel(camera) : -Infinity
    cullLandmarks?.update(stream.landmarks.values(),camera,mirror,metrics.cullHorizon)
    peaks.update(camera,mirror,metrics)
    if(Number.isFinite(mirror))cullLandmarks?.pass(true)
    // Reuse the last reflection while tiles are still streaming: pending work is exactly when the
    // mirror costs the most, and a frame-old reflection is invisible under the ripple distortion.
    const mirrorOff = flags.noMirror || !Number.isFinite(mirror)
    renderMirror(renderer,scene,camera,mirrorOff,!walker?.active&&!cinema&&clock.weather==='clear')
    cullLandmarks?.pass(false)
    renderer.render(scene,camera)
  }
  const host:Host={scene,camera,renderer,manifest,stream,peaks,clock,walker:()=>walker,walkTo,draw,refreshMode:showMode,
    captureView:async()=>(await import('./play/feedback-view')).capture(host),
    lastView:async()=>(await import('./play/feedback-view')).currentView(host,'saved'),
    setView:async(view)=>(await import('./play/feedback-view')).setView(host,view),
    fly(){if(walker?.active)walker.leave();showMode()},get cinema(){return cinema},set cinema(on){cinema=on}}
  const sampleFrame=instrument(renderer,()=>{
    const mode=tour?.map?.active?'map':paused?'menu':walker?.active?(walker.vehicle==='foot'?'walk':'drive'):'fly'
    const position=walker && (mode==='walk'||mode==='drive')?walker.position:camera.position
    return {mode,x:position.x,z:position.z,chunks:stream.loaded.size}
  })
  let playable=false
  function animate(now:number){
    if((paused||tour?.map?.active)&&frame>2){previous=0;return}
    const elapsed = previous?now-previous:0;previous=now
    if(walker?.active)walker.tick(elapsed/1000);else if(!switching)controls(elapsed/1000)
    if(frame===1) {
      first=performance.now();stats.firstMs=first;stats.firstWorldBytes=bytes;bootProgress('载入街区', 100);bootDismiss()
      void import('./play').then(mod=>{tour=mod.play(host)})
    }
    if(frame===2) void ensureLandmarks()
    if(frame===2){
      peaks.loadModels(renderer)
      void loadTiles(renderer).catch(error=>console.warn('City textures unavailable',error))
    }
    if(first&&!switching) {
      const target=walker?.destination??(walker?.active?walker.position:camera.position)
      stream.updateLandmarks?.(target)
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
    syncMissionLoop(Math.min(0.1, elapsed/1000))
    persistView?.()
    draw()
    sampleFrame(elapsed)
    if(!frame)record('firstFrame',{ms:performance.now()})
    if(!playable && first && !paused && !switching && !stream.pending.size && stream.loaded.size){
      const p=walker?.active?walker.position:camera.position
      if(manifest.chunks.every(t=>Math.hypot(t.x+128-p.x,t.z+128-p.z)>stream.radius||stream.loaded.has(t))){
        playable=true;record('playable',{ms:performance.now()})
      }
    }
    frame++; sum+=elapsed;samples++
    Object.assign(stats,{ms:elapsed,calls:renderer.info.render.calls,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,frame,loaded:stream.loaded.size,pending:stream.pending.size,
      visited:stream.visited.size,failures:stream.failures.size})
    if(sum>=400||frame===1) {
      output.value=`${Math.round(samples*1000/(sum||16.7))} FPS · ${stats.calls} calls · ${stats.loaded} 块 · ${bytes.toLocaleString()} B`
      renderUi.refreshStats()
      sum=0;samples=0
    }
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
  if(token){try{if(token.length>4096)throw Error();await host.setView(JSON.parse(atob(token.replace(/-/g,'+').replace(/_/g,'/'))))}catch{console.warn('Invalid feedback view')}}
  else if(params.get('mode')==='walk'||params.has('spawn')){await toggle(true);showMode()}
}
export const boot=()=>start().catch(error=>{document.querySelector('output')!.value=`无法加载：${error.message}`;bootProgress(`无法加载：${error.message}`,0);console.error(error)})
