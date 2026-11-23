// 全局热键（IDOK-178）：设置、读数开关、第一/第三人称。都走 keymap，所以改键后照样生效。
import {hits} from '../input/keymap'
import {isGlobalHotkeyBlocked} from '../walk/input-guard'
import {prefs, setPrefs} from './prefs'
import {closeSettings, openSettings} from './settings'
import {isFirstPerson, setViewMode} from '../walk/view-mode'

export function mountHotkeys() {
  window.addEventListener('keydown', event => {
    if (event.repeat || event.defaultPrevented || isGlobalHotkeyBlocked(event.target)) return
    if (hits(event.code, 'settings')) {
      openSettings()
      event.preventDefault()
      return
    }
    if (hits(event.code, 'stats')) {
      const current = prefs().stats
      const any = current.fps || current.net || current.online
      setPrefs(value => ({...value, stats: {fps: !any, net: !any, online: !any}}))
      event.preventDefault()
      return
    }
    if (hits(event.code, 'view')) {
      setViewMode(isFirstPerson() ? 'third' : 'first')
      event.preventDefault()
    }
  })
  window.addEventListener('keydown', event => {
    if (event.code === 'Escape') closeSettings()
  })
}
