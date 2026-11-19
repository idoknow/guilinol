import * as THREE from 'three'
import {bytes, fetchAsset, startOverview, type Manifest} from './world'
import {Stream} from './stream'
import {flight} from './flight'
import {look} from './look/config'
import {installAtmosphere, outerGround, sky} from './look/atmosphere'
import {startPeaks} from './peaks'
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

installAtmosphere()
async function start() {
  bootProgress('载入地形', 12)
  const manifest:Manifest = JSON.parse(new TextDecoder().decode(await fetchAsset('manifest.json')))
  if(manifest.version!==4 || manifest.chunkSize!==256 || manifest.grid!==4) throw Error('Unsupported world format')
  const ovTask = startOverview(manifest), pkTask = startPeaks(manifest.peaks)
  await Promise.all([ovTask.dispatched, pkTask.dispatched])
  bootLoaded()
  const basePromise = Promise.all([ovTask.finish, pkTask.finish])
  const renderer = new THREE.WebGLRenderer({antialias:false,powerPreference:'high-performance'})
  renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = look.exposure
  document.body.prepend(renderer.domElement)
  const camera = new THREE.PerspectiveCamera(55,1,1,12000)
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
    renderer.setPixelRatio(Math.min(devicePixelRatio,1.5)); renderer.setSize(innerWidth,innerHeight)
    camera.aspect=innerWidth/innerHeight; camera.updateProjectionMatrix()
  }
  resize(); window.addEventListener('resize',resize)
  bootProgress('载入山体', 45)
  const [base,peaks] = await basePromise
  peaks.loadModels(renderer)
  scene.add(base.mesh,peaks)
  bootProgress('载入街区', 78)
  const params = new URLSearchParams(location.search)
  const clock = skyClock(params)
  setPreset(camera,params.get('cam'))
  const radius = Number(params.get('radius')??480)
  const stream = new Stream(scene,manifest,base,THREE.MathUtils.clamp(Number.isFinite(radius)?radius:480,192,1600),camera)
  let updateLandmarks:((eye:THREE.Vector3)=>void)|undefined
  const output = document.querySelector('output')!
  let previous=0, first=0, frame=0, sum=0, samples=0
  const stats = {firstMs:0,firstWorldBytes:0,ms:0,calls:0,frame:0,loaded:0,pending:0,visited:0,failures:0}
  type Walker=Awaited<ReturnType<typeof import('./walk').walk>>
  async function loadWalker():Promise<Walker>{return walker??=await (await prefetchWalk()).walk(scene,camera,renderer.domElement,manifest,stream,peaks,params.has('verify'))}
  async function walkTo(x:number,z:number,yaw:number,reason:string){
    if(switching)return false
    switching=true
    try{await loadWalker();if(walker!.active)walker!.leave();return await walker!.enter(x,z,yaw,reason)}finally{switching=false;showMode()}
  }
  async function toggle(initial=false){
    if(switching)return
    if(walker?.active){walker.leave();return}
    switching=true
    try{
      const walking=await loadWalker()
      const name=params.get('spawn'),preset=initial&&name&&Object.hasOwn(presets,name)?presets[name]:null
      const original=camera.clone();if(preset)setPreset(original,name)
      const gate=walkConfig.gate,point=preset?.walk??(initial&&!preset?gate:{x:original.position.x,z:original.position.z,yaw:original.rotation.y})
      if(!await walking.enter(point.x,point.z,point.yaw,initial?name??'default':'flight',!!preset?.walk)&&initial)
        await walking.enter(gate.x,gate.z,gate.yaw,'fallback')
    }finally{switching=false}
  }
  window.addEventListener('keydown',event=>{if(event.code==='KeyV'&&!event.repeat)void toggle().then(showMode)})
  const touch=matchMedia('(pointer:coarse)').matches,hint=document.querySelector<HTMLElement>('.hint')!,toast=document.querySelector<HTMLElement>('.toast')!
  const modeButton=document.createElement('button');modeButton.className='btn-mode'
  modeButton.addEventListener('pointerenter',()=>void prefetchWalk())
  modeButton.addEventListener('touchstart',()=>void prefetchWalk(),{passive:true})
  function showMode(){const walking=!!walker?.active;document.body.dataset.mode=walking?'walk':'fly'
    modeButton.textContent=walking?'起飞':'落地步行';modeButton.setAttribute('aria-label',walking?'切换到飞行':'切换到步行')
    hint.textContent=walking?'WASD 走 · Shift 跑 · 空格 跳 · 拖动转视角 · 滚轮远近 · V 起飞 · J 景册 · P 拍照':'WASD 飞 · Q/E 升降 · Shift 加速 · V 落地步行 · J 景册 · P 拍照'}
  let toastTimer=0
  window.addEventListener('walk:spawn-failed',()=>{toast.textContent='这里没有可以落脚的地方，飞近岸边或街道再试';toast.classList.add('show')
    clearTimeout(toastTimer);toastTimer=window.setTimeout(()=>toast.classList.remove('show'),3200)})
  modeButton.onclick=()=>void toggle().then(showMode);document.body.append(modeButton);void touch
  showMode()
  if(params.has('verify')) Object.assign(window,{viewer:{camera,stream,manifest,stats,walkTo,
    async photoSupport(x:number,z:number,bridgeRadius=0){return (await loadWalker()).photoSupport(x,z,bridgeRadius)},
    peaksStats:peaks.stats,clock,env,get tour(){return tour},get walk(){return walker},
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
      let lookingAt:string|undefined
      for(const hit of hits){
        for(let obj:THREE.Object3D|null=hit.object;obj;obj=obj.parent) if(obj.name){lookingAt=obj.name;break}
        if(lookingAt) break
      }
      return {clearance,lookingAt,wallDistance:hits[0]?.distance}
    }}})
  function draw(){
    const mirror = frame>=2 && isWaterInView(camera) ? currentMirrorLevel(camera) : -Infinity
    peaks.update(camera,mirror); renderMirror(renderer,scene,camera,!Number.isFinite(mirror)); renderer.render(scene,camera)
  }
  const host:Host={scene,camera,renderer,manifest,stream,peaks,clock,walker:()=>walker,walkTo,draw,refreshMode:showMode,
    fly(){if(walker?.active)walker.leave();showMode()},get cinema(){return cinema},set cinema(on){cinema=on}}
  let tour:Awaited<ReturnType<typeof import('./play').play>>|undefined
  function animate(now:number){
    const elapsed = previous?now-previous:0;previous=now
    if(walker?.active)walker.tick(elapsed/1000);else if(!switching)controls(elapsed/1000)
    if(frame===1) {
      first=performance.now();stats.firstMs=first;stats.firstWorldBytes=bytes;bootProgress('载入街区', 100);bootDismiss()
      void import('./play').then(mod=>{tour=mod.play(host)})
      setTimeout(()=>void import('./ui/about').then(mod=>mod.aboutPanel()),500)
    }
    if(frame===2&&manifest.landmarks?.length)void import('./landmarks').then(module=>{updateLandmarks=module.landmarkStream(scene,renderer,manifest.landmarks!,stream.landmarks)})
    if(frame===2)void loadTiles(renderer).catch(error=>console.warn('City textures unavailable',error))
    if(first&&!switching) {
      updateLandmarks?.(walker?.active?walker.position:camera.position)
      stream.tick(walker?.active?walker.position:camera.position)
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
    Object.assign(stats,{ms:elapsed,calls:renderer.info.render.calls,frame,loaded:stream.loaded.size,pending:stream.pending.size,
      visited:stream.visited.size,failures:stream.failures.size})
    if(sum>=400||frame===1) {
      output.value=`${Math.round(samples*1000/(sum||16.7))} FPS · ${stats.calls} calls · ${stats.loaded} 块 · ${bytes.toLocaleString()} B`
      sum=0;samples=0
    }
  }
  renderer.setAnimationLoop(animate)
  if(params.get('mode')==='walk'||params.has('spawn')){await toggle(true);showMode()}
}
start().catch(error=>{document.querySelector('output')!.value=`无法加载：${error.message}`;bootProgress(`无法加载：${error.message}`,0);console.error(error)})
