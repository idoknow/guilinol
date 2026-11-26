// 键位映射（IDOK-178）：所有可改键的动作集中在这里，默认值就是旧手感。
// 判定一律走 hits(code, action)：它只认「这个动作现在绑的键」，所以改键之后旧键立刻失效。
import {prefs, setPrefs} from '../ui/prefs'

export type Action = 'punch' | 'rescue' | 'forward' | 'back' | 'left' | 'right' | 'run' | 'crouch' | 'jump' | 'interact' | 'view' | 'stats' | 'settings' | 'useItem' | 'emote' | 'unstuck'

type Definition = {id: Action; label: string; codes: string[]}

export const ACTIONS: Definition[] = [
  {id:'punch',label:'出拳',codes:['Mouse0']},
  {id:'rescue',label:'长按救援',codes:['KeyE']},
  {id: 'forward', label: '前进', codes: ['KeyW', 'ArrowUp']},
  {id: 'back', label: '后退', codes: ['KeyS', 'ArrowDown']},
  {id: 'left', label: '左移', codes: ['KeyA', 'ArrowLeft']},
  {id: 'right', label: '右移', codes: ['KeyD', 'ArrowRight']},
  {id: 'run', label: '奔跑', codes: ['ShiftLeft', 'ShiftRight']},
  {id: 'crouch', label: '蹲下', codes: ['KeyX']},
  {id: 'jump', label: '跳跃 / 起身', codes: ['Space']},
  {id: 'interact', label: '交互 / 上下车', codes: ['KeyF']},
  {id: 'view', label: '第一 / 第三人称', codes: ['KeyT']},
  {id: 'stats', label: '显示 / 隐藏读数', codes: ['F3']},
  {id:'emote',label:'表情动作（长按选择，短按重播）',codes:['KeyG']},
  {id: 'useItem', label: '使用手中物品', codes: ['KeyY']},
  {id: 'unstuck', label: '复位（卡住 / 落水时回到最近的平地）', codes: ['KeyR']},
  {id: 'settings', label: '设置', codes: ['KeyN']},
]

const BY_ID = new Map(ACTIONS.map(entry => [entry.id, entry]))

const NAMES: Record<string, string> = {
  Mouse0:'鼠标左键', Space: '空格', ShiftLeft: 'Shift', ShiftRight: 'Shift', ControlLeft: 'Ctrl', ControlRight: 'Ctrl',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Enter: '回车', Tab: 'Tab',
  Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
  Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
}

/** 这个动作当前绑的第一个键（自定义优先，其次默认）。 */
export function binding(action: Action): string[] {
  const custom = prefs().keys[action]
  return custom?.length ? [...custom] : [...BY_ID.get(action)!.codes]
}

/** 物理按键 → 该动作的默认 code。没被任何动作占用就原样返回。 */
export function canonical(code: string): string {
  for (const action of ACTIONS) if (binding(action.id).includes(code)) return action.codes[0]
  return code
}

/** 这一下按键是不是在做某个动作（含改键后）。只认当前绑定，旧键不会误触发。 */
export function hits(code: string, action: Action): boolean {
  return binding(action).includes(code)
}

/** 这些键被别的固定功能占着（地图、景册、拍照、视距、骑行档位/灯/转向等），不让绑，免得一键两用。 */
const RESERVED: Record<string, string> = {
  Escape: '关闭', Enter: '聊天', Tab: '街头 HUD', KeyM: '地图', KeyJ: '景册', KeyP: '拍照', KeyV: '飞行/步行', KeyC: '视距', KeyO: '骑行',
  KeyE: '加档', KeyQ: '减档', KeyG: '改装', KeyK: '脚撑', KeyL: '车灯', KeyZ: '左转灯', KeyB: '双闪', KeyU: '定速',
  Digit0: '骑行', Digit1: '骑行', Digit2: '骑行', Digit3: '骑行', Digit4: '骑行',
}

/** 这个键被固定功能占用时返回该功能名，可以绑就返回 undefined。 */
export function reservedFor(code: string): string | undefined {
  return RESERVED[code]
}

/** 改键；把同一物理键从别的动作上摘下来，避免一键两用。 */
export function setBinding(action: Action, code: string) {
  const defaults = BY_ID.get(action)!.codes
  setPrefs(value => {
    const keys: Record<string, string[]> = {...value.keys}
    for (const [id, codes] of Object.entries(keys)) {
      const kept = codes.filter(entry => entry !== code)
      if (kept.length) keys[id] = kept
      else delete keys[id]
    }
    if (!defaults.includes(code)) keys[action] = [code]
    return {...value, keys}
  })
}

export function resetBindings() {
  setPrefs(value => ({...value, keys: {}}))
}

export function isCustom(action: Action): boolean {
  return !!prefs().keys[action]?.length
}

/** 键位的中文显示名：W / 空格 / ↑ / F3。 */
export function keyLabel(code: string): string {
  if (NAMES[code]) return NAMES[code]
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  if (code.startsWith('Numpad')) return '小键盘' + code.slice(6)
  if (code.startsWith('F') && /^F\d{1,2}$/.test(code)) return code
  return code
}

export function bindingLabel(action: Action): string {
  return [...new Set(binding(action).map(keyLabel))].join(' / ')
}
