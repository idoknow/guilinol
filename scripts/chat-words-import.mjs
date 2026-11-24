import {readFile} from 'node:fs/promises'
import {pathToFileURL} from 'node:url'
import {fold} from '../rt/chat-matcher.mjs'

export const groups={block:'色情类型 色情词库 暴恐词库 涉枪涉爆 反动词库 政治类型 贪腐词库 广告类型'.split(' '),review:'补充词库 其他词库 民生词库 GFW补充词库'.split(' ')}
const read=relative=>readFile(new URL(relative,import.meta.url),'utf8')
const policy=JSON.parse(await read('../third_party/sensitive-lexicon/overrides.json'))
const overrides=new Map(policy.rules.flatMap(rule=>rule.words.map(word=>[fold(word),rule.action])))
export async function seedRows(){
  const rows=new Map(),landmarks=JSON.parse(await read('../pipeline/landmarks.json'))
  for(const word of ['象鼻山','漓江','解放东路','中山中路','正阳路',...landmarks.map(item=>item.name)])rows.set(word,{word,category:'桂林地名',action:'allow',source:'guilinol'})
  for(const [action,files] of Object.entries(groups))for(const category of files){
    const lines=await read(`../third_party/sensitive-lexicon/${category}.txt`)
    for(const line of lines.split(/\r?\n/)){
      const word=line.trim(),key=fold(word),override=overrides.get(key),length=[...key].length
      if(!length||rows.has(word)||override==='skip'||(/^[\x00-\x7f]+$/.test(key)&&length<4)||(action==='review'&&length<3))continue
      rows.set(word,{word,category,action:override??action,source:override?policy.source:'konsheng@68a595f'})
    }
  }
  for(const rule of policy.rules)if(rule.action==='block')for(const word of rule.words)rows.set(word,{word,action:'block',category:'项目规则',source:policy.source})
  return [...rows.values()]
}
const query=input=>`with input as (select * from jsonb_to_recordset(${input}) as row(word text,category text,action text,source text)),
  rollout as (insert into chat_seed_seen(source,word) values('policy','${policy.revision}') on conflict do nothing returning 1),
  retired as (delete from chat_words old where exists(select 1 from rollout) and old.source='konsheng@68a595f' and old.actor='seed' and old.enabled and not exists(select 1 from input where word=old.word) returning word),
  revised as (update chat_words old set action=input.action,source=input.source,updated_at=floor(extract(epoch from now())*1000) from input where exists(select 1 from rollout) and old.word=input.word and old.source='konsheng@68a595f' and old.actor='seed' and old.enabled and input.source='guilinol' returning old.word),
  logged as (insert into admin_audit(actor_id,action,target_type,target_id,detail) select 'seed','chat.lexicon_policy','chat','${policy.revision}',jsonb_build_object('reason','降低普通聊天误判','rules',convert_from(decode('${Buffer.from(JSON.stringify(policy.rules)).toString('base64')}','base64'),'UTF8')::jsonb,'dropped',(select count(*) from retired),'revised',(select count(*) from revised)) from rollout),
  fresh as (insert into chat_seed_seen(source,word) select source,word from input on conflict do nothing returning source,word)
  insert into chat_words(word,category,action,enabled,actor,updated_at,source) select word,category,action,true,'seed',floor(extract(epoch from now())*1000),source from input join fresh using(source,word) on conflict(word) do nothing`
export async function importWords(db){return db.query(query('$1::jsonb'),[JSON.stringify(await seedRows())])}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  if(process.argv.includes('--sql')){const encoded=Buffer.from(JSON.stringify(await seedRows())).toString('base64');console.log(query(`convert_from(decode('${encoded}','base64'),'UTF8')::jsonb`)+';')}
  else{if(!process.env.DATABASE_URL)throw Error('Set DATABASE_URL to the target chat database');const {Client}=(await import('pg')).default,client=new Client({connectionString:process.env.DATABASE_URL});await client.connect();try{console.log('inserted:',(await importWords(client)).rowCount)}finally{await client.end()}}
}
