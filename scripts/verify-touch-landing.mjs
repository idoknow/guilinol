import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {preview} from 'vite'

const server=await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
let browser
try{
  browser=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-webgl-extensions=KHR_parallel_shader_compile']})
  const page=await browser.newPage({viewport:{width:851,height:309},isMobile:true,hasTouch:true})
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort())
  const params=new URLSearchParams('verify&play=tour');if(process.env.LANDING_VIEW)params.set('view',process.env.LANDING_VIEW)
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?${params}`,{waitUntil:'domcontentloaded'})
  await page.waitForFunction(()=>window.viewer?.stats.loaded>0&&!window.viewer.stream.pending.size,null,{timeout:120000})
  assert.equal(await page.evaluate(()=>document.querySelector('canvas').getContext('webgl2').getExtension('KHR_parallel_shader_compile')),null)
  const button=page.locator('.btn-mode');const started=Date.now();await button.tap({timeout:45000})
  await page.waitForFunction(()=>window.viewer.walk?.active&&document.body.dataset.mode==='walk'&&!document.querySelector('.ld-veil'),null,{timeout:110000})
  console.log(`Walk controls ready in ${Date.now()-started} ms`)
  if(process.env.LANDING_CAPTURE)await page.screenshot({path:process.env.LANDING_CAPTURE,timeout:60000})
  await button.tap();await page.waitForFunction(()=>!window.viewer.walk.active&&document.body.dataset.mode==='fly');console.log('Touch takeoff passed')
}finally{await browser?.close();await server.close()}
