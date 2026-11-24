import {readFile} from 'node:fs/promises'
import {pathToFileURL} from 'node:url'

export const groups={block:'色情类型 色情词库 暴恐词库 涉枪涉爆 反动词库 政治类型 贪腐词库 广告类型'.split(' '),review:'补充词库 其他词库 民生词库 GFW补充词库 网易前端过滤敏感词库'.split(' ')}
const read=relative=>readFile(new URL(relative,import.meta.url),'utf8')
export async function seedRows(){
  const rows=new Map(),landmarks=JSON.parse(await read('../pipeline/landmarks.json'))
  for(const word of ['象鼻山','漓江','解放东路','中山中路','正阳路',...landmarks.map(item=>item.name)])rows.set(word,{word,category:'桂林地名',action:'allow',source:'guilinol'})
  for(const [action,files] of Object.entries(groups))for(const category of files){
    const lines=await read(`../third_party/sensitive-lexicon/${category}.txt`)
    for(const line of lines.split(/\r?\n/)){const word=line.trim();if(word&&!rows.has(word))rows.set(word,{word,category,action,source:'konsheng@68a595f'})}
  }
  return [...rows.values()]
}
const query=input=>`with input as (select * from jsonb_to_recordset(${input}) as row(word text,category text,action text,source text)),
  fresh as (insert into chat_seed_seen(source,word) select source,word from input on conflict do nothing returning source,word)
  insert into chat_words(word,category,action,enabled,actor,updated_at,source) select word,category,action,true,'seed',floor(extract(epoch from now())*1000),source from input join fresh using(source,word) on conflict(word) do nothing`
export async function importWords(db){return db.query(query('$1::jsonb'),[JSON.stringify(await seedRows())])}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  if(process.argv.includes('--sql')){const encoded=Buffer.from(JSON.stringify(await seedRows())).toString('base64');console.log(query(`convert_from(decode('${encoded}','base64'),'UTF8')::jsonb`)+';')}
  else{if(!process.env.DATABASE_URL)throw Error('Set DATABASE_URL to the target chat database');const {Client}=(await import('pg')).default,client=new Client({connectionString:process.env.DATABASE_URL});await client.connect();try{console.log('inserted:',(await importWords(client)).rowCount)}finally{await client.end()}}
}
