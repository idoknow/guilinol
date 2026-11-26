// 键位映射（IDOK-178 + 辅警执勤三键）：所有可改键的动作集中在这里，默认值就是旧手感。
// 判定一律走 hits(code, action)：它只认「这个动作现在绑的键」，所以改键之后旧键立刻失效。
import {prefs, setPrefs} from '../ui/prefs.ts'

export type DutyAction = 'dutyWhistle' | 'dutyFlag' | 'dutyTicket'

export type Action =
  | 'punch'
  | 'rescue'
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'run'
  | 'crouch'
  | 'jump'
  | 'interact'
  | 'view'
  | 'stats'
  | 'settings'
  | 'useItem'
  | 'emote'
  | 'unstuck'
  | DutyAction

export type ActionScope = 'common' | 'duty'

export type Definition = {
  id: Action
  label: string
  codes: string[]
  scope?: ActionScope
  hint?: string
}

export const DUTY_ACTION_IDS: readonly DutyAction[] = Object.freeze([
  'dutyWhistle',
  'dutyFlag',
  'dutyTicket',
])

export const ACTIONS: Definition[] = [
  {
    id: 'punch',
    label: '出拳',
    codes: ['Mouse0'],
    scope: 'common',
    hint: '步行时点击鼠标左键出拳；与执勤 Q / E / F 三键不冲突',
  },
  {
    id: 'rescue',
    label: '长按救援',
    codes: ['KeyE'],
    scope: 'common',
    hint: '非执勤走路时按住 E 救援倒地同伴；执勤时 E 键归执勤挥旗（短按拦停 / 长按放行）使用',
  },
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
  {id: 'emote', label: '表情动作（长按选择，短按重播）', codes: ['KeyG']},
  {id: 'useItem', label: '使用手中物品', codes: ['KeyY']},
  {id: 'unstuck', label: '复位（卡住 / 落水时回到最近的平地）', codes: ['KeyR']},
  {id: 'settings', label: '设置', codes: ['KeyN']},
  {
    id: 'dutyWhistle',
    label: '执勤吹哨（12m 违规减速 / 震慑停下）',
    codes: ['KeyQ'],
    scope: 'duty',
    hint: '口哨常驻嘴边，按一下吹一声；12m 内违规车减速、逃逸车概率停下，正常车不受影响',
  },
  {
    id: 'dutyFlag',
    label: '执勤挥旗（短按靠边停 / 长按 0.6s 放行）',
    codes: ['KeyE'],
    scope: 'duty',
    hint: '短按示意前方 8m 内违规车靠边停；长按 0.6 秒放行刚拦下的车',
  },
  {
    id: 'dutyTicket',
    label: '执勤罚单（靠近开票 / 1.5m 内递交）',
    codes: ['KeyF'],
    scope: 'duty',
    hint: '靠近已停下的违规车按 F 开始开票；撕下凭条后走到 1.5m 内再按 F 递交',
  },
]

const BY_ID = new Map(ACTIONS.map(entry => [entry.id, entry]))

const NAMES: Record<string, string> = {
  Mouse0:'鼠标左键', Space: '空格', ShiftLeft: 'Shift', ShiftRight: 'Shift', ControlLeft: 'Ctrl', ControlRight: 'Ctrl',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Enter: '回车', Tab: 'Tab',
  Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
  Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
}

export function actionScope(action: Action): ActionScope {
  return BY_ID.get(action)?.scope ?? 'common'
}

export function isDutyAction(action: Action): action is DutyAction {
  return actionScope(action) === 'duty'
}

/** 当前是否处于辅警执勤作用域（由 `controller.ts` / `walk/index.ts` 同步到 `document.body.dataset`）。 */
export function isDutyScopeActive(): boolean {
  if (typeof document === 'undefined') return false
  const ds = document.body?.dataset
  return ds?.duty === 'active' || ds?.tdDutyActive === '1'
}

export function activeActionScope(): ActionScope {
  return isDutyScopeActive() ? 'duty' : 'common'
}

