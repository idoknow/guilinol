import {serve} from '@hono/node-server'
import {timingSafeEqual} from 'node:crypto'
import pg from 'pg'
import {onRequest} from '../functions/api/[[path]].ts'
import {database} from './postgres.mjs'
import {bucket} from './bucket.mjs'

crypto.subtle.timingSafeEqual = (left,right) => left.byteLength===right.byteLength && timingSafeEqual(left,right)
const env = {...process.env, DB:database(new pg.Pool({connectionString:process.env.DATABASE_URL, max:5})), FEEDBACK:bucket(process.env.S3_ENDPOINT)}
const origin = new URL(process.env.PUBLIC_ORIGIN).origin
serve({port:Number(process.env.PORT || 3000),fetch: async request => {
  const url = new URL(request.url)
  if (!url.pathname.startsWith('/api/')) return new Response(null,{status:404})
  return onRequest({env,request:new Request(origin+url.pathname+url.search,request)})
}})
