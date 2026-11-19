import {chromium} from 'playwright'
import {preview} from 'vite'

const server = await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
let browser
try {
  browser = await chromium.launch({executablePath:process.env.CHROMIUM,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']})
  const page = await browser.newPage({viewport:{width:960,height:540}})
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?verify&radius=256&time=12`)
  await page.waitForFunction(()=>window.viewer?.stats.firstMs>0)
  for(const id of ['guilin_technical','chuanshan_tourism']) {
    await page.evaluate(id=>{
      const {camera,manifest}=window.viewer
      const entry=manifest.landmarks.find(entry=>entry.id===id), [east,up,south]=entry.position
      const angle=entry.rotation*Math.PI/180, technical=id==='guilin_technical'
      const distance=technical?24:23, lateral=technical?1.2:-3.5
      camera.position.set(east+distance*Math.sin(angle)+lateral*Math.cos(angle),up+2.5,south+distance*Math.cos(angle)-lateral*Math.sin(angle))
      camera.lookAt(east,up+(technical?5.6:4.1),south);camera.updateMatrixWorld()
    },id)
    await page.waitForFunction(id=>!window.viewer.stats.pending&&[...window.viewer.stream.landmarks].some(([entry,root])=>entry.id===id&&root.getObjectByName('lod0')?.visible),id)
    await page.screenshot({path:`docs/schools/${id}-street.jpg`,quality:90})
  }
  await page.waitForSelector('input[aria-label="搜索地点"]',{state:'attached'})
  await page.keyboard.press('m')
  await page.getByRole('searchbox').fill('穿山小学')
  await page.locator('.atlas-search li').filter({hasText:'穿山小学'}).first().click()
  await page.getByRole('button',{name:'前往'}).click()
  await page.waitForFunction(()=>{const walk=window.viewer.walk;if(!walk?.active)return false;const point=walk.probe();return Math.hypot(point.x-278,point.z-1902)<12&&!window.viewer.stats.pending})
  await page.screenshot({path:'docs/schools/chuanshan-primary-arrival.jpg',quality:90})
} finally {await browser?.close();await server.close()}
