import {chromium} from 'playwright'
import {preview} from 'vite'
import {mkdir} from 'node:fs/promises'

const kuiguang = process.argv[2] === 'kuiguang'
const id = kuiguang ? 'kuiguang_school' : 'guilin_middle'
const output = `captures/schools/${kuiguang ? 'kuiguang' : 'jiexi'}`
await mkdir(output, {recursive:true})
const server = await preview({root:'web', configFile:'web/vite.config.ts', preview:{host:'127.0.0.1',port:0}})
let browser
try {
  browser = await chromium.launch({executablePath:process.env.CHROMIUM,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']})
  const page = await browser.newPage({viewport:{width:960,height:kuiguang ? 720 : 640}})
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?verify&radius=256&time=12`)
  await page.waitForFunction(()=>window.viewer?.stats.firstMs>0)
  const views = kuiguang ? [['front',[0,1.9,39],[0,3.35,21.6]],['court',[16,3,15],[-3,5,-8]],['green',[-3,2.6,8],[-16,2,4]],['overview',[0,86,6.01],[0,0,6]]] : [['front',[0,3.5,55],[0,4.5,33]],['heritage-front',[0,2.1,22],[0,4,0]],['heritage-side',[24,2.7,5],[0,4,0]],['overview',[-15,185,-57.99],[-15,0,-58]]]
  for (const [name,eye,target] of views) {
    if(!kuiguang && name==='front') {
      await page.setViewportSize({width:960,height:720})
      eye.splice(0,3,4,2.1,53); target.splice(0,3,0,5.5,32.9)
    } else if(!kuiguang) await page.setViewportSize({width:960,height:640})
    await page.evaluate(({eye,target,id})=>{
      const {camera,manifest}=window.viewer
      const {position}=manifest.landmarks.find(entry=>entry.id===id)
      const world=point=>point.map((component,index)=>component+position[index])
      camera.position.set(...world(eye)); camera.lookAt(...world(target)); camera.updateMatrixWorld()
    },{eye,target,id})
    await page.waitForFunction(id=>!window.viewer.stats.pending && [...window.viewer.stream.landmarks].some(([item,root])=>item.id===id && root.getObjectByName('lod0')?.visible),id)
    if(name==='overview') await page.evaluate(({id,kuiguang})=>{
      const {camera,manifest}=window.viewer
      const {position}=manifest.landmarks.find(entry=>entry.id===id)
      const labels=kuiguang ? [['临街住宅楼',0,15,17],['游戏布局，非实地导览',0,0,33]] : [['奎光楼',0,8,0],['游戏布局，非实地导览',-15,0,20]]
      for (const [text,east,height,south] of labels) {
        const pixel=camera.position.clone().set(position[0]+east,position[1]+height,position[2]+south).project(camera)
        const label=document.createElement('span'); label.textContent=text
        label.style.cssText=`position:fixed;left:${(1+pixel.x)*50}%;top:${(1-pixel.y)*50}%;transform:translate(-50%,-50%);background:#fff;color:#222;padding:3px 6px;font:16px sans-serif;z-index:9999;`
        document.body.append(label)
      }
    },{id,kuiguang})
    await page.screenshot({path:`${output}/${name}.png`})
  }
} finally {await browser?.close();await server.close()}
