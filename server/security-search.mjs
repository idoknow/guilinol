import {isIP} from 'node:net'

const uid = value => /^\d+$/.test(value) && Number.isSafeInteger(Number(value))
const ip = value => !value.includes('%') && isIP(value)
const recordId = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) || /^legacy-\d+$/i.test(value)
const fingerprint = value => /^[a-f\d]{16,64}$/i.test(value)
export function detectKind(value) {
  return recordId(value) ? 'record' : uid(value) ? 'uid' : ip(value) ? 'ip' : fingerprint(value) ? 'fp' : 'nick'
}

const active = '(until_ms is null or until_ms > extract(epoch from now())*1000)'
const accountsOnDevice = `select d.uid,u.nickname,d.last from mp_devices d left join users u using(uid)
  where d.fp=device.fp order by d.last desc nulls last,d.uid limit 50`
const deviceDetails = `device.fp,device.model,device.browser,device.screen,device.ip24,device.city,device.isp,
  left(device.ua,120) ua,device.first,device.last,
  (select count(*) from mp_devices where fp=device.fp) account_count,
  (select jsonb_agg(to_jsonb(owner)) from (${accountsOnDevice}) owner) accounts,
  (select jsonb_build_object('until_ms',until_ms,'actor',actor,'reason',reason) from mp_bans
    where kind='fp' and value=device.fp and ${active}) ban`

async function profile(rows, value) {
  const [account] = await rows(`select uid,nickname,email,created_at,
    (select max(last_login_at) from social_identities where user_id=users.id) last_login_at,
    (select count(*) from mp_cheat_captures where uid=users.uid) captures
    from users where uid=$1`, [value])
  if (!account) return {account:null}
  const devices = await rows(`select ${deviceDetails} from mp_devices device where device.uid=$1
    order by device.last desc nulls last,device.fp limit 50`, [value])
  const sessions = await rows(`select joined_at,left_at,last_seen,
    extract(epoch from coalesce(left_at,last_seen)-joined_at)::int duration,client_ip,node_ip,region,fp
    from mp_sessions where uid=$1 order by joined_at desc limit 20`, [value])
  const bans = await rows(`select kind,value,until_ms,reason,actor from mp_bans where ${active} and
    ((kind='uid' and value=$1::bigint::text) or (kind='fp' and value in (select fp from mp_devices where uid=$1)))`, [value])
  const violations = await rows(`select kind,count(*) as week,count(*) filter(where at>=extract(epoch from now()-interval '1 day')*1000) as day
    from mp_cheat_events where uid=$1 and at>=extract(epoch from now()-interval '7 days')*1000 group by kind order by kind`, [value])
  const [automatic] = await rows(`select count(*) as week,count(*) filter(where created_at>=extract(epoch from now()-interval '1 day')) as day
    from admin_audit where target_type='mp' and target_id=$1 and action='mp.ban' and actor_id in ('auto','protocol')
    and created_at>=extract(epoch from now()-interval '7 days')`, [value])
  return {account,devices,sessions,bans,violations,automatic}
}

