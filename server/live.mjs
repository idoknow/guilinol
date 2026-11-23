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
