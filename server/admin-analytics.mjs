import {firstVisit,partitions,sessionTotals,weighted,membership} from './day-summary.mjs'
import {metrics} from './telemetry.mjs'

const dimensions={region:'region',city:'city',isp:'isp',device:'device',gpu:'gpu',build:'build',mode:'mode'}
for(const name of ['os','browser','language','referrer'])dimensions[name]=`context->>'${name}'`
const visit="context->>'vid'"
const countSession='count(distinct session)'
const kpis={
  sessions:countSession,visitors:`count(distinct ${visit})`,newVisitors:`count(distinct ${visit}) filter(where ${firstVisit})`,
  returnRate:`count(distinct ${visit}) filter(where NOT (${firstVisit}))::float/nullif(count(distinct ${visit}),0)`,
  errorRate:`count(distinct session) filter(where kind='error')::float/nullif(${countSession},0)`,
  contextLost:"coalesce(sum((fields->>'count')::float) filter(where kind='contextLost'),0)",
  online:`${countSession} filter(where received>=bucket_end-interval '5 minutes')`,
}
const percentile=(q,expr)=>`percentile_cont(${q}) within group(order by ${expr})`
const duration="(fields->>'total')::float"
kpis.durationAvg=`avg(${duration}) filter(where latest=1 and kind='session')`
kpis.durationP50=percentile(.5,duration)+" filter(where latest=1 and kind='session')"
const aliases={playableP50:'playable.p50',playableP95:'playable.p95',fpsP50:'fps.p50',chunkP95:'chunk.p95'}
const reliability={}
for(const kind of ['failure','retry']){
  for(const category of ['manifest','landmark','chunk']){
    reliability[kind+'.'+category]=`count(*) filter(where kind='${kind}' AND fields->>'category'='${category}')`
  }
}
const global={registrations:['users','created_at'],feedback:['feedback','submitted_at'],api5xxRate:['perf_server','minute']}
const interval={'5m':'5 minutes','1h':'1 hour','1d':'1 day'}
function measurement(name){
  const match=/^(.*)\.(p50|p95)$/.exec(Object.hasOwn(aliases,name)?aliases[name]:Object.hasOwn(metrics,name)?name+'.p50':name)
  if(!match||!Object.hasOwn(metrics,match[1]))return
  const [kind,key,api]=metrics[match[1]]
  return {base:match[1],expr:`(fields->>'${key}')::float`,where:`kind='${kind}'`+(api?` AND fields->>'api'='${api}'`:''),q:match[2]==='p50'?.5:.95}
}
const steps=['playable','loginOpen','loginSuccess','feedbackOpen','feedbackSuccess']
const invalid=()=>Response.json({error:{code:'invalid',message:'无效查询参数'}},{status:400})

