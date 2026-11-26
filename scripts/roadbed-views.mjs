import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {chromium} from 'playwright'
import {preview} from 'vite'
import {browserOptions} from './qa-browser.mjs'

const [dist,reportFile,output,limit='20']=process.argv.slice(2)
if(!output)throw Error('usage: node scripts/roadbed-views.mjs DIST REPORT OUT [LIMIT]')
const report=JSON.parse(await readFile(reportFile)),poses=[]
for(const kind of ['overlap','openEdge','voidCandidate','missingAxisSurface']){
  const points=report.stats['ground.'+kind]?.worst??[]
  for(const [rank,{east,south,top,way}] of points.slice(0,Number(limit)).entries()){
    if(!Number.isFinite(top))continue
    poses.push({name:`${kind}-${rank+1}-${way}`,eye:[east+4,top+.24,south+2],target:[east,top-.06,south]})
  }
}
const server=await preview({root:'web',configFile:'web/vite.config.ts',build:{outDir:resolve(dist)},preview:{host:'127.0.0.1',port:0}})
let browser
try{
  await mkdir(output,{recursive:true});await writeFile(join(output,'cameras.json'),JSON.stringify(poses,null,2))
  browser=await chromium.launch(browserOptions());const page=await browser.newPage({viewport:{width:640,height:360}})
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?verify&mode=fly&radius=256&time=12&flow=0`)
  await page.waitForFunction(()=>window.viewer?.stats.firstMs>0,null,{timeout:120000})
  for(const pose of poses){
    await page.evaluate(({eye,target})=>{const {camera,stream}=window.viewer;camera.position.set(...eye);camera.lookAt(...target);camera.updateMatrixWorld();stream.tick(camera.position)},pose)
    await page.waitForFunction(([x,,z])=>{const {stream,manifest}=window.viewer;return manifest.chunks.filter(tile=>x>=tile.x-6&&x<=tile.x+262&&z>=tile.z-6&&z<=tile.z+262).every(tile=>stream.loaded.has(tile))},pose.target,{timeout:120000})
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
    await page.screenshot({path:join(output,pose.name+'.png')})
  }
}finally{await browser?.close();await server.close()}
