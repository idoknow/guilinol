/** 注册 PWA 预缓存 service worker（仅生产构建）。
 *  预缓存会一次性发出上百个请求，不能在首屏和「开始游览」的资源下载抢带宽：
 *  等页面完全空闲再注册；省流量模式、2G/3G 直接跳过（下次网络好再装）。 */
type NetworkInformation = { saveData?: boolean; effectiveType?: string }

export function registerPrecache() {
  if (import.meta.env.DEV) return
  if (!('serviceWorker' in navigator)) return
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') return
  const connection = (navigator as Navigator & { connection?: NetworkInformation }).connection
  if (connection?.saveData) return
  if (connection?.effectiveType && /(^|-)2g$|3g/.test(connection.effectiveType)) return

  const register = () => {
    navigator.serviceWorker.register(`/sw/${__BUILD_SHA__}`, { scope: '/' }).catch(() => {})
  }
  const whenIdle = () => {
    if ('requestIdleCallback' in window) {
      ;(window as Window & { requestIdleCallback: (cb: () => void, options?: { timeout: number }) => void })
        .requestIdleCallback(register, { timeout: 8000 })
    } else {
      globalThis.setTimeout(register, 3000)
    }
  }
  if (document.readyState === 'complete') whenIdle()
  else window.addEventListener('load', whenIdle, { once: true })
}
