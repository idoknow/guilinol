import assert from 'node:assert/strict'
import test from 'node:test'
import {createServer} from 'vite'
import {chromium} from 'playwright'
import {browserOptions} from './qa-browser.mjs'

test('production GLB: cruise disc pixels retain at least 60% material alpha, while blade and disc overlap at mid RPM',async()=>{
  const server=await createServer({root:'web',configFile:'web/vite.config.ts',server:{host:'127.0.0.1',port:0}});await server.listen()
  const browser=await chromium.launch(browserOptions())
  try{
    const page=await browser.newPage();const origin=`http://127.0.0.1:${server.httpServer.address().port}`
    await page.route('**/rotor-probe',route=>route.fulfill({contentType:'text/html',body:'<title>Rotor probe</title>'}));await page.goto(origin+'/rotor-probe')
    const results=await page.evaluate(async threeURL=>{
      const buffer=await (await fetch('/models/helicopter_tour.glb')).arrayBuffer(),length=new DataView(buffer).getUint32(12,true)
      const gltf=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,20,length)))
      const {helicopterModel}=await import('/src/helicopter/model.ts'),model=helicopterModel();model.animate(0,0,0,10,'idle')
      for(let attempt=0;attempt<400&&!model.loaded;attempt++)await new Promise(resolve=>setTimeout(resolve,50))
      if(!model.loaded)throw Error('LOD0 did not load')
      const THREE=await import(threeURL),scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(40,1,.02,100)
      const size=384,renderer=new THREE.WebGLRenderer({alpha:true}),target=new THREE.WebGLRenderTarget(size,size),pixels=new Uint8Array(size*size*4),results=[]
      renderer.setRenderTarget(target);renderer.setClearColor(0,0);renderer.setSize(size,size)
      for(const kind of ['main','tail']){
        const disc=model.anchor('rotor_blur_'+kind),solid=model.anchor('rotor_'+kind)
        const source=gltf.materials.find(material=>material.name==='disk_'+kind);if(!source)throw Error('missing disc material')
        const original=source.pbrMetallicRoughness.baseColorFactor?.[3]??1
        for(const rpm of [.3,.5,.76]){model.animate(0,rpm,0,10,'idle');if(!solid.visible||!disc.visible)throw Error('transition skipped at '+rpm)}
        model.animate(0,1,0,10,'idle');if(!disc.visible||solid.visible)throw Error('missing cruise rotor')
        scene.add(disc);disc.position.set(0,0,0)
        for(const distance of [10,30]){
          camera.position.set(kind==='tail'?distance:0,kind==='main'?distance:0,.001);camera.lookAt(0,0,0);renderer.render(scene,camera)
          renderer.readRenderTargetPixels(target,0,0,size,size,pixels)
          const radius=kind==='main'?5.15:.91,delta=Math.round(.6*radius/distance/Math.tan(20*Math.PI/180)*size/2),values=[]
          for(let azimuth=0;azimuth<2*Math.PI;azimuth+=.25){const x=Math.round(size/2+delta*Math.cos(azimuth)),y=Math.round(size/2+delta*Math.sin(azimuth));values.push(pixels[(y*size+x)*4+3]/255)}
          results.push({kind,distance,minAlpha:Math.min(...values),original})
        }
        scene.remove(disc)
      }
      renderer.dispose();target.dispose();return results
    },"/@fs/"+process.cwd()+"/node_modules/three/build/three.module.js")
    for(const sample of results){console.log(sample);assert.ok(sample.minAlpha>=sample.original*.60,JSON.stringify(sample))}
  }finally{await browser.close();await server.close()}
})
