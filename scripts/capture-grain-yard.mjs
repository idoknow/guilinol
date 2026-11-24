import fs from 'node:fs'
import {createServer} from 'vite'
import {chromium} from 'playwright'
import {browserOptions} from './qa-browser.mjs'
const output=process.argv[2]??'captures/grain-yard.png'
const center=[-9639.840017227038,3707.6403801280835],radius=307.3042894987517,roof=181.7
const elements=JSON.parse(fs.readFileSync('raw/osm-2026-11.json','utf8')).elements
const coords=geo=>geo.map(({lat,lon})=>[(lon-110.3)*111320*Math.cos(25.28*Math.PI/180),-(lat-25.28)*110574])
const osm=[]
for(const feature of elements){
 if(!feature.tags?.building)continue
 const rings=feature.type==='way'?[feature.geometry]:feature.members?.filter(m=>m.type==='way').map(m=>m.geometry)??[]
 for(const ring of rings){
  if(!ring?.length||!ring.every(Boolean))continue
  const points=coords(ring)
  if(points.some(([x,z])=>Math.abs(x-center[0])<600&&Math.abs(z-center[1])<500))osm.push(points)
 }
}
const way=453854244
const axis=coords(elements.find(w=>w.type==='way'&&w.id===way).geometry)
const sites=[{center,radius,roof,way,osm,axis}]
const server=await createServer({root:'web',configFile:'web/vite.config.ts',server:{port:0,host:'127.0.0.1'}})
await server.listen()
const browser=await chromium.launch(browserOptions())
try {
 const page=await browser.newPage({viewport:{width:1000,height:760},deviceScaleFactor:1})
 await page.goto(server.resolvedUrls.local[0]+'?verify&flow=0&traffic=0&time=14&radius=512')
 await page.waitForFunction(()=>window.viewer?.stats.firstMs>0,null,{timeout:120000})
 await page.addStyleTag({content:'body > :not(canvas){visibility:hidden!important}'})
 for(const site of sites){
  await page.evaluate(({center:[x,z],roof,radius})=>{
   document.querySelector('#audit-overlay')?.remove()
   const c=window.viewer.camera;c.position.set(x,roof+radius*1.35,z);c.up.set(0,0,-1);c.lookAt(x,roof,z);c.updateMatrixWorld()
  },site)
  await page.waitForFunction(({center:[x,z]})=>{
   const v=window.viewer;return v.stats.pending===0&&v.manifest.chunks.filter(t=>Math.hypot(t.x+128-x,t.z+128-z)<210).every(t=>v.stream.loaded.has(t))
  },site,{timeout:120000})
  await page.evaluate(async s=>{
   await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))
   const c=window.viewer.camera,a=document.createElement('canvas');a.id='audit-overlay';a.width=innerWidth;a.height=innerHeight;a.style.cssText='position:fixed;inset:0;z-index:9999;pointer-events:none';document.body.append(a)
   const g=a.getContext('2d'),vec=c.position.clone()
   const draw=(lines,color,width,dash=[])=>{g.strokeStyle=color;g.lineWidth=width;g.setLineDash(dash)
    for(const line of lines){g.beginPath();line.forEach(([x,z],i)=>{vec.set(x,s.roof,z).project(c);const px=(vec.x+1)*innerWidth/2,py=(1-vec.y)*innerHeight/2;i?g.lineTo(px,py):g.moveTo(px,py)});g.stroke()}}
   draw(s.osm,'#5cf4fa',2);draw([s.axis],'#ff6833',4)
   g.fillStyle='rgba(14,20,27,.89)';g.fillRect(12,12,475,65);g.fillStyle='#fff';g.font='bold 18px sans-serif';g.fillText('桂林粮库公司   ·   截图 054 原机位   ·   北 ↑',23,39)
   g.font='15px sans-serif';g.fillStyle='#5cf4fa';g.fillText('OSM 建筑轮廓（含多边形关系及内环）',23,64)
   g.fillStyle='#ff6833';g.fillText('院内道路 453854244',300,64)
  },site)
  await page.screenshot({path:output})
 }
} finally {await browser.close();await server.close()}
