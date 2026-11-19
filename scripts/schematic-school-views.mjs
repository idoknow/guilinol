import {mkdir,readFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import {preview} from 'vite'

const args=process.argv.slice(2)
const file=args[0]?.endsWith('.json')?args.shift():'pipeline/schools-g2.json'
const catalog=JSON.parse(await readFile(file,'utf8'))
const requested=new Set(args.filter(arg=>!arg.startsWith('--')))
if([...requested].some(id=>!catalog.some(school=>school.id===id)))throw Error('Unknown school id')
const landmarks=JSON.parse(await readFile('pipeline/landmarks.json','utf8'))
for(const school of catalog){
  const entry=landmarks.find(item=>item.id===school.id)
  if(!entry.flatten)continue
  const [lon,lat]=entry.anchor
  const points=entry.flatten.polygon.map(([x,y])=>[(x-lon)*111320*Math.cos(lat*Math.PI/180),(lat-y)*110574])
  school.extent=[0,1].map(axis=>[Math.min(...points.map(point=>point[axis])),Math.max(...points.map(point=>point[axis]))])
}
await mkdir('docs/schools',{recursive:true})
const server=await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
let browser
try {
  browser=await chromium.launch({executablePath:process.env.CHROMIUM,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']})
  const page=await browser.newPage({viewport:{width:800,height:600},deviceScaleFactor:process.argv.includes('--plaque')?2:1})
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?verify&radius=256&time=12`)
  await page.waitForFunction(()=>window.viewer?.stats.firstMs>0)
  const compare=process.argv.includes('--compare')
  const views=process.argv.includes('--plaque')?['plaque']:compare?['facade','court','ensemble']:['front','overview']
  for(const school of catalog.filter(school=>(!compare||school.id==='libin_middle')&&(!requested.size||requested.has(school.id)))) for(const view of views) {
    await page.evaluate(({school,view})=>{
      document.querySelectorAll('.school-shot').forEach(label=>label.remove())
      const {camera,manifest}=window.viewer, position=manifest.landmarks.find(entry=>entry.id===school.id).position
      const scale=school.scale,heritage=school.heritage
      const angles={facade:[[13,7,8],[0,7,-12]],court:[[-4,9,16],[10,0,2]],ensemble:[[32,26,34],[0,4,-3]]}
      if(view==='plaque') angles.plaque=[[0,4.25,school.sports==='athletics'?29:26],[0,4.25,17.7]]
      const offset=point=>[point[0]*scale,point[1],point[2]*scale]
      let eye=angles[view]?offset(angles[view][0]):view==='overview'?[0,heritage?150:80*scale,0.01]:[0,2.2,(heritage?18:32)*scale]
      let target=angles[view]?offset(angles[view][1]):view==='overview'?[0,0,0]:[0,heritage?3.7:3.2,(heritage?0:17)*scale]
      let world=point=>point.map((value,index)=>value+position[index])
      if(school.worldGround){
        const [[west,east],[north,south]]=school.extent??[[-50,50],[-65,65]]
        const cx=(west+east)/2,cz=(north+south)/2
        const height=20+.6*Math.max(south-north,(east-west)/camera.aspect)/Math.tan(camera.fov*Math.PI/360)
        eye=view==='overview'?[cx,height,cz+.01]:[heritage?-6:0,heritage?5:2.2,(heritage?13:32)*scale]
        target=view==='overview'?[cx,0,cz]:[0,heritage?3.7:3.2,(heritage?0:17)*scale]
        const angle=(view==='front'?manifest.landmarks.find(entry=>entry.id===school.id).rotation:0)*Math.PI/180
        world=([east,up,south])=>[position[0]+east*Math.cos(angle)+south*Math.sin(angle),position[1]+up,position[2]+south*Math.cos(angle)-east*Math.sin(angle)]
      }
      camera.position.set(...world(eye));camera.lookAt(...world(target));camera.updateMatrixWorld()
      const label=(text,x,y)=>{
        const span=document.createElement('span');span.textContent=text;span.className='school-shot'
        span.style.cssText=`position:fixed;z-index:9999;top:${y}%;left:${x}%;transform:translate(-50%,-50%);background:#fff;color:#292929;padding:3px 7px;font:15px sans-serif;white-space:nowrap;`
        document.body.append(span)
      }
      if(view!=='plaque') label(`${school.name} · ${{court:'游戏球场',facade:'游戏主楼',ensemble:'游戏全景',overview:'俯视图',front:'示意立面'}[view]}`,50,8)
      if(view==='overview') {
        label('游戏布局，非实地导览',50,93)
        school.blocks.forEach(([x,z,,floors],index)=>{
          const point=camera.position.clone().set(...world([x*scale,floors*3.2,z*scale])).project(camera)
          label(heritage?['三教楼','四教楼','五教楼'][index]:`教学楼${'甲乙丙丁戊'[index]}`, (1+point.x)*50,(1-point.y)*50)
        })
      }
    },{school,view})
    await page.waitForFunction(id=>!window.viewer.stats.pending&&[...window.viewer.stream.landmarks].some(([entry,root])=>entry.id===id&&root.getObjectByName('lod0')?.visible),school.id)
    await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))))
    if(view==='plaque') await page.screenshot({path:`docs/schools/${school.id}-plaque.png`,clip:{x:0,y:235,width:800,height:130}})
    else await page.screenshot({path:`docs/schools/${school.id}-${view}.jpg`,quality:84})
  }
} finally {await browser?.close();await server.close()}
