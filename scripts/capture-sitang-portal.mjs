import {preview} from 'vite'
import {chromium} from 'playwright'
import {browserOptions} from './qa-browser.mjs'
import {mkdir} from 'node:fs/promises'
import {resolve} from 'node:path'
const root=process.argv[2]??'captures/sitang'
await mkdir(root,{recursive:true})
const server=await preview({root:'web',configFile:false,build:{outDir:resolve(process.env.GROUNDING_DIST??'dist')},preview:{host:'127.0.0.1',port:0}})
const browser=await chromium.launch(browserOptions())
try{
 for(const label of ['oblique','lane']){
 const page=await browser.newPage({viewport:{width:1100,height:720}})
 await page.goto(('http://127.0.0.1:'+server.httpServer.address().port+'/')+'?verify&flow=0&traffic=0&time=13&radius=512')
 await page.waitForFunction(()=>window.viewer?.stats.firstMs>0)
 await page.addStyleTag({content:'body > :not(canvas){visibility:hidden!important}'})
 await page.evaluate(lower=>{const v=window.viewer;if(lower){v.camera.position.set(-18579.15,160.45,3985.0);v.camera.lookAt(-18577.2,160.1,3973.4)}else{v.camera.position.set(-18590,169.5,3996);v.camera.lookAt(-18575,160,3968)}v.camera.updateMatrixWorld()},label==='lane')
 await page.waitForFunction(()=>{const v=window.viewer;return !v.stats.pending&&v.manifest.chunks.filter(t=>Math.hypot(t.x+128+18577,t.z+128-3974)<235).every(t=>v.stream.loaded.has(t))},null,{timeout:120000})
 await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))
 await page.locator('body > canvas').first().screenshot({path:root+'/'+label+'.png'})
 await page.close()
 }
} finally{await browser.close();await server.close()}
