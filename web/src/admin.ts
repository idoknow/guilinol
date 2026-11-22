// 网上桂林 · 管理后台。单页：?view= 路由，所有数据来自 /api/admin/*（见 docs/telemetry.md）。
import { labels, viewToken } from '../../lib/feedback-contract'
import './ui/theme.css'
import './admin.css'
import {socialIcon} from './ui/social-icon'

/* ───────────── DOM helpers ───────────── */
type Child = Node | string | number | null | undefined | false | Child[]
type Attrs = Record<string, string | number | boolean | EventListener | undefined | null>
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs | null, ...children: Child[]) {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value == null || value === false) continue
    if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value as EventListener)
    else if (key === 'class') node.className = String(value)
    else if (value === true) node.setAttribute(key, '')
    else node.setAttribute(key, String(value))
  }
  append(node, children)
  return node
}
function append(node: Element, children: Child[]) {
  for (const child of (children as unknown[]).flat(Infinity) as Child[]) {
    if (child == null || child === false) continue
    node.append(child instanceof Node ? child : String(child))
  }
}
const svgNS = 'http://www.w3.org/2000/svg'
function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, text?: string) {
  const node = document.createElementNS(svgNS, tag)
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value))
  if (text != null) node.textContent = text
  return node
}

const side = document.querySelector<HTMLElement>('.adm-side')!,
  top = document.querySelector<HTMLElement>('.adm-top')!,
  main = document.querySelector('main')!,
  toasts = document.querySelector<HTMLElement>('.adm-toasts')!

/* ───────────── API ───────────── */
class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
  }
}
const codeText: Record<string, string> = {
  unverified: '该用户还没有验证邮箱，不能设为管理员',
  self_demotion: '不能取消你自己的管理员身份',
  last_admin: '至少要保留一位管理员',
}
let generation = 0
async function api<T = any>(path: string, data?: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(
      `/api/${path}`,
      data
        ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }
        : { cache: 'no-store' },
    )
  } catch {
    throw new ApiError(0, 'network', '网络连接失败，请检查网络后重试')
  }
  const result = await response.json().catch(() => null)
  if (!response.ok) {
    const code = result?.error?.code ?? ''
    throw new ApiError(
      response.status,
      code,
      codeText[code] ??
        result?.error?.message ??
        (response.status >= 500 ? '服务器出错了，请稍后再试' : `请求失败（${response.status}）`),
    )
  }
  return result as T
}
const list = <T>(result: T[] | { items: T[] }) => (Array.isArray(result) ? result : result?.items ?? [])
const num = (value: unknown) => (value == null || value === '' ? null : Number(value))

/* ───────────── formatting ───────────── */
type Fmt = (value: number | null) => string
const dash = '—'
const fmt = {
  int: ((v) => (v == null ? dash : Math.round(v).toLocaleString('zh-CN'))) as Fmt,
  num: ((v) => (v == null ? dash : v >= 100 ? Math.round(v).toLocaleString('zh-CN') : v.toFixed(v >= 10 ? 1 : 2))) as Fmt,
  pct: ((v) => (v == null ? dash : `${(v * 100).toFixed(v < 0.1 ? 2 : 1)}%`)) as Fmt,
  ms: ((v) => (v == null ? dash : v >= 10000 ? `${(v / 1000).toFixed(1)} s` : v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`)) as Fmt,
  sec: ((v) => {
    if (v == null) return dash
    if (v < 60) return `${Math.round(v)} 秒`
    if (v < 3600) return `${Math.floor(v / 60)} 分 ${Math.round(v % 60)} 秒`
    return `${(v / 3600).toFixed(1)} 小时`
  }) as Fmt,
  bytes: ((v) => {
    if (v == null) return dash
    const units = ['B', 'KB', 'MB', 'GB']
    let i = 0
    while (v >= 1024 && i < units.length - 1) (v /= 1024), i++
    return `${v.toFixed(i ? 1 : 0)} ${units[i]}`
  }) as Fmt,
  fps: ((v) => (v == null ? dash : `${v.toFixed(0)} fps`)) as Fmt,
  meters: ((v) => (v == null ? dash : v >= 1000 ? `${(v / 1000).toFixed(1)} km` : `${Math.round(v)} m`)) as Fmt,
  cores: ((v) => (v == null ? dash : `${(v * 100).toFixed(1)}%`)) as Fmt,
}
const unix = (stamp: unknown) =>
  stamp ? new Date(Number(stamp) * 1000) : null
const iso = (stamp: unknown) => (stamp ? new Date(String(stamp)) : null)
function when(date: Date | null, withYear = false) {
  if (!date || Number.isNaN(+date)) return dash
  return date.toLocaleString('zh-CN', {
    year: withYear ? 'numeric' : undefined,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}
function ago(date: Date | null) {
  if (!date) return dash
  const seconds = (Date.now() - +date) / 1000
  if (seconds < 60) return '刚刚'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`
  if (seconds < 86400 * 30) return `${Math.floor(seconds / 86400)} 天前`
  return when(date, true)
}

/* ───────────── metric catalogue ───────────── */
type Better = 'up' | 'down' | null
type Metric = { label: string; fmt: Fmt; better: Better; hint?: string }
const kpis: Record<string, Metric> = {
  online: { label: '当前在线', fmt: fmt.int, better: 'up', hint: '区间末 5 分钟内活跃的会话' },
  visitors: { label: '访客', fmt: fmt.int, better: 'up', hint: '去重的匿名访客' },
  newVisitors: { label: '新访客', fmt: fmt.int, better: 'up' },
  returnRate: { label: '回访率', fmt: fmt.pct, better: 'up', hint: '复用已存访客 ID 的访客占比' },
  sessions: { label: '会话', fmt: fmt.int, better: 'up' },
  durationAvg: { label: '平均游玩时长', fmt: fmt.sec, better: 'up' },
  durationP50: { label: '游玩时长中位数', fmt: fmt.sec, better: 'up' },
  playableP50: { label: '可玩用时 p50', fmt: fmt.ms, better: 'down', hint: '从打开页面到可以操作' },
  playableP95: { label: '可玩用时 p95', fmt: fmt.ms, better: 'down' },
  fpsP50: { label: '帧率 p50', fmt: fmt.fps, better: 'up' },
  chunkP95: { label: '瓦片加载 p95', fmt: fmt.ms, better: 'down' },
  errorRate: { label: '出错会话占比', fmt: fmt.pct, better: 'down' },
  contextLost: { label: 'WebGL 丢失', fmt: fmt.int, better: 'down', hint: 'WebGL context lost 次数' },
  api5xxRate: { label: '接口 5xx 率', fmt: fmt.pct, better: 'down' },
  registrations: { label: '新注册', fmt: fmt.int, better: 'up' },
  feedback: { label: '新反馈', fmt: fmt.int, better: 'up' },
}
const kpiGroups: [string, string[]][] = [
  ['访问', ['visitors', 'newVisitors', 'returnRate', 'sessions', 'durationAvg', 'durationP50']],
  ['体验', ['playableP50', 'playableP95', 'fpsP50', 'chunkP95']],
  ['稳定性', ['errorRate', 'contextLost', 'api5xxRate']],
  ['社区', ['registrations', 'feedback']],
]
// timeseries 指标目录：KPI + 性能分位 + 计数。key 为 API 的 metric 参数。
const perfBase: [string, string, Fmt, Better][] = [
  ['fps', '帧率', fmt.num, 'up'],
  ['frameP95', '帧耗时 p95', fmt.ms, 'down'],
  ['longFrames', '长帧数（>50ms）', fmt.num, 'down'],
  ['playable', '可玩用时', fmt.ms, 'down'],
  ['firstFrame', '首帧', fmt.ms, 'down'],
  ['chunk', '瓦片加载', fmt.ms, 'down'],
  ['teleport', '传送耗时', fmt.ms, 'down'],
  ['switch', '切换模式', fmt.ms, 'down'],
  ['mapOpen', '打开地图', fmt.ms, 'down'],
  ['api.login', '登录接口', fmt.ms, 'down'],
  ['api.feedback', '反馈接口', fmt.ms, 'down'],
  ['dns', 'DNS', fmt.ms, 'down'],
  ['tcp', 'TCP 连接', fmt.ms, 'down'],
  ['tls', 'TLS 握手', fmt.ms, 'down'],
  ['ttfb', '首字节 TTFB', fmt.ms, 'down'],
  ['dcl', 'DOMContentLoaded', fmt.ms, 'down'],
  ['load', '页面 load', fmt.ms, 'down'],
  ['lcp', 'LCP 最大内容绘制', fmt.ms, 'down'],
  ['fcp', 'FCP 首次内容绘制', fmt.ms, 'down'],
  ['inp', 'INP 交互延迟', fmt.ms, 'down'],
  ['cls', 'CLS 布局偏移', fmt.num, 'down'],
  ['calls', 'Draw calls', fmt.int, 'down'],
  ['triangles', '三角面数', fmt.int, 'down'],
  ['textures', '纹理数', fmt.int, 'down'],
  ['chunks', '已加载瓦片', fmt.int, null],
  ['heap', 'JS 堆内存', fmt.bytes, 'down'],
  ['session.total', '会话总时长', fmt.sec, 'up'],
  ['session.walkSeconds', '步行时长', fmt.sec, null],
  ['session.driveSeconds', '驾驶时长', fmt.sec, null],
  ['session.flySeconds', '飞行时长', fmt.sec, null],
  ['session.mapSeconds', '看地图时长', fmt.sec, null],
  ['session.walkMeters', '步行距离', fmt.meters, null],
  ['session.driveMeters', '驾驶距离', fmt.meters, null],
  ['session.flyMeters', '飞行距离', fmt.meters, null],
  ['session.teleports', '传送次数', fmt.num, null],
  ['session.grids', '探索网格数', fmt.num, 'up'],
]
const counters: [string, string][] = [
  ['failure.chunk', '瓦片加载失败'],
  ['failure.landmark', '地标加载失败'],
  ['failure.manifest', 'manifest 失败'],
  ['retry.chunk', '瓦片重试'],
  ['retry.landmark', '地标重试'],
  ['retry.manifest', 'manifest 重试'],
]
const seriesCatalog: { group: string; items: [string, Metric][] }[] = [
  { group: '核心指标', items: Object.entries(kpis) },
  ...[
    ['渲染', ['fps', 'frameP95', 'longFrames', 'calls', 'triangles', 'textures', 'chunks', 'heap']],
    ['加载与操作', ['playable', 'firstFrame', 'chunk', 'teleport', 'switch', 'mapOpen', 'api.login', 'api.feedback']],
    ['网络', ['dns', 'tcp', 'tls', 'ttfb', 'dcl', 'load']],
    ['Web Vitals', ['lcp', 'fcp', 'inp', 'cls']],
    ['玩法', perfBase.filter(([k]) => k.startsWith('session.')).map(([k]) => k)],
  ].map(([group, keys]) => ({
    group: group as string,
    items: (keys as string[]).flatMap((key) => {
      const [, label, f, better] = perfBase.find(([k]) => k === key)!
      return (['p50', 'p95'] as const).map((q) => [`${key}.${q}`, { label: `${label} ${q}`, fmt: f, better }] as [string, Metric])
    }),
  })),
  { group: '加载可靠性', items: counters.map(([key, label]) => [key, { label, fmt: fmt.int, better: 'down' }]) },
]
const metricInfo = (key: string): Metric =>
  seriesCatalog.flatMap((g) => g.items).find(([k]) => k === key)?.[1] ?? { label: key, fmt: fmt.num, better: null }
const dims: [string, string][] = [
  ['region', '省份'],
  ['city', '城市'],
  ['isp', '运营商'],
  ['device', '设备'],
  ['os', '系统'],
  ['browser', '浏览器'],
  ['gpu', '显卡'],
  ['build', '版本'],
  ['language', '语言'],
  ['referrer', '来源'],
  ['mode', '模式'],
]
const dimValue: Record<string, Record<string, string>> = {
  device: { mobile: '手机', desktop: '电脑' },
  referrer: { direct: '直接访问', search: '搜索引擎', social: '社交平台', internal: '站内', other: '其他' },
  mode: { walk: '步行', drive: '驾驶', fly: '飞行', map: '地图', menu: '菜单' },
  node: { 'cn-gz-tencent-02': '广州', 'cn-sh-tencent-01': '上海' },
  target: { home: '首页', manifest: '世界清单', chunk1: '地形瓦片 1', chunk2: '地形瓦片 2', chunk3: '地形瓦片 3', chunk4: '地形瓦片 4', chunk5: '地形瓦片 5', health: '接口健康检查' },
}
const label = (dim: string, value: unknown) =>
  value == null || value === '' || value === 'unknown' ? '未知' : dimValue[dim]?.[String(value)] ?? String(value)
const funnelText: Record<string, string> = {
  playable: '进入可操作',
  loginOpen: '打开登录',
  loginSuccess: '登录成功',
  feedbackOpen: '打开反馈',
  feedbackSuccess: '提交反馈',
}

/* ───────────── state & routing ───────────── */
const ranges: Record<string, { label: string; ms: number; bucket: string }> = {
  '1h': { label: '1 小时', ms: 3600e3, bucket: '5m' },
  '24h': { label: '24 小时', ms: 86400e3, bucket: '1h' },
  '7d': { label: '7 天', ms: 7 * 86400e3, bucket: '1h' },
  '30d': { label: '30 天', ms: 30 * 86400e3, bucket: '1d' },
  '90d': { label: '90 天', ms: 90 * 86400e3, bucket: '1d' },
}
type View = { key: string; label: string; icon: string; group: string; ranged?: boolean }
const views: View[] = [
  { key: 'overview', label: '总览', icon: '◎', group: '数据', ranged: true },
  { key: 'trends', label: '趋势', icon: '〰', group: '数据', ranged: true },
  { key: 'breakdown', label: '分布', icon: '▤', group: '数据', ranged: true },
  { key: 'network', label: '地区与网络', icon: '◈', group: '数据', ranged: true },
  { key: 'errors', label: '错误', icon: '⚠', group: '数据', ranged: true },
  { key: 'live', label: '实时', icon: '●', group: '数据' },
  { key: 'server', label: '服务端', icon: '▣', group: '数据', ranged: true },
  { key: 'feedback', label: '反馈处理', icon: '✉', group: '运营' },
  { key: 'users', label: '用户与权限', icon: '☺', group: '运营' },
  { key: 'audit', label: '操作记录', icon: '☰', group: '运营' },
]
let me: { id: string; email: string; nickname: string; role: string }
let params = new URLSearchParams(location.search)
let pendingCount: number | null = null
let refreshTimer = 0
function currentView() {
  if (params.has('id')) return params.get('view') === 'users' ? 'users' : 'feedback'
  const view = params.get('view') ?? 'overview'
  return views.some((v) => v.key === view) ? view : 'overview'
}
function hrefFor(next: Record<string, string | null>, keep = false) {
  const query = keep ? new URLSearchParams(params) : new URLSearchParams()
  if (!keep && params.get('range')) query.set('range', params.get('range')!)
  for (const [key, value] of Object.entries(next)) value == null ? query.delete(key) : query.set(key, value)
  return '?' + query
}
function go(next: Record<string, string | null>, keep = false, replace = false) {
  const href = hrefFor(next, keep)
  history[replace ? 'replaceState' : 'pushState'](null, '', href)
  params = new URLSearchParams(href)
  render()
}
function navLink(text: Child | Child[], next: Record<string, string | null>, attrs: Attrs = {}, keep = false) {
  const href = hrefFor(next, keep)
  return h('a', {
    ...attrs,
    href,
    onclick: ((event: MouseEvent) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button) return
      event.preventDefault()
      go(next, keep)
    }) as EventListener,
  }, text)
}
window.addEventListener('popstate', () => {
  params = new URLSearchParams(location.search)
  render()
})
function rangeWindow() {
  const key = Object.hasOwn(ranges, params.get('range') ?? '') ? params.get('range')! : '24h'
  const to = Math.ceil(Date.now() / 60000) * 60000
  return { key, ...ranges[key], from: new Date(to - ranges[key].ms).toISOString(), to: new Date(to).toISOString() }
}
const rangeQuery = (extra: Record<string, string> = {}) => {
  const r = rangeWindow()
  return new URLSearchParams({ from: r.from, to: r.to, ...extra })
}

