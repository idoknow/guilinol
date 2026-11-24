// 在线人数（IDOK-172）：5 分钟内有上报的非探针会话 ≈ 此刻在城里的人。
// 只读、不落新表；PG 慢的话 15 秒内存缓存兜住，公开接口不给库压力。
const WINDOW = '5 minutes'
const CACHE_MS = 15000

export function presence(pool) {
  let cachedAt = 0
  let cached = null
  let inflight = null

  return async function online() {
    const now = Date.now()
    if (cached !== null && now - cachedAt < CACHE_MS) return cached
    if (inflight) return inflight
    inflight = pool
      .query(`SELECT count(distinct session)::int AS n FROM perf_event
        WHERE received >= now() - interval '${WINDOW}' AND kind <> 'probe'`)
      .then(({rows}) => {
        cached = Number(rows[0]?.n ?? 0)
        cachedAt = Date.now()
        return cached
      })
      .finally(() => {
        inflight = null
      })
    return inflight
  }
}

// 联机人数（IDOK-228）：首页「联机模式」卡只该显示真正连在联机服上的人，
// 不是全站 5 分钟活跃会话。读 rt 的 /health（公开字段 online = 已 join 的玩家），15 秒缓存。
// 集群里短名 glol-rt 解析不到（pod 的 search 域问题），默认用全名。
const RT_URL = process.env.RT_INTERNAL_URL || 'http://glol-rt.idoknow.svc.cluster.local:8790'

export function mpPresence(base = RT_URL) {
  let cachedAt = 0
  let cached = null
  let inflight = null

  return async function mpOnline() {
    const now = Date.now()
    if (now - cachedAt < CACHE_MS) return cached
    if (inflight) return inflight
    inflight = fetch(`${base}/health`, {signal: AbortSignal.timeout(2000), redirect: 'error'})
      .then(response => (response.ok ? response.json() : null))
      .then(body => (typeof body?.online === 'number' && Number.isFinite(body.online) ? Math.max(0, Math.round(body.online)) : null))
      .catch(() => null)
      .then(value => {
        cached = value
        cachedAt = Date.now()
        return value
      })
      .finally(() => {
        inflight = null
      })
    return inflight
  }
}
