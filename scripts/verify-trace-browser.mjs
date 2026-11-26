import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {chromium} from 'playwright'
import {createServer} from 'vite'
import sharp from 'sharp'
import {browserOptions} from './qa-browser.mjs'
import {encodeTile} from '../server/trace-qim.mjs'
import {decodeImage} from '../server/trace-image.mjs'

const uid=620008,seconds=1800000000,key='local-browser-test',out=process.env.CAPTURES??'captures/trace'
await mkdir(out,{recursive:true})
const png=await sharp(encodeTile(uid,seconds,key),{raw:{width:512,height:512,channels:1}}).png().toBuffer()
const server=await createServer({root:'web',configFile:'web/vite.config.ts',server:{host:'127.0.0.1',port:0},logLevel:'error'})
let browser
try{
  await server.listen();const origin=`http://127.0.0.1:${server.httpServer.address().port}`
  browser=await chromium.launch(browserOptions());const page=await browser.newPage({viewport:{width:1280,height:776}})
  let authenticated=false,tiles=0
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());if(url.origin!==origin)return route.abort()
    if(url.pathname==='/api/me')return route.fulfill({status:authenticated?200:401,json:authenticated?{id:'qa',uid,nickname:'本地验收',role:'user'}:{}})
    if(url.pathname==='/api/trace/tile'){tiles++;return route.fulfill({body:png,contentType:'image/png'})}
    if(url.pathname.startsWith('/api/'))return route.fulfill({status:404,json:{}})
    return route.continue()
  })
  const capture=async(name,expected)=>{
    const shot=await page.screenshot({path:`${out}/${name}.png`}),image=await sharp(shot).greyscale().raw().toBuffer({resolveWithObject:true})
    const result=await decodeImage(image.data,image.info.width,image.info.height,key)
    console.log(name,result);assert.equal(result?.uid,expected?uid:undefined);if(expected)assert.equal(result.from,seconds)
  }
  await page.goto(origin+'/backpack.html');await page.getByText('请先登录后查看背包').waitFor();await capture('guest',false);assert.equal(tiles,0)
  authenticated=true;await page.reload();await page.locator('div[style*="blob:"]').waitFor();await capture('dom',true)
  await page.goto(origin+'/?verify');await page.waitForFunction(()=>window.viewer?.stats.firstMs>0,null,{timeout:120000});await page.locator('div[style*="blob:"]').waitFor()
  await page.evaluate(()=>{for(const layer of document.querySelectorAll('div[style*="blob:"]'))layer.remove();window.viewer.setPreset('lijiang')})
  await page.waitForFunction(()=>window.viewer.stats.frame>6);console.log('buffers',await page.locator('canvas').evaluateAll(nodes=>nodes.map(node=>[node.width,node.height,node.clientWidth,node.clientHeight])));assert.equal(await page.locator('div[style*="blob:"]').count(),0);await capture('webgl',true)
}finally{await browser?.close();await server.close()}
