// 键位映射（IDOK-178）：所有可改键的动作集中在这里，默认值就是旧手感。
// 判定一律走 hits(code, action)：它只认「这个动作现在绑的键」，所以改键之后旧键立刻失效。
import {prefs, setPrefs} from '../ui/prefs'

export type Action = 'forward' | 'back' | 'left' | 'right' | 'run' | 'crouch' | 'jump' | 'interact' | 'view' | 'stats' | 'settings'

type Definition = {id: Action; label: string; codes: string[]}

export const ACTIONS: Definition[] = [
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
  {id: 'settings', label: '设置', codes: ['KeyN']},
]

const BY_ID = new Map(ACTIONS.map(entry => [entry.id, entry]))

const NAMES: Record<string, string> = {
  Space: '空格', ShiftLeft: 'Shift', ShiftRight: 'Shift', ControlLeft: 'Ctrl', ControlRight: 'Ctrl',
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
  return binding(action).map(keyLabel).join(' / ')
}
