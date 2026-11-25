import { type Env, type SessionAccount, Problem, now } from './auth'

export type Provider = 'qq' | 'wx'
export const providers = (env: Env): Provider[] => (['qq','wx'] as const).filter(type => type === 'qq' ? env.QQ_APPID && env.QQ_APPKEY : env.WX_APPID && env.WX_SECRET)
export function midnight(date?: string) {
  return date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(`${date}T00:00:00+08:00`)/1000 : Infinity
}
export function schedule(env: Env) {
  const phase = now() >= midnight(env.SOCIAL_LEGACY_SUNSET) ? 'sunset' : now() >= midnight(env.SOCIAL_LEGACY_CUTOFF) ? 'migrating' : 'before'
  return {phase, cutoff:env.SOCIAL_LEGACY_CUTOFF || null, sunset:env.SOCIAL_LEGACY_SUNSET || null}
}
export function allowLegacy(env: Env, intent: string) {
  const {phase} = schedule(env)
  if (phase==='sunset') throw new Problem(410,'legacy_sunset','旧版登录已停用')
  if (phase==='migrating' && intent!=='login') throw new Problem(403,'legacy_closed','旧版通道仅供已有账号登录')
}
export function migration(env: Env, user: SessionAccount, identities: {channel:string;type:string}[]) {
  const {phase,sunset:deadline}=schedule(env)
  const legacy=identities.filter(item=>item.channel==='legacy').map(item=>item.type)
  const direct=identities.filter(item=>item.channel==='direct').map(item=>item.type)
  const email=!(user.email_placeholder===0 && user.verified===1)
  const required=phase==='migrating' && legacy.length>0 && !direct.length && email
  return {required,blocking:required,deadline,legacy,direct,options:[...providers(env),...(email?['email']:[])]}
}
