// 在线人数（IDOK-178）：/api/live 只读接口，60 秒一次；拿不到就安静地不显示。
const ENDPOINT = '/api/live'

let online: number | null = null
let started = false
const listeners = new Set<(value: number | null) => void>()
// 联机服上真正连着的人（IDOK-228）。首页「联机模式」卡只用这个，别拿全站在线去冒充。
let mpOnline: number | null = null
const mpListeners = new Set<(value: number | null) => void>()

export function onlineCount() {
  return online
}

export function onOnline(listener: (value: number | null) => void) {
  listeners.add(listener)
  listener(online)
  return () => listeners.delete(listener)
}

export function onMpOnline(listener: (value: number | null) => void) {
  mpListeners.add(listener)
  listener(mpOnline)
  return () => mpListeners.delete(listener)
}

const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : null)

function publish(value: number | null, mp: number | null) {
  online = value
  for (const listener of listeners) listener(value)
  mpOnline = mp
  for (const listener of mpListeners) listener(mp)
}

async function poll() {
  if (document.hidden) return
  try {
    const response = await fetch(ENDPOINT, {cache: 'no-store', credentials: 'omit'})
    if (!response.ok) throw new Error(String(response.status))
    const body = (await response.json()) as {online?: unknown; mp?: unknown}
    publish(count(body.online), count(body.mp))
  } catch {
    publish(null, null)
  }
}

export function startLive() {
  if (started) return
  started = true
  // 错开启动那几秒的资源高峰，之后再按分钟走。
  setTimeout(() => void poll(), 4000)
  setInterval(() => void poll(), 60000)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void poll()
  })
}
