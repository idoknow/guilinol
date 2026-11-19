import {mkdir,readFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import {preview} from 'vite'

const catalog=JSON.parse(await readFile(process.argv[2]??'pipeline/schools-g2.json','utf8'))
await mkdir('docs/schools',{recursive:true})
const server=await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
let browser
try {
  browser=await chromium.launch({executablePath:process.env.CHROMIUM,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']})
  const page=await browser.newPage({viewport:{width:800,height:600}})
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?verify&radius=256&time=12`)
  await page.waitForFunction(()=>window.viewer?.stats.firstMs>0)
  for(const school of catalog) for(const view of ['front','overview']) {
    await page.evaluate(({school,view})=>{
      document.querySelectorAll('.school-shot').forEach(label=>label.remove())
      const {camera,manifest}=window.viewer, position=manifest.landmarks.find(entry=>entry.id===school.id).position
      const scale=school.scale,heritage=school.heritage
      const eye=view==='overview'?[0,heritage?150:80*scale,0.01]:[0,2.2,(heritage?18:32)*scale]
      const target=view==='overview'?[0,0,0]:[0,heritage?3.7:3.2,(heritage?0:17)*scale]
      const world=point=>point.map((value,index)=>value+position[index])
      camera.position.set(...world(eye));camera.lookAt(...world(target));camera.updateMatrixWorld()
      const label=(text,x,y)=>{
        const span=document.createElement('span');span.textContent=text;span.className='school-shot'
        span.style.cssText=`position:fixed;z-index:9999;top:${y}%;left:${x}%;transform:translate(-50%,-50%);background:#fff;color:#292929;padding:3px 7px;font:15px sans-serif;white-space:nowrap;`
        document.body.append(span)
      }
      label(`${school.name} · 示意立面`,50,8)
      if(view==='overview') {
        label('游戏布局，非实地导览',50,93)
        school.blocks.forEach(([x,z,,floors],index)=>{
          const point=camera.position.clone().set(...world([x*scale,floors*3.2,z*scale])).project(camera)
          label((heritage?['三教楼','四教楼','五教楼']:['教学楼甲','教学楼乙'])[index],(1+point.x)*50,(1-point.y)*50)
        })
      }
    },{school,view})
    await page.waitForFunction(id=>!window.viewer.stats.pending&&[...window.viewer.stream.landmarks].some(([entry,root])=>entry.id===id&&root.getObjectByName('lod0')?.visible),school.id)
    await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))))
    await page.screenshot({path:`docs/schools/${school.id}-${view}.jpg`,quality:84})
  }
} finally {await browser?.close();await server.close()}
