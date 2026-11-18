import {execFileSync} from 'node:child_process'
import {chromium} from 'playwright'
import {preview} from 'vite'

const source = `import json,numpy as np,sys
sys.path.insert(0,'pipeline/landmarks')
from diecai import mountain,trail
rings,tip=mountain('明月峰');point=trail(rings,tip)
print(json.dumps([point(f).tolist() for f in np.linspace(0,1,471)]))`
const route=JSON.parse(execFileSync('uv',['run','--locked','python','-c',source]))
const server=await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
let browser
try {
  browser=await chromium.launch({executablePath:process.env.CHROMIUM,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']})
  const page=await browser.newPage({viewport:{width:480,height:270}})
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?verify&mode=walk&radius=256`)
  await page.waitForFunction(()=>window.viewer?.walk?.active)
  const result=await page.evaluate(async(points)=>{
    const {walk,stream,manifest,camera}=window.viewer
    const [x,y,z]=manifest.landmarks.find(item=>item.id==='diecai').position
    const targets=points.map(([a,b,c])=>[x+a,y+b,z+c]);const gate=targets[0]
    walk.leave();camera.position.set(gate[0],gate[1]+6,gate[2]);
    while(![...stream.landmarks.keys()].some(item=>item.id==='diecai'))await new Promise(requestAnimationFrame)
    const dx=gate[0]-targets[2][0],dz=gate[2]-targets[2][2],len=Math.hypot(dx,dz)
    if(!await walk.enter(gate[0]+dx/len*6,gate[2]+dz/len*6,0,'mountain-gate'))throw Error('no trailhead spawn')
    const start=walk.probe();let traveled=0;const checkpoints=[]
    for(const [index,[east,level,south]] of targets.entries()){
      let reached=false
      for(let attempt=0;attempt<150;attempt++){
        const before=walk.probe(),dx=east-before.x,dz=south-before.z,gap=Math.hypot(dx,dz)
        if(gap<.85 && Math.abs(before.foot-level)<1.2){reached=true;break}
        walk.drive(dx/Math.max(.4,gap),dz/Math.max(.4,gap),false);walk.tick(.09)
        const after=walk.probe();traveled+=Math.hypot(after.x-before.x,after.z-before.z)
      }
      if(!reached)return {passed:false,index,target:[east,level,south],start,stop:walk.probe(),traveled,checkpoints}
      if([0,151,197,470].includes(index))checkpoints.push({index,foot:walk.probe().foot})
    }
    walk.drive(0,0);const end=walk.probe();return {passed:end.resets===start.resets,start,end,traveled,checkpoints}
  },route)
  console.log(JSON.stringify(result));if(!result.passed)process.exitCode=1
} finally {await browser?.close();await server.close()}
