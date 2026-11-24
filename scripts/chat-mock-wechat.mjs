import {setTimeout as delay} from 'node:timers/promises'

const latency=Number(process.argv[2])
globalThis.fetch=async(url,options)=>{
  if(String(url).startsWith('https://api.weixin.qq.com/cgi-bin/token?'))return Response.json({access_token:'fixture',expires_in:7200})
  if(!String(url).startsWith('https://api.weixin.qq.com/wxa/msg_sec_check?'))throw Error('unexpected fixture request')
  const {content}=JSON.parse(options.body)
  process.send({checking:content})
  await delay(content==='fixture-timeout'?2*latency:latency)
  if(content==='fixture-timeout')throw Error('timeout')
  return Response.json({errcode:0,result:{suggest:'pass'}})
}
