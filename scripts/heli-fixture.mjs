import {randomBytes,createHash} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {AVATAR_KEY,defaultAvatar} from '../lib/avatar.ts'
import {database} from '../server/postgres.mjs'
import {helicopterStore} from '../server/helicopter.mjs'
import {onRequest} from '../functions/api/[[path]].ts'

export async function fixture(pool){
  await pool.query(await readFile('deploy/postgres/004-social.sql','utf8'))
  await pool.query(`UPDATE player_saves SET payload_json=jsonb_set(payload_json::jsonb,'{money}','500')::text`)
  await pool.query('UPDATE player_saves SET payload_json=(payload_json::jsonb || $1::jsonb)::text',[JSON.stringify({[AVATAR_KEY]:defaultAvatar()})])
  await pool.query(`ALTER TABLE users ADD email text DEFAULT '',ADD nickname text DEFAULT '乘客',ADD verified int DEFAULT 1,ADD role text DEFAULT 'user',ADD notify_email int DEFAULT 0,ADD email_placeholder int DEFAULT 0,ADD banned_at int DEFAULT 0,ADD ban_reason text DEFAULT ''; CREATE TABLE sessions(digest text PRIMARY KEY,user_id text,expires bigint)`)
  const tokens={}
  for(const user of ['A','B']){tokens[user]=randomBytes(32).toString('hex');await pool.query('INSERT INTO sessions VALUES($1,$2,$3)',[createHash('sha256').update(tokens[user]).digest('hex'),user,Math.floor(Date.now()/1000)+7200])}
  let offset=0
  const env={DB:database(pool),helicopter:helicopterStore(pool,()=>Date.now()+offset)}
  return {tokens,advance(ms){offset+=ms},plugin:{name:'local-queue-api',configurePreviewServer(server){server.middlewares.use(async(req,res,next)=>{
    if(!/^\/api\/(helicopter|me\/save|me\/avatar|auth\/me|me)(\?|$)/.test(req.url))return next()
    try{const bytes=[];for await(const part of req)bytes.push(part)
      const response=await onRequest({env,request:new Request('http://'+req.headers.host+req.url,{method:req.method,headers:req.headers,body:bytes.length?Buffer.concat(bytes):undefined})})
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text())
    }catch(error){next(error)}
  })}}}
}
