import * as THREE from 'three'
import {bytes, fetchAsset, overview, type Manifest} from './world'
import {Stream} from './stream'
import {flight} from './flight'
import {look} from './look/config'

async function start() {
  const manifest:Manifest = JSON.parse(new TextDecoder().decode(await fetchAsset('manifest.json')))
  if(manifest.version!==1 || manifest.chunkSize!==256 || manifest.grid!==4) throw Error('Unsupported world format')
  const basePromise = overview(manifest)
  const renderer = new THREE.WebGLRenderer({antialias:false,powerPreference:'high-performance'})
  document.body.prepend(renderer.domElement)
  const camera = new THREE.PerspectiveCamera(60,1,1,10000)
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(look.sky); scene.fog = new THREE.Fog(look.sky,look.fogNear,look.fogFar)
  const light = new THREE.DirectionalLight(look.sunColor,look.sunPower)
  light.position.set(...look.sunPosition); scene.add(light)
  scene.add(new THREE.HemisphereLight(look.hemiSky,look.hemiGround,look.hemiPower))
  const [left,top,width,depth] = manifest.extent
  camera.position.set(left+width*.55,420,top+depth*.62)
  const controls = flight(camera,renderer.domElement,manifest.extent)
  camera.lookAt(left+width*.47,150,top+depth*.45)
  function resize() {
    renderer.setPixelRatio(Math.min(devicePixelRatio,1.5)); renderer.setSize(innerWidth,innerHeight)
    camera.aspect=innerWidth/innerHeight; camera.updateProjectionMatrix()
  }
  resize(); window.addEventListener('resize',resize)
  const base = await basePromise
  scene.add(base.mesh)
  const params = new URLSearchParams(location.search)
  const radius = Number(params.get('radius')??480)
  const stream = new Stream(scene,manifest,base,THREE.MathUtils.clamp(Number.isFinite(radius)?radius:480,192,1600))
  const output = document.querySelector('output')!
  let previous=0, first=0, frame=0, sum=0, samples=0
  const stats = {firstMs:0,firstWorldBytes:0,ms:0,calls:0,frame:0,loaded:0,pending:0,visited:0,failures:0}
  if(params.has('verify')) Object.assign(window,{viewer:{camera,stream,manifest,stats}})
  renderer.setAnimationLoop(now=>{
    const elapsed = previous?now-previous:0;previous=now
    controls(elapsed/1000)
    if(frame===1) {first=performance.now();stats.firstMs=first;stats.firstWorldBytes=bytes}
    if(first) stream.tick(camera.position)
    renderer.render(scene,camera)
    frame++; sum+=elapsed;samples++
    Object.assign(stats,{ms:elapsed,calls:renderer.info.render.calls,frame,loaded:stream.loaded.size,pending:stream.pending.size,
      visited:stream.visited.size,failures:stream.failures.size})
    if(sum>=400||frame===1) {
      output.value=`${Math.round(samples*1000/(sum||16.7))} FPS · ${stats.calls} calls · ${stats.loaded} 块 · ${bytes.toLocaleString()} B`
      sum=0;samples=0
    }
  })
}
start().catch(error=>{document.querySelector('output')!.value=`无法加载：${error.message}`;console.error(error)})
