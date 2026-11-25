import {randomUUID,timingSafeEqual} from 'node:crypto'
import {sessionAccount,sessionHash,Problem,invalid} from '../lib/auth.ts'
import {validCard,slugPattern} from '../lib/update-card.mjs'

const json=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}})
const uuid='[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}'
const asset=new RegExp(`^updates/images/(${uuid}-[0-2]\\.webp)$`)
const receipt=new RegExp(`^updates/(${uuid})/seen$`)
function webp(encoded){
  if(typeof encoded!=='string'||encoded.length>409600)invalid()
  const bytes=Buffer.from(encoded,'base64'), sig=bytes.toString('ascii',12,16)
  if(bytes.length<30||bytes.toString('ascii',0,4)!=='RIFF'||bytes.readUInt32LE(4)!==bytes.length-8||bytes.toString('ascii',8,12)!=='WEBP')invalid()
  const width=sig==='VP8 '?bytes.readUInt16LE(26)&16383:sig==='VP8L'?(bytes.readUInt32LE(21)&16383)+1:sig==='VP8X'?bytes.readUIntLE(24,3)+1:0
  if(!width||width>1280||bytes.length>307200)invalid()
  return bytes
}
async function readBody(request,max){
  let size=0; const chunks=[]
  for await(const chunk of request.body??[]){size+=chunk.length;if(size>max)throw new Problem(413,'size','请求过大');chunks.push(chunk)}
  try{return JSON.parse(Buffer.concat(chunks).toString())}catch{invalid()}
}
export function cardRoutes(pool,env){
  return async(request,path)=>{
    const method=request.method, image=asset.exec(path)
    if(image && method==='GET'){
      const object=await env.FEEDBACK.get(`update-cards/${image[1]}`)
      return object?new Response(object.body,{headers:{'content-type':'image/webp','x-content-type-options':'nosniff','cache-control':'public,max-age=31536000,immutable'}}):json(null,404)
    }
    const admin=path.startsWith('admin/'), token=Buffer.from(`Bearer ${env.UPDATE_CARD_TOKEN}`), supplied=Buffer.from(request.headers.get('authorization')??'')
    const publisher=admin && !!env.UPDATE_CARD_TOKEN && token.length===supplied.length && timingSafeEqual(token,supplied)
    const account=publisher?null:await sessionAccount(env.DB,await sessionHash(request))
    if(!publisher && method!=='GET' && request.headers.get('origin')!==new URL(request.url).origin)return json(null,403)
    if(path==='updates/unseen' && method==='GET'){
      if(!account?.verified)return json([])
      const first=await pool.query('UPDATE users SET first_game_entry=clock_timestamp() WHERE id=$1 AND first_game_entry IS NULL',[account.id])
      if(first.rowCount)return json([])
      return json((await pool.query(`SELECT c.* FROM update_cards c JOIN users u ON u.id=$1 WHERE c.active AND c.published_at>u.first_game_entry
        AND NOT EXISTS (SELECT 1 FROM update_card_views v WHERE v.card_id=c.id AND v.user_id=u.id) ORDER BY c.published_at,c.id LIMIT 10`,[account.id])).rows)
    }
    const seen=receipt.exec(path)
    if(seen && method==='POST'){
      if(!account?.verified)return json(null,401)
      const action=(await readBody(request,256))?.action
      if(!['viewed','skipped'].includes(action))invalid()
      await pool.query(`INSERT INTO update_card_views(user_id,card_id,action) SELECT u.id,c.id,$3 FROM users u JOIN update_cards c ON c.id=$2
        WHERE u.id=$1 AND c.active AND c.published_at>u.first_game_entry ON CONFLICT DO NOTHING`,[account.id,seen[1],action])
      return json({ok:true})
    }
    if(!admin)return json(null,404)
    if(!publisher && !(account?.verified && account.role==='admin'))return json(null,403)
    if(path==='admin/updates' && method==='GET')return json((await pool.query('SELECT * FROM update_cards ORDER BY published_at DESC,id')).rows)
    const off=/^admin\/updates\/([^/]+)\/deactivate$/.exec(path)
    if(off && slugPattern.test(off[1]) && method==='POST'){
      const result=await pool.query('UPDATE update_cards SET active=false WHERE slug=$1 RETURNING *',[off[1]])
      return json(result.rows[0]??null,result.rowCount?200:404)
    }
    if(path!=='admin/updates'||method!=='POST')return json(null,404)
    const card=await readBody(request,1240000)
    if(!validCard(card))invalid()
    const files=card.images.map(webp), id=randomUUID(), names=files.map((_,index)=>`${id}-${index}.webp`)
    const urls=names.map(name=>`/api/updates/images/${name}`), uploaded=[]
    try{
      for(const [index,file] of files.entries()){
        const key=`update-cards/${names[index]}`; await env.FEEDBACK.put(key,file); uploaded.push(key)
      }
      const result=await pool.query(`INSERT INTO update_cards(id,slug,kind,title,summary,how_to,images,release_sha)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[id,card.slug,card.kind,card.title,card.summary,card.how_to,JSON.stringify(urls),card.release_sha])
      return json(result.rows[0],201)
    }catch(error){
      if(uploaded.length)await env.FEEDBACK.delete(uploaded)
      if(error.code==='23505')return json({error:'slug already exists'},409)
      throw error
    }
  }
}
