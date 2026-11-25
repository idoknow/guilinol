import assert from 'node:assert/strict'
import test from 'node:test'
import pg from 'pg'
import '../server/postgres.mjs'
import {analytics} from '../server/admin-analytics.mjs'
import {partitions,summarizeDays,summarizeHours} from '../server/day-summary.mjs'
import {fixture} from './selfhost-test.mjs'

const hourMs=3600000
const dayMs=86400000

function assertApproxDeepEqual(actual,expected){
  if(typeof actual==='number'&&typeof expected==='number'){
    assert.ok(Math.abs(actual-expected)<=1e-9,`expected ${expected}, got ${actual}`)
    return
  }
  if(Array.isArray(actual)&&Array.isArray(expected)){
    assert.equal(actual.length,expected.length)
    for(let i=0;i<actual.length;i++)assertApproxDeepEqual(actual[i],expected[i])
    return
  }
  if(actual&&expected&&typeof actual==='object'&&typeof expected==='object'){
    assert.deepEqual(Object.keys(actual).sort(),Object.keys(expected).sort())
    for(const key of Object.keys(actual))assertApproxDeepEqual(actual[key],expected[key])
    return
  }
  assert.deepEqual(actual,expected)
}

async function seedEvent(pool,received,session,vid,device,region,firstDay,extras=[]){
  const context={vid,firstDay}
  const rows=[['session',{total:120}],['chunk',{ms:80+received.getUTCHours()}],['playable',{ms:400+received.getUTCHours()}],['window',{fps:45+(received.getUTCHours()%15)}],...extras]
  for(const [kind,fields] of rows){
    await pool.query(
      'INSERT INTO perf_event(received,batch,session,kind,device,region,context,fields) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [received,crypto.randomUUID(),session,kind,device,region,context,fields],
    )
  }
}

