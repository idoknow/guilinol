import * as THREE from 'three'
import {bytes, fetchAsset, overview, type Manifest} from './world'
import {Stream} from './stream'
import {flight} from './flight'
import {look} from './look/config'
import {installAtmosphere, outerGround, sky} from './look/atmosphere'
import {loadPeaks} from './peaks'
import {presets,setPreset} from './presets'
import {walkConfig} from './walk/config'

installAtmosphere()
async function start() {
  const manifest:Manifest = JSON.parse(new TextDecoder().decode(await fetchAsset('manifest.json')))
  if(manifest.version!==3 || manifest.chunkSize!==256 || manifest.grid!==4) throw Error('Unsupported world format')
  const basePromise = Promise.all([overview(manifest),loadPeaks(manifest.peaks)])
  const renderer = new THREE.WebGLRenderer({antialias:false,powerPreference:'high-performance'})
  renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = look.exposure
  document.body.prepend(renderer.domElement)
  const camera = new THREE.PerspectiveCamera(55,1,1,12000)
  const scene = new THREE.Scene()
  scene.fog = new THREE.Fog(look.hazeNear,0,1); scene.add(sky())
  const light = new THREE.DirectionalLight(look.sunColor,look.sunPower)
  light.position.set(...look.sunDirection); scene.add(light)
  scene.add(new THREE.HemisphereLight(look.hemiSky,look.hemiGround,look.hemiPower))
  const [left,top,width,depth] = manifest.extent
  scene.add(outerGround(manifest.extent))
  camera.position.set(left+width*.55,420,top+depth*.62)
  let walker:Awaited<ReturnType<typeof import('./walk').walk>>|undefined, switching=false
  const controls = flight(camera,renderer.domElement,manifest.extent,()=>!walker?.active&&!switching)
  camera.lookAt(left+width*.47,150,top+depth*.45)
  function resize() {
    renderer.setPixelRatio(Math.min(devicePixelRatio,1.5)); renderer.setSize(innerWidth,innerHeight)
    camera.aspect=innerWidth/innerHeight; camera.updateProjectionMatrix()
  }
  resize(); window.addEventListener('resize',resize)
  const [base,peaks] = await basePromise
  scene.add(base.mesh,peaks)
  const params = new URLSearchParams(location.search)
  setPreset(camera,params.get('cam'))
  const radius = Number(params.get('radius')??480)
  const stream = new Stream(scene,manifest,base,THREE.MathUtils.clamp(Number.isFinite(radius)?radius:480,192,1600))
  const output = document.querySelector('output')!
  let previous=0, first=0, frame=0, sum=0, samples=0
  const stats = {firstMs:0,firstWorldBytes:0,ms:0,calls:0,frame:0,loaded:0,pending:0,visited:0,failures:0}
  async function toggle(initial=false){
    if(switching)return
    if(walker?.active){walker.leave();return}
    switching=true
    try{
      walker??=await (await import('./walk')).walk(scene,camera,renderer.domElement,manifest,stream,peaks,params.has('verify'))
      const name=params.get('spawn'),preset=initial&&name&&Object.hasOwn(presets,name)?presets[name]:null
      const original=camera.clone();if(preset)setPreset(original,name)
      const gate=walkConfig.gate,point=preset?.walk??(initial&&!preset?gate:{x:original.position.x,z:original.position.z,yaw:original.rotation.y})
      if(!await walker.enter(point.x,point.z,point.yaw,initial?name??'default':'flight',!!preset?.walk)&&initial)
        await walker.enter(gate.x,gate.z,gate.yaw,'fallback')
    }finally{switching=false}
  }
  window.addEventListener('keydown',event=>{if(event.code==='KeyV'&&!event.repeat)void toggle()})
  if(matchMedia('(pointer:coarse)').matches){const button=document.createElement('button');button.className='btn-mode';button.textContent='飞行 / 步行';button.style.cssText='position:fixed;right:16px;top:16px';button.onclick=()=>void toggle();document.body.append(button)}
  if(params.has('verify')) Object.assign(window,{viewer:{camera,stream,manifest,stats,get walk(){return walker},probeFoot(){
    const ray = new THREE.Raycaster(camera.position,new THREE.Vector3(0,-1,0))
    const clearance = ray.intersectObjects(scene.children)[0]?.distance
    ray.setFromCamera(new THREE.Vector2(0,0),camera)
    const hit = ray.intersectObjects(scene.children)[0]
    return {clearance,lookingAt:hit?.object.parent?.name,wallDistance:hit?.distance}
  }}})
  renderer.setAnimationLoop(now=>{
    const elapsed = previous?now-previous:0;previous=now
    if(walker?.active)walker.tick(elapsed/1000);else if(!switching)controls(elapsed/1000)
    if(frame===1) {first=performance.now();stats.firstMs=first;stats.firstWorldBytes=bytes}
    if(first&&!switching) stream.tick(walker?.active?walker.position:camera.position)
    renderer.render(scene,camera)
    frame++; sum+=elapsed;samples++
    Object.assign(stats,{ms:elapsed,calls:renderer.info.render.calls,frame,loaded:stream.loaded.size,pending:stream.pending.size,
      visited:stream.visited.size,failures:stream.failures.size})
    if(sum>=400||frame===1) {
      output.value=`${Math.round(samples*1000/(sum||16.7))} FPS · ${stats.calls} calls · ${stats.loaded} 块 · ${bytes.toLocaleString()} B`
      sum=0;samples=0
    }
  })
  if(params.get('mode')==='walk'||params.has('spawn'))await toggle(true)
}
start().catch(error=>{document.querySelector('output')!.value=`无法加载：${error.message}`;console.error(error)})
