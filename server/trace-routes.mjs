import sharp from 'sharp'
import {setBan} from '../lib/admin.ts'
import {decodeGray,encodeTile} from './trace-qim.mjs'

const json=(data,status=200)=>Response.json(data,{status,headers:{'cache-control':'private, no-store'}})
const reject=(error,status)=>json({ok:false,error},status)

async function readBounded(request,maximum) {
  if(Number(request.headers.get('content-length'))>maximum) return null
  const reader=request.body?.getReader(), chunks=[]
  if(!reader) return Buffer.alloc(0)
  let length=0
  try {
    while(true){
      const next=await reader.read(); if(next.done)break
      length+=next.value.length
      if(length>maximum){await reader.cancel();return null}
      chunks.push(next.value)
    }
    return Buffer.concat(chunks,length)
  } finally { reader.releaseLock() }
}

export function traceRoutes(pool,env){
  const key=env.TRACE_SECRET, cache=new Map()
  let busy=false
  async function traceTile(uid){
    if(!key)return reject('disabled',503)
    const bucket=Math.floor(Date.now()/300000)*300, id=uid+':'+bucket
    if(!cache.has(id)){
      if(cache.size>=256)cache.delete(cache.keys().next().value)
      const raw=encodeTile(uid,bucket,key)
      cache.set(id,await sharp(raw,{raw:{width:512,height:512,channels:1}}).png().toBuffer())
    }
    return new Response(cache.get(id),{headers:{'content-type':'image/png','cache-control':'private, no-store','vary':'Cookie','x-next':String(bucket+300-Math.floor(Date.now()/1000))}})
  }
  async function decode(request){
    const bytes=await readBounded(request,12*1024*1024)
    if(!bytes)return reject('too_large',413)
    if(!bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')) && !bytes.subarray(0,3).equals(Buffer.from('ffd8ff','hex')))return reject('expected_png_or_jpeg',415)
    let pixels
    try{pixels=await sharp(bytes,{limitInputPixels:4096**2}).removeAlpha().greyscale().raw().toBuffer({resolveWithObject:true})}catch{return reject('invalid_image',400)}
    const result=decodeGray(pixels.data,pixels.info.width,pixels.info.height,key)
    if(!result)return json({ok:false,confidence:'none',account:null,devices:[],sameDeviceUids:[]})
    const {rows:[account]}=await pool.query(`select uid,nickname,signup_method as "signupMethod",(select max(last_login_at) from social_identities where user_id=users.id) as "lastLogin" from users where uid=$1`,[result.uid])
    const {rows:devices}=await pool.query('select model,browser,screen,ip24,isp,city,first,last from mp_devices where uid=$1 order by last desc nulls last limit 50',[result.uid])
    const {rows:others}=await pool.query('select distinct uid from mp_devices where uid<>$1 and fp in (select fp from mp_devices where uid=$1) order by uid limit 100',[result.uid])
    return json({ok:true,...result,confidence:'high',account:account??null,devices,sameDeviceUids:others.map(row=>Number(row.uid))})
  }
  async function action(request,actor){
    const input=await readBounded(request,4096);if(!input)return reject('too_large',413)
    let body;try{body=JSON.parse(input)}catch{return reject('invalid_json',400)}
    const {scope,uid,minutes,reason}=body??{}
    if(!['mp','account','both'].includes(scope)||!Number.isSafeInteger(uid)||uid<1||uid>0xffffffff||!Number.isInteger(minutes)||minutes<0||minutes>525600||typeof reason!=='string'||!reason.trim()||[...reason].length>200)return reject('invalid_action',400)
    if(scope!=='mp' && minutes!==0)return reject('account_ban_requires_permanent_duration',422)
    const {rows:[user]}=await pool.query('select id,role from users where uid=$1',[uid]);if(!user)return reject('not_found',404)
    if(user.id===actor||user.role==='admin')return reject('protected_account',409)
    if(scope!=='mp')await setBan(env.DB,actor,user.id,true,reason)
    let until=null
    if(scope!=='account'){
      const response=await env.mpAdmin('admin/ban',new Request(request.url,{method:'POST',body:JSON.stringify({uid,minutes,reason})}),actor)
      const reply=await response.json().catch(()=>null)
      if(!response.ok||reply?.ok!==true)return json({ok:false,scope,uid,until,error:'mp_ban_failed',accountApplied:scope==='both'},502)
      until=reply.until==null?null:Math.floor(reply.until/1000)
    }
    return json({ok:true,scope,uid,until})
  }
  async function traceAdmin(path,request,actor){
    if(request.method!=='POST')return reject('method',405)
    if(!key)return reject('disabled',503)
    if(path==='admin/trace/action')return action(request,actor)
    if(busy)return reject('busy',429)
    busy=true;try{return await decode(request)}finally{busy=false}
  }
  return {traceTile,traceAdmin}
}
