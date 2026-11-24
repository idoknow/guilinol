/** Persisted ride-sound on/off (IDOK-212). The HUD writes it; the audio engine follows. */
const KEY = 'glol.rideSoundMuted'
export const RIDE_SOUND_EVENT = 'glol:ride-sound'

export function rideSoundMuted(): boolean {
  try { return localStorage.getItem(KEY) === '1' } catch { return false }
}

export function setRideSoundMuted(muted: boolean) {
  try { if (muted) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY) } catch { /* private mode */ }
  window.dispatchEvent(new CustomEvent<boolean>(RIDE_SOUND_EVENT, {detail: muted}))
}