async function byIp(rows,value) {
  const recent = `last_seen >= now()-interval '30 days'`
  const exact = `client_ip::inet=$1::inet`
  const network = `network(set_masklen($1::inet,case family($1::inet) when 4 then 24 else 64 end))`
  const [summary] = await rows(`select min(joined_at) first,max(last_seen) last,
    count(distinct uid) filter(where ${recent}) accounts,count(distinct nullif(fp,'')) filter(where ${recent}) devices
    from mp_sessions where ${exact}`, [value])
  const [geo] = await rows(`select coalesce((select to_jsonb(g)-'prefix' from perf_network g where prefix >>= $1::inet order by masklen(prefix) desc limit 1),
    (select region from mp_sessions where ${exact} and region is not null order by last_seen desc limit 1),
    (select jsonb_build_object('city',city,'isp',isp) from mp_devices where ip24=${network}::text and city<>'' order by last desc limit 1)) location`, [value])
  const accounts = await rows(`select s.uid,coalesce(u.nickname,max(s.name)) nickname,max(last_seen) last,
    bool_or(nullif(s.fp,'') is null) historical from mp_sessions s left join users u using(uid) where ${exact} and ${recent}
    group by s.uid,u.nickname order by last desc,s.uid limit 50`, [value])
  const devices = await rows(`select recent.* from (select distinct on (s.fp) s.uid,s.fp,u.nickname,s.last_seen as last
    from mp_sessions s left join users u using(uid) where ${exact} and ${recent} and nullif(s.fp,'') is not null
    order by s.fp,s.last_seen desc) recent order by recent.last desc,recent.fp limit 50`, [value])
  const subnet = await rows(`with evidence as (
    select uid,nullif(fp,'') fp,last_seen as seen from mp_sessions where client_ip::inet <<= ${network} and not (${exact}) and ${recent}
    union all select uid,fp,to_timestamp(last/1000.0) from mp_devices where ip24=${network}::text and last>=extract(epoch from now()-interval '30 days')*1000
  ) select uid,fp,u.nickname,max(seen) as last from evidence left join users u using(uid)
    where not exists(select 1 from mp_sessions s where ${exact} and ${recent} and s.uid=evidence.uid and s.fp is not distinct from evidence.fp)
    group by uid,fp,u.nickname order by last desc,uid,fp limit 30`, [value])
  return {summary:{...summary,...geo},accounts,devices,subnet}
}

async function byRecord(rows, value) {
  const safeRows = async (sql, args) => {
    try { return await rows(sql, args) } catch (error) {
      if (['42P01', '42703'].includes(error?.code) || /does not exist|no such/i.test(String(error?.message ?? ''))) return []
      throw error
    }
  }
  const [rec] = await safeRows(
    `select id, kind, value, uid::float8 as uid, fp, tier, reason, actor, policy_version,
            created_ms::float8 as created_ms, until_ms::float8 as until_ms,
            revoked_ms::float8 as revoked_ms, revoked_by, revoke_reason, health, meta
     from mp_ban_records where id=$1 limit 1`,
    [value],
  )
  if (!rec) return { record: null, account: null, events: [], captures: [], appeals: [], relatedAccounts: [] }
  const targetUid = rec.uid != null ? String(rec.uid) : (rec.kind === 'uid' && uid(String(rec.value)) ? String(rec.value) : null)
  const targetFp = rec.fp || (rec.kind === 'fp' ? String(rec.value) : '')
  const [account] = targetUid
    ? await safeRows(
        `select id, uid::float8 as uid, nickname, email, created_at from users where uid=$1 limit 1`,
        [targetUid],
      )
    : []
  let events = await safeRows(
    `select id, uid::float8 as uid, fp, kind, at::float8 as at, detail, health, record_id
     from mp_cheat_events where record_id=$1 order by at desc limit 50`,
    [value],
  )
  if (!events.length && targetUid && Number.isFinite(rec.created_ms)) {
    events = await safeRows(
      `select id, uid::float8 as uid, fp, kind, at::float8 as at, detail
       from mp_cheat_events where uid=$1 and at between $2 and $3 order by at desc limit 30`,
      [targetUid, rec.created_ms - 10 * 60_000, rec.created_ms + 60_000],
    )
  }
  let captures = await safeRows(
    `select id, uid::float8 as uid, nickname, fp, kind, record_id as "recordId",
            captured_at::float8 as "capturedAt", state_label as "stateLabel", server_state as "serverState",
            speed_ms::float8 as "speedMs", client_speed_ms::float8 as "clientSpeedMs",
            landmark, landmark_dist as "landmarkDist", meta, width, height, image_bytes as "imageBytes"
     from mp_cheat_captures where record_id=$1 order by captured_at desc limit 12`,
    [value],
  )
  if (!captures.length && targetUid && Number.isFinite(rec.created_ms)) {
    captures = await safeRows(
      `select id, uid::float8 as uid, nickname, fp, kind,
              captured_at::float8 as "capturedAt", state_label as "stateLabel", server_state as "serverState",
              speed_ms::float8 as "speedMs", client_speed_ms::float8 as "clientSpeedMs",
              landmark, landmark_dist as "landmarkDist", meta, width, height, image_bytes as "imageBytes"
       from mp_cheat_captures where uid=$1 and captured_at between $2 and $3 order by captured_at desc limit 8`,
      [targetUid, rec.created_ms - 10 * 60_000, rec.created_ms + 2 * 60_000],
    )
  }
  const formattedCaptures = captures.map((row) => ({
    ...row,
    imageUrl: `/api/admin/mp/cheat-captures/${encodeURIComponent(row.id)}/image`,
  }))
  const relatedAccounts = targetFp
    ? await safeRows(
        `select d.uid::float8 as uid, u.nickname, d.last::float8 as last
         from mp_devices d left join users u using(uid)
         where d.fp=$1 order by d.last desc nulls last, d.uid limit 50`,
        [targetFp],
      )
    : []
  const appeals = await safeRows(
    `select id, title, status, submitted_at, updated_at from feedback where ban_record_id=$1 order by updated_at desc limit 10`,
    [value],
  )
  return { record: rec, account: account ?? null, events, captures: formattedCaptures, appeals, relatedAccounts }
}