/** 这个动作当前绑的键列表（自定义优先，其次默认）。 */
export function binding(action: Action): string[] {
  const custom = prefs().keys[action]
  return custom?.length ? [...custom] : [...BY_ID.get(action)!.codes]
}

/** 物理按键 → 该动作的默认 code（按当前作用域优先）。没被任何动作占用就原样返回。 */
export function canonical(code: string, scope?: ActionScope): string {
  const active = scope ?? activeActionScope()
  const primaryDuty = active === 'duty'
  for (const action of ACTIONS) {
    if ((action.scope === 'duty') !== primaryDuty) continue
    if (binding(action.id).includes(code)) return action.codes[0]
  }
  for (const action of ACTIONS) {
    if ((action.scope === 'duty') === primaryDuty) continue
    if (binding(action.id).includes(code)) return action.codes[0]
  }
  return code
}

/** 检测指定作用域内是否存在同一物理键绑定到多个动作的冲突。 */
export function findScopeKeyConflicts(scope: ActionScope): Array<{code: string; actions: Action[]}> {
  const byCode = new Map<string, Action[]>()
  for (const def of ACTIONS) {
    if ((def.scope ?? 'common') !== scope) continue
    for (const code of binding(def.id)) {
      const list = byCode.get(code)
      if (list) list.push(def.id)
      else byCode.set(code, [def.id])
    }
  }
  const conflicts: Array<{code: string; actions: Action[]}> = []
  for (const [code, actions] of byCode.entries()) {
    if (actions.length > 1) conflicts.push({code, actions})
  }
  return conflicts
}

/**
 * 这一下按键是不是在做某个动作（含改键后与作用域隔离）。只认当前绑定，旧键不会误触发。
 * - `scope === 'duty'`（或执勤态激活）时，`dutyWhistle` / `dutyFlag` 绑定的物理键（默认 Q / E）优先归执勤独占，
 *   阻止 `rescue` 等普通动作吞掉执勤挥旗/吹哨；`interact`（默认 F）与 `dutyTicket` 共用统一交互仲裁器保持可用。
 * - `scope === 'common'`（非执勤走路态）时，`rescue`（长按 E）、`punch`（Mouse0）与 `interact`（F）照常可用。
 */
export function hits(code: string, action: Action, scope?: ActionScope): boolean {
  if (scope === 'common' && isDutyAction(action)) return false
  const resolvedScope = scope ?? (isDutyScopeActive() ? 'duty' : undefined)
  if (resolvedScope === 'duty' && !isDutyAction(action) && action !== 'interact') {
    if (binding('dutyWhistle').includes(code) || binding('dutyFlag').includes(code)) {
      return false
    }
  }
  return binding(action).includes(code)
}

/** 这些键被别的固定功能占着（地图、景册、拍照、视距、骑行档位/灯/转向等），不让绑，免得一键两用。 */
const RESERVED: Record<string, string> = {
  Escape: '关闭', Enter: '聊天', Tab: '街头 HUD', KeyM: '地图', KeyJ: '景册', KeyP: '拍照', KeyV: '飞行/步行', KeyC: '视距', KeyO: '骑行',
  KeyE: '加档', KeyQ: '减档', KeyG: '改装', KeyK: '脚撑', KeyL: '车灯', KeyZ: '左转灯', KeyB: '双闪', KeyU: '定速',
  Digit0: '骑行', Digit1: '骑行', Digit2: '骑行', Digit3: '骑行', Digit4: '骑行',
}

/** 这个键被固定功能占用时返回该功能名，可以绑就返回 undefined。执勤动作允许 Q/E/F，救援/表情允许绑回默认键。 */
export function reservedFor(code: string, forAction?: Action): string | undefined {
  if (forAction && isDutyAction(forAction) && (code === 'KeyQ' || code === 'KeyE' || code === 'KeyF')) {
    return undefined
  }
  if (forAction === 'rescue' && code === 'KeyE') return undefined
  if (forAction === 'emote' && code === 'KeyG') return undefined
  return RESERVED[code]
}

