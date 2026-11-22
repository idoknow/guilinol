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
const plaza=coordinates(1531545568).slice(0,-1)
const middle=plaza.reduce(([x,z],[px,pz])=>[x+px/plaza.length,z+pz/plaza.length],[0,0])
const inner=plaza.map(([x,z])=>[middle[0]+.58*(x-middle[0]),middle[1]+.58*(z-middle[1])])
const entry=stairs.at(-1)
const start=inner.reduce((nearest,p,i)=>Math.hypot(p[0]-entry[0],p[1]-entry[1])<
  Math.hypot(inner[nearest][0]-entry[0],inner[nearest][1]-entry[1])?i:nearest,0)
const circuit=[...inner.slice(start),...inner.slice(0,start),inner[start],middle]
const dir=process.env.FUBO_CAPTURE_DIR??'captures/fubo'
await mkdir(dir,{recursive:true})
const server=await preview({root:'web',build:process.env.FUBO_PREVIEW_DIST?{outDir:process.env.FUBO_PREVIEW_DIST}:undefined,plugins:[telemetryPreview],configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
const browser=await chromium.launch({executablePath:process.env.CHROMIUM,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']})
try{
  const origin='http://127.0.0.1:'+server.httpServer.address().port
  const page=await browser.newPage({viewport:{width:675,height:1233}})
  const views=[
    ['player',-120.86,154.17,-751.47,158.47,-18.56,55],
    ['sw',-250,290,-550,315,-28,55], ['east',110,175,-730,90,-6,55],
    ['top',-80,520,-719,0,-89,45], ['west',-294,200,-730,270,-10,55],
    ['south',-82,212,-479,0,-10,55],
  ]
  for(const [label,x,y,z,yaw,pitch,fov] of process.argv.includes('--walk-only')?[]:views){
    await page.setViewportSize(label==='player'?{width:675,height:1233}:{width:900,height:600})
    const view={mode:'fly',x,y,z,yaw:(yaw+180)%360-180,pitch,fov,alt:y,heading:360-yaw,
      lat:25.28-z/110574,lon:110.3+x/(111320*Math.cos(25.28*Math.PI/180)),
      target:null,landmark_id:null,build:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()}
    await page.goto(origin+'/?verify&flow=0&view='+Buffer.from(JSON.stringify(view)).toString('base64url'))
    await page.waitForFunction(x=>{
      const v=window.viewer
      return v && Math.abs(v.camera.position.x-x)<.06 && !v.stats.pending &&
        v.manifest.chunks.every(t=>Math.hypot(t.x+128-v.camera.position.x,t.z+128-v.camera.position.z)>v.stream.radius||v.stream.loaded.has(t))
    },x,{timeout:90000})
    await page.screenshot({path:dir+'/'+label+'-view.png'})
  }
  if(!process.argv.includes('--views-only')){
    await page.setViewportSize({width:800,height:600})
    await page.goto(origin+'/?verify&mode=walk&flow=0')
    await page.waitForFunction(()=>window.viewer?.walk?.active,null,{timeout:90000})
    await page.exposeFunction('captureAscent',()=>page.screenshot({path:dir+'/steps-ascent.png'}))
    for(const [name,line] of [['longzhu',road],['steps',stairs]]){
      const result=await page.evaluate(async({name,line,circuit})=>{
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
        const stairCount=route.length
        if(name==='steps')route=[...route,...circuit]
        walk.leave()
        // Follow the upper flight from behind for the ascent photograph.
        const heading=name==='steps'?Math.atan2(route[42][0]-route[44][0],route[42][1]-route[44][1]):0
        if(!await walk.enter(...route[0],heading,name))throw Error('Cannot enter '+name)
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
            if(name==='steps' && records.length>=stairCount &&
               (probe.wet||Math.abs(probe.renderClearance)>.30||probe.resets!==initialResets))
              throw Error('Lost plaza support at '+[probe.x,probe.z])
          }
          if(Math.hypot(probe.x-point[0],probe.z-point[1])>.4||probe.resets!==initialResets||probe.inHouse)
            throw Error(name+' at '+JSON.stringify({point,probe}))
          if(name==='steps' && Math.abs(probe.renderClearance)>.30)
            throw Error('Step/terrain gap at '+point+': '+probe.renderClearance)
          if(name==='steps' && records.length===43){
            walk.drive(0,0,false)
            window.viewer.resume()
            await new Promise(requestAnimationFrame)
            await window.viewer.freeze()
            await window.captureAscent()
          }
          records.push({section:records.length>=stairCount?'platform':name,point,x:probe.x,z:probe.z,foot:probe.foot,clearance:probe.renderClearance})
        }
        walk.drive(0,0,false)
        window.viewer.resume()
        return records
      },{name,line,circuit})
      assert(result.length>=10)
      const path=result.filter(r=>r.section===name)
      await writeFile(dir+'/'+name+'.json',JSON.stringify(path,null,2))
      if(name==='steps'){
        const loop=result.filter(r=>r.section==='platform')
        assert.equal(loop.length,circuit.length)
        await writeFile(dir+'/platform.json',JSON.stringify(loop,null,2))
        console.log('stairs rise',path.at(-1).foot-path[0].foot,'m; completed platform circuit',loop.length)
      }
      await page.screenshot({path:dir+'/'+name+'.png'})
      console.log(name,result.length,'samples',result[0].foot,'to',result.at(-1).foot)
    }
  }
}finally{await browser.close();await server.close()}
