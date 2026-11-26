import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {chromium} from 'playwright'
import {preview} from 'vite'
import {browserOptions} from './qa-browser.mjs'

function countShadowDraws(){
  const api=WebGL2RenderingContext.prototype,viewports=new WeakMap(),viewport=api.viewport
  let count=0
  api.viewport=function(left,top,width,height){viewports.set(this,width===2048&&height===2048);return viewport.call(this,left,top,width,height)}
  for(const method of ['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced']){
    const draw=api[method];api[method]=function(...args){if(viewports.get(this))count++;return draw.apply(this,args)}
  }
  const getExtension=api.getExtension,seen=new WeakSet()
  api.getExtension=function(name){const extension=getExtension.call(this,name)
    if(name==='WEBGL_multi_draw'&&extension&&!seen.has(extension)){
      seen.add(extension)
      for(const method of ['multiDrawArraysWEBGL','multiDrawElementsWEBGL']){const draw=extension[method];extension[method]=(...args)=>{if(viewports.get(this))count+=args.at(-1);return draw.apply(extension,args)}}
    }
    return extension
  }
  window.takeShadowDraws=()=>{const draws=count;count=0;return draws}
}

const out=resolve(process.env.GFX_OUT??'captures/gfx-occlusion')
await mkdir(out,{recursive:true})
const site=await preview({root:'web',configFile:'web/vite.config.ts',build:{outDir:resolve(process.env.GFX_DIST??'dist')},preview:{host:'127.0.0.1',port:0}})
let browser
try{
  browser=await chromium.launch(browserOptions())
  const budget=await browser.newPage({viewport:{width:800,height:450}})
  try{
    await budget.addInitScript(countShadowDraws)
    await budget.goto(`http://127.0.0.1:${site.httpServer.address().port}/?verify&debug&cam=elephant&gfx=mid&dpr=1&flow=0&time=12`)
    await budget.waitForFunction(()=>window.viewer?.stats.frame>15&&!window.viewer.stats.pending,null,{timeout:180000})
    await budget.evaluate(()=>window.viewer.freeze())
    const draws=await budget.evaluate(()=>{const counts=[];window.takeShadowDraws();for(let frame=0;frame<6;frame++){window.viewer.redrawGfx();counts.push(window.takeShadowDraws())}return counts})
    console.log('mid noon shadow draws',draws);assert.ok(Math.max(...draws)>0&&Math.max(...draws)<=40)
  }finally{await budget.close()}
  for(const [effect,hour,tier] of [['ao',12,'mid'],['shadow',16,'mid'],['godrays',16,'high']]){
    const page=await browser.newPage({viewport:{width:800,height:450}}),errors=[]
    page.on('pageerror',error=>errors.push(error.message))
    page.on('console',msg=>{if(/Shader Error|GL_INVALID|effects unavailable/i.test(msg.text()))errors.push(msg.text())})
    try{
      await page.goto(`http://127.0.0.1:${site.httpServer.address().port}/?verify&debug&mode=walk&gfx=${tier}&dpr=1&flow=0&time=${hour}`)
      await page.waitForFunction(()=>window.viewer?.walk?.active&&window.viewer.stats.frame>15&&!window.viewer.stats.pending,null,{timeout:180000})
      await page.evaluate(()=>window.viewer.freeze())
      for(const pose of effect==='godrays'?['spawn','west']:effect==='ao'?['spawn','close']:['spawn']){
      if(pose!=='spawn')await page.evaluate(pose=>{
        const {camera,env}=window.viewer
        if(pose==='west'){camera.position.set(-589,159.8,-185);camera.lookAt(camera.position.clone().add(env.sunDir))}
        else {camera.position.set(-571.165,158.9,-199.902);camera.lookAt(-571.471,158.2,-197.724)}
        camera.updateMatrixWorld()
      },pose)
      for(const enabled of [false,true]){
        const result=await page.evaluate(({effect,enabled,pose})=>{
          const stress=effect==='ao'&&pose==='spawn'
          window.gfx.set({ao:{enabled:effect==='ao',intensity:enabled?(stress?8:1):0,radius:stress?12:2},bloom:{enabled:false},
            shadow:{enabled:effect!=='ao',strength:effect==='shadow'&&!enabled?0:1,distance:300},godrays:{enabled:effect==='godrays'&&enabled}})
          window.viewer.redrawGfx()
          const canvas=document.querySelector('canvas'),copy=document.createElement('canvas');copy.width=canvas.width;copy.height=canvas.height
          const ctx=copy.getContext('2d');ctx.drawImage(canvas,0,0)
          const bytes=ctx.getImageData(0,0,copy.width,copy.height).data
          if(!enabled)window.occlusionReference=bytes
          let changed=0
          for(let index=0;index<bytes.length;index+=4)if([0,1,2].some(ch=>Math.abs(bytes[index+ch]-window.occlusionReference[index+ch])>8))changed++
          let original=0,current=0
          for(let y=50;y<140;y++)for(let x=40;x<260;x++){
            const index=(y*canvas.width+x)*4
            for(const [ch,weight] of [.2126,.7152,.0722].entries()){
              original+=weight*window.occlusionReference[index+ch];current+=weight*bytes[index+ch]
            }
          }
          let groundPeak=0
          if(effect==='shadow')for(let y=320;y<430;y++)for(let x=50;x<750;x++){
            const index=(y*canvas.width+x)*4
            for(let ch=0;ch<3;ch++)groundPeak=Math.max(groundPeak,Math.abs(bytes[index+ch]-window.occlusionReference[index+ch]))
          }
          return {changed,percent:400*changed/bytes.length,groundPeak,wallDelta:100*Math.abs(current-original)/Math.max(1,original),image:copy.toDataURL().split(',')[1]}
        },{effect,enabled,pose})
        await writeFile(join(out,`${effect}-${pose}-${enabled?'on':'off'}.png`),Buffer.from(result.image,'base64'))
        if(enabled){console.log(effect,pose,result.changed,result.percent,'wall luminance %',result.wallDelta,'ground peak',result.groundPeak)
          if(effect==='shadow'&&result.groundPeak>2)process.exitCode=1
          if(effect==='ao'?result.percent<3:effect==='godrays'&&pose==='spawn'?result.wallDelta>=5:!result.changed)process.exitCode=1}
      }
      }
      assert.deepEqual(errors,[])
    }finally{await page.close()}
  }
}finally{await browser?.close();await site.close()}
