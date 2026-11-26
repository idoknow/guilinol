// IDOK-350 街景导航验收：路网寻路 + 场景 3D 路线 + 转向 toast + 偏离重算节流 + 取消清理 + 截图。
// Usage: CHROMIUM=/usr/bin/chromium node scripts/verify-nav.mjs   (needs a built dist/ with world data)
//   NAV_SHOTS=captures/nav  — screenshot folder (desktop 1440×900, phone 375×812)
import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {chromium} from 'playwright'
import {createServer,preview} from 'vite'

const outDir = process.env.NAV_SHOTS ?? 'captures/nav'
await mkdir(outDir,{recursive:true})
// 东西巷（正阳门外观景点）→ 象鼻山观景点（地图上点景点印章 →「标记导航」用的就是这两个站位）
const FROM = [-478,-182], TARGET = {x:-685,z:1182,name:'象鼻山'}
// NAV_DEV=1 runs against the vite dev server (no rebuild while iterating)
const server = process.env.NAV_DEV
  ? await (await createServer({root:'web',configFile:'web/vite.config.ts',server:{host:'127.0.0.1',port:0}})).listen()
  : await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
const base = `http://127.0.0.1:${server.httpServer.address().port}`
const browser = await chromium.launch({executablePath:process.env.CHROMIUM,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']})
const results = {}
const errors = []

async function open(viewport,query='',mobile=false) {
  const context = await browser.newContext({viewport,deviceScaleFactor:1,isMobile:mobile,hasTouch:mobile})
  const page = await context.newPage()
  page.on('pageerror',error=>errors.push(error.message))
  await page.route('**/api/t',route=>route.fulfill({status:204}))
  await page.route('**/stats.rcpd.cc/**',route=>route.fulfill({status:204,body:''}))
  await page.goto(`${base}/?verify&mode=walk&flow=0&time=10${query}`,{waitUntil:'domcontentloaded',timeout:120000})
  await page.waitForFunction(()=>window.viewer?.walk?.active&&![1,2].includes(window.__loading?.level),null,{timeout:180000})
  // the atlas (and with it the map + nav hooks) loads ~2.5 s after the scene starts
  await page.waitForFunction(()=>window.viewer?.tour?.map,null,{timeout:120000})
  // Under heavy CPU load the first-ring stream can exceed the boot loader's patience on SwiftShader: the loader
  // shows 没能进入桂林 although walk mode is already running underneath (same on main). Hide only that test
  // artefact so screenshots show the scene.
  await page.addStyleTag({content:'#boot{display:none!important}'})
  // portrait phones get the 横过手机 gate once the HUD is up: take 竖屏继续
  if(mobile) await page.locator('.rotate-skip').click({timeout:15000}).catch(()=>{})
  return {page,context}
}
const state = page=>page.evaluate(()=>window.viewer.tour.nav.state())
async function enter(page,x,z,toward) {
  await page.evaluate(async ([x,z,tx,tz])=>{
    const {walk,stream} = window.viewer
    walk.leave()
    const yaw = Math.atan2(-(tx-x),-(tz-z))
    if(!await walk.enter(x,z,yaw,'nav-verify')) throw Error(`spawn failed at ${x},${z}`)
    for(let i=0;i<20;i++){stream.tick(walk.position); await new Promise(requestAnimationFrame)}
  },[x,z,toward[0],toward[1]])
}
const until = (page,fn,arg,timeout=60000)=>page.waitForFunction(fn,arg,{timeout,polling:100}).catch(async error=>{
  const dump = await page.evaluate(()=>{const s = window.viewer.tour.nav.state(), p = window.viewer.walk.position
    return {...s,route:s.route&&{...s.route,maneuvers:s.route.maneuvers.length},player:[p.x,p.z]}}).catch(()=>null)
  console.error('nav state at timeout:',JSON.stringify(dump)); throw error})

try {
  if(!process.env.NAV_SHOTS_ONLY){
  // ---------------- desktop: plan, geometry, toasts, recompute, cancel
  const {page,context} = await open({width:1440,height:900})
  await enter(page,...FROM,[TARGET.x,TARGET.z])
  const t0 = Date.now()
  await page.evaluate(t=>window.viewer.tour.map.setNavTarget(t),TARGET)
  await until(page,()=>window.viewer.tour.nav.state().route)
  let s = await state(page)
  results.plan = {ms:Date.now()-t0,length:Math.round(s.route.length),points:s.route.points,startGap:+s.route.startGap.toFixed(1),
    worker:{buildMs:Math.round(s.stats.buildMs),searchMs:+s.stats.searchMs.toFixed(1)},maneuvers:s.route.maneuvers.length}
  assert(s.route.length>1500&&s.route.length<4500,`walk route length ${s.route.length}`)
  // 首段贴近路网: the route starts on a road next to the player
  const first = await page.evaluate(()=>{const s = window.viewer.tour.nav.state(), p = window.viewer.walk.position
    return {gap:Math.hypot(s.route.first[0]-p.x,s.route.first[1]-p.z),road:window.viewer.tour.map.roadAt(s.route.first[0],s.route.first[1],4)}})
  assert(first.gap<30,`route starts ${first.gap} m from the player`)
  assert(first.road,'route start is not on a named road within 4 m')
  results.plan.firstGap = +first.gap.toFixed(1); results.plan.firstRoad = first.road.name
  // 3D route in the scene, heights resolved near the player
  await until(page,()=>window.viewer.tour.nav.state().scene.drawCount>0)
  s = await state(page)
  assert(s.scene.ribbon&&s.scene.arrow,'3D route objects missing from the scene')
  assert.equal(s.scene.navObjects,2)
  await until(page,()=>window.viewer.tour.nav.state().card?.left?.includes('剩'),null,30000)
  results.scene = s.scene
  // minimap draws the road polyline, not the straight line
  const path = await page.evaluate(()=>window.viewer.tour.nav.path()?.length/2)
  assert(path>=s.route.points-1,`minimap path has ${path} points`)

  // turn toast: stand 35 m before the first real turn that is ≥80 m into the route, facing along it
  const turn = s.route.maneuvers.find(m=>m.kind!=='arrive'&&m.at>80)
  assert(turn,'no turn on the route')
  const before = await page.evaluate(d=>{const r = window.viewer.tour.nav.state().route
    // reconstruct the point 35 m before the turn from the snapshot polyline via nav.path() at progress 0
    const pts = window.viewer.tour.nav.path(); let acc = 0
    for(let i=0;i+3<pts.length;i+=2){const l = Math.hypot(pts[i+2]-pts[i],pts[i+3]-pts[i+1]); if(acc+l>=d){const t = (d-acc)/l
      return {x:pts[i]+(pts[i+2]-pts[i])*t,z:pts[i+1]+(pts[i+3]-pts[i+1])*t,ax:pts[i+2],az:pts[i+3],len:r.length}} acc += l}
  },turn.at-35)
  await enter(page,before.x,before.z,[before.ax,before.az])
  await until(page,want=>window.viewer.tour.nav.state().lastToast.includes(want),turn.road||'前方')
  s = await state(page)
  assert.match(s.lastToast,/^前方 \d+ 米 /)
  results.turnToast = s.lastToast
  await page.waitForTimeout(400)
  await page.screenshot({path:`${outDir}/desktop-turn.png`})

  // off-route recompute + throttle (≥3 s between plans): leave the route twice in quick succession
  const recalcs0 = s.recalcs
  // two walkable spawn points well away from the route (spawn search would pull an arbitrary point back onto it):
  // 十字街, then back to 东西巷
  const offA = [-881,-165], offB = FROM
  await enter(page,...offA,[TARGET.x,TARGET.z])
  await until(page,n=>window.viewer.tour.nav.state().recalcs>n&&!window.viewer.tour.nav.state().pending,recalcs0)
  const recalcs1 = (await state(page)).recalcs
  await enter(page,...offB,[TARGET.x,TARGET.z])
  await until(page,n=>window.viewer.tour.nav.state().recalcs>n,recalcs1,20000)
  s = await state(page)
  const gaps = s.plans.slice(1).map((t,i)=>t-s.plans[i])
  results.recompute = {recalcs:s.recalcs-recalcs0,planGapsMs:gaps}
  assert(gaps.every(g=>g>=2990),`re-plan not throttled: ${gaps}`)

  // car route avoids pedestrian ways (class 3)
  await page.evaluate(t=>window.viewer.tour.nav.set(t,{mode:'car'}),TARGET)
  await until(page,()=>window.viewer.tour.nav.state().route?.mode==='car')
  s = await state(page)
  assert.equal(s.route.classes[3],0,`car route uses ${s.route.classes[3]} pedestrian segments`)
  results.car = {length:Math.round(s.route.length),classes:s.route.classes}

  // cancel: objects removed + card hidden + map target cleared
  await page.evaluate(()=>window.viewer.tour.map.setNavTarget(null))
  s = await state(page)
  assert(!s.target&&!s.scene.ribbon&&!s.scene.arrow&&s.scene.navObjects===0&&!s.card,'cancel left nav objects behind')
  assert.equal(await page.evaluate(()=>window.viewer.tour.map.navTarget),null)
  results.cancel = 'ok'

  // arrival: navigate to the turn point from 35 m away, then step onto it
  await enter(page,before.x,before.z,[before.ax,before.az])
  await page.evaluate(t=>window.viewer.tour.map.setNavTarget(t),{x:turn.x,z:turn.z,name:'测试点'})
  await until(page,()=>{const s = window.viewer.tour.nav.state(); return s.route||s.straight})
  await enter(page,turn.x,turn.z,[before.ax,before.az])
  await until(page,()=>!window.viewer.tour.nav.state().target,null,20000)
  s = await state(page)
  assert.match(s.lastToast,/已到达/)
  assert.equal(s.scene.navObjects,0)
  results.arrive = s.lastToast
  await context.close()
  console.log(JSON.stringify(results,null,2))
  }

  // ---------------- screenshots with the route ahead: desktop (default + street HUD) and phone portrait
  for(const [name,viewport,query,mobile] of [['desktop',{width:1440,height:900},'',false],['desktop-street',{width:1440,height:900},'&hud=street',false],['phone',{width:375,height:812},'',true]].filter(([n])=>!process.env.NAV_SHOT||n===process.env.NAV_SHOT)){
    const {page,context} = await open(viewport,query,mobile)
    await enter(page,...FROM,[TARGET.x,TARGET.z])
    await page.evaluate(t=>window.viewer.tour.map.setNavTarget(t),TARGET)
    await until(page,()=>{const s = window.viewer.tour.nav.state(); return s.route&&s.scene.drawCount>0})
    // face along the route and step ~25 m before the first turn so the toast + card are on screen
    const p = await page.evaluate(()=>{const s = window.viewer.tour.nav.state()
      if(!s.route) throw Error('route vanished: '+JSON.stringify({...s,route:null}))
      const m = s.route.maneuvers.find(m=>m.kind!=='arrive'&&m.at>60)
      const pts = window.viewer.tour.nav.path(); let acc = 0, d = m.at-28
      for(let i=0;i+3<pts.length;i+=2){const l = Math.hypot(pts[i+2]-pts[i],pts[i+3]-pts[i+1]); if(acc+l>=d){const t = (d-acc)/l
        return {x:pts[i]+(pts[i+2]-pts[i])*t,z:pts[i+1]+(pts[i+3]-pts[i+1])*t,ax:pts[i+2],az:pts[i+3]}} acc += l}})
    await enter(page,p.x,p.z,[p.ax,p.az])
    await until(page,()=>window.viewer.tour.nav.state().lastToast.startsWith('前方'))
    await page.waitForTimeout(250)
    await page.screenshot({path:`${outDir}/${name}.png`})
    await context.close()
  }
  assert.deepEqual(errors.filter(e=>!/WebGL|GPU|favicon/.test(e)),[],`page errors: ${errors.join('\n')}`)
  console.log('verify-nav: PASS')
} finally {
  await browser.close()
  if(server.close) await server.close(); else await new Promise(resolve=>server.httpServer.close(resolve))
}
