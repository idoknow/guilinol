import {readFile} from 'node:fs/promises'
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
  async function route(path,request,actor){
    const params=new URL(request.url).searchParams
    if(path==='admin/user-search'){
      if(request.method!=='GET')return json({error:'method not allowed'},405)
      return json(await searchBanUsers(pool,(params.get('q')??'').trim().slice(0,128)))
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
        events:events.map(({ip,nodeIp,...event})=>event),
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
  return {route,start(){void sample();const timer=setInterval(sample,60000);timer.unref();return ()=>clearInterval(timer)}}
}
