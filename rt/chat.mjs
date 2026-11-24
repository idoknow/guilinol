import pg from 'pg'
import {randomUUID} from 'node:crypto'
import {setTimeout as delay} from 'node:timers/promises'
import {wechat,moderate} from './chat-provider.mjs'
import {adminRoute} from './chat-admin.mjs'

export const channel=ch=>ch==='near'||ch==='world'
const packet=row=>({t:'chat',mid:row.id,ch:row.ch,id:row.peer,uid:Number(row.uid),name:row.name,text:row.text,ts:Number(row.created_at),...(row.sys?{sys:row.sys}:{})})
const ack=row=>({t:'chat_ack',cid:row.cid,mid:row.id,ok:row.status==='normal',...(row.status==='normal'?{}:{code:row.status==='deleted'?'error':row.status}),...(row.status==='blocked'?{msg:'消息包含违规内容，无法发送'}:{})})
export async function audit(db,actor,action,target,detail){await db.query('insert into admin_audit(actor_id,action,target_type,target_id,detail) values($1,$2,\'chat\',$3,$4)',[actor,'chat.'+action,String(target),detail])}
export async function mute(db,uid,until,reason,actor,source){
  await db.query('insert into chat_mutes(uid,until_ms,reason,actor,source,created_at) values($1,$2,$3,$4,$5,$6)',[uid,until,reason,actor,source,Date.now()]);await audit(db,actor,until?'mute':'unmute',uid,{reason,until,source})
  return {t:'chat_mute',until,reason}
}
export async function autoMute(db,uid,cfg){
  const since=Date.now()-cfg.window_hours*3600000
  const {rows:[counts]}=await db.query(`select (select count(*) from chat_messages where uid=$1 and status='blocked' and coalesce(processed_at,created_at)>=$2)::int as violations,(select count(*) from chat_mutes where uid=$1 and source='auto' and created_at>=$2)::int as steps`,[uid,since])
  if(counts.violations>=cfg.threshold)return mute(db,uid,Date.now()+60000*cfg.steps_minutes[Math.min(counts.steps,cfg.steps_minutes.length-1)],'多次发送违规消息','system','auto')
}
const activeMute=async(db,uid)=>{
  const {rows:[last]}=await db.query('select until_ms,reason from chat_mutes where uid=$1 order by id desc limit 1',[uid]);const until=Number(last?.until_ms)
  if(until===-1||until>Date.now())return {t:'chat_mute',until,reason:last.reason}
}

