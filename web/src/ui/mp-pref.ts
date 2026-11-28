// 同城联机开关（IDOK-192 / IDOK-392）：存在 localStorage['glol.mp']，?mp=1 临时打开。
// '1' = 联机，'0' = 玩家主动选了单人模式，未设置 = 首次访问（主界面主推联机；直链/verify 保持不自动连联机服）。
const KEY = 'glol.mp'

export function mpEnabled() {
  if (new URLSearchParams(location.search).get('mp') === '1') return true
  try { return localStorage.getItem(KEY) === '1' } catch { return false }
}

export function mpExplicitlyDisabled() {
  if (new URLSearchParams(location.search).get('mp') === '1') return false
  try { return localStorage.getItem(KEY) === '0' } catch { return false }
}

export function setMpEnabled(on: boolean, rememberOff = false) {
  try {
    if (on) localStorage.setItem(KEY, '1')
    else if (rememberOff) localStorage.setItem(KEY, '0')
    else localStorage.removeItem(KEY)
  } catch {}
  if (!on && new URLSearchParams(location.search).get('mp') === '1') {
    const url = new URL(location.href); url.searchParams.delete('mp'); history.replaceState(history.state, '', url)
  }
  window.dispatchEvent(new CustomEvent('glol:mp-pref', {detail: on}))
}

export type MpState = 'off' | 'connecting' | 'online' | 'offline' | 'replaced'
export interface MpStatus {state: MpState; online: number}

let state:MpState='off'
window.addEventListener('glol:mp-status',event=>{state=(event as CustomEvent<MpStatus>).detail.state})
export function waitForOnline(signal:AbortSignal){
  if(state==='online')return Promise.resolve()
  return new Promise<void>((resolve,reject)=>{
    const finish=(ok:boolean)=>{clearTimeout(timer);window.removeEventListener('glol:mp-status',check);signal.removeEventListener('abort',cancel);if(ok)resolve();else reject(Error('未能连接联机服务，请重试'))}
    const check=()=>{if(state==='online')finish(true)}
    const cancel=()=>finish(false),timer=window.setTimeout(cancel,15000)
    window.addEventListener('glol:mp-status',check);signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel()
  })
}
