import assert from 'node:assert/strict'
import {createServer} from 'vite'
import {chromium} from 'playwright'
import {traceRoutes} from '../server/trace-routes.mjs'
const vite=await createServer({root:'web',configFile:false,server:{host:'127.0.0.1',port:0}})
await vite.listen()
const root=`http://127.0.0.1:${vite.httpServer.address().port}`
const browser=await chromium.launch({args:['--no-sandbox','--enable-unsafe-swiftshader']})
try {
  const page=await browser.newPage({viewport:{width:1024,height:768}})
  const uid=123456,routes=traceRoutes({query:async()=>({rows:[]})},{TRACE_SECRET:'local-fixture'})
  const tile=Buffer.from(await (await routes.traceTile(uid)).arrayBuffer());let count=0,guest=true
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname
    if(path==='/api/trace/tile'){count++;return route.fulfill({body:tile,contentType:'image/png'})}
    if(path==='/api/me'&&guest)return route.fulfill({status:401,json:{}})
    if(path==='/api/admin/trace')return route.fulfill({json:await decode(route.request().postDataBuffer())})
    return route.fulfill({json:path==='/api/me'?{uid,role:'admin',id:'test',nickname:'测试'}:{}})
  })
  async function decode(body){return (await routes.traceAdmin('admin/trace',new Request(root,{method:'POST',body}),'actor')).json()}
  await page.goto(root+'/backpack.html');await page.getByText('请先登录后查看背包').waitFor();assert.equal(count,0)
  guest=false;await page.goto(root+'/admin/?view=security');await page.locator('[style*="blob:"]').waitFor();const shot=await page.screenshot()
  await page.locator('input[type=file]').setInputFiles({name:'fixture.png',mimeType:'image/png',buffer:shot});await page.getByText('识别截图',{exact:true}).click();await page.getByText('只封联机',{exact:true}).waitFor();assert.ok((await page.locator('body').innerText()).includes(`UID ${uid}`));console.log('guest, security DOM screenshot -> upload -> uid passed')
  await page.route('**/fixture.html',route=>route.fulfill({contentType:'text/html',body:'<style>*{margin:0}</style><body></body>'}));await page.goto(root+'/fixture.html')
  await page.evaluate(async()=>{
    const code=await (await fetch('/src/session-mark-pass.ts')).text(); const THREE=await import(code.match(/import \* as THREE from "([^"]+)"/)[1]);const {sessionMarkPass}=await import('/src/session-mark-pass.ts'),{markSession,onTile}=await import('/src/session-mark.ts');const renderer=new THREE.WebGLRenderer({preserveDrawingBuffer:true});document.body.append(renderer.domElement);renderer.setSize(1024,768);renderer.setClearColor(0x579ab3);const draw=sessionMarkPass(renderer);markSession(123456);await new Promise(resolve=>onTile(tile=>{if(tile)resolve()}));renderer.clear();draw()
  });assert.equal((await decode(await page.screenshot())).uid,uid);console.log('WebGL screenshot -> uid passed')
}finally{await browser.close();await vite.close()}