export async function verifyHourlySummaries(url){
  const pool=new pg.Pool({connectionString:url})
  try{
    const nowMs=Date.now()
    const currentHour=Math.floor(nowMs/hourMs)*hourMs
    // 1) 冷启动：perf_summary_hour 为空时 partitions(24h) 返回 null，安全退回原表而不报错
    const rollingEnd=new Date(currentHour+23*60000)
    const rollingStart=new Date(+rollingEnd-24*hourMs)
    assert.equal(await partitions(pool,+rollingStart,+rollingEnd),null)

    // 构造跨 UTC 午夜与非整点边界（+23 分钟）的数据，中间刻意留空桶（某些整点 0 事件）
    const activeHours=[1,2,4,6,9,13,17,21,23,25,30,36,44]
    for(const offset of activeHours){
      const ts=new Date(currentHour-offset*hourMs+15*60000)
      const session=crypto.randomUUID()
      const vid=crypto.randomUUID()
      const firstDay=ts.toISOString().slice(0,10)
      const extras=offset%2===0?[['error',{count:1,errorKind:'error',signature:'deadbeef'}]]:[]
      await seedEvent(pool,ts,session,vid,offset%2?'mobile':'desktop',offset%3?'广西':'广东',firstDay,extras)
    }
    // 加一条在当前半小时内的事件（落在右端 gap），以及左端边界内的事件（落在左端 gap）
    await seedEvent(pool,new Date(currentHour+10*60000),crypto.randomUUID(),crypto.randomUUID(),'mobile','广西',new Date(currentHour).toISOString().slice(0,10))
    await seedEvent(pool,new Date(+rollingStart+5*60000),crypto.randomUUID(),crypto.randomUUID(),'desktop','广东',rollingStart.toISOString().slice(0,10))

    async function query(path){
      const [endpoint,search]=path.split('?'),params=new URLSearchParams(search)
      params.set('from',rollingStart.toISOString())
      params.set('to',rollingEnd.toISOString())
      return (await analytics(pool,'admin/'+endpoint,params)).json()
    }

    const valuePaths=[
      'overview',
      'timeseries?bucket=1h&metric=fps.p50&group=device',
      'timeseries?bucket=1h&metric=chunk.p95',
      'breakdown?dim=region&metric=chunk.p95',
    ]
    const sessionSeriesPaths=[
      'timeseries?bucket=1h&metric=visitors',
      'timeseries?bucket=1h&metric=sessions',
      'timeseries?bucket=1h&metric=errorRate',
      'timeseries?bucket=1h&metric=durationAvg',
      'timeseries?bucket=1h&metric=online',
    ]
    const beforeValues=await Promise.all(valuePaths.map(query))
    const beforeSessions=await Promise.all(sessionSeriesPaths.map(query))

    // 2) 冷启动补算：应回填全部已完成整点（含 0 事件空桶）
    await summarizeHours(pool,{hours:72})
    const part=await partitions(pool,+rollingStart,+rollingEnd)
    assert.equal(part.grain,'hour')
    assert.equal(part.days.length,23)
    assert.equal(part.gaps.length,2)
    assert.ok(part.gaps.every(([lo,hi])=>hi-lo<hourMs))

    // 跨整点 + 跨日边界：汇总后结果与原始表完全一致（分位插值允许浮点末位误差 1e-9）
    assertApproxDeepEqual(await Promise.all(valuePaths.map(query)),beforeValues)
    const afterSessions=await Promise.all(sessionSeriesPaths.map(query))
    for(let i=0;i<sessionSeriesPaths.length;i++){
      assertApproxDeepEqual(
        afterSessions[i].map(({t,value,group})=>({t,value,group})),
        beforeSessions[i].map(({t,value,group})=>({t,value,group})),
      )
    }

    // 3) 小时表存在缺失桶（空档）时，partitions 识别 gap 并与原表补算一致
    const dropHour=part.days[5]
    await pool.query('DELETE FROM perf_summary_hour WHERE hour=$1',[dropHour])
    await pool.query('DELETE FROM perf_session_hour WHERE hour=$1',[dropHour])
    await pool.query('DELETE FROM perf_value_hour WHERE hour=$1',[dropHour])
    const gappedPart=await partitions(pool,+rollingStart,+rollingEnd)
    assert.equal(gappedPart.grain,'hour')
    assert.equal(gappedPart.days.length,22)
    assert.equal(gappedPart.gaps.length,3)
    assertApproxDeepEqual(await Promise.all(valuePaths.map(query)),beforeValues)

    // 4) 最近 2 小时迟到事件重算：在上一已完成整点补插一条新事件，再次 summarizeHours 能吸收并更新结果
    const lateTs=new Date(currentHour-30*60000)
    await seedEvent(pool,lateTs,crypto.randomUUID(),crypto.randomUUID(),'mobile','北京',lateTs.toISOString().slice(0,10),[['error',{count:1,errorKind:'error',signature:'cafebabe'}]])
    const beforeLateOverview=await query('overview')
    await summarizeHours(pool,{hours:72})
    const afterLateOverview=await query('overview')
    assert.equal(afterLateOverview.sessions.current,beforeLateOverview.sessions.current+1)

    // 5) 窗口超过 3 天时回到日表（> 3 * 86400s）
    const oldDay=new Date(Math.floor((nowMs-5*dayMs)/dayMs)*dayMs+3600000)
    await seedEvent(pool,oldDay,crypto.randomUUID(),crypto.randomUUID(),'desktop','上海',oldDay.toISOString().slice(0,10))
    await summarizeDays(pool)
    const longEnd=new Date(Math.floor(nowMs/dayMs)*dayMs)
    const longStart=new Date(+longEnd-4*dayMs)
    const longPart=await partitions(pool,+longStart,+longEnd)
    assert.equal(longPart.grain,'day')
    assert.ok(longPart.days.length>=1)
  }finally{
    await pool.end()
  }
}

if(process.argv[1]?.endsWith('summary-hour-test.mjs')){
  test('rolling 24h hour partitions, empty/cold backfill, late events, and >3d day fallback',async()=>{
    const storage=await fixture({postgresOnly:true})
    try{
      await verifyHourlySummaries(storage.env.DATABASE_URL)
    }finally{
      await storage.close()
    }
  })
}
