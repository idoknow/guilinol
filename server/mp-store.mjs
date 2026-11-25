import {isIP} from 'node:net'

const VALID_ACTIVITIES=new Set(['walk','idle','ebike','bicycle','car','boat','fishing','mifen','drone','photo','shop','mission','smoke'])
const schemaReady=new WeakMap()

export async function ensureMpActivitySchema(db){
  if(!db||typeof db!=='object')return
  let job=schemaReady.get(db)
  if(!job){
    job=(async()=>{
      const stmts=[
        `CREATE TABLE IF NOT EXISTS mp_activity_log (
          instance bigint NOT NULL, seq bigint NOT NULL, ts timestamptz NOT NULL,
          session_id text NOT NULL, uid bigint NOT NULL, name text NOT NULL,
          kind text NOT NULL, activity text, detail text, duration_sec integer,
          landmark text, x real, z real, PRIMARY KEY (instance, seq)
        )`,
        'CREATE INDEX IF NOT EXISTS mp_activity_log_ts ON mp_activity_log (ts DESC)',
        'CREATE INDEX IF NOT EXISTS mp_activity_log_uid_ts ON mp_activity_log (uid, ts DESC)',
        'CREATE INDEX IF NOT EXISTS mp_activity_log_activity_ts ON mp_activity_log (activity, ts DESC) WHERE activity IS NOT NULL',
        "CREATE INDEX IF NOT EXISTS mp_activity_log_end_ts ON mp_activity_log (ts DESC) WHERE kind = 'activity_end' AND activity IS NOT NULL",
        `CREATE TABLE IF NOT EXISTS mp_session_activity (
          instance bigint NOT NULL, session_id text NOT NULL, uid bigint NOT NULL,
          activity text NOT NULL, seconds integer NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL,
          PRIMARY KEY (instance, session_id, activity)
        )`,
        'CREATE INDEX IF NOT EXISTS mp_session_activity_updated ON mp_session_activity (updated_at DESC)',
        `CREATE TABLE IF NOT EXISTS mp_gameplay_hour (
          hour timestamptz NOT NULL, activity text NOT NULL, seconds bigint NOT NULL DEFAULT 0,
          PRIMARY KEY (hour, activity)
        )`,
        `CREATE TABLE IF NOT EXISTS mp_gameplay_player_day (
          day date NOT NULL, activity text NOT NULL, uid bigint NOT NULL, seconds integer NOT NULL DEFAULT 0,
          PRIMARY KEY (day, activity, uid)
        )`,
        'CREATE INDEX IF NOT EXISTS mp_gameplay_player_day_uid ON mp_gameplay_player_day (uid, day DESC)',
      ]
      for(const sql of stmts)await db.query(sql)
    })().catch(error=>{schemaReady.delete(db);throw error})
    schemaReady.set(db,job)
  }
  await job
}

export async function regions(db,items){
  const ips=[...new Set(items.map(item=>item.ip?.replace(/^::ffff:/,'')).filter(value=>isIP(value)))]
  if(!ips.length)return ()=>null
  const {rows}=await db.query(`select ip, to_jsonb(geo) as region from unnest($1::text[]) ip
    left join lateral (select country,region,city,isp from perf_network where prefix >>= ip::inet
      order by masklen(prefix) desc limit 1) geo on true`,[ips])
  const map=new Map(rows.map(row=>[row.ip,row.region]))
  return ip=>map.get(ip?.replace(/^::ffff:/,''))??null
}

