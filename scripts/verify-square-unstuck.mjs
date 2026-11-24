import assert from 'node:assert/strict'
import {mkdir,readFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import {preview} from 'vite'
import {browserOptions} from './qa-browser.mjs'

const out=process.env.CAPTURE_DIR??'captures/square-unstuck'
await mkdir(out,{recursive:true})
const token=process.env.VIEW_FILE?(await readFile(process.env.VIEW_FILE,'utf8')).trim():''
const server=await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
try {
  const browser=await chromium.launch(browserOptions())
  try {
    const page=await browser.newPage({viewport:{width:844,height:390},isMobile:true,hasTouch:true,reducedMotion:'reduce'})
    page.setDefaultTimeout(120000)
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?verify&flow=0&time=12${token?'&view='+token:''}&play=tour`)
    await page.waitForFunction(()=>window.viewer?.stats.readyMs>0&&!window.viewer.stream.pending.size)
    if(token) {
      await page.evaluate(token=>window.viewer.setView(JSON.parse(atob(token.replace(/-/g,'+').replace(/_/g,'/')))),token)
      await page.waitForFunction(()=>[...window.viewer.stream.landmarks.keys()].some(entry=>entry.id==='central_square')&&!window.viewer.stream.pending.size)
      await page.screenshot({path:`${out}/view.png`})
    }
    const result=await page.evaluate(async()=>{
      const viewer=window.viewer, origin={x:-698,z:213}
      if(!await viewer.walkTo(origin.x,origin.z,0,'qa-square'))throw Error('walkTo failed')
      const walk=viewer.walk,spot=walk.findUnstuck(origin)
      return {origin,spawn:walk.position.toArray(),spot,interior:walk.insideHouseAt(origin.x,origin.z),plaza:walk.insideHouseAt(-845,232)}
    })
    await page.locator('.btn-unstuck').tap()
    await page.waitForFunction(()=>window.viewer.walk.spawns.some(item=>item.reason==='unstuck'))
    const final=await page.evaluate(()=>window.viewer.walk.position.toArray())
    await page.screenshot({path:`${out}/reset.png`})
    console.log(JSON.stringify({...result,final}))
    const inHall=(x,z)=>{
      const corners=[[-711.17,191.32],[-720.79,222.54],[-672,239.47],[-662.47,210.99]]
      return corners.every(([ax,az],index)=>{const [bx,bz]=corners[(index+1)%4];return (bx-ax)*(z-az)-(bz-az)*(x-ax)<0})
    }
    assert(result.interior&&!result.plaza)
    assert(!inHall(result.spawn[0],result.spawn[2]))
    assert(result.spot&&!inHall(result.spot.x,result.spot.z))
    assert(!inHall(final[0],final[2]))
    await page.evaluate(()=>window.viewer.walk.drive(0,-1))
    await page.waitForFunction(([x,,z])=>{const pos=window.viewer.walk.position;return Math.hypot(pos.x-x,pos.z-z)>1},final)
    await page.evaluate(()=>{
      const viewer=window.viewer;viewer.walk.drive(0,0);viewer.flight()
      viewer.camera.position.set(-766,220,272);viewer.camera.lookAt(-695,154,213)
    })
    await page.waitForFunction(()=>!window.viewer.stream.pending.size)
    await page.screenshot({path:`${out}/overview.png`})
  } finally {await browser.close()}
} finally {await server.close()}
