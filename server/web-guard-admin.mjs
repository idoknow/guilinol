import {isIP} from 'node:net'
import {weakFormCount} from '../lib/weak-password.ts'
const json=(value,status=200)=>Response.json(value,{status,headers:{'cache-control':'private, no-store'}})
export async function guardAdmin(pool,env,path,request,actor){
  if(path==='admin/bans/ip/unban'&&request.method==='POST'){
    const body=await request.json().catch(()=>null);const ip=body?.ip
    if(typeof ip!=='string'||!isIP(ip))return json({error:'invalid ip'},400)
    const result=await pool.query(`with removed as (delete from web_ip_bans where ip=$1 and expires>now() returning ip,reason),
      cleared as (delete from web_guard_events where ip in (select ip from removed)),
      windows as (delete from web_guard_windows where ip in (select ip from removed)),
      locks as (delete from rate_limits where key in (select 'login-failed:'||host(ip) from removed))
      insert into admin_audit(actor_id,action,target_type,target_id,detail) select $2,'web.ip.unban','ip',host(ip),jsonb_build_object('reason',reason) from removed`,[ip,actor]);return json({ok:result.rowCount===1},result.rowCount?200:404)
  }
  if(path!=='admin/bans/protection'||request.method!=='GET')return json({error:'not found'},404)
  const catalogue=JSON.parse(env.WEB_GUARD_CATALOGUE||'{}'),edge=!!catalogue.waf,verified=edge&&env.WEB_IP_VERIFIER_READY==='1',ip=verified&&env.VERIFIED_LOGIN_IP==='1'
  const counts=(await pool.query("select kind,sum(hits)::bigint hits from web_guard_counts where bucket>now()-interval '24 hours' group by kind")).rows
  const hits=Object.fromEntries(counts.map(row=>[row.kind,Number(row.hits)]))
  const rules=[['unverified','客户端 IP 来源校验',edge,'未验证请求不计 IP 配额',1],['waf','WAF',edge,'危险等级 ≥2',catalogue.waf],['scanner','扫描器识别',edge,'UA 或行为评分 ≥5',catalogue.scanner],['honeypot','蜜罐',edge,'可信来源封 24 小时',catalogue.honeypot],['rate','入口限流',ip,'120 次 / 滚动 60 秒（不含静态）',1],['auto-ban','累计事件封禁',ip,'10 分钟 20 次，封 1 小时',1],['login-ip-lock','IP 登录短锁',ip,'5 次失败锁 15 分钟',1],['account-lock','账号登录锁定',true,'8 次失败锁 30 分钟',1],['login-failed','IP 登录封禁',ip,'24 小时内 20 次失败封 24 小时',1],['login-attempt','账号枚举',ip,'30 分钟 15 个邮箱封 2 小时',1],['weak','弱密码',true,'注册及改密；不影响旧密码登录',weakFormCount],['headers','安全响应头',edge,'CSP 仅观察',5],['reputation','第三方 IP 信誉',false,'未启用',0]]
  const bans=(await pool.query('select host(ip) ip,reason,expires from web_ip_bans where expires>now() order by expires desc limit 500')).rows
  return json({rules:rules.map(([id,name,enabled,threshold,count])=>({id,name,enabled:id==='unverified'?verified:enabled,threshold,count:count??0,hits:hits[id]??0})),bans})
}