export async function record(pool,state,at=new Date(),resolveLandmark=null){
  const {players,server,events,activities:rtActivities=[]}=state, instance=server.startedAt
  await ensureMpActivitySchema(pool).catch(error=>console.warn('mp schema ensure failed',error?.code??error?.message))
  const client=await pool.connect()
  try{
    await client.query('begin')
    const {rows:[{locked}]}=await client.query('select pg_try_advisory_xact_lock(2238790) as locked')
    if(!locked){await client.query('rollback');return}
    const rtts=players.map(player=>player.rttMs).filter(Number.isFinite).sort((left,right)=>left-right)
    const middle=Math.floor(rtts.length/2)
    const median=rtts.length?(rtts[middle]+rtts[Math.floor((rtts.length-1)/2)])/2:null
    const bytes=Object.values(server.traffic.out).reduce((sum,type)=>sum+type.bytes,0)
    await client.query(`insert into mp_online_minute values(date_trunc('minute',$1::timestamptz),$2,$3,$4,$5)
      on conflict(ts) do nothing`,[at,server.online,server.connections,median,bytes])
    const sessions=new Map()
    for(const item of [...events.filter(event=>['join','leave'].includes(event.type)),...players]){
      sessions.set(item.id,item)
    }
    const cleanIp=value=>{const s=typeof value==='string'?value.replace(/^::ffff:/,''):'';return isIP(s)?s:null}
    const lookup=await regions(client,[...sessions.values()])
    const rows=[...sessions.values()].map(item=>({id:item.id,uid:item.uid,name:item.name,joined_at:new Date(item.joinedAt),
      left_at:item.type==='leave'?new Date(item.ts):null,last_seen:new Date(item.ts??at),reason:item.reason,close_code:item.closeCode,region:lookup(item.ip),
      client_ip:cleanIp(item.ip),node_ip:cleanIp(item.nodeIp)}))
    await client.query('savepoint mp_ip_cols')
    try{
      await client.query(`insert into mp_sessions(instance,id,uid,name,joined_at,left_at,last_seen,reason,close_code,region,client_ip,node_ip)
        select $1,s.* from jsonb_to_recordset($2) as s(id text,uid bigint,name text,
        joined_at timestamptz,left_at timestamptz,last_seen timestamptz,reason text,close_code integer,region jsonb,client_ip text,node_ip text)
        on conflict(instance,id) do update set left_at=coalesce(excluded.left_at,mp_sessions.left_at),
        reason=coalesce(excluded.reason,mp_sessions.reason),close_code=coalesce(excluded.close_code,mp_sessions.close_code),
        last_seen=greatest(mp_sessions.last_seen,excluded.last_seen),
        client_ip=coalesce(excluded.client_ip,mp_sessions.client_ip),node_ip=coalesce(excluded.node_ip,mp_sessions.node_ip)`,[instance,JSON.stringify(rows)])
      await client.query('release savepoint mp_ip_cols')
    }catch(error){
      if(error?.code!=='42703')throw error
      await client.query('rollback to savepoint mp_ip_cols')
      await client.query(`insert into mp_sessions select $1,s.* from jsonb_to_recordset($2) as s(id text,uid bigint,name text,
        joined_at timestamptz,left_at timestamptz,last_seen timestamptz,reason text,close_code integer,region jsonb)
        on conflict(instance,id) do update set left_at=coalesce(excluded.left_at,mp_sessions.left_at),
        reason=coalesce(excluded.reason,mp_sessions.reason),close_code=coalesce(excluded.close_code,mp_sessions.close_code),
        last_seen=greatest(mp_sessions.last_seen,excluded.last_seen)`,[instance,JSON.stringify(rows)])
      await client.query('release savepoint mp_ip_cols')
    }
    await client.query(`update mp_sessions set left_at=last_seen,reason='lost observation' where left_at is null
      and (instance<>$1 or not(id=any($2::text[])))`,[instance,players.map(player=>player.id)])
    await client.query(`insert into mp_online_hour select date_trunc('hour',ts),avg(online),max(online),
      (array_agg(ts order by online desc,ts))[1] from mp_online_minute
      where ts>=date_trunc('hour',$1::timestamptz) group by 1 on conflict(ts) do update set
      online=excluded.online,peak=excluded.peak,peak_at=excluded.peak_at`,[at])

    // 同步账户活动记录与各玩法累计占用时长（幂等差值，重复采样不翻倍、不丢秒）
    await client.query('savepoint mp_activity_sync')
    try{
      const logRows=(Array.isArray(rtActivities)?rtActivities:[])
        .filter(item=>item&&Number.isSafeInteger(Number(item.seq))&&item.uid!=null)
        .map(item=>{
          const place=resolveLandmark&&Number.isFinite(item.x)&&Number.isFinite(item.z)?resolveLandmark(item.x,item.z):null
          return {
            seq:Number(item.seq),ts:new Date(item.ts??at),session_id:String(item.sessionId||''),
            uid:Number(item.uid),name:String(item.name||''),kind:String(item.kind||'activity'),
            activity:VALID_ACTIVITIES.has(item.activity)?item.activity:null,
            detail:item.detail?String(item.detail).slice(0,80):null,
            duration_sec:Number.isFinite(item.durationSec)?Math.max(0,Math.round(item.durationSec)):null,
            landmark:place?.name??null,
            x:Number.isFinite(item.x)?item.x:null,z:Number.isFinite(item.z)?item.z:null,
          }
        })
      if(logRows.length){
        await client.query(`insert into mp_activity_log(instance,seq,ts,session_id,uid,name,kind,activity,detail,duration_sec,landmark,x,z)
          select $1,s.* from jsonb_to_recordset($2) as s(seq bigint,ts timestamptz,session_id text,uid bigint,name text,kind text,
          activity text,detail text,duration_sec integer,landmark text,x real,z real)
          on conflict(instance,seq) do nothing`,[instance,JSON.stringify(logRows)])
      }

      const bySession=new Map()
      const absorb=(sessionId,uid,totals)=>{
        if(!sessionId||uid==null||!totals||typeof totals!=='object')return
        let entry=bySession.get(sessionId)
        if(!entry){entry={sessionId:String(sessionId),uid:Number(uid),totals:{}};bySession.set(sessionId,entry)}
        for(const [act,sec] of Object.entries(totals)){
          if(!VALID_ACTIVITIES.has(act))continue
          const n=Math.max(0,Math.round(Number(sec)||0))
          if(n>0)entry.totals[act]=Math.max(entry.totals[act]??0,n)
        }
      }
      for(const ev of events)if(ev.type==='leave'&&ev.activityTotals)absorb(ev.id,ev.uid,ev.activityTotals)
      for(const p of players)absorb(p.id,p.uid,p.activityTotals)

      const actRows=[]
      for(const entry of bySession.values()){
        for(const [activity,seconds] of Object.entries(entry.totals)){
          actRows.push({session_id:entry.sessionId,uid:entry.uid,activity,seconds,updated_at:at})
        }
      }
      if(actRows.length){
        const sessionIds=[...bySession.keys()]
        const {rows:prevRows}=await client.query(
          'select session_id,activity,seconds from mp_session_activity where instance=$1 and session_id=any($2::text[])',
          [instance,sessionIds],
        )
        const prevMap=new Map(prevRows.map(r=>[`${r.session_id}|${r.activity}`,Number(r.seconds)||0]))
        const hourDeltas=new Map(),dayDeltas=new Map()
        for(const row of actRows){
          const prev=prevMap.get(`${row.session_id}|${row.activity}`)??0
          const delta=Math.max(0,row.seconds-prev)
          if(delta>0){
            hourDeltas.set(row.activity,(hourDeltas.get(row.activity)??0)+delta)
            const dk=`${row.activity}|${row.uid}`
            const cur=dayDeltas.get(dk)??{activity:row.activity,uid:row.uid,seconds:0}
            cur.seconds+=delta;dayDeltas.set(dk,cur)
          }
        }
        await client.query(`insert into mp_session_activity(instance,session_id,uid,activity,seconds,updated_at)
          select $1,s.* from jsonb_to_recordset($2) as s(session_id text,uid bigint,activity text,seconds integer,updated_at timestamptz)
          on conflict(instance,session_id,activity) do update set
          seconds=greatest(mp_session_activity.seconds,excluded.seconds),
          updated_at=greatest(mp_session_activity.updated_at,excluded.updated_at)`,[instance,JSON.stringify(actRows)])
        if(hourDeltas.size){
          const hRows=[...hourDeltas.entries()].map(([activity,seconds])=>({activity,seconds}))
          await client.query(`insert into mp_gameplay_hour(hour,activity,seconds)
            select date_trunc('hour',$1::timestamptz),s.activity,s.seconds
            from jsonb_to_recordset($2) as s(activity text,seconds bigint)
            on conflict(hour,activity) do update set seconds=mp_gameplay_hour.seconds+excluded.seconds`,[at,JSON.stringify(hRows)])
        }
        if(dayDeltas.size){
          const dRows=[...dayDeltas.values()]
          await client.query(`insert into mp_gameplay_player_day(day,activity,uid,seconds)
            select (timezone('Asia/Shanghai',$1::timestamptz))::date,s.activity,s.uid,s.seconds
            from jsonb_to_recordset($2) as s(activity text,uid bigint,seconds integer)
            on conflict(day,activity,uid) do update set seconds=mp_gameplay_player_day.seconds+excluded.seconds`,[at,JSON.stringify(dRows)])
        }
      }
      await client.query(`delete from mp_activity_log where ts < $1::timestamptz - interval '30 days'`,[at])
      await client.query(`delete from mp_session_activity where updated_at < $1::timestamptz - interval '90 days'`,[at])
      await client.query(`delete from mp_gameplay_hour where hour < $1::timestamptz - interval '90 days'`,[at])
      await client.query(`delete from mp_gameplay_player_day where day < (timezone('Asia/Shanghai',$1::timestamptz))::date - 90`,[at])
      await client.query('release savepoint mp_activity_sync')
    }catch(error){
      await client.query('rollback to savepoint mp_activity_sync')
      console.warn('mp activity sync failed',error?.code??error?.message)
    }

    for(const [table,field,days] of [['mp_online_minute','ts',7],['mp_online_hour','ts',90],['mp_sessions','left_at',90]])
      await client.query(`delete from ${table} where ${field} < $1::timestamptz - interval '${days} days'`,[at])
    await client.query('commit')
  }catch(error){await client.query('rollback');throw error}finally{client.release()}
}