export function createChat({players,send,observed,env=process.env,provider=wechat(env)}){
  const pool=new pg.Pool({connectionString:env.DATABASE_URL,max:4,connectionTimeoutMillis:1500});pool.on('error',()=>{})
  let chain=Promise.resolve(),backlog=0
  let cache=null,radius=60
  const capacity={near:3000,world:30}
  async function restore(){
    if(cache)return
    const cfg=await config(pool);const entries=await Promise.all(Object.entries(capacity).map(async([ch,limit])=>{
      const {rows}=await pool.query("select * from chat_messages where status='normal' and ch=$1 order by id desc limit $2",[ch,limit]);return [ch,rows.reverse()]
    }));cache=Object.fromEntries(entries);radius=cfg.radius
  }
  const live=uid=>[...players.values()].find(player=>Number(player.uid)===Number(uid))
  const tell=(uid,event)=>{const player=live(uid);if(player&&event)send(player.ws,event)}
  function deliver(row,radius){
    if(cache){const entries=cache[row.ch];entries.push(row);entries.sort((left,right)=>Number(left.id)-Number(right.id));if(entries.length>capacity[row.ch])entries.shift()}
    const msg=packet(row)
    for(const player of players.values())if(row.ch==='world'||Math.hypot(player.x-row.x,player.z-row.z)<=radius)send(player.ws,msg)
    const sender=live(row.uid);if(sender)observed(sender,row.text)
  }
  function serial(work){const task=chain.then(work);chain=task.catch(()=>{});return task}
  const byUid=new Map()
  async function retryDb(work){
    for(;;)try{return await work()}catch(error){if(error.code?.startsWith('22'))throw error;await delay(750)}
  }
  async function transaction(work){const db=await pool.connect();try{await db.query('begin');const result=await work(db);await db.query('commit');return result}catch(error){await db.query('rollback').catch(()=>{});throw error}finally{db.release()}}
  const config=async db=>(await db.query('select config from chat_settings where id')).rows[0].config
  function submit(player,msg){
    const {x,z,id:peer,name,uid,openid}=player,ts=Date.now(),ch=msg.ch===undefined?'world':msg.ch,cid=msg.cid??randomUUID(),text=typeof msg.text==='string'?msg.text.trim():''
    const reject=code=>send(player.ws,{t:'chat_ack',cid:typeof cid==='string'?cid.slice(0,100):'',ok:false,code})
    if(!env.DATABASE_URL||!channel(ch)||!text||text.includes('\0')||typeof cid!=='string'||!/^[-\w:.]{1,100}$/.test(cid))return reject('error')
    if(backlog>=1024||(player.pendingChat??0)>=4)return reject('rate')
    backlog++;player.pendingChat=(player.pendingChat??0)+1
    const task=(byUid.get(uid)??Promise.resolve()).then(async()=>{
        const priorRow=async db=>(await db.query('select * from chat_messages where uid=$1 and cid=$2',[uid,cid])).rows[0]
        const pre=await retryDb(()=>serial(async()=>{
          const db=pool,prior=await priorRow(db);if(prior)return {reply:ack(prior)}
          const cfg=await config(db)
          if([...text].length>cfg.max_length)return {code:'too_long'}
          const muted=await activeMute(db,uid);if(muted)return {code:'muted',muted}
          const {rows:[last]}=await db.query('select created_at from chat_messages where uid=$1 and ch=$2 order by id desc limit 1',[uid,ch]);if(last&&ts-Number(last.created_at)<cfg[ch+'_ms'])return {code:'rate'}
          const words=(await db.query('select * from chat_words where enabled')).rows
          return {cfg,words}
        }))
        if(pre.reply)return send(player.ws,pre.reply)
        if(pre.code){tell(uid,pre.muted);return reject(pre.code)}
        const {cfg,words}=pre,decision=await moderate({text,openid},words,cfg.unmoderated_policy,provider)
        await serial(async()=>{
          let committing
          const result=await retryDb(async()=>{await restore();return transaction(async db=>{
          if(committing){const prior=await priorRow(db);if(prior?.id===committing.row.id)return committing}
          const muted=await activeMute(db,uid);if(muted)return {code:'muted',muted}
          const {rows:[row]}=await db.query(`insert into chat_messages(ch,uid,peer,name,cid,text,x,z,status,provider,label,summary,created_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning *`,[ch,uid,peer,name,cid,text,x,z,decision.status,decision.provider,decision.label,decision.summary,ts]);committing={reply:ack(row),row,radius:cfg.radius,muted:row.status==='blocked'?await autoMute(db,uid,cfg):null};return committing
          })})
        if(result.row?.status==='normal')deliver(result.row,result.radius)
        tell(uid,result.muted);if(result.code)reject(result.code);else send(player.ws,result.reply)
        })
    }).catch(()=>reject('error')).finally(()=>{backlog--;player.pendingChat--;if(byUid.get(uid)===task)byUid.delete(uid)})
    byUid.set(uid,task)
  }
  async function history(player,ch){
    if(!channel(ch)||!env.DATABASE_URL)return
    player.chatReading??=new Set();if(player.chatReading.has(ch))return;player.chatReading.add(ch)
    try{if(!cache)await serial(restore);send(player.ws,{t:'chat_hist',ch,msgs:cache[ch].filter(row=>ch==='world'||Math.hypot(player.x-row.x,player.z-row.z)<=radius).slice(-30).map(packet)})}catch{send(player.ws,{t:'chat_ack',ok:false,code:'error'})}finally{player.chatReading.delete(ch)}
  }
  return {submit,history,backlog:()=>backlog,async joined(player){if(env.DATABASE_URL)try{const event=await activeMute(pool,player.uid);if(event)send(player.ws,event)}catch{}},admin:args=>serial(async()=>{
    const result=await adminRoute(args,{transaction,config,provider,deliver,tell,ack,players,send});if(args.path==='settings')radius=result.radius;if(args.path==='delete')cache=null;return result
  })}
}
