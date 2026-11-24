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
const hourMs=3600000
/** 把已覆盖的整段（整日或整小时）与请求范围做差，得到必须裸扫 perf_event 的空档 */
function gapsOf(start,end,marks,step){
  const gaps=[]
  let at=start
  for(const mark of marks){if(mark>at)gaps.push([at,mark]);at=mark+step}
  if(at<end)gaps.push([at,end])
  return gaps
}
// The unaggregated edges and missing days stay on the raw event path during backfill.
/**
 * 滚动窗口（24h、48h）永远对不齐整日边界，用整日表一天都覆盖不上，会直接退化成扫全部原始
 * 事件（实测 24h 总览 20s，并撞上连接池 15s 查询超时 → 前端「服务暂时不可用」）。
 * 所以 3 天以内按小时汇总，裸扫段最多 1 小时；更长窗口再退回整日表（行数少一个量级）。
 */
export async function partitions(pool,start,end){
  if(end-start<=3*dayMs){
    const {rows}=await pool.query(`SELECT hour FROM perf_summary_hour
      WHERE hour >= date_trunc('hour',$1::timestamptz) AND hour < $2::timestamptz ORDER BY hour`,[new Date(start),new Date(end)])
    const hours=rows.map(row=>+row.hour).filter(hour=>hour>=start&&hour+hourMs<=end)
    if(hours.length)return {grain:'hour',start:new Date(start),end:new Date(end),days:hours.map(hour=>new Date(hour)),gaps:gapsOf(start,end,hours,hourMs)}
  }
  const {rows}=await pool.query("SELECT day FROM perf_summary_day WHERE day >= date_trunc('day',$1::timestamptz) AND day < date_trunc('day',$2::timestamptz) ORDER BY day",[new Date(start),new Date(end)])
  const days=rows.map(row=>+row.day).filter(day=>day>=start&&day+dayMs<=end)
  if(!days.length)return null
  return {grain:'day',start:new Date(start),end:new Date(end),days:days.map(day=>new Date(day)),gaps:gapsOf(start,end,days,dayMs)}
}

function facts(part,type,metric){
  const args=[part.days]
  const sessions=type==='sessions'
  // 粒度由 partitions() 决定：小时表支持任意滚动窗口，整日表只用于 ≥3 天的长窗口
  const stamp=part.grain==='hour'?'hour':'day'
  const fragments=[sessions?`SELECT * FROM perf_session_${stamp} WHERE ${stamp}=ANY($1)`:
    `SELECT * FROM perf_value_${stamp} WHERE ${stamp}=ANY($1) ${metric?`AND metric='${metric}'`:''}`]
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
  const {rows}=await pool.query(`WITH facts AS MATERIALIZED (${sql}), visits AS (
    SELECT session,bool_or(failed) AS failed,max(duration) AS duration,sum(lost) AS lost,max(seen) AS seen
    FROM facts GROUP BY session), visitors AS (
    SELECT vid::uuid,bool_or(is_new) AS is_new,bool_or(is_returning) AS is_returning
    FROM facts WHERE vid IS NOT NULL GROUP BY vid::uuid)
    SELECT * FROM (SELECT count(*) AS sessions,avg(failed::int)::float AS "errorRate",coalesce(sum(lost),0) AS "contextLost",
      count(*) filter(where seen>=$${args.length}::timestamptz-interval '5 minutes') AS online,
      avg(duration) AS "durationAvg",percentile_cont(.5) within group(order by duration) AS "durationP50" FROM visits) s
    CROSS JOIN (SELECT count(*) AS visitors,count(*) filter(where is_new) AS "newVisitors",
      avg(coalesce(is_returning,false)::int)::float AS "returnRate" FROM visitors) v`,args)
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

/**
 * 按小时汇总最近 N 小时（默认 48h）。最近 2 小时每次重算：迟到的事件会落进已经算过的桶，
 * 只补「没算过的整点」会永久漏掉这部分数据。每小时的结果只落三张表，体积远小于原始事件。
 */
export async function summarizeHours(pool,{hours=48}={}){
  const client=await pool.connect()
  try{
    const recent="date_trunc('hour',now())-interval '2 hours'"
    for(const table of ['perf_session_hour','perf_value_hour','perf_summary_hour'])
      await client.query(`DELETE FROM ${table} WHERE hour>=${recent}`)
    const {rows}=await client.query(`SELECT DISTINCT date_trunc('hour',received) AS hour FROM perf_event
      WHERE received>=now()-($1||' hours')::interval AND received<date_trunc('hour',now())
      AND date_trunc('hour',received) NOT IN (SELECT hour FROM perf_summary_hour) ORDER BY hour`,[String(hours)])
    for(const {hour} of rows){
      await client.query('BEGIN')
      const added=await client.query('INSERT INTO perf_summary_hour VALUES ($1) ON CONFLICT DO NOTHING RETURNING hour',[hour])
      if(added.rowCount){
        const range="received>=$1 AND received<$1::timestamptz+interval '1 hour'"
        await client.query(`INSERT INTO perf_session_hour SELECT $1,${sessionColumns} FROM perf_event WHERE ${range} AND kind<>'probe'
          GROUP BY session,context->>'vid',device,region`,[hour])
        await client.query(`INSERT INTO perf_value_hour SELECT $1,${primaryValues},count(*) FROM perf_event WHERE ${range}
          AND kind IN ('chunk','window','playable') AND (CASE WHEN kind='window' THEN fields->>'fps' ELSE fields->>'ms' END) IS NOT NULL
          GROUP BY metric,device,region,value`,[hour])
      }
      await client.query('COMMIT')
    }
    for(const table of ['perf_session_hour','perf_value_hour','perf_summary_hour'])
      await client.query(`DELETE FROM ${table} WHERE hour<now()-interval '7 days'`)
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
}
