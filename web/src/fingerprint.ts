// 设备指纹（联机反外挂用）：仅用于「同一台设备换号后继续被封」的判定，不做身份认证。
// 浏览器里没有硬件指纹，只能取一组稳定的环境特征再哈希；同一台设备在同一浏览器里
// 多次访问必须一致，换浏览器/换设备会变（这是预期行为，宁可漏也不误伤）。
// 组成：canvas 渲染差异 + WebGL 厂商/型号 + 屏幕与像素比 + 时区/语言 + 硬件并发/内存 + UA 粗分类。
const KEY = 'glol.device'

function fnv1a(text: string) {
  let h1 = 0x811c9dc5, h2 = 0x01000193
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h1 = (h1 ^ c) * 0x01000193 >>> 0
    h2 = (h2 + c * (i + 1)) >>> 0
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')
}

function canvasMark() {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 220; canvas.height = 40
    const ctx = canvas.getContext('2d')
    if (!ctx) return 'no2d'
    ctx.textBaseline = 'top'
    ctx.font = '15px "Arial"'
    ctx.fillStyle = '#0a7'
    ctx.fillRect(0, 0, 220, 40)
    ctx.fillStyle = '#fff'
    ctx.fillText('网上桂林·设备指纹 0123456789', 4, 6)
    ctx.strokeStyle = 'rgba(255,190,0,.7)'
    ctx.beginPath(); ctx.arc(60, 20, 14, 0, Math.PI * 1.5); ctx.stroke()
    return canvas.toDataURL().slice(-180)
  } catch { return 'c2derr' }
}

function glMark() {
  try {
    const gl = document.createElement('canvas').getContext('webgl')
    if (!gl) return 'nogl'
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    const vendor = ext ? String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)) : ''
    const renderer = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : ''
    return `${vendor}|${renderer}|${gl.getParameter(gl.VERSION)}`
  } catch { return 'glerr' }
}

function raw() {
  const nav = navigator as Navigator & { deviceMemory?: number }
  return [
    canvasMark(), glMark(),
    `${screen.width}x${screen.height}x${screen.colorDepth}@${window.devicePixelRatio}`,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    navigator.language, String(nav.hardwareConcurrency ?? 0), String(nav.deviceMemory ?? 0),
    // UA 只取粗分类：平台 + 内核，避免浏览器版本升级就换指纹
    /Android/i.test(navigator.userAgent) ? 'android' : /iPhone|iPad/i.test(navigator.userAgent) ? 'ios' : /Windows/i.test(navigator.userAgent) ? 'win' : /Mac/i.test(navigator.userAgent) ? 'mac' : 'other',
  ].join('~')
}

let cached = ''

/** 设备摘要（给运营看的）：型号|浏览器主版本。只做展示与封禁参考，不参与身份判定。 */
export function deviceSummary(): string {
  const ua = navigator.userAgent
  const m = /(Edg|OPR|Chrome|Firefox|Safari)\/(\d+)/.exec(ua)
  const browser = m ? `${m[1] === 'OPR' ? 'Opera' : m[1] === 'Edg' ? 'Edge' : m[1]} ${m[2]}` : 'unknown'
  const mm = /Android[^;]*;\s*([^;)]+?)(?:\s+Build|\s+MIUI|\s+HM|\s+Redmi|;|\))/.exec(ua)
  const model = mm ? mm[1].trim()
    : /iPhone/.test(ua) ? 'iPhone'
    : /iPad/.test(ua) ? 'iPad'
    : /Windows/.test(ua) ? 'Windows'
    : /Mac/.test(ua) ? 'Mac'
    : 'other'
  return `${model}|${browser}`
}

/** 稳定指纹：优先复用 localStorage，换代算法时改 KEY 即可（服务端只做精确匹配） */
export function fingerprint(): string {
  if (cached) return cached
  try {
    const stored = localStorage.getItem(KEY)
    if (stored && /^[0-9a-f]{16,64}$/.test(stored)) return (cached = stored)
  } catch { /* 隐私模式下不可用 */ }
  const value = fnv1a(raw())
  cached = value
  try { localStorage.setItem(KEY, value) } catch { /* 忽略 */ }
  return value
}
