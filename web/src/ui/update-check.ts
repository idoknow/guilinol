import './update-check.css'

// IDOK-204: a phone tab can stay open across releases. Each release replaces the hashed chunks, so a stale page keeps
// running but its lazy imports (map/atlas, settings, …) 404 and those parts of the HUD silently never appear.
// Compare our build sha with /version.json and offer a one-tap refresh instead of leaving a half-built HUD.

const BUILD = typeof __BUILD_SHA__ === 'string' ? __BUILD_SHA__ : ''
const PERIOD = 30*60_000, MIN_GAP = 5*60_000
let lastCheck = 0, shown = false, pending: Promise<void> | undefined

export function checkForUpdate(force = false): Promise<void> {
  if (!BUILD || shown) return Promise.resolve()
  if (pending) return pending
  if (!force && Date.now()-lastCheck < MIN_GAP) return Promise.resolve()
  lastCheck = Date.now()
  return pending = fetch(`./version.json?t=${Date.now()}`, {cache: 'no-store'})
    .then(response => response.ok ? response.json() as Promise<{sha?: unknown}> : null)
    .then(live => { if (typeof live?.sha === 'string' && /^[0-9a-f]{7,40}$/.test(live.sha) && live.sha !== BUILD) showRefresh() })
    .catch(() => {})
    .finally(() => { pending = undefined })
}

function showRefresh() {
  if (shown) return
  shown = true
  const bar = document.createElement('button')
  bar.type = 'button'; bar.className = 'update-pill'
  bar.setAttribute('aria-label', '网上桂林有新版本，点按刷新')
  bar.innerHTML = '<i aria-hidden="true">新</i><span>网上桂林有新版本</span><b>刷新</b>'
  bar.onclick = () => location.reload()
  document.body.append(bar)
  requestAnimationFrame(() => bar.classList.add('show'))
}

export function watchForUpdates() {
  if (!BUILD) return
  // Vite fires this when a dynamic import's chunk cannot be fetched — the clearest sign we are out of date.
  window.addEventListener('vite:preloadError', () => void checkForUpdate(true))
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void checkForUpdate() })
  window.addEventListener('pageshow', event => { if (event.persisted) void checkForUpdate(true) })
  window.setInterval(() => { if (document.visibilityState === 'visible') void checkForUpdate() }, PERIOD)
  lastCheck = Date.now()
}
