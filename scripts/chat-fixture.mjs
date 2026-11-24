import {fixture} from './selfhost-test.mjs'
import {importWords} from './chat-words-import.mjs'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {randomUUID,createHmac} from 'node:crypto'
import {setTimeout as delay} from 'node:timers/promises'
import WebSocket from 'ws'

export async function until(check){for(let attempt=0;attempt<500;attempt++){const result=check();if(result)return result;await delay(10)}throw Error('chat fixture timed out: '+check)}
export async function setup({providerDelay=0}={}){
  const checks=[]
  const storage=await fixture({postgresOnly:true}),secret=randomUUID(),clients=[],peaks=[]
  let child,base
  async function start(){
    const port=20000+Math.floor(Math.random()*30000);base='http://127.0.0.1:'+port
    const args=providerDelay?['--import','./scripts/chat-mock-wechat.mjs','rt/server-realtime.mjs',String(providerDelay)]:['rt/server-realtime.mjs']
    child=spawn(process.execPath,args,{env:{...process.env,...storage.env,PORT:String(port),WX_APPID:providerDelay?'fixture':'',WX_SECRET:providerDelay?'fixture':'',RT_JOIN_SECRET:secret,RT_ADMIN_TOKEN:secret,RT_MAX_PENDING_PER_IP:'0',RT_STATS_MS:'1000'},stdio:['ignore','pipe','inherit','ipc']});child.on('message',msg=>checks.push(msg.checking));await once(child.stdout,'data');child.stdout.on('data',chunk=>{for(const line of String(chunk).split('\n'))try{const {loopP99Ms}=JSON.parse(line);if(Number.isFinite(loopP99Ms))peaks.push(loopP99Ms)}catch{}})
  }
  async function stop(){for(const client of clients.splice(0))client.ws.terminate();if(child&&child.exitCode===null&&child.signalCode===null){const done=once(child,'exit');child.kill();await done}}
  async function join(uid,x){
    const payload=Buffer.from(JSON.stringify({uid,name:'bot'+uid,wx_openid:providerDelay?'fixture-'+uid:undefined,exp:Math.floor(Date.now()/1000)+50})).toString('base64url'),ticket=payload+'.'+createHmac('sha256',secret).update(payload).digest('base64url')
    const ws=new WebSocket(base.replace('http','ws')+'/ws');const events=[];let welcome
    ws.on('message',raw=>{const msg=JSON.parse(raw);if(msg.t==='welcome')welcome=msg;if(msg.t.startsWith('chat'))events.push(msg)})
    const send=packet=>ws.send(JSON.stringify(packet));clients.push({ws,events,send,uid,x});await once(ws,'open');send({t:'join',ticket,x,z:0});await until(()=>welcome);return clients.at(-1)
  }
  async function admin(path,body,params={}){const response=await fetch(base+'/admin/chat',{method:'POST',headers:{'X-Admin-Token':secret},body:JSON.stringify({method:body?'POST':'GET',actor:'fixture',path,params,body:body&&{reason:'fixture',...body}})});if(!response.ok)throw Error(path+' '+response.status+': '+await response.text());return response.json()}
  try{await importWords({query:storage.sql});await start()}catch(error){await storage.close();throw error}return {storage,join,admin,clients,peaks,checks,health:async()=>(await fetch(base+'/health')).json(),restart:async()=>{await stop();await start()},close:async()=>{await stop();await storage.close()}}
}
