import {readFileSync,mkdirSync} from 'node:fs'
import {createServer} from 'vite'
import {chromium} from 'playwright'
import {browserOptions} from './qa-browser.mjs'

const trace=JSON.parse(readFileSync(process.argv[2])),output=process.argv[3]??'captures'
mkdirSync(output,{recursive:true})
const server=await createServer({root:'web',configFile:'web/vite.config.ts',server:{host:'127.0.0.1',port:0}})
let browser
try{
  await server.listen();browser=await chromium.launch(browserOptions())
  const page=await browser.newPage({viewport:{width:720,height:480}})
  await page.route('**/passing-check',route=>route.fulfill({contentType:'text/html',body:'<style>*{margin:0}</style>'}))
  await page.goto(new URL('passing-check',server.resolvedUrls.local[0]).href)
  const retreat=process.argv.includes('--retreat')
  await page.evaluate(async ({trace,retreat})=>{
    const THREE=await import('/@id/three'),{crowd}=await import('/src/traffic/crowd.ts')
    const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(37,1.5,.05,50),renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true})
    camera.layers.enableAll()
    renderer.setSize(720,480);document.body.append(renderer.domElement);scene.background=new THREE.Color(0xc9d5db)
    const [first,last]=trace[0],midX=(first.x+last.x)/2,midZ=(first.z+last.z)/2
    const angle=Math.atan2(last.x-first.x,last.z-first.z)
    camera.position.set(midX+3.6*Math.cos(angle)+3.6*Math.sin(angle),first.y+3.4,midZ-3.6*Math.sin(angle)+3.6*Math.cos(angle));camera.lookAt(midX,first.y+.8,midZ)
    const floor=new THREE.Mesh(new THREE.PlaneGeometry(40,40),new THREE.MeshStandardMaterial({color:0xa9ada9}));floor.rotation.x=-Math.PI/2;floor.position.set(midX,first.y-.06,midZ);scene.add(floor)
    scene.add(new THREE.HemisphereLight(0xffffff,0xa5a5a5,2));const light=new THREE.DirectionalLight(0xffffff,2);light.position.set(3,8,2);scene.add(light)
    const actors=trace[0].map(actor=>({...actor,kind:'person',down:0,scale:1,leaving:false})),view=crowd(scene,camera)
    window.drawPassing=frame=>{actors.forEach((actor,index)=>Object.assign(actor,trace[frame][index]));if(retreat){const x=(actors[0].x+actors[1].x)/2,z=(actors[0].z+actors[1].z)/2;camera.position.set(x+5*Math.cos(angle),first.y+3.4,z-5*Math.sin(angle));camera.lookAt(x,first.y+.8,z)}const visible=view.select(actors);view.animate(.05,0);renderer.render(scene,camera);return visible.size===2}
  },{trace,retreat})
  await page.waitForFunction(()=>window.drawPassing(0),{},{timeout:60000})
  // Pass frames follow the trace itself: approach, closing in, closest centres, separating again.
  const gap=trace.map(([a,b])=>Math.hypot(a.x-b.x,a.z-b.z)),closest=gap.indexOf(Math.min(...gap))
  const near=Math.max(0,gap.findIndex(d=>d<2.5)),apart=gap.findIndex((d,i)=>i>closest&&d>1.5)
  const frames=retreat?[0,100,200,255,280,295].filter(frame=>frame<trace.length):[...new Set([near,Math.round((near+closest)/2),closest,apart<0?trace.length-1:apart])]
  console.log(JSON.stringify(frames.map(frame=>({frame,gap:+gap[frame].toFixed(3)}))))
  for(let frame=0;frame<=frames.at(-1);frame++){
    await page.evaluate(frame=>window.drawPassing(frame),frame)
    if(frames.includes(frame))await page.screenshot({path:`${output}/pass-${frame}.png`})
  }
}finally{await browser?.close();await server.close()}
