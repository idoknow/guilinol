/* 网上桂林 · PWA 预缓存
 * 策略：
 *   - 构建产物（js/css/html/图标）install 时全量预缓存 → 首屏不依赖网络
 *   - /world/* 资源 stale-while-revalidate，受配额保护
 *   - /api/* 永不缓存（避免旧数据/旧登录态）
 * BUILD 由 vite 插件在打包时替换为当次提交 sha
 */
const BUILD = '__BUILD__'
const VERSION = 'glol-' + BUILD
const PRECACHE = '/precache-manifest.json?b=' + BUILD
const MAX_RUNTIME_BYTES = 150 * 1024 * 1024
const MAX_FILE_BYTES = 16 * 1024 * 1024

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION)
    const list = await fetch(PRECACHE, { cache: 'no-store' }).then(r => r.ok ? r.json() : { files: [] }).catch(() => ({ files: [] }))
    await Promise.all((list.files || []).map(async (url) => {
      try { await cache.add(new Request(url, { cache: 'reload' })) } catch { /* 单个失败不阻塞安装 */ }
    }))
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter(k => k.startsWith('glol-') && k !== VERSION).map(k => caches.delete(k)))
  })())
})

async function quotaLeft() {
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate()
    return quota - usage
  } catch { return 0 }
}

async function cacheSize(cache) {
  let total = 0
  for (const request of await cache.keys()) {
    const res = await cache.match(request)
    if (res) total += Number(res.headers.get('content-length') || 0)
  }
  return total
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  // API 一律走网络，绝不缓存
  if (url.pathname.startsWith('/api/')) return

  // 页面导航：网络优先，3 秒超时回落到缓存的 index.html
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(VERSION)
      try {
        const response = await Promise.race([
          fetch(request),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
        ])
        if (response && response.ok) cache.put('/index.html', response.clone()).catch(() => {})
        return response
      } catch {
        return (await cache.match('/index.html')) || (await cache.match('/')) || Response.error()
      }
    })())
    return
  }

  // 构建产物与图标：缓存优先
  if (url.pathname.startsWith('/assets/') || /\.(?:css|js|woff2?|png|svg|webp|ico|webmanifest)$/.test(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(VERSION)
      const hit = await cache.match(request)
      if (hit) return hit
      const response = await fetch(request)
      if (response.ok) cache.put(request, response.clone()).catch(() => {})
      return response
    })())
    return
  }

  // world 资源：先给缓存，后台刷新（省掉首屏 504 的影响）
  if (url.pathname.startsWith('/world/')) {
    event.respondWith((async () => {
      const cache = await caches.open(VERSION)
      const hit = await cache.match(request)
      const network = fetch(request).then(response => {
        if (response.ok) {
          const length = Number(response.headers.get('content-length') || 0)
          if (length && length <= MAX_FILE_BYTES) {
            quotaLeft().then(left => {
              if (left < MAX_RUNTIME_BYTES) return
              cache.put(request, response.clone()).catch(() => {})
            }).catch(() => {})
          }
        }
        return response
      }).catch(() => null)
      if (hit) { event.waitUntil(network.then(() => {})); return hit }
      const response = await network
      return response || Response.error()
    })())
  }
})

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting()
})
