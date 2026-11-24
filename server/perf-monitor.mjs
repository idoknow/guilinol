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
  if(/^\/api\/(?:me|unsubscribe|health|t|auth\/(?:register|resend|verify|reset|login|logout)|admin\/(?:stats|users|feedback|overview|timeseries|breakdown|funnel|errors|live|audit|perf(?:\/grid|\/server)?)|bridge\/pending|feedback)$/.test(path))return path
  if(/^\/api\/admin\/users\/[\w-]+\/role$/.test(path))return '/api/admin/users/:id/role'
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
export function monitor(pool){
  let routes=new Map(),queries=new Histogram(),wait=new Histogram(),cpu=process.cpuUsage(),last=performance.now(),day='',busy=false,hourTick=0
  const lag=monitorEventLoopDelay({resolution:20});lag.enable()
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
      // 小时汇总是后台总览快慢的关键：24h 这类滚动窗口只能靠它，否则每次都要裸扫原始事件
      if(Date.now()-hourTick>600000){hourTick=Date.now();await summarizeHours(pool,{hours:48})}
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
