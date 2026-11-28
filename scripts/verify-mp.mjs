import {browserOptions} from './qa-browser.mjs'
import assert from 'node:assert/strict'
import {randomBytes,createHash,createHmac} from 'node:crypto'
import {spawn} from 'node:child_process'
import {mkdir} from 'node:fs/promises'
import {readFile} from 'node:fs/promises'
import {once} from 'node:events'
import {createServer} from 'node:net'
import {setTimeout as delay} from 'node:timers/promises'
import {chromium} from 'playwright'
import {preview} from 'vite'
import WebSocket from 'ws'
import {fixture} from './selfhost-test.mjs'
import {frameSample} from './mp-frame.mjs'

const secret=randomBytes(32).toString('hex'),children=[],sockets=[]
const smokeCapture=process.argv.includes('--smoke')
const modeSwitch=process.argv.includes('--mode-switch')
let failBrowser
const browserError=new Promise((_,reject)=>{failBrowser=reject})
const appearance={body:'f',v:1,createdAt:123,skin:2,face:1,brows:0,eyes:0,hair:'f_bun',hairColor:1,look:'sport'}
let database,site,browser,botsTimer
async function port(){const server=createServer().listen(0,'127.0.0.1');await once(server,'listening');const number=server.address().port;await new Promise(done=>server.close(done));return number}
async function service(entry,env,path,status){
  const number=await port(),host=`127.0.0.1:${number}`
  const child=spawn(process.execPath,['--import','tsx',entry],{env:{...process.env,...env,PORT:String(number)},stdio:'ignore'})
  children.push(child)
  for(let attempt=0;attempt<100;attempt++){
    if(await fetch('http://'+host+path).then(response=>response.status===status).catch(()=>false))return host
    if(child.exitCode!==null)break;await delay(100)
  }
  throw Error(`Could not start ${entry}`)
}
function ticket(uid,exp=Math.floor(Date.now()/1000)+60){const body=Buffer.from(JSON.stringify({uid,name:String(uid),exp})).toString('base64url');return body+'.'+createHmac('sha256',secret).update(body).digest('base64url')}
async function socket(host,options){const client=new WebSocket(`ws://${host}/ws`,options);sockets.push(client);await once(client,'open');return client}
async function reject(host,value){const client=await socket(host),closed=once(client,'close',{signal:AbortSignal.timeout(3000)});client.send(JSON.stringify({t:'join',ticket:value}));assert.equal((await closed)[0],4003)}
async function verify(){
  if(process.argv.includes('--combat')){
    const rt=await service('rt/server-realtime.mjs',{RT_JOIN_SECRET:secret},'/health',200)
    return (await import('./verify-combat.mjs')).verifyCombat(rt,ticket)
  }
  if(process.argv.includes('--emote')){
    const rt=await service('rt/server-realtime.mjs',{RT_JOIN_SECRET:secret},'/health',200)
    return (await import('./verify-emote-mp.mjs')).verifyEmotes(rt,ticket)
  }
  database=await fixture({postgresOnly:true})
  if(modeSwitch)for(const name of ['021-fishing-catches','022-helicopter','023-helicopter-seat'])await database.sql(await readFile(`deploy/postgres/${name}.sql`,'utf8'))
  const rt=await service('rt/server-realtime.mjs',{RT_JOIN_SECRET:secret},'/health',200)
  assert.equal((await (await fetch(`http://${rt}/health`)).json()).proto,4)
  const [body,signature]=ticket(100000).split('.')
  if(!smokeCapture){await reject(rt,body+'.'+(signature[0]==='A'?'B':'A')+signature.slice(1));await reject(rt,ticket(100000,Math.floor(Date.now()/1000)-1));await reject(await service('rt/server-realtime.mjs',{RT_JOIN_SECRET:''},'/health',200),ticket(100000));await reject(rt,ticket('tester1'))}
  const number=await port(),origin=`http://127.0.0.1:${number}`
  const api=await service('server/index.mjs',{...database.env,PUBLIC_ORIGIN:origin,RT_JOIN_SECRET:secret},'/api/me',401)
  site=await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:number,strictPort:true,proxy:{'/api':'http://'+api,'/ws':{target:'ws://'+rt,ws:true}}}})
  assert.equal((await fetch(origin+'/api/rt/ticket',{method:'POST',headers:{origin}})).status,401)
  browser=await chromium.launch({executablePath:process.env.CHROMIUM,args:[...browserOptions().args,'--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']})
  const url=origin+'/?verify&mode=walk&flow=0'
  async function pageFor(name,mp){
    const page=await browser.newPage({viewport:name==='alice'?{width:240,height:135}:{width:480,height:270}});page.on('pageerror',failBrowser)
    page.on('console',message=>{if(message.type()==='error')failBrowser(Error(`${name}: ${message.location().url}: ${message.text()}`))})
    const token=randomBytes(32).toString('hex');await database.sql('INSERT INTO users(id,email,nickname,salt,digest,verified) VALUES($1,$2,$1,\'\',\'\',1)',[name,name+'@example.test']);await database.sql('INSERT INTO sessions VALUES($1,$2,unixepoch()+600)',[createHash('sha256').update(token).digest('hex'),name]);await page.context().addCookies([{name:'glol_session',value:token,url:origin,httpOnly:true}]);await page.addInitScript(avatar=>localStorage.setItem('glol.avatar.v1',JSON.stringify(avatar)),appearance)
    if(smokeCapture){
      page.setDefaultTimeout(60000)
      await page.route('**/favicon.ico',route=>route.fulfill({status:204}))
      await page.setViewportSize({width:680,height:420})
      await page.addInitScript(()=>localStorage.setItem('glol.prefs',JSON.stringify({view:'first'})))
      await page.addInitScript(()=>{if(!localStorage.getItem('glol.save.v1'))localStorage.setItem('glol.save.v1',JSON.stringify({schemaVersion:2,money:200,packs:[{brand:'dangui',remaining:20}]}))})
      await page.goto(origin+'/backpack.html');await page.getByRole('button',{name:'香烟'}).click();await page.waitForURL(origin+'/')
      await page.goto(origin+'/?verify&play=tour&mp=1&time=12&flow=0');await page.waitForFunction(()=>window.viewer?.walkTo)
      assert(await page.evaluate(name=>window.viewer.walkTo(-309,name==='alice'?-1:1,name==='alice'?Math.PI:0,'smoke-test'),name));console.log(name,'entered')
    }else if(modeSwitch)await page.goto(origin+'/?verify&play=solo&mp=1&flow=0')
    else await page.goto(url+(mp?'&mp=1':''))
    await page.waitForFunction(()=>window.viewer?.walk?.active,null,{timeout:90000});if(mp){assert(await page.evaluate(()=>!!window.viewer.walk.net),'active before net attached');await page.waitForFunction(()=>window.viewer.walk.net.status().state==='online',null,{polling:100,timeout:30000})}return page
  }
  if(modeSwitch){
    const page=await pageFor('alice',true)
    const point=()=>page.evaluate(()=>{const {x,z}=window.viewer.walk.probe();return [x,z]})
    const select=async(mode)=>{await page.locator('.btn-menu').evaluate(button=>button.click());await page.locator(`[data-umami-event=home-${mode}]`).evaluate(button=>button.click());await page.waitForFunction(()=>!document.querySelector('.home-mode[aria-busy=true]'),null,{timeout:90000});console.log('selected',mode)}
    const near=(actual,expected)=>assert.ok(Math.hypot(actual[0]-expected[0],actual[1]-expected[1])<3,JSON.stringify({actual,expected}))
    const online=()=>page.waitForFunction(()=>window.viewer.walk?.net?.status().state==='online')
    const initial=await point();await select('tour');await page.evaluate(()=>window.viewer.camera.position.set(-200,420,-600))
    await select('mp');await online();near(await point(),initial)
    await select('tour');near(await page.evaluate(()=>[window.viewer.camera.position.x,window.viewer.camera.position.z]),[-200,-600])
    await select('solo');assert.ok(await page.evaluate(()=>window.viewer.walkTo(-268.5,24.8,0,'verify-solo')));const single=await point()
    await select('mp');await online();near(await point(),initial);await select('solo');near(await point(),single)
    console.log('PASS tour → online → tour; solo → online → solo',JSON.stringify({online:initial,tour:[-200,-600],solo:single}));return
  }
  if(smokeCapture){
    const alice=await pageFor('alice',true);await alice.evaluate(()=>window.viewer.freeze())
    const bob=await pageFor('bob',true);await alice.evaluate(()=>window.viewer.resume());const pages=[alice,bob]
    for(const page of pages)console.log(await page.evaluate(()=>({peers:window.viewer.walk.net.probe(),home:document.body.hasAttribute('data-home')})))
    for(const phase of ['sealed','open','ready','smoking']){
      for(const page of pages){
        await page.waitForFunction(phase=>window.viewer.walk.net.probe().some(peer=>peer.ready&&peer.smoke===phase),phase)
        await page.waitForFunction(()=>window.viewer.camera.getObjectByName('smoke-prompt')?.visible)
      }
      await Promise.all(pages.map(page=>page.keyboard.press('f')))
    }
    await mkdir('captures/mp',{recursive:true})
    await Promise.all(pages.map(async(page,index)=>{
      await page.waitForFunction(()=>window.viewer.walk.net.probe().some(peer=>peer.puffs===1));await page.screenshot({path:`captures/mp/smoke-${index}.png`})
    }))
    for(const page of pages)await page.keyboard.press('3')
    for(const page of pages)await page.waitForFunction(()=>window.viewer.walk.net.probe().some(peer=>peer.smoke==='idle'))
    for(const page of pages)await page.keyboard.press('3')
    for(const page of pages){
      await page.waitForFunction(()=>window.viewer.walk.net.probe().some(peer=>peer.smoke==='open'))
      const brands=await page.evaluate(()=>{
        const ids=[]
        window.viewer.camera.parent.traverse(object=>{
          if(object.name==='smoke-pack' && object.visible)ids.push(object.children[0].material[4].map.image?.src)
        })
        return ids
      })
      assert(brands.length>=2 && brands.every(src=>src?.endsWith('/dangui.svg')),JSON.stringify(brands))
    }
    console.log('Both peers lit, puffed and reopened their saved pack with the correct brand');return
  }
  const solo=await pageFor('solo',false);assert.equal(await solo.evaluate(()=>performance.getEntriesByType('resource').some(entry=>/\/net-[^/]+\.js|\/api\/rt\/ticket/.test(entry.name))),false);console.log('solo frame ms',await frameSample(solo));await solo.close()
  const alice=await pageFor('alice',true);await alice.evaluate(()=>window.viewer.freeze())
  const bob=await pageFor('bob',true);await alice.evaluate(()=>window.viewer.resume())
  const {ticket:issued}=await (await alice.request.post(origin+'/api/rt/ticket',{headers:{origin}})).json()
  assert.equal(JSON.parse(Buffer.from(issued.split('.')[0],'base64url')).uid,(await (await alice.request.get(origin+'/api/me')).json()).uid)
  await alice.evaluate(async()=>{const walk=window.viewer.walk;if(!await walk.enter(-309,-1,0,'mp-test'))throw Error('spawn failed')})
  await alice.waitForFunction(()=>window.viewer.walk.net?.status().state==='online')
  await bob.waitForFunction(()=>window.viewer.walk.net.probe().some(remote=>remote.name==='alice'&&remote.ready))
  const end=await alice.evaluate(()=>{const walk=window.viewer.walk,start=walk.probe();walk.drive(.95,.32,true);let pose
    for(let step=0;step<300;step++){walk.tick(.05);pose=walk.probe();if(Math.hypot(pose.x-start.x,pose.z-start.z)>=20)break}
    walk.drive(0,0,false);for(let step=0;step<20;step++)walk.tick(.05);pose=walk.probe();return {position:pose.figPos,distance:Math.hypot(pose.x-start.x,pose.z-start.z)}})
  assert(end.distance>=20,JSON.stringify(end));await bob.waitForFunction(pos=>{const remote=window.viewer.walk.net.probe().find(item=>item.name==='alice');return remote&&Math.hypot(...remote.position.map((value,index)=>value-pos[index]))<1},end.position,{timeout:15000})
  const remote=await bob.evaluate(()=>window.viewer.walk.net.probe().find(item=>item.name==='alice'));assert.deepEqual(remote.avatar,appearance)
  const health=async()=>(await (await fetch(`http://${rt}/health`)).json()).online
  assert.equal(await health(),2)
  await bob.evaluate(({name,previous})=>{
    window.teleportSamples=[];window.teleportObserver=setInterval(()=>{const peer=window.viewer.walk.net.probe().find(item=>item.name===name)
      if(peer&&Math.hypot(peer.position[0]-previous[0],peer.position[2]-previous[2])>45)window.teleportSamples.push({at:Date.now(),pos:peer.position})},25)
  },{name:remote.name,previous:remote.position})
  const arrived=await alice.evaluate(async()=>{const {walk,walkTo}=window.viewer,session=walk.net,before=walk.probe();if(!await walkTo(before.x+47.4,before.z+16,0,'mp-teleport'))throw Error('50 m teleport failed');const at=Date.now(),after=walk.probe();return {at,same:session===walk.net,pos:after.figPos,distance:Math.hypot(after.x-before.x,after.z-before.z)}})
  assert(arrived.same);assert(Math.abs(arrived.distance-50)<1)
  const observed=await bob.evaluate(async({at,pos})=>{const match=()=>window.teleportSamples.find(sample=>Math.hypot(...sample.pos.map((value,index)=>value-pos[index]))<1)
    while(!match()&&Date.now()<at+10000)await new Promise(done=>setTimeout(done,25));clearInterval(window.teleportObserver);return {match:match(),last:window.teleportSamples.at(-1)}},arrived)
  assert(observed.match&&observed.match.at<=arrived.at+10000,JSON.stringify({observed,arrived}));const teleportMs=Math.max(0,observed.match.at-arrived.at);assert.equal(await health(),2);console.log('teleport m / observed ms / online',arrived.distance,teleportMs,2)
  const left=performance.now();await alice.close();await bob.waitForFunction(()=>!window.viewer.walk.net.probe().some(item=>item.name==='alice'),null,{timeout:5000});const leaveMs=performance.now()-left;assert(leaveMs<=5000);console.log('distance / error / leave ms',end.distance,Math.hypot(...remote.position.map((value,index)=>value-end.position[index])),leaveMs)
  const center=await bob.evaluate(()=>window.viewer.walk.probe().figPos),bots=[]
  for(let index=0;index<20;index++){
    const client=await socket(rt,{localAddress:`127.0.0.${2+index}`}),uid=1000000+index
    const welcome=once(client,'message',{signal:AbortSignal.timeout(3000)}),pose={x:center[0]+index%5-2,y:center[1],z:center[2]-2-Math.floor(index/5),gr:1,v:1.6,yaw:0}
    client.send(JSON.stringify({t:'join',ticket:ticket(uid),name:'ignored',uid:'ignored',avatar:appearance,...pose}));const message=JSON.parse((await welcome)[0]);assert.equal(message.me.name,String(uid));assert.equal(message.me.uid,uid);bots.push({client,pose})
  }
  botsTimer=setInterval(()=>{for(const {client,pose} of bots)client.send(JSON.stringify({...pose,t:'pos',x:pose.x+Math.sin(performance.now()/600)}))},55)
  await bob.waitForFunction(()=>window.viewer.walk.net.probe().filter(item=>item.ready).length===20);console.log('20 bots frame ms',await frameSample(bob))
  await mkdir('captures/mp',{recursive:true});await bob.screenshot({path:'captures/mp/nearby.png'})
}
try{await Promise.race([verify(),browserError])}finally{clearInterval(botsTimer);sockets.forEach(client=>client.terminate());await browser?.close();await site?.close();await Promise.all(children.map(async child=>{if(child.exitCode===null&&child.signalCode===null){const exit=once(child,'exit');child.kill();await exit}}));await database?.close()}
