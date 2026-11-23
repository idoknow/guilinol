import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {chromium} from 'playwright'
import {preview} from 'vite'
import {browserOptions} from './qa-browser.mjs'

const out='captures/airport-region'
const server=await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
let browser
try{
  browser=await chromium.launch(browserOptions())
  const page=await browser.newPage({viewport:{width:1280,height:800}})
  const url='http://127.0.0.1:'+server.httpServer.address().port
  const mx=111320*Math.cos(25.28*Math.PI/180)
  // A former edge tile in the old northeastern rectangle.
  const x=11000,z=-8500
  const link={mode:'fly',x,y:420,z,lon:110.3+x/mx,lat:25.28-z/110574,yaw:0,pitch:-15,fov:55,
    alt:420,heading:0,target:null,landmark_id:null,build:'0'.repeat(40)}
  const token=Buffer.from(JSON.stringify(link)).toString('base64url')
  await page.goto(url+'/?verify&flow=0&view='+token)
  const nearest=await page.waitForFunction(({x,z})=>{
    const v=window.viewer
    if(!v?.manifest.region)return false
    const ring=v.manifest.region.local
    let best,dist=Infinity
    for(let i=1;i<ring.length;i++){
      const [ax,az]=ring[i-1],[bx,bz]=ring[i],dx=bx-ax,dz=bz-az
      const f=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz)))
      const px=ax+f*dx,pz=az+f*dz,d=Math.hypot(px-x,pz-z)
      if(d<dist){dist=d;best=[px,pz]}
    }
    return dist>100&&Math.hypot(v.camera.position.x-best[0],v.camera.position.z-best[1])<.05?best:false
  },{x,z},{timeout:60000})
  const [px,pz]=await nearest.jsonValue()
  await page.evaluate(({x,z})=>{const c=window.viewer.camera;c.lookAt(x,c.position.y,z)},{x,z})
  await page.keyboard.down('KeyW')
  await page.evaluate(async()=>{for(let i=0;i<30;i++)await new Promise(requestAnimationFrame)})
  await page.keyboard.up('KeyW')
  assert(await page.evaluate(([px,pz])=>Math.hypot(window.viewer.camera.position.x-px,window.viewer.camera.position.z-pz)<.25,[px,pz]),'Outward flight crossed the region')
  await mkdir(out,{recursive:true})
  const views=[
    ['terminal',110.049,25.214,110.044,25.212],['runway',110.045,25.229,110.041,25.234],
    ['lingui-park',110.17,25.243,110.164,25.245],['lingui-expo',110.154,25.246,110.151,25.25],
  ].map(([name,lon,lat,tLon,tLat])=>({name,x:(lon-110.3)*mx,z:(25.28-lat)*110574,tx:(tLon-110.3)*mx,tz:(25.28-tLat)*110574}))
  const edges=await page.evaluate(()=>{
    const ring=window.viewer.manifest.region.local
    const signed=ring.slice(1).reduce((s,b,i)=>s+ring[i][0]*b[1]-b[0]*ring[i][1],0)
    return [.15,.48,.8].map((t,i)=>{
      const j=Math.floor(t*(ring.length-1)),a=ring[j],b=ring[j+1],dx=b[0]-a[0],dz=b[1]-a[1]
      const k=Math.sign(signed)/Math.hypot(dx,dz),nx=-dz*k,nz=dx*k,cx=(a[0]+b[0])/2,cz=(a[1]+b[1])/2
      return {name:'edge-'+(i+1),x:cx+100*nx,z:cz+100*nz,tx:cx-160*nx,tz:cz-160*nz}
    })
  })
  for(const view of [...views,...edges]){
    await page.evaluate(p=>{const v=window.viewer;v.camera.position.set(p.x,360,p.z);v.camera.lookAt(p.tx,158,p.tz)},view)
    await page.waitForFunction(()=>!window.viewer.stats.pending&&window.viewer.manifest.chunks.every(t=>
      Math.hypot(t.x+128-window.viewer.camera.position.x,t.z+128-window.viewer.camera.position.z)>window.viewer.stream.radius||window.viewer.stream.loaded.has(t)),null,{timeout:60000})
    await page.screenshot({path:out+'/'+view.name+'.png'})
  }
  await page.evaluate(()=>window.viewer.tour.map.open())
  const canvas=page.locator('.atlas canvas')
  await canvas.waitFor()
  await canvas.dispatchEvent('wheel',{clientX:640,clientY:400,deltaY:5000})
  await page.screenshot({path:out+'/region.png'})
}finally{await browser?.close();await server.close()}
