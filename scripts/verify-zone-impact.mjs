import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {gunzipSync, gzipSync} from 'node:zlib'
import {preview} from 'vite'
import {chromium} from 'playwright'
import {browserOptions} from './qa-browser.mjs'

const baked = JSON.parse(gunzipSync(await readFile('dist/world/vehicles.bin')))
const fixtures = {quiet:[-1045.15,157.5,-498.09,1.2661,0],carFree:[-593.98,157.1,-94.94,1.7968,0]}
const server = await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
const browser = await chromium.launch(browserOptions())
try {
  for (const [zone, start] of Object.entries(fixtures)) for (const kind of process.argv.slice(2)) {
    const page = await browser.newPage()
    try {
      const fixture = {...baked,cars:[],bikes:[],sharedBikes:[],bicycles:[],[{car:'cars',bike:'bikes',bicycle:'bicycles'}[kind]]:[start]}
      await page.route('**/world/vehicles.bin', route => route.fulfill({body:gzipSync(JSON.stringify(fixture))}))
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?verify&mode=walk&flow=0`)
      await page.waitForFunction(()=>window.viewer?.walk?.active)
      assert(await page.evaluate(([east,,south]) => window.viewer.walkTo(east,south,0,'zone-impact'), start))
      const label = {car:'开车',bike:'骑电动车',bicycle:'骑单车'}[kind]
      await page.waitForFunction(label=>document.querySelector('.vehicle-action:not([hidden])')?.textContent===label,label)
      await page.keyboard.press('f')
      await page.waitForFunction(kind=>window.viewer.walk.vehicle===kind,kind)
      const result = await page.evaluate(({kind,start})=>{
        const {walk,game}=window.viewer
        if (kind!=='car') {walk.ebike.setPark(false,true);walk.ebike.setKickstand(false,true)}
        const from=walk.position.clone()
        window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyW'}))
        let contact=null, contacts=0, maxDrift=0
        try {
          for(let frame=0;frame<600;frame++) {
            walk.tick(1/60)
            const position=walk.position, zone=game.getState().zone
            if(zone.quiet || zone.carFree) throw Error(`crossed into ${JSON.stringify(zone)} at ${position.toArray()}`)
            if(walk.obstacle==='restricted') {contact??=position.clone();contacts++}
            if(contact) maxDrift=Math.max(maxDrift,Math.hypot(position.x-contact.x,position.z-contact.z))
          }
        } finally {window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyW'}))}
        return {start,from:from.toArray(),end:walk.position.toArray(),contacts,maxDrift,obstacle:walk.obstacle}
      }, {kind,start})
      console.log(zone,kind,result)
      assert(result.contacts>0 && result.maxDrift<.25,`${zone} ${kind}: must hit forbidden boundary and stay outside under throttle`)
      assert(Math.hypot(result.end[0]-result.from[0],result.end[2]-result.from[2])>1,'vehicle never approached boundary')
    } finally { await page.close() }
  }
} finally {await browser.close();await server.close()}
