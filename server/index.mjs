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
const metrics=monitor(pool)
const connections=measuredConnections(pool,metrics)
const env = {...process.env, perfQuery:(path,params)=>(path.startsWith('admin/perf')?queryPerf:analytics)(connections,path,params), DB:database(connections), FEEDBACK:bucket(process.env.S3_ENDPOINT)}
const origin = new URL(process.env.PUBLIC_ORIGIN).origin
serve({port:Number(process.env.PORT || 3000),fetch: async request => {
  const url = new URL(request.url)
  if (!url.pathname.startsWith('/api/')) return new Response(null,{status:404})
  const start=performance.now()
  let status=500
  try {
    const response=url.pathname==='/api/t'?await receive(request,connections,origin):await onRequest({env,request:new Request(origin+url.pathname+url.search,request)})
    status=response.status
    return response
  }finally{metrics.request(url.pathname,status,performance.now()-start)}
}})
