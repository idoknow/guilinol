export type PlayMode = 'tour' | 'story'
let current: PlayMode = 'tour'
const key = 'glol.playMode'

export function lastPlayMode(): PlayMode {
  try { return localStorage.getItem(key) === 'story' ? 'story' : 'tour' } catch { return 'tour' }
}
export function getPlayMode() { return current }
let transition = 0
export async function setPlayMode(mode: PlayMode, remember = true) {
  const request = ++transition
  if (mode === 'story' && !story) story = await import('./story-layer')
  if (request !== transition) return
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

let story: typeof import('./story-layer') | undefined
export function storyServices() { return current === 'story' ? story : undefined }
