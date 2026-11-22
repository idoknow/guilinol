export type PlayMode = 'tour' | 'solo'
let current: PlayMode = 'tour'
const key = 'glol.playMode'

export function lastPlayMode(): PlayMode {
  try {
    const saved = localStorage.getItem(key)
    if (saved === 'story') localStorage.setItem(key, 'solo')
    return saved === 'tour' ? 'tour' : 'solo'
  } catch { return 'solo' }
}
export function linkedPlayMode(params: URLSearchParams): PlayMode {
  const play = params.get('play')
  if (play === 'solo' || play === 'tour') return play
  if (params.has('solo')) return params.get('solo') === '1' ? 'solo' : 'tour'
  return params.has('play') ? lastPlayMode() : 'tour'
}

export function trafficEnabled(mode: PlayMode, override: string | null) {
  return override === '1' || (override !== '0' && mode === 'solo')
}
export function getPlayMode() { return current }
let transition = 0
export async function setPlayMode(mode: PlayMode, remember = true,signal?:AbortSignal) {
  const request = ++transition
  if (mode === 'solo' && !solo) solo = await import('./solo-layer')
  if (request !== transition) return
  signal?.throwIfAborted()
  const prev = current
  current = mode
  if (remember) { try { localStorage.setItem(key, mode) } catch {} }
  if (prev !== mode) window.dispatchEvent(new CustomEvent('glol:play-mode', {detail: {mode, prev}}))
}
export function onPlayMode(fn: (mode: PlayMode, prev: PlayMode) => void) {
  const handle = (event: Event) => {
    const {mode, prev} = (event as CustomEvent<{mode: PlayMode; prev: PlayMode}>).detail
    fn(mode, prev)
  }
  window.addEventListener('glol:play-mode', handle)
  return () => window.removeEventListener('glol:play-mode', handle)
}

let solo: typeof import('./solo-layer') | undefined
export function soloServices() { return current === 'solo' ? solo : undefined }
