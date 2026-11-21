import assert from 'node:assert/strict'
import pg from 'pg'
import '../server/postgres.mjs' // Use the same bigint parser as the HTTP service.
import {analytics} from '../server/admin-analytics.mjs'
import {summarizeDays} from '../server/day-summary.mjs'

// Compare identical ranges before and after the full UTC days are summarized.
export async function verifySummaries(url){
  const pool=new pg.Pool({connectionString:url})
  try{
    const day=Math.floor(Date.now()/86400000)*86400000
    const start=new Date(day-4*86400000+43200000),end=new Date(day-86400000+43200000)
    const paths=['overview','timeseries?bucket=1d&metric=fps.p50&group=device','breakdown?dim=region&metric=chunk.p95']
    const session=crypto.randomUUID(),context={vid:crypto.randomUUID(),firstDay:start.toISOString().slice(0,10)}
    for(let hour=0;hour<96;hour+=3){
      const received=new Date(+start+hour*3600000)
      for(const [kind,fields] of [['session',{total:hour}],['chunk',{ms:hour}],['window',{fps:hour%5}],['error',{count:1}]]){
        await pool.query('INSERT INTO perf_event(received,batch,session,kind,device,region,context,fields) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
          [received,crypto.randomUUID(),session,kind,'mobile','广西',context,fields])
      }
    }
    async function query(path){
      const [endpoint,search]=path.split('?'),params=new URLSearchParams(search)
      params.set('from',start.toISOString());params.set('to',end.toISOString())
      return (await analytics(pool,'admin/'+endpoint,params)).json()
    }
    const before=await Promise.all(paths.map(query))
    await summarizeDays(pool)
    assert.deepEqual(await Promise.all(paths.map(query)),before)
  }finally{await pool.end()}
}
