// Run from the repository root with a compiled client and its world package.
import assert from 'node:assert/strict'
import {readFile, writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {chromium} from 'playwright'
import {preview} from 'vite'
import {browserOptions} from './qa-browser.mjs'

const [dist = 'dist', output = 'guilinbei-walk.json'] = process.argv.slice(2)
const osm = JSON.parse(await readFile('raw/osm-2026-11.json', 'utf8')).elements
const at = ({lon, lat}) => [(lon-110.3)*111320*Math.cos(25.28*Math.PI/180), (25.28-lat)*110574]
const pathOf = (id) => osm.find(w => w.type === 'way' && w.id === id).geometry.map(at)
const main = pathOf(1332733828)
const branch = pathOf(1332733829)
const distance = (a,b) => Math.hypot(a[0]-b[0], a[1]-b[1])
const advance = (a,b,d) => a.map((v,i) => v + (b[i]-v)*d/distance(a,b))
function bridgeFromWest(id) {
  const points = pathOf(id)
  if (points[0][0] > points.at(-1)[0]) points.reverse()
  return [advance(points[0], points[1], -8), ...points]
}
const north = bridgeFromWest(617221278), south = bridgeFromWest(617221279)
const route = [...north, ...main.slice(1,-1).reverse(), ...south.toReversed()]
const junction = route.findIndex(p => distance(p,branch[0]) < .01)
assert(junction > 0)
const terminal = advance(branch.at(-1), branch.at(-2), .72)
const outward = [...route.slice(0,junction), ...branch.slice(0,-1), terminal]
const cases = [
  ['north-to-south',route], ['south-to-north',route.toReversed()],
  ['terminal-return',[...outward,...outward.slice(0,-1).reverse()]],
]
const server = await preview({configFile:false,build:{outDir:resolve(dist)},preview:{host:'127.0.0.1',port:0}})
const browser = await chromium.launch(browserOptions(true))
const results = []
try {
  for (const [name,points] of cases) {
    const page = await browser.newPage({viewport:{width:1000,height:650}})
    await page.goto('http://127.0.0.1:'+server.httpServer.address().port+'/?verify&mode=walk&radius=384&flow=0&time=12')
    await page.waitForFunction(() => window.viewer?.walk?.active,null,{timeout:90000})
    const result = await page.evaluate(async ({points,terminal}) => {
      const {walk,stats} = window.viewer
      walk.leave()
      if (!await walk.enter(...points[0],0,'Guilin North west entrance')) throw Error('Could not enter at west landing')
      for (let frame=0; frame<600; frame++) {
        await new Promise(requestAnimationFrame)
        if (frame>55 && stats.loaded && !stats.pending) break
      }
      await window.viewer.freeze()
      const trace=[], contacts=[]
      let probe=walk.probe(), maxFootStep=0
      const resets=probe.resets
      function move(dx,dz) {
        const before=probe.foot
        walk.drive(dx,dz,false)
        walk.tick(.05)
        probe=walk.probe()
        maxFootStep=Math.max(maxFootStep,Math.abs(probe.foot-before))
        if (maxFootStep>.16 || probe.resets!==resets || probe.inHouse || probe.wet) {
          throw Error('Lost safe support at '+JSON.stringify([probe.x,probe.foot,probe.z,maxFootStep]))
        }
      }
      function reach([x,z]) {
        for(let tick=0; tick<2400; tick++){
          const dx=x-probe.x,dz=z-probe.z,len=Math.hypot(dx,dz)
          if (len<.18) return
          move(dx/len,dz/len)
          if(tick%8===0) trace.push([probe.x,probe.foot,probe.z])
        }
        throw Error('Blocked walking to '+[x,z])
      }
      for(let i=1;i<points.length;i++){
        const point=points[i]
        reach(point)
        if(terminal && Math.hypot(point[0]-terminal[0],point[1]-terminal[1])<.01){
          const vx=point[0]-points[i-1][0],vz=point[1]-points[i-1][1],l=Math.hypot(vx,vz)
          for(const [dx,dz] of [[vx/l,vz/l],[-vz/l,vx/l],[vz/l,-vx/l]]){
            let hit=false
            for(let k=0;k<70;k++){
              move(dx,dz)
              hit ||= probe.contactSources.some(c=>c?.source==='building' && Math.abs(c.normal.y)<.2)
              if(Math.hypot(probe.x-point[0],probe.z-point[1])>1.65)throw Error('Escaped terminal platform')
            }
            if(!hit)throw Error('Missing terminal wall')
            contacts.push([probe.x,probe.foot,probe.z])
            reach(point)
          }
        }
      }
      return {trace,maxFootStep,terminalWallContacts:contacts}
    },{points,terminal:name==='terminal-return'?terminal:null})
    results.push({name,...result})
    await writeFile(output,JSON.stringify(results))
    console.log(name,result.trace.length,result.maxFootStep,result.terminalWallContacts.length)
    await page.close()
  }
} finally {
  await browser.close()
  await server.close()
}
