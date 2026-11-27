import {summarizeDays,summarizeHours} from './day-summary.mjs'
import {monitorEventLoopDelay} from 'node:perf_hooks'
import {readFile} from 'node:fs/promises'

// Logarithmic buckets with 8 subdivisions per octave. Memory is independent of QPS.
export class Histogram {
  bins=new Uint32Array(224)
  count=0
  add(ms) {
    const index=Math.min(this.bins.length-1,Math.ceil(8*Math.log2(1+Math.max(0,ms))))
    this.bins[index]++
    this.count++
  }
  percentile(p) {
    let target=Math.ceil(this.count*p)
    if(!target)return null
    for(let i=0;i<this.bins.length;i++)if((target-=this.bins[i])<=0)return Math.round((2**(i/8)-1)*100)/100
  }
}
export function route(path){
  if(/^\/api\/(?:me|unsubscribe|health|ready|live|t|smoke|gfx|npc|auth\/(?:register|resend|verify|reset|login|logout)|admin\/(?:stats|signups|users|feedback|overview|timeseries|breakdown|funnel|errors|live|audit|smoke|gfx|npc|updates|perf(?:\/grid|\/server)?|mp(?:\/(?:history|sessions|activities|gameplay|kick))?)|bridge\/pending|feedback)$/.test(path))return path
  if(/^\/api\/admin\/chat\/(?:messages|reviews|mutes|words(?:\/delete)?|settings|audit|context|mute|unmute|delete|approve|block|notice)$/.test(path))return path
  if(/^\/api\/admin\/users\/[\w-]+\/(?:role|ban|unban|merge|password|email)$/.test(path))return '/api/admin/users/:id/'+path.split('/').at(-1)
  if(/^\/api\/admin\/users\/[\w-]+$/.test(path))return '/api/admin/users/:id'
  const detail=/^(\/api\/(?:admin\/|bridge\/)?feedback)\/[\w-]+(?:\/(submit|supplement|status|messages|relayed|bind|view-shot|photos\/\d+))?$/.exec(path)
  if(detail)return detail[1]+'/:id'+(detail[2]?'/'+detail[2].replace(/\d+$/,':n'):'')
  if(/^\/api\/(bridge|feedback)\/comparisons\/[a-f0-9]{64}$/.test(path))return path.split('/').slice(0,-1).join('/')+'/:sha'
  return '/api/other'
}
const read=path=>readFile(path,'utf8').catch(()=>null)
async function nginx() {
  try {
    const r=await fetch('http://127.0.0.1:8081/status',{signal:AbortSignal.timeout(1500)})
    const match=/Active connections:\s*(\d+)[\s\S]*?\n\s*\d+\s+\d+\s+(\d+)/.exec(await r.text())
    if(match)return {connections:Number(match[1]),requests:Number(match[2])}
  }catch{}
  return null
}
async function rollup(pool) {
  // Recover missed completed days after a process restart before expiring raw rows.
  await pool.query(`INSERT INTO perf_daily(day,world,device,kind,samples,p50,p75,p95)
    SELECT day,world,device,kind,count(*),percentile_cont(.5) within group(order by v),
      percentile_cont(.75) within group(order by v),percentile_cont(.95) within group(order by v)
    FROM (SELECT (received AT TIME ZONE 'UTC')::date AS day,coalesce(world,'unknown') world,
      coalesce(device,'unknown') device,kind,coalesce(fields->>'ms',fields->>'fps',fields->>'p95')::float v FROM perf_event
      WHERE received >= coalesce((SELECT max(day) FROM perf_daily),'1970-01-01'::date)::timestamp AT TIME ZONE 'UTC'
      AND received < date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') s GROUP BY 1,2,3,4
      ON CONFLICT(day,world,device,kind) DO UPDATE SET samples=excluded.samples,p50=excluded.p50,p75=excluded.p75,p95=excluded.p95`)
  await pool.query("DELETE FROM perf_event WHERE received < now()-interval '90 days'")
}
async function ensureAdminIndexes(pool){
  const statements=[
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS users_created_at ON users (created_at)',
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS feedback_submitted_at ON feedback (submitted_at) WHERE submitted_at IS NOT NULL',
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS feedback_user_status ON feedback (user_id, status, updated_at)',
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS feedback_messages_unread ON feedback_messages (feedback_id, id) WHERE author_kind = 'user'",
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS admin_audit_type_id ON admin_audit (target_type, id DESC)',
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS chat_messages_pending ON chat_messages (id DESC) WHERE status = 'pending'",
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS chat_messages_uid_id ON chat_messages (uid, id DESC) WHERE sys IS NULL',
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS mp_sessions_window ON mp_sessions (joined_at, last_seen)',
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS mp_sessions_open ON mp_sessions (instance, id) WHERE left_at IS NULL',
  ]
  for(const sql of statements){
    try{await pool.query(sql)}catch{}
  }
}
export function monitor(pool,{onHourlyReady}={}){
  let routes=new Map(),queries=new Histogram(),wait=new Histogram(),cpu=process.cpuUsage(),last=performance.now(),day='',busy=false,hourTick=0
  const lag=monitorEventLoopDelay({resolution:20});lag.enable()
  // 冷启动异步补齐高频管理索引与最近 7 天小时汇总，避免刚发版 24h/7d 查询退化扫原始表
  void ensureAdminIndexes(pool)
  void summarizeHours(pool,{hours:168}).then(()=>{hourTick=Date.now();onHourlyReady?.()},error=>console.error('hourly summary warmup failed',error.code??error.name))
  const timer=setInterval(async()=>{
    if(busy)return
    busy=true
    try{
      const memory=process.memoryUsage(),used=process.cpuUsage(),now=performance.now(),stamp=new Date()
      const sample={cpuCores:(used.user+used.system-cpu.user-cpu.system)/1000/(now-last),rss:memory.rss,heap:memory.heapUsed,
        loopP99:lag.percentile(99)/1e6,pgP95:queries.percentile(.95),poolWaitP95:wait.percentile(.95),poolWaiting:pool.waitingCount,
        routes:[...routes.values()].map(({route,status,h})=>({route,status,count:h.count,errors:status>=400?h.count:0,p50:h.percentile(.5),p95:h.percentile(.95),p99:h.percentile(.99)}))}
      cpu=used;last=now;lag.reset();routes=new Map();queries=new Histogram();wait=new Histogram()
      const [load,memoryCurrent,cpuStat,web]=await Promise.all([read('/proc/loadavg'),read('/sys/fs/cgroup/memory.current'),read('/sys/fs/cgroup/cpu.stat'),nginx()])
      Object.assign(sample,{load:load?.trim().split(/\s+/).slice(0,3).map(Number),cgroupMemory:memoryCurrent?Number(memoryCurrent):null,
        cgroupCpuUsec:cpuStat?Number(/^usage_usec (\d+)/m.exec(cpuStat)?.[1]):null,nginx:web})
      await pool.query("INSERT INTO perf_server(minute,sample) VALUES(date_trunc('minute',$1::timestamptz),$2)",[stamp,sample])
      // 小时汇总是后台总览与 7d 趋势快慢的关键：滚动窗口靠它把裸扫段压到 <= 1 小时
      if(Date.now()-hourTick>600000){await summarizeHours(pool,{hours:168});hourTick=Date.now()}
      const today=new Date(stamp.getTime()-300000).toISOString().slice(0,10)
      if(today!==day){await summarizeDays(pool);await rollup(pool);day=today}
    }catch(error){console.error('telemetry minute write failed',error.code??error.name)}finally{busy=false}
  },60000)
  timer.unref()
  return {query:ms=>queries.add(ms),wait:ms=>wait.add(ms),request(path,status,ms){
    const name=route(path),key=name+' '+status
    if(!routes.has(key))routes.set(key,{route:name,status,h:new Histogram()})
    routes.get(key).h.add(ms)
  }}
}
