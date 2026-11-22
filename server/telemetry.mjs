import {randomUUID, createHmac, randomBytes} from 'node:crypto'
import {isIP} from 'node:net'

const numeric = 'cores memory width height dpr rtt downlink ms dns tcp tls ttfb dcl load count bytes cache p50 p95 fps frameP95 longFrames calls triangles geometries textures chunks heap total status'.split(' ')
const sessionKeys=['total','visible','grids','teleports','mapOpens',...['walk','menu','fly','drive','map'].flatMap(m=>[m+'Meters',m+'Seconds'])]
numeric.push(...sessionKeys,'returnVisit','maxTextureSize','webgl2','lcp','inp','cls','fcp')
const labels = {vid:/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,firstDay:/^\d{4}-\d\d-\d\d$/,language:/^[a-z]{2,8}$/,referrer:/^(direct|internal|social|search|other)$/,
  signature:/^[a-f0-9]{8}$/,errorKind:/^(error|rejection|webgl|chunk)$/,step:/^(loginOpen|loginSuccess|feedbackOpen|feedbackSuccess)$/,source:/^probe$/,node:/^(cn-gz-tencent-02|cn-sh-tencent-01)$/,target:/^(home|manifest|chunk[1-5]|health)$/,cfCache:/^(|HIT|MISS|BYPASS|EXPIRED|STALE|UPDATING|REVALIDATED|DYNAMIC)$/,device:/^(desktop|mobile)$/,os:/^(Android|iPhone|iPad|Windows|Mac OS X|Linux|other)$/i,browser:/^(Edg|Firefox|Chrome|Safari|other)$/,
  playMode:/^(tour|story)$/,mode:/^(menu|walk|fly|map|drive)$/,grid:/^(|-?\d{1,6},-?\d{1,6})$/,category:/^(manifest|landmark|chunk|basis|other)$/,
  api:/^(feedback|login|other)$/,effectiveType:/^(slow-2g|2g|3g|4g)$/,quality:/^default$/,build:/^[a-f0-9]{40}$/,world:/^[a-f0-9]{64}$/,
  gpu:/^[\p{L}\p{N} (),.:_+/@\[\]-]{1,160}$/u,kind:/^(firstFrame|playable|navigation|window|chunk|teleport|switch|mapOpen|resource|api|contextLost|error|probe|session|vitals|retry|failure|funnel)$/}
const contextKeys = new Set('vid firstDay returnVisit language referrer maxTextureSize webgl2 source node device os browser cores memory width height dpr effectiveType rtt downlink quality build world gpu'.split(' '))
function valid(fields,context) {
  return fields && typeof fields==='object' && !Array.isArray(fields) && Object.entries(fields).every(([k,v])=>
    contextKeys.has(k)===context && (numeric.includes(k)?Number.isFinite(v)&&v>=0&&v<=1e15:
      Object.hasOwn(labels,k)&&typeof v==='string'&&labels[k].test(v)))
}
const eventFields = {
  session:[...sessionKeys,'playMode'],vitals:['lcp','cls','inp','fcp'],retry:['category'],failure:['category'],funnel:['step'],
  probe:['target','dns','tcp','tls','ttfb','total','status'],
  navigation:['dns','tcp','tls','ttfb','dcl','load'],resource:['category','count','bytes','cache','p50','p95','cfCache'],
  window:['fps','frameP95','longFrames','calls','triangles','geometries','textures','chunks','heap'],
  api:['ms','api'],error:['count','signature','errorKind'],contextLost:['count']
}
for(const kind of ['firstFrame','playable','chunk','teleport','switch','mapOpen'])eventFields[kind]=['ms']
function validRow(row) {
  if(!valid(row,false)||!Object.hasOwn(eventFields,row.kind))return false
  const fields=eventFields[row.kind]
  return (row.kind==='vitals'?fields.some(k=>Object.hasOwn(row,k)):Object.hasOwn(row,fields[0])) && Object.keys(row).every(k=>['kind','mode','grid'].includes(k)||fields.includes(k))
    && (row.cache===undefined || row.cache<=1)
}
export function validate({sid,context,rows}) {
  const probe=context?.source==='probe'
  return typeof sid==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(sid)
    &&valid(context,true)&&[undefined,0,1].includes(context.returnVisit)&&[undefined,0,1].includes(context.webgl2)&&Array.isArray(rows)&&rows.length>0&&rows.length<=100&&rows.every(row=>{
      if(!validRow(row))return false
      if(!probe)return !context.node && row.kind!=='probe'
      return row.kind==='probe' && !!context.node && eventFields.probe.every(key=>Object.hasOwn(row,key))
        && Number.isInteger(row.status) && (row.status===0 || row.status>=100 && row.status<600)
    })
}
const salt=randomBytes(32), limits=new Map()
let expires=0
function allow(ip) {
  if(Date.now()>expires){limits.clear();expires=Date.now()+60000}
  const key=createHmac('sha256',salt).update(ip).digest('hex'), n=limits.get(key)??0
  if(n>=90||(!n&&limits.size>=8192))return false
  limits.set(key,n+1);return true
}
export async function receive(request,pool,origin) {
  if(request.method!=='POST')return new Response(null,{status:405})
  if(request.headers.get('Origin') && request.headers.get('Origin')!==origin)return new Response(null,{status:403})
  const ip=request.headers.get('CF-Connecting-IP')??''
  if(!allow(ip))return new Response(null,{status:429})
  const chunks=[]
  let length=0
  for await(const part of request.body??[]) {
    length+=part.length
    if(length>4096)return new Response(null,{status:413})
    chunks.push(part)
  }
  let body
  try {body=JSON.parse(Buffer.concat(chunks));if(!validate(body))throw Error()}catch{return new Response(null,{status:400})}
  const cf=request.headers.get('CF-IPCountry')??''
  const {sid,context:c,rows}=body
  await pool.query(`WITH location AS (
    SELECT country,region,city,isp FROM perf_network WHERE prefix >>= $1::inet ORDER BY masklen(prefix) DESC LIMIT 1
  ) INSERT INTO perf_event(batch,session,build,world,device,gpu,country,region,city,isp,kind,mode,grid,context,fields,batch_position)
  SELECT $2,$3,$4,$5,$6,$7,coalesce(location.country,$8),region,city,isp,e->>'kind',e->>'mode',nullif(e->>'grid',''),$9,e,ord
  FROM jsonb_array_elements($10::jsonb) WITH ORDINALITY AS events(e,ord) LEFT JOIN location ON true`,[isIP(ip)?ip:null,randomUUID(),sid,c.build,c.world,c.device,c.gpu,
    /^[A-Z]{2}$/.test(cf)?cf:null,c,JSON.stringify(rows)])
  return new Response(null,{status:204})
}

