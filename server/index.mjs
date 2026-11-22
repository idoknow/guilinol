import {serve} from '@hono/node-server'
import {timingSafeEqual} from 'node:crypto'
import pg from 'pg'
import {monitor} from './perf-monitor.mjs'
import {analytics} from './admin-analytics.mjs'
import {receive,queryPerf} from './telemetry.mjs'
import {onRequest} from '../functions/api/[[path]].ts'
import {database, measuredConnections} from './postgres.mjs'
import {bucket} from './bucket.mjs'

crypto.subtle.timingSafeEqual = (left,right) => left.byteLength===right.byteLength && timingSafeEqual(left,right)
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:5})
// 空闲连接被服务端断开（postgres 重启/维护）时 pg.Pool 会 emit 'error'，不监听就整个进程崩溃
pool.on('error',error=>console.error('postgres idle client error',error.code??error.message))
const metrics=monitor(pool)
const connections=measuredConnections(pool,metrics)
const env = {...process.env, perfQuery:(path,params)=>(path.startsWith('admin/perf')?queryPerf:analytics)(connections,path,params), DB:database(connections), FEEDBACK:bucket(process.env.S3_ENDPOINT)}
const origin = new URL(process.env.PUBLIC_ORIGIN).origin

let dbReady=false,closing=false
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}})

const server=serve({port:Number(process.env.PORT || 3000),fetch: async request => {
  const url = new URL(request.url)
  if (!url.pathname.startsWith('/api/')) return new Response(null,{status:404})
  // 就绪探针：新进程第一次连通 DB 才 200，滚动更新靠它决定新 pod 是否可以接流量。
  // 连通过一次后不再随 DB 抖动变 503 —— 否则 postgres 一重启整个 pod（含 nginx 静态站）都被摘端点、全站 503。
  // 收到 SIGTERM 后返回 503，帮助摘流量。
  if (url.pathname === '/api/ready') {
    if (closing) return json({ok:false,error:'closing'},503)
    if (dbReady) return json({ok:true})
    try { await pool.query('select 1'); dbReady=true; return json({ok:true}) }
    catch { return json({ok:false,error:'database'},503) }
  }
  const start=performance.now()
  let status=500
  try {
    const response=url.pathname==='/api/t'?await receive(request,connections,origin):await onRequest({env,request:new Request(origin+url.pathname+url.search,request)})
    status=response.status
    return response
  }finally{if(!request.headers.get('user-agent')?.startsWith('kube-probe/'))metrics.request(url.pathname,status,performance.now()-start)}
}})

// 优雅退出：k8s 删 pod 时先 SIGTERM（配合 preStop 已先摘流量），等在途请求跑完再退出；
// 20 秒兜底，避免卡住的连接把滚动更新拖成超时。
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