/* ───────────── generic UI pieces ───────────── */
function toast(text: string, kind: 'ok' | 'error' = 'ok') {
  const node = h('div', { class: `adm-toast adm-toast--${kind}` }, text)
  toasts.append(node)
  setTimeout(() => node.classList.add('is-out'), 3200)
  setTimeout(() => node.remove(), 3600)
}
function skeleton(rows = 3, className = '') {
  return h('div', { class: `adm-skel ${className}`, 'aria-busy': 'true', 'aria-label': '加载中' },
    Array.from({ length: rows }, () => h('span')))
}
function emptyState(text: string, hint?: string) {
  return h('div', { class: 'adm-empty' }, h('b', null, text), hint && h('span', null, hint))
}
function errorState(error: unknown, retry?: () => void) {
  const message = error instanceof Error ? error.message : '请求失败'
  return h('div', { class: 'adm-error', role: 'alert' },
    h('b', null, '加载失败'), h('span', null, message),
    retry && h('button', { class: 'adm-btn adm-btn--ghost', type: 'button', onclick: retry as EventListener }, '重试'))
}
function card(title: Child, body: Child | Child[], opts: { actions?: Child | Child[]; className?: string; sub?: string } = {}) {
  return h('section', { class: `adm-card ${opts.className ?? ''}` },
    (title || opts.actions) &&
      h('header', { class: 'adm-card-head' },
        h('div', null, title && h('h3', null, title), opts.sub && h('p', { class: 'adm-sub' }, opts.sub)),
        opts.actions && h('div', { class: 'adm-card-actions' }, opts.actions)),
    h('div', { class: 'adm-card-body' }, body))
}
/** Fills `slot` with the result of `load`, showing skeleton / error+retry / content. Ignores stale renders. */
function async<T>(slot: HTMLElement, load: () => Promise<T>, paint: (data: T) => Child | Child[], skel: Node = skeleton()) {
  const mine = generation
  const run = () => {
    slot.replaceChildren(skel)
    load()
      .then((data) => {
        if (mine !== generation) return
        slot.replaceChildren()
        append(slot, [paint(data)])
      })
      .catch((error) => {
        if (mine !== generation) return
        if (error instanceof ApiError && [401, 403].includes(error.status)) return denied(error.status)
        slot.replaceChildren(errorState(error, run))
      })
  }
  run()
  return slot
}
function pill(status: string) {
  return h('span', { class: `adm-pill adm-status--${status}` }, labels[status] ?? status)
}
function select(name: string, value: string, options: ([string, string] | { group: string; items: [string, string][] })[], onchange: (value: string) => void, aria?: string) {
  const node = h('select', { name, 'aria-label': aria ?? name, class: 'adm-select' })
  for (const option of options) {
    if (Array.isArray(option)) node.append(h('option', { value: option[0] }, option[1]))
    else node.append(h('optgroup', { label: option.group }, option.items.map(([k, l]) => h('option', { value: k }, l))))
  }
  node.value = value
  node.addEventListener('change', () => onchange(node.value))
  return node
}
function segmented(value: string, options: [string, string][], onpick: (value: string) => void, aria: string) {
  return h('div', { class: 'adm-seg', role: 'radiogroup', 'aria-label': aria },
    options.map(([key, text]) =>
      h('button', {
        type: 'button', role: 'radio', 'aria-checked': String(key === value), class: key === value ? 'is-on' : '',
        onclick: (() => key !== value && onpick(key)) as EventListener,
      }, text)))
}

/** Modal confirm in the game's jade-glass dialog. Resolves to the message text (or '') on confirm, null on cancel. */
function confirmDialog(opts: { title: string; body: Child | Child[]; confirm: string; tone?: 'seal' | 'jade'; message?: { label: string; required: boolean; placeholder?: string } }) {
  return new Promise<string | null>((resolve) => {
    const textarea = opts.message
      ? h('textarea', { rows: 4, maxlength: 2000, placeholder: opts.message.placeholder ?? '', 'aria-label': opts.message.label })
      : null
    const ok = h('button', { type: 'submit', class: `ui-btn ${opts.tone === 'seal' ? 'ui-btn--seal' : 'adm-dialog-ok'}` }, opts.confirm)
    const cancel = h('button', { type: 'button', class: 'ui-btn ui-btn--ghost' }, '取消')
    const hint = h('p', { class: 'adm-dialog-hint' })
    const form = h('form', { method: 'dialog' },
      h('header', null, h('h2', null, opts.title)),
      h('div', { class: 'adm-dialog-body' }, opts.body,
        textarea && h('label', { class: 'adm-dialog-field' }, h('span', null, opts.message!.label, opts.message!.required ? '（必填）' : '（选填）'), textarea),
        hint),
      h('footer', null, cancel, ok))
    const dialog = h('dialog', { class: 'ui-panel adm-dialog' }, form)
    document.body.append(dialog)
    let done = false
    const finish = (value: string | null) => {
      if (done) return
      done = true
      dialog.close()
      dialog.remove()
      resolve(value)
    }
    cancel.addEventListener('click', () => finish(null))
    dialog.addEventListener('cancel', (event) => (event.preventDefault(), finish(null)))
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      const text = textarea?.value.trim() ?? ''
      if (opts.message?.required && !text) {
        hint.textContent = '请填写说明，提交人会看到这段话'
        textarea!.focus()
        return
      }
      finish(text)
    })
    dialog.showModal()
    ;(textarea ?? ok).focus()
  })
}
/** Runs a mutating action with the button locked; reports errors as a toast. */
async function act(button: HTMLButtonElement, run: () => Promise<void>) {
  if (button.disabled) return
  button.disabled = true
  button.classList.add('is-busy')
  try {
    await run()
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return denied(401)
    toast(error instanceof Error ? error.message : '操作失败', 'error')
  } finally {
    button.disabled = false
    button.classList.remove('is-busy')
  }
}