export const metrics={fps:['window','fps'],frameP95:['window','frameP95'],chunk:['chunk','ms'],playable:['playable','ms'],firstFrame:['firstFrame','ms'],
  teleport:['teleport','ms'],switch:['switch','ms'],mapOpen:['mapOpen','ms'],api:['api','ms'],resource:['resource','p95']}
for(const k of ['dns','tcp','tls','ttfb','dcl','load'])metrics[k]=['navigation',k]
for(const k of ['calls','triangles','geometries','textures','heap','chunks','longFrames'])metrics[k]=['window',k]
for(const k of ['p50','p95','cache','bytes','count'])metrics['resource.'+k]=['resource',k]
for(const k of ['dns','tcp','tls','ttfb','total'])metrics['probe.'+k]=['probe',k]
for(const k of ['login','feedback','other'])metrics['api.'+k]=['api','ms',k]
for(const key of ['lcp','cls','fcp','inp'])metrics[key]=['vitals',key]
for(const field of sessionKeys)metrics['session.'+field]=['session',field]
for(const k of ['error','contextLost'])metrics[k]=[k,'count']
export async function queryPerf(pool,path,params) {
  const end=params.has('to')?Date.parse(params.get('to')):Date.now()
  const start=params.has('from')?Date.parse(params.get('from')):end-86400000
  const invalid=()=>Response.json({error:{message:'无效查询参数'}},{status:400})
  if(!Number.isFinite(start+end)||start>=end||end-start>90*86400000)return invalid()
  const args=[new Date(start),new Date(end)]
  let sql
  if(path==='admin/perf/server')sql='SELECT minute,sample FROM perf_server WHERE minute >= $1 AND minute < $2 ORDER BY minute'
  else if(path==='admin/perf/grid'){
    args.push(params.get('world'))
    sql=`SELECT grid,count(distinct session) AS visits,
      percentile_cont(.5) within group(order by (fields->>'fps')::float) filter(where kind='window') AS fps_p50,
      percentile_cont(.95) within group(order by (fields->>'ms')::float) filter(where kind='chunk') AS chunk_p95
      FROM perf_event WHERE received >= $1 AND received < $2 AND grid IS NOT NULL AND ($3::text IS NULL OR world=$3) GROUP BY grid ORDER BY grid`
  }else{
    const group=params.get('group')??'device',metric=params.get('metric')??'fps'
    const dimensions={region:'region',isp:'isp',device:'device',gpu:'gpu',build:'build',world:'world',mode:'mode'}
    if(metric.startsWith('probe.'))Object.assign(dimensions,{node:"context->>'node'",target:"fields->>'target'"})
    if(!Object.hasOwn(dimensions,group)||!Object.hasOwn(metrics,metric))return invalid()
    const [kind,key,api]=metrics[metric]
    args.push(kind,key,api??null)
    sql=`SELECT coalesce(dimension,'unknown') AS label,count(v) AS samples,
      percentile_cont(.5) within group(order by v) AS p50,percentile_cont(.75) within group(order by v) AS p75,
      percentile_cont(.95) within group(order by v) AS p95 FROM (
      SELECT ${dimensions[group]} AS dimension,(fields->>$4)::float AS v FROM perf_event WHERE received >= $1 AND received < $2 AND kind=$3 AND ($5::text IS NULL OR fields->>'api'=$5)
      ) s WHERE v IS NOT NULL GROUP BY 1 ORDER BY 1`
  }
  return Response.json({items:(await pool.query(sql,args)).rows},{headers:{'Cache-Control':'private, no-store'}})
}
