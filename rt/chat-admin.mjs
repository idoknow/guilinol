import {randomUUID} from 'node:crypto'
import {audit,autoMute,channel,mute} from './chat.mjs'

function check(condition,status=400){if(!condition)throw Object.assign(Error(status===404?'not found':'invalid chat request'),{status})}
function integer(value,min,max){const number=Number(value);check(Number.isSafeInteger(number)&&number>=min&&number<=max);return number}
function string(value,max){check(typeof value==='string'&&value.trim()&&value.length<=max&&!value.includes('\0'));return value.trim()}
const limits={radius:[1,2000],max_length:[1,1000],near_ms:[0,600000],world_ms:[0,600000],window_hours:[1,720],threshold:[1,100]}
export async function adminRoute({path,method,params={},body={},actor},{transaction,config,provider,deliver,tell,ack,players,send}){
  let after=()=>{}
  const result=await transaction(async db=>{
    const cfg=await config(db),rows=async(sql,args=[])=>(await db.query(sql,args)).rows
    if(method==='GET'){
      const limit=integer(params.limit??50,1,200),offset=integer(params.offset??0,0,10000000)
      if(path==='settings')return {...cfg,provider:provider.name}
      if(path==='words')return rows('select * from chat_words order by id desc limit $1 offset $2',[limit,offset])
      if(path==='audit')return rows("select * from admin_audit where target_type='chat' order by id desc limit $1 offset $2",[limit,offset])
      if(path==='mutes')return params.uid?rows('select * from chat_mutes where uid=$1 order by id desc limit $2 offset $3',[integer(params.uid,1,Number.MAX_SAFE_INTEGER),limit,offset]):rows('select * from (select distinct on(uid) * from chat_mutes order by uid,id desc) latest where until_ms=-1 or until_ms>$1 order by id desc limit $2 offset $3',[Date.now(),limit,offset])
      if(path==='messages'||path==='reviews')return rows(`select m.*,case when u.id is null then null else json_build_object('id',u.id,'createdAt',u.created_at,'signupMethod',u.signup_method,'banned',u.banned_at<>0) end as account from chat_messages m left join users u on u.uid=m.uid where ($1::text is null or ch=$1) and ($2::bigint is null or m.uid=$2) and ($3::text is null or strpos(lower(name),lower($3))>0) and ($4::text is null or strpos(lower(text),lower($4))>0) and ($5::text is null or status=$5) and ($6::bigint is null or m.created_at>=$6) and ($7::bigint is null or m.created_at<=$7) order by m.id desc limit $8 offset $9`,[params.ch,params.uid,params.name,params.q,path==='reviews'?'pending':params.status,params.from,params.to,limit,offset])
      if(path==='context'){
        const [center]=await rows('select * from chat_messages where id=$1',[integer(params.mid,1,Number.MAX_SAFE_INTEGER)]);check(center,404)
        const around=(before)=>rows(`select * from chat_messages where ch=$1 and ($1='world' or (x-$2)^2+(z-$3)^2<=$4) and id ${before?'<':'>'} $5 order by id ${before?'desc':'asc'} limit $6`,[center.ch,center.x,center.z,cfg.radius**2,center.id,integer(params.n??5,1,30)])
        return [...(await around(true)).reverse(),center,...await around(false)]
      }
      check(false,404)
    }
    check(method==='POST');const reason=string(body.reason,200)
    if(path==='settings'){
      check(body.patch&&typeof body.patch==='object'&&!Array.isArray(body.patch));const next={...cfg}
      for(const [key,value] of Object.entries(body.patch)){
        if(key==='unmoderated_policy'){check(['pending','local_only'].includes(value));next[key]=value}
        else if(key==='steps_minutes'){check(Array.isArray(value)&&value.length&&value.length<=10);next[key]=value.map(item=>integer(item,1,525600))}
        else {check(Object.hasOwn(limits,key));next[key]=integer(value,...limits[key])}
      }
      await rows('update chat_settings set config=$1 where id',[next]);await audit(db,actor,path,'config',{reason,before:cfg,after:next});return {...next,provider:provider.name}
    }
    if(path==='mute'||path==='unmute'){
      const uid=integer(body.uid,1,Number.MAX_SAFE_INTEGER),minutes=path==='unmute'?0:body.minutes===-1?-1:integer(body.minutes,1,5256000)
      const event=await mute(db,uid,minutes>0?Date.now()+minutes*60000:minutes,reason,actor,'admin');after=()=>tell(uid,event)
    }else if(path==='words'||path==='words/delete'){
      const id=body.id===undefined?null:integer(body.id,1,Number.MAX_SAFE_INTEGER)
      let result
      if(path==='words/delete')result=await rows('delete from chat_words where id=$1 returning *',[id]);else{
        const word=string(body.word,100),category=string(body.category,80);check(['block','review'].includes(body.action)&&typeof body.enabled==='boolean')
        const args=[word,category,body.action,body.enabled,actor,Date.now()];result=id?await rows('update chat_words set word=$1,category=$2,action=$3,enabled=$4,actor=$5,updated_at=$6 where id=$7 returning *',[...args,id]):await rows('insert into chat_words(word,category,action,enabled,actor,updated_at) values($1,$2,$3,$4,$5,$6) returning *',args)
      }
      check(result[0],404);await audit(db,actor,path,result[0].id,{reason,word:result[0]});return result[0]
    }else if(['delete','approve','block'].includes(path)){
      const mid=integer(body.mid,1,Number.MAX_SAFE_INTEGER),status={delete:'deleted',approve:'normal',block:'blocked'}[path]
      const [row]=await rows(`update chat_messages set status=$2,processed_by=$3,processed_at=$4 where id=$1 and ${path==='delete'?"status!='deleted'":"status='pending'"} returning *`,[mid,status,actor,Date.now()]);check(row,404);await audit(db,actor,path,mid,{reason})
      let muted;if(path==='block'){muted=body.minutes===undefined?await autoMute(db,row.uid,cfg):await mute(db,row.uid,body.minutes===-1?-1:Date.now()+integer(body.minutes,1,5256000)*60000,reason,actor,'admin')}
      after=()=>{if(path==='delete'){for(const player of players.values())send(player.ws,{t:'chat_del',mid:row.id})}else{if(path==='approve')deliver(row,cfg.radius);tell(row.uid,ack(row));tell(row.uid,muted)}}
    }else if(path==='notice'){
      const ch=body.ch??'world';check(channel(ch));if(ch==='near')check(Number.isFinite(body.x)&&Number.isFinite(body.z));const text=string(body.text,1000)
      const [row]=await rows(`insert into chat_messages(ch,uid,peer,name,cid,text,x,z,status,provider,label,sys,created_at) values($1,0,'system','系统',$2,$3,$4,$5,'normal','admin','notice','notice',$6) returning *`,[ch,randomUUID(),text,body.x??0,body.z??0,Date.now()]);await audit(db,actor,path,row.id,{reason});after=()=>deliver(row,cfg.radius)
    }else check(false,404)
    return {ok:true}
  });after();return result
}
