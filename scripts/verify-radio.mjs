import assert from 'node:assert/strict'
import {createServer} from 'vite'
import {chromium} from 'playwright'
import {browserOptions} from './qa-browser.mjs'

const server=await createServer({root:'web',configFile:'web/vite.config.ts',server:{host:'127.0.0.1',port:0}})
let browser
try {
  await server.listen()
  browser=await chromium.launch(browserOptions())
  const page=await browser.newPage({isMobile:true,hasTouch:true,viewport:{width:412,height:780}})
  await page.addInitScript(()=>{
    window.Audio=class extends Audio {constructor(){super(); window.radioElement=this}}
    window.AudioContext=class extends AudioContext {createGain(){return window.radioGain=super.createGain()}}
  })
  const requests=[]
  page.on('request',request=>{if(request.url().includes('/audio/radio/')) requests.push(request.url())})
  await page.route('**/radio-test.html',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<button>电台</button>
    <script type="module">import {openRadio} from '/src/radio/panel.ts';import {updateTravel} from '/src/game/state.ts';
    window.travel=updateTravel;document.querySelector('button').onclick=openRadio</script>`}))
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/radio-test.html`)
  await page.getByRole('button',{name:'电台'}).click()
  await page.getByRole('button',{name:'开启播放'}).click()
  assert.equal(requests.length,0)
  const ride=aboard=>page.evaluate(aboard=>window.travel(aboard?'car':'foot',aboard?{kind:'car',id:'test',gear:'D',speedKmh:0,damage:0}:null),aboard)
  const playing=file=>page.waitForFunction(file=>window.radioElement.currentSrc.endsWith(file) && !window.radioElement.paused && window.radioElement.currentTime>.05 && window.radioGain.context.state==='running',file)
  const paused=()=>page.waitForFunction(()=>window.radioElement.paused)
  const finish=()=>page.evaluate(()=>{window.radioElement.currentTime=window.radioElement.duration-.15})
  await ride(true); await playing('bridge-wind.mp3')
  await finish(); await playing('boat-lights.mp3')
  await page.getByRole('slider').fill('23')
  assert.ok(Math.abs(await page.evaluate(()=>window.radioGain.gain.value)-.23)<.001)
  await page.getByRole('combobox').selectOption('1'); await playing('scooter-bell.mp3')
  await finish(); await playing('morning-stall.mp3')
  await ride(false); await paused()
  await page.getByRole('checkbox').check(); await playing('morning-stall.mp3')
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))})
  await paused()
  await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'))})
  await playing('morning-stall.mp3')
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide'))); await paused()
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow'))); await playing('morning-stall.mp3')
  await page.getByRole('button',{name:'关闭播放'}).click(); await paused()
  console.log('Four tracks decoded; tuning, advance, gain, vehicle, portable and page lifecycle passed')
} finally {await browser?.close(); await server.close()}
