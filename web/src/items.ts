/**
 * 物品背包（把原来的「香烟背包」扩成通用背包）
 *
 * · 香烟仍然走 smoke 模块自己的 packs/hotbar（那套有燃烧、抽吸逻辑）
 * · 这里放「非香烟」物品：市民身份证、纪念物等
 * · 物品可以「查看」和「丢弃」，丢弃后从背包消失
 */

export interface Item {
  id: string
  /** 物品类型，决定图标与点击行为 */
  kind: 'idcard' | 'misc'
  name: string
  /** 数量，默认 1 */
  qty: number
  /** 附加数据（身份证号等） */
  data?: Record<string, string | number>
  createdAt: number
}

const KEY = 'guiling.items.v1'
const listeners = new Set<(items: Item[]) => void>()

function read(): Item[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    if (!Array.isArray(raw)) return []
    return raw.filter((item): item is Item => !!item && typeof item.id === 'string' && typeof item.name === 'string')
  } catch {
    return []
  }
}

function write(items: Item[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items))
  } catch {
    /* 空间满了就算了 */
  }
  for (const listen of listeners) listen(items)
}

export function listItems(): Item[] {
  return read()
}

export function onItems(listen: (items: Item[]) => void) {
  listeners.add(listen)
  listen(read())
}

/** 发放物品；同 kind 且唯一（身份证）已存在就不重复发 */
export function grantItem(kind: Item['kind'], name: string, data?: Item['data'], unique = true) {
  const items = read()
  if (unique && items.some(item => item.kind === kind)) {
    // 已有唯一物品：刷新一下 data（例如身份证号变了）
    const index = items.findIndex(item => item.kind === kind)
    if (data) items[index] = {...items[index], data, name}
    write(items)
    return items[index]
  }
  const item: Item = {
    id: `${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    kind,
    name,
    qty: 1,
    data,
    createdAt: Date.now(),
  }
  items.unshift(item)
  write(items)
  return item
}

export function dropItem(id: string) {
  const items = read()
  const next = items.filter(item => item.id !== id)
  if (next.length !== items.length) write(next)
  return next.length !== items.length
}

/**
 * 角色外形同步（跨设备一致）
 * · 本机有外形 + 有市民卡 → 传到服务器（内容没变就跳过）
 * · 本机没有外形 → 从服务器拉回来写进 localStorage
 */
export async function syncAvatar() {
  let civic: {uid?: string} | null = null
  try {
    civic = JSON.parse(localStorage.getItem('guiling.civic.v1') ?? 'null')
  } catch {
    civic = null
  }
  if (!civic || !civic.uid) return false
  const local = localStorage.getItem('glol.avatar.v1')
  try {
    if (local) {
      const stamp = 'guiling.avatar.synced'
      if (localStorage.getItem(stamp) === local) return false
      const response = await fetch('/api/citizen/avatar', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({uid: civic.uid, avatar: JSON.parse(local)}),
      })
      if (response.ok) localStorage.setItem(stamp, local)
      return response.ok
    }
    const response = await fetch('/api/citizen/avatar?uid=' + encodeURIComponent(civic.uid), {cache: 'no-cache'})
    if (!response.ok) return false
    const body = (await response.json()) as {avatar?: unknown}
    if (!body.avatar) return false
    localStorage.setItem('glol.avatar.v1', JSON.stringify(body.avatar))
    // 让首页/角色页重新读一次
    window.dispatchEvent(new Event('glol:avatar'))
    return true
  } catch {
    return false
  }
}

/** 已开卡市民补发身份证：老玩家开卡时还没有这个功能 */
export async function ensureIdCardItem() {
  let civic: {uid?: string; name?: string; registeredAt?: number} | null = null
  try {
    civic = JSON.parse(localStorage.getItem('guiling.civic.v1') ?? 'null')
  } catch {
    civic = null
  }
  if (!civic || !civic.uid || !civic.name) return null
  const items = read()
  if (items.some(item => item.kind === 'idcard')) return null
  const {idNumberFor} = await import('./ui/idcard')
  const info = idNumberFor({uid: civic.uid, name: civic.name, registeredAt: civic.registeredAt ?? Date.now()})
  return grantItem('idcard', '市民二代身份证', {number: info.number, date: info.date})
}

/**
 * 静默上传身份证照片：老玩家不用刻意点开身份证，首页加载后自动补一次
 * · 每台设备每个卡号只传一次（localStorage 打标记）
 * · 失败静默重试（下次打开首页还会试）
 */
export async function ensurePortraitUpload() {
  let civic: {uid?: string; name?: string; registeredAt?: number} | null = null
  try {
    civic = JSON.parse(localStorage.getItem('guiling.civic.v1') ?? 'null')
  } catch {
    civic = null
  }
  if (!civic || !civic.uid || !civic.name) return false
  const {idNumberFor} = await import('./ui/idcard')
  const info = idNumberFor({uid: civic.uid, name: civic.name, registeredAt: civic.registeredAt ?? Date.now()})
  const key = 'guiling.photo.' + info.number
  if (localStorage.getItem(key)) return false
  try {
    const data = await (await import('./ui/portrait')).characterPortrait()
    if (!data) return false
    const response = await fetch('/api/citizen/photo', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({id: info.number, portrait: data}),
    })
    if (!response.ok) return false
    localStorage.setItem(key, '1')
    return true
  } catch {
    return false
  }
}

/** 打开物品（目前只有身份证有实际面板） */
export async function useItem(item: Item) {
  if (item.kind === 'idcard') {
    const module = await import('./ui/idcard')
    void module.openIdCard()
  }
}
