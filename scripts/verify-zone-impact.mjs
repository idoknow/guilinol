import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {gunzipSync, gzipSync} from 'node:zlib'
import {preview} from 'vite'
import {chromium} from 'playwright'
import {browserOptions} from './qa-browser.mjs'
import {withFixtureBays} from './ride-fixture-bays.mjs'

const baked = JSON.parse(gunzipSync(await readFile('dist/world/vehicles.bin')))
const fixtures = {quiet:[-1045.15,157.5,-498.09,1.2661,0],carFree:[-597,157,-84.5,1.55,0]}
const server = await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
const browser = await chromium.launch(browserOptions())
try {
  for (const [zone, start] of Object.entries(fixtures)) for (const kind of process.argv.slice(2)) {
    const page = await browser.newPage()
    try {
      const fixture = {...(kind==='bike'?withFixtureBays(baked,[start]):baked),cars:[],bikes:[],sharedBikes:[],bicycles:[],[{car:'cars',bike:'bikes',bicycle:'bicycles'}[kind]]:[start]}
      if(zone==='carFree' && kind==='car'){
        const [left,top,width,,step]=fixture.motorGrid
        const bits=gunzipSync(Buffer.from(fixture.motorMask,'base64'))
        for(let east=-610;east<=-590;east+=step)for(let south=-90;south<=-78;south+=step){
          const cell=Math.round((south-top)/step)*width+Math.round((east-left)/step)
          bits[cell>>3]|=128>>(cell&7)
        }
        fixture.motorMask=gzipSync(bits).toString('base64')
      }
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
        let contacts=0, entered=null
        try {
          for(let frame=0;frame<600;frame++) {
            walk.tick(1/60)
            const position=walk.position, zone=game.getState().zone
            if(walk.obstacle==='restricted') contacts++
            if((zone.quiet || zone.carFree) && !entered) entered=position.toArray()
          }
        } finally {window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyW'}))}
        return {start,from:from.toArray(),end:walk.position.toArray(),contacts,entered,obstacle:walk.obstacle}
      }, {kind,start})
      console.log(zone,kind,result)
      // IDOK-236: no more car-free / quiet-zone gates — anything a vehicle can physically reach is drivable.
      assert(result.contacts===0 && result.entered,`${zone} ${kind}: must drive straight into the former no-vehicle zone`)
      assert(Math.hypot(result.end[0]-result.from[0],result.end[2]-result.from[2])>1,'vehicle never approached boundary')
    } finally { await page.close() }
  }
} finally {await browser.close();await server.close()}
