import {evidencePath} from './photo-refs.mjs'
const evidence1 = evidencePath('refs/rock/photo-locations.json')
if (!evidence1) process.exit(0)
import {chromium} from 'playwright'
import {preview} from 'vite'
import {mkdir, readFile} from 'node:fs/promises'
import {gunzipSync} from 'node:zlib'

const out=process.env.CAPTURES??'captures/ronghu-survey'
await mkdir(out,{recursive:true})
const photos=JSON.parse(await readFile(evidence1))
const world=JSON.parse(await readFile('dist/world/manifest.json'))
const server=await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:0}})
let browser
try {
  browser=await chromium.launch({executablePath:process.env.CHROMIUM,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']})
  const page=await browser.newPage({viewport:{width:768,height:576}})
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?verify&time=12&radius=256`)
  await page.waitForFunction(()=>window.viewer?.stats.firstMs>0)
  for(const number of (process.env.PHOTO??'overview,1338,1314,1317,1332,1323,1307').split(',')){
    let eye=[-1350,249,310],target=[-1450,154,112],fov=55
    if(number!=='overview'){
      const {x,z,heading,focal35}=photos[`IMG_${number}.jpg`]
      const tile=world.chunks.find(t=>x>=t.x&&z>=t.z&&x<t.x+256&&z<t.z+256)
      const terrain=gunzipSync(await readFile(`dist/world/${tile.file}`))
      const height=terrain.readInt16LE(24+2*(Math.round((z-tile.z)/4)*65+Math.round((x-tile.x)/4)))/10+1.5
      const radians=heading*Math.PI/180
      eye=[x,height,z];target=[x+Math.sin(radians),height,z-Math.cos(radians)]
      fov=2*Math.atan(18/(focal35*4/3))*180/Math.PI
    }
    await page.evaluate(({eye,target,fov})=>{const {camera}=window.viewer;camera.position.set(...eye);camera.lookAt(...target);camera.fov=fov;camera.updateProjectionMatrix()},{eye,target,fov})
    await page.waitForFunction(()=>{const {stream,manifest,camera}=window.viewer;return [...stream.landmarks.keys()].filter(e=>['gunanmen','ronghu'].includes(e.id)).length===2&&manifest.chunks.every(t=>Math.hypot(t.x+128-camera.position.x,t.z+128-camera.position.z)>stream.radius||stream.loaded.has(t))},null,{timeout:90000})
    await page.evaluate(()=>window.viewer.freeze())
    try {await page.screenshot({path:`${out}/${number}.jpg`,quality:90})} finally {await page.evaluate(()=>window.viewer.resume())}
  }
} finally {await browser?.close();await server.close()}
