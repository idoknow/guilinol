import {resolve,join} from 'node:path'
import {readFile} from 'node:fs/promises'
import {gzipSync} from 'node:zlib'
import {preview} from 'vite'
import {chromium} from 'playwright'
import assert from 'node:assert/strict'

const dirs=process.argv.slice(2).map(dir=>resolve(dir));assert.equal(dirs.length,2,'pass baseline and candidate dist directories')
const samples=[[],[]],sizes=[],servers=[];let browser
try{
  for(const dir of dirs){const html=await readFile(join(dir,'index.html'),'utf8');const paths=[...new Set(Array.from(html.matchAll(/(?:src|href)="(\/assets\/[^"?]+\.(?:css|js))"/g),match=>match[1]))];sizes.push((await Promise.all(paths.map(async path=>gzipSync(await readFile(join(dir,path))).length))).reduce((a,b)=>a+b,gzipSync(html).length));servers.push(await preview({root:dir,configFile:false,build:{outDir:dir},preview:{host:'127.0.0.1',port:0}}))}
  browser=await chromium.launch({executablePath:process.env.CHROMIUM,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']})
  for(const side of [0,1,1,0,0,1,1,0,0,1,1,0,0,1,1,0,0,1]){const page=await browser.newPage({viewport:{width:480,height:270}});try{
    await page.goto(`http://127.0.0.1:${servers[side].httpServer.address().port}/?verify&mode=walk&flow=0`,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.viewer?.stats.firstMs>0,null,{timeout:90000});samples[side].push(await page.evaluate(()=>window.viewer.stats.firstMs))
  }finally{await page.close()}}
  const med=samples.map(values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)]);console.log(JSON.stringify({samples,medianMs:med,deltaMs:med[1]-med[0],entryGzipBytes:sizes,deltaBytes:sizes[1]-sizes[0]}));assert.ok(med[1]-med[0]<=100);assert.ok(sizes[1]-sizes[0]<=40*1024)
}finally{await browser?.close();await Promise.all(servers.map(server=>server.close()))}
