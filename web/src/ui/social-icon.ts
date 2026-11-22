/**
 * 第三方平台图标：QQ / 微信 用官方品牌图（200×200 PNG，放在 public/icons/），
 * 其余平台暂不提供图标，调用方回落到「平台首字母徽标」。
 *
 * 自托管而不是外链：避免第三方图床挂了、被 CSP 拦、或泄露用户 Referer。
 */
const ICONS: Record<string, string> = {
  qq: '/icons/qq.png',
  wx: '/icons/wx.png',
}

export const hasSocialIcon = (type: string) => Object.prototype.hasOwnProperty.call(ICONS, type)

/** 返回一个 18×18 的 <img>；没有对应图标时返回 null。 */
export function socialIcon(type: string, size = 18): HTMLImageElement | null {
  const src = ICONS[type]
  if (!src) return null
  const image = document.createElement('img')
  image.className = 'social-icon'
  image.src = src
  image.alt = '' // 旁边就是平台名，避免读屏重复
  image.width = size
  image.height = size
  image.decoding = 'async'
  image.loading = 'lazy'
  return image
}
