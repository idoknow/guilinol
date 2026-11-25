// 后台只读聚合查询内存缓存：合并同一 key 的并发查询、过期后先返旧结果并后台刷新。
// 用规范化排序后的查询参数做 key，避免参数顺序不同导致重复打库；
// 缓存响应字节而非重复 clone Response，防止高频命中时 ReadableStream.tee() 累积。
export const cacheableAdminPath = path =>
  /^admin\/(perf(\/grid|\/server)?|overview|timeseries|breakdown|funnel|errors)$/.test(path)

export function canonicalQuery(params) {
  if (!params) return ''
  const entries = params instanceof URLSearchParams
    ? [...params.entries()]
    : [...new URLSearchParams(params).entries()]
  entries.sort(([aKey, aVal], [bKey, bVal]) =>
    aKey === bKey ? aVal.localeCompare(bVal) : aKey.localeCompare(bKey))
  return new URLSearchParams(entries).toString()
}

export function createPerfCache({
  runPerfQuery,
  ttlMs = Number(process.env.ADMIN_CACHE_TTL ?? 120000),
  staleMs = Number(process.env.ADMIN_CACHE_STALE ?? 900000),
  maxEntries = 200,
  slowMs = 300,
  now = () => Date.now(),
  onSlow = entry => console.log(JSON.stringify(entry)),
} = {}) {
  const cache = new Map()
  const pending = new Map()

  async function remember(key, response) {
    const body = await response.arrayBuffer()
    const headers = [...response.headers.entries()]
    const snapshot = { status: response.status, headers, body }
    cache.delete(key)
    cache.set(key, { snapshot, expires: now() + ttlMs })
    if (cache.size > maxEntries) cache.delete(cache.keys().next().value)
    return new Response(body, { status: snapshot.status, headers: snapshot.headers })
  }

  function buildResponse(snapshot) {
    return new Response(snapshot.body, { status: snapshot.status, headers: snapshot.headers })
  }

  function withCache(key, run) {
    const at = now()
    const hit = cache.get(key)
    if (hit && hit.expires > at) {
      cache.delete(key)
      cache.set(key, hit)
      return Promise.resolve({ response: buildResponse(hit.snapshot), cacheStatus: 'hit' })
    }
    const inflight = pending.get(key)
    if (inflight) return inflight.then(response => ({ response: response.clone(), cacheStatus: 'dedup' }))

    const stale = hit && hit.expires + staleMs > at ? buildResponse(hit.snapshot) : null
    const job = run().then(response => (response.ok ? remember(key, response) : response))
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

  async function query(path, params) {
    const started = now()
    const queryStr = canonicalQuery(params)
    const { response, cacheStatus } = cacheableAdminPath(path)
      ? await withCache(`${path}?${queryStr}`, () => runPerfQuery(path, params))
      : { response: await runPerfQuery(path, params), cacheStatus: 'bypass' }
    const ms = now() - started
    if (ms > slowMs) onSlow({ scope: 'admin-query', path, ms, cacheStatus, query: queryStr.slice(0, 120) })
    return response
  }

  query.stats = () => ({ size: cache.size, pending: pending.size })
  query.clear = () => { cache.clear() }
  return query
}
