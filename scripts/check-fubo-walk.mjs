// Exercise the actual character controller continuously along the OSM centre lines.
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import {preview} from 'vite'
import {telemetryPreview} from './telemetry-preview.mjs'

const {elements}=JSON.parse(await readFile('raw/osm-2026-11.json','utf8'))
const coordinates=id=>elements.find(e=>e.type==='way'&&e.id===id).geometry.map(p=>[
  (p.lon-110.30)*111320*Math.cos(25.28*Math.PI/180),(25.28-p.lat)*110574,
])
const road=coordinates(166550445)
const stairs=coordinates(485320266).reverse()
const dir='captures/fubo'
await mkdir(dir,{recursive:true})
const server=await preview({root:'web',plugins:[telemetryPreview],configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
const browser=await chromium.launch({executablePath:process.env.CHROMIUM,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']})
try{
  const origin='http://127.0.0.1:'+server.httpServer.address().port
  const page=await browser.newPage({viewport:{width:675,height:1233}})
  const x=-120.86,y=154.17,z=-751.47,yaw=158.47
  const view={
    mode:'fly',x,y,z,yaw,pitch:-18.56,fov:55,alt:y,heading:360-yaw,
    lat:25.28-z/110574,lon:110.3+x/(111320*Math.cos(25.28*Math.PI/180)),
    target:null,landmark_id:null,build:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
  }
  await page.goto(origin+'/?verify&flow=0&view='+Buffer.from(JSON.stringify(view)).toString('base64url'))
  await page.waitForFunction(()=>{
    const viewer=window.viewer
    return viewer && Math.abs(viewer.camera.position.x+120.86)<.05 && !viewer.stats.pending
      && viewer.manifest.chunks.every(t=>Math.hypot(t.x+128-viewer.camera.position.x,t.z+128-viewer.camera.position.z)>viewer.stream.radius||viewer.stream.loaded.has(t))
  },null,{timeout:90000})
  await page.screenshot({path:dir+'/player-view.png'})
  await page.setViewportSize({width:800,height:600})
  await page.goto(origin+'/?verify&mode=walk&flow=0')
  await page.waitForFunction(()=>window.viewer?.walk?.active,null,{timeout:90000})
  await page.exposeFunction('captureAscent',()=>page.screenshot({path:dir+'/steps-ascent.png'}))
  for(const [name,line] of [['longzhu',road],['steps',stairs]]){
    const result=await page.evaluate(async({name,line})=>{
      const {walk,stream}=window.viewer
      const samples=[line[0]]
      let distance=2
      for(let i=1;i<line.length;i++){
        const [x,z]=line[i-1],dx=line[i][0]-x,dz=line[i][1]-z,len=Math.hypot(dx,dz)
        while(distance<len){samples.push([x+distance*dx/len,z+distance*dz/len]);distance+=2}
        distance-=len
      }
      samples.push(line.at(-1))
      let route=samples
      if(name==='longzhu'){
        const nearest=samples.reduce((best,p,i)=>Math.hypot(p[0]+120.86,p[1]+751.47)<Math.hypot(samples[best][0]+120.86,samples[best][1]+751.47)?i:best,0)
        route=samples.slice(Math.max(0,nearest-20),nearest+21)
        if(route[0][1]>route.at(-1)[1])route.reverse()
      }
      walk.leave()
      if(!await walk.enter(...route[0],0,name))throw Error('Cannot enter '+name)
      const until=performance.now()+60000
      while(![...stream.landmarks.keys()].some(e=>e.id==='fubo')){
        if(performance.now()>until)throw Error('Fubo collision mesh unavailable')
        await new Promise(requestAnimationFrame)
      }
      await window.viewer.freeze()
      const initialResets=walk.probe().resets
      const records=[]
      for(const point of route){
        let probe=walk.probe()
        for(let tick=0;tick<120;tick++){
          const dx=point[0]-probe.x,dz=point[1]-probe.z,remaining=Math.hypot(dx,dz)
          if(remaining<.38)break
          walk.drive(dx/remaining,dz/remaining,false);walk.tick(.1);probe=walk.probe()
        }
        if(Math.hypot(probe.x-point[0],probe.z-point[1])>.4||probe.resets!==initialResets||probe.inHouse)
          throw Error(name+' at '+JSON.stringify({point,probe}))
        if(name==='steps' && Math.abs(probe.renderClearance)>.30)
          throw Error('Step/terrain gap at '+point+': '+probe.renderClearance)
        if(name==='steps' && records.length===14){
          walk.drive(0,0,false)
          window.viewer.resume()
          await new Promise(requestAnimationFrame)
          await window.viewer.freeze()
          await window.captureAscent()
        }
        records.push({point,x:probe.x,z:probe.z,foot:probe.foot,clearance:probe.renderClearance})
      }
      walk.drive(0,0,false)
      window.viewer.resume()
      return records
    },{name,line})
    assert(result.length>=10)
    await writeFile(dir+'/'+name+'.json',JSON.stringify(result,null,2))
    await page.screenshot({path:dir+'/'+name+'.png'})
    console.log(name,result.length,'samples',result[0].foot,'to',result.at(-1).foot)
  }
}finally{await browser.close();await server.close()}
