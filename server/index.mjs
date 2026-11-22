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

crypto.subtle.timingSafeEqual = (left,right) => left.byteLength===right.byteLength && timingSafeEqual(left,right)
// 连接/查询都有上限：卡住的查询不能长期占着 5 连接的池子
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:5,connectionTimeoutMillis:3000,query_timeout:15000,idleTimeoutMillis:30000})
const readiness=createReadiness({query:sql=>pool.query(sql)})
const metrics=monitor(pool)
const connections=measuredConnections(pool,metrics)
const env = {...process.env, perfQuery:(path,params)=>(path.startsWith('admin/perf')?queryPerf:analytics)(connections,path,params), DB:database(connections), FEEDBACK:bucket(process.env.S3_ENDPOINT)}
const origin = new URL(process.env.PUBLIC_ORIGIN).origin

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}})

const server=serve({port:Number(process.env.PORT || 3000),fetch: async request => {
  const url = new URL(request.url)
  if (!url.pathname.startsWith('/api/')) return new Response(null,{status:404})
  // 就绪探针：读缓存、不阻塞、不打库。语义 = "进程起来且表结构已就绪"；
  // DB 之后抖一下不会把 pod 从端点里摘掉（静态页还得能出）。
  if (url.pathname === '/api/ready') {
    const status = readiness.status()
    return status.ready ? json({ok:true}) : json({ok:false,error:status.reason},503)
  }
  const start=performance.now()
  let status=500
  try {
    const response=url.pathname==='/api/t'?await receive(request,connections,origin):await onRequest({env,request:new Request(origin+url.pathname+url.search,request)})
    status=response.status
    return response
  }finally{metrics.request(url.pathname,status,performance.now()-start)}
}})

// 启动后立刻探一次，别让第一个探针等到 TTL 到期
void readiness.probe()

// 优雅退出：k8s 删 pod 时先 SIGTERM（配合 preStop 已先摘流量），等在途请求跑完再退出；
// 20 秒兜底，避免卡住的连接把滚动更新拖成超时。
let closing=false
for (const signal of ['SIGTERM','SIGINT']) {
  process.on(signal, () => {
    if (closing) return
    closing=true
    setTimeout(() => process.exit(0), 20000).unref()
    server.close(async () => {
      try { await pool.end() } catch {}
      process.exit(0)
    })
  })
}
