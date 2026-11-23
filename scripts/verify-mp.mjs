import assert from 'node:assert/strict'
import {randomBytes,createHash,createHmac} from 'node:crypto'
import {spawn} from 'node:child_process'
import {mkdir} from 'node:fs/promises'
import {once} from 'node:events'
import {createServer} from 'node:net'
import {setTimeout as delay} from 'node:timers/promises'
import {chromium} from 'playwright'
import {preview} from 'vite'
import WebSocket from 'ws'
import {fixture} from './selfhost-test.mjs'
import {frameSample} from './mp-frame.mjs'

const secret=randomBytes(32).toString('hex'),children=[],sockets=[],errors=[]
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
try{
  database=await fixture({postgresOnly:true})
  const rt=await service('rt/server-realtime.mjs',{RT_JOIN_SECRET:secret},'/health',200)
  assert.equal((await (await fetch(`http://${rt}/health`)).json()).proto,4)
  const [body,signature]=ticket(100000).split('.')
  await reject(rt,body+'.'+(signature[0]==='A'?'B':'A')+signature.slice(1));await reject(rt,ticket(100000,Math.floor(Date.now()/1000)-1));await reject(await service('rt/server-realtime.mjs',{RT_JOIN_SECRET:''},'/health',200),ticket(100000));await reject(rt,ticket('tester1'))
  const number=await port(),origin=`http://127.0.0.1:${number}`
  const api=await service('server/index.mjs',{...database.env,PUBLIC_ORIGIN:origin,RT_JOIN_SECRET:secret},'/api/me',401)
  site=await preview({root:'web',configFile:'web/vite.config.ts',preview:{host:'127.0.0.1',port:number,strictPort:true,proxy:{'/api':'http://'+api,'/ws':{target:'ws://'+rt,ws:true}}}})
  assert.equal((await fetch(origin+'/api/rt/ticket',{method:'POST',headers:{origin}})).status,401)
  browser=await chromium.launch({executablePath:process.env.CHROMIUM,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']})
  const url=origin+'/?verify&mode=walk&flow=0'
  async function pageFor(name,mp){
    const page=await browser.newPage({viewport:{width:480,height:270}});page.on('pageerror',error=>errors.push(error.message))
    if(mp){const token=randomBytes(32).toString('hex');await database.sql('INSERT INTO users(id,email,nickname,salt,digest,verified) VALUES($1,$2,$1,\'\',\'\',1)',[name,name+'@example.test']);await database.sql('INSERT INTO sessions VALUES($1,$2,unixepoch()+600)',[createHash('sha256').update(token).digest('hex'),name]);await page.context().addCookies([{name:'glol_session',value:token,url:origin,httpOnly:true}]);await page.addInitScript(avatar=>localStorage.setItem('glol.avatar.v1',JSON.stringify(avatar)),appearance)}
    await page.goto(url+(mp?'&mp=1':''));await page.waitForFunction(()=>window.viewer?.walk?.active,null,{timeout:90000});if(mp)await page.waitForFunction(()=>window.viewer.walk.net?.status().state==='online',null,{polling:100,timeout:60000});return page
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
  const left=performance.now();await alice.close();await bob.waitForFunction(()=>!window.viewer.walk.net.probe().some(item=>item.name==='alice'),null,{timeout:5000});const leaveMs=performance.now()-left;assert(leaveMs<=5000);console.log('distance / error / leave ms',end.distance,Math.hypot(...remote.position.map((value,index)=>value-end.position[index])),leaveMs)
  const center=await bob.evaluate(()=>window.viewer.walk.probe().figPos),bots=[]
  for(let index=0;index<20;index++){
    const client=await socket(rt,{localAddress:`127.0.0.${2+index}`}),uid=1000000+index
    const welcome=once(client,'message',{signal:AbortSignal.timeout(3000)}),pose={x:center[0]+index%5-2,y:center[1],z:center[2]-2-Math.floor(index/5),gr:1,v:1.6,yaw:0}
    client.send(JSON.stringify({t:'join',ticket:ticket(uid),name:'ignored',uid:'ignored',avatar:appearance,...pose}));const message=JSON.parse((await welcome)[0]);assert.equal(message.me.name,String(uid));assert.equal(message.me.uid,uid);bots.push({client,pose})
  }
  botsTimer=setInterval(()=>{for(const {client,pose} of bots)client.send(JSON.stringify({...pose,t:'pos',x:pose.x+Math.sin(performance.now()/600)}))},55)
  await bob.waitForFunction(()=>window.viewer.walk.net.probe().filter(item=>item.ready).length===20);console.log('20 bots frame ms',await frameSample(bob));assert.deepEqual(errors,[])
  await mkdir('captures/mp',{recursive:true});await bob.screenshot({path:'captures/mp/nearby.png'})
}finally{clearInterval(botsTimer);sockets.forEach(client=>client.terminate());await browser?.close();await site?.close();await Promise.all(children.map(async child=>{if(child.exitCode===null&&child.signalCode===null){const exit=once(child,'exit');child.kill();await exit}}));await database?.close()}
