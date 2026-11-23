// 玩家偏好（IDOK-178）：HUD 读数开关、第一/第三人称、自定义键位。
// 全部存在 localStorage 的一个 JSON 里，读失败就回到默认，任何一项坏了都不影响进游戏。

export type StatsPrefs = {fps: boolean; net: boolean; online: boolean}
export type ViewMode = 'third' | 'first'
/** IDOK-182：相机装备。owned 是背包里的机身，equipped 是手上那台。 */
export type GearPrefs = {equipped: import('../gear/cameras').BodyId; owned: import('../gear/cameras').BodyId[]}
export type Prefs = {stats: StatsPrefs; view: ViewMode; keys: Record<string, string[]>; gear: GearPrefs}

const STORAGE_KEY = 'glol.prefs'

export const DEFAULT_PREFS: Prefs = {
  stats: {fps: true, net: true, online: true},
  view: 'third',
  keys: {},
  gear: {equipped: 'mirrorless', owned: ['mirrorless', 'action', 'pocket', 'thumb']},
}

let current: Prefs = load()
const listeners = new Set<(next: Prefs) => void>()

function defaults(): Prefs {
  return {...DEFAULT_PREFS, stats: {...DEFAULT_PREFS.stats}, keys: {}, gear: {equipped: DEFAULT_PREFS.gear.equipped, owned: [...DEFAULT_PREFS.gear.owned]}}
}

function load(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<Prefs> | null
    if (!raw || typeof raw !== 'object') return defaults()
    const stats = (raw.stats ?? {}) as Partial<StatsPrefs>
    const keys: Record<string, string[]> = {}
    if (raw.keys && typeof raw.keys === 'object') {
      for (const [action, codes] of Object.entries(raw.keys)) {
        if (!Array.isArray(codes)) continue
        const clean = codes.filter(code => typeof code === 'string' && /^[A-Za-z0-9]{2,24}$/.test(code))
        if (clean.length) keys[action] = clean
      }
    }
    return {
      stats: {
        fps: typeof stats.fps === 'boolean' ? stats.fps : DEFAULT_PREFS.stats.fps,
        net: typeof stats.net === 'boolean' ? stats.net : DEFAULT_PREFS.stats.net,
        online: typeof stats.online === 'boolean' ? stats.online : DEFAULT_PREFS.stats.online,
      },
      view: raw.view === 'first' ? 'first' : 'third',
      keys,
      gear: loadGear(raw.gear),
    }
  } catch {
    return defaults()
  }
}

function loadGear(raw: unknown): GearPrefs {
  const fallback: GearPrefs = {equipped: DEFAULT_PREFS.gear.equipped, owned: [...DEFAULT_PREFS.gear.owned]}
  if (!raw || typeof raw !== 'object') return fallback
  const value = raw as Partial<GearPrefs>
  const valid = new Set<string>(DEFAULT_PREFS.gear.owned)
  const owned = Array.isArray(value.owned) ? value.owned.filter(id => valid.has(id)) : []
  const equipped = typeof value.equipped === 'string' && valid.has(value.equipped) ? value.equipped : fallback.equipped
  return {equipped: owned.includes(equipped) ? equipped : owned[0] ?? fallback.equipped, owned: owned.length ? owned : fallback.owned}
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current))
  } catch {
    // 隐私模式/配额满：本次会话照旧生效，只是不落盘。
  }
}

export function prefs(): Prefs {
  return current
}

export function setPrefs(patch: (value: Prefs) => Prefs) {
  const next = patch(current)
  current = next
  persist()
  for (const listener of listeners) listener(current)
}

export function onPrefs(listener: (next: Prefs) => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
