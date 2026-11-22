export type PlayMode = 'tour' | 'solo'
let current: PlayMode = 'tour'
const key = 'glol.playMode'

export function lastPlayMode(): PlayMode {
  try {
    const saved = localStorage.getItem(key)
    return saved === 'solo' || saved === 'story' ? 'solo' : 'tour'
  } catch { return 'tour' }
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
