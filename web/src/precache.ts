/** 注册 PWA 预缓存 service worker（仅生产构建）。
 *  作用：构建产物全量缓存到本地，首屏不再依赖 CDN；页面导航网络优先、3 秒超时回落缓存。
 *  更新：新版本 sw.js 内容不同 → 浏览器装新 SW → 下次导航自动用新缓存。 */
export function registerPrecache() {
  if (import.meta.env.DEV) return
  if (!('serviceWorker' in navigator)) return
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') return
  const register = () => {
    navigator.serviceWorker.register('/sw.js', {scope: '/'}).catch(() => {})
  }
  if (document.readyState === 'complete') register()
  else window.addEventListener('load', register, {once: true})
}
