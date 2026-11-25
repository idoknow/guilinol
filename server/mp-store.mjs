import {isIP} from 'node:net'

export async function regions(db,items){
  const ips=[...new Set(items.map(item=>item.ip?.replace(/^::ffff:/,'')).filter(value=>isIP(value)))]
  const {rows}=await db.query(`select ip, to_jsonb(geo) as region from unnest($1::text[]) ip
    left join lateral (select country,region,city,isp from perf_network where prefix >>= ip::inet
      order by masklen(prefix) desc limit 1) geo on true`,[ips])
  const map=new Map(rows.map(row=>[row.ip,row.region]))
  return ip=>map.get(ip?.replace(/^::ffff:/,''))??null
}

export async function record(pool,state,at=new Date()){
  const {players,server,events}=state, instance=server.startedAt
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
    for(const [table,field,days] of [['mp_online_minute','ts',7],['mp_online_hour','ts',90],['mp_sessions','left_at',90]])
      await client.query(`delete from ${table} where ${field} < $1::timestamptz - interval '${days} days'`,[at])
    await client.query('commit')
  }catch(error){await client.query('rollback');throw error}finally{client.release()}
}

export async function history(db,range){
  const minute=range==='24h',span=minute?'24 hours':range==='7d'?'7 days':'30 days'
  const {rows:series}=await db.query(`select ts,online,${minute?'online as peak,ts':'peak,peak_at'} as "peakAt" from
    ${minute?'mp_online_minute':'mp_online_hour'} where ts>=now()-$1::interval order by ts`,[span])
  const {rows:daily}=await db.query(`with days as (select generate_series((timezone('Asia/Shanghai',now()-$1::interval))::date,
      timezone('Asia/Shanghai',now())::date,'1 day')::timestamp as day), bounds as (select day,
      greatest(day at time zone 'Asia/Shanghai',now()-$1::interval) as lo,(day+'1 day'::interval) at time zone 'Asia/Shanghai' as hi from days)
    select day::date::text as day,count(distinct uid)::int as dau,count(id) filter(where joined_at>=lo)::int as sessions,
      avg(extract(epoch from left_at-joined_at)) filter(where joined_at>=lo)::float8 as "avgDurationSec",
      percentile_cont(0.5) within group(order by extract(epoch from left_at-joined_at)) filter(where joined_at>=lo) as "medianDurationSec"
    from bounds left join mp_sessions on joined_at<hi and coalesce(left_at,last_seen)>=lo group by day order by day`,[span])
  const best=series.reduce((best,row)=>!best||row.peak>best.peak?row:best,null)
  const dayFmt=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'})
  const peaks=new Map()
  for(const row of series){const day=dayFmt.format(row.peakAt);if(!peaks.has(day)||row.peak>peaks.get(day).peak)peaks.set(day,row)}
  for(const row of daily){const top=peaks.get(row.day);row.peak=top?.peak??null;row.peakAt=top?.peakAt??null}
  return {range,grain:minute?'minute':'hour',series,daily,peak:best?.peak??null,peakAt:best?.peakAt??null}
}
