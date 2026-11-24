const fold=text=>text.normalize('NFKC').toLowerCase().replace(/[\s\p{Cf}]/gu,'')
export function localResult(text,words){
  const input=fold(text),hits=words.filter(row=>row.enabled&&input.includes(fold(row.word)))
  const hit=hits.find(row=>row.action==='block')??hits[0]
  return hit&&{status:hit.action==='block'?'blocked':'pending',provider:'local',label:hit.action,summary:{wordId:hit.id}}
}

export function wechat(env,request=fetch){
  let token,expires=0
  const enabled=!!(env.WX_APPID&&env.WX_SECRET)
  async function json(url,options){
    const response=await request(url,{...options,redirect:'error',signal:AbortSignal.timeout(3000)})
    if(!response.ok)throw Error('upstream_http')
    return response.json()
  }
  return {name:enabled?'wechat':'未启用',available:openid=>enabled&&!!openid,async check(text,openid){
    for(let attempt=0;attempt<2;attempt++){
      if(!token||Date.now()>=expires){
        const result=await json('https://api.weixin.qq.com/cgi-bin/token?'+new URLSearchParams({grant_type:'client_credential',appid:env.WX_APPID,secret:env.WX_SECRET}))
        if(!result.access_token)throw Error('token')
        token=result.access_token;expires=Date.now()+(Number(result.expires_in)-120)*1000
      }
      const result=await json('https://api.weixin.qq.com/wxa/msg_sec_check?access_token='+encodeURIComponent(token),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({version:2,scene:2,openid,content:text})})
      if([40001,42001].includes(result.errcode)){token=null;continue}
      if(result.errcode!==0)throw Error('upstream_error')
      return {suggest:result.result?.suggest,label:result.result?.label,trace:result.trace_id}
    }
    throw Error('token')
  }}
}

export async function moderate(input,words,policy,provider){
  const local=localResult(input.text,words)
  if(local)return local
  if(!provider.available(input.openid))return {provider:'none',label:policy==='local_only'?'local_only':'unavailable',status:policy==='local_only'?'normal':'pending'}
  try{
    const summary=await provider.check(input.text,input.openid)
    return {summary,provider:provider.name,label:summary.suggest??'unknown',status:summary.suggest==='pass'?'normal':summary.suggest==='risky'?'blocked':'pending'}
  }catch{return {provider:provider.name,label:'provider_error',status:'pending'}}
}
