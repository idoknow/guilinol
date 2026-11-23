// 第一/第三人称（IDOK-178）：落地步行时用；骑车/开车固定第三人称。
import {prefs, setPrefs} from '../ui/prefs'

export function isFirstPerson() {
  return prefs().view === 'first'
}

export function setViewMode(mode: 'third' | 'first') {
  setPrefs(value => ({...value, view: mode}))
}

export function toggleViewMode() {
  setViewMode(isFirstPerson() ? 'third' : 'first')
  return prefs().view
}

export function viewModeLabel() {
  return isFirstPerson() ? '第一人称' : '第三人称'
}
