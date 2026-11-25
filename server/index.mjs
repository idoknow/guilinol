import {smokeDefaults,validRules} from '../lib/smoke.ts'
import {serve} from '@hono/node-server'
import {timingSafeEqual} from 'node:crypto'
import pg from 'pg'
import {monitor} from './perf-monitor.mjs'
import {analytics} from './admin-analytics.mjs'
import {receive,queryPerf} from './telemetry.mjs'
import {onRequest} from '../functions/api/[[path]].ts'
import {database, measuredConnections} from './postgres.mjs'
import {bucket} from './bucket.mjs'
import {createReadiness} from './readiness.mjs'
import {presence, mpPresence} from './live.mjs'
import {multiplayer} from './mp-admin.mjs'
import {npcDefaults,validNpc} from '../lib/npc.ts'

crypto.subtle.timingSafeEqual = (left,right) => left.byteLength===right.byteLength && timingSafeEqual(left,right)
// 连接/查询都有上限：卡住的查询不能长期占着 5 连接的池子
// 后台首屏会同时发十几条聚合查询；pool 只给 5 条连接时它们要排队，光排队就能把首屏拖到几秒。
// Postgres max_connections=100，这里给 12 条足够。
// 慢查询不能再把请求打成 500：24h 总览单次就要 12-20s，15s 超时正好卡在边缘，
// 抖动一下越线就抛 «Query read timeout»，前端显示「服务暂时不可用」。
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:Number(process.env.PG_POOL_MAX||12),connectionTimeoutMillis:3000,query_timeout:Number(process.env.PG_QUERY_TIMEOUT||45000),idleTimeoutMillis:30000})
// 空闲连接被服务端断开（postgres 重启/维护）时 pg.Pool 会 emit 'error'，不监听就整个进程崩溃
pool.on('error',error=>console.error('postgres idle client error',error.code??error.message))
const readiness=createReadiness({query:sql=>pool.query(sql)})
const metrics=monitor(pool)
const connections=measuredConnections(pool,metrics)
// 后台聚合查询的短期缓存：一次首屏并发十几条聚合，数据本身按分钟更新，30 秒内重复跑同一份 SQL 没意义
// （单条网格查询 24 小时要 933ms）。只缓存只读分析类路径，admin/live 与写操作直通。
const ADMIN_CACHE_TTL = Number(process.env.ADMIN_CACHE_TTL ?? 120000)
// 过期后的这段时间里仍然先把旧结果发出去、后台再刷新：24h 总览要 12-20s，
// 让管理员干等一个必然超时的查询，不如先给他上一次的图，同时在后台算新的。
const ADMIN_CACHE_STALE = Number(process.env.ADMIN_CACHE_STALE ?? 900000)
const ADMIN_CACHE_MAX = 200
const adminCache = new Map()
const adminPending = new Map()
const cacheableAdminPath = path => /^admin\/(perf(\/grid|\/server)?|overview|timeseries|breakdown|funnel|errors)$/.test(path)
function rememberAdminCache(key, response) {
  adminCache.set(key, {response: response.clone(), expires: Date.now() + ADMIN_CACHE_TTL})
  if (adminCache.size > ADMIN_CACHE_MAX) adminCache.delete(adminCache.keys().next().value)
}
function withAdminCache(key, run) {
  const now = Date.now()
  const hit = adminCache.get(key)
  if (hit && hit.expires > now) return Promise.resolve(hit.response.clone())
  // 同一个 key 的并发请求只打一次库：后台首屏会同时发好几个卡片、前端还每 15s 轮询一次，
  // 不去重就是同样一条 20s 的聚合被并行跑 N 遍，把连接池占满。
  const pending = adminPending.get(key)
  if (pending) return pending.then(response => response.clone())
  // 有旧结果就立即返回，刷新在后台进行（成功后才覆盖缓存）
  const stale = hit && hit.expires + ADMIN_CACHE_STALE > now ? hit.response.clone() : null
  const job = run().then(response => {
    if (response.ok) rememberAdminCache(key, response)
    return response
  })
  adminPending.set(key, job)
  job.then(() => adminPending.delete(key), () => adminPending.delete(key))
  return stale ? Promise.resolve(stale) : job.then(response => response.clone())
}
const runPerfQuery = (path, params) => (path.startsWith('admin/perf') ? queryPerf : analytics)(connections, path, params)
const cachedPerfQuery = (path, params) => {
  const started = Date.now()
  const done = response => {
    const ms = Date.now() - started
    if (ms > 300) console.log(JSON.stringify({scope: 'admin-query', path, ms, query: String(params).slice(0, 120)}))
    return response
  }
  if (!cacheableAdminPath(path)) return runPerfQuery(path, params).then(done)
  return withAdminCache(`${path}?${params}`, () => runPerfQuery(path, params)).then(done)
}
const mp=multiplayer(pool,process.env)
const readNpc=async()=> (await pool.query('select settings from npc_settings where singleton')).rows[0]?.settings??npcDefaults
async function npcAdmin(request){
  if(request.method==='GET')return json(await readNpc())
  if(request.method!=='POST')return json({error:'method'},405)
  const rules=await request.json().catch(()=>null)
  if(!validNpc(rules))return json({error:'invalid NPC settings'},400)
  await pool.query('insert into npc_settings(singleton,settings) values(true,$1) on conflict(singleton) do update set settings=excluded.settings',[rules])
  return json({ok:true})
}
async function readSmoke(){
  const {rows}=await pool.query("SELECT detail FROM admin_audit WHERE target_type='smoke' AND target_id='settings' AND action='smoke.settings' ORDER BY id DESC LIMIT 1")
  return rows[0]?.detail??smokeDefaults
}
async function smokeAdmin(request,user){
  if(request.method==='GET')return json(await readSmoke())
  if(request.method!=='POST')return json({error:'method'},405)
  const rules=await request.json().catch(()=>null)
  if(!validRules(rules))return json({error:'invalid smoke settings'},400)
  await pool.query("INSERT INTO admin_audit(actor_id,action,target_type,target_id,detail) VALUES($1,'smoke.settings','smoke','settings',$2)",[user,rules])
  return json({ok:true})
}
const env = {...process.env, smokeAdmin,npcAdmin,mpAdmin:mp.route, perfQuery:cachedPerfQuery, DB:database(connections), FEEDBACK:bucket(process.env.S3_ENDPOINT)}
const origin = new URL(process.env.PUBLIC_ORIGIN).origin
const online = presence(pool)
const mpOnline = mpPresence()

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}})