/* ───────────── charts ───────────── */
const palette = ['var(--adm-c1)', 'var(--adm-c2)', 'var(--adm-c3)', 'var(--adm-c4)', 'var(--adm-c5)', 'var(--adm-c6)']
type Series = { name: string; points: { t: Date; v: number }[] }
function niceTicks(max: number, count = 4) {
  if (!(max > 0)) return [0, 1]
  const raw = max / count,
    mag = 10 ** Math.floor(Math.log10(raw)),
    step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((m) => m >= raw)!
  return Array.from({ length: Math.ceil(max / step) + 1 }, (_, i) => +(i * step).toFixed(10))
}
const bucketMs: Record<string, number> = { '5m': 300e3, '1h': 3600e3, '1d': 86400e3 }
function lineChart(series: Series[], format: Fmt, opts: { height?: number; bucket: string; compact?: boolean; gap?: number } = { bucket: '1h' }) {
  const wrap = h('div', { class: `adm-chart ${opts.compact ? 'adm-chart--compact' : ''}` })
  const tip = h('div', { class: 'adm-tip', hidden: true })
  const legend = series.length > 1
    ? h('div', { class: 'adm-legend' }, series.map((one, i) => h('span', null, h('i', { style: `background:${palette[i % 6]}` }), one.name)))
    : null
  const draw = () => {
    const width = Math.max(260, wrap.clientWidth || 600),
      height = opts.height ?? 220,
      pad = { l: opts.compact ? 4 : 56, r: opts.compact ? 4 : 14, t: 10, b: opts.compact ? 4 : 26 }
    const all = series.flatMap((one) => one.points)
    wrap.querySelector('svg')?.remove()
    if (!all.length) return
    const t0 = Math.min(...all.map((p) => +p.t)),
      t1 = Math.max(...all.map((p) => +p.t), t0 + 1),
      ticks = niceTicks(Math.max(...all.map((p) => p.v))),
      vmax = ticks[ticks.length - 1] || 1
    const x = (t: number) => pad.l + ((t - t0) / (t1 - t0)) * (width - pad.l - pad.r),
      y = (v: number) => pad.t + (1 - v / vmax) * (height - pad.t - pad.b)
    const svg = s('svg', { viewBox: `0 0 ${width} ${height}`, width, height, role: 'img' })
    if (!opts.compact) {
      for (const tick of ticks) {
        svg.append(s('line', { x1: pad.l, x2: width - pad.r, y1: y(tick), y2: y(tick), class: 'adm-grid' }))
        svg.append(s('text', { x: pad.l - 8, y: y(tick) + 4, 'text-anchor': 'end', class: 'adm-axis' }, format(tick)))
      }
      const xTicks = Math.min(6, Math.max(2, Math.floor(width / 120)))
      for (let i = 0; i <= xTicks; i++) {
        const t = t0 + ((t1 - t0) * i) / xTicks,
          date = new Date(t),
          text = opts.bucket === '1d' ? `${date.getMonth() + 1}/${date.getDate()}`
            : t1 - t0 > 86400e3 * 1.5 ? `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}时`
            : `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
        svg.append(s('text', { x: x(t), y: height - 6, 'text-anchor': i === 0 ? 'start' : i === xTicks ? 'end' : 'middle', class: 'adm-axis' }, text))
      }
    }
    series.forEach((one, i) => {
      const pts = [...one.points].sort((a, b) => +a.t - +b.t)
      if (!pts.length) return
      const gap = (opts.gap ?? bucketMs[opts.bucket] ?? 3600e3) * 1.5
      let broken = false
      const d = pts.map((p, j) => {
        const jump = j > 0 && +p.t - +pts[j - 1].t > gap
        broken ||= jump
        return `${!j || jump ? 'M' : 'L'}${x(+p.t).toFixed(1)},${y(p.v).toFixed(1)}`
      }).join('')
      for (const [j, p] of pts.entries())
        if ((j === 0 || +p.t - +pts[j - 1].t > gap) && (j === pts.length - 1 || +pts[j + 1].t - +p.t > gap))
          svg.append(s('circle', { cx: x(+p.t), cy: y(p.v), r: 2.5, style: `fill:${palette[i % 6]}` }))
      if (series.length === 1 && !broken)
        svg.append(s('path', { d: `${d}L${x(+pts[pts.length - 1].t).toFixed(1)},${y(0)}L${x(+pts[0].t).toFixed(1)},${y(0)}Z`, class: 'adm-area' }))
      svg.append(s('path', { d, class: 'adm-line', style: `stroke:${palette[i % 6]}` }))
    })
    if (!opts.compact) {
      const cursor = s('line', { y1: pad.t, y2: height - pad.b, class: 'adm-cursor', visibility: 'hidden' })
      svg.append(cursor)
      const stamps = [...new Set(all.map((p) => +p.t))].sort((a, b) => a - b)
      svg.addEventListener('pointermove', (event) => {
        const box = svg.getBoundingClientRect(),
          px = ((event.clientX - box.left) / box.width) * width,
          t = stamps.reduce((best, cur) => (Math.abs(x(cur) - px) < Math.abs(x(best) - px) ? cur : best), stamps[0])
        cursor.setAttribute('x1', String(x(t)))
        cursor.setAttribute('x2', String(x(t)))
        cursor.setAttribute('visibility', 'visible')
        tip.hidden = false
        tip.replaceChildren(h('b', null, when(new Date(t))),
          ...series.map((one, i) => {
            const point = one.points.find((p) => +p.t === t)
            return h('span', null, h('i', { style: `background:${palette[i % 6]}` }), series.length > 1 ? `${one.name} ` : '', point ? format(point.v) : dash)
          }))
        const left = (x(t) / width) * box.width
        tip.style.left = `${Math.min(Math.max(left, 70), box.width - 70)}px`
      })
      svg.addEventListener('pointerleave', () => {
        cursor.setAttribute('visibility', 'hidden')
        tip.hidden = true
      })
    }
    wrap.prepend(svg)
  }
  wrap.append(tip)
  if (legend) wrap.append(legend)
  new ResizeObserver(() => draw()).observe(wrap)
  requestAnimationFrame(draw)
  return wrap
}
function bars(rows: { label: string; value: number; note?: string }[], format: Fmt) {
  const max = Math.max(...rows.map((r) => r.value), 1)
  return h('ul', { class: 'adm-bars' },
    rows.map((row) =>
      h('li', null,
        h('span', { class: 'adm-bar-label', title: row.label }, row.label),
        h('span', { class: 'adm-bar-track' }, h('i', { style: `width:${Math.max(1.5, (row.value / max) * 100).toFixed(1)}%` })),
        h('span', { class: 'adm-bar-value' }, format(row.value), row.note && h('small', null, row.note)))))
}
type Point = { t: string; value: unknown; samples: unknown; group?: string }
const countMetrics = new Set(['online', 'visitors', 'newVisitors', 'sessions', 'contextLost', 'registrations', 'feedback', ...counters.map(([k]) => k)])
/** Count metrics: the API omits empty buckets, which are real zeros. */
function zeroFill(series: Series[], metric: string, bucket: string): Series[] {
  if (!countMetrics.has(metric)) return series
  const r = rangeWindow(), step = bucketMs[bucket]
  const start = Math.floor(Date.parse(r.from) / step) * step, end = Date.parse(r.to)
  return (series.length ? series : [{ name: '全部', points: [] }]).map((one) => {
    const have = new Map(one.points.map((p) => [+p.t, p.v]))
    const points: Series['points'] = []
    for (let t = start; t < end; t += step) points.push({ t: new Date(t), v: have.get(t) ?? 0 })
    return { ...one, points }
  })
}
function toSeries(rows: Point[], dim?: string): Series[] {
  const groups = new Map<string, Series>()
  for (const row of rows) {
    const v = num(row.value)
    if (v == null) continue
    const name = dim ? label(dim, row.group) : '全部'
    if (!groups.has(name)) groups.set(name, { name, points: [] })
    groups.get(name)!.points.push({ t: new Date(row.t), v })
  }
  return [...groups.values()]
}

/* ───────────── network: probe phases + exploration heat ───────────── */
const phaseNames = ['DNS 解析', 'TCP 建连', 'TLS 握手', '等待首字节', '下载']
const phaseColors = ['var(--adm-c5)', 'var(--adm-c6)', 'var(--adm-c3)', 'var(--adm-c2)', 'var(--adm-c1)']
type HeatCell = { gx: number; gz: number; visits: number; fps: number | null; chunk: number | null }
const heatMetrics: Record<string, { label: string; hint: string; value: (c: HeatCell) => number | null; fmt: Fmt; better: Better }> = {
  visits: { label: '访问量', hint: '去过这一格的会话数，看玩家往哪里走', value: (c) => c.visits, fmt: fmt.int, better: 'up' },
  fps: { label: '帧率', hint: '这一格帧率中位数，红色表示卡顿，看哪里渲染吃紧', value: (c) => c.fps, fmt: fmt.fps, better: 'up' },
  chunk: { label: '瓦片加载', hint: '这一格瓦片加载 p95，红色表示加载慢，看哪里流式加载跟不上', value: (c) => c.chunk, fmt: fmt.ms, better: 'down' },
}
const GRID = 250
/** Paper → jade for amounts; seal → ochre → jade for good/bad. t in [0,1], 1 = more / better. */
function heatColor(t: number, diverging: boolean) {
  const stops = diverging
    ? [[169, 80, 60], [196, 154, 74], [79, 127, 122]]
    : [[232, 222, 196], [143, 193, 181], [47, 74, 69]]
  const x = Math.min(1, Math.max(0, t)) * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x)), f = x - i
  const c = stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * f))
  return `rgb(${c.join(',')})`
}
type Place = { name: string; x: number; z: number }
function nearest(places: Place[], x: number, z: number) {
  let best: Place | null = null, dist = 600
  for (const p of places) {
    const d = Math.hypot(p.x - x, p.z - z)
    if (d < dist) (best = p), (dist = d)
  }
  return best?.name ?? null
}
function heatmap(rows: any[], key: string, extent?: number[], places: Place[] = []) {
  const metric = heatMetrics[key]
  const cells: HeatCell[] = rows.flatMap((row) => {
    const [gx, gz] = String(row.grid ?? '').split(',').map(Number)
    return Number.isFinite(gx) && Number.isFinite(gz)
      ? [{ gx, gz, visits: num(row.visits) ?? 0, fps: num(row.fps_p50), chunk: num(row.chunk_p95) }] : []
  })
  const values = cells.map(metric.value).filter((v): v is number => v != null).sort((a, b) => a - b)
  const wrap = h('div', { class: 'adm-heat' })
  if (!values.length) return emptyState(`这段时间没有「${metric.label}」数据`)
  // Fixed, readable domains: fps 20–60; chunk 0–p90 (min 1 s); visits sqrt scale to max.
  const lo = key === 'fps' ? 20 : 0
  const hi = key === 'fps' ? 60 : key === 'chunk' ? Math.max(1000, values[Math.floor(values.length * 0.9)]) : values[values.length - 1]
  const scale = (v: number) => {
    const t = key === 'visits' ? Math.sqrt(v) / Math.sqrt(Math.max(1, hi)) : (v - lo) / Math.max(1, hi - lo)
    return metric.better === 'down' ? 1 - t : t
  }
  const [ex, ez, ew, ed] = extent?.length === 4 ? extent : [0, 0, 0, 0]
  const xs = cells.map((c) => c.gx * GRID), zs = cells.map((c) => c.gz * GRID)
  const x0 = Math.min(ex || Infinity, ...xs), z0 = Math.min(ez || Infinity, ...zs)
  const x1 = Math.max(ex + ew, ...xs.map((x) => x + GRID)), z1 = Math.max(ez + ed, ...zs.map((z) => z + GRID))
  const svg = s('svg', { viewBox: `${x0} ${z0} ${x1 - x0} ${z1 - z0}`, class: 'adm-heat-map', role: 'img', 'aria-label': `探索热力：${metric.label}` })
  if (ew && ed) svg.append(s('image', { href: '/world/overview.png', x: ex, y: ez, width: ew, height: ed, preserveAspectRatio: 'none', class: 'adm-heat-base' }))
  const tip = h('div', { class: 'adm-tip', hidden: true })
  const layer = s('g', { class: 'adm-heat-cells' })
  for (const cell of cells) {
    const v = metric.value(cell)
    if (v == null) continue
    const rect = s('rect', { x: cell.gx * GRID + 6, y: cell.gz * GRID + 6, width: GRID - 12, height: GRID - 12, rx: 22, style: `fill:${heatColor(scale(v), key !== 'visits')}` })
    rect.addEventListener('pointerenter', () => {
      tip.hidden = false
      tip.replaceChildren(
        h('b', null, `${metric.label} ${metric.fmt(v)}`),
        h('span', null, `访问 ${fmt.int(cell.visits)} 会话`),
        h('span', null, `帧率 p50 ${fmt.fps(cell.fps)}`),
        h('span', null, `瓦片 p95 ${fmt.ms(cell.chunk)}`),
        h('span', null, h('small', null, `格子 ${cell.gx}, ${cell.gz}（东 ${cell.gx * GRID} m · 南 ${cell.gz * GRID} m）`)))
    })
    rect.addEventListener('pointermove', (event) => {
      const box = (svg.parentElement ?? wrap).getBoundingClientRect()
      tip.style.left = `${Math.min(Math.max(event.clientX - box.left, 90), box.width - 90)}px`
      tip.style.top = `${event.clientY - box.top + 18}px`
    })
    rect.addEventListener('pointerleave', () => (tip.hidden = true))
    layer.append(rect)
  }
  svg.append(layer)
  const ramp = Array.from({ length: 9 }, (_, i) => heatColor(i / 8, key !== 'visits')).join(',')
  const [low, high] = metric.better === 'down' ? [metric.fmt(hi), metric.fmt(lo)] : [metric.fmt(lo), metric.fmt(hi)]
  const covered = cells.filter((c) => metric.value(c) != null).length
  // Side list: the cells that matter most for this metric, named by the nearest landmark.
  const ranked = cells.filter((c) => metric.value(c) != null)
  const top = (key === 'fps' ? [...ranked].sort((a, b) => (a.fps ?? 0) - (b.fps ?? 0)) : key === 'chunk' ? [...ranked].sort((a, b) => (b.chunk ?? 0) - (a.chunk ?? 0)) : [...ranked].sort((a, b) => b.visits - a.visits)).filter((cell, i, all) => {
      // One row per place: keep the most significant cell near each landmark.
      const name = nearest(places, cell.gx * GRID + GRID / 2, cell.gz * GRID + GRID / 2)
      return !name || all.findIndex((other) => nearest(places, other.gx * GRID + GRID / 2, other.gz * GRID + GRID / 2) === name) === i
    }).slice(0, 10)
  const side = h('div', { class: 'adm-heat-side' },
    h('p', { class: 'adm-heat-side-title' }, key === 'visits' ? '去的人最多' : key === 'fps' ? '最卡的地方' : '加载最慢的地方'),
    h('ol', null, top.map((cell) => {
      const cx = cell.gx * GRID + GRID / 2, cz = cell.gz * GRID + GRID / 2
      const name = nearest(places, cx, cz)
      return h('li', null,
        h('i', { style: `background:${heatColor(scale(metric.value(cell)!), key !== 'visits')}` }),
        h('span', null, name ? `${name}附近` : `格子 ${cell.gx}, ${cell.gz}`, h('small', null, `${fmt.int(cell.visits)} 会话`)),
        h('b', null, metric.fmt(metric.value(cell))))
    })),
    h('p', { class: 'adm-sub' }, '名称取 600 m 内最近的地标；没有地标的格子显示网格坐标。'))
  wrap.append(h('div', { class: 'adm-heat-stage' }, svg, tip), side,
    h('div', { class: 'adm-heat-legend' },
      h('span', null, key === 'visits' ? '少' : '差'), h('i', { style: `background:linear-gradient(90deg,${ramp})` }), h('span', null, key === 'visits' ? '多' : '好'),
      h('small', null, `${low} — ${high} · ${covered} 个格子 · 上北下南`)))
  return wrap
}

/* ───────────── shell ───────────── */
function denied(status: number) {
  generation++
  clearInterval(refreshTimer)
  side.replaceChildren(brand())
  top.replaceChildren()
  main.replaceChildren(
    h('div', { class: 'adm-gatekeep' },
      h('div', { class: 'adm-seal' }, '管'),
      h('h2', null, status === 401 ? '请先登录' : '没有管理权限'),
      h('p', null, status === 401 ? '管理后台需要使用管理员账号登录。请回到游戏首页登录后再进入。' : `当前账号（${me?.email ?? '未知'}）不是管理员。请联系现有管理员在「用户与权限」中为你开通。`),
      h('a', { class: 'ui-btn ui-btn--seal', href: '/' }, '返回游戏首页')))
}
function brand() {
  return h('a', { class: 'adm-brand', href: '/', title: '返回游戏' }, h('span', { class: 'adm-brand-seal' }, '桂'), h('span', null, h('b', null, '网上桂林'), h('small', null, '管理后台')))
}
function paintSide() {
  const active = currentView()
  const groups = [...new Set(views.map((v) => v.group))]
  side.replaceChildren(
    brand(),
    h('nav', null,
      groups.map((group) => [
        h('p', { class: 'adm-nav-group' }, group),
        views.filter((v) => v.group === group).map((v) =>
          navLink([h('span', { class: 'adm-nav-icon', 'aria-hidden': 'true' }, v.icon), h('span', null, v.label),
            v.key === 'feedback' && pendingCount ? h('em', { class: 'adm-badge', title: '待处理反馈' }, pendingCount > 99 ? '99+' : pendingCount) : null],
          { view: v.key }, { class: `adm-nav-item ${v.key === active ? 'is-active' : ''}`, 'aria-current': v.key === active ? 'page' : undefined })),
      ])),
    h('div', { class: 'adm-me' },
      h('span', { class: 'adm-avatar', 'aria-hidden': 'true' }, (me.nickname || me.email).slice(0, 1).toUpperCase()),
      h('span', null, h('b', null, me.nickname || '管理员'), h('small', null, me.email)),
      h('a', { href: '/', class: 'adm-me-back', title: '返回游戏' }, '↩')))
}
function paintTop(view: View, extra?: Child | Child[]) {
  const r = rangeWindow()
  top.replaceChildren(
    h('div', { class: 'adm-title' }, h('h1', null, view.label), extra),
    view.ranged
      ? h('div', { class: 'adm-top-tools' },
          segmented(r.key, Object.entries(ranges).map(([k, v]) => [k, v.label]), (key) => go({ range: key }, true), '时间范围'),
          h('button', { type: 'button', class: 'adm-btn adm-btn--ghost adm-refresh', title: '刷新', onclick: (() => render()) as EventListener }, '↻ 刷新'))
      : h('div', { class: 'adm-top-tools' },
          h('button', { type: 'button', class: 'adm-btn adm-btn--ghost adm-refresh', title: '刷新', onclick: (() => render()) as EventListener }, '↻ 刷新')))
}
function refreshPending() {
  api<{ pending: number }>('admin/stats')
    .then((stats) => {
      pendingCount = num(stats.pending) ?? 0
      paintSide()
    })
    .catch(() => {})
}
function render() {
  generation++
  clearInterval(refreshTimer)
  document.querySelectorAll('dialog.adm-dialog').forEach((d) => d.remove())
  const key = currentView(),
    view = views.find((v) => v.key === key)!
  paintSide()
  paintTop(view)
  main.replaceChildren()
  main.scrollTop = 0
  window.scrollTo(0, 0)
  document.title = `${view.label} · 管理后台 · 网上桂林`
  const page = pages[key]
  page(view)
}

/* ───────────── pages ───────────── */
const pages: Record<string, (view: View) => void> = {
  overview() {
    const r = rangeWindow()
    const q = rangeQuery()
    const kpiSlot = h('div', { class: 'adm-stack' }),
      trendSlot = h('div'),
      funnelSlot = h('div'),
      liveSlot = h('div'),
      todoSlot = h('div')
    main.append(
      h('div', { class: 'adm-overview-top' },
        card('此刻', liveSlot, { className: 'adm-now', sub: '最近 5 分钟' }),
        card('待你处理', todoSlot, { className: 'adm-todo' })),
      kpiSlot,
      h('div', { class: 'adm-cols' },
        card('访客与会话', trendSlot, { sub: `按${r.bucket === '1d' ? '天' : r.bucket === '5m' ? ' 5 分钟' : '小时'}统计`, className: 'adm-span-2',
          actions: navLink('查看更多趋势 →', { view: 'trends' }, { class: 'adm-link' }) }),
        card('转化漏斗', funnelSlot, { sub: '按会话去重，百分比为占进入可操作的比例' })))
    async(liveSlot, () => api('admin/live'), (live: any) => {
      const online = num(live.online) ?? 0
      const modes = list<any>(live.modes).map((m) => ({ label: label('mode', m.mode), value: num(m.n) ?? 0 })).sort((a, b) => b.value - a.value)
      return [
        h('div', { class: 'adm-now-big' }, h('b', null, fmt.int(online)), h('span', null, '人在线')),
        modes.length
          ? h('p', { class: 'adm-now-modes' }, modes.map((m) => h('span', null, `${m.label} ${m.value}`)))
          : h('p', { class: 'adm-sub' }, '暂时没有人在游玩'),
        navLink('打开实时面板 →', { view: 'live' }, { class: 'adm-link' }),
      ]
    }, skeleton(2))
    async(todoSlot, () => api('admin/stats'), (stats: any) => {
      pendingCount = num(stats.pending) ?? 0
      paintSide()
      return [
        h('div', { class: 'adm-now-big' }, h('b', { class: pendingCount ? 'is-seal' : '' }, pendingCount), h('span', null, '条反馈待处理')),
        h('p', { class: 'adm-sub' }, `用户 ${fmt.int(num(stats.total))} · 24 小时新增 ${fmt.int(num(stats.new_24h))}`),
        navLink(pendingCount ? '去处理 →' : '查看反馈 →', { view: 'feedback' }, { class: 'adm-link' }),
      ]
    }, skeleton(2))
    async(kpiSlot, () => api<Record<string, { current: unknown; previous: unknown }>>('admin/overview?' + q), (data) =>
      kpiGroups.map(([group, keys]) =>
        h('section', { class: 'adm-kpi-group' },
          h('h2', null, group),
          h('div', { class: 'adm-kpis' }, keys.map((key) => kpiCard(key, data[key], r.label))))),
      skeleton(4, 'adm-skel--kpi'))
    async(trendSlot, () => Promise.all(['visitors', 'sessions'].map((metric) =>
      api<Point[]>('admin/timeseries?' + rangeQuery({ metric, bucket: r.bucket })))),
    ([visitors, sessions]) => {
      const series = [{ ...zeroFill(toSeries(list(visitors)), 'visitors', r.bucket)[0], name: '访客' }, { ...zeroFill(toSeries(list(sessions)), 'sessions', r.bucket)[0], name: '会话' }]
      return series.some((x) => x.points.some((p) => p.v)) ? lineChart(series, fmt.int, { bucket: r.bucket }) : emptyState('这段时间没有访问数据')
    }, skeleton(5))
    async(funnelSlot, () => api<{ step: string; sessions: unknown }[]>('admin/funnel?' + q), (rows) => {
      const items = list(rows)
      const first = num(items[0]?.sessions) || 0
      if (!first) return emptyState('还没有会话数据')
      return h('ol', { class: 'adm-funnel' },
        items.map((row, i) => {
          const n = num(row.sessions) ?? 0
          return h('li', null,
            h('div', { class: 'adm-funnel-bar', style: `width:${Math.max(3, (n / first) * 100).toFixed(1)}%` }),
            h('span', { class: 'adm-funnel-label' }, funnelText[row.step] ?? row.step),
            h('span', { class: 'adm-funnel-num' }, fmt.int(n), i ? h('small', { title: '占进入可操作会话的比例' }, ` ${fmt.pct(n / first)}`) : null))
        }))
    }, skeleton(5))
  },

  trends() {
    const r = rangeWindow()
    const metric = params.get('metric') ?? 'visitors',
      group = params.get('group') ?? '',
      info = metricInfo(metric)
    const groupable = !['online', 'registrations', 'feedback', 'api5xxRate'].includes(metric)
    const controls = h('div', { class: 'adm-toolbar' },
      h('label', null, h('span', null, '指标'),
        select('metric', metric, seriesCatalog.map((g) => ({ group: g.group, items: g.items.map(([k, m]) => [k, m.label] as [string, string]) })),
          (value) => go({ metric: value }, true), '指标')),
      h('label', null, h('span', null, '分组'),
        segmented(groupable ? group : '', [['', '不分组'], ['device', '按设备'], ['region', '按地区']],
          (value) => groupable && go({ group: value || null }, true), '分组')),
      !groupable && h('span', { class: 'adm-sub' }, '该指标没有设备与地区信息'))
    const slot = h('div')
    main.append(card(info.label, [controls, slot], { sub: info.hint ?? `${r.label} · 每${r.bucket === '1d' ? '天' : r.bucket === '5m' ? ' 5 分钟' : '小时'}一个点` }))
    async(slot, () => api<Point[]>('admin/timeseries?' + rangeQuery({ metric, bucket: r.bucket, ...(group && groupable ? { group } : {}) })), (rows) => {
      const series = zeroFill(toSeries(list(rows), group && groupable ? group : undefined), metric, r.bucket)
      if (!list(rows).length) return emptyState('这段时间没有数据', '换一个时间范围或指标试试')
      const values = series.flatMap((one) => one.points.map((p) => p.v))
      const total = list(rows).reduce((sum, row) => sum + (num(row.samples) ?? 0), 0)
      return [
        h('div', { class: 'adm-summary' },
          [['最新', series.length === 1 ? series[0].points.at(-1)!.v : null], ['最低', Math.min(...values)], ['最高', Math.max(...values)],
            ['平均', values.reduce((a, b) => a + b, 0) / values.length]].map(([name, v]) =>
            v == null ? null : h('div', null, h('span', null, name as string), h('b', null, info.fmt(v as number)))),
          h('div', null, h('span', null, '样本'), h('b', null, fmt.int(total)))),
        lineChart(series, info.fmt, { bucket: r.bucket, height: 300 }),
      ]
    }, skeleton(6))
  },

  breakdown() {
    const dim = params.get('dim') ?? 'region',
      metric = params.get('metric') ?? 'fps.p50'
    const base = metric.replace(/\.p(50|95)$/, '')
    const info = perfBase.find(([k]) => k === base)
    const f = info?.[2] ?? fmt.num
    const controls = h('div', { class: 'adm-toolbar' },
      h('label', null, h('span', null, '按'),
        select('dim', dim, dims, (value) => go({ dim: value }, true), '维度')),
      h('label', null, h('span', null, '看'),
        select('metric', base, perfBase.filter(([k]) => !k.startsWith('session.')).map(([k, l]) => [k, l]),
          (value) => go({ metric: value + '.p50' }, true), '指标')))
    const slot = h('div')
    main.append(card(`${info?.[1] ?? base} · 按${dims.find(([k]) => k === dim)?.[1]}`, [controls, slot], { sub: '按样本量排序；p50 为中位数，p95 为较差的 5%' }))
    async(slot, () => api<any[]>('admin/breakdown?' + rangeQuery({ dim, metric })), (rows) => {
      const items = list(rows)
      if (!items.length) return emptyState('这段时间没有数据')
      const maxSessions = Math.max(...items.map((row) => num(row.sessions) ?? 0), 1)
      const worse = info?.[3]
      const p95s = items.map((row) => num(row.p95)).filter((v): v is number => v != null).sort((a, b) => a - b)
      const bad = p95s.length > 3 ? (worse === 'up' ? p95s[Math.floor(p95s.length * 0.2)] : p95s[Math.ceil(p95s.length * 0.8) - 1]) : null
      return h('div', { class: 'adm-table-wrap' }, h('table', { class: 'adm-table' },
        h('thead', null, h('tr', null, h('th', null, dims.find(([k]) => k === dim)?.[1]), h('th', { class: 'adm-w-bar' }, '会话'), h('th', { class: 'num' }, '样本'), h('th', { class: 'num' }, 'p50'), h('th', { class: 'num' }, 'p95'))),
        h('tbody', null, items.map((row) => {
          const p95 = num(row.p95)
          const flagged = bad != null && p95 != null && (worse === 'up' ? p95 <= bad : p95 >= bad)
          return h('tr', null,
            h('td', null, label(dim, row.label)),
            h('td', null, h('span', { class: 'adm-inline-bar' }, h('i', { style: `width:${(((num(row.sessions) ?? 0) / maxSessions) * 100).toFixed(1)}%` })), h('small', null, fmt.int(num(row.sessions)))),
            h('td', { class: 'num' }, fmt.int(num(row.samples))),
            h('td', { class: 'num' }, f(num(row.p50))),
            h('td', { class: `num ${flagged ? 'is-bad' : ''}` }, f(p95)))
        }))))
    }, skeleton(8))
  },

  network() {
    const r = rangeWindow()
    const gap = Math.max(bucketMs[r.bucket] ?? 3600e3, 15 * 60e3)
    const kpis = h('div'), trend = h('div'), phases = h('div'), targets = h('div'), fails = h('div'),
      regions = h('div'), isps = h('div'), heat = h('div')
    const heatKey = Object.hasOwn(heatMetrics, params.get('heat') ?? '') ? params.get('heat')! : 'visits'
    main.append(
      h('p', { class: 'adm-note' }, '大陆探针每 15 分钟从广州、上海的腾讯云节点抓取首页、世界清单、5 个地形瓦片和接口，代表「没有缓存的新访客」。真实玩家的数据按 IP 归属地统计。'),
      kpis,
      h('div', { class: 'adm-cols' },
        card('大陆探针 · 首字节时间', trend, { className: 'adm-span-2', sub: '各节点所有目标的中位数；越低越好' }),
        card('一次请求的时间花在哪', phases, { sub: '各阶段中位数，按节点' })),
      h('div', { class: 'adm-cols' },
        card('各资源耗时', targets, { className: 'adm-span-2', sub: '总耗时 = 从发起请求到下载完毕' }),
        card('失败与超时', fails, { sub: '连接超时 5 秒或 HTTP 错误的占比' })),
      h('div', { class: 'adm-grid-2' },
        card('真实玩家 · 可玩用时按省份', regions, {
          sub: '中位数，从打开页面到可以操作',
          actions: navLink('更多维度 →', { view: 'breakdown', dim: 'region', metric: 'playable.p50' }, { class: 'adm-link' }, true),
        }),
        card('真实玩家 · 可玩用时按运营商', isps, { sub: '中位数' })),
      card('探索热力 · 250 m 网格', heat, {
        sub: heatMetrics[heatKey].hint,
        actions: segmented(heatKey, Object.entries(heatMetrics).map(([k, v]) => [k, v.label]), (value) => go({ heat: value }, true, true), '热力指标'),
      }))

    const breakdown = (metric: string, dim: string) => api<any[]>('admin/breakdown?' + rangeQuery({ dim, metric })).then((rows) => list(rows))
    const series = (metric: string) =>
      api<Point[]>('admin/timeseries?' + rangeQuery({ metric, bucket: r.bucket, group: 'node' })).then((rows) => list(rows))

    async(kpis, () => Promise.all([breakdown('probe.ttfb.p50', 'node'), breakdown('probe.total.p95', 'node'), series('probeFail')]), ([ttfb, total, fail]) => {
      if (!ttfb.length && !fail.length) return emptyState('这段时间没有探针数据', '探针每 15 分钟运行一次')
      const failRate = (node: string) => {
        const rows = fail.filter((row) => row.group === node)
        const n = rows.reduce((sum, row) => sum + (num(row.samples) ?? 0), 0)
        return n ? rows.reduce((sum, row) => sum + (num(row.value) ?? 0) * (num(row.samples) ?? 0), 0) / n : null
      }
      const nodes = [...new Set([...ttfb.map((row) => row.label), ...fail.map((row) => row.group)])].filter(Boolean).sort()
      return h('div', { class: 'adm-kpis adm-kpis--server' }, nodes.flatMap((node) => {
        const rate = failRate(node)
        return [
          serverStat(`${label('node', node)} · 首字节 p50`, fmt.ms(num(ttfb.find((row) => row.label === node)?.p50))),
          serverStat(`${label('node', node)} · 总耗时 p95`, fmt.ms(num(total.find((row) => row.label === node)?.p95))),
          serverStat(`${label('node', node)} · 失败率`, fmt.pct(rate), rate != null && rate > 0.05 ? '高于 5%，大陆访问不稳定' : undefined),
        ]
      }))
    }, skeleton(2))

    async(trend, () => series('probe.ttfb.p50'), (rows) => {
      const lines = toSeries(rows, 'node')
      return lines.length ? lineChart(lines, fmt.ms, { bucket: r.bucket, gap }) : emptyState('这段时间没有探针数据')
    }, skeleton(5))

    async(phases, () => Promise.all(['dns', 'tcp', 'tls', 'ttfb', 'total'].map((k) => breakdown(`probe.${k}.p50`, 'node'))), ([dns, tcp, tls, ttfb, total]) => {
      const nodes = [...new Set(total.map((row) => row.label))].sort()
      if (!nodes.length) return emptyState('这段时间没有探针数据')
      const at = (rows: any[], node: string) => num(rows.find((row) => row.label === node)?.p50) ?? 0
      const parts = nodes.map((node) => {
        const d = at(dns, node), c = at(tcp, node), t = at(tls, node), first = at(ttfb, node), all = at(total, node)
        return { node, all, segs: [d, c, t, Math.max(0, first - d - c - t), Math.max(0, all - first)] }
      })
      const max = Math.max(...parts.map((p) => p.segs.reduce((a, b) => a + b, 0)), 1)
      return h('div', { class: 'adm-phases' },
        parts.map((p) =>
          h('div', { class: 'adm-phase-row' },
            h('div', { class: 'adm-phase-head' }, h('b', null, label('node', p.node)), h('span', null, fmt.ms(p.segs.reduce((a, b) => a + b, 0)))),
            h('div', { class: 'adm-phase-bar' },
              p.segs.map((v, i) => v > 0 && h('i', { style: `width:${((v / max) * 100).toFixed(2)}%;background:${phaseColors[i]}`, title: `${phaseNames[i]} ${fmt.ms(v)}` }))))),
        h('div', { class: 'adm-legend' }, phaseNames.map((name, i) => h('span', null, h('i', { style: `background:${phaseColors[i]}` }), name))))
    }, skeleton(4))

    async(targets, () => Promise.all([breakdown('probe.ttfb.p50', 'target'), breakdown('probe.total.p50', 'target')]), ([ttfb, total]) => {
      if (!total.length) return emptyState('这段时间没有探针数据')
      const order = Object.keys(dimValue.target)
      const rows = [...total].sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label))
      const worst = Math.max(...rows.map((row) => num(row.p95) ?? 0))
      return h('div', { class: 'adm-table-wrap' }, h('table', { class: 'adm-table' },
        h('thead', null, h('tr', null, ['资源', '样本', '首字节 p50', '总耗时 p50', '总耗时 p95'].map((t, i) => h('th', { class: i ? 'num' : '' }, t)))),
        h('tbody', null, rows.map((row) => {
          const p95 = num(row.p95)
          return h('tr', null,
            h('td', null, label('target', row.label)),
            h('td', { class: 'num' }, fmt.int(num(row.samples))),
            h('td', { class: 'num' }, fmt.ms(num(ttfb.find((one) => one.label === row.label)?.p50))),
            h('td', { class: 'num' }, fmt.ms(num(row.p50))),
            h('td', { class: `num ${p95 != null && p95 >= 3000 && p95 === worst ? 'is-bad' : ''}` }, fmt.ms(p95)))
        }))))
    }, skeleton(6))

    async(fails, () => series('probeFail'), (rows) => {
      const lines = toSeries(rows, 'node')
      return lines.length ? lineChart(lines, fmt.pct, { bucket: r.bucket, gap, height: 180 }) : emptyState('这段时间没有探针数据')
    }, skeleton(4))

    const playable = (slot: HTMLElement, dim: string) =>
      async(slot, () => breakdown('playable.p50', dim), (rows) => {
        const items = rows.filter((row) => num(row.p50) != null).slice(0, 10)
        if (!items.length) return emptyState('这段时间还没有真实玩家数据')
        return bars(items.map((row) => ({ label: label(dim, row.label), value: num(row.p50)!, note: `${fmt.int(num(row.sessions) ?? num(row.samples))} 会话` })), fmt.ms)
      }, skeleton(5))
    playable(regions, 'region')
    playable(isps, 'isp')

    async(heat, () => Promise.all([
      api<any[]>('admin/perf/grid?' + rangeQuery()).then((rows) => list(rows)),
      fetch('/world/manifest.json', { cache: 'no-store' }).then((res) => (res.ok ? res.json() : null)).catch(() => null),
    ]), ([cells, manifest]) => {
      if (!cells.length) return emptyState('这段时间没有带位置的玩家数据')
      const places: Place[] = [
        ...(manifest?.landmarks ?? []).map((l: any) => ({ name: l.name, x: l.position?.[0], z: l.position?.[2] })),
        ...(manifest?.peaks?.entries ?? []).map((p: any) => ({ name: p.name, x: p.center?.[0], z: p.center?.[2] })),
      ].filter((p) => p.name && !/^auto-/.test(p.name) && Number.isFinite(p.x) && Number.isFinite(p.z))
      return heatmap(cells, heatKey, manifest?.extent, places)
    }, skeleton(8))
  },

  errors() {
    const r = rangeWindow()
    const chart = h('div'),
      reliability = h('div'),
      slot = h('div')
    main.append(
      h('div', { class: 'adm-cols' },
        card('出错会话占比', chart, { className: 'adm-span-2' }),
        card('加载失败与重试', reliability, { sub: r.label })),
      card('错误签名 Top 50', slot, { sub: '只记录文件名+行号生成的签名，不含错误原文' }))
    async(chart, () => api<Point[]>('admin/timeseries?' + rangeQuery({ metric: 'errorRate', bucket: r.bucket })), (rows) => {
      const series = toSeries(list(rows))
      return series.length ? lineChart(series, fmt.pct, { bucket: r.bucket }) : emptyState('这段时间没有错误数据')
    }, skeleton(5))
    async(reliability, () => Promise.all(counters.map(([metric]) => api<Point[]>('admin/timeseries?' + rangeQuery({ metric, bucket: '1d' })))), (all) =>
      bars(counters.map(([, name], i) => ({ label: name, value: list(all[i]).reduce((sum, row) => sum + (num(row.value) ?? 0), 0) })), fmt.int), skeleton(6))
    async(slot, () => api<any[]>('admin/errors?' + rangeQuery()), (rows) => {
      const items = list(rows)
      if (!items.length) return emptyState('没有错误 🎉', '这段时间没有带签名的错误上报')
      const kinds: Record<string, string> = { error: '脚本错误', rejection: '未处理 Promise', webgl: 'WebGL', chunk: '瓦片' }
      return h('div', { class: 'adm-table-wrap' }, h('table', { class: 'adm-table' },
        h('thead', null, h('tr', null, ['类型', '签名', '版本', '次数', '影响会话', '首次', '最近'].map((t, i) => h('th', { class: i >= 3 && i <= 4 ? 'num' : '' }, t)))),
        h('tbody', null, items.map((row) =>
          h('tr', null,
            h('td', null, h('span', { class: `adm-pill adm-kind--${row.kind}` }, kinds[row.kind] ?? row.kind ?? '未知')),
            h('td', null, h('code', null, row.signature ?? dash)),
            h('td', null, h('code', null, String(row.build ?? dash).slice(0, 7))),
            h('td', { class: 'num' }, fmt.int(num(row.count))),
            h('td', { class: 'num' }, fmt.int(num(row.sessions))),
            h('td', null, when(iso(row.first))),
            h('td', null, ago(iso(row.last))))))))
    }, skeleton(6))
  },

  live() {
    const slot = h('div')
    const stamp = h('span', { class: 'adm-sub adm-live-stamp' })
    paintTop(views.find((v) => v.key === 'live')!, [h('span', { class: 'adm-live-dot', 'aria-hidden': 'true' }), stamp])
    main.append(slot)
    const mine = generation
    const load = (first: boolean) =>
      api('admin/live').then((live: any) => {
        if (mine !== generation) return
        stamp.textContent = `每 15 秒自动刷新 · ${when(new Date())}`
        slot.replaceChildren(paintLive(live))
      }).catch((error) => {
        if (mine !== generation) return
        if (error instanceof ApiError && [401, 403].includes(error.status)) return denied(error.status)
        if (first) slot.replaceChildren(errorState(error, () => load(true)))
        else stamp.textContent = `自动刷新失败：${error.message}`
      })
    slot.append(skeleton(6))
    load(true)
    refreshTimer = window.setInterval(() => document.visibilityState === 'visible' && load(false), 15000)
  },

  server() {
    const r = rangeWindow()
    const capped = r.ms > 7 * 86400e3
    const from = capped ? new Date(Date.parse(r.to) - 7 * 86400e3).toISOString() : r.from
    const slot = h('div', { class: 'adm-stack' })
    if (capped) main.append(h('p', { class: 'adm-note' }, '服务端分钟数据量较大，此页最多显示最近 7 天。'))
    main.append(slot)
    async(slot, () => api<any>('admin/perf/server?' + new URLSearchParams({ from, to: r.to })), (result) => {
      const rows = list<any>(result).map((row) => ({ t: new Date(row.minute), s: typeof row.sample === 'string' ? JSON.parse(row.sample) : row.sample ?? {} }))
      if (!rows.length) return emptyState('这段时间没有服务端采样')
      // 降采样：每个点取桶内最大值（看峰值更有用）。
      const step = r.ms <= 3600e3 ? 60e3 : r.ms <= 86400e3 ? 10 * 60e3 : 3600e3
      const metric = (pick: (s: any) => number | null | undefined): Series[] => {
        const buckets = new Map<number, number>()
        for (const row of rows) {
          const v = pick(row.s)
          if (v == null || Number.isNaN(v)) continue
          const key = Math.floor(+row.t / step) * step
          buckets.set(key, Math.max(buckets.get(key) ?? -Infinity, v))
        }
        return [{ name: '', points: [...buckets].map(([t, v]) => ({ t: new Date(t), v })) }]
      }
      const routes = new Map<string, { route: string; count: number; errors: number; p95: number; p99: number }>()
      for (const row of rows)
        for (const route of row.s.routes ?? []) {
          const key = route.route
          const cur = routes.get(key) ?? { route: key, count: 0, errors: 0, p95: 0, p99: 0 }
          cur.count += route.count
          cur.errors += route.errors
          cur.p95 = Math.max(cur.p95, route.p95 ?? 0)
          cur.p99 = Math.max(cur.p99, route.p99 ?? 0)
          routes.set(key, cur)
        }
      const opts = { bucket: step >= 3600e3 ? '1h' : '5m', height: 160, gap: step }
      const latest = rows[rows.length - 1].s
      return [
        h('div', { class: 'adm-kpis adm-kpis--server' },
          serverStat('CPU', fmt.cores(latest.cpuCores), '进程占用单核比例'),
          serverStat('进程内存', fmt.bytes(latest.rss)),
          serverStat('容器内存', fmt.bytes(latest.cgroupMemory)),
          serverStat('事件循环 p99', fmt.ms(latest.loopP99)),
          serverStat('数据库 p95', fmt.ms(latest.pgP95)),
          serverStat('系统负载', latest.load ? latest.load[0].toFixed(2) : dash, latest.load ? `5 / 15 分钟：${latest.load[1].toFixed(2)} / ${latest.load[2].toFixed(2)}` : undefined),
          serverStat('nginx 连接', fmt.int(latest.nginx?.connections ?? null))),
        h('div', { class: 'adm-grid-2' },
          card('CPU（峰值）', lineChart(metric((s) => s.cpuCores), fmt.cores, opts)),
          card('进程内存（峰值）', lineChart(metric((s) => s.rss), fmt.bytes, opts)),
          card('事件循环延迟 p99', lineChart(metric((s) => s.loopP99), fmt.ms, opts)),
          card('数据库查询 p95', lineChart(metric((s) => s.pgP95), fmt.ms, opts))),
        card('接口', routes.size
          ? h('div', { class: 'adm-table-wrap' }, h('table', { class: 'adm-table' },
              h('thead', null, h('tr', null, ['路由', '请求数', '错误', '错误率', '最差 p95', '最差 p99'].map((t, i) => h('th', { class: i ? 'num' : '' }, t)))),
              h('tbody', null, [...routes.values()].sort((a, b) => b.count - a.count).map((route) =>
                h('tr', null,
                  h('td', null, h('code', null, route.route)),
                  h('td', { class: 'num' }, fmt.int(route.count)),
                  h('td', { class: 'num' }, fmt.int(route.errors)),
                  h('td', { class: `num ${route.errors / route.count > 0.05 ? 'is-bad' : ''}` }, fmt.pct(route.errors / route.count)),
                  h('td', { class: 'num' }, fmt.ms(route.p95)),
                  h('td', { class: 'num' }, fmt.ms(route.p99)))))))
          : emptyState('这段时间没有接口请求'), { sub: '按请求数排序，错误为 HTTP ≥ 400' }),
      ]
    }, skeleton(8))
  },

  feedback() {
    const id = params.get('id')
    if (id) return feedbackDetail(id)
    const status = params.get('status') ?? 'pending',
      query = params.get('q') ?? '',
      user = params.get('user')
    const tabs = h('div', { class: 'adm-tabs', role: 'tablist' })
    const search = h('input', { type: 'search', name: 'q', value: query, placeholder: '搜索标题、正文或提交人', 'aria-label': '搜索反馈' })
    const form = h('form', { class: 'adm-search', role: 'search' }, search, h('button', { class: 'adm-btn', type: 'submit' }, '搜索'))
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      go({ q: search.value.trim() || null, cursor: null }, true)
    })
    const slot = h('div')
    append(main, [
      h('div', { class: 'adm-toolbar adm-toolbar--split' }, tabs, form),
      user && h('p', { class: 'adm-note' }, '只看某位提交人的反馈。', navLink('清除筛选', { view: 'feedback', status }, { class: 'adm-link' })),
      card(null, slot, { className: 'adm-card--flush' })])
    const paintTabs = (stats?: any) => {
      const counts = stats?.feedback ?? {}
      const entries: [string, string, number | null][] = [
        ['pending', '待处理', stats ? num(stats.pending) : null],
        ['', '全部', stats ? Object.values(counts).reduce<number>((a, b) => a + (num(b) ?? 0), 0) : null],
        ...Object.entries(labels).filter(([k]) => k !== 'draft').map(([k, l]) => [k, l, stats ? num(counts[k]) ?? 0 : null] as [string, string, number | null]),
      ]
      tabs.replaceChildren(...entries.map(([key, text, n]) =>
        navLink([text, n != null ? h('em', null, n) : null], { view: 'feedback', status: key, q: query || null, user }, {
          class: `adm-tab ${status === key ? 'is-on' : ''} ${key === 'pending' && n ? 'is-alert' : ''}`, role: 'tab', 'aria-selected': String(status === key),
        })))
    }
    paintTabs()
    api('admin/stats').then((stats) => {
      pendingCount = num(stats.pending) ?? 0
      paintSide()
      paintTabs(stats)
    }).catch(() => {})
    const rowsOf = (items: any[]) => items.map((item) =>
      h('tr', { class: 'adm-row-link', onclick: ((event: MouseEvent) => {
        if ((event.target as HTMLElement).closest('a')) return
        go({ view: 'feedback', id: item.id })
      }) as EventListener },
      h('td', null,
        navLink(item.title, { view: 'feedback', id: item.id }, { class: 'adm-row-title' }),
        num(item.unread) ? h('em', { class: 'adm-unread' }, `${item.unread} 条新回复`) : null,
        h('small', { class: 'adm-row-sub' }, `${item.kind ?? ''} · ${num(item.photo_count) ?? 0} 张照片`)),
      h('td', null, pill(item.status)),
      h('td', null, h('span', { class: 'adm-who' }, h('b', null, item.nickname), h('small', null, item.email))),
      h('td', null, when(unix(item.submitted_at))),
      h('td', null, ago(unix(item.updated_at)))))
    const body = h('tbody')
    const more = h('div', { class: 'adm-more' })
    const load = (cursor?: string) => {
      const q = new URLSearchParams()
      if (status) q.set('status', status)
      if (query) q.set('q', query)
      if (user) q.set('user', user)
      if (cursor) q.set('cursor', cursor)
      return api<{ items: any[]; next_cursor: string | null }>('admin/feedback?' + q)
    }
    const paintMore = (next: string | null) => {
      more.replaceChildren()
      if (!next) return
      const button = h('button', { class: 'adm-btn adm-btn--ghost', type: 'button' }, '加载更多')
      button.addEventListener('click', () => act(button, async () => {
        const page = await load(next)
        body.append(...rowsOf(page.items))
        paintMore(page.next_cursor)
      }))
      more.append(button)
    }
    async(slot, () => load(), (page) => {
      if (!page.items.length)
        return emptyState(status === 'pending' ? '没有待处理的反馈' : '没有符合条件的反馈', status === 'pending' ? '新的反馈提交后会出现在这里' : undefined)
      body.append(...rowsOf(page.items))
      paintMore(page.next_cursor)
      return [h('div', { class: 'adm-table-wrap' }, h('table', { class: 'adm-table' },
        h('thead', null, h('tr', null, ['反馈', '状态', '提交人', '提交时间', '最近更新'].map((t) => h('th', null, t)))), body)), more]
    }, skeleton(8))
  },

  users() {
    const detailId = params.get('id')
    if (detailId) return userDetail(detailId)
    const role = params.get('role') ?? '',
      query = params.get('q') ?? ''
    const statsSlot = h('div', { class: 'adm-kpis adm-kpis--small' })
    const search = h('input', { type: 'search', name: 'q', value: query, placeholder: '搜索邮箱或昵称', 'aria-label': '搜索用户' })
    const form = h('form', { class: 'adm-search', role: 'search' }, search, h('button', { class: 'adm-btn', type: 'submit' }, '搜索'))
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      go({ q: search.value.trim() || null }, true)
    })
    const slot = h('div')
    main.append(statsSlot,
      h('div', { class: 'adm-toolbar adm-toolbar--split' },
        segmented(role, [['', '全部'], ['admin', '管理员'], ['user', '普通用户']], (value) => go({ role: value || null }, true), '角色'), form),
      card(null, slot, { className: 'adm-card--flush' }),
      h('p', { class: 'adm-note' }, '管理员可以查看全部数据、处理反馈和调整他人身份。只有已验证邮箱的用户才能设为管理员；系统始终保留至少一位管理员。'))
    async(statsSlot, () => Promise.all([api('admin/stats'), api<any>('admin/users?role=admin')]), ([stats, admins]) => [
      serverStat('用户总数', fmt.int(num(stats.total))),
      serverStat('已验证邮箱', fmt.int(num(stats.verified))),
      serverStat('24 小时新增', fmt.int(num(stats.new_24h))),
      serverStat('管理员', admins.next_cursor ? '50+' : fmt.int(list<any>(admins).length)),
    ], skeleton(1, 'adm-skel--kpi'))
    const body = h('tbody'),
      more = h('div', { class: 'adm-more' })
    const load = (cursor?: string) => {
      const q = new URLSearchParams()
      if (role) q.set('role', role)
      if (query) q.set('q', query)
      if (cursor) q.set('cursor', cursor)
      return api<{ items: any[]; next_cursor: string | null }>('admin/users?' + q)
    }
    const row = (user: any): HTMLTableRowElement => {
      const self = user.id === me.id,
        admin = user.role === 'admin'
      const button = h('button', {
        type: 'button',
        class: `adm-btn ${admin ? 'adm-btn--ghost' : 'adm-btn--jade'}`,
        disabled: (!admin && !user.verified) || (admin && self),
        title: !admin && !user.verified ? '该用户尚未验证邮箱' : admin && self ? '不能取消自己的管理员身份' : undefined,
      }, admin ? '取消管理员' : '设为管理员')
      button.addEventListener('click', () => act(button, async () => {
        const target = admin ? 'user' : 'admin'
        const ok = await confirmDialog({
          title: admin ? '取消管理员身份' : '设为管理员',
          tone: admin ? 'seal' : 'jade',
          confirm: admin ? '确认取消' : '确认设为管理员',
          body: h('div', null,
            h('p', null, h('b', null, user.nickname || user.email), `（${user.email}）`),
            h('p', null, admin ? '取消后 TA 将无法再进入管理后台、处理反馈或修改他人身份。' : '设为管理员后，TA 可以查看全部遥测数据、处理反馈，并能设置或取消其他人的管理员身份。'),
            h('p', { class: 'adm-sub' }, '此操作会记录在「操作记录」中。')),
        })
        if (ok == null) return
        const result = await api<{ id: string; role: string }>(`admin/users/${encodeURIComponent(user.id)}/role`, { role: target })
        toast(result.role === 'admin' ? `已将 ${user.nickname || user.email} 设为管理员` : `已取消 ${user.nickname || user.email} 的管理员身份`)
        const fresh = row({ ...user, role: result.role })
        current.replaceWith(fresh)
        current = fresh
      }))
      let current = h('tr', null,
        h('td', null, h('span', { class: 'adm-who' },
          h('b', null, navLink(user.nickname || '（未设置昵称）', { view: 'users', id: user.id }, { class: 'adm-link' }), self ? h('em', { class: 'adm-you' }, '你') : null),
          h('small', null, user.email))),
        h('td', null, h('span', { class: `adm-pill ${user.verified ? 'adm-ok' : 'adm-muted'}` }, user.verified ? '已验证' : '未验证')),
        h('td', null, h('span', { class: `adm-pill ${admin ? 'adm-role--admin' : 'adm-muted'}` }, admin ? '管理员' : '用户')),
        h('td', null, when(unix(user.created_at), true)),
        h('td', { class: 'num' }, num(user.feedback_count) ? navLink(fmt.int(num(user.feedback_count)), { view: 'feedback', status: '', user: user.id }, { class: 'adm-link' }) : '0'),
        h('td', null, ago(unix(user.last_submitted_at))),
        h('td', { class: 'adm-actions' }, button))
      return current
    }
    const paintMore = (next: string | null) => {
      more.replaceChildren()
      if (!next) return
      const button = h('button', { class: 'adm-btn adm-btn--ghost', type: 'button' }, '加载更多')
      button.addEventListener('click', () => act(button, async () => {
        const page = await load(next)
        body.append(...page.items.map(row))
        paintMore(page.next_cursor)
      }))
      more.append(button)
    }
    async(slot, () => load(), (page) => {
      if (!page.items.length) return emptyState('没有符合条件的用户')
      body.append(...page.items.map(row))
      paintMore(page.next_cursor)
      return [h('div', { class: 'adm-table-wrap' }, h('table', { class: 'adm-table' },
        h('thead', null, h('tr', null, ['用户', '邮箱', '身份', '注册时间', '反馈', '最近提交', ''].map((t, i) => h('th', { class: i === 4 ? 'num' : '' }, t)))), body)), more]
    }, skeleton(8))
  },

  audit() {
    const type = params.get('target_type') ?? ''
    const slot = h('div')
    main.append(
      h('div', { class: 'adm-toolbar' }, segmented(type, [['', '全部'], ['user', '身份变更'], ['feedback', '反馈处理']], (value) => go({ target_type: value || null }, true), '对象类型')),
      card(null, slot, { className: 'adm-card--flush' }))
    const people = new Map<string, any>()
    const actions: Record<string, string> = { role: '调整身份', status: '变更状态', start_ai: '发起 AI 制作', reply: '回复提交人' }
    const body = h('tbody'),
      more = h('div', { class: 'adm-more' })
    const load = (cursor?: string) => {
      const q = new URLSearchParams()
      if (type) q.set('target_type', type)
      if (cursor) q.set('cursor', cursor)
      return api<{ items: any[]; next_cursor: string | null }>('admin/audit?' + q)
    }
    const who = (id: string) => {
      const p = people.get(id)
      return p ? h('span', { class: 'adm-who' }, h('b', null, p.nickname || p.email), h('small', null, p.email)) : h('code', null, String(id).slice(0, 8))
    }
    const rowsOf = (items: any[]) => items.map((item) => {
      const detail = typeof item.detail === 'string' ? JSON.parse(item.detail || '{}') : item.detail ?? {}
      const what =
        item.action === 'role' ? (detail.role === 'admin' ? '设为管理员' : '取消管理员')
        : item.action === 'status' || item.action === 'start_ai' ? h('span', { class: 'adm-flow' }, detail.from ? pill(detail.from) : null, '→', detail.to ? pill(detail.to) : null)
        : ''
      const target = item.target_type === 'feedback'
        ? navLink('查看反馈', { view: 'feedback', id: item.target_id }, { class: 'adm-link' })
        : item.target_type === 'user' ? who(item.target_id) : h('code', null, item.target_id)
      return h('tr', null,
        h('td', null, when(unix(item.created_at), true)),
        h('td', null, who(item.actor_id)),
        h('td', null, actions[item.action] ?? item.action),
        h('td', null, what),
        h('td', null, target))
    })
    const paintMore = (next: string | null) => {
      more.replaceChildren()
      if (!next) return
      const button = h('button', { class: 'adm-btn adm-btn--ghost', type: 'button' }, '加载更多')
      button.addEventListener('click', () => act(button, async () => {
        const page = await load(next)
        body.append(...rowsOf(page.items))
        paintMore(page.next_cursor)
      }))
      more.append(button)
    }
    async(slot, async () => {
      const [page, admins] = await Promise.all([load(), api<any>('admin/users?role=admin').catch(() => ({ items: [] }))])
      for (const p of list<any>(admins)) people.set(p.id, p)
      // Role targets may be ordinary users: resolve those we can see on the first users page.
      const missing = page.items.some((item: any) => item.target_type === 'user' && !people.has(item.target_id))
      if (missing) for (const p of list<any>(await api<any>('admin/users').catch(() => ({ items: [] })))) people.set(p.id, p)
      return page
    }, (page) => {
      if (!page.items.length) return emptyState('还没有操作记录', '设置管理员、变更反馈状态、发起制作和回复都会记在这里')
      body.append(...rowsOf(page.items))
      paintMore(page.next_cursor)
      return [h('div', { class: 'adm-table-wrap' }, h('table', { class: 'adm-table' },
        h('thead', null, h('tr', null, ['时间', '操作人', '动作', '变化', '对象'].map((t) => h('th', null, t)))), body)), more]
    }, skeleton(8))
  },
}

function kpiCard(key: string, value: { current: unknown; previous: unknown } | undefined, rangeLabel: string) {
  const info = kpis[key]
  const cur = num(value?.current),
    prev = num(value?.previous)
  let delta: Child = h('span', { class: 'adm-delta' }, '无对比')
  if (cur != null && prev != null) {
    if (prev === 0 && cur === 0) delta = h('span', { class: 'adm-delta' }, '持平')
    else if (prev === 0) delta = h('span', { class: 'adm-delta' }, '上期为 0')
    else {
      const change = (cur - prev) / Math.abs(prev)
      const good = info.better === 'up' ? change > 0 : info.better === 'down' ? change < 0 : null
      delta = h('span', { class: `adm-delta ${Math.abs(change) < 0.005 ? '' : good ? 'is-good' : 'is-bad'}`, title: `上一个 ${rangeLabel}：${info.fmt(prev)}` },
        Math.abs(change) < 0.005 ? '持平' : `${change > 0 ? '↑' : '↓'} ${Math.abs(change * 100).toFixed(Math.abs(change) < 0.1 ? 1 : 0)}%`)
    }
  }
  return navLink(
    [h('span', { class: 'adm-kpi-label', title: info.hint }, info.label), h('b', null, info.fmt(cur)), delta],
    { view: 'trends', metric: key, group: null },
    { class: 'adm-kpi', title: `${info.hint ? info.hint + '。' : ''}点击查看趋势` }, true)
}
function serverStat(name: string, value: string, hint?: string) {
  return h('div', { class: 'adm-kpi adm-kpi--static', title: hint }, h('span', { class: 'adm-kpi-label' }, name), h('b', null, value), hint && h('span', { class: 'adm-delta' }, hint))
}
function paintLive(live: any) {
  const online = num(live.online) ?? 0
  const modes = list<any>(live.modes).map((m) => ({ label: label('mode', m.mode), value: num(m.n) ?? 0 })).sort((a, b) => b.value - a.value)
  const regions = list<any>(live.regions).map((m) => ({ label: label('region', m.region), value: num(m.n) ?? 0 })).sort((a, b) => b.value - a.value).slice(0, 12)
  const server = live.server
  const sample = server ? (typeof server.sample === 'string' ? JSON.parse(server.sample) : server.sample) ?? {} : null
  return h('div', { class: 'adm-live' },
    h('div', { class: 'adm-cols' },
      card('在线人数', [h('div', { class: 'adm-now-big adm-now-big--xl' }, h('b', null, fmt.int(online)), h('span', null, '人')), h('p', { class: 'adm-sub' }, '最近 5 分钟内有活动的会话')]),
      card('正在做什么', modes.length ? bars(modes, fmt.int) : emptyState('暂无在线玩家')),
      card('来自哪里', regions.length ? bars(regions, fmt.int) : emptyState('暂无在线玩家'))),
    card('服务端（最近一分钟）', sample
      ? h('div', { class: 'adm-kpis adm-kpis--server' },
          serverStat('CPU', fmt.cores(num(sample.cpuCores))),
          serverStat('进程内存', fmt.bytes(num(sample.rss))),
          serverStat('容器内存', fmt.bytes(num(sample.cgroupMemory))),
          serverStat('事件循环 p99', fmt.ms(num(sample.loopP99))),
          serverStat('数据库 p95', fmt.ms(num(sample.pgP95))),
          serverStat('等待连接', fmt.int(num(sample.poolWaiting))),
          serverStat('5xx', fmt.int(num(server.errors5xx) ?? 0)),
          serverStat('系统负载', sample.load ? Number(sample.load[0]).toFixed(2) : dash, sample.load ? `5 / 15 分钟：${Number(sample.load[1]).toFixed(2)} / ${Number(sample.load[2]).toFixed(2)}` : undefined))
      : emptyState('最近一分钟没有服务端采样', 'API 每分钟写一次；刚重启时会短暂为空'),
      { sub: server ? `采样时间 ${when(iso(server.minute))}` : undefined }))
}

const socialBrand: Record<string, string> = {
  qq: '#12b7f5', wx: '#07c160', alipay: '#1677ff', douyin: '#111111',
  google: '#4285f4', twitter: '#1d9bf0', feishu: '#3370ff',
}
type SocialIdentity = {
  type: string; label: string; nickname: string; avatar: string; uid: string
  created_at: number; last_login_at: number
}
/** 一个已绑定平台：平台名、平台上的用户名、平台头像。头像只来自后端白名单域名。 */
function bindingCard(identity: SocialIdentity) {
  const initial = String(identity.label || '?').slice(0, 1)
  const avatar = h('span', { class: 'adm-bind-avatar' }, initial)
  if (identity.avatar) {
    const image = h('img', {
      src: identity.avatar,
      alt: `${identity.label} 头像`,
      loading: 'lazy',
      referrerpolicy: 'no-referrer',
      onerror: () => avatar.replaceChildren(initial),
    })
    avatar.replaceChildren(image)
  }
  return h('div', { class: 'adm-bind' },
    h('span', { class: 'adm-bind-badge', style: `background:${socialBrand[identity.type] ?? '#5d655f'}` },
      socialIcon(identity.type) ?? '', identity.label),
    h('div', { class: 'adm-bind-body' },
      h('b', null, identity.nickname || '（无昵称）'),
      h('span', { class: 'adm-bind-sub' },
        `${identity.label} · UID ${identity.uid} · 绑定 ${when(unix(identity.created_at), true)} · 最近登录 ${ago(unix(identity.last_login_at))}`)),
    avatar)
}
/** 用户详情：账号信息 + 已绑定的第三方平台（只读）。 */
function mergeCard(target: { id: string; email: string }) {
  const input = h('input', { class: 'adm-merge-input', placeholder: '被合并账号的邮箱或 ID' }) as HTMLInputElement
  const button = h('button', { type: 'button', class: 'adm-btn' }, '合并到这个账号') as HTMLButtonElement
  button.onclick = () => void act(button, async () => {
    const from = input.value.trim()
    if (!from) throw new Error('请填写被合并账号的邮箱或 ID')
    const answer = await confirmDialog({
      title: '确认合并账号',
      tone: 'seal',
      confirm: '确认合并',
      body: h('p', null,
        `把「${from}」并入「${target.email || target.id}」？第三方绑定、存档、流水、反馈都会搬过来，被合并的账号随后删除，操作不可撤销。`),
    })
    if (answer === null) return
    const result = await api<{ moved: string[]; conflicts: string[]; adopted_email: string }>(
      `admin/users/${encodeURIComponent(target.id)}/merge`, { from })
    const parts = [`已合并 ${result.moved.length} 个平台绑定`]
    if (result.adopted_email) parts.push(`继承了邮箱 ${result.adopted_email}`)
    if (result.conflicts.length) parts.push(`跳过冲突平台 ${result.conflicts.join('/')}`)
    toast(parts.join('，'))
    location.reload()
  })
  return h('div', { class: 'adm-merge' },
    h('h3', { class: 'adm-section-title' }, '合并账号'),
    h('p', { class: 'adm-sub' }, '把另一个重复账号（同一人先用第三方注册、后来又用邮箱注册）并进当前账号。'),
    h('div', { class: 'adm-merge-row' }, input, button))
}
function userDetail(id: string) {
  const slot = h('div')
  main.append(
    h('div', { class: 'adm-toolbar' }, navLink('← 返回用户列表', { view: 'users', id: null }, { class: 'adm-btn adm-btn--ghost' })),
    card(null, slot))
  async(slot, () => api<{ user: any; social: SocialIdentity[] }>(`admin/users/${encodeURIComponent(id)}`), (data) => {
    const user = data.user,
      social = data.social ?? []
    return [
      h('div', { class: 'adm-user-head' },
        h('h2', null, user.nickname || '（未设置昵称）'),
        h('p', { class: 'adm-sub' },
          `${user.email} · ${user.role === 'admin' ? '管理员' : '普通用户'} · ${user.verified ? '邮箱已验证' : '邮箱未验证'}`)),
      h('dl', { class: 'adm-kv' },
        h('dt', null, '注册时间'), h('dd', null, when(unix(user.created_at), true)),
        h('dt', null, '反馈数'), h('dd', null, num(user.feedback_count)
          ? navLink(fmt.int(num(user.feedback_count)), { view: 'feedback', status: '', user: user.id }, { class: 'adm-link' })
          : '0'),
        h('dt', null, '最近提交'), h('dd', null, ago(unix(user.last_submitted_at)))),
      h('h3', { class: 'adm-section-title' }, `绑定的平台（${social.length}）`),
      social.length
        ? h('div', { class: 'adm-binds' }, ...social.map(bindingCard))
        : emptyState('尚未绑定任何第三方平台', '用户在账号面板完成绑定后会出现在这里'),
      mergeCard({ id: user.id, email: user.email }),
    ]
  }, skeleton(3))
}
function feedbackDetail(id: string) {
  const path = 'admin/feedback/' + encodeURIComponent(id)
  paintTop(views.find((v) => v.key === 'feedback')!, navLink('← 返回列表', { view: 'feedback' }, { class: 'adm-link adm-back' }))
  const slot = h('div')
  main.append(slot)
  async(slot, () => api<any>(path), (item) => {
    document.title = `${item.title} · 反馈 · 管理后台`
    const transitions: { status: string; label: string; needs_message: boolean }[] = item.allowed_transitions ?? []
    const approve = transitions.find((t) => t.status === 'approved')
    const others = transitions.filter((t) => t.status !== 'approved')
    const runTransition = async (button: HTMLButtonElement, t: { status: string; label: string; needs_message: boolean }) =>
      act(button, async () => {
        const destructive = ['rejected', 'duplicate'].includes(t.status)
        const message = await confirmDialog({
          title: t.status === 'approved' ? '发起 AI 制作' : `改为「${t.label}」`,
          tone: t.status === 'approved' || destructive ? 'seal' : 'jade',
          confirm: t.status === 'approved' ? '确认发起' : '确认',
          body: h('p', null,
            t.status === 'approved' ? '确认信息足够后发起制作。协调人会收到开工通知，桥接进程随后把它放入制作队列。'
            : t.status === 'need_info' ? '提交人会收到邮件，请写清还缺什么信息。'
            : destructive ? '提交人会看到状态和说明。这个操作之后通常不再继续处理。'
            : `状态将从「${labels[item.status]}」改为「${t.label}」。`),
          message: t.needs_message || t.status !== 'approved' ? { label: '给提交人的说明', required: t.needs_message } : undefined,
        })
        if (message == null) return
        await api(path + '/status', message ? { status: t.status, message } : { status: t.status })
        toast(t.status === 'approved' ? '已发起 AI 制作' : `已改为「${t.label}」`)
        refreshPending()
        render()
      })
    // 左栏：内容
    const photos = (item.photos ?? []) as any[]
    const timeline = [...(item.events ?? []), ...(item.messages ?? [])].sort((a, b) => a.created_at - b.created_at)
    const content = h('div', { class: 'adm-detail-main' },
      card('反馈内容', [
        h('p', { class: 'adm-body' }, item.body),
        h('dl', { class: 'adm-facts' },
          h('dt', null, '类型'), h('dd', null, item.kind ?? dash),
          h('dt', null, '位置'), h('dd', null, `${item.lon}, ${item.lat}`),
          h('dt', null, '朝向'), h('dd', null, item.heading ?? dash),
          h('dt', null, '地标'), h('dd', null, item.landmark_id ?? dash)),
      ]),
      (item.view || item.has_view_shot) &&
        card('游戏视角', [
          item.has_view_shot && h('img', { class: 'adm-shot', alt: '提交人提交反馈时的游戏画面', src: `/api/feedback/${encodeURIComponent(id)}/view-shot`, loading: 'lazy' }),
          item.view && h('a', { class: 'ui-btn ui-btn--paper adm-open-view', href: '/?view=' + viewToken(item.view), target: '_blank', rel: 'noopener' }, '在游戏中打开此视角 ↗'),
        ]),
      photos.length
        ? card(`照片（${photos.length}）`, h('div', { class: 'adm-photos' }, photos.map((photo) => {
            const url = `/api/feedback/${encodeURIComponent(id)}/photos/${photo.n}`
            return h('figure', null,
              h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, h('img', { src: url, loading: 'lazy', alt: `照片 ${photo.n}` })),
              h('figcaption', null,
                h('b', null, photo.view_label ?? '未标注视角'),
                h('span', null, `${fmt.bytes(num(photo.bytes))} · ${photo.mime}`),
                (photo.exif_lat != null || photo.exif_time) && h('span', null, `EXIF ${photo.exif_lat ?? dash}, ${photo.exif_lon ?? dash} · 朝向 ${photo.exif_dir ?? dash} · ${photo.exif_time ?? dash}`)))
          })))
        : null,
      card('进度与对话', [
        timeline.length
          ? h('ol', { class: 'adm-timeline' }, timeline.map((event) =>
              event.author_kind
                ? h('li', { class: `adm-msg adm-msg--${event.author_kind}` },
                    h('span', { class: 'adm-msg-meta' }, h('b', null, event.author_name ?? (event.author_kind === 'admin' ? '管理员' : event.author_kind === 'agent' ? '制作方' : '提交人')), when(unix(event.created_at))),
                    h('p', { class: 'adm-msg-body' }, event.body))
                : h('li', { class: 'adm-event' },
                    h('span', { class: 'adm-msg-meta' }, pill(event.status), ' ', when(unix(event.created_at))),
                    event.message && h('p', { class: 'adm-event-text' }, event.message),
                    event.screenshot_url && /^https:\/\//.test(event.screenshot_url) && h('a', { class: 'adm-link', href: event.screenshot_url, target: '_blank', rel: 'noopener noreferrer' }, '查看截图 ↗'))))
          : emptyState('还没有进度'),
        !['draft', 'live', 'rejected', 'duplicate'].includes(item.status) && compose(path),
      ]))
    // 右栏：处理面板
    const actions = h('aside', { class: 'adm-detail-side' },
      card('处理', [
        h('div', { class: 'adm-state' }, h('span', { class: 'adm-sub' }, '当前状态'), pill(item.status)),
        approve
          ? h('div', { class: 'adm-gate' },
              h('p', null, '信息足够了吗？发起后由制作 AI 开工。'),
              (() => {
                const b = h('button', { type: 'button', class: 'ui-btn ui-btn--seal ui-btn--block' }, '发起 AI 制作')
                b.addEventListener('click', () => runTransition(b, approve))
                return b
              })())
          : null,
        others.length
          ? h('div', { class: 'adm-transitions' },
              h('p', { class: 'adm-sub' }, approve ? '或者' : '可以改为'),
              others.map((t) => {
                const b = h('button', { type: 'button', class: `adm-btn ${['rejected', 'duplicate'].includes(t.status) ? 'adm-btn--danger' : 'adm-btn--ghost'}` }, t.label)
                b.addEventListener('click', () => runTransition(b, t))
                return b
              }))
          : !approve && h('p', { class: 'adm-sub' }, ['live', 'rejected', 'duplicate'].includes(item.status) ? '这条反馈已结束，没有可执行的操作。' : '制作流程进行中，状态会由制作方自动推进。'),
      ]),
      card('信息', h('dl', { class: 'adm-facts adm-facts--stack' },
        h('dt', null, '提交人'), h('dd', null, h('span', { class: 'adm-who' }, h('b', null, item.nickname), h('small', null, item.email)),
          item.user_id && navLink('TA 的全部反馈', { view: 'feedback', status: '', user: item.user_id }, { class: 'adm-link' })),
        h('dt', null, '提交时间'), h('dd', null, when(unix(item.submitted_at), true)),
        h('dt', null, '最近更新'), h('dd', null, `${when(unix(item.updated_at), true)}（${ago(unix(item.updated_at))}）`),
        (item.issue_url || item.pr_url) && h('dt', null, '制作'),
        (item.issue_url || item.pr_url) && h('dd', null,
          item.issue_url && /^https:\/\//.test(item.issue_url) && h('a', { class: 'adm-link', href: item.issue_url, target: '_blank', rel: 'noopener noreferrer' }, 'Multica 任务 ↗'), ' ',
          item.pr_url && /^https:\/\//.test(item.pr_url) && h('a', { class: 'adm-link', href: item.pr_url, target: '_blank', rel: 'noopener noreferrer' }, 'PR ↗')))))
    return [
      h('div', { class: 'adm-detail-head' }, h('h2', null, item.title), pill(item.status)),
      h('div', { class: 'adm-detail' }, content, actions),
    ]
  }, skeleton(8))
}
function compose(path: string) {
  const input = h('textarea', { rows: 3, maxlength: 1000, placeholder: '回复提交人（会同时发邮件提醒 TA）', 'aria-label': '管理员回复内容' })
  const send = h('button', { type: 'submit', class: 'adm-btn adm-btn--jade' }, '发送回复')
  const counter = h('span', { class: 'adm-sub' }, '0 / 1000')
  input.addEventListener('input', () => (counter.textContent = `${input.value.length} / 1000`))
  const form = h('form', { class: 'adm-compose' }, input, h('div', { class: 'adm-compose-foot' }, counter, send))
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    if (!input.value.trim()) return input.focus()
    act(send, async () => {
      await api(path + '/messages', { body: input.value.trim() })
      toast('回复已发送')
      render()
    })
  })
  return form
}

/* ───────────── boot ───────────── */
async function boot() {
  try {
    me = await api('me')
  } catch (error) {
    return denied(error instanceof ApiError && error.status === 403 ? 403 : 401)
  }
  if (me.role !== 'admin') return denied(403)
  // Legacy links: ?view=perf / ?view=timeseries etc.
  const legacy: Record<string, string> = { perf: 'breakdown', timeseries: 'trends', funnel: 'overview' }
  if (legacy[params.get('view') ?? '']) go({ view: legacy[params.get('view')!] }, false, true)
  else render()
  refreshPending()
}
boot()
