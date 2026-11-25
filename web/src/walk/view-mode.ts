// 第一/第三人称（IDOK-178）：落地步行时用；骑车/开车固定第三人称。
import {prefs, setPrefs, type ViewMode} from '../ui/prefs'

const indoorOwners = new Set<string>()
let savedBeforeIndoor: ViewMode | null = null

export function isFirstPerson() {
  return prefs().view === 'first'
}

export function setViewMode(mode: ViewMode) {
  setPrefs(value => ({...value, view: mode}))
}

export function toggleViewMode() {
  // 玩家手动按 V 切换视角时不再被离店逻辑强行覆盖
  savedBeforeIndoor = null
  setViewMode(isFirstPerson() ? 'third' : 'first')
  return prefs().view
}

export function enterIndoorFirstPerson(ownerId: string) {
  if (indoorOwners.size === 0) {
    savedBeforeIndoor = isFirstPerson() ? 'first' : 'third'
  }
  indoorOwners.add(ownerId)
  if (!isFirstPerson()) {
    setViewMode('first')
  }
}

export function leaveIndoorFirstPerson(ownerId: string) {
  if (!indoorOwners.delete(ownerId)) return
  if (indoorOwners.size === 0) {
    const restore = savedBeforeIndoor
    savedBeforeIndoor = null
    if (restore && (restore === 'first') !== isFirstPerson()) {
      setViewMode(restore)
    }
  }
}

export function isIndoorFirstPersonActive() {
  return indoorOwners.size > 0
}

export function viewModeLabel() {
  return isFirstPerson() ? '第一人称' : '第三人称'
}
