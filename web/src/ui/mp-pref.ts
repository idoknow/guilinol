// 同城联机开关（IDOK-192）：存在 localStorage['glol.mp']，?mp=1 临时打开。改了就广播 glol:mp-pref，walk 当场连上或断开。
const KEY = 'glol.mp'

export function mpEnabled() {
  if (new URLSearchParams(location.search).get('mp') === '1') return true
  try { return localStorage.getItem(KEY) === '1' } catch { return false }
}

export function setMpEnabled(on: boolean) {
  try { if (on) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY) } catch {}
  if (!on && new URLSearchParams(location.search).get('mp') === '1') {
    const url = new URL(location.href); url.searchParams.delete('mp'); history.replaceState(history.state, '', url)
  }
  window.dispatchEvent(new CustomEvent('glol:mp-pref', {detail: on}))
}

export type MpState = 'off' | 'connecting' | 'online' | 'offline'
export interface MpStatus {state: MpState; online: number}