const server=serve({port:Number(process.env.PORT || 3000),fetch: async request => {
  const url = new URL(request.url)
  if (!url.pathname.startsWith('/api/')) return new Response(null,{status:404})
  if(url.pathname==='/api/smoke')return request.method==='GET'?json(await readSmoke()):json({error:'method'},405)
  if(url.pathname==='/api/npc'){
    if(request.method!=='GET')return json({error:'method'},405)
    const body=JSON.stringify(await readNpc()),etag='"'+Buffer.from(await crypto.subtle.digest('SHA-256',Buffer.from(body))).toString('hex')+'"'
    const headers={'content-type':'application/json','cache-control':'public, no-cache',etag}
    return request.headers.get('if-none-match')===etag?new Response(null,{status:304,headers}):new Response(body,{headers})
  }
  // 就绪探针：读缓存、不阻塞、不打库。语义 = "进程起来且表结构已就绪"；
  // DB 之后抖一下不会把 pod 从端点里摘掉（静态页还得能出）。
  if (url.pathname === '/api/ready') {
    const status = readiness.status()
    return status.ready ? json({ok:true}) : json({ok:false,error:status.reason},503)
  }
  // 在线人数（IDOK-172）：公开只读，5 分钟活跃会话数，15 秒内存缓存。
  // mp = 联机服上已 join 的玩家数（IDOK-228）；rt 不通时为 null，不影响 online。
  if (url.pathname === '/api/live') {
    if (request.method !== 'GET') return json({error:{code:'method',message:'只支持 GET'}},405)
    try {
      const [n, mp] = await Promise.all([online(), mpOnline()])
      return json({online: n, mp})
    } catch (error) {
      console.error('live presence failed', error.code ?? error.message)
      return json({error:{code:'internal',message:'暂时拿不到在线人数'}},503)
    }
  }
  const start=performance.now()
  let status=500
  try {
    const response=url.pathname==='/api/t'?await receive(request,connections,origin):await onRequest({env,request:new Request(origin+url.pathname+url.search,request)})
    status=response.status
    return response
  }finally{if(!request.headers.get('user-agent')?.startsWith('kube-probe/'))metrics.request(url.pathname,status,performance.now()-start)}
}})

// 启动后立刻探一次，别让第一个探针等到 TTL 到期
void readiness.kick()
const stopMp=mp.start()

// 优雅退出：k8s 删 pod 时先 SIGTERM（配合 preStop 已先摘流量），等在途请求跑完再退出；
// 20 秒兜底，避免卡住的连接把滚动更新拖成超时。
let closing=false
for (const signal of ['SIGTERM','SIGINT']) {
  process.on(signal, () => {
    if (closing) return
    closing=true
    stopMp()
    setTimeout(() => process.exit(0), 20000).unref()
    server.close(async () => {
      try { await pool.end() } catch {}
      process.exit(0)
    })
  })
}
