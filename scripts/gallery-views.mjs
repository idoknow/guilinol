import {mkdir} from 'node:fs/promises'
import {chromium} from 'playwright'
import {preview} from 'vite'

// Local camera positions inferred from Rock's numbered walk, in metres.
const shots = {
  zhuangyuan_gallery: [
    ['09', [-18,1.68,.12], [13,2.05,0]],
    ['10', [-30,1.62,-1.8], [-17,2.0,0]],
    ['13', [33,1.6,-11], [26.8,3.6,-2.8]],
    ['14', [26.5,1.68,-3.5], [19,2.3,0]],
    ['gallery-side', [2,11,70], [2,11,0]],
    ['gallery-aerial', [-55,48,13], [7,3,0]],
    ['15', [24.85,1.68,-3.85], [26.8,1.65,-1.75]],
  ],
  xiaoyao_tower: [
    ['16', [-14,10.05,-30], [0,19.2,0]],
    ['19', [0,10.05,-31], [0,20.2,0]],
    ['20', [9.8,10.05,-20.5], [0,17,-2]],
    ['22', [-13.7,10.05,-17], [0,19,0]],
    ['25', [14.6,10.05,-8], [9,16.45,1]],
    ['31', [25.5,1.65,-20], [6,13,-7]],
    ['33', [33,1.7,13], [1,14,0]],
    ['56', [40,2.7,64], [0,19.2,0], 20],
    ['tower-side', [72,15,0], [0,15,0]],
    ['aerial', [93,91,-111], [-11,0,1]],
  ],
}
const output = 'captures/gallery'
await mkdir(output,{recursive:true})
const server = await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
let browser
try {
  browser=await chromium.launch({executablePath:process.env.CHROMIUM,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']})
  const page=await browser.newPage({viewport:{width:540,height:720}})
  page.on('pageerror',error=>console.error(error.message))
  page.on('console',message=>{if(message.type()==='error')console.error(message.text())})
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?verify&radius=256&time=12`)
  await page.waitForFunction(()=>window.viewer?.stats.firstMs>0)
  await page.addStyleTag({content:'body > :not(canvas):not(script){visibility:hidden} canvas{visibility:visible} .minimap{display:none!important}'})
  for(const [id,views] of Object.entries(shots))for(const [name,eye,target,hour=12] of views){
    if(process.env.VIEWS && !process.env.VIEWS.split(',').includes(name))continue
    await page.setViewportSize(name.endsWith('-side')?{width:1000,height:500}:name.includes('aerial')?{width:1000,height:680}:{width:540,height:720})
    await page.evaluate(([id,eye,target,hour,name])=>{
      const {manifest,camera,clock}=window.viewer,entry=manifest.landmarks.find(item=>item.id===id)
      const angle=entry.rotation*Math.PI/180
      const point=([x,y,z])=>[entry.position[0]+x*Math.cos(angle)+z*Math.sin(angle),entry.position[1]+y,entry.position[2]-x*Math.sin(angle)+z*Math.cos(angle)]
      camera.fov=['16','19','22'].includes(name)?84:72
      delete camera.updateProjectionMatrix
      camera.near=.15;camera.updateProjectionMatrix()
      camera.position.set(...point(eye));camera.lookAt(...point(target));clock.set(hour)
      if(name.endsWith('-side')){
        // Slice away the foreground residential wing / riverside trees to read the elevation.
        const near=name==='gallery-side'?64:51
        camera.updateProjectionMatrix=()=>{
          camera.projectionMatrix.makeOrthographic(-36,36,18,-18,near,105)
          camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert()
        }
        camera.updateProjectionMatrix()
      }
    },[id,eye,target,hour,name])
    await page.waitForFunction(id=>!window.viewer.stats.pending&&[...window.viewer.stream.landmarks].some(([entry,root])=>entry.id===id&&root.getObjectByName('lod0')?.visible),id,{timeout:90000})
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
    if(name==='aerial'){
      await page.evaluate(()=>{
        const {manifest,camera}=window.viewer
        for(const [id,text,height] of [['zhuangyuan_gallery','状元廊',4.5],['xiaoyao_tower','逍遥楼',30]]){
          const entry=manifest.landmarks.find(item=>item.id===id)
          const anchor=camera.position.clone().fromArray(entry.position)
          anchor.y+=height
          anchor.project(camera)
          const label=document.createElement('div')
          label.textContent=text
          Object.assign(label.style,{position:'fixed',left:(anchor.x+1)*50+'%',top:(1-anchor.y)*50+'%',
            transform:'translate(-50%,-100%)',background:'#1b2428dc',padding:'3px 7px',color:'white',
            visibility:'visible',font:'14px sans-serif',borderBottom:'2px solid #efca8c'})
          document.body.append(label)
        }
      })
    }
    await page.locator('canvas').first().screenshot({path:`${output}/${name}.jpg`,quality:90})
  }
}finally{await browser?.close();await server.close()}
