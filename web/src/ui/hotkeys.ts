// 全局热键（IDOK-178 + IDOK-599）：设置、读数开关、第一/第三人称，以及管理员报错快捷键 P 与冲突边界提示。
// KeyP 冲突边界：
//  - 输入框（聊天 / 表单 / 反馈弹窗打字）与其他模态弹窗 / 标题页内一律走 isGlobalHotkeyBlocked 屏蔽，绝不误触；
//  - 拍照模式中按 P 始终退出拍照；
//  - 管理员态下裸按 P 优先开关反馈/报错弹窗（步行 / 飞行 / 骑行 / 开车 / 划船均生效）：
//    · 开拍照改用 Shift+P 或点工具栏「拍照」；
//    · 电驴驻车 P 挡改按 0 或点仪表 P 钮（不与管理员按 P 报错抢键）；
//    · 汽车 P 挡通过 Q/E 与中控 P·R·N·D 按钮切换，未绑定 KeyP，无冲突；
//  - 普通玩家按 P 维持原有行为（骑电驴未摔车裸按 P 切驻车 P 挡，其余常态开关拍照模式）。
import {hits} from '../input/keymap'
import {closeOpenFeedbackDialog, isGlobalHotkeyBlocked, resolveKeyPActionFromDom} from '../walk/input-guard'
import {prefs, setPrefs} from './prefs'
import {closeSettings, openSettings} from './settings'
import {isFirstPerson, setViewMode} from '../walk/view-mode'
import {debugHud} from '../deeplink'

export const ADMIN_FEEDBACK_KEYP_CONFLICT_BOUNDARY =
  '管理员态下按 P 优先开关报错/反馈弹窗（输入框与其它弹窗内不触发）；拍照中按 P 仍退出拍照，开拍照用 Shift+P；电驴驻车改按 0 或点仪表 P 钮（汽车 P 挡无 P 键绑定）。'

export interface KeyPHotkeyHint {
  feedbackKey?: string
  feedbackLabel: string
  photoKey: string
  photoLabel: string
  adminGuideRow?: {keys: string[]; label: string}
  conflictNote?: string
}

export function getKeyPHotkeyHint(isAdmin: boolean): KeyPHotkeyHint {
  if (isAdmin) {
    return {
      feedbackKey: 'P',
      feedbackLabel: '反馈 / 报错（P · 管理员直达）',
      photoKey: 'Shift+P',
      photoLabel: '拍照模式（Shift+P；拍照中按 P 退出）',
      adminGuideRow: {keys: ['P'], label: '报错 / 反馈（管理员）'},
      conflictNote: ADMIN_FEEDBACK_KEYP_CONFLICT_BOUNDARY,
    }
  }
  return {
    feedbackLabel: '反馈',
    photoKey: 'P',
    photoLabel: '拍照模式（P）',
  }
}

export interface KeyPShortcutHandlers {
  isAdmin: () => boolean
  isDroneActive: () => boolean
  isPhotoActive: () => boolean
  openPhoto: () => void
  closePhoto: () => void
  openFeedback: () => void
  closeFeedback?: () => boolean
  target?: Pick<Window, 'addEventListener' | 'removeEventListener'>
  doc?: Document
}

/**
 * 绑定全局 `KeyP` 快捷键（管理员报错直达 + 普通用户拍照/电驴 P 挡兼容）。
 * 捕获阶段仅处理「管理员再按 P 关闭已打开的反馈弹窗」（绕开 dialog.fb-panel 冒泡阶段的 stopPropagation），
 * 冒泡阶段处理常规打开反馈 / 开关拍照。
 */
export function bindKeyPShortcuts(handlers: KeyPShortcutHandlers): () => void {
  const target = handlers.target ?? window
  const doc = handlers.doc ?? document
  const closeFeedback = handlers.closeFeedback ?? (() => closeOpenFeedbackDialog(doc))

  const onCaptureKeyDown = (event: KeyboardEvent) => {
    if (event.code !== 'KeyP' || event.repeat || handlers.isDroneActive()) return
    const action = resolveKeyPActionFromDom(event, {
      photoActive: handlers.isPhotoActive(),
      isAdmin: handlers.isAdmin(),
      droneActive: handlers.isDroneActive(),
      doc,
    })
    if (action !== 'admin-feedback-close') return
    if (closeFeedback()) {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
  }

  const onBubbleKeyDown = (event: KeyboardEvent) => {
    if (event.code !== 'KeyP' || event.repeat || event.defaultPrevented || handlers.isDroneActive()) return
    const photoActive = handlers.isPhotoActive()
    if (isGlobalHotkeyBlocked(event.target, {allowPhoto: photoActive, doc})) return
    const action = resolveKeyPActionFromDom(event, {
      photoActive,
      isAdmin: handlers.isAdmin(),
      droneActive: handlers.isDroneActive(),
      doc,
    })
    if (action === 'admin-feedback-open') {
      event.preventDefault()
      handlers.openFeedback()
    } else if (action === 'photo-close') {
      handlers.closePhoto()
    } else if (action === 'photo-open') {
      handlers.openPhoto()
    }
  }

  target.addEventListener('keydown', onCaptureKeyDown as EventListener, true)
  target.addEventListener('keydown', onBubbleKeyDown as EventListener)
  return () => {
    target.removeEventListener('keydown', onCaptureKeyDown as EventListener, true)
    target.removeEventListener('keydown', onBubbleKeyDown as EventListener)
  }
}

export function mountHotkeys() {
  window.addEventListener('keydown', event => {
    if (event.repeat || event.defaultPrevented || isGlobalHotkeyBlocked(event.target)) return
    if (hits(event.code, 'settings')) {
      openSettings()
      event.preventDefault()
      return
    }
    if (hits(event.code, 'stats')) {
      // 读数只给开发看：玩家模式下这个键什么都不做，但照样吞掉，免得 F3 弹出浏览器的页内查找。
      if (debugHud()) {
        const current = prefs().stats
        const any = current.fps || current.net || current.online
        setPrefs(value => ({...value, stats: {fps: !any, net: !any, online: !any}}))
      }
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
