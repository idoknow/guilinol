// 触屏界面（摇杆、跃/蹲按钮、触屏引导文案）只给「真触屏设备」：主指针是手指，且没有任何能悬停的指针（鼠标/触控板）。
// 只看 (pointer:coarse) 不够：带触摸屏的 Windows 笔记本主指针也报 coarse，结果电脑上冒出手机摇杆、按键卡反而藏起来（IDOK-235）。
// CSS 里所有触屏布局都用同一条：@media (pointer:coarse) and (not (any-pointer:fine))。
// 不能用 (any-hover:none)：Chromium 在触屏笔记本上 any-hover:none 也为真（只要有一个不能悬停的输入）。
// 老浏览器（iOS < 16.4）不认 not(...)，整条查询失效 → 下面的手指兜底会切到触屏操作。
export const TOUCH_UI_QUERY = '(pointer:coarse) and (not (any-pointer:fine))'

let fingered = false

/** 当前是否用触屏界面。 */
export const touchUi = () => fingered || matchMedia(TOUCH_UI_QUERY).matches

// 兜底（最后一次输入说了算）：媒体查询判成电脑、但玩家真的用手指点了屏幕（触屏笔记本、带笔的平板），切到触屏操作，
// 免得没法走路；之后又动了鼠标 / 触控板，就切回电脑界面（按键卡回来、摇杆收起）。<html data-touch> 给 CSS 用。
function set(on: boolean) {
  if (on === fingered) return
  fingered = on
  if (on) document.documentElement.dataset.touch = '1'
  else delete document.documentElement.dataset.touch
  dispatchEvent(new Event('glol:input-mode'))
}
addEventListener('pointerdown', event => {
  if (event.pointerType === 'touch' && !matchMedia(TOUCH_UI_QUERY).matches) set(true)
}, {capture: true, passive: true})
addEventListener('pointermove', event => {
  if (fingered && event.pointerType === 'mouse' && (event.movementX || event.movementY)) set(false)
}, {capture: true, passive: true})
