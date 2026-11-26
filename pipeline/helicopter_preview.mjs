// Render the shipped GLB with the same Three.js loader used by the web client.
import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve, sep } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const html = `<style>*{margin:0}canvas{display:block}</style>
<script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script>
<script type="module">
import * as T from 'three'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'
const r=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true})
r.setSize(innerWidth,innerHeight);r.shadowMap.enabled=true;r.shadowMap.type=T.PCFSoftShadowMap
document.body.append(r.domElement)
const scene=new T.Scene();scene.background=new T.Color(0xdbe4e0)
const c=new T.PerspectiveCamera(36,innerWidth/innerHeight,.015,80)
const ground=new T.Mesh(new T.PlaneGeometry(200,200),new T.MeshStandardMaterial({color:0xafbcb9}))
ground.rotation.x=-Math.PI/2;ground.position.y=-.012;ground.receiveShadow=true;scene.add(ground)
scene.add(new T.HemisphereLight(0xfffaf1,0x97aaa8,2))
const sun=new T.DirectionalLight(0xfff0df,2.4);sun.position.set(6,10,4);sun.castShadow=true
Object.assign(sun.shadow.camera,{left:-8,right:8,top:8,bottom:-8});sun.shadow.mapSize.set(2048,2048);sun.shadow.bias=-.0003;scene.add(sun)
const glb=await new GLTFLoader().loadAsync('/public/models/helicopter_tour.glb')
scene.add(glb.scene);glb.scene.traverse(o=>{if(o.isMesh){o.castShadow=!o.material.transparent;o.receiveShadow=true}})
for(const n of ['main','tail'])glb.scene.getObjectByName('rotor_blur_'+n).visible=false
const mixer=new T.AnimationMixer(glb.scene);mixer.clipAction(glb.animations.find(a=>a.name==='pilot_idle')).play();mixer.update(.7)
window.draw=(pos,target,open,fov)=>{
 glb.scene.getObjectByName('door_L').rotation.y=open?-1.38:0
 glb.scene.getObjectByName('door_R').rotation.y=open?1.38:0
 c.position.fromArray(pos);c.lookAt(...target);c.fov=fov;c.updateProjectionMatrix();r.render(scene,c)
}
</script>`
const server = createServer(async (req,res)=>{
  if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(html);return}
  const path=resolve(root,'.'+req.url)
  if(!path.startsWith(resolve(root)+sep)){res.writeHead(403).end();return}
  try {
    const bytes=await readFile(path)
    res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':'application/octet-stream')
    res.end(bytes)
  } catch {res.writeHead(404).end()}
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
let browser
try {
  browser=await chromium.launch({channel:process.env.CHROME_CHANNEL || 'chrome',args:['--enable-unsafe-swiftshader']})
  const page=await browser.newPage({viewport:{width:1280,height:800}})
  page.on('pageerror',e=>console.error(e))
  await page.goto('http://127.0.0.1:'+server.address().port)
  await page.waitForFunction(()=>typeof window.draw==='function')
  for(const [name,...view] of [
    ['exterior',[11.9,5.6,7.5],[0,1.55,-1.0],false,38],
    ['doors',[6.1,4.6,-4.5],[0,1.5,-.55],true,42],
    ['interior',[1.74,2.07,-.39],[-.46,1.53,-.52],true,69],
    ['pilot',[.38,2.23,1.58],[-.52,1.68,1.02],true,67],
  ]) {
    await page.evaluate(args=>window.draw(...args),view)
    await page.screenshot({path:resolve(root,'pipeline/helicopter_views/'+name+'.jpg'),quality:91})
  }
} finally {
  await browser?.close()
  server.close()
}
