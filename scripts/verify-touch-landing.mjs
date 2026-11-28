import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {preview} from 'vite'

const server=await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
let browser
try{
  const hardware=process.env.LANDING_GPU==='hardware'
  browser=await chromium.launch({args:hardware?['--enable-gpu','--disable-software-rasterizer']:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-webgl-extensions=KHR_parallel_shader_compile']})
  const page=await browser.newPage({viewport:{width:851,height:309},isMobile:true,hasTouch:true})
  const gpu=await page.evaluate(()=>{const gl=document.createElement('canvas').getContext('webgl2'),info=gl?.getExtension('WEBGL_debug_renderer_info');return info&&gl.getParameter(info.UNMASKED_RENDERER_WEBGL)})
  console.log('Renderer:',gpu);assert.ok(gpu&&(!hardware||!/swiftshader|llvmpipe|software/i.test(gpu)),'Requested WebGL renderer unavailable')
  let stamp=performance.now();const stage=name=>{const now=performance.now();console.log(`${name}: ${Math.round(now-stamp)} ms`);stamp=now}
  let reportFailure;const failure=new Promise(resolve=>{reportFailure=resolve})
  page.on('console',message=>{const text=message.text();if(text.startsWith('collision:ready'))console.log(text)
    if(text.startsWith('walk:enter-failed')){console.error(text);reportFailure(text)}})
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort())
  const stall=process.env.LANDING_STALL_JINGJIANG==='1'
  if(stall)await page.route('**/jingjiang.glb',route=>route.abort())
  const params=new URLSearchParams('verify&play=tour&dpr=0.5&collisionProfile=jingjiang');if(process.env.LANDING_VIEW)params.set('view',process.env.LANDING_VIEW)
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?${params}`,{waitUntil:'domcontentloaded'})
  const view=process.env.LANDING_VIEW?JSON.parse(Buffer.from(process.env.LANDING_VIEW,'base64url')):null
  await page.waitForFunction(view=>window.viewer?.stats.loaded>0&&!window.viewer.stream.pending.size&&
    ![1,2].includes(window.__loading?.level)&&(!view||Math.hypot(window.viewer.camera.position.x-view.x,window.viewer.camera.position.z-view.z)<1),view,{timeout:120000})
  stage('Flight view ready')
  if(!hardware)assert.equal(await page.evaluate(()=>document.querySelector('canvas').getContext('webgl2').getExtension('KHR_parallel_shader_compile')),null)
  const button=page.locator('.btn-mode');await button.tap({timeout:45000});stage('Landing tapped')
  if(stall){
    await page.waitForFunction(()=>document.body.dataset.mode==='fly'&&!document.querySelector('.ld-veil')&&document.querySelector('.toast')?.textContent.includes('再点「落地步行」'),null,{timeout:240000})
    assert.match(await failure,/"cause":"collision-load-timeout".*"missingLandmarks":\[[^\]]*"jingjiang"/);stage('Collision timeout explained');
  }else{
    for(const [name,predicate] of [['Walker initialized',()=>!!window.viewer.walk],['Player placed',()=>window.viewer.walk?.active],['Walk controls ready',()=>document.body.dataset.mode==='walk'&&!document.querySelector('.ld-veil')]]){
      const result=await Promise.race([page.waitForFunction(predicate,null,{timeout:240000}),failure]);if(typeof result==='string')throw Error(result);stage(name)
    }
    if(process.env.LANDING_CAPTURE)await page.screenshot({path:process.env.LANDING_CAPTURE,timeout:60000})
    await button.tap();await page.waitForFunction(()=>!window.viewer.walk.active&&document.body.dataset.mode==='fly');stage('Touch takeoff passed')
  }
}finally{await browser?.close();await server.close()}
