import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {chromium} from 'playwright'
import {preview} from 'vite'
import {browserOptions} from './qa-browser.mjs'

const out=resolve(process.env.GFX_OUT??'captures/gfx-parity')
await mkdir(out,{recursive:true})
const site=await preview({root:'web',configFile:'web/vite.config.ts',build:{outDir:resolve(process.env.GFX_DIST??'dist')},preview:{host:'127.0.0.1',port:0}})
let browser
try{
  browser=await chromium.launch(browserOptions())
  for(const [place,hour] of [['elephant',12],['elephant',21],['street',21]]){
    const page=await browser.newPage({viewport:{width:800,height:450}}),errors=[]
    page.on('pageerror',error=>errors.push(error.message))
    page.on('console',message=>{if(/Shader Error|GL_INVALID|effects unavailable/i.test(message.text()))errors.push(message.text())})
    try{
      await page.goto(`http://127.0.0.1:${site.httpServer.address().port}/?verify&debug&dpr=1&flow=0&time=${hour}&${place==='street'?'gfx=high&mode=walk':'gfx=low&cam=elephant'}`,{waitUntil:'domcontentloaded'})
      await page.waitForFunction(street=>window.viewer?.stats.frame>12&&!window.viewer.stats.pending&&(!street||window.viewer.walk?.active),place==='street',{timeout:180000})
      await page.evaluate(()=>window.viewer.freeze())
      const capture=async(tier,state)=>{
        const data=await page.evaluate(({tier,state})=>{
          const canvas=document.querySelector('canvas')
          window.gfx.select(tier)
          if(state==='off')window.gfx.set(Object.fromEntries(['ao','bloom','shadow','dof','godrays'].map(key=>[key,{enabled:false}])))
          if(state==='no-ao')window.gfx.set({ao:{enabled:false}})
          if(window.gfx.config.toneMapping!=='neutral')throw Error('Expected neutral')
          window.viewer.redrawGfx()
          const snapshot=document.createElement('canvas');snapshot.width=canvas.width;snapshot.height=canvas.height
          const ctx=snapshot.getContext('2d');ctx.drawImage(canvas,0,0)
          const bytes=ctx.getImageData(0,0,canvas.width,canvas.height).data
          if(tier==='low')window.gfxReference=bytes
          let changed=0
          if(window.gfxReference)for(let index=0;index<bytes.length;index+=4){if([0,1,2].some(channel=>Math.abs(bytes[index+channel]-window.gfxReference[index+channel])>8))changed++}
          return {image:snapshot.toDataURL().split(',')[1],changed,pixels:canvas.width*canvas.height,hour:window.viewer.clock.hour,nonempty:bytes.some((v,i)=>i%4!==3&&v>40)}
        },{tier,state})
        assert.ok(data.nonempty);assert.equal(data.hour,hour);assert.equal(data.pixels,800*450)
        await writeFile(join(out,`${place}-${hour}-${tier}-${state}.png`),Buffer.from(data.image,'base64'))
        return data
      }
      if(place==='street'){await capture('high','on');await capture('high','no-ao');await capture('low','off')}
      else{await capture('low','direct');await capture('mid','on')}
      for(const tier of ['mid','high']){
        const {changed,pixels}=await capture(tier,'off')
        const percent=100*changed/pixels
        console.log(JSON.stringify({place,hour,tier,changed,percent}));if(percent>1)process.exitCode=1
      }
      assert.deepEqual(errors,[])
    }finally{await page.close()}
  }
}finally{await browser?.close();await site.close()}