const reply=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}})
export async function securitySearch(pool,request,actor=null) {
  if(request.method!=='GET')return reply({error:{message:'仅支持 GET'}},405)
  const params=new URL(request.url).searchParams,raw=params.get('q')??'',value=raw.trim()
  let kind=params.get('kind')??'auto'
  if(kind==='auto')kind=detectKind(value)
  if(!value || raw.length>128 || value.includes('\0') || !Object.hasOwn({record:recordId,uid,ip,fp:fingerprint,nick:true},kind)
    || (kind==='record'&&!recordId(value)) || (kind==='uid'&&!uid(value)) || (kind==='fp'&&!fingerprint(value)) || (kind==='ip'&&!ip(value)))return reply({error:{message:'无效的查询条件'}},400)
  const client=await pool.connect(),deadline=performance.now()+3000
  try {
    await client.query('begin isolation level repeatable read read only')
    const rows=async(sql,args)=>{
      const remaining=Math.floor(deadline-performance.now())
      if(remaining<=0)throw Object.assign(Error('timeout'),{code:'57014'})
      await client.query("select set_config('statement_timeout',$1,true)",[String(remaining)])
      return (await client.query(sql,args)).rows
    }
    let result
    if(kind==='record')result=await byRecord(rows,value)
    if(kind==='nick')result={candidates:await rows(`select uid,nickname from users where nickname ilike $1
      order by (lower(nickname)=lower($2)) desc,uid limit 10`,['%'+value.replace(/[\\_%]/g,'\\$&')+'%',value])}
    if(kind==='uid')result=await profile(rows,String(Number(value)))
    if(kind==='ip')result=await byIp(rows,value)
    if(kind==='fp'){
      const [device]=await rows(`select ${deviceDetails},(select min(first) from mp_devices where fp=device.fp) first
        from mp_devices device where fp=$1 order by last desc nulls last,uid limit 1`,[value.toLowerCase()])
      result={device:device??null}
    }
    await client.query('commit')
    if (actor) {
      pool.query(
        "insert into admin_audit(actor_id,action,target_type,target_id,detail) values($1,'security.search','security',$2,$3)",
        [actor, kind, { kind, query: value.slice(0, 80) }],
      ).catch(() => {})
    }
    return reply({kind,...result})
  }catch(error){
    await client.query('rollback')
    if(error.code==='57014')return reply({error:{message:'查询超时，请缩小范围'}},504)
    throw error
  }finally{client.release()}
}
