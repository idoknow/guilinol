/* 网上桂林 · PWA 预缓存
 *
 * 按上游审查意见修订后的策略：
 *   - 只预缓存构建产物（/assets/ 哈希文件 + 4 个入口 HTML + 图标 + manifest）
 *   - 导航：网络优先；5xx 或超时且有缓存时用缓存；缓存键就是请求本身
 *   - 缓存优先只用于 /assets/ 与固定图标，其它一律直连网络（避免把不带哈希的图冻住）
 *   - /world/* 不做 SW 缓存：文件名不带内容哈希，跨版本会串味（world manifest 是 no-store）
 *   - /api/* 永不缓存
 * BUILD 由 vite 插件在打包时替换为当次提交 sha
 */
const BUILD = '__BUILD__'
const VERSION = 'glol-' + BUILD
const MANIFEST_URL = '/precache-manifest.json?b=' + BUILD
const NAV_TIMEOUT_MS = 3000
const CONCURRENCY = 4
const CACHE_FIRST = [/^\/assets\//, /^\/(?:favicon-32\.png|apple-touch-icon\.png|manifest\.webmanifest)$/]

const isCacheFirst = (pathname) => CACHE_FIRST.some(pattern => pattern.test(pathname))

/** 从任意已有缓存复用同一 URL，避免每次发版重下没变的文件 */
const reuse = (url) => caches.match(url, { ignoreSearch: false })

async function pool(items, limit, worker) {
  let index = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index++]
      try { await worker(item) } catch { /* 单个失败不阻塞安装 */ }
    }
  })
  await Promise.all(runners)
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION)
    let files = []
    try {
      const response = await fetch(MANIFEST_URL, { cache: 'no-store' })
      if (response.ok) files = ((await response.json()).files || [])
    } catch { /* 清单拿不到就退化为不预缓存 */ }
    await pool(files, CONCURRENCY, async (url) => {
      const existing = await reuse(url)
      if (existing) { await cache.put(url, existing.clone()); return }
      const response = await fetch(new Request(url, { cache: 'reload' }))
      if (response.ok) await cache.put(url, response.clone())
    })
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter(key => key.startsWith('glol-') && key !== VERSION).map(key => caches.delete(key)))
  })())
})

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting()
  if (event.data === 'purge') {
    event.waitUntil((async () => {
      for (const key of await caches.keys()) await caches.delete(key)
      await self.registration.unregister()
    })())
  }
})

/** 导航回落候选：先找请求本身，再按路径找对应页面，最后才回首页 */
function fallbackCandidates(url) {
  const exact = [url.href]
  const path = url.pathname
  if (path.startsWith('/admin')) return [...exact, '/admin/index.html', '/admin/', '/index.html']
  if (path.startsWith('/id')) return [...exact, '/id.html', '/index.html']
  if (path.startsWith('/backpack')) return [...exact, '/backpack.html', '/index.html']
  return [...exact, '/index.html', '/']
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(VERSION)
      const network = fetch(request).then((response) => {
        // 按请求本身存：/backpack.html 的响应不能覆盖 /index.html
        if (response.ok) cache.put(request, response.clone()).catch(() => {})
        return response
      })
      const cached = async () => {
        for (const candidate of fallbackCandidates(url)) {
          const hit = await cache.match(candidate, { ignoreSearch: true })
          if (hit) return hit
        }
        return null
      }
      try {
        const response = await Promise.race([
          network,
          new Promise((resolve) => setTimeout(() => resolve(null), NAV_TIMEOUT_MS)),
        ])
        if (response && response.status < 500) return response
        // 5xx 或超时：有缓存用缓存；没缓存就等原请求，不返回断网页
        const hit = await cached()
        if (hit) { event.waitUntil(network.catch(() => {})); return hit }
        const late = await network.catch(() => null)
        return late || hit || Response.error()
      } catch {
        return (await cached()) || Response.error()
      }
    })())
    return
  }

  if (isCacheFirst(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(VERSION)
      const hit = await cache.match(request)
      if (hit) return hit
      const response = await fetch(request)
      if (response.ok) cache.put(request, response.clone()).catch(() => {})
      return response
    })())
  }
  // 其余（含 /world/、贴图、头像）：直连网络，不缓存
})
