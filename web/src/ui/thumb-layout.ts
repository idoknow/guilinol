// IDOK-256：把「手机按键」偏好落到 body 上——walk.css 只认这三个钩子：
//   body[data-thumb-layout=arc|column|corner]、body[data-thumb-hand=left]、--thumb-scale。
// 默认值（弧形 / 1.0 / 右手）与改版前的外观一致。
import {onPrefs, prefs, type ThumbPrefs} from './prefs'

export function applyThumbLayout(thumb: ThumbPrefs = prefs().thumb) {
  const body = document.body
  body.dataset.thumbLayout = thumb.layout
  if (thumb.mirror) body.dataset.thumbHand = 'left'
  else delete body.dataset.thumbHand
  body.style.setProperty('--thumb-scale', String(thumb.scale))
}

let mounted = false
export function mountThumbLayout() {
  if (mounted) return
  mounted = true
  applyThumbLayout()
  onPrefs(next => applyThumbLayout(next.thumb))
}
