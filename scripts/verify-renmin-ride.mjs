import assert from 'node:assert/strict'
import {mkdirSync,readFileSync} from 'node:fs'
import {gzipSync,gunzipSync} from 'node:zlib'
import {chromium} from 'playwright'
import {browserOptions} from './qa-browser.mjs'
import {withFixtureBays} from './ride-fixture-bays.mjs'

const [url,out,tile='public/world/102_40.glc']=process.argv.slice(2)
const vehicles=JSON.parse(gunzipSync(readFileSync('public/world/vehicles.bin')))
const browser=await chromium.launch(browserOptions())
mkdirSync(out,{recursive:true})
try{for(const reverse of [false,true]){
  const start=reverse?-635:-625,end=reverse?-625:-635,south=382.5
  const bay=[start,151,south,reverse?-Math.PI/2:Math.PI/2,0],page=await browser.newPage({viewport:{width:720,height:405}})
  await page.route('**/world/102_40.glc',route=>route.fulfill({body:readFileSync(tile)}))
  await page.route('**/world/vehicles.bin',route=>route.fulfill({body:gzipSync(JSON.stringify({...withFixtureBays(vehicles,[bay]),bikes:[bay]}))}))
  page.on('pageerror',error=>console.error(error.message))
  page.on('response',response=>{if(response.status()>=400)console.error(response.status(),response.url())})
  await page.goto(`${url}/?verify&flow=0&radius=192`,{waitUntil:'domcontentloaded'})
  await page.waitForFunction(()=>window.viewer?.walkTo,null,{timeout:180000})
  console.log('walk ready',reverse)
  assert(await page.evaluate(bay=>window.viewer.walkTo(bay[0],bay[2],bay[3],'renmin-ride'),bay))
  await page.waitForFunction(()=>document.querySelector('.vehicle-action')?.dataset.interactAction==='mount_vehicle',null,{timeout:60000})
  await page.keyboard.press('f');await page.waitForFunction(()=>window.viewer.walk.vehicle==='bike',null,{timeout:60000})
  const result=await page.evaluate(async({start,end,south})=>{
    const {walk,photoSupport}=window.viewer,advance=walk.tick,trace=[]
    const startKind=(await photoSupport(start,south)).kind,endKind=(await photoSupport(end,south)).kind
    walk.tick=()=>{};walk.ebike.setPark(false,true);walk.ebike.setKickstand(false,true)
    window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyW'}))
    try{for(let frame=0;frame<600;frame++){
      advance(1/60);const {x,y,z}=walk.position;trace.push([x,y,z])
      if(walk.vehicle!=='bike'||walk.ebike.state.crashPhase!=='none'||(x-end)*Math.sign(end-start)>=0)break
    }}finally{window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyW'}));walk.tick=advance}
    return {startKind,endKind,start:trace[0],end:trace.at(-1),frames:trace.length,vehicle:walk.vehicle,phase:walk.ebike.state.crashPhase,maxStep:Math.max(...trace.slice(1).map((sample,index)=>Math.abs(sample[1]-trace[index][1])))}
  },{start,end,south})
  console.log(reverse?'return':'outbound',JSON.stringify(result))
  await page.screenshot({path:`${out}/${reverse?'return':'outbound'}.png`,timeout:90000})
  assert.equal(result.vehicle,'bike');assert.equal(result.phase,'none');assert(Math.hypot(result.end[0]-end,result.end[2]-south)<.65);assert(result.maxStep<=.15);assert.notEqual(result.startKind,result.endKind)
  await page.close()
}}finally{await browser.close()}
