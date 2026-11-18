/** Tiny helpers for the inline #boot overlay in index.html. */
export function bootProgress(message: string, percent: number) {
  const msg = document.getElementById('boot-msg')
  const bar = document.getElementById('boot-bar')
  if (msg) msg.textContent = message
  if (bar) bar.style.width = `${Math.max(0, Math.min(100, percent))}%`
}

export function bootDismiss() {
  const boot = document.getElementById('boot')
  if (!boot || boot.classList.contains('out')) return
  boot.classList.add('out')
  window.setTimeout(() => boot.remove(), 420)
}
