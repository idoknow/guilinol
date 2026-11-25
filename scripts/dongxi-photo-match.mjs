import {access, mkdir, readFile, writeFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import {preview} from 'vite'

const output=process.env.CAPTURES??'captures/wangcheng'
const palaceOverview=process.argv.includes('--palace-overview')
const planOnly=process.argv.includes('--plan-only')
const selected=process.env.PHOTO_NUMBERS?.split(',')
await mkdir(output,{recursive:true})
const catalog=JSON.parse(await readFile('.ops-docs/layout/dongxi-photo-locations.json','utf8'))
const official=JSON.parse(await readFile('.ops-docs/refs/rock/photo-locations.json','utf8'))
for(const [key,shot] of Object.entries(catalog)){
  if(!key.startsWith('walk-shizijie-wangcheng/'))continue
  if(official[key]?.heading!==shot.heading || official[key]?.heading_exif!==shot.heading_exif)
    throw Error(`District and official headings differ for ${key}`)
}
const estimatedPath=process.env.ESTIMATED_CAMERAS??(process.argv.includes('--dongxi')?'.ops-docs/layout/dongxi-estimated-cameras.json':null)
const estimates=estimatedPath?JSON.parse(await readFile(estimatedPath,'utf8')):{}
const shopLayout=JSON.parse(await readFile('.ops-docs/layout/dongxi-layout.geojson','utf8'))
const coffee=shopLayout.features.find(feature=>feature.properties.name==='星巴克')
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
  for(const [file,shot] of Object.entries({...catalog,...estimates}).filter(([file])=>!planOnly&&(file.startsWith('walk-shizijie-wangcheng/')||file in estimates)).sort()){
    const number=(file in estimates?'Y':'')+file.split('/')[1].slice(0,2)
    if(selected&&!selected.includes(number))continue
    const originalHeading=shot.heading_exif
    const recordedPosition=[shot.x,shot.z]
    if(shot.renderXZ)[shot.x,shot.z]=shot.renderXZ
    if(number==='36'&&!process.argv.includes('--dongxi'))shot.heading=187
    const pitch=({'27':6,'31':3,'33':7,'34':8,'35':8,'36':6})[number]??0
    if(process.argv.includes('--resume') && !['27','31','33','34','35','36'].includes(number) && await access(`${output}/${number}.jpg`).then(()=>true,()=>false)){
      trace.push({number,...shot,pitch});continue
    }
    const bytes=await readFile(`.ops-docs/refs/rock/${file}`)
    const size=await page.evaluate(async ({src,longEdge})=>{const photo=new Image();photo.src=src;await photo.decode();return {width:Math.round(longEdge*photo.width/Math.max(photo.width,photo.height)),height:Math.round(longEdge*photo.height/Math.max(photo.width,photo.height))}},{src:`data:image/jpeg;base64,${bytes.toString('base64')}`,longEdge:Number(process.env.PHOTO_SIZE??640)})
    await page.setViewportSize(size)
    await page.evaluate(({x,z})=>window.viewer.camera.position.set(x,165,z),shot)
    await page.waitForFunction(({x,z})=>{const {stream,manifest,stats}=window.viewer;return !stats.pending&&stream.loaded.has(manifest.chunks.find(tile=>x>=tile.x&&x<tile.x+256&&z>=tile.z&&z<tile.z+256))&&['jingjiang','wangcheng_market','wangcheng_mall'].every(id=>[...stream.landmarks.keys()].some(entry=>entry.id===id))},shot,{timeout:90000})
    trace.push(await page.evaluate(({shot,number,pitch,coffee})=>{
      const {camera,manifest,stream}=window.viewer,{x,z,heading,focal35}=shot
      const tile=manifest.chunks.find(tile=>x>=tile.x&&x<tile.x+256&&z>=tile.z&&z<tile.z+256)
      const geometry=stream.loaded.get(tile).groundMesh.geometry,stride=geometry.parameters.widthSegments+1,step=256/(stride-1)
      const col=(x-tile.x)/step,row=(z-tile.z)/step,at=Math.floor(row)*stride+Math.floor(col),u=col%1,v=row%1
      const heights=geometry.getAttribute('position'),[a,b,c,d]=[at,at+1,at+stride,at+stride+1].map(i=>heights.getY(i))
      const ground=u+v<=1?a+(b-a)*u+(c-a)*v:d+(c-d)*(1-u)+(b-d)*(1-v)
      const angle=heading*Math.PI/180
      camera.layers.disable(2);camera.position.set(x,ground+1.5,z);camera.near=.12;camera.fov=2*Math.atan(43.27/(2*focal35*Math.hypot(1,camera.aspect)))*180/Math.PI;camera.updateProjectionMatrix()
      if(['07','10'].includes(number)){camera.fov=2*Math.atan(18/focal35/camera.aspect)*180/Math.PI;camera.updateProjectionMatrix()}
      camera.lookAt(x+Math.sin(angle),ground+1.5+Math.tan(pitch*Math.PI/180),z-Math.cos(angle))
      camera.updateMatrixWorld(true)
      const probe=window.viewer.probeFoot()
      let shopCheck
      if(['07','10'].includes(number)){
        const [lon,lat]=coffee.geometry.coordinates,normal=coffee.properties.bearing*Math.PI/180
        const entry=manifest.landmarks.find(entry=>entry.id==='wangcheng_market')
        const center=camera.position.clone().set((lon-110.300)*111320*Math.cos(25.280*Math.PI/180)+.25*Math.sin(normal),entry.position[1]+2.76,-(lat-25.280)*110574-.25*Math.cos(normal))
        const u=(center.project(camera).x+1)/2,target=(number==='07'?(1300+1473):(1347+1706))/3840
        shopCheck={sign:'STARBUCKS COFFEE',u,target,errorWidth:Math.abs(u-target),threshold:.01}
      }
      return {number,x,z,ground,heading,focal35,pitch,first:probe.lookingAt,landmark:probe.landmark,distance:probe.wallDistance,shopCheck}
    },{shot,number,pitch,coffee}))
    const check=trace.at(-1)
    if(check.shopCheck && !(check.shopCheck.errorWidth<check.shopCheck.threshold))throw Error(`Sign mismatch: ${number}`)
    if(['Y03','Y05','Y06'].includes(number) && !(check.landmark && check.distance>=3))throw Error(`Obstructed view: ${JSON.stringify(check)}`)
    trace.at(-1).originalHeading=originalHeading
    trace.at(-1).recordedPosition=recordedPosition
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
  if(process.argv.includes('--hall-facade')){
    await page.setViewportSize({width:720,height:480})
    await page.evaluate(()=>{
      const {camera}=window.viewer
      camera.layers.disable(2)
      camera.position.set(-554.7,160.3,-447.0)
      camera.fov=41;camera.updateProjectionMatrix()
      camera.lookAt(-550.4,165.8,-477)
    })
    await page.waitForFunction(()=>[...window.viewer.stream.landmarks].some(([e,g])=>e.id==='jingjiang'&&g.getObjectByName('lod0')?.visible))
    await saveFrame(`${output}/hall-facade.jpg`)
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
  if(process.argv.includes('--dongxi')){
    await page.evaluate(()=>{
      const {camera}=window.viewer
      camera.position.set(-472,444,-171);camera.lookAt(-472,150,-171.01)
    })
    await page.waitForFunction(()=>!window.viewer.stats.pending&&[...window.viewer.stream.landmarks.keys()].some(entry=>entry.id==='zhuangyuan_gallery'))
    await page.waitForTimeout(400)
    await saveFrame(`${output}/east-plan.jpg`)
    if(process.argv.includes('--roof-mask'))await (await import('./market-roof-mask.mjs')).saveMarketMask(page,output)
  }
  if(!planOnly)await writeFile(`${output}/cameras.json`,JSON.stringify(trace,null,2))
  console.log('Captured',trace.length,'camera matches and north-up plan')
}finally{await browser?.close();await server.close()}
