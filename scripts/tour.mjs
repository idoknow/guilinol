import assert from 'node:assert/strict'
import {mkdir,readFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import {preview} from 'vite'

const server=await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
let browser
try{
  browser=await chromium.launch({executablePath:process.env.CHROMIUM,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']})
  for(const [device,width,height] of [['mobile',390,844],['desktop',960,540]]){
    const dir=`captures/tour/${device}`;await mkdir(dir,{recursive:true})
    const page=await browser.newPage({viewport:{width,height},hasTouch:device==='mobile',isMobile:device==='mobile'}),errors=[]
    page.setDefaultTimeout(60000);page.on('pageerror',error=>errors.push(error.message))
    const shot=name=>page.screenshot({path:`${dir}/${name}.png`}),button=name=>page.getByRole('button',{name,exact:true})
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?verify&mode=walk`)
    await page.waitForFunction(()=>window.viewer?.walk?.active&&window.viewer.tour)
    await page.locator('.road-name.visible').waitFor();await shot('street-mini')
    await button('打开地图').click();await page.getByLabel('搜索地点').fill('象鼻山');await shot('search')
    await button('象鼻山 · 水月洞对岸').click();await button('前往').click();await page.locator('.tour-hud article:not([hidden])').waitFor();await shot('discovery')
    if(device==='mobile')for(const viewport of [{width:360,height:640},{width:640,height:360},{width,height}]){await page.setViewportSize(viewport);await button('拍一张').click({trial:true});await page.locator('.btn-view').click({trial:true});await page.locator('.joystick').click({trial:true})}
    await button('拍一张').click();await page.getByLabel('时段').evaluate(input=>{input.value='18.1';input.dispatchEvent(new Event('input',{bubbles:true}))});await page.getByLabel('滤镜').selectOption({label:'青绿'})
    await page.waitForFunction(()=>Math.abs(window.viewer.clock.hour-18.1)<.01);await shot('camera')
    const downloading=page.waitForEvent('download');await button('快门').click();const download=await downloading;await download.saveAs(`${dir}/photo.png`)
    const bytes=await readFile(`${dir}/photo.png`);assert.equal(bytes.subarray(1,4).toString(),'PNG');assert(bytes.length>5000)
    await button('返回').click();await button('打开地图').click();assert.equal(await page.locator('.tour-map aside').textContent(),'已发现 1/8');await shot('progress')
    await button('返回').click();await page.keyboard.down('KeyS');try{await page.waitForFunction(()=>window.viewer.tour.metrics().samples>=18)}finally{await page.keyboard.up('KeyS')}
    const metrics=await page.evaluate(()=>window.viewer.tour.metrics());console.log(device,metrics);assert(metrics.miniMeanMs<1)
    if(device==='desktop'){
      const views=JSON.parse(await readFile('pipeline/viewpoints.json','utf8'))
      for(const site of views.slice(1)){await page.keyboard.press('m');await page.getByLabel('搜索地点').fill(site.n);await button(site.n).first().click();await button('前往').click();await page.waitForFunction(name=>document.querySelector('.tour-hud article:not([hidden]) strong')?.textContent===name,site.n)}
      await page.keyboard.press('m');assert.equal(await page.locator('.tour-map aside').textContent(),'已发现 8/8')
    }assert.deepEqual(errors,[]);await page.close()
  }
}finally{await browser?.close();await server.close()}
