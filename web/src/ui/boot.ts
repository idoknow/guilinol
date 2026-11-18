/** Tiny helpers for the inline #boot overlay in index.html.
 *  Reveals the overlay only if asset fetching takes >80 ms, avoiding a flash on cached/fast loads
 *  and sparing software compositors an unnecessary full-screen layer pass on instant loads. */
let revealTimer = 0
let loaded = false

export function bootProgress(message: string, percent: number) {
  const boot = document.getElementById('boot')
  if (boot && !loaded && !revealTimer && boot.hidden) {
    if (percent === 0) {
      boot.hidden = false
    } else {
      revealTimer = window.setTimeout(() => {
        revealTimer = 0
        if (!loaded && boot && !boot.classList.contains('out')) boot.hidden = false
      }, 80)
    }
  }
  const msg = document.getElementById('boot-msg')
  const bar = document.getElementById('boot-bar')
  if (msg) msg.textContent = message
  if (bar) bar.style.width = `${Math.max(0, Math.min(100, percent))}%`
}

export function bootLoaded() {
  loaded = true
  if (revealTimer) {
    clearTimeout(revealTimer)
    revealTimer = 0
  }
}

export function bootDismiss() {
  bootLoaded()
  const boot = document.getElementById('boot')
  if (!boot || boot.classList.contains('out')) return
  if (boot.hidden) {
    boot.remove()
    return
  }
  boot.classList.add('out')
  window.setTimeout(() => boot.remove(), 420)
}
