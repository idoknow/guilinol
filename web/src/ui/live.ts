// 在线人数（IDOK-178）：/api/live 只读接口，60 秒一次；拿不到就安静地不显示。
const ENDPOINT = '/api/live'

let online: number | null = null
let started = false
const listeners = new Set<(value: number | null) => void>()

export function onlineCount() {
  return online
}

export function onOnline(listener: (value: number | null) => void) {
  listeners.add(listener)
  listener(online)
  return () => listeners.delete(listener)
}

function publish(value: number | null) {
  online = value
  for (const listener of listeners) listener(value)
}

async function poll() {
  if (document.hidden) return
  try {
    const response = await fetch(ENDPOINT, {cache: 'no-store', credentials: 'omit'})
    if (!response.ok) throw new Error(String(response.status))
    const body = (await response.json()) as {online?: unknown}
    const value = typeof body.online === 'number' && Number.isFinite(body.online) ? Math.max(0, Math.round(body.online)) : null
    publish(value)
  } catch {
    publish(null)
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
