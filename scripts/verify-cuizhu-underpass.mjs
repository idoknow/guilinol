import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import path from 'node:path'
import {gzipSync,gunzipSync} from 'node:zlib'
import {preview} from 'vite'
import {chromium} from 'playwright'
import {floorLevel} from '../web/src/station-tunnels.ts'
import {browserOptions} from './qa-browser.mjs'

const world=path.resolve(process.env.WORLD_DIR??'dist/world')
const manifest=JSON.parse(await readFile(path.join(world,'manifest.json')))
const start={x:-2455,z:1937.5},yaw=-Math.PI/2
const height=manifest.tunnels.filter(section=>section.way===265411001)
  .map(section=>floorLevel(section,start.x,start.z)).find(Number.isFinite)
assert(Number.isFinite(height),'western approach missing from world')
const vehicles=JSON.parse(gunzipSync(await readFile(path.join(world,'vehicles.bin'))))
vehicles.cars.unshift([start.x,height,start.z,yaw,0])
const server=await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
let browser
try {
  browser=await chromium.launch(browserOptions())
  const page=await browser.newPage({viewport:{width:480,height:300}})
  await page.route('**/world/*',async route=>{
    const name=path.basename(new URL(route.request().url()).pathname)
    if(name==='vehicles.bin')return route.fulfill({body:gzipSync(JSON.stringify(vehicles))})
    if(process.env.WORLD_DIR)return route.fulfill({path:path.join(world,name)})
    return route.continue()
  })
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?verify&radius=350&mode=walk&dpr=.5&flow=0`,{waitUntil:'domcontentloaded'})
  await page.waitForFunction(()=>window.viewer?.walk?.active,null,{timeout:120000})
  assert(await page.evaluate(async({start,yaw})=>{
    return window.viewer.walkTo(start.x,start.z,yaw,'cuizhu-approach')
  },{start,yaw}))
  console.log('approach',await page.evaluate(()=>window.viewer.walk.position.toArray()),{height})
  await page.waitForFunction(()=>document.querySelector('.vehicle-action')?.textContent==='开车',null,{timeout:45000})
  await page.keyboard.press('f');await page.waitForFunction(()=>window.viewer.walk.vehicle==='car')
  await page.evaluate(()=>window.viewer.freeze());await page.keyboard.down('w')
  const drive=await page.evaluate(()=>{
    const {walk}=window.viewer
    for(let frame=0;frame<1200&&walk.position.x< -2408;frame++)walk.tick(1/60)
    return {x:walk.position.x,foot:walk.probe().foot,obstacle:walk.obstacle}
  });console.log({drive});assert(drive.x>=-2408&&drive.foot<150,'car did not reach crossing on lower road')
  await page.keyboard.up('w');await page.keyboard.down('s');await page.evaluate(()=>{const {walk}=window.viewer;for(let frame=0;frame<180&&walk.speed>.1;frame++)walk.tick(1/60)});await page.keyboard.up('s')
  await page.keyboard.press('f');await page.evaluate(()=>window.viewer.walk.tick(1/60))
  const foot=await page.evaluate(()=>{
    const {walk}=window.viewer,origin=walk.position.x;walk.drive(1,0,false)
    for(let frame=0;frame<1200;frame++)walk.tick(1/60)
    return {mode:walk.vehicle,meters:walk.position.x-origin,foot:walk.probe().foot,resets:walk.probe().resets}
  });console.log({foot});assert(foot.mode==='foot'&&foot.meters>25&&foot.foot<150&&!foot.resets,'dismount or eastward walk blocked')
}finally{await browser?.close();await server.close()}