export async function history(db,range){
  const minute=range==='24h',span=minute?'24 hours':range==='7d'?'7 days':range==='90d'?'90 days':'30 days'
  const [{rows:series},{rows:daily}]=await Promise.all([
    db.query(`select ts,online,${minute?'online as peak,ts':'peak,peak_at'} as "peakAt" from
      ${minute?'mp_online_minute':'mp_online_hour'} where ts>=now()-$1::interval order by ts`,[span]),
    db.query(`with days as (select generate_series((timezone('Asia/Shanghai',now()-$1::interval))::date,
        timezone('Asia/Shanghai',now())::date,'1 day')::timestamp as day), bounds as (select day,
        greatest(day at time zone 'Asia/Shanghai',now()-$1::interval) as lo,(day+'1 day'::interval) at time zone 'Asia/Shanghai' as hi from days)
      select day::date::text as day,count(distinct uid)::int as dau,count(id) filter(where joined_at>=lo)::int as sessions,
        avg(extract(epoch from left_at-joined_at)) filter(where joined_at>=lo)::float8 as "avgDurationSec",
        percentile_cont(0.5) within group(order by extract(epoch from left_at-joined_at)) filter(where joined_at>=lo) as "medianDurationSec"
      from bounds left join mp_sessions on joined_at<hi and coalesce(left_at,last_seen)>=lo group by day order by day`,[span]),
  ])
  const best=series.reduce((best,row)=>!best||row.peak>best.peak?row:best,null)
  const dayFmt=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'})
  const peaks=new Map()
  for(const row of series){const day=dayFmt.format(row.peakAt);if(!peaks.has(day)||row.peak>peaks.get(day).peak)peaks.set(day,row)}
  for(const row of daily){const top=peaks.get(row.day);row.peak=top?.peak??null;row.peakAt=top?.peakAt??null}
  return {range,grain:minute?'minute':'hour',series,daily,peak:best?.peak??null,peakAt:best?.peakAt??null}
}

