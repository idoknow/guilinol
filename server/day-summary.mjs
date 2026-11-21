// Keep exact count-weighted distributions. A percentile of daily percentiles would bias small days.
const midnight="date_trunc('day',received AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'"
export const firstVisit="coalesce((context->>'returnVisit')::int=0,context->>'firstDay'=to_char(received AT TIME ZONE 'UTC','YYYY-MM-DD'))"
export const sessionColumns=`session,context->>'vid' AS vid,device,region,max(received) AS seen,
  bool_or(${firstVisit}) AS is_new,
  bool_or(NOT (${firstVisit})) AS is_returning,
  bool_or(kind='error') AS failed,sum((fields->>'count')::float) filter(where kind='contextLost') AS lost,
  max((fields->>'total')::float) filter(where kind='session') AS duration,
  bool_or(kind='chunk') AS has_chunk,bool_or(kind='window') AS has_fps,bool_or(kind='playable') AS has_playable`
export const primaryValues=`CASE WHEN kind='window' THEN 'fps' ELSE kind END AS metric,device,region,
  (CASE WHEN kind='window' THEN fields->>'fps' ELSE fields->>'ms' END)::float AS value`

export async function summarizeDays(pool){
  const client=await pool.connect()
  try{
    const {rows}=await client.query(`SELECT DISTINCT ${midnight} AS day FROM perf_event
      WHERE received >=now()-interval '91 days' AND received<date_trunc('day',(now()-interval '5 minutes') AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
      AND ${midnight} NOT IN (SELECT day FROM perf_summary_day) ORDER BY day`)
    for(const {day} of rows){
      await client.query('BEGIN')
      const added=await client.query('INSERT INTO perf_summary_day VALUES ($1) ON CONFLICT DO NOTHING RETURNING day',[day])
      if(added.rowCount){
        const range="received>=$1 AND received<$1::timestamptz+interval '24 hours'"
        await client.query(`INSERT INTO perf_session_day SELECT $1,${sessionColumns} FROM perf_event WHERE ${range} AND kind<>'probe'
          GROUP BY session,context->>'vid',device,region`,[day])
        await client.query(`INSERT INTO perf_value_day SELECT $1,${primaryValues},count(*) FROM perf_event WHERE ${range}
          AND kind IN ('chunk','window','playable') AND (CASE WHEN kind='window' THEN fields->>'fps' ELSE fields->>'ms' END) IS NOT NULL
          GROUP BY metric,device,region,value`,[day])
      }
      await client.query('COMMIT')
    }
    for(const table of ['perf_session_day','perf_value_day','perf_summary_day'])
      await client.query(`DELETE FROM ${table} WHERE day<now()-interval '91 days'`)
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
}

const dayMs=86400000
// The unaggregated edges and missing days stay on the raw event path during backfill.
export async function partitions(pool,start,end){
  const {rows}=await pool.query("SELECT day FROM perf_summary_day WHERE day >= $1 AND day <= $2 ORDER BY day",[new Date(start),new Date(end-dayMs)])
  if(!rows.length)return null
  const gaps=[]
  let at=start
  for(const {day} of rows){
    if(+day>at)gaps.push([at,+day])
    at=+day+dayMs
  }
  if(at<end)gaps.push([at,end])
  return {start:new Date(start),end:new Date(end),days:rows.map(r=>r.day),gaps}
}

function facts(part,type,metric){
  const args=[part.days]
  const sessions=type==='sessions'
  const fragments=[sessions?'SELECT * FROM perf_session_day WHERE day=ANY($1)':
    `SELECT * FROM perf_value_day WHERE day=ANY($1) ${metric?`AND metric='${metric}'`:''}`]
  for(const [lo,hi] of part.gaps){
    args.push(new Date(lo),new Date(hi))
    const range=`received >= $${args.length-1} AND received < $${args.length}`
    if(sessions)fragments.push(`SELECT ${midnight} AS day,${sessionColumns} FROM perf_event WHERE ${range} AND kind<>'probe'
      GROUP BY day,session,context->>'vid',device,region`)
    else fragments.push(`SELECT ${midnight} AS day,${primaryValues},count(*) AS n FROM perf_event WHERE ${range}
      AND ${metric?`kind='${metric==='fps'?'window':metric}'`:"kind IN ('window','playable','chunk')"} GROUP BY day,metric,device,region,value`)
  }
  return {sql:fragments.join(' UNION ALL '),args}
}

export async function sessionTotals(pool,part){
  const {sql,args}=facts(part,'sessions')
  args.push(part.end)
  const {rows}=await pool.query(`WITH facts AS (${sql}), visits AS (
    SELECT session,vid,bool_or(is_new) AS is_new,bool_or(is_returning) AS is_returning,bool_or(failed) AS failed,
      max(duration) AS duration,sum(lost) AS lost,max(seen) AS seen FROM facts GROUP BY session,vid)
    SELECT count(distinct session) AS sessions,count(distinct vid) AS visitors,count(distinct vid) filter(where is_new) AS "newVisitors",
      count(distinct vid) filter(where is_returning)::float/nullif(count(distinct vid),0) AS "returnRate",
      count(distinct session) filter(where failed)::float/nullif(count(distinct session),0) AS "errorRate",
      coalesce(sum(lost),0) AS "contextLost",count(distinct session) filter(where seen>=$${args.length}::timestamptz-interval '5 minutes') AS online,
      avg(duration) AS "durationAvg",percentile_cont(.5) within group(order by duration) AS "durationP50" FROM visits`,args)
  return rows[0]
}

export async function weighted(pool,part,metric,{series=false,group}={}){
  const {sql,args}=facts(part,'values',metric)
  const label=group?`coalesce(${group},'unknown')`:'NULL::text'
  const {rows}=await pool.query(`WITH facts AS (${sql}), bins AS (
    SELECT ${series?'day':'NULL::timestamptz'} t,${label} label,metric,value,sum(n) AS n FROM facts WHERE value IS NOT NULL GROUP BY 1,2,3,4),
    cdf AS (SELECT *,sum(n) OVER (PARTITION BY t,label,metric ORDER BY value) cumulative,
      sum(n) OVER (PARTITION BY t,label,metric) AS samples FROM bins)
    SELECT t,label,metric,max(samples)::bigint samples,${[.5,.95].map(q=>{
      const pos=`((samples-1)*${q})`
      const low=`min(value) filter(where cumulative>floor(${pos}))`,high=`min(value) filter(where cumulative>ceil(${pos}))`
      return `${low}+(${high}-${low})*(${q}*(max(samples)-1)-floor(${q}*(max(samples)-1))) AS p${q*100}`
    }).join(',')} FROM cdf GROUP BY t,label,metric ORDER BY t,label`,args)
  return rows
}
export async function membership(pool,part,metric,dim){
  const {sql,args}=facts(part,'sessions')
  const {rows}=await pool.query(`WITH facts AS (${sql}) SELECT coalesce(${dim},'unknown') AS label,count(distinct session) sessions
    FROM facts WHERE has_${metric} GROUP BY 1`,args)
  return new Map(rows.map(r=>[r.label,r.sessions]))
}
