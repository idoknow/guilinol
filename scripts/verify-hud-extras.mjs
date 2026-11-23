// HUD 四件套（IDOK-172）：帧率/网速/在线人数读数 + 设置面板（读数开关、改键、第一/第三人称）。
// 需要先构建 dist：npm run build（vite preview 服务的是 dist，不是源码）。
import assert from 'node:assert/strict'
import {preview} from 'vite'
import {chromium} from 'playwright'
import {telemetryPreview} from './telemetry-preview.mjs'

const ONLINE = 37
const server = await preview({plugins:[telemetryPreview],root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
const base = `http://127.0.0.1:${server.httpServer.address().port}`
let browser
try {
  browser = await chromium.launch({executablePath:process.env.CHROMIUM,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']})
  const context = await browser.newContext({viewport:{width:900,height:600}})
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error=>errors.push(error.message))
  await page.route('**/api/t', route=>route.fulfill({status:204}))
  await page.route('**/favicon.ico', route=>route.fulfill({status:204}))
  // 本地没有 Postgres，用固定值代替在线人数接口。
  await page.route('**/api/live', route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({online:ONLINE})}))

  await page.goto(`${base}/?verify&mode=walk&flow=0`,{waitUntil:'domcontentloaded',timeout:120000})
  await page.waitForFunction(()=>window.viewer?.walk?.active,null,{timeout:120000})
  // 真实玩家先点一下画面才进操控；headless 里同样先点，避免第一次按键被当成「还没开始」。
  await page.locator('canvas').first().click({position:{x:450,y:300}})

  // ① 三段读数：帧率要等半秒窗口，网速要等一秒聚合，在线人数来自 /api/live。
  await page.waitForFunction(()=>{
    const chip = document.querySelector('.hud-stats')
    return !!chip && !chip.hidden && /^\d+ FPS$/.test(chip.querySelector('.hud-stat--fps').textContent.trim())
  },null,{timeout:20000})
  const readStats = () => page.evaluate(()=>{
    const chip = document.querySelector('.hud-stats')
    const pick = selector => {
      const node = document.querySelector(selector)
      return {hidden:node.hidden,text:node.textContent.trim()}
    }
    return {chipHidden:chip.hidden,
      fps:pick('.hud-stat--fps'),net:pick('.hud-stat--net'),online:pick('.hud-stat--online')}
  })
  const stats = await readStats()
  assert.ok(!stats.chipHidden,'the stats chip is visible by default')
  assert.match(stats.fps.text,/^\d+ FPS$/,'fps tile prints a frame rate')
  assert.match(stats.net.text,/^(?:\d+ (?:B|KB|MB)|[\d.]+ MB)\/s$/,'net tile prints a transfer rate')
  assert.equal(stats.online.text,`在线 ${ONLINE}`,'online tile shows the presence count')

  // ② F3 一键隐藏 / 恢复：三格全关时整条不显示。
  await page.keyboard.press('F3')
  await page.waitForFunction(()=>document.querySelector('.hud-stats').hidden,null,{timeout:5000})
  assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('glol.prefs')).stats),
    {fps:false,net:false,online:false},'F3 remembers all three tiles off')
  await page.keyboard.press('F3')
  await page.waitForFunction(()=>!document.querySelector('.hud-stats').hidden,null,{timeout:5000})

  // ③ 设置面板：只关掉帧率，网速仍在。
  await page.evaluate(()=>document.querySelector('.dock-settings').click())
  await page.waitForSelector('.about-panel.settings',{state:'visible',timeout:10000})
  await page.evaluate(()=>document.querySelector('[data-stat=fps]').click())
  await page.waitForFunction(()=>document.querySelector('.hud-stat--fps').hidden,null,{timeout:5000})
  const partial = await readStats()
  assert.equal(partial.net.hidden,false,'only the fps tile is hidden')
  assert.equal(partial.chipHidden,false,'the chip stays while any tile shows')
  await page.evaluate(()=>document.querySelector('[data-stat=fps]').click())

  // ④ 改键：把「前进」从 W 换成 I，W 立刻失效、I 生效。
  await page.evaluate(()=>document.querySelector('.set-key[data-action=forward]').click())
  await page.keyboard.press('i')
  const rebound = await page.evaluate(()=>document.querySelector('.set-key[data-action=forward]').textContent.trim())
  assert.equal(rebound,'I','the forward binding shows the new key')
  await page.keyboard.press('Escape')
  await page.waitForFunction(()=>document.querySelector('.about-mask').hidden,null,{timeout:5000})

  const pos = () => page.evaluate(()=>{
    const p = window.viewer.walk.position
    return {x:p.x,z:p.z}
  })
  // 手动 tick：headless 软渲染下按键按住一秒也只走一两帧，这里直接把仿真推进 1 秒。
  const walkFor = async (code, ticks=10) => {
    const before = await pos()
    if (code) await page.keyboard.down(code)
    await page.evaluate(count=>{for(let i=0;i<count;i++)window.viewer.walk.tick(.1)},ticks)
    if (code) await page.keyboard.up(code)
    const after = await pos()
    return Math.hypot(after.x-before.x,after.z-before.z)
  }
  const idle = await walkFor('KeyY')
  assert.ok(idle<0.06,`the walker stays put when no action key is held (drift ${idle.toFixed(2)}m)`)
  const staleKey = await walkFor('KeyW')
  assert.ok(staleKey<0.06,`W no longer walks once forward is rebound (moved ${staleKey.toFixed(2)}m)`)
  const newKey = await walkFor('KeyI')
  assert.ok(newKey>0.8,`the new key walks (moved ${newKey.toFixed(2)}m)`)

  // 恢复默认，后面的人按 W 还能走。
  await page.evaluate(()=>document.querySelector('.dock-settings').click())
  await page.waitForSelector('.about-panel.settings',{state:'visible',timeout:10000})
  await page.evaluate(()=>document.querySelector('.set-reset').click())
  const restored = await page.evaluate(()=>document.querySelector('.set-key[data-action=forward]').textContent.trim())
  assert.match(restored,/W/,'resetting restores the W binding')
  await page.keyboard.press('Escape')

  // ⑤ 第一/第三人称：第一人称相机贴着眼睛，第三人称退到身后几米。
  const camDist = () => page.evaluate(()=>window.viewer.walk.probe().camDist)
  const third = await camDist()
  assert.ok(third>1,`third person keeps the camera behind the figure (${third.toFixed(2)}m)`)
  await page.evaluate(()=>document.querySelector('.dock-view').click())
  await page.waitForFunction(()=>document.querySelector('.dock-view').textContent.trim()==='第一人称',null,{timeout:5000})
  await page.waitForFunction(()=>window.viewer.walk.probe().camDist<0.2,null,{timeout:15000})
  const first = await camDist()
  assert.ok(first<0.2,`first person sits on the eyes (${first.toFixed(2)}m)`)
  assert.equal(await page.evaluate(()=>window.viewer.walk.probe().camDist),first,'first person stays on the eyes')
  // 第一人称必须朝前看：按前进走出去的方向要和镜头水平朝向一致（之前的版本镜头朝身后）。
  const look = await page.evaluate(()=>{const c=window.viewer.camera;const d=new c.position.constructor();c.getWorldDirection(d);return {x:d.x,y:d.y,z:d.z}})
  const from = await pos()
  await page.keyboard.down('KeyW')
  await page.evaluate(()=>{for(let i=0;i<10;i++)window.viewer.walk.tick(.1)})
  await page.keyboard.up('KeyW')
  const to = await pos()
  const mx=to.x-from.x, mz=to.z-from.z
  const facing=(mx*look.x+mz*look.z)/Math.max(1e-6,Math.hypot(mx,mz)*Math.hypot(look.x,look.z))
  assert.ok(facing>0.9,`first person looks where W walks (cos ${facing.toFixed(2)})`)
  assert.ok(Math.abs(look.y)<0.2,`first person defaults to a level gaze (dir.y ${look.y.toFixed(2)})`)
  await page.evaluate(()=>document.querySelector('.dock-view').click())
  await page.waitForFunction(()=>document.querySelector('.dock-view').textContent.trim()==='第三人称',null,{timeout:5000})
  await page.waitForFunction(()=>window.viewer.walk.probe().camDist>1,null,{timeout:15000})
  const back = await camDist()
  assert.ok(back>1,`toggling back restores the third-person pull-back (${back.toFixed(2)}m)`)

  // ⑥ 刷新后设置仍然生效（localStorage 持久化）。
  await page.evaluate(()=>document.querySelector('.dock-view').click())
  await page.reload({waitUntil:'domcontentloaded',timeout:120000})
  await page.waitForFunction(()=>window.viewer?.walk?.active,null,{timeout:120000})
  await page.waitForFunction(()=>document.querySelector('.dock-view')?.textContent.trim()==='第一人称',null,{timeout:15000})
  assert.ok(await page.evaluate(()=>window.viewer.walk.probe().camDist<0.2),'the view mode survives a reload')

  assert.deepEqual(errors,[],'the HUD extras must not throw')
  console.log('HUD stats, settings panel, rebinding and first/third person passed')
} finally {
  await browser?.close()
  await server.close()
}
