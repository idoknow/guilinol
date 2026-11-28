// 走过才解锁的地图迷雾（IDOK-588 / IDOK-590）
//
// 规则：走到哪儿，就把周围 FOG_REVEAL 米（10 m）的一圈格子点亮；没点亮的地方在地图上是雾。
// 进度先写 localStorage（离线也能攒），登录后按「只增不减」的并集同步到 /api/walk/fog：
// 服务端记的是每个账号走过的格子号，换设备接着开图，多人之间互不影响。
//
// IDOK-590：格子从 32 m 收到 8 m，本地缓存换到 v2；v1 的旧格子号在新网格上没有意义，读到就丢。

import {fogCell, fogReveal, FOG_CELL_KM2, FOG_POST_LIMIT, fogValidKey} from '../../../lib/fog'

const STORAGE_KEY = 'glol.fog.v2'
/** 32 m 时代的缓存键，读到就删掉，免得白占空间。 */
const STALE_KEY = 'glol.fog.v1'
/** 走路时多久记一次（毫秒）——比每帧便宜，也不会漏掉路口。 */
const TRACK_MS = 220
/** 有新格子之后多久推一次服务端。 */
const PUSH_MS = 4000

const cells = new Set<number>()
const synced = new Set<number>()
let version = 0
let lastTrack = 0
let account: string | null = null
let pushTimer = 0
let pushing = false
let booted = false

/** 每次点亮新格子 +1：地图据此判断迷雾层要不要重画。 */
export function fogVersion():number { return version }

/** 这个格子走过了吗（地图画迷雾时逐格问）。 */
export function fogRevealed(key:number):boolean { return cells.has(key) }

/** 已点亮格子号的只读视图（地图按它挖洞，别在这里改）。 */
export function fogCells():ReadonlySet<number> { load(); return cells }

/** 已探明的格子数，配合格子面积换成「已探索 N km²」。 */
export function fogCount():number { return cells.size }

/** 已探明面积（平方公里），8 m 一格 = 0.000064 km²。 */
export function fogAreaKm2():number { return cells.size * FOG_CELL_KM2 }

function load() {
  if (booted) return
  booted = true
  try {
    try { localStorage.removeItem(STALE_KEY) } catch {}
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    if (Array.isArray(raw)) for (const key of raw) if (fogValidKey(key)) cells.add(key)
  } catch {}
}

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...cells].sort((a, b) => a - b))) } catch {}
}

/** 走路时调用：把脚下这一圈记下来。返回本次新点亮了几格。 */
export function fogWalk(x:number, z:number, now = performance.now()):number {
  load()
  if (now - lastTrack < TRACK_MS) return 0
  lastTrack = now
  const added = fogReveal(x, z, cells)
  if (!added) return 0
  version++
  save()
  schedulePush()
  return added
}

/** 直接把某个坐标点亮（传送、上车、验证脚本用）。 */
export function fogRevealAt(x:number, z:number):number {
  load()
  const key = fogCell(x, z)
  if (key < 0 || cells.has(key)) return 0
  cells.add(key)
  version++
  save()
  schedulePush()
  return 1
}

function schedulePush() {
  if (!account || pushTimer) return
  pushTimer = window.setTimeout(() => { pushTimer = 0; void push() }, PUSH_MS)
}

async function push() {
  if (!account || pushing || !navigator.onLine) return
  const add = [...cells].filter(key => !synced.has(key))
  if (!add.length) return
  pushing = true
  try {
    for (let i = 0; i < add.length; i += FOG_POST_LIMIT) {
      const batch = add.slice(i, i + FOG_POST_LIMIT)
      const response = await fetch('/api/walk/fog', {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'X-Fog-Owner': account},
        body: JSON.stringify({add: batch}),
        signal: AbortSignal.timeout(8000),
      })
      if (!response.ok) return
      for (const key of batch) synced.add(key)
    }
  } catch {
    // 离线/服务未就绪：格子已经存在本地，下次再推
  } finally {
    pushing = false
  }
  if ([...cells].some(key => !synced.has(key))) schedulePush()
}

/** 拉一次服务端进度并与本地合并（并集）。未登录/失败就只用本地。 */
export async function fogPull():Promise<{owner:string|null, cells:number}> {
  load()
  let owner: string | null = null
  try {
    const me = await fetch('/api/me', {signal: AbortSignal.timeout(6000)}).catch(() => null)
    if (me?.ok) {
      const user = await me.json().catch(() => null) as {id?:string} | null
      if (typeof user?.id === 'string' && user.id) owner = user.id
    }
  } catch {}
  if (!owner) return {owner: null, cells: cells.size}
  account = owner
  try {
    const response = await fetch('/api/walk/fog', {
      headers: {'X-Fog-Owner': owner},
      signal: AbortSignal.timeout(8000),
    })
    if (response.ok) {
      const remote = await response.json() as {cells?:unknown}
      if (Array.isArray(remote.cells)) {
        let added = 0
        for (const key of remote.cells) if (fogValidKey(key)) { synced.add(key); if (!cells.has(key)) { cells.add(key); added++ } }
        if (added) { version++; save() }
      }
    }
  } catch {}
  // 本地攒的（可能是匿名时走的）先推上去
  schedulePush()
  return {owner, cells: cells.size}
}

/** 开机跑一次：读本地、拉服务端、把两边并起来。 */
export async function fogBoot() {
  load()
  if (account) return {owner: account, cells: cells.size}
  return fogPull()
}

/** 退出登录：停止往旧账号推，但本地进度保留（同名账号再登录会并上去）。 */
export function fogSignOut() {
  account = null
  if (pushTimer) { clearTimeout(pushTimer); pushTimer = 0 }
}

/** 测试/调试用：清空本地与内存里的进度。 */
export function fogReset() {
  cells.clear(); synced.clear(); version++
  try { localStorage.removeItem(STORAGE_KEY) } catch {}
}
