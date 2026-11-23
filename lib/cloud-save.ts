import {type Env,Problem,invalid,now,sessionAccount,sessionHash,unauthorized} from './auth'
import {AVATAR_KEY} from './avatar'

async function readSave(request:Request) {
  const reader=request.body?.getReader()
  if(!reader)invalid()
  const decoder=new TextDecoder();let size=0,text=''
  for(;;){
    const {done,value}=await reader.read();if(done)break
    size+=value.byteLength
    if(size>65536){await reader.cancel();throw new Problem(413,'save_size','存档超过 64 KiB')}
    text+=decoder.decode(value,{stream:true})
  }
  try{return JSON.parse(text+decoder.decode())}catch{invalid()}
}

export async function cloudSave(request:Request,env:Env) {
  const method=request.method
  if(method!=='PUT' && method!=='GET')throw new Problem(405,'method','不支持的请求方式')
  if(method==='PUT' && request.headers.get('Origin')!==new URL(request.url).origin)throw new Problem(403,'origin','请求来源不符')
  const user=await sessionAccount(env.DB,await sessionHash(request))
  if(!user)unauthorized()
  if(request.headers.get('X-Save-Owner')!==user.id)throw new Problem(409,'account_changed','登录账号已变更')
  const row=await env.DB.prepare('SELECT payload_json,revision,updated_at FROM player_saves WHERE user_id=?').bind(user.id).first<{payload_json:string;revision:number;updated_at:number}>()
  const existing=row?JSON.parse(row.payload_json):null
  const save=typeof existing?.money==='number'?{...existing,updatedAt:existing.updatedAt??row!.updated_at*1000}:null
  const reply=(data:unknown)=>Response.json(data,{headers:{'Cache-Control':'no-store'}})
  if(method==='GET')return reply({save,revision:row?.revision??0})
  if(request.headers.get('If-Match')!==`"${row?.revision??0}"`)throw new Problem(409,'conflict','请重新读取存档')
  const next=await readSave(request)
  if(next?.schemaVersion!==2 || !Number.isSafeInteger(next.money) || next.money<0 || next.money>99999999 ||
     !Array.isArray(next.wardrobe?.ownedItemIds) || !Array.isArray(next.wardrobe?.ownedPresetIds) ||
     !Number.isSafeInteger(next.updatedAt) || next.updatedAt<=0 || next.updatedAt>Date.now()+300000)invalid()
  if(save && save.updatedAt>=next.updatedAt)return reply({save,revision:row!.revision})
  delete next[AVATAR_KEY]
  if(existing?.[AVATAR_KEY])next[AVATAR_KEY]=existing[AVATAR_KEY]
  const payload=JSON.stringify(next)
  if(new TextEncoder().encode(payload).length>65536)throw new Problem(413,'save_size','存档超过 64 KiB')
  const result=await env.DB.prepare(`INSERT INTO player_saves(user_id,schema_version,revision,payload_json,client_updated_at,updated_at)
    VALUES(?,2,1,?,?,?) ON CONFLICT(user_id) DO UPDATE SET revision=player_saves.revision+1,payload_json=excluded.payload_json,
    client_updated_at=excluded.client_updated_at,updated_at=excluded.updated_at WHERE player_saves.revision=?`)
    .bind(user.id,payload,Math.floor(next.updatedAt/1000),now(),row?.revision??0).run()
  if(!result.meta.changes)throw new Problem(409,'conflict','请重新读取存档')
  return reply({save:next,revision:(row?.revision??0)+1})
}
