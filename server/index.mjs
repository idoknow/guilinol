import {smokeDefaults,validRules} from '../lib/smoke.ts'
import {gfxDefaults,validGfx} from '../lib/gfx.ts'
import {serve} from '@hono/node-server'
import {timingSafeEqual} from 'node:crypto'
import pg from 'pg'
import {monitor} from './perf-monitor.mjs'
import {analytics} from './admin-analytics.mjs'
import {receive,queryPerf} from './telemetry.mjs'
import {onRequest} from '../functions/api/[[path]].ts'
import {database, measuredConnections} from './postgres.mjs'
import {bucket} from './bucket.mjs'
import {cardRoutes} from './update-cards.mjs'
import {createReadiness} from './readiness.mjs'
import {presence, mpPresence} from './live.mjs'
import {multiplayer} from './mp-admin.mjs'
import {npcDefaults,validNpc} from '../lib/npc.ts'
import {resolveClientIp} from './client-ip.mjs'
import {createPerfCache} from './perf-cache.mjs'
import {fishingStore} from './fishing.mjs'

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
const runPerfQuery = (path, params) => (path.startsWith('admin/perf') ? queryPerf : analytics)(connections, path, params)
const cachedPerfQuery = createPerfCache({ runPerfQuery })
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
  const stored=rows[0]?.detail
  if(!stored)return smokeDefaults
  if(stored.catalogVersion===2)return stored
  // Pre-expansion settings could only contain the original six brands.
  return {...stored,brands:[...stored.brands,...smokeDefaults.brands.slice(6)]}
}
async function smokeAdmin(request,user){
  if(request.method==='GET')return json(await readSmoke())
  if(request.method!=='POST')return json({error:'method'},405)
  const rules=await request.json().catch(()=>null)
  if(!validRules(rules))return json({error:'invalid smoke settings'},400)
  await pool.query("INSERT INTO admin_audit(actor_id,action,target_type,target_id,detail) VALUES($1,'smoke.settings','smoke','settings',$2)",[user,{...rules,catalogVersion:2}])
  return json({ok:true})
}
async function readGfx(){
  const {rows}=await pool.query("SELECT detail FROM admin_audit WHERE target_type='gfx' AND target_id='settings' AND action='gfx.settings' ORDER BY id DESC LIMIT 1")
  return validGfx(rows[0]?.detail)?rows[0].detail:gfxDefaults
}
async function gfxAdmin(request,user){
  if(request.method==='GET')return json(await readGfx())
  if(request.method!=='PUT')return json({error:'method'},405)
  const config=await request.json().catch(()=>null)
  if(!validGfx(config))return json({error:'invalid gfx settings'},400)
  await pool.query("INSERT INTO admin_audit(actor_id,action,target_type,target_id,detail) VALUES($1,'gfx.settings','gfx','settings',$2)",[user,config])
  return json({ok:true})
}
const env = {...process.env, gfxAdmin,smokeAdmin,npcAdmin,mpAdmin:mp.route, perfQuery:cachedPerfQuery, DB:database(connections), FEEDBACK:bucket(process.env.S3_ENDPOINT)}
const origin = new URL(process.env.PUBLIC_ORIGIN).origin
env.updateCards=cardRoutes(pool,env)
env.fishing=fishingStore(connections)
const online = presence(pool)
const mpOnline = mpPresence()

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}})

const server=serve({port:Number(process.env.PORT || 3000),fetch: async (request,serverEnv) => {
  const url = new URL(request.url)
  if (!url.pathname.startsWith('/api/')) return new Response(null,{status:404})
  if(url.pathname==='/api/smoke')return request.method==='GET'?json(await readSmoke()):json({error:'method'},405)
  if(url.pathname==='/api/gfx')return request.method==='GET'?json(await readGfx()):json({error:'method'},405)
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
    const remoteAddr=serverEnv?.incoming?.socket?.remoteAddress??''
    const resolved=resolveClientIp(request.headers,remoteAddr)
    const reqEnv={...env,clientIp:resolved.clientIp}
    const response=url.pathname==='/api/t'?await receive(request,connections,origin,{remoteAddr}):await onRequest({env:reqEnv,request:new Request(origin+url.pathname+url.search,request)})
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
