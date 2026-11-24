import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {chromium} from 'playwright'
import {preview} from 'vite'
import {browserOptions} from './qa-browser.mjs'

const [reportPath,output,limit] = process.argv.slice(2)
const {crossings} = JSON.parse(await readFile(reportPath))
const chosen = crossings.slice().sort((a,b)=>Math.floor(a.z/256)-Math.floor(b.z/256)||a.x-b.x)
const cases=limit ? chosen.slice(0,Number(limit)) : chosen
await mkdir(output,{recursive:true})
const server=await preview({configFile:false,build:{outDir:resolve(process.env.RAILWAY_DIST??'dist')},preview:{host:'127.0.0.1',port:0}})
let browser
try {
  browser=await chromium.launch(browserOptions(true))
  const page=await browser.newPage({viewport:{width:1024,height:640}})
  const errors=[]
  page.on('pageerror',err=>errors.push(err.message))
  page.on('console',msg=>{if(msg.text().includes('Shader Error'))errors.push(msg.text())})
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?verify&mode=fly&radius=256&time=12&flow=0`)
  await page.waitForFunction(()=>window.viewer?.stats.firstMs>0)
  const index=[]
  for(const [i,row] of cases.entries()){
    await page.evaluate(({x,z,east,south,roadY,railY,type,view})=>{
      const {camera,stream}=window.viewer
      if(view==='distant')camera.position.set(x-72,Math.max(roadY,railY)+32,z+68)
      else if(type==='level')camera.position.set(x-east*4-south*2,roadY+6,z-south*4+east*2)
      else camera.position.set(x-east*14-south*9,Math.max(roadY,railY)+8,z-south*14+east*9)
      camera.lookAt(x,(roadY+railY)/2,z)
      stream.prioritize(x,z)
    },row)
    await page.waitForFunction(({x,z})=>{
      const {stream,manifest}=window.viewer
      const tile=manifest.chunks.find(t=>x>=t.x&&x<t.x+256&&z>=t.z&&z<t.z+256)
      return stream.loaded.has(tile)
    },row,{timeout:45000})
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))
    const file=`${row.sharedNode??i+1}-${row.rail}-${row.road}.jpg`
    await page.screenshot({path:join(output,file),quality:84})
    index.push({...row,file})
    if(errors.length)throw Error(errors[0])
    if(i%50===0)console.log('Captured',i+1,'/',cases.length)
  }
  await writeFile(join(output,'index.json'),JSON.stringify(index,null,2))
}finally{await browser?.close();await server.close()}
