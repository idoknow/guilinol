import { readFile, writeFile } from 'node:fs/promises'
import { gzipSync, gunzipSync } from 'node:zlib'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { preview } from 'vite'
import { browserOptions } from './qa-browser.mjs'

const [report, output, limit] = process.argv.slice(2)
const directory=resolve(process.env.RAILWAY_DIST??'dist')
const {crossings} = JSON.parse(await readFile(report))
const server = await preview({configFile:false,build:{outDir:directory},preview:{host:'127.0.0.1',port:0}})
const browser = await chromium.launch(browserOptions(true))
const results=[]
const vehicles=JSON.parse(gunzipSync(await readFile(resolve(directory,'world/vehicles.bin'))))
const [left,top,width,height,step]=vehicles.motorGrid??vehicles.grid
const payload=Buffer.from(vehicles.motorMask??vehicles.mask,'base64')
const mask=vehicles.maskEncoding==='gzip'?gunzipSync(payload):payload
function driveable(x,z){
  const col=Math.round((x-left)/step),row=Math.round((z-top)/step),i=row*width+col
  return col>=0&&col<width&&row>=0&&row<height&&!!(mask[i>>3]&(128>>(i&7)))
}
// Nearby fixtures could capture the same interaction. Keep them on different pages.
const groups=[]
for(const row of crossings.slice(0,limit?Number(limit):crossings.length)){
  const direction=row.south>0?-1:1,east=row.east*direction,south=row.south*direction
  let best=-1,offset=0
  for(const lateral of [0,1,-1,2,-2]){
    let score=0
    for(let s=-7;s<=7;s++)for(const track of [-.74,0,.74]){
      if(driveable(row.x+east*s-south*(lateral+track),row.z+south*s+east*(lateral+track)))score++
    }
    if(score>best){best=score;offset=lateral}
  }
  const start=[row.x-east*7-south*offset,row.z-south*7+east*offset]
  const fixture={...row,east,south,start,heading:Math.atan2(-east,-south),motorMaskScore:best}
  let group=groups.find(items=>items.every(other=>Math.hypot(other.x-row.x,other.z-row.z)>35))
  if(!group){group=[];groups.push(group)}
  group.push(fixture)
}
try {
  for(const group of groups){
    const page=await browser.newPage({viewport:{width:480,height:270}})
    page.setDefaultTimeout(15000)
    await page.route('**/world/vehicles.bin',async route=>{
      const response=await route.fetch(), data=JSON.parse(gunzipSync(await response.body()))
      data.cars.unshift(...group.map(r=>[r.start[0],r.roadY,r.start[1],r.heading,0]))
      await route.fulfill({response,body:gzipSync(JSON.stringify(data))})
    })
    try {
      await page.goto('http://127.0.0.1:'+server.httpServer.address().port+'/?verify&mode=walk&radius=256&flow=0')
      await page.waitForFunction(()=>window.viewer?.walk?.active)
      for(const row of group){
      const {x,z,east,south,roadY,rail,road,sharedNode,heading,start,motorMaskScore}=row
      const id={x,z,rail,road,sharedNode,motorMaskScore}
      for(const mode of ['foot','car']){
        try {
          await page.evaluate(async({start,heading})=>{
            const {walk}=window.viewer
            walk.leave()
            if(!await walk.enter(...start,heading,'railway-crossing'))throw Error('spawn')
            if(Math.hypot(walk.position.x-start[0],walk.position.z-start[1])>3)throw Error('spawn moved outside approach')
          },{start:mode==='car'?start:[x-7*east,z-7*south],heading})
          if(mode==='car'){
            await page.waitForFunction(()=>document.querySelector('.vehicle-action')?.textContent==='开车',null,{timeout:3000})
            await page.keyboard.press('f')
            await page.waitForFunction(()=>window.viewer.walk.vehicle==='car',null,{timeout:3000})
          }
          const result=await page.evaluate(async({x,z,east,south,mode,roadY})=>{
            const {walk,stream}=window.viewer
            await window.viewer.freeze()
            const key=(down)=>window.dispatchEvent(new KeyboardEvent(down?'keydown':'keyup',{code:'KeyW'}))
            try {
              if(mode==='foot')walk.drive(east,south,false)
              else key(true)
              let maxJump=0,prev,along,offset,startAlong,nearest=Infinity,roadError=Infinity
              for(let frame=0;frame<600;frame++){
                walk.tick(1/60);stream.tick(walk.position)
                const p=walk.probe(), y=mode==='car'?p.carY:p.foot
                along=(p.x-x)*east+(p.z-z)*south
                offset=Math.abs((p.x-x)*south-(p.z-z)*east)
                if(Math.abs(along)<nearest){nearest=Math.abs(along);roadError=Math.abs(p.foot-roadY)}
                startAlong??=along
                if(prev!==undefined)maxJump=Math.max(maxJump,Math.abs(y-prev))
                prev=y
                if(along>=6||offset>3||(frame>90 && walk.obstacle && along<startAlong+.05))break
                if(frame%30===0)await new Promise(r=>setTimeout(r,0))
              }
              return {ok:nearest<.4 && roadError<1.2 && startAlong > -11 && startAlong < -3 && along>=6 && offset<=3 && maxJump<=.1,startAlong,along,offset,maxJump,roadError,obstacle:walk.obstacle}
            }finally{key(false);walk.drive(0,0,false);window.viewer.resume()}
          },{x,z,east,south,mode,roadY})
          results.push({...id,mode,...result})
        }catch(e){results.push({...id,mode,ok:false,error:e.message.split('\n')[0]})}
      }
      await writeFile(output,JSON.stringify(results,null,2))
      }
    }catch(e){throw Error('Traversal page failed',{cause:e})}
    finally{await page.close()}
    await writeFile(output,JSON.stringify(results,null,2))
  }
}finally{await browser.close();await server.close()}
console.log(results.filter(r=>r.ok).length,'/',results.length)
if(results.some(r=>!r.ok))process.exitCode=1
