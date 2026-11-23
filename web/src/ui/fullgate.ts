/**
 * 手游全屏门禁
 *
 * · 只在触屏设备出现；未全屏时盖一层磨砂遮罩 + 大按钮，点了才真正进入游戏
 * · iOS Safari 不支持 requestFullscreen：显示提示，6 秒后自动放行（不挡住玩家）
 * · 本次会话点过「跳过」就不再弹（sessionStorage）
 */
import './fullgate.css'

const SKIP_KEY = 'guiling.fullgate.skipped'

function isTouch() {
  if (typeof window.matchMedia === 'function' && window.matchMedia('(hover: hover) and (pointer: fine)').matches) return false
  return navigator.maxTouchPoints > 0 || window.matchMedia('(pointer: coarse)').matches
}

function canFullscreen() {
  return typeof document.documentElement.requestFullscreen === 'function'
}

export function mountFullGate() {
  if (!isTouch()) return
  if (sessionStorage.getItem(SKIP_KEY)) return
  if (document.fullscreenElement) return

  const mask = document.createElement('div')
  mask.className = 'fullgate'
  mask.innerHTML =
    '<div class="fullgate-box">' +
    '<p class="fullgate-title">网上桂林</p>' +
    '<p class="fullgate-sub">' +
    (canFullscreen() ? '手机建议全屏游玩，视野更大、按钮不挡画面' : '当前浏览器不支持全屏：可以把本站“添加到主屏幕”，从桌面图标进入即可全屏') +
    '</p>' +
    '<button type="button" class="fullgate-go">' + (canFullscreen() ? '全屏进入' : '知道了，继续') + '</button>' +
    '<button type="button" class="fullgate-skip">先这样玩</button>' +
    '</div>'
  document.body.append(mask)

  const close = () => {
    sessionStorage.setItem(SKIP_KEY, '1')
    mask.classList.add('is-out')
    window.setTimeout(() => mask.remove(), 260)
  }

  mask.querySelector<HTMLButtonElement>('.fullgate-skip')!.onclick = close
  mask.querySelector<HTMLButtonElement>('.fullgate-go')!.onclick = async () => {
    try {
      await document.documentElement.requestFullscreen?.()
    } catch {
      /* 用户拒绝或被拦，直接放行 */
    }
    close()
  }

  // iOS 这种不支持全屏的：6 秒后自动放行，避免卡死
  if (!canFullscreen()) window.setTimeout(close, 6000)
}
