import assert from 'node:assert/strict'
import {resolve} from 'node:path'
import {mkdir,writeFile} from 'node:fs/promises'
import {createServer} from 'vite'
import {chromium} from 'playwright'
import {browserOptions} from './qa-browser.mjs'

const server=await createServer({root:'web',configFile:'web/vite.config.ts',server:{host:'127.0.0.1',port:0}})
let browser
try {
  await server.listen()
  browser=await chromium.launch(browserOptions())
  const page=await browser.newPage()
  await page.route('**/contact-check',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Contact audit</title>'}))
  await page.goto(server.resolvedUrls.local[0]+'contact-check')
  const shots=process.env.CONTACT_SHOTS
  if(shots){await mkdir(shots,{recursive:true});await page.exposeFunction('saveContact',async(name,png)=>writeFile(resolve(shots,name+'.png'),Buffer.from(png.split(',')[1],'base64')))}
  const rows=await page.evaluate(async ([path,baseline])=>(await import(path)).audit(baseline),['/@fs/'+resolve('scripts/npc-contact-scene.mjs'),process.argv.includes('--baseline')])
  console.table(rows)
  for(const body of ['saloon','mini','coupe','sport'])assert.equal(new Set(rows.filter(row=>row.name===body).map(row=>row.site)).size,7,body)
  if(process.env.CONTACT_REPORT)await writeFile(process.env.CONTACT_REPORT,JSON.stringify(rows,null,2)+'\n')
  assert.ok(rows.length&&rows.every(row=>row.pass),'NPC contact exceeded tolerance (metres)')
} finally {await browser?.close();await server.close()}
