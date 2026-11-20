import {type Env,sendMail,equal,invalid} from './auth'

export async function signature(env:Env,user:string){
  if(!env.BRIDGE_TOKEN)throw Error('Missing signing secret')
  const bytes=new TextEncoder(),key=await crypto.subtle.importKey('raw',bytes.encode(env.BRIDGE_TOKEN),{name:'HMAC',hash:'SHA-256'},false,['sign'])
  return [...new Uint8Array(await crypto.subtle.sign('HMAC',key,bytes.encode('feedback-unsubscribe:'+user)))].map(n=>n.toString(16).padStart(2,'0')).join('')
}
export async function unsubscribe(env:Env,url:URL){
  const user=url.searchParams.get('user')??'',sig=url.searchParams.get('sig')??''
  if(!user||!/^[0-9a-f]{64}$/.test(sig)||!equal(await signature(env,user),sig))invalid()
  await env.DB.prepare('UPDATE users SET notify_email=0 WHERE id=?').bind(user).run();return new Response('反馈邮件提醒已关闭',{headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}})
}
export async function flushMail(env:Env){
  const rows=await env.DB.prepare(`SELECT m.feedback_id,m.summary,f.title,u.email,u.id user FROM feedback_mail m JOIN feedback f ON m.feedback_id=f.id JOIN users u ON u.id=f.user_id WHERE m.summary!='' AND m.next_at<=unixepoch() AND u.notify_email=1 ORDER BY m.next_at LIMIT 30`).all<{feedback_id:string;summary:string;title:string;email:string;user:string}>()
  for(const row of rows.results){
    const claimed=await env.DB.prepare("UPDATE feedback_mail SET next_at=unixepoch()+600,summary='' WHERE feedback_id=? AND summary=? AND next_at<=unixepoch()").bind(row.feedback_id,row.summary).run()
    if(!claimed.meta.changes)continue
    try{await sendMail(env,row.email,'反馈进度：'+row.title,`${row.summary}\nhttps://glol.rcpd.cc/?feedback=${row.feedback_id}\n关闭提醒：https://glol.rcpd.cc/api/unsubscribe?user=${row.user}&sig=${await signature(env,row.user)}`)}catch{await env.DB.prepare('UPDATE feedback_mail SET summary=substr(?||char(10)||summary,-200) WHERE feedback_id=?').bind(row.summary,row.feedback_id).run()}
  }
}