const spanMap={'24h':'24 hours','7d':'7 days','30d':'30 days','90d':'90 days'}
const daysMap={'24h':1,'7d':7,'30d':30,'90d':90}

export async function activities(db,{uid=null,q='',kind='',activity='',range='7d',limit=100}={},liveSnapshot=null,resolveLandmark=null){
  await ensureMpActivitySchema(db)
  const span=spanMap[range]??'7 days', days=daysMap[range]??7, search=q.trim()
  const [{rows:dbLogs},{rows:dbAccounts},{rows:dbAccountActs}]=await Promise.all([
    db.query(`select l.instance::float8 as instance,l.seq::float8 as seq,l.ts,l.session_id as "sessionId",l.uid::float8 as uid,
      l.name,u.id as "accountId",l.kind,l.activity,l.detail,l.duration_sec as "durationSec",l.landmark,l.x,l.z
      from mp_activity_log l left join users u on u.uid=l.uid
      where l.ts >= now() - $1::interval
        and ($2::bigint is null or l.uid=$2)
        and ($3::text='' or l.kind=$3)
        and ($4::text='' or l.activity=$4)
        and ($5::text='' or strpos(lower(l.name),lower($5))>0 or strpos(lower(coalesce(l.detail,'')),lower($5))>0 or strpos(lower(coalesce(l.landmark,'')),lower($5))>0 or l.uid::text=$5)
      order by l.ts desc, l.seq desc limit $6`,[span,uid,kind,activity,search,limit]),
    db.query(`select l.uid::float8 as uid,
      (array_agg(l.name order by l.ts desc,l.seq desc))[1] as name,
      max(u.id) as "accountId",
      max(l.ts) as "lastActiveAt",
      (array_agg(l.activity order by l.ts desc,l.seq desc) filter(where l.activity is not null))[1] as "lastActivity",
      (array_agg(l.landmark order by l.ts desc,l.seq desc) filter(where l.landmark is not null))[1] as "lastLandmark",
      count(*)::int as "recentCount"
      from mp_activity_log l left join users u on u.uid=l.uid
      where l.ts >= now() - $1::interval
      group by l.uid order by max(l.ts) desc limit 40`,[span]),
    db.query(`select uid::float8 as uid, activity, sum(seconds)::bigint as seconds
      from mp_gameplay_player_day
      where day >= (timezone('Asia/Shanghai',now()))::date - ($1::int - 1)
      group by uid, activity`,[days]),
  ])

  const seen=new Set(dbLogs.map(r=>`${r.instance}:${r.seq}`))
  const merged=[...dbLogs]
  const livePlayers=liveSnapshot?.players??[]
  const onlineByUid=new Map(livePlayers.map(p=>[Number(p.uid),p]))
  const accountIdByUid=new Map()
  for(const row of dbAccounts)if(row.accountId)accountIdByUid.set(Number(row.uid),row.accountId)
  if(livePlayers.length){
    const missingUids=livePlayers.map(p=>p.uid).filter(id=>!accountIdByUid.has(Number(id)))
    if(missingUids.length){
      const {rows:uRows}=await db.query('select uid::float8 as uid,id from users where uid=any($1::bigint[])',[missingUids])
      for(const u of uRows)accountIdByUid.set(Number(u.uid),u.id)
    }
  }
  if(liveSnapshot?.activities?.length){
    const inst=Number(liveSnapshot.server?.startedAt||0)
    const minTs=Date.now()-(days*86400e3)
    const searchLower=search.toLowerCase()
    for(const item of liveSnapshot.activities){
      if(item.uid==null||item.ts<minTs)continue
      const key=`${inst}:${item.seq}`
      if(seen.has(key))continue
      if(uid!=null&&Number(item.uid)!==Number(uid))continue
      if(kind&&item.kind!==kind)continue
      if(activity&&item.activity!==activity)continue
      const place=resolveLandmark&&Number.isFinite(item.x)&&Number.isFinite(item.z)?resolveLandmark(item.x,item.z):null
      const landmark=place?.name??null
      if(searchLower&&!(String(item.name||'').toLowerCase().includes(searchLower)||String(item.detail||'').toLowerCase().includes(searchLower)||String(landmark||'').toLowerCase().includes(searchLower)||String(item.uid)===search))continue
      merged.push({
        instance:inst,seq:Number(item.seq),ts:new Date(item.ts).toISOString(),sessionId:String(item.sessionId||''),
        uid:Number(item.uid),name:String(item.name||''),accountId:accountIdByUid.get(Number(item.uid))??null,
        kind:String(item.kind||'activity'),activity:item.activity??null,detail:item.detail||null,
        durationSec:item.durationSec??null,landmark,x:item.x??null,z:item.z??null,
      })
    }
  }
  merged.sort((a,b)=>Date.parse(b.ts)-Date.parse(a.ts)||b.seq-a.seq)

  const actsByUid=new Map()
  for(const row of dbAccountActs){
    const u=Number(row.uid)
    const m=actsByUid.get(u)??new Map()
    m.set(row.activity,(m.get(row.activity)??0)+Number(row.seconds||0))
    actsByUid.set(u,m)
  }
  const accountMap=new Map()
  for(const row of dbAccounts){
    const u=Number(row.uid)
    accountMap.set(u,{
      uid:u,name:row.name,accountId:row.accountId??null,online:false,
      currentActivity:row.lastActivity??null,currentDetail:'',currentLandmark:row.lastLandmark??null,
      lastActiveAt:row.lastActiveAt,recentCount:Number(row.recentCount||0),
    })
  }
  for(const p of livePlayers){
    const u=Number(p.uid)
    const place=resolveLandmark&&Number.isFinite(p.x)&&Number.isFinite(p.z)?resolveLandmark(p.x,p.z):null
    const existing=accountMap.get(u)
    accountMap.set(u,{
      uid:u,name:p.name,accountId:existing?.accountId??accountIdByUid.get(u)??null,online:true,
      currentActivity:p.activity??(p.mode==='bike'?'ebike':'walk'),currentDetail:p.activityDetail??'',
      currentLandmark:place?.name??existing?.currentLandmark??null,
      lastActiveAt:new Date().toISOString(),recentCount:existing?.recentCount??0,
    })
    if(p.activityTotals){
      const m=actsByUid.get(u)??new Map()
      for(const [act,sec] of Object.entries(p.activityTotals)){
        if(VALID_ACTIVITIES.has(act)&&sec>0)m.set(act,Math.max(m.get(act)??0,Math.round(sec)))
      }
      actsByUid.set(u,m)
    }
  }
  const accounts=[...accountMap.values()].map(acc=>{
    const m=actsByUid.get(acc.uid)??new Map()
    const topActivities=[...m.entries()].sort((a,b)=>b[1]-a[1]).slice(0,4).map(([act,seconds])=>({activity:act,seconds}))
    const totalSec=[...m.values()].reduce((s,v)=>s+v,0)
    return {...acc,online:onlineByUid.has(acc.uid),totalSec,topActivities}
  }).sort((a,b)=>Number(b.online)-Number(a.online)||Date.parse(b.lastActiveAt)-Date.parse(a.lastActiveAt)).slice(0,40)

  return {range,items:merged.slice(0,limit),accounts}
}

