import {access, mkdir, readFile, writeFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import {preview} from 'vite'

const output=process.env.CAPTURES??'captures/wangcheng'
const palaceOverview=process.argv.includes('--palace-overview')
const planOnly=process.argv.includes('--plan-only')
const selected=process.env.PHOTO_NUMBERS?.split(',')
await mkdir(output,{recursive:true})
const catalog=JSON.parse(await readFile('docs/refs/rock/photo-locations.json','utf8'))
const server=await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
let browser
try {
  browser=await chromium.launch({executablePath:process.env.CHROMIUM,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']})
  const page=await browser.newPage({viewport:{width:700,height:700}})
  async function saveFrame(path,quality=90){
    await page.evaluate(()=>window.viewer.freeze())
    try{await page.screenshot({path,quality,timeout:60000})}
    finally{await page.evaluate(()=>window.viewer.resume())}
  }
  const trace=[]
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?verify&radius=384&time=12`)
  await page.waitForFunction(()=>window.viewer?.stats.firstMs>0)
  await page.addStyleTag({content:'body > :not(canvas):not(script){visibility:hidden}'})
  for(const [file,shot] of Object.entries(catalog).filter(([file])=>!planOnly&&file.startsWith('walk-shizijie-wangcheng/')).sort()){
    const number=file.split('/')[1].slice(0,2)
    if(selected&&!selected.includes(number))continue
    const pitch=({'27':6,'31':3,'34':8,'35':8})[number]??0
    if(process.argv.includes('--resume') && !['34','35'].includes(number) && await access(`${output}/${number}.jpg`).then(()=>true,()=>false)){
      trace.push({number,...shot,pitch});continue
    }
    const bytes=await readFile(`docs/refs/rock/${file}`)
    const size=await page.evaluate(async src=>{const photo=new Image();photo.src=src;await photo.decode();return {width:Math.round(640*photo.width/Math.max(photo.width,photo.height)),height:Math.round(640*photo.height/Math.max(photo.width,photo.height))}},`data:image/jpeg;base64,${bytes.toString('base64')}`)
    await page.setViewportSize(size)
    await page.evaluate(({x,z})=>window.viewer.camera.position.set(x,165,z),shot)
    await page.waitForFunction(({x,z})=>{const {stream,manifest,stats}=window.viewer;return !stats.pending&&stream.loaded.has(manifest.chunks.find(tile=>x>=tile.x&&x<tile.x+256&&z>=tile.z&&z<tile.z+256))&&['jingjiang','wangcheng_market','wangcheng_mall'].every(id=>[...stream.landmarks.keys()].some(entry=>entry.id===id))},shot,{timeout:90000})
    trace.push(await page.evaluate(({shot,number,pitch})=>{
      const {camera,manifest,stream}=window.viewer,{x,z,heading,focal35}=shot
      const tile=manifest.chunks.find(tile=>x>=tile.x&&x<tile.x+256&&z>=tile.z&&z<tile.z+256)
      const geometry=stream.loaded.get(tile).groundMesh.geometry,stride=geometry.parameters.widthSegments+1,step=256/(stride-1)
      const col=(x-tile.x)/step,row=(z-tile.z)/step,at=Math.floor(row)*stride+Math.floor(col),u=col%1,v=row%1
      const heights=geometry.getAttribute('position'),[a,b,c,d]=[at,at+1,at+stride,at+stride+1].map(i=>heights.getY(i))
      const ground=u+v<=1?a+(b-a)*u+(c-a)*v:d+(c-d)*(1-u)+(b-d)*(1-v)
      const angle=heading*Math.PI/180
      camera.layers.disable(2);camera.position.set(x,ground+1.5,z);camera.near=.12;camera.fov=2*Math.atan(18/focal35/camera.aspect)*180/Math.PI;camera.updateProjectionMatrix()
      camera.lookAt(x+Math.sin(angle),ground+1.5+Math.tan(pitch*Math.PI/180),z-Math.cos(angle))
      camera.updateMatrixWorld(true)
      const probe=window.viewer.probeFoot()
      return {number,x,z,ground,heading,focal35,pitch,first:probe.lookingAt,landmark:probe.landmark,distance:probe.wallDistance}
    },{shot,number,pitch}))
    await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))))
    await saveFrame(`${output}/${number}.jpg`)
    if(['34','35'].includes(number)){
      const probe=await page.evaluate(()=>{
        const viewer=window.viewer,camera=viewer.camera,original=camera.quaternion.clone(),hits=[]
        for(const y of [211,215,219,223,227]){
          const target=camera.position.clone().set(-512.6,y,-678.7),ndc=target.clone().project(camera)
          camera.lookAt(target);camera.updateMatrixWorld(true)
          const hit=viewer.probeFoot();hits.push({y,inFrame:Math.abs(ndc.x)<1&&Math.abs(ndc.y)<1,first:hit.lookingAt,distance:hit.wallDistance})
        }
        camera.quaternion.copy(original);camera.updateMatrixWorld(true);return hits
      })
      trace.at(-1).peakProbe=probe;console.log('Gate sightline',number,probe)
    }
  }
  await page.setViewportSize({width:700,height:700})
  await page.evaluate(wide=>{
    const {camera}=window.viewer
    const [x,y,z]=wide?[-548,460,-498]:[-610,360,-150]
    camera.layers.disable(2);camera.fov=wide?2*Math.atan((798-157.7)*Math.tan(55*Math.PI/360)/(460-157.7))*180/Math.PI:55;camera.updateProjectionMatrix();camera.position.set(x,y,z);camera.lookAt(x,150,z-.01)
  },palaceOverview)
  await page.waitForFunction(before=>{const {stats,stream}=window.viewer;return !stats.pending&&[...stream.landmarks].some(([entry,group])=>entry.id===(before?'jingjiang':'wangcheng_market')&&(group.getObjectByName('lod0')?.visible||group.getObjectByName('lod1')?.visible))},planOnly||palaceOverview,{timeout:90000})
  await page.waitForTimeout(400)
  await saveFrame(`${output}/plan.jpg`)
  if(!planOnly)await writeFile(`${output}/cameras.json`,JSON.stringify(trace,null,2))
  console.log('Captured',trace.length,'camera matches and north-up plan')
}finally{await browser?.close();await server.close()}
