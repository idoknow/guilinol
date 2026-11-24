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
  await page.evaluate(async trace=>{
    const THREE=await import('/@id/three'),{crowd}=await import('/src/traffic/crowd.ts')
    const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(37,1.5,.05,50),renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true})
    renderer.setSize(720,480);document.body.append(renderer.domElement);scene.background=new THREE.Color(0xc9d5db)
    const [first,last]=trace[0],midX=(first.x+last.x)/2,midZ=(first.z+last.z)/2
    const angle=Math.atan2(last.x-first.x,last.z-first.z)
    camera.position.set(midX+5*Math.cos(angle)+1.4*Math.sin(angle),first.y+3.4,midZ-5*Math.sin(angle)+1.4*Math.cos(angle));camera.lookAt(midX,first.y+.8,midZ)
    const floor=new THREE.Mesh(new THREE.PlaneGeometry(40,40),new THREE.MeshStandardMaterial({color:0xa9ada9}));floor.rotation.x=-Math.PI/2;floor.position.set(midX,first.y-.06,midZ);scene.add(floor)
    scene.add(new THREE.HemisphereLight(0xffffff,0xa5a5a5,2));const light=new THREE.DirectionalLight(0xffffff,2);light.position.set(3,8,2);scene.add(light)
    const actors=trace[0].map(actor=>({...actor,kind:'person',down:0,scale:1,leaving:false})),view=crowd(scene,camera)
    window.drawPassing=frame=>{actors.forEach((actor,index)=>Object.assign(actor,trace[frame][index]));const visible=view.select(actors);view.animate(.05,0);renderer.render(scene,camera);return visible.size===2}
  },trace)
  await page.waitForFunction(()=>window.drawPassing(0),{},{timeout:60000})
  for(let frame=0;frame<=58;frame++){
    await page.evaluate(frame=>window.drawPassing(frame),frame)
    if([12,29,37,58].includes(frame))await page.screenshot({path:`${output}/pass-${frame}.png`})
  }
}finally{await browser?.close();await server.close()}