export async function gameplay(db,range='7d',liveSnapshot=null){
  await ensureMpActivitySchema(db)
  const span=spanMap[range]??'7 days', days=daysMap[range]??7, hourly=range==='24h'
  const livePlayers=liveSnapshot?.players??[]
  const instance=liveSnapshot?.server?.startedAt??null
  const siteRange=range==='24h'?'24h':'7d'
  const siteSpan=siteRange==='24h'?'24 hours':'7 days'

  const [{rows:dayTotals},{rows:hourSeries},{rows:segStats},{rows:syncedLive},{rows:siteRows},{rows:distinctTotalRows}]=await Promise.all([
    db.query(`select activity, sum(seconds)::bigint as seconds, count(distinct uid)::int as players
      from mp_gameplay_player_day
      where day >= (timezone('Asia/Shanghai',now()))::date - ($1::int - 1)
      group by activity`,[days]),
    hourly
      ? db.query(`select hour as ts, activity, seconds::bigint as seconds
          from mp_gameplay_hour where hour >= date_trunc('hour',now() - interval '24 hours') order by ts, activity`)
      : db.query(`select (timezone('Asia/Shanghai',hour))::date::text as day, activity, sum(seconds)::bigint as seconds
          from mp_gameplay_hour where hour >= now() - $1::interval group by 1, 2 order by 1, 2`,[span]),
    db.query(`select activity, count(*)::int as segments, avg(duration_sec)::float8 as "avgSegmentSec"
      from mp_activity_log where ts >= now() - $1::interval and kind='activity_end' and activity is not null and duration_sec is not null
      group by activity`,[span]),
    instance&&livePlayers.length
      ? db.query('select session_id,activity,seconds from mp_session_activity where instance=$1 and session_id=any($2::text[])',[instance,livePlayers.map(p=>p.id)])
      : Promise.resolve({rows:[]}),
    // 全站模式参考（含单人/漫游，读既有 perf_event session 快照；长窗口最多扫近 7 天避免拖慢 30d/90d 接口）
    db.query(`with latest as (
        select distinct on (session) fields from perf_event
        where received >= now() - $1::interval and kind = 'session'
        order by session, received desc, batch_position desc
      )
      select
        count(*)::int as sessions,
        coalesce(sum((fields->>'walkSeconds')::float),0)::float8 as walk,
        coalesce(sum((fields->>'driveSeconds')::float),0)::float8 as drive,
        coalesce(sum((fields->>'flySeconds')::float),0)::float8 as fly,
        coalesce(sum((fields->>'mapSeconds')::float),0)::float8 as map,
        coalesce(sum((fields->>'menuSeconds')::float),0)::float8 as menu
      from latest`,[siteSpan]).catch(()=>({rows:[]})),
    db.query(`select count(distinct uid)::int as total
      from mp_gameplay_player_day where day >= (timezone('Asia/Shanghai',now()))::date - ($1::int - 1)`,[days]),
  ])

  const totalUids=new Set()
  const persistedByUid=new Map()
  if(livePlayers.length){
    const {rows:uDayRows}=await db.query(`select uid::float8 as uid,activity from mp_gameplay_player_day
      where day >= (timezone('Asia/Shanghai',now()))::date - ($1::int - 1) and uid=any($2::bigint[])`,[days,livePlayers.map(p=>p.uid)])
    for(const r of uDayRows){
      totalUids.add(Number(r.uid))
      const set=persistedByUid.get(r.activity)??new Set();set.add(Number(r.uid));persistedByUid.set(r.activity,set)
    }
  }

  const syncedMap=new Map(syncedLive.map(r=>[`${r.session_id}|${r.activity}`,Number(r.seconds)||0]))
  const actMap=new Map()
  for(const row of dayTotals){
    actMap.set(row.activity,{activity:row.activity,seconds:Number(row.seconds||0),players:Number(row.players||0),activeNow:0,segments:0,avgSegmentSec:null})
  }
  for(const row of segStats){
    const cur=actMap.get(row.activity)??{activity:row.activity,seconds:0,players:0,activeNow:0,segments:0,avgSegmentSec:null}
    cur.segments=Number(row.segments||0)
    cur.avgSegmentSec=row.avgSegmentSec!=null?Math.round(Number(row.avgSegmentSec)):null
    actMap.set(row.activity,cur)
  }

  // 把当前在线玩家尚未刷入库的增量秒数补进统计与当前时间桶，打开页面即刻看到实时变化
  const liveDeltaByAct=new Map()
  let extraDistinctPlayers=0
  const seenExtraPlayer=new Set()
  for(const p of livePlayers){
    const u=Number(p.uid)
    const curAct=VALID_ACTIVITIES.has(p.activity)?p.activity:(p.mode==='bike'?'ebike':'walk')
    const curEntry=actMap.get(curAct)??{activity:curAct,seconds:0,players:0,activeNow:0,segments:0,avgSegmentSec:null}
    curEntry.activeNow++
    actMap.set(curAct,curEntry)
    const totals=p.activityTotals??{}
    for(const [act,rawSec] of Object.entries(totals)){
      if(!VALID_ACTIVITIES.has(act))continue
      const sec=Math.max(0,Math.round(Number(rawSec)||0))
      if(!sec)continue
      const synced=syncedMap.get(`${p.id}|${act}`)??0
      const delta=Math.max(0,sec-synced)
      const entry=actMap.get(act)??{activity:act,seconds:0,players:0,activeNow:0,segments:0,avgSegmentSec:null}
      entry.seconds+=delta
      const seenSet=persistedByUid.get(act)??new Set()
      if(!seenSet.has(u)){seenSet.add(u);persistedByUid.set(act,seenSet);entry.players++}
      actMap.set(act,entry)
      if(delta>0)liveDeltaByAct.set(act,(liveDeltaByAct.get(act)??0)+delta)
      if(!totalUids.has(u)&&!seenExtraPlayer.has(u)){seenExtraPlayer.add(u);extraDistinctPlayers++}
    }
  }

  const list=[...actMap.values()].filter(r=>r.seconds>0||r.activeNow>0).sort((a,b)=>b.seconds-a.seconds||b.activeNow-a.activeNow)
  const totalSeconds=list.reduce((sum,r)=>sum+r.seconds,0)
  const totalPlayers=Number(distinctTotalRows[0]?.total??0)+extraDistinctPlayers
  const activities=list.map(r=>({
    ...r,
    share:totalSeconds>0?r.seconds/totalSeconds:0,
    avgPerPlayerSec:r.players>0?Math.round(r.seconds/r.players):0,
  }))

  // 合并当前桶的增量秒数到趋势序列
  const now=new Date()
  const nowHourIso=new Date(Math.floor(now.getTime()/3600e3)*3600e3).toISOString()
  const nowDay=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now)
  const seriesMap=new Map()
  for(const r of hourSeries){
    const ts=hourly?new Date(r.ts).toISOString():r.day
    const key=`${ts}|${r.activity}`
    seriesMap.set(key,{ts,activity:r.activity,seconds:Number(r.seconds||0)})
  }
  for(const [act,delta] of liveDeltaByAct){
    const ts=hourly?nowHourIso:nowDay
    const key=`${ts}|${act}`
    const cur=seriesMap.get(key)??{ts,activity:act,seconds:0}
    cur.seconds+=delta
    seriesMap.set(key,cur)
  }
  const series=[...seriesMap.values()].sort((a,b)=>a.ts.localeCompare(b.ts)||a.activity.localeCompare(b.activity))

  const sr=siteRows[0]
  const siteModes=sr&&sr.sessions>0?['walk','drive','fly','map','menu'].map(mode=>({mode,seconds:Math.round(Number(sr[mode]||0))})).filter(r=>r.seconds>0).sort((a,b)=>b.seconds-a.seconds):[]
  return {range,grain:hourly?'hour':'day',totalSeconds,totalPlayers,activities,series,siteModes,siteSessions:Number(sr?.sessions??0),siteRange}
}
