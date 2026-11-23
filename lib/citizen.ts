import {type Env, invalid, limit, Problem, sessionAccount, sessionHash, unauthorized} from './auth'
import {AVATAR_KEY, sanitizeAvatar} from './avatar'

const cap=64*1024
const missing=()=>new Problem(404,'not_found','市民卡或头像不存在')
const wrongMethod=()=>new Problem(405,'method','不支持的请求方式')
const tooLarge=()=>new Problem(413,'too_large','头像不能超过 64 KiB')
const key=(uid:number)=>`citizen/${uid}.webp`
const photoUrl=(uid:number)=>`/api/citizen/${uid}/photo`
const json=(data:unknown)=>Response.json(data,{headers:{'Cache-Control':'no-store'}})

async function readPhoto(request:Request) {
  if(request.headers.get('Content-Type')!=='image/webp')throw new Problem(415,'media_type','需要 WebP 图片')
  if(Number(request.headers.get('Content-Length'))>cap)throw tooLarge()
  const reader=request.body?.getReader()
  if(!reader)invalid()
  const bytes=new Uint8Array(cap)
  let size=0
  try {
    while(true){
      const {done,value}=await reader.read()
      if(done)break
      if(size+value.length>cap){await reader.cancel();throw tooLarge()}
      bytes.set(value,size);size+=value.length
    }
  }finally{reader.releaseLock()}
  const tag=(offset:number)=>String.fromCharCode(...bytes.subarray(offset,offset+4))
  const length=(offset:number)=>new DataView(bytes.buffer).getUint32(offset,true)
  if(size<20||tag(0)!=='RIFF'||tag(8)!=='WEBP'||length(4)!==size-8)invalid()
  let image=false,offset=12
  while(offset+8<=size){
    const type=tag(offset),chunk=length(offset+4),start=offset+8
    if(start+chunk>size)invalid()
    if(type==='VP8L' && chunk>=5 && bytes[start]===0x2f)image=true
    if(type==='VP8 ' && chunk>=10 && bytes[start+3]===0x9d && bytes[start+4]===1 && bytes[start+5]===0x2a)image=true
    offset=start+chunk+(chunk%2)
  }
  if(!image||offset!==size)invalid()
  return bytes.slice(0,size).buffer
}

export async function citizen(request:Request,env:Env,path:string) {
  const url=new URL(request.url)
  if(path==='citizen/photo'){
    if(request.method!=='POST')throw wrongMethod()
    if(request.headers.get('Origin')!==url.origin)throw new Problem(403,'origin','请求来源不符')
    const account=await sessionAccount(env.DB,await sessionHash(request))
    if(!account?.verified)unauthorized()
    if(url.search)invalid()
    const data=await readPhoto(request)
    await limit(env.DB,'citizen-photo:'+account.id,6,60)
    await env.FEEDBACK.put(key(account.uid),data)
    await env.DB.prepare('UPDATE users SET citizen_photo=1 WHERE id=?').bind(account.id).run()
    return json({photoUrl:photoUrl(account.uid)})
  }
  const match=/^citizen\/([1-9]\d{5,15})(\/photo)?$/.exec(path)
  if(!match||!Number.isSafeInteger(Number(match[1])))throw missing()
  if(request.method!=='GET')throw wrongMethod()
  const uid=Number(match[1])
  if(match[2]){
    const found=await env.DB.prepare('SELECT uid FROM users WHERE uid=? AND verified=1 AND citizen_photo=1').bind(uid).first()
    const object=found && await env.FEEDBACK.get(key(uid))
    if(!object)throw missing()
    return new Response(object.body,{headers:{'Content-Type':'image/webp','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}})
  }
  const row=await env.DB.prepare(`SELECT nickname,created_at,citizen_photo,payload_json FROM users
    LEFT JOIN player_saves ON player_saves.user_id=users.id WHERE uid=? AND verified=1`).bind(uid)
    .first<{nickname:string;created_at:number;citizen_photo:number;payload_json:string|null}>()
  if(!row)throw missing()
  const avatar=sanitizeAvatar(JSON.parse(row.payload_json??'{}')[AVATAR_KEY])
  return json({uid,nickname:row.nickname,gender:avatar?.body??null,registeredAt:row.created_at,photoUrl:row.citizen_photo?photoUrl(uid):null})
}
