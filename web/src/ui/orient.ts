/**
 * 方向提示
 *
 * · 主菜单 / 登录页：竖屏使用 → 横屏时提示「请先竖屏」
 * · 游戏内（步行 / 飞行）：横屏使用 → 竖屏时提示「请先横屏」
 *
 * 只做提示，不拦截操作；点一下可以暂时收起 60 秒。
 */
import './orient.css'

let overlay: HTMLElement | null = null
let snoozeUntil = 0
let timer = 0

function inGame() {
  const mode = document.body.dataset.mode
  if (mode === 'walk' || mode === 'fly' || mode === 'play') return true
  // 兜底：主菜单浮层不在 DOM 里就算进了游戏
  return !document.querySelector('.home')
}

/** 电脑（有鼠标、精确指针）永远不需要方向提示 */
function isTouchDevice() {
  if (typeof window.matchMedia === 'function' && window.matchMedia('(hover: hover) and (pointer: fine)').matches) return false
  return navigator.maxTouchPoints > 0 || window.matchMedia('(pointer: coarse)').matches
}

function needHint() {
  if (!isTouchDevice()) return ''
  const portrait = window.innerHeight > window.innerWidth
  const game = inGame()
  // 游戏要横屏：竖屏时提示；主菜单要竖屏：横屏时提示
  if (game && portrait) return '请先横屏'
  if (!game && !portrait) return '请先竖屏'
  return ''
}

function ensure() {
  if (overlay) return overlay
  overlay = document.createElement('div')
  overlay.className = 'orient-hint'
  overlay.hidden = true
  overlay.innerHTML = '<span class="orient-text"></span><small>点一下可暂时收起</small>'
  overlay.addEventListener('click', () => {
    snoozeUntil = Date.now() + 60000
    overlay!.hidden = true
  })
  document.body.append(overlay)
  return overlay
}

export function updateOrient() {
  const node = ensure()!
  if (Date.now() < snoozeUntil) {
    node.hidden = true
    return
  }
  const text = needHint()
  node.hidden = !text
  if (text) node.querySelector('.orient-text')!.textContent = text
}

/**
 * HUD 自校准：把「小地图」「在线玩家列表」的真实位置量出来写成 CSS 变量，
 * 蹲/翘头按钮和血条就能自动躲开它们（不同机型、不同屏幕高度都不用写死）。
 */
export function calibrateHud() {
  const root = document.documentElement
  const minimap = document.querySelector<HTMLElement>('.minimap')
  if (minimap && minimap.offsetParent !== null) {
    const rect = minimap.getBoundingClientRect()
    // 小地图在上半屏 → 蹲/翘头排到它下面；在下半屏 → 排到它上面
    root.style.setProperty('--minimap-h', Math.round(rect.height) + 'px')
    if (rect.top < window.innerHeight / 2) {
      root.style.setProperty('--minimap-top', Math.round(rect.bottom) + 'px')
      root.style.setProperty('--minimap-bottom', '0px')
    } else {
      root.style.setProperty('--minimap-bottom', Math.round(window.innerHeight - rect.top) + 'px')
      root.style.setProperty('--minimap-top', '0px')
    }
  }
  for (const selector of ['.online-list', '.players', '.hud-players', '.online-players']) {
    const list = document.querySelector<HTMLElement>(selector)
    if (!list || list.offsetParent === null) continue
    const rect = list.getBoundingClientRect()
    root.style.setProperty('--players-bottom', Math.round(rect.bottom) + 'px')
    break
  }
}

/** 全屏时隐藏地图/登录信息/在线玩家/时间天气（沉浸） */
function syncFullscreenFlag() {
  if (document.fullscreenElement) document.body.setAttribute('data-fullscreen', '1')
  else document.body.removeAttribute('data-fullscreen')
}

export function mountOrientHint() {
  updateOrient()
  syncFullscreenFlag()
  document.addEventListener('fullscreenchange', syncFullscreenFlag)
  window.addEventListener('resize', syncFullscreenFlag)
  calibrateHud()
  window.addEventListener('resize', updateOrient)
  window.setInterval(calibrateHud, 1200)
  window.addEventListener('orientationchange', () => setTimeout(updateOrient, 240))
  // 进入 / 退出游戏时会切换 body[data-mode]，轮询兜住所有情况
  window.clearInterval(timer)
  timer = window.setInterval(updateOrient, 1500)
}
