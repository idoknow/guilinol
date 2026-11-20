import {execFileSync} from 'node:child_process'
import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {preview} from 'vite'
const promenade=process.argv.includes('--promenade')
const corridor=process.argv.includes('--corridor')
const way=corridor?1531321914:promenade?1008909370:1008909368
const route=JSON.parse(execFileSync('uv',['run','--locked','python','-c',`import sys,json
sys.path.insert(0,'pipeline')
from features import points
from common import load_osm
print(json.dumps(points(next(entry for entry in load_osm() if entry['type']=='way' and entry['id']==${way}))))`]))
if(process.argv.includes('--reverse')) route.reverse()
const server=await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
let browser
try {
  browser=await chromium.launch({executablePath:process.env.CHROMIUM,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']})
  const page=await browser.newPage({viewport:{width:960,height:600}})
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?verify&mode=walk&radius=480`)
  await page.waitForFunction(()=>window.viewer?.walk?.active,null,{timeout:120000})
  await page.evaluate(async route=>{const {walk}=window.viewer;walk.leave();if(!await walk.enter(...route[0],0,'gallery'))throw Error('spawn')},route)
  await page.waitForFunction(()=>['xiaoyao_tower','zhuangyuan_gallery'].every(id=>[...window.viewer.stream.landmarks].some(([entry])=>entry.id===id)),null,{timeout:90000})
  const result=await page.evaluate(route=>{
    const {walk}=window.viewer;let distance=0,largestStep=0,low=Infinity,high=-Infinity
    for(const [x,z] of route){let reached=false,stuck=0
      for(let tick=0;tick<360;tick++){
        const start=walk.probe(),dx=x-start.x,dz=z-start.z
        if(Math.hypot(dx,dz)<.26){reached=true;break}
        walk.drive(dx*2,dz*2,false);walk.tick(.05)
        const end=walk.probe(),step=Math.hypot(end.x-start.x,end.z-start.z);distance+=step;largestStep=Math.max(largestStep,Math.abs(end.foot-start.foot));stuck=step<.005?stuck+1:0
        low=Math.min(low,end.foot);high=Math.max(high,end.foot)
        if(end.resets||end.inHouse||end.wet||stuck>15)break
      }
      if(!reached){walk.drive(0,0);return {reached:false,distance,largestStep,target:[x,z],end:walk.probe()}}
    }
    walk.drive(0,0);return {reached:true,distance,largestStep,rise:high-low}
  },route.concat(route.slice(0,-1).reverse()))
  console.log({way,...result})
  if(process.env.EYE_SHOT){
    await page.evaluate(next=>{const {walk,camera}=window.viewer;const {x,z,foot}=walk.probe();walk.leave();camera.position.set(x,foot+1.62,z);camera.lookAt(next[0],foot+1.62,next[1])},result.target??route[1])
    await page.waitForTimeout(350);await page.screenshot({path:process.env.EYE_SHOT})
  }
  assert(result.reached && result.largestStep<=.2)
  if(promenade) assert(result.distance>280)
  else if(corridor) assert(result.distance>82)
  else assert(result.distance>90 && result.rise>8)
}finally{await browser?.close();await server.close()}
