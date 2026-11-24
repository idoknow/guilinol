/** Persisted ride-sound on/off (IDOK-212). The HUD writes it; the audio engine follows. */
const KEY = 'glol.rideSoundMuted'
export const RIDE_SOUND_EVENT = 'glol:ride-sound'
export const VOLUME_EVENT='glol:master-volume'
export function masterVolume(){
  try{const value=Number(localStorage.getItem('glol.masterVolume')??1);return Number.isFinite(value)?Math.min(1,Math.max(0,value)):1}catch{return 1}
}
export function setMasterVolume(value:number){
  if(!Number.isFinite(value))return
  try{localStorage.setItem('glol.masterVolume',String(Math.min(1,Math.max(0,value))))}catch{}
  window.dispatchEvent(new Event(VOLUME_EVENT))
}

export function rideSoundMuted(): boolean {
  try { return localStorage.getItem(KEY) === '1' } catch { return false }
}

export function setRideSoundMuted(muted: boolean) {
  try { if (muted) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY) } catch { /* private mode */ }
  window.dispatchEvent(new CustomEvent<boolean>(RIDE_SOUND_EVENT, {detail: muted}))
}
