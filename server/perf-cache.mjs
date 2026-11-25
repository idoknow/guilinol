// 后台只读聚合查询内存缓存：合并同一 key 的并发查询、过期后先返旧结果并后台刷新。
// 用规范化排序后的查询参数做 key，避免参数顺序不同导致重复打库；
// 缓存响应字节而非重复 clone Response，防止高频命中时 ReadableStream.tee() 累积。
export const cacheableAdminPath = path =>
  /^admin\/(perf(\/grid|\/server)?|overview|timeseries|breakdown|funnel|errors|live|stats|signups|mp\/(history|gameplay))$/.test(path)

export function canonicalQuery(params, path = '') {
  if (!params) return ''
  const entries = params instanceof URLSearchParams
    ? [...params.entries()]
    : [...new URLSearchParams(params).entries()]
  // admin/breakdown 始终同时返回 p50 与 p95，去掉指标后缀避免同一次聚合产生双份缓存
  const normalized = path === 'admin/breakdown'
    ? entries.map(([k, v]) => [k, k === 'metric' ? v.replace(/\.p(?:50|95)$/, '') : v])
    : entries
  normalized.sort(([aKey, aVal], [bKey, bVal]) =>
    aKey === bKey ? aVal.localeCompare(bVal) : aKey.localeCompare(bKey))
  return new URLSearchParams(normalized).toString()
}

export function createPerfCache({
  runPerfQuery,
  ttlMs = Number(process.env.ADMIN_CACHE_TTL ?? 120000),
  staleMs = Number(process.env.ADMIN_CACHE_STALE ?? 900000),
  liveTtlMs = Number(process.env.ADMIN_LIVE_CACHE_TTL ?? 10000),
  liveStaleMs = Number(process.env.ADMIN_LIVE_CACHE_STALE ?? 30000),
  shortTtlMs = Number(process.env.ADMIN_SHORT_CACHE_TTL ?? 20000),
  shortStaleMs = Number(process.env.ADMIN_SHORT_CACHE_STALE ?? 120000),
  maxEntries = 300,
  slowMs = 300,
  now = () => Date.now(),
  onSlow = entry => console.log(JSON.stringify(entry)),
} = {}) {
  const cache = new Map()
  const pending = new Map()

  function policyFor(path) {
    if (path === 'admin/stats') return { ttl: 3000, stale: 15000 }
    if (path === 'admin/live') return { ttl: liveTtlMs, stale: liveStaleMs }
    if (path === 'admin/signups' || path.startsWith('admin/mp/')) {
      return { ttl: shortTtlMs, stale: shortStaleMs }
    }
    return { ttl: ttlMs, stale: staleMs }
  }

  async function remember(key, response, ttl) {
    const body = await response.arrayBuffer()
    const headers = [...response.headers.entries()]
    const snapshot = { status: response.status, headers, body }
    cache.delete(key)
    cache.set(key, { snapshot, expires: now() + ttl })
    if (cache.size > maxEntries) cache.delete(cache.keys().next().value)
    return new Response(body, { status: snapshot.status, headers: snapshot.headers })
  }

  function buildResponse(snapshot) {
    return new Response(snapshot.body, { status: snapshot.status, headers: snapshot.headers })
  }

  function withCache(key, run, { ttl, stale: staleWindow }) {
    const at = now()
    const hit = cache.get(key)
    if (hit && hit.expires > at) {
      cache.delete(key)
      cache.set(key, hit)
      return Promise.resolve({ response: buildResponse(hit.snapshot), cacheStatus: 'hit' })
    }
    const inflight = pending.get(key)
    if (inflight) return inflight.then(response => ({ response: response.clone(), cacheStatus: 'dedup' }))

    const stale = hit && hit.expires + staleWindow > at ? buildResponse(hit.snapshot) : null
    const job = run().then(response => (response.ok ? remember(key, response, ttl) : response))
    pending.set(key, job)
    job.then(
      () => pending.delete(key),
      err => {
        pending.delete(key)
        if (stale) console.warn('admin cache background refresh failed', err?.code ?? err?.message ?? String(err))
      },
    )
    if (stale) return Promise.resolve({ response: stale, cacheStatus: 'stale' })
    return job.then(response => ({ response: response.clone(), cacheStatus: 'miss' }))
  }

  async function query(path, params, runner = runPerfQuery) {
    const started = now()
    const queryStr = canonicalQuery(params, path)
    const { response, cacheStatus } = cacheableAdminPath(path)
      ? await withCache(`${path}?${queryStr}`, () => runner(path, params), policyFor(path))
      : { response: await runner(path, params), cacheStatus: 'bypass' }
    const ms = now() - started
    if (ms > slowMs) onSlow({ scope: 'admin-query', path, ms, cacheStatus, query: queryStr.slice(0, 120) })
    return response
  }

  query.stats = () => ({ size: cache.size, pending: pending.size })
  query.clear = () => { cache.clear() }
  query.invalidate = prefix => {
    for (const key of [...cache.keys()]) if (key.startsWith(prefix)) cache.delete(key)
  }
  return query
}