export async function analytics(pool,path,params){
  const json=data=>Response.json(data,{headers:{'Cache-Control':'private, no-store'}})
  const end=params.has('to')?Date.parse(params.get('to')):Date.now(),start=params.has('from')?Date.parse(params.get('from')):end-86400000
  if(!Number.isFinite(start+end)||start>=end||end-start>90*86400000)return invalid()
  const args=[new Date(start),new Date(end)], range='received >= $1 AND received < $2'
  const rows=async(sql,values=args)=>(await pool.query(sql,values)).rows
  if(path==='admin/live'){
    const people=await rows(`WITH latest AS (SELECT DISTINCT ON(session) mode,region FROM perf_event
      WHERE received>=now()-interval '5 minutes' AND kind<>'probe' ORDER BY session,received DESC,batch_position DESC)
      SELECT mode,region,grouping(mode,region) AS level,count(*) AS n FROM latest GROUP BY GROUPING SETS ((),(mode),(region))`,[])
    const server=await rows(`SELECT minute,sample,(SELECT coalesce(sum((r->>'count')::int),0) FROM jsonb_array_elements(sample->'routes') r WHERE (r->>'status')::int>=500) AS errors5xx FROM perf_server WHERE minute>=date_trunc('minute',now())-interval '1 minute' ORDER BY minute DESC LIMIT 1`,[])
    return json({online:people.find(r=>r.level===3).n,modes:people.filter(r=>r.level===1),regions:people.filter(r=>r.level===2),server:server[0]??null})
  }
  if(path==='admin/errors')return json(await rows(`SELECT fields->>'errorKind' AS kind,fields->>'signature' AS signature,build,
    sum((fields->>'count')::int) AS count,count(distinct session) AS sessions,min(received) AS first,max(received) AS last
    FROM perf_event WHERE ${range} AND kind='error' AND fields ? 'signature' GROUP BY 1,2,3 ORDER BY count DESC LIMIT 50`))
  if(path==='admin/funnel'){
    const counts=await rows(`SELECT coalesce(fields->>'step',kind) step,count(distinct session) AS sessions FROM perf_event
      WHERE ${range} AND kind IN ('funnel','playable') GROUP BY 1`)
    return json(steps.map(step=>({step,sessions:counts.find(r=>r.step===step)?.sessions??0})))
  }
  const name=params.get('metric')??'fps.p50',m=measurement(name)
  const primary=m&&['fps','chunk','playable'].includes(m.base)
  if(path==='admin/breakdown'){
    const dim=params.get('dim')??'device'
    if(!Object.hasOwn(dimensions,dim)||!m)return invalid()
    const part=primary && ['device','region'].includes(dim) && await partitions(pool,start,end)
    if(part){
      const [stats,members]=await Promise.all([weighted(pool,part,m.base,{group:dim}),membership(pool,part,m.base,dim)])
      return json(stats.map(({label,p50,p95,samples})=>({label,p50,p95,samples,sessions:members.get(label)})).sort((a,b)=>b.samples-a.samples||a.label.localeCompare(b.label)))
    }
    return json(await rows(`SELECT coalesce(${dimensions[dim]},'unknown') label,count(*) samples,${countSession} sessions,
      ${percentile(.5,m.expr)} p50,${percentile(.95,m.expr)} p95 FROM perf_event
      WHERE ${range} AND ${m.where} AND ${m.expr} IS NOT NULL GROUP BY 1 ORDER BY samples DESC,label`))
  }

  const overview=path==='admin/overview',group=params.get('group'),bucket=params.get('bucket')??'1h'
  if(!Object.hasOwn(interval,bucket)||group&&!['device','region'].includes(group))return invalid()
  const names=overview?[...Object.keys(kpis),...Object.keys(aliases),...Object.keys(global)]:[name]
  if(!overview&&!m&&!Object.hasOwn(kpis,name)&&!Object.hasOwn(reliability,name)&&!Object.hasOwn(global,name))return invalid()
  const values=overview?[new Date(start-(end-start)),args[1],args[0]]:args
  const time=col=>overview?`CASE WHEN ${col}<$3 THEN $1::timestamptz ELSE $3::timestamptz END`:`date_bin(interval '${interval[bucket]}',${col},'2000-01-01 UTC')`
  const result=[]
  const eventNames=names.filter(key=>!Object.hasOwn(global,key))
  if(!overview && primary && bucket==='1d'){
    const part=await partitions(pool,start,end)
    if(part){
      const data=await weighted(pool,part,m.base,{series:true,group})
      const totals=new Map()
      for(const row of data)totals.set(row.label,(totals.get(row.label)??0)+row.samples)
      const top=[...totals.keys()].sort((a,b)=>totals.get(b)-totals.get(a)||String(a).localeCompare(String(b))).slice(0,6)
      return json(data.filter(r=>top.includes(r.label)).map(r=>({t:r.t,value:m.q===.5?r.p50:r.p95,samples:r.samples,...(group?{group:r.label}:{})})))
    }
  }
  if(overview){
    // Use daily facts even when one comparison period is empty or entirely raw.
    const current=await partitions(pool,start,end),previous=await partitions(pool,start-(end-start),start)
    if(current||previous){
      for(const [summary,lo,hi] of [[previous,start-(end-start),start],[current,start,end]]){
        const part=summary??{start:new Date(lo),end:new Date(hi),days:[],gaps:[[lo,hi]]}
        const [counts,stats]=await Promise.all([sessionTotals(pool,part),weighted(pool,part,null)])
        for(const [key,value] of Object.entries(counts))result.push({key,t:part.start,value})
        for(const [key,metric] of Object.entries(aliases)){
          const [base,q]=metric.split('.')
          result.push({key,t:part.start,value:stats.find(r=>r.metric===base)?.[q]??null})
        }
      }
      eventNames.length=0
    }
  }
  if(eventNames.length){
    const rankings=eventNames.some(k=>k.startsWith('duration'))?',row_number() OVER(PARTITION BY t,label,session,kind ORDER BY received DESC) AS latest':''
    const fields=eventNames.map((key,i)=>{
      const metric=measurement(key)
      return (metric?percentile(metric.q,metric.expr)+` filter(where ${metric.where})`:(kpis[key]??reliability[key]))+` AS "v${i}"`
    })
    const predicate=!overview&&m?' AND '+m.where+' AND '+m.expr+' IS NOT NULL':!overview&&name.startsWith('duration')?" AND kind='session'":" AND kind<>'probe'"
    const data=await rows(`WITH events AS (SELECT received,fields,session,kind,context,${time('received')} AS t,
      ${group?`coalesce(${group},'unknown')`:'NULL::text'} AS label FROM perf_event WHERE ${range}${predicate}),
      ranked AS (SELECT *,${overview?'CASE WHEN t=$1 THEN $3::timestamptz ELSE $2::timestamptz END':`least(t+interval '${interval[bucket]}',$2::timestamptz)`} AS bucket_end${rankings} FROM events),
      series AS (SELECT t,label,${fields.join(',')},count(*) AS samples FROM ranked GROUP BY t,label)
      SELECT * FROM series ${group?'WHERE label IN (SELECT label FROM series GROUP BY label ORDER BY sum(samples) DESC,label LIMIT 6)':''} ORDER BY t,label`,values)
    for(const row of data)eventNames.forEach((key,i)=>result.push({key,t:row.t,value:row['v'+i],samples:row.samples,...(group?{group:row.label}:{})}))
  }
  for(const key of names.filter(k=>Object.hasOwn(global,k))){
    const [table,col]=global[key],server=key==='api5xxRate',stamp=server?col:`to_timestamp(${col})`
    const expr=server?`sum(CASE WHEN (r->>'status')::int>=500 THEN (r->>'count')::int ELSE 0 END)::float/nullif(sum((r->>'count')::int),0)`:'count(*)'
    const data=await rows(`SELECT ${time(stamp)} t,${expr} value,${server?"sum((r->>'count')::bigint)::bigint":'count(*)'} samples FROM ${table} ${server?"CROSS JOIN LATERAL jsonb_array_elements(sample->'routes') r":''}
      WHERE ${stamp}>=$1 AND ${stamp}<$2 GROUP BY 1 ORDER BY 1`,values)
    result.push(...data.map(row=>({...row,key,...(group?{group:'unknown'}:{})})))
  }
  if(!overview)return json(result.map(({key,...row})=>row))
  if(end-start<300000){
    for(const hi of [start,end]){
      const [row]=await rows("SELECT count(distinct session) AS n FROM perf_event WHERE received >= $1 AND received < $2 AND kind<>'probe'",[new Date(hi-300000),new Date(hi)])
      const item=result.find(r=>r.key==='online'&&+r.t===hi-(end-start))
      if(item)item.value=row.n
      else result.push({key:'online',t:new Date(hi-(end-start)),value:row.n})
    }
  }
  return json(Object.fromEntries(names.map(key=>{
    const items=result.filter(r=>r.key===key),fallback=['online','sessions','visitors','newVisitors','contextLost','registrations','feedback'].includes(key)?0:null
    return [key,{current:items.find(r=>+r.t===start)?.value??fallback,previous:items.find(r=>+r.t<start)?.value??fallback}]
  })))
}
