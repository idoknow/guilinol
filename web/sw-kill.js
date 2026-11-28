/* 紧急回滚用 service worker。
 * 用法（SW 出问题时）：
 *   cp web/sw-kill.js dist/sw.js  然后发版，所有客户端会：
 *   清空全部 Cache Storage → 注销自己 → 刷新页面。
 * 平时不参与构建注册。 */
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) await caches.delete(key)
    await self.registration.unregister()
    const clients = await self.clients.matchAll({ type: 'window' })
    for (const client of clients) client.navigate(client.url).catch(() => {})
  })())
})