/** 改键；在同一作用域（普通 vs 执勤）内把同一物理键从别的动作上摘下来，避免同场景一键两用。 */
export function setBinding(action: Action, code: string) {
  const targetDef = BY_ID.get(action)!
  const targetScope: ActionScope = targetDef.scope ?? 'common'
  const defaults = targetDef.codes
  setPrefs(value => {
    const keys: Record<string, string[]> = {...value.keys}
    for (const [id, codes] of Object.entries(keys)) {
      const otherScope: ActionScope = BY_ID.get(id as Action)?.scope ?? 'common'
      if (otherScope !== targetScope) continue
      const kept = codes.filter(entry => entry !== code)
      if (kept.length) keys[id] = kept
      else delete keys[id]
    }
    if (!defaults.includes(code)) keys[action] = [code]
    else delete keys[action]
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

export interface GuideKeyRow {
  keys: string[]
  label: string
  id?: string
}

/** 供左下角「按键」面板（.keys-card）在辅警执勤态展示的精简按键行。 */
export function getDutyCardRows(): GuideKeyRow[] {
  const firstKey = (action: Action) => bindingLabel(action).split(' / ')[0]
  return [
    {keys: [firstKey('forward'), firstKey('left'), firstKey('back'), firstKey('right')], label: '走路'},
    {keys: [firstKey('run')], label: '跑'},
    {keys: [firstKey('jump')], label: '跳越栏杆'},
    {keys: [firstKey('dutyWhistle')], label: '吹哨减速', id: 'dutyWhistle'},
    {keys: [firstKey('dutyFlag')], label: '挥旗拦停 / 长按放行', id: 'dutyFlag'},
    {keys: [firstKey('dutyTicket')], label: '开票 / 近身递交', id: 'dutyTicket'},
    {keys: [firstKey('view')], label: '第一 / 第三人称'},
    {keys: ['F1'], label: '执勤指南'},
  ]
}

/** 供 F1 玩法指南「全部按键」（KEY_GROUPS）展示的辅警执勤三键完整说明。 */
export function getDutyGuideKeyGroup(): {title: string; rows: GuideKeyRow[]} {
  const firstKey = (action: Action) => bindingLabel(action).split(' / ')[0]
  return {
    title: '辅警执勤',
    rows: [
      {keys: [firstKey('dutyWhistle')], label: '吹哨（12m 内违规车减速、逃逸停下）', id: 'dutyWhistle'},
      {keys: [firstKey('dutyFlag')], label: '挥旗（短按 8m 内靠边停 / 长按 0.6s 放行）', id: 'dutyFlag'},
      {keys: [firstKey('dutyTicket')], label: '罚单（靠近停稳车开票 / 1.5m 内递交）', id: 'dutyTicket'},
    ],
  }
}

/** 供 F1 玩法指南「玩法」页展示的辅警执勤词条。 */
export function getDutyGuideFeature(): {seal: string; title: string; pc: string; phone: string} {
  const qKey = bindingLabel('dutyWhistle').split(' / ')[0]
  const eKey = bindingLabel('dutyFlag').split(' / ')[0]
  const fKey = bindingLabel('dutyTicket').split(' / ')[0]
  return {
    seal: '执',
    title: '解放桥辅警执勤',
    pc: `找桥头交警领装上岗后，口哨常驻嘴边：按 <kbd>${qKey}</kbd> 吹哨令 12m 内违规车减速；短按 <kbd>${eKey}</kbd> 示意前方 8m 违规车靠边停、长按 0.6 秒放行；靠近停稳违规车按 <kbd>${fKey}</kbd> 取出打印机打单撕纸，走到 1.5m 内再按 <kbd>${fKey}</kbd> 递交对方手里。`,
    phone: `上岗后点击底部「吹哨（<kbd>${qKey}</kbd>）」「挥旗（<kbd>${eKey}</kbd> 长按放行）」「罚单（<kbd>${fKey}</kbd>）」三个按钮完成拦停、打印撕纸与近身 1.5m 递交。`,
  }
}
