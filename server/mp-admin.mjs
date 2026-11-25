import {history,record,regions} from './mp-store.mjs'

const json=(value,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store'}})
const down=()=>json({rt:'down',error:'联机服务不可用'})
export function multiplayer(pool,env){
  const base=env.RT_INTERNAL_URL||'http://glol-rt.idoknow.svc.cluster.local:8790'
  const state=async()=>{
    if(!env.RT_ADMIN_TOKEN)throw Error('disabled')
    const response=await fetch(base+'/admin/state',{headers:{'X-Admin-Token':env.RT_ADMIN_TOKEN},signal:AbortSignal.timeout(3500),redirect:'error'})
    if(!response.ok)throw Error('RT unavailable')
    return response.json()
  }
  let landmarks=[],reloadAt=0
  async function loadLandmarks(){
    if(Date.now()<reloadAt)return
    reloadAt=Date.now()+60000
    try{
      const response=await fetch(env.MP_WORLD_MANIFEST_URL||'http://glol-web:8080/world/manifest.json',{signal:AbortSignal.timeout(2000)})
      if(response.ok){landmarks=(await response.json()).landmarks.filter(item=>Array.isArray(item.position)&&item.name);reloadAt=Date.now()+3600000}
    }catch{}
  }
  function nearest(x,z){
    let best=Infinity,name=null
    for(const item of landmarks){const distance=(item.position[0]-x)**2+(item.position[2]-z)**2;if(distance<best){best=distance;name=item.name}}
    return name
  }
  async function route(path,request,actor){
    const params=new URL(request.url).searchParams
    if(path.startsWith('admin/chat/')){
      if(!env.RT_ADMIN_TOKEN)return json({error:'chat unavailable'},503)
      try{return await fetch(base+'/admin/chat',{method:'POST',redirect:'error',signal:AbortSignal.timeout(8000),headers:{'X-Admin-Token':env.RT_ADMIN_TOKEN,'content-type':'application/json'},body:JSON.stringify({path:path.slice(11),actor,method:request.method,params:Object.fromEntries(params),body:request.method==='GET'?{}:await request.json()})})}catch{return json({error:'chat unavailable'},503)}
    }
    if(path==='admin/mp'&&request.method==='GET'){
      let snapshot
      try{snapshot=await state()}catch{return down()}
      const {server,players,bans,events,chat}=snapshot
      const [accounts,lookup]=await Promise.all([pool.query(`select uid,id,created_at as "createdAt",signup_method as "signupMethod",
        banned_at<>0 as banned from users where uid=any($1::bigint[])`,[players.map(item=>item.uid)]),regions(pool,players),players.length&&loadLandmarks()])
      const byUid=new Map(accounts.rows.map(({uid,...account})=>[Number(uid),account]))
      return json({rt:'up',server,players:players.map(({ip,nodeIp,...player})=>({...player,region:lookup(ip),account:byUid.get(player.uid)??null,
        landmark:nearest(player.x,player.z)})),bans,events:events.map(({ip,nodeIp,...event})=>event),chat})
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
      return ['24h','7d','30d'].includes(range)?json(await history(pool,range)):json({error:'bad range'},400)
    }
    if(path==='admin/mp/sessions'&&request.method==='GET'){
      const uid=params.get('uid'),limit=Number(params.get('limit')??50)
      if(!Number.isInteger(limit)||limit<1||limit>200||(uid!==null&&(!/^\d+$/.test(uid)||!Number.isSafeInteger(Number(uid)))))return json({error:'bad filter'},400)
      const {rows}=await pool.query(`select uid::float8,name,joined_at as "joinedAt",left_at as "leftAt",
        extract(epoch from coalesce(left_at,last_seen)-joined_at)::float8 as "durationSec",reason,close_code as "closeCode",region
        from mp_sessions where ($1::bigint is null or uid=$1) order by joined_at desc,id limit $2`,[uid,limit])
      return json({sessions:rows})
    }
    return json({error:'not found'},404)
  }
  let pending=false
  async function sample(){
    if(pending||!env.RT_ADMIN_TOKEN)return
    pending=true
    try{await record(pool,await state())}catch(error){console.warn('mp sample failed',error.code??error.message)}finally{pending=false}
  }
  return {route,start(){void sample();const timer=setInterval(sample,60000);timer.unref();return ()=>clearInterval(timer)}}
}
