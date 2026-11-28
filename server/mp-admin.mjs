import {readFile} from 'node:fs/promises'
import {guardAdmin} from './web-guard-admin.mjs'
import {securitySearch} from './security-search.mjs'
import {enrichBans,searchBanUsers} from './ban-identities.mjs'
import {activities,gameplay,history,record,regions} from './mp-store.mjs'

const json=(value,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store'}})
const down=()=>json({rt:'down',error:'联机服务不可用'})

// 桂林核心地标兜底表（世界坐标 x 东、z 南，与 web/src/play/spots.ts 及 pipeline/landmarks.json 对齐）。
// 仅当所有 manifest 来源都不可达时启用，避免联机页面全部回退为「野外」。
const FALLBACK_PLACES=[
  {name:'象鼻山',x:-685,z:1182},
  {name:'日月双塔',x:-905,z:520},
  {name:'解放桥',x:-185,z:35},
  {name:'逍遥楼',x:-235,z:-120},
  {name:'伏波山',x:-30,z:-620},
  {name:'叠彩山',x:-200,z:-1395},
  {name:'独秀峰',x:-525,z:-595},
  {name:'古南门',x:-1425,z:175},
  {name:'东西巷',x:-478,z:-182},
  {name:'十字街',x:-881,z:-165},
  {name:'榕湖划船坞',x:-1340,z:326},
  {name:'解放桥竹筏码头',x:-164,z:162},
  {name:'田源米粉',x:-1139,z:-56},
  {name:'靖江王城',x:-588,z:-227},
  {name:'花桥',x:414,z:333},
  {name:'丽泽桥',x:-1598,z:-185},
  {name:'木龙湖',x:-58,z:-1160},
  {name:'桂林站',x:-2191,z:1794},
  {name:'穿山',x:-52,z:2892},
]

function extractPlaces(manifest){
  if(!manifest||typeof manifest!=='object')return []
  const places=[]
  for(const item of manifest.landmarks??[]){
    if(Array.isArray(item?.position)&&item.name&&!/^auto-/.test(item.name)&&Number.isFinite(item.position[0])&&Number.isFinite(item.position[2])){
      places.push({name:String(item.name),x:Number(item.position[0]),z:Number(item.position[2])})
    }
  }
  for(const item of manifest.peaks?.entries??[]){
    if(Array.isArray(item?.center)&&item.name&&!/^auto-/.test(item.name)&&Number.isFinite(item.center[0])&&Number.isFinite(item.center[2])){
      places.push({name:String(item.name),x:Number(item.center[0]),z:Number(item.center[2])})
    }
  }
  return places
}

export function multiplayer(pool,env,{cache}={}){
  const base=env.RT_INTERNAL_URL||'http://glol-rt.idoknow.svc.cluster.local:8790'
  const state=async()=>{
    if(!env.RT_ADMIN_TOKEN)throw Error('disabled')
    const response=await fetch(base+'/admin/state',{headers:{'X-Admin-Token':env.RT_ADMIN_TOKEN},signal:AbortSignal.timeout(3500),redirect:'error'})
    if(!response.ok)throw Error('RT unavailable')
    return response.json()
  }
  let landmarks=[],reloadAt=0,landmarkSource='none',warnedAt=0
  function manifestCandidates(){
    if(env.MP_WORLD_MANIFEST_URL)return [env.MP_WORLD_MANIFEST_URL]
    // 线上 glol-api 与 glol-nginx 同 pod（127.0.0.1:8080 零 DNS 直连）；
    // pod 采用 dnsPolicy: None 无 search 域，跨 pod 必须用完整 FQDN，不能写短名 glol-web。
    const urls=[
      'http://127.0.0.1:8080/world/manifest.json',
      'http://glol-web.idoknow.svc.cluster.local:8080/world/manifest.json',
    ]
    if(env.PUBLIC_ORIGIN){
      try{urls.push(new URL('/world/manifest.json',env.PUBLIC_ORIGIN).href)}catch{}
    }
    return urls
  }
  async function loadLandmarks(){
    if(Date.now()<reloadAt)return
    reloadAt=Date.now()+30000
    for(const url of manifestCandidates()){
      try{
        const response=await fetch(url,{signal:AbortSignal.timeout(2000)})
        if(response.ok){
          const places=extractPlaces(await response.json())
          if(places.length){
            landmarks=places
            landmarkSource=url
            reloadAt=Date.now()+3600000
            return
          }
        }
      }catch{}
    }
    // 本地开发/预览兜底读磁盘 manifest
    if(!env.MP_WORLD_MANIFEST_URL){
      for(const file of ['public/world/manifest.json','dist/world/manifest.json']){
        try{
          const places=extractPlaces(JSON.parse(await readFile(file,'utf8')))
          if(places.length){
            landmarks=places
            landmarkSource='file:'+file
            reloadAt=Date.now()+3600000
            return
          }
        }catch{}
      }
    }
    // 全部拉取失败时用内置桂林核心地标坐标兜底（保留 30 秒重试 manifest），不让页面全员显示「野外」
    if(!landmarks.length){
      landmarks=FALLBACK_PLACES
      landmarkSource='builtin'
    }
    if(Date.now()-warnedAt>300000){
      warnedAt=Date.now()
      console.warn('mp landmarks manifest unavailable, using fallback:',landmarkSource)
    }
  }
  function nearestPlace(x,z){
    if(!Number.isFinite(x)||!Number.isFinite(z)||!landmarks.length)return null
    let best=Infinity,name=null
    for(const item of landmarks){
      const distance=(item.x-x)**2+(item.z-z)**2
      if(distance<best){best=distance;name=item.name}
    }
    return name?{name,dist:Math.round(Math.sqrt(best))}:null
  }
  async function resolvePlace(x,z){
    await loadLandmarks()
    return nearestPlace(x,z)
  }
  let cheatCaptures=null
  function setCheatCaptures(service){cheatCaptures=service}
  async function route(path,request,actor){
    if(path.startsWith('admin/bans/'))return guardAdmin(pool,env,path,request,actor)
    const params=new URL(request.url).searchParams
    if(path==='admin/security-search')return securitySearch(pool,request,actor)
    if(cheatCaptures&&path.startsWith('admin/mp/cheat-captures')){
      const handled=await cheatCaptures.adminRoute(path,request,actor)
      if(handled)return handled
    }
    if(path==='admin/user-search'){
      if(request.method!=='GET')return json({error:'method not allowed'},405)
      return json(await searchBanUsers(pool,(params.get('q')??'').trim().slice(0,128)))
    }
    // 按记录编号查封禁总账、关联事件与抓拍（一屏审申诉用；优先合并 RT 实时状态，RT 不可用时回退 PG）
    if(path==='admin/ban-record'){
      if(request.method!=='GET')return json({error:'method not allowed'},405)
      const id=(params.get('id')??'').trim()
      if(!id||!/^[A-Za-z0-9_-]{6,64}$/.test(id))return json({error:'invalid record id'},400)
      const safeQuery=async(sql,args)=>{
        try{return (await pool.query(sql,args)).rows}catch(err){
          if(['42P01','42703'].includes(err?.code)||/does not exist|no such/i.test(String(err?.message??'')))return []
          throw err
        }
      }
      const normalizeRecord=(raw)=>{
        if(!raw||typeof raw!=='object')return null
        const uidVal=raw.uid!=null&&Number.isFinite(Number(raw.uid))?Number(raw.uid):null
        const fpVal=raw.fp?String(raw.fp):null
        const recId=String(raw.id??raw.recordId??raw.record_id??id)
        return {
          id:recId,
          kind:raw.kind||(uidVal!=null?'uid':'fp'),
          value:raw.value!=null?String(raw.value):(uidVal!=null?String(uidVal):fpVal||''),
          uid:uidVal,
          fp:fpVal,
          tier:raw.tier??'ban',
          reason:raw.reason??'',
          actor:raw.actor??'',
          policy_version:raw.policy_version??raw.policyVersion??null,
          created_ms:raw.created_ms??raw.createdAt??raw.created_at??null,
          until_ms:raw.until_ms??raw.until??null,
          revoked_ms:raw.revoked_ms??raw.revokedAt??raw.revoked_at??null,
          revoked_by:raw.revoked_by??raw.revokedBy??null,
          revoke_reason:raw.revoke_reason??raw.revokedReason??raw.revoked_reason??null,
          health:raw.health??raw.health_snapshot??null,
        }
      }
      let rtData=null
      if(env.RT_ADMIN_TOKEN){
        try{
          const resp=await fetch(`${base}/admin/ban-record?id=${encodeURIComponent(id)}`,{
            headers:{'X-Admin-Token':env.RT_ADMIN_TOKEN},signal:AbortSignal.timeout(4000),redirect:'error',
          })
          if(resp.ok)rtData=await resp.json().catch(()=>null)
        }catch{}
      }
      const [pgRec]=await safeQuery(
        `select record_id as id,
                case when uid is not null then 'uid' else 'fp' end as kind,
                coalesce(uid::text, fp, '') as value,
                uid::float8 as uid, fp, tier, reason, actor, policy_version,
                created_at::float8 as created_ms, until_ms::float8 as until_ms,
                revoked_at::float8 as revoked_ms, revoked_by, revoked_reason as revoke_reason,
                health_snapshot as health
         from mp_ban_records where record_id=$1 limit 1`,
        [id],
      )
      const record=normalizeRecord(rtData?.record??pgRec??null)
      if(!record)return json({record:null,account:null,events:[],captures:[],relatedAccounts:[]})
      const targetUid=record.uid!=null?String(record.uid):(record.kind==='uid'&&/^\d+$/.test(String(record.value))?String(record.value):null)
      const targetFp=record.fp||(record.kind==='fp'?String(record.value):'')
      const [account]=targetUid
        ? await safeQuery('select id, uid::float8 as uid, nickname, email, created_at from users where uid=$1 limit 1',[targetUid])
        : []
      let events=Array.isArray(rtData?.events)&&rtData.events.length?rtData.events:await safeQuery(
        'select id, uid::float8 as uid, fp, kind, at::float8 as at, detail, health, record_id from mp_cheat_events where record_id=$1 order by at desc limit 50',
        [id],
      )
      if(!events.length&&targetUid&&Number.isFinite(Number(record.created_ms))){
        const createdMs=Number(record.created_ms)
        events=await safeQuery(
          'select id, uid::float8 as uid, fp, kind, at::float8 as at, detail from mp_cheat_events where uid=$1 and at between $2 and $3 order by at desc limit 30',
          [targetUid,createdMs-10*60_000,createdMs+60_000],
        )
      }
      let captures=await safeQuery(
        `select id, uid::float8 as uid, nickname, fp, kind, record_id as "recordId",
                captured_at::float8 as "capturedAt", state_label as "stateLabel", server_state as "serverState",
                speed_ms::float8 as "speedMs", client_speed_ms::float8 as "clientSpeedMs",
                landmark, landmark_dist as "landmarkDist", meta, width, height, image_bytes as "imageBytes"
         from mp_cheat_captures where record_id=$1 order by captured_at desc limit 12`,
        [id],
      )
      if(!captures.length&&targetUid&&Number.isFinite(Number(record.created_ms))){
        const createdMs=Number(record.created_ms)
        captures=await safeQuery(
          `select id, uid::float8 as uid, nickname, fp, kind,
                  captured_at::float8 as "capturedAt", state_label as "stateLabel", server_state as "serverState",
                  speed_ms::float8 as "speedMs", client_speed_ms::float8 as "clientSpeedMs",
                  landmark, landmark_dist as "landmarkDist", meta, width, height, image_bytes as "imageBytes"
           from mp_cheat_captures where uid=$1 and captured_at between $2 and $3 order by captured_at desc limit 8`,
          [targetUid,createdMs-10*60_000,createdMs+2*60_000],
        )
      }
      const relatedAccounts=targetFp
        ? await safeQuery(
            `select d.uid::float8 as uid, u.nickname, d.last::float8 as last
             from mp_devices d left join users u using(uid)
             where d.fp=$1 order by d.last desc nulls last, d.uid limit 50`,
            [targetFp],
          )
        : []
      return json({
        record,
        account:account??null,
        events,
        captures:captures.map(c=>({...c,imageUrl:`/api/admin/mp/cheat-captures/${encodeURIComponent(c.id)}/image`})),
        relatedAccounts,
      })
    }
    // 按时间窗批量撤销误封（转发到 rt 并写管理审计）
    if(path==='admin/unban-window'){
      if(request.method!=='POST')return json({error:'method not allowed'},405)
      if(!env.RT_ADMIN_TOKEN)return json({error:'disabled'},503)
      const body=await request.json().catch(()=>null)
      const fromMs=Number(body?.fromMs),toMs=Number(body?.toMs)
      const kind=typeof body?.kind==='string'?body.kind.trim().slice(0,40):''
      const reason=typeof body?.reason==='string'?body.reason.trim().slice(0,200):''
      if(!Number.isFinite(fromMs)||!Number.isFinite(toMs)||toMs<=fromMs||toMs-fromMs>7*86400_000){
        return json({error:'无效的时间窗（最多 7 天）'},400)
      }
      try{
        const response=await fetch(base+'/admin/unban-window',{
          method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),
          headers:{'X-Admin-Token':env.RT_ADMIN_TOKEN,'content-type':'application/json'},
          body:JSON.stringify({fromMs,toMs,kind:kind||undefined,reason:reason||'时间窗批量撤销',actor}),
        })
        const result=await response.json().catch(()=>({}))
        if(response.ok){
          await pool.query(
            "insert into admin_audit(actor_id,action,target_type,target_id,detail) values($1,'mp.unban_window','mp','window',$2)",
            [actor,{fromMs,toMs,kind:kind||null,reason:reason||null,revoked:result.revoked??result.count??0}],
          ).catch(()=>{})
        }
        return json(result,response.status)
      }catch{return json({error:'rt unavailable'},503)}
    }
    // 一键解封并回复申诉（或直接维持原判结案）：先确保 RT 解封成功，再原子落库申诉状态与回复消息
    if(path==='admin/appeal-resolve'){
      if(request.method!=='POST')return json({error:'method not allowed'},405)
      const body=await request.json().catch(()=>null)
      const feedbackId=typeof body?.feedbackId==='string'?body.feedbackId.trim():''
      const status=body?.status==='upheld'?'upheld':'unbanned'
      const message=typeof body?.message==='string'?body.message.trim():''
      if(!feedbackId||!/^[\w-]{6,64}$/.test(feedbackId)||!message||Array.from(message).length>1000){
        return json({error:'参数无效，请填写 1-1000 字回复说明'},400)
      }
      const {rows:[fb]}=await pool.query(
        'select f.id, f.user_id, f.kind, f.status, f.ban_record_id, u.uid::float8 as account_uid from feedback f join users u on u.id=f.user_id where f.id=$1 limit 1',
        [feedbackId],
      ).catch(async err=>{
        if(err?.code==='42703'||/no such column|does not exist/i.test(String(err?.message??''))){
          return pool.query('select f.id, f.user_id, f.kind, f.status, u.uid::float8 as account_uid from feedback f join users u on u.id=f.user_id where f.id=$1 limit 1',[feedbackId])
        }
        throw err
      })
      if(!fb)return json({error:'未找到申诉记录'},404)
      if(fb.kind!=='封禁申诉')return json({error:'该反馈不是封禁申诉'},409)
      if(!['submitted','need_info'].includes(fb.status))return json({error:'该申诉已结案，不可重复操作'},409)
      let unbanned=null
      if(status==='unbanned'){
        if(!env.RT_ADMIN_TOKEN)return json({error:'联机解封服务未启用'},503)
        let targetUid=body?.uid!=null&&Number.isSafeInteger(Number(body.uid))?Number(body.uid):null
        let targetFp=typeof body?.fp==='string'&&body.fp.trim()?body.fp.trim():undefined
        const recordId=(typeof body?.recordId==='string'&&body.recordId.trim())||fb.ban_record_id||undefined
        if(recordId&&(!targetUid||!targetFp)){
          const {rows:[rec]}=await pool.query('select uid::float8 as uid, fp from mp_ban_records where record_id=$1 limit 1',[recordId]).catch(()=>({rows:[]}))
          if(rec){
            if(!targetUid&&rec.uid!=null)targetUid=Number(rec.uid)
            if(!targetFp&&rec.fp)targetFp=String(rec.fp)
          }
        }
        if(!targetUid&&fb.account_uid!=null)targetUid=Number(fb.account_uid)
        if(!targetUid&&!targetFp&&!recordId)return json({error:'无法定位需要解封的账号或记录'},400)
        try{
          const resp=await fetch(base+'/admin/unban',{
            method:'POST',redirect:'error',signal:AbortSignal.timeout(6000),
            headers:{'X-Admin-Token':env.RT_ADMIN_TOKEN,'content-type':'application/json'},
            body:JSON.stringify({uid:targetUid||undefined,fp:targetFp,recordId,reason:message.slice(0,200),actor}),
          })
          const rtBody=await resp.json().catch(()=>({}))
          if(!resp.ok)return json({error:rtBody.error||'联机解封失败，申诉状态未变更'},resp.status)
          unbanned=rtBody
        }catch{return json({error:'联机服务不可用，申诉状态未变更'},503)}
      }
      const updated=await pool.query(
        `update feedback set status=$1, updated_at=extract(epoch from now())::bigint where id=$2 and status in ('submitted','need_info')`,
        [status,feedbackId],
      )
      if(!updated.rowCount)return json({error:'该申诉状态已变化，请刷新后重试'},409)
      await pool.query('insert into feedback_events(feedback_id,status,message) values($1,$2,$3)',[feedbackId,status,message])
      await pool.query("insert into feedback_messages(feedback_id,author_kind,author_name,body) values($1,'admin','管理员',$2)",[feedbackId,message])
      await pool.query(
        "insert into admin_audit(actor_id,action,target_type,target_id,detail) values($1,'appeal.resolve','feedback',$2,$3)",
        [actor,feedbackId,{status,recordId:fb.ban_record_id??body?.recordId??null,unbanned:!!unbanned}],
      ).catch(()=>{})
      return json({ok:true,status,unbanned})
    }
    // 联机封禁：列表 / 手动封禁 / 人工解封（转发到 rt，由 rt 的 RT_ADMIN_TOKEN 鉴权）
    if(path==='admin/bans'||path==='admin/ban'||path==='admin/unban'){
      if(!env.RT_ADMIN_TOKEN)return json({error:'disabled'},503)
      const target=base+'/'+path
      try{
        const init={method:request.method,redirect:'error',signal:AbortSignal.timeout(6000),headers:{'X-Admin-Token':env.RT_ADMIN_TOKEN,'content-type':'application/json'}}
        if(request.method!=='GET')init.body=JSON.stringify({...(await request.json().catch(()=>({}))),actor})
        const response=await fetch(target,init)
        const body=await response.json().catch(()=>({}))
        if(response.ok&&path==='admin/bans'&&Array.isArray(body.bans))body.bans=await enrichBans(pool,body.bans)
        return json(body,response.status)
      }catch{return json({error:'rt unavailable'},503)}
    }
    if(path.startsWith('admin/chat/')){
      if(!env.RT_ADMIN_TOKEN)return json({error:'chat unavailable'},503)
      try{return await fetch(base+'/admin/chat',{method:'POST',redirect:'error',signal:AbortSignal.timeout(8000),headers:{'X-Admin-Token':env.RT_ADMIN_TOKEN,'content-type':'application/json'},body:JSON.stringify({path:path.slice(11),actor,method:request.method,params:Object.fromEntries(params),body:request.method==='GET'?{}:await request.json()})})}catch{return json({error:'chat unavailable'},503)}
    }
    if(path==='admin/mp'&&request.method==='GET'){
      let snapshot
      try{snapshot=await state()}catch{return down()}
      const {server,players,bans,events,chat,activities:rtActivities=[]}=snapshot
      const [accounts,lookup]=await Promise.all([
        players.length
          ? pool.query(`select uid,id,created_at as "createdAt",signup_method as "signupMethod",
              banned_at<>0 as banned from users where uid=any($1::bigint[])`,[players.map(item=>item.uid)])
          : Promise.resolve({rows:[]}),
        players.length ? regions(pool,players) : Promise.resolve(()=>null),
        loadLandmarks(),
      ])
      const byUid=new Map(accounts.rows.map(({uid,...account})=>[Number(uid),account]))
      const actCounts=new Map()
      const safePlayers=players.map(({ip,nodeIp,...player})=>{
        const place=nearestPlace(player.x,player.z)
        const act=player.activity??(player.mode==='bike'?'ebike':'walk')
        actCounts.set(act,(actCounts.get(act)??0)+1)
        return {
          ...player,activity:act,region:lookup(ip),account:byUid.get(player.uid)??null,
          landmark:place?.name??null,landmarkDist:place?.dist??null,
        }
      })
      const safeActivities=rtActivities.slice(-120).map(item=>{
        const place=Number.isFinite(item.x)&&Number.isFinite(item.z)?nearestPlace(item.x,item.z):null
        return {...item,landmark:place?.name??null}
      })
      const activityBreakdown=[...actCounts.entries()].map(([activity,count])=>({activity,count})).sort((a,b)=>b.count-a.count)
      return json({
        rt:'up',
        server:{...server,landmarkCount:landmarks.length,landmarkSource},
        players:safePlayers,
        bans,
        events:events.filter(event=>event.type!=='session-device').map(({ip,nodeIp,...event})=>event),
        chat,
        activities:safeActivities,
        activityBreakdown,
      })
    }
    if(path==='admin/mp/kick'&&request.method==='POST'){
      const body=await request.json().catch(()=>null),uid=Number(body?.uid),minutes=body?.minutes,reason=body?.reason
      if(!Number.isSafeInteger(uid)||uid<100000||typeof reason!=='string'||!reason.trim()||reason.length>200||
        (minutes!==undefined&&(!Number.isInteger(minutes)||minutes<1||minutes>10080)))return json({error:'bad kick parameters'},400)
      if(!env.KICK_TOKEN)return json({error:'kick disabled'},503)
      let result
      try{
        const response=await fetch(base+'/kick',{method:'POST',headers:{'X-Kick-Token':env.KICK_TOKEN,'content-type':'application/json'},
          body:JSON.stringify({uid,reason,minutes}),signal:AbortSignal.timeout(3500),redirect:'error'})
        if(!response.ok)return json({error:'kick unavailable'},503)
        result=await response.json()
      }catch{return json({error:'kick unavailable'},503)}
      await pool.query(`insert into admin_audit(actor_id,action,target_type,target_id,detail) values($1,'mp.kick','uid',$2,$3)`,
        [actor,String(uid),{reason,minutes,kicked:result.kicked}])
      return json({ok:true,kicked:result.kicked})
    }
    if(path==='admin/mp/history'&&request.method==='GET'){
      const range=params.get('range')??'24h'
      if(!['24h','7d','30d','90d'].includes(range))return json({error:'bad range'},400)
      const run=async()=>json(await history(pool,range))
      return cache?cache('admin/mp/history',new URLSearchParams({range}),run):run()
    }
    if(path==='admin/mp/activities'&&request.method==='GET'){
      const uid=params.get('uid'),limit=Number(params.get('limit')??100),range=params.get('range')??'7d'
      const q=params.get('q')??'',kind=params.get('kind')??'',activity=params.get('activity')??''
      if(!Number.isInteger(limit)||limit<1||limit>200||!['24h','7d','30d'].includes(range)||
        (uid!==null&&uid!==''&&(!/^\d+$/.test(uid)||!Number.isSafeInteger(Number(uid)))))return json({error:'bad filter'},400)
      const [liveSnapshot]=await Promise.all([state().catch(()=>null),loadLandmarks()])
      const data=await activities(pool,{uid:uid||null,q,kind,activity,range,limit},liveSnapshot,nearestPlace)
      return json({...data,rtUp:Boolean(liveSnapshot)})
    }
    if(path==='admin/mp/gameplay'&&request.method==='GET'){
      const range=params.get('range')??'7d'
      if(!['24h','7d','30d','90d'].includes(range))return json({error:'bad range'},400)
      const run=async()=>{
        const liveSnapshot=await state().catch(()=>null)
        return json(await gameplay(pool,range,liveSnapshot))
      }
      return cache?cache('admin/mp/gameplay',new URLSearchParams({range}),run):run()
    }
    if(path==='admin/mp/sessions'&&request.method==='GET'){
      const uid=params.get('uid'),limit=Number(params.get('limit')??50)
      if(!Number.isInteger(limit)||limit<1||limit>200||(uid!==null&&(!/^\d+$/.test(uid)||!Number.isSafeInteger(Number(uid)))))return json({error:'bad filter'},400)
      const {rows}=await pool.query(`select s.uid::float8 as uid,s.name,u.id as "accountId",s.joined_at as "joinedAt",s.left_at as "leftAt",
        extract(epoch from coalesce(s.left_at,s.last_seen)-s.joined_at)::float8 as "durationSec",s.reason,s.close_code as "closeCode",s.region
        from mp_sessions s left join users u on u.uid=s.uid
        where ($1::bigint is null or s.uid=$1) order by s.joined_at desc,s.id limit $2`,[uid,limit])
      return json({sessions:rows})
    }
    return json({error:'not found'},404)
  }
  let pending=false
  async function sample(){
    if(pending||!env.RT_ADMIN_TOKEN)return
    pending=true
    try{
      const [snapshot]=await Promise.all([state(),loadLandmarks()])
      await record(pool,snapshot,new Date(),nearestPlace)
    }catch(error){console.warn('mp sample failed',error.code??error.message)}finally{pending=false}
  }
  return {route,resolvePlace,setCheatCaptures,start(){void sample();const timer=setInterval(sample,60000);timer.unref();return ()=>clearInterval(timer)}}
}
