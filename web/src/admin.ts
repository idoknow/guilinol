// 网上桂林 · 管理后台。单页：?view= 路由，所有数据来自 /api/admin/*（见 docs/telemetry.md）。
import { labels, viewToken } from '../../lib/feedback-contract'
import './ui/theme.css'
import './admin.css'
import {markSession,markSurface} from './session-mark'
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
const inflightGet = new Map<string, Promise<any>>()
let manifestPromise: Promise<any> | null = null
let manifestRetryAt = 0
function loadManifest(): Promise<any> {
  if (manifestPromise) return manifestPromise
  if (Date.now() < manifestRetryAt) return Promise.resolve(null)
  manifestPromise = fetch('/world/manifest.json', { cache: 'default' })
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null)
    .then((data) => {
      if (!data) {
        manifestPromise = null
        manifestRetryAt = Date.now() + 60000
      }
      return data
    })
  return manifestPromise
}
function manifestPlaces(manifest: any): Place[] {
  return [
    ...(manifest?.landmarks ?? []).map((l: any) => ({ name: l.name, x: l.position?.[0], z: l.position?.[2] })),
    ...(manifest?.peaks?.entries ?? []).map((p: any) => ({ name: p.name, x: p.center?.[0], z: p.center?.[2] })),
  ].filter((p) => p.name && !/^auto-/.test(p.name) && Number.isFinite(p.x) && Number.isFinite(p.z))
}
async function api<T = any>(path: string, data?: unknown, method='POST'): Promise<T> {
  if (!data) {
    const existing = inflightGet.get(path)
    if (existing) return existing as Promise<T>
  }
  const job = (async () => {
    let response: Response
    // 后台聚合查询偶尔会 5xx（服务端慢查询超时）。只重试只读请求，写请求绝不重放。
    for (let attempt = 0; ; attempt++) {
      try {
        response = await fetch(
          `/api/${path}`,
          data
            ? { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }
            : { cache: 'no-store' },
        )
      } catch {
        throw new ApiError(0, 'network', '网络连接失败，请检查网络后重试')
      }
      if (attempt === 0 && !data && response.status >= 500) {
        await new Promise((resolve) => setTimeout(resolve, 800))
        continue
      }
      break
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
  })()
  if (!data) {
    inflightGet.set(path, job)
    job.finally(() => { if (inflightGet.get(path) === job) inflightGet.delete(path) })
  }
  return job
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
type Domain = 'biz' | 'ops'
type View = { key: string; label: string; icon: string; domain: Domain; group: string; ranged?: boolean }
const domainMeta: Record<Domain, { label: string; short: string; defaultView: string }> = {
  biz: { label: '运营侧', short: '运营', defaultView: 'overview' },
  ops: { label: '运维侧', short: '运维', defaultView: 'live' },
}
const views: View[] = [
  // 运营侧：玩家、联机玩法、增长、社区与内容配置
  { key: 'overview', label: '运营总览', icon: '◎', domain: 'biz', group: '概览与联机', ranged: true },
  { key: 'mp', label: '联机运营', icon: '⇋', domain: 'biz', group: '概览与联机' },
  { key: 'trends', label: '数据趋势', icon: '〰', domain: 'biz', group: '概览与联机', ranged: true },
  { key: 'feedback', label: '反馈处理', icon: '✉', domain: 'biz', group: '用户与社区' },
  { key: 'chat', label: '聊天管理', icon: '❝', domain: 'biz', group: '用户与社区' },
  { key: 'users', label: '用户与权限', icon: '☺', domain: 'biz', group: '用户与社区' },
  { key: 'security', label: '安全中心', icon: '⊘', domain: 'biz', group: '用户与社区' },
  { key: 'audit', label: '操作记录', icon: '☰', domain: 'biz', group: '用户与社区' },
  { key: 'npc', label: '路人与车流', icon: '⇄', domain: 'biz', group: '内容与玩法' },
  { key: 'smoke', label: '香烟', icon: '▥', domain: 'biz', group: '内容与玩法' },
  { key: 'gfx', label: '光影', icon: '☀', domain: 'biz', group: '内容与玩法' },
  // 运维侧：基础设施、联机引擎、网络探针、性能分布与故障排查
  { key: 'live', label: '实时监控', icon: '●', domain: 'ops', group: '服务监控' },
  { key: 'server', label: 'API 服务端', icon: '▣', domain: 'ops', group: '服务监控', ranged: true },
  { key: 'rt', label: '联机引擎', icon: '⚡', domain: 'ops', group: '服务监控' },
  { key: 'network', label: '地区与网络', icon: '◈', domain: 'ops', group: '性能与稳定', ranged: true },
  { key: 'breakdown', label: '性能分布', icon: '▤', domain: 'ops', group: '性能与稳定', ranged: true },
  { key: 'errors', label: '错误与可靠性', icon: '⚠', domain: 'ops', group: '性能与稳定', ranged: true },
]
const lastViewByDomain: Record<Domain, string> = { biz: 'overview', ops: 'live' }
let me: { id: string; uid:number; email: string; nickname: string; role: string }
let params = new URLSearchParams(location.search)
let pendingCount: number | null = null
let lastStats: any = null
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
  // 记住当前页面的滚动位置，返回时还原（列表 → 详情 → 返回不再跳回顶部）。
  if (!replace) history.replaceState({ y: window.scrollY }, '')
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
window.addEventListener('popstate', (event) => {
  params = new URLSearchParams(location.search)
  render({ scroll: Number(event.state?.y) || 0 })
})
function rangeWindow() {
  const key = Object.hasOwn(ranges, params.get('range') ?? '') ? params.get('range')! : '24h'
  // 24h 及以上窗口按 5 分钟向上对齐，保证页内/跨页/多人访问共享服务端 2m TTL + 15m stale 缓存 key
  const snap = ranges[key].ms >= 86400e3 ? 300000 : 60000
  const to = Math.ceil(Date.now() / snap) * snap
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
/* 每个数据块按「页面地址 + 第几块」缓存上次结果：切换页面、筛选、返回时先立刻画出上次的内容，
   再在后台刷新，数据没变就不重画——不再每次都闪一遍骨架屏。写操作后 staleAll() 让所有块下次重新取。 */
const slotCache = new Map<string, { at: number; data: unknown; json: string }>()
const FRESH_MS = 30e3
let slotSeq = 0
let syncing = 0
function staleAll() {
  for (const entry of slotCache.values()) entry.at = 0
}
function setSyncing(delta: number) {
  syncing = Math.max(0, syncing + delta)
  document.body.classList.toggle('adm-syncing', syncing > 0)
  document.querySelector('.adm-refresh')?.classList.toggle('is-busy', syncing > 0)
  if (!syncing) main.style.minHeight = ''
}
const snapshot = (data: unknown) => {
  try {
    return JSON.stringify(data) ?? ''
  } catch {
    return String(Math.random())
  }
}
/** Fills `slot` with the result of `load`: cached content first (then a quiet refresh), else skeleton → content / error+retry. Ignores stale renders. */
function async<T>(slot: HTMLElement, load: () => Promise<T>, paint: (data: T) => Child | Child[], skel: Node = skeleton()) {
  const mine = generation
  const key = `${params}#${slotSeq++}`
  const show = (data: T) => {
    slot.replaceChildren()
    append(slot, [paint(data)])
    labelTables(slot)
  }
  const run = (quiet: boolean) => {
    if (!quiet) slot.replaceChildren(skel)
    setSyncing(1)
    load()
      .then((data) => {
        if (mine !== generation) return
        const json = snapshot(data)
        const before = slotCache.get(key)
        slotCache.delete(key)
        slotCache.set(key, { at: Date.now(), data, json })
        if (slotCache.size > 240) slotCache.delete(slotCache.keys().next().value!)
        if (quiet && before?.json === json) return
        show(data)
      })
      .catch((error) => {
        if (mine !== generation) return
        if (error instanceof ApiError && [401, 403].includes(error.status)) return denied(error.status)
        if (quiet) toast(`刷新失败：${error instanceof Error ? error.message : '请求失败'}`, 'error')
        else slot.replaceChildren(errorState(error, () => run(false)))
      })
      .finally(() => mine === generation && setSyncing(-1))
  }
  const hit = slotCache.get(key)
  if (hit) {
    show(hit.data as T)
    if (Date.now() - hit.at > FRESH_MS) run(true)
  } else run(false)
  return slot
}
/** 手机上表格改成卡片：给每个单元格补上列名（第一列作卡片标题，不加）。 */
function labelTables(root: ParentNode) {
  for (const table of Array.from(root.querySelectorAll<HTMLTableElement>('table.adm-table:not(.adm-users)'))) {
    const heads = Array.from(table.querySelectorAll('thead th')).map((th) => th.textContent?.trim() ?? '')
    for (const row of Array.from(table.tBodies[0]?.rows ?? []))
      Array.from(row.cells).forEach((cell, i) => {
        if (i && heads[i] && !cell.dataset.label) cell.dataset.label = heads[i]
      })
  }
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
function confirmDialog(opts: { title: string; body: Child | Child[]; confirm: string; tone?: 'seal' | 'jade'; message?: { label: string; required: boolean; placeholder?: string; max?: number; hint?: string } }) {
  return new Promise<string | null>((resolve) => {
    const textarea = opts.message
      ? h('textarea', { rows: 4, maxlength: opts.message.max ?? 2000, placeholder: opts.message.placeholder ?? '', 'aria-label': opts.message.label })
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
        hint.textContent = opts.message?.hint ?? '请填写说明，提交人会看到这段话'
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
      const point = (event: PointerEvent) => {
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
      }
      svg.addEventListener('pointermove', point)
      svg.addEventListener('pointerdown', point)
      svg.addEventListener('pointerleave', (event) => {
        if (event.pointerType === 'touch') return
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
type Signups = { from: number; hours: number; base: number; points: { t: number; n: number }[] }
/** 用户页注册曲线：上半区用户总数折线，下半区每小时新增柱，共用时间轴和悬停提示。 */
function signupChart(data: Signups) {
  const start = data.from * 1000,
    have = new Map(data.points.map((p) => [p.t * 1000, p.n]))
  let total = data.base
  const rows = Array.from({ length: data.hours }, (_, i) => {
    const t = start + i * 3600e3, n = have.get(t) ?? 0
    total += n
    return { t, n, total }
  })
  const wrap = h('div', { class: 'adm-chart adm-signups' })
  const tip = h('div', { class: 'adm-tip', hidden: true })
  const legend = h('div', { class: 'adm-legend' },
    h('span', null, h('i', { style: 'background:var(--adm-c1)' }), '用户总数'),
    h('span', null, h('i', { style: 'background:var(--adm-c3)' }), '每小时新注册'))
  const draw = () => {
    const width = Math.max(260, wrap.clientWidth || 600),
      pad = { l: 56, r: 14 },
      top = { y: 10, h: 150 }, low = { y: 186, h: 76 }, height = low.y + low.h + 26
    wrap.querySelector('svg')?.remove()
    const slot = (width - pad.l - pad.r) / rows.length,
      x = (i: number) => pad.l + slot * (i + 0.5)
    const lo = rows[0].total - rows[0].n, hi = rows[rows.length - 1].total
    // 总数轴不从 0 起：从窗口起点的存量往下留一点空，增长才看得出来。
    const span = Math.max(hi - lo, 4), tTicks = niceTicks(span, 3), tStep = tTicks[1] - tTicks[0]
    const tMin = Math.max(0, Math.floor((lo - span * 0.05) / tStep) * tStep),
      tMax = Math.max(tMin + tStep, Math.ceil(hi / tStep) * tStep)
    const yT = (v: number) => top.y + (1 - (v - tMin) / (tMax - tMin)) * top.h
    const nTicks = niceTicks(Math.max(...rows.map((r) => r.n)), 2), nMax = nTicks[nTicks.length - 1] || 1
    const yN = (v: number) => low.y + (1 - v / nMax) * low.h
    const svg = s('svg', { viewBox: `0 0 ${width} ${height}`, width, height, role: 'img', 'aria-label': `最近 ${data.hours} 小时注册：新增 ${hi - lo}，总数 ${hi}` })
    const grid = (yy: number, text: string) => {
      svg.append(s('line', { x1: pad.l, x2: width - pad.r, y1: yy, y2: yy, class: 'adm-grid' }))
      svg.append(s('text', { x: pad.l - 8, y: yy + 4, 'text-anchor': 'end', class: 'adm-axis' }, text))
    }
    for (let v = tMin; v <= tMax + 1e-9; v += tStep) grid(yT(v), fmt.int(v))
    for (const v of nTicks) grid(yN(v), fmt.int(v))
    svg.append(s('text', { x: pad.l, y: low.y - 8, class: 'adm-axis adm-signups-cap' }, '每小时新注册'))
    const bw = Math.max(1, Math.min(14, slot * 0.72))
    for (const [i, r] of rows.entries())
      if (r.n) svg.append(s('rect', { x: x(i) - bw / 2, y: yN(r.n), width: bw, height: Math.max(1, low.y + low.h - yN(r.n)), rx: Math.min(2, bw / 3), class: 'adm-signups-bar' }))
    const d = rows.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${yT(r.total).toFixed(1)}`).join('')
    svg.append(s('path', { d: `${d}L${x(rows.length - 1).toFixed(1)},${top.y + top.h}L${x(0).toFixed(1)},${top.y + top.h}Z`, class: 'adm-area' }))
    svg.append(s('path', { d, class: 'adm-line', style: 'stroke:var(--adm-c1)' }))
    // 时间刻度落在整点：按宽度挑 1/2/3/6/12 小时或 1/2/5/7 天一格。
    const room = Math.max(2, Math.floor(width / (data.hours > 36 ? 110 : 70))),
      every = [1, 2, 3, 6, 12, 24, 48, 120, 168].find((n) => rows.length / n <= room) ?? 168
    for (const [i, r] of rows.entries()) {
      const date = new Date(r.t), hour = date.getHours()
      if (every < 24 ? hour % every : hour || Math.round((r.t - rows[0].t) / 86400e3) % (every / 24)) continue
      const px = x(i)
      if (px < pad.l + 24 || px > width - pad.r - 24) continue
      const hh = `${String(hour).padStart(2, '0')}:00`
      svg.append(s('text', { x: px, y: height - 6, 'text-anchor': 'middle', class: 'adm-axis' },
        every >= 24 ? `${date.getMonth() + 1}/${date.getDate()}` : data.hours > 36 && hour === 0 ? `${date.getMonth() + 1}/${date.getDate()}` : hh))
    }
    const cursor = s('line', { y1: top.y, y2: low.y + low.h, class: 'adm-cursor', visibility: 'hidden' })
    svg.append(cursor)
    const point = (event: PointerEvent) => {
      const box = svg.getBoundingClientRect(),
        px = ((event.clientX - box.left) / box.width) * width,
        i = Math.min(rows.length - 1, Math.max(0, Math.floor((px - pad.l) / slot))), r = rows[i]
      cursor.setAttribute('x1', String(x(i)))
      cursor.setAttribute('x2', String(x(i)))
      cursor.setAttribute('visibility', 'visible')
      const end = new Date(r.t + 3600e3)
      tip.hidden = false
      tip.replaceChildren(h('b', null, `${when(new Date(r.t))} – ${String(end.getHours()).padStart(2, '0')}:00`),
        h('span', null, h('i', { style: 'background:var(--adm-c3)' }), `新注册 ${fmt.int(r.n)}`),
        h('span', null, h('i', { style: 'background:var(--adm-c1)' }), `用户总数 ${fmt.int(r.total)}`))
      tip.style.left = `${Math.min(Math.max((x(i) / width) * box.width, 80), box.width - 80)}px`
    }
    svg.addEventListener('pointermove', point)
    svg.addEventListener('pointerdown', point)
    svg.addEventListener('pointerleave', (event) => {
      if (event.pointerType === 'touch') return
      cursor.setAttribute('visibility', 'hidden')
      tip.hidden = true
    })
    wrap.prepend(svg)
  }
  wrap.append(tip, legend)
  new ResizeObserver(() => draw()).observe(wrap)
  requestAnimationFrame(draw)
  return wrap
}
const signupRanges: [string, string][] = [['24', '24 小时'], ['72', '3 天'], ['168', '7 天'], ['720', '30 天']]
function signupCard() {
  const pick = signupRanges.some(([k]) => k === params.get('signups')) ? params.get('signups')! : '72'
  const slot = h('div')
  async(slot, () => api<Signups>(`admin/signups?hours=${pick}`), (data) => {
    const added = data.points.reduce((sum, p) => sum + p.n, 0)
    return [h('p', { class: 'adm-sub adm-signups-sum' }, `区间内新注册 ${fmt.int(added)} 人，现有 ${fmt.int(data.base + added)} 人`), signupChart(data)]
  }, skeleton(4))
  return card('注册曲线', slot, {
    sub: '按小时统计，时间为本机时区',
    actions: segmented(pick, signupRanges, (value) => go({ signups: value === '72' ? null : value }, true, true), '注册曲线时间范围'),
  })
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
function paintSide(center = false) {
  const active = currentView()
  const activeView = views.find((v) => v.key === active)!
  const activeDomain: Domain = activeView.domain
  const domainViews = views.filter((v) => v.domain === activeDomain)
  const groups = [...new Set(domainViews.map((v) => v.group))]
  const scrollLeft = side.scrollLeft
  const domainSwitch = h('div', { class: 'adm-domain-switch', role: 'tablist', 'aria-label': '管理视角切换' },
    (['biz', 'ops'] as Domain[]).map((d) =>
      h('button', {
        type: 'button',
        role: 'tab',
        'aria-selected': String(d === activeDomain),
        class: `adm-domain-btn adm-domain-btn--${d} ${d === activeDomain ? 'is-on' : ''}`,
        onclick: (() => {
          if (d === activeDomain) return
          go({ view: lastViewByDomain[d] || domainMeta[d].defaultView })
        }) as EventListener,
      },
      domainMeta[d].label,
      d === 'biz' && pendingCount ? h('em', { class: 'adm-badge', title: '待处理反馈' }, pendingCount > 99 ? '99+' : pendingCount) : null)))
  side.replaceChildren(
    brand(),
    domainSwitch,
    h('nav', null,
      groups.map((group) => [
        h('p', { class: 'adm-nav-group' }, group),
        domainViews.filter((v) => v.group === group).map((v) =>
          navLink([h('span', { class: 'adm-nav-icon', 'aria-hidden': 'true' }, v.icon), h('span', null, v.label),
            v.key === 'feedback' && pendingCount ? h('em', { class: 'adm-badge', title: '待处理反馈' }, pendingCount > 99 ? '99+' : pendingCount) : null],
          { view: v.key }, { class: `adm-nav-item ${v.key === active ? 'is-active' : ''}`, 'aria-current': v.key === active ? 'page' : undefined })),
      ])),
    h('div', { class: 'adm-me' },
      h('span', { class: 'adm-avatar', 'aria-hidden': 'true' }, (me.nickname || me.email).slice(0, 1).toUpperCase()),
      h('span', null, h('b', null, me.nickname || '管理员'), h('small', null, me.email)),
      h('a', { href: '/', class: 'adm-me-back', title: '返回游戏' }, '↩')))
  side.scrollLeft = scrollLeft
  // 手机上导航是一条横向滚动条：把当前页滚到可见的中间。
  const current = side.querySelector<HTMLElement>('.adm-nav-item.is-active')
  if (center && current && side.scrollWidth > side.clientWidth)
    side.scrollTo({ left: current.offsetLeft - (side.clientWidth - current.offsetWidth) / 2, behavior: 'smooth' })
}
function paintTop(view: View, extra?: Child | Child[]) {
  const r = rangeWindow()
  top.replaceChildren(
    h('div', { class: 'adm-title' },
      h('h1', null, view.label),
      h('span', { class: `adm-domain-pill adm-domain-pill--${view.domain}` }, domainMeta[view.domain].label),
      extra),
    view.ranged
      ? h('div', { class: 'adm-top-tools' },
          segmented(r.key, Object.entries(ranges).map(([k, v]) => [k, v.label]), (key) => go({ range: key }, true), '时间范围'),
          refreshButton())
      : h('div', { class: 'adm-top-tools' }, refreshButton()))
}
function refreshButton() {
  return h('button', {
    type: 'button', class: 'adm-btn adm-btn--ghost adm-refresh', title: '刷新', 'aria-label': '刷新',
    onclick: (() => (staleAll(), refreshPending(), render({ keepScroll: true }))) as EventListener,
  }, h('span', { class: 'adm-refresh-icon', 'aria-hidden': 'true' }, '↻'), h('span', { class: 'adm-refresh-text' }, '刷新'))
}
function refreshPending() {
  api<{ pending: number }>('admin/stats')
    .then((stats) => {
      pendingCount = num(stats.pending) ?? 0
      paintSide()
    })
    .catch(() => {})
}
let lastPage = ''
/** 重画当前页。换页（或换详情）时回到顶部；同一页换筛选、刷新时保持滚动位置；后退时还原上次位置。 */
function render(opts: { scroll?: number; keepScroll?: boolean } = {}) {
  generation++
  slotSeq = 0
  syncing = 0
  setSyncing(0)
  clearInterval(refreshTimer)
  document.querySelectorAll('dialog.adm-dialog').forEach((d) => d.remove())
  const key = currentView(),
    view = views.find((v) => v.key === key)!
  lastViewByDomain[view.domain] = view.key
  const pageKey = `${key}|${params.get('id') ?? ''}`
  const y = window.scrollY
  paintSide(pageKey !== lastPage)
  paintTop(view)
  // 先固定 main 的高度再重建，避免内容短暂变矮导致页面被浏览器拉回顶部。
  main.style.minHeight = `${main.offsetHeight}px`
  main.replaceChildren()
  document.title = `${view.label} · 管理后台 · 网上桂林`
  pages[key](view)
  const target = opts.scroll ?? (opts.keepScroll || pageKey === lastPage ? y : 0)
  window.scrollTo(0, target)
  // 有数据还在路上时保留旧高度（setSyncing 归零时释放），避免页面忽长忽短来回跳。
  requestAnimationFrame(() => {
    if (!syncing) main.style.minHeight = ''
    if (opts.scroll != null) window.scrollTo(0, opts.scroll)
  })
  lastPage = pageKey
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
        h('div', { class: 'adm-toolbar' },
          navLink('进入联机运营 →', { view: 'mp' }, { class: 'adm-link' }),
          navLink('运维侧 · 实时监控 →', { view: 'live' }, { class: 'adm-link' })),
      ]
    }, skeleton(2))
    async(todoSlot, () => api('admin/stats'), (stats: any) => {
      lastStats = stats
      pendingCount = num(stats.pending) ?? 0
      paintSide()
      return [
        h('div', { class: 'adm-now-big' }, h('b', { class: pendingCount ? 'is-seal' : '' }, pendingCount), h('span', null, '条反馈待处理')),
        h('p', { class: 'adm-sub' }, `用户 ${fmt.int(num(stats.total))} · 24 小时新增 ${fmt.int(num(stats.new_24h))}`),
        navLink(pendingCount ? '去处理 →' : '查看反馈 →', { view: 'feedback' }, { class: 'adm-link' }),
      ]
    }, skeleton(2))
    async(kpiSlot, () => api<Record<string, { current: unknown; previous: unknown }>>('admin/overview?' + q), (data) => {
      const bizGroups = kpiGroups.filter(([group]) => group === '访问' || group === '社区')
      const errRate = num(data.errorRate?.current), rate5xx = num(data.api5xxRate?.current)
      const healthStrip = h('div', { class: 'adm-health-strip' },
        h('span', null, '运维侧健康摘要'),
        h('div', { class: 'adm-health-items' },
          h('span', { class: 'adm-health-item' }, '可玩 p50 ', h('b', null, fmt.ms(num(data.playableP50?.current)))),
          h('span', { class: 'adm-health-item' }, '帧率 p50 ', h('b', null, fmt.fps(num(data.fpsP50?.current)))),
          h('span', { class: 'adm-health-item' }, '瓦片 p95 ', h('b', null, fmt.ms(num(data.chunkP95?.current)))),
          h('span', { class: 'adm-health-item' }, '出错率 ', h('b', { class: (errRate ?? 0) > 0.05 ? 'is-bad' : '' }, fmt.pct(errRate))),
          h('span', { class: 'adm-health-item' }, '接口 5xx ', h('b', { class: (rate5xx ?? 0) > 0.01 ? 'is-bad' : '' }, fmt.pct(rate5xx)))),
        navLink('进入运维侧详情 →', { view: 'server' }, { class: 'adm-link' }, true))
      return [
        ...bizGroups.map(([group, keys]) =>
          h('section', { class: 'adm-kpi-group' },
            h('h2', null, group === '访问' ? '访问与留存' : '社区增长'),
            h('div', { class: 'adm-kpis' }, keys.map((key) => kpiCard(key, data[key], r.label))))),
        healthStrip,
      ]
    }, skeleton(4, 'adm-skel--kpi'))
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
    // 复用意图相同的探针查询：admin/breakdown 同时返回 p50 与 p95，避免重复发 3 条探针聚合
    const nodeTtfb = () => breakdown('probe.ttfb.p50', 'node')
    const nodeTotal = () => breakdown('probe.total.p50', 'node')
    const nodeFail = () => series('probeFail')

    async(kpis, () => Promise.all([nodeTtfb(), nodeTotal(), nodeFail()]), ([ttfb, total, fail]) => {
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

    async(phases, () => Promise.all([
      breakdown('probe.dns.p50', 'node'),
      breakdown('probe.tcp.p50', 'node'),
      breakdown('probe.tls.p50', 'node'),
      nodeTtfb(),
      nodeTotal(),
    ]), ([dns, tcp, tls, ttfb, total]) => {
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

    async(fails, () => nodeFail(), (rows) => {
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
      loadManifest(),
    ]), ([cells, manifest]) => {
      if (!cells.length) return emptyState('这段时间没有带位置的玩家数据')
      return heatmap(cells, heatKey, manifest?.extent, manifestPlaces(manifest))
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
      Promise.all([api('admin/live'), api('admin/mp').catch(() => null)]).then(([live, mpState]: [any, any]) => {
        if (mine !== generation) return
        stamp.textContent = `每 15 秒自动刷新 · ${when(new Date())}`
        slot.replaceChildren(paintLive(live, mpState))
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
    async(slot, () => api<any>('admin/perf/server?' + new URLSearchParams({ from, to: r.to, summary: '1' })), (result) => {
      let step: number
      let latest: any
      let seriesByMetric: Record<string, Series[]>
      let routeRows: { route: string; count: number; errors: number; p95: number; p99: number }[]
      if (result?.summary) {
        if (!result.count || !result.latest) return emptyState('这段时间没有服务端采样')
        step = Number(result.stepMs) || 600e3
        latest = result.latest.sample ?? {}
        const wrap = (pts: { t: string; v: number }[] = []): Series[] => [{ name: '', points: pts.map((p) => ({ t: new Date(p.t), v: p.v })) }]
        seriesByMetric = {
          cpuCores: wrap(result.series?.cpuCores),
          rss: wrap(result.series?.rss),
          loopP99: wrap(result.series?.loopP99),
          pgP95: wrap(result.series?.pgP95),
        }
        routeRows = result.routes ?? []
      } else {
        const rows = list<any>(result).map((row) => ({ t: new Date(row.minute), s: typeof row.sample === 'string' ? JSON.parse(row.sample) : row.sample ?? {} }))
        if (!rows.length) return emptyState('这段时间没有服务端采样')
        step = r.ms <= 3600e3 ? 60e3 : r.ms <= 86400e3 ? 10 * 60e3 : 3600e3
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
        latest = rows[rows.length - 1].s
        seriesByMetric = {
          cpuCores: metric((s) => s.cpuCores),
          rss: metric((s) => s.rss),
          loopP99: metric((s) => s.loopP99),
          pgP95: metric((s) => s.pgP95),
        }
        routeRows = [...routes.values()].sort((a, b) => b.count - a.count)
      }
      const opts = { bucket: step >= 3600e3 ? '1h' : '5m', height: 160, gap: step }
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
          card('CPU（峰值）', lineChart(seriesByMetric.cpuCores, fmt.cores, opts)),
          card('进程内存（峰值）', lineChart(seriesByMetric.rss, fmt.bytes, opts)),
          card('事件循环延迟 p99', lineChart(seriesByMetric.loopP99, fmt.ms, opts)),
          card('数据库查询 p95', lineChart(seriesByMetric.pgP95, fmt.ms, opts))),
        card('接口', routeRows.length
          ? h('div', { class: 'adm-table-wrap' }, h('table', { class: 'adm-table' },
              h('thead', null, h('tr', null, ['路由', '请求数', '错误', '错误率', '最差 p95', '最差 p99'].map((t, i) => h('th', { class: i ? 'num' : '' }, t)))),
              h('tbody', null, routeRows.map((route) =>
                h('tr', null,
                  h('td', null, h('code', null, route.route)),
                  h('td', { class: 'num' }, fmt.int(route.count)),
                  h('td', { class: 'num' }, fmt.int(route.errors)),
                  h('td', { class: `num ${route.errors / Math.max(1, route.count) > 0.05 ? 'is-bad' : ''}` }, fmt.pct(route.errors / Math.max(1, route.count))),
                  h('td', { class: 'num' }, fmt.ms(route.p95)),
                  h('td', { class: 'num' }, fmt.ms(route.p99)))))))
          : emptyState('这段时间没有接口请求'), { sub: '按请求数排序，错误为 HTTP ≥ 400' }),
      ]
    }, skeleton(8))
  },

  rt() {
    const stamp = h('span', { class: 'adm-sub adm-live-stamp' })
    paintTop(views.find((v) => v.key === 'rt')!, [
      h('span', { class: 'adm-live-dot', 'aria-hidden': 'true' }),
      stamp,
      navLink('前往运营侧 · 联机运营 →', { view: 'mp' }, { class: 'adm-link' }),
    ])
    const slot = h('div', { class: 'adm-stack' })
    main.append(slot)
    const mine = generation
    let last = ''
    const load = (first: boolean) =>
      api<any>('admin/mp').then((state) => {
        if (mine !== generation) return
        stamp.textContent = `每 10 秒自动刷新 · ${when(new Date())}`
        const json = JSON.stringify(state)
        if (json === last) return
        last = json
        slot.replaceChildren(paintRtOps(state))
        labelTables(slot)
      }).catch((error) => {
        if (mine !== generation) return
        if (error instanceof ApiError && [401, 403].includes(error.status)) return denied(error.status)
        if (first) slot.replaceChildren(errorState(error, () => load(true)))
        else stamp.textContent = `自动刷新失败：${error.message}`
      })
    slot.append(skeleton(6))
    load(true)
    refreshTimer = window.setInterval(() => document.visibilityState === 'visible' && load(false), 10000)
  },

  gfx(){
    paintTop(views.find(view=>view.key==='gfx')!)
    const slot=h('div',{class:'adm-stack'},skeleton(8));main.append(slot)
    void Promise.all([api('admin/gfx'),import('./look/gfx-config')]).then(([stored,{validGfx,gfxDefaults}])=>{
      type Config=typeof gfxDefaults
      type Period='day'|'dusk'|'night'
      let saved=JSON.stringify(validGfx(stored)?stored:gfxDefaults)
      paint(structuredClone(validGfx(stored)?stored:gfxDefaults))
      function paint(initial:Config){
      let config:Config=structuredClone(initial)
      const save=h('button',{type:'submit',class:'adm-btn',form:'adm-gfx-form',disabled:''},'保存') as HTMLButtonElement
      const reset=h('button',{type:'button',class:'adm-btn adm-btn--ghost'},'恢复默认') as HTMLButtonElement
      const state=h('span',{class:'adm-sub adm-npc-state'},'已是最新')
      paintTop(views.find(view=>view.key==='gfx')!,[state])
      top.querySelector('.adm-top-tools')!.prepend(reset,save)
      const problem=h('p',{class:'adm-npc-problem',role:'alert',hidden:''})
      const get=(path:string):unknown=>path.split('.').reduce<any>((node,key)=>node?.[key],config)
      const put=(path:string,value:unknown)=>{const keys=path.split('.'),last=keys.pop()!;const node=keys.reduce<any>((at,key)=>at[key],config);node[last]=value;changed()}
      const fmt=(value:number,step:number)=>step>=1?String(Math.round(value)):value.toFixed(step>=.1?1:2)
      const slider=(path:string,label:string,min:number,max:number,step:number,unit='',hint='')=>{
        const input=h('input',{type:'range',min:String(min),max:String(max),step:String(step),class:'adm-npc-vol','aria-label':label}) as HTMLInputElement
        const out=h('output',{class:'adm-npc-vol-text'})
        const show=()=>{const value=get(path) as number;out.textContent=fmt(value,step)+unit;input.style.setProperty('--fill',`${(value-min)/(max-min)*100}%`)}
        input.value=String(get(path));input.oninput=()=>{put(path,input.valueAsNumber);show()};show()
        return h('div',{class:'adm-gfx-slider'},h('span',{class:'adm-npc-label'},label),input,out,hint?h('span',{class:'adm-sub'},hint):null)
      }
      const toggle=(path:string,title:string,hint:string)=>{
        const input=h('input',{type:'checkbox',role:'switch'}) as HTMLInputElement
        input.checked=get(path) as boolean;input.onchange=()=>{put(path,input.checked);sync()}
        return h('label',{class:'adm-npc-switch'},h('span',{class:'adm-npc-switch-text'},h('b',null,title),h('span',null,hint)),input,h('i',{'aria-hidden':'true'}))
      }
      const choice=(path:string,label:string,items:[string|number,string][])=>{
        const wrap=h('div',{class:'adm-gfx-choice'})
        const draw=()=>wrap.replaceChildren(h('span',{class:'adm-npc-label'},label),segmented(String(get(path)),items.map(([value,text])=>[String(value),text]),key=>{put(path,typeof items[0][0]==='number'?Number(key):key);draw()},label))
        draw();return wrap
      }
      // 效果关掉时，把对应参数整体淡出但不隐藏，运营能看到关掉的是什么
      const groups:[string,HTMLElement][]=[]
      const effect=(key:'ao'|'bloom'|'shadow'|'godrays'|'dof',title:string,hint:string,body:HTMLElement[],sub:string)=>{
        const params=h('div',{class:'adm-gfx-params'},...body);groups.push([key,params])
        return card(title,[toggle(`${key}.enabled`,`开启${title}`,hint),params],{sub})
      }
      function sync(){for(const [key,params] of groups)params.classList.toggle('is-off',!get(`${key}.enabled`))}
      const PERIODS:[Period,string,string][]=[['day','白天','08–16 时'],['dusk','晨昏','06 时 · 18 时'],['night','夜晚','20:30–05 时']]
      const OVERRIDES:[string,string,number,number,number][]=[
        ['exposure','曝光',.2,3,.05],['saturation','饱和度',0,2,.05],['contrast','对比度',0,2,.05],
        ['ao.intensity','遮蔽强度',0,8,.1],['bloom.intensity','泛光强度',0,4,.05],['bloom.threshold','泛光阈值',0,1,.01],['shadow.strength','阴影浓度',0,1,.05]]
      const periodTable=()=>{
        const head=h('tr',null,h('th',null,'参数'),...PERIODS.map(([,name,time])=>h('th',null,name,h('small',null,time))))
        const rows=OVERRIDES.map(([path,label,min,max,step])=>h('tr',null,h('th',{scope:'row'},label,h('small',null,`全局 ${fmt(get(path) as number,step)}`)),...PERIODS.map(([period])=>{
          const keys=path.split('.'),current=keys.reduce<any>((node,key)=>node?.[key],config.presets[period])
          const input=h('input',{type:'number',class:'adm-npc-num',min:String(min),max:String(max),step:String(step),placeholder:'跟随','aria-label':`${label}（${period}）`}) as HTMLInputElement
          input.value=current===undefined?'':String(current)
          input.oninput=()=>{
            const preset:any=config.presets[period]
            if(keys.length===1){if(input.value==='')delete preset[keys[0]];else preset[keys[0]]=input.valueAsNumber}
            else{const group=preset[keys[0]]??={};if(input.value==='')delete group[keys[1]];else group[keys[1]]=input.valueAsNumber;if(!Object.keys(group).length)delete preset[keys[0]]}
            input.classList.toggle('is-set',input.value!=='');changed()
          }
          input.classList.toggle('is-set',input.value!=='')
          return h('td',null,input)
        })))
        return h('div',{class:'adm-gfx-table-wrap'},h('table',{class:'adm-gfx-table'},h('thead',null,head),h('tbody',null,...rows)))
      }
      const form=h('form',{class:'adm-npc adm-gfx',id:'adm-gfx-form',novalidate:''}) as HTMLFormElement
      form.append(
        h('p',{class:'adm-note'},'保存后新进入场景的玩家生效。手机默认「低」档，只用到「色调」和「低档也开遮蔽」；中、高档才会用到泛光与阴影，体积光与景深只在高档。'),
        problem,
        card('色调',[
          choice('toneMapping','色调映射',[['neutral','中性'],['agx','AgX'],['aces','ACES']]),
          h('div',{class:'adm-gfx-grid'},
            slider('exposure','曝光',.2,3,.05,'×','在时间系统的曝光上再乘'),
            slider('saturation','饱和度',0,2,.05,'×','1 = 不改'),
            slider('contrast','对比度',0,2,.05,'×','1 = 不改')),
        ],{sub:'中性最贴近原画面；AgX 偏淡雅、ACES 偏浓烈'}),
        h('div',{class:'adm-cols adm-npc-cols'},
          effect('ao','环境光遮蔽','墙角、檐下、树根加一层柔和暗部',[
            slider('ao.intensity','强度',0,8,.1),slider('ao.radius','半径',.2,20,.1,' m'),
            toggle('ao.lowEnabled','低档也开','手机耗电明显，默认关')],'中档半分辨率，高档全分辨率'),
          effect('bloom','泛光','玻璃、灯笼、夜景窗灯的光晕',[
            slider('bloom.intensity','强度',0,4,.05),slider('bloom.threshold','阈值',0,1,.01,'','越低越多地方发光')],'中、高档')),
        h('div',{class:'adm-cols adm-npc-cols'},
          effect('shadow','太阳阴影','跟随太阳的实时阴影，日落后自动关闭',[
            slider('shadow.strength','浓度',0,1,.05),slider('shadow.softness','柔和度',0,16,.1),
            choice('shadow.mapSize','精度',[[1024,'1024'],[2048,'2048'],[4096,'4096']]),
            slider('shadow.distance','覆盖范围',10,300,10,' m','以玩家为中心'),
            slider('shadow.updateEvery','中档刷新间隔',1,4,1,' 帧'),slider('shadow.moveThreshold','移动多远立即刷新',0,16,.5,' m')],'中档单级 PCF，高档 PCSS'),
          h('div',{class:'adm-stack'},
            effect('godrays','体积光','阳光穿过楼缝、树冠的光柱，夜间为 0',[slider('godrays.intensity','强度',0,4,.05)],'仅高档'),
            effect('dof','景深','远景轻微虚化',[slider('dof.focusRange','对焦范围',0,1,.01),slider('dof.bokeh','虚化',0,8,.1)],'仅高档，默认关'))),
        card('分时段微调',[periodTable(),h('p',{class:'adm-sub'},'空格 = 跟随全局。相邻时段之间按小时平滑过渡。')],{sub:'只填需要和全局不同的格子'}),
      )
      function problemText(){return validGfx(config)?'':'有参数超出范围，请检查标红的格子'}
      function changed(){
        const error=problemText(),dirty=JSON.stringify(config)!==saved
        problem.textContent=error;problem.hidden=!error
        save.disabled=!dirty||!!error;state.textContent=dirty?'有改动未保存':'已是最新';state.classList.toggle('is-dirty',dirty)
      }
      reset.onclick=()=>paint(structuredClone(gfxDefaults))
      form.onsubmit=event=>{
        event.preventDefault();if(save.disabled)return
        save.classList.add('is-busy');save.disabled=true
        void api('admin/gfx',config,'PUT').then(()=>{saved=JSON.stringify(config);changed();toast('已保存，新进场的玩家生效')})
          .catch(error=>{changed();toast(error instanceof Error?error.message:'保存失败，请检查参数','error')})
          .finally(()=>save.classList.remove('is-busy'))
      }
      slot.replaceChildren(form);sync();changed()
      }
    }).catch(error=>slot.replaceChildren(errorState(error,()=>render())))
  },
  smoke() {
    paintTop(views.find(view=>view.key==='smoke')!)
    const slot=h('div',{class:'adm-stack'},skeleton(6));main.append(slot)
    void Promise.all([api('admin/smoke'),import('./smoke/data')]).then(([stored,{smokeDefaults,validRules,BRANDS}])=>{
      const rules=structuredClone(validRules(stored)?stored:smokeDefaults)
      const form=h('form',{class:'adm-npc'}) as HTMLFormElement
      const field=(label:string,value:number,min:number,max:number,step:number,update:(n:number)=>void)=>{
        const input=h('input',{type:'number',value:String(value),min:String(min),max:String(max),step:String(step),required:'',class:'adm-npc-num'}) as HTMLInputElement
        input.oninput=()=>update(input.valueAsNumber)
        return h('label',{class:'adm-npc-range'},label,input)
      }
      form.append(field('最短燃烧时间（秒）',rules.minSeconds,1,1800,1,n=>rules.minSeconds=n),
        field('最长燃烧时间（秒）',rules.maxSeconds,1,1800,1,n=>rules.maxSeconds=n),
        field('每口消耗（节）',rules.puffSegments,1,10,1,n=>rules.puffSegments=n),
        field('双倍消耗概率',rules.doubleChance,0,1,.01,n=>rules.doubleChance=n),
        field('烟雾浓度',rules.density,0,4,.05,n=>rules.density=n))
      const catalog=BRANDS.map(b=>{
        const row=rules.brands.find(item=>item.id===b.id)
        const enabled=h('input',{type:'checkbox'}) as HTMLInputElement
        enabled.checked=!!row
        const entry={id:b.id,price:row?.price??b.price}
        form.append(h('div',{class:'adm-npc-range'},h('label',null,enabled,b.name),field('单价',entry.price,5,60,1,n=>entry.price=n)))
        return {enabled,entry}
      })
      const save=h('button',{class:'adm-btn',type:'submit'},'保存') as HTMLButtonElement
      form.append(save)
      form.onsubmit=async e=>{
        e.preventDefault()
        rules.brands=catalog.filter(b=>b.enabled.checked).map(b=>b.entry)
        if(!validRules(rules)){toast('请检查燃烧区间，并至少选择一个品牌','error');return}
        save.disabled=true
        try{await api('admin/smoke',rules);toast('已保存，新进场的玩家生效')}
        catch{toast('保存失败','error')}
        finally{save.disabled=false}
      }
      slot.replaceChildren(form)
    }).catch(error=>slot.replaceChildren(errorState(error,()=>render())))
  },
  npc() {
    paintTop(views.find(view=>view.key==='npc')!)
    const slot=h('div',{class:'adm-stack'},skeleton(8));main.append(slot)
    void Promise.all([api('admin/npc'),import('../../lib/npc')]).then(([settings,{npcDefaults,validNpc}])=>{
      type Rules=typeof npcDefaults
      const stored:Rules=structuredClone(validNpc(settings)?settings:npcDefaults)
      let saved=JSON.stringify(stored)
      paint(stored)
      function paint(initial:Rules){
      let rules:Rules=structuredClone(initial)
      const ROADS:[string,string,string][]=[['trunk','快速路','城市快速路与过境干道'],['primary','主干道','如解放路、中山路'],['secondary','次干道','连接各片区的城市道路'],['tertiary','支路','默认不开，开启后路人会进入小街']]
      const save=h('button',{type:'submit',class:'adm-btn',form:'adm-npc-form',disabled:''},'保存') as HTMLButtonElement
      const reset=h('button',{type:'button',class:'adm-btn adm-btn--ghost'},'恢复默认') as HTMLButtonElement
      const state=h('span',{class:'adm-sub adm-npc-state'},'已是最新')
      paintTop(views.find(view=>view.key==='npc')!,[state])
      top.querySelector('.adm-top-tools')!.prepend(reset,save)
      const problem=h('p',{class:'adm-npc-problem',role:'alert',hidden:''})
      const form=h('form',{class:'adm-npc',id:'adm-npc-form',novalidate:''}) as HTMLFormElement
      const number=(key:'carMin'|'carMax'|'personMin'|'personMax'|'bumpSpeed'|'bubbleSeconds',attrs:Record<string,string>)=>{
        const input=h('input',{type:'number',class:'adm-npc-num',inputmode:'decimal',...attrs}) as HTMLInputElement
        input.value=String(rules[key]);input.oninput=()=>{rules={...rules,[key]:input.valueAsNumber};changed()}
        return input
      }
      const toggle=(key:'horn'|'mutter'|'bubble',title:string,hint:string)=>{
        const input=h('input',{type:'checkbox',role:'switch'}) as HTMLInputElement
        input.checked=rules[key];input.onchange=()=>{rules={...rules,[key]:input.checked};changed()}
        return h('label',{class:'adm-npc-switch'},h('span',{class:'adm-npc-switch-text'},h('b',null,title),h('span',null,hint)),input,h('i',{'aria-hidden':'true'}))
      }
      const range=(label:string,unit:string,min:HTMLInputElement,max:HTMLInputElement,hint:string)=>
        h('div',{class:'adm-npc-range'},h('span',{class:'adm-npc-label'},label),h('span',{class:'adm-npc-pair'},min,h('span',{'aria-hidden':'true'},'—'),max,h('span',{class:'adm-npc-unit'},unit)),h('span',{class:'adm-sub'},hint))
      const roads=h('div',{class:'adm-npc-roads',role:'group','aria-label':'生成道路类别'},ROADS.map(([key,name,hint])=>{
        const input=h('input',{type:'checkbox',value:key}) as HTMLInputElement
        input.checked=rules.classes.includes(key);input.onchange=()=>{rules={...rules,classes:ROADS.map(([road])=>road).filter(road=>road===key?input.checked:rules.classes.includes(road))};changed()}
        return h('label',{class:'adm-npc-road'},input,h('span',null,h('b',null,name),h('small',null,hint)))
      }))
      const vol=h('input',{type:'range',min:'0',max:'1',step:'0.05',class:'adm-npc-vol','aria-label':'NPC 音量'}) as HTMLInputElement
      const volText=h('output',{class:'adm-npc-vol-text'})
      const showVol=()=>{volText.textContent=`${Math.round(rules.volume*100)}%`;vol.style.setProperty('--fill',`${rules.volume*100}%`)}
      vol.value=String(rules.volume);vol.oninput=()=>{rules={...rules,volume:vol.valueAsNumber};showVol();changed()};showVol()
      const lines=(key:'bumpLines'|'mutterLines',title:string,hint:string)=>{
        const area=h('textarea',{rows:'9',spellcheck:'false'}) as HTMLTextAreaElement,count=h('span',{class:'adm-sub'})
        const sync=()=>{const list=area.value.split('\n').map(line=>line.trim()).filter(Boolean);count.textContent=`${list.length} 句，随机抽取`;return list}
        area.value=rules[key].join('\n');sync();area.oninput=()=>{rules={...rules,[key]:sync()};changed()}
        return card(title,[area,count],{sub:hint})
      }
      const preview=h('span',{class:'adm-npc-bubble'},rules.bumpLines[0]??'')
      form.append(
        h('p',{class:'adm-note'},'保存后，新进入场景的玩家立即按新设置生效；已经在场景里的玩家要重新进入后才会更新。'),
        problem,
        card('生成范围与密度',[
          h('div',{class:'adm-npc-field'},h('span',{class:'adm-npc-label'},'可以生成的道路'),roads),
          h('div',{class:'adm-npc-ranges'},
            range('车辆','辆 / 每条街',number('carMin',{min:'1',max:'20',step:'1','aria-label':'每街最少车辆'}),number('carMax',{min:'1',max:'20',step:'1','aria-label':'每街最多车辆'}),'一条街 = 玩家 200 m 内同名的大路'),
            range('行人','人 / 每条街',number('personMin',{min:'1',max:'20',step:'1','aria-label':'每街最少行人'}),number('personMax',{min:'1',max:'20',step:'1','aria-label':'每街最多行人'}),'只走人行道和斑马线；没有人行道的路段不放人')),
        ],{sub:'小路、巷子、步行街始终不生成'}),
        h('div',{class:'adm-cols adm-npc-cols'},
          card('声音',[
            toggle('horn','车辆鸣笛','每辆车 10–30 秒随机按一次，越远越轻'),
            toggle('mutter','行人念叨','玩家 25 米内的路人 15–45 秒说一句，用浏览器的中文语音（当前已在代码中统一暂停路人语音播报，配置仍保留可随时恢复）'),
            h('div',{class:'adm-npc-volume'},h('span',{class:'adm-npc-label'},'NPC 音量'),vol,volText),
            h('p',{class:'adm-sub'},'在玩家自己设置的总音量基础上再乘这个比例。'),
          ]),
          card('碰撞气泡',[
            toggle('bubble','撞到路人时冒气泡','只显示文字，不播放语音；同一个路人 6 秒内只说一次'),
            h('div',{class:'adm-npc-inline'},
              h('label',null,h('span',{class:'adm-npc-label'},'触发速度'),h('span',{class:'adm-npc-pair'},number('bumpSpeed',{min:'0',max:'30',step:'0.1'}),h('span',{class:'adm-npc-unit'},'米/秒'))),
              h('label',null,h('span',{class:'adm-npc-label'},'显示时长'),h('span',{class:'adm-npc-pair'},number('bubbleSeconds',{min:'0.5',max:'15',step:'0.5'}),h('span',{class:'adm-npc-unit'},'秒')))),
            h('div',{class:'adm-npc-preview','aria-hidden':'true'},h('span',{class:'adm-sub'},'游戏里的样子'),preview),
          ]),
        ),
        h('div',{class:'adm-cols adm-npc-cols'},
          lines('bumpLines','碰撞台词','每行一句，最多 80 字；保持市井口吻，不要脏字'),
          lines('mutterLines','念叨台词','每行一句；会用合成语音念出来，3 秒内念完为宜')),
      )
      function problemText(){
        if(!rules.classes.length)return '至少选一类道路'
        for(const [a,b,name] of [['carMin','carMax','车辆'],['personMin','personMax','行人']] as const){
          if(![rules[a],rules[b]].every(value=>Number.isInteger(value)&&value>=1&&value<=20))return `${name}数量要是 1–20 的整数`
          if(rules[a]>rules[b])return `${name}的最少数量不能大于最多数量`
        }
        if(!(rules.bumpSpeed>=0&&rules.bumpSpeed<=30))return '触发速度要在 0–30 米/秒之间'
        if(!(rules.bubbleSeconds>.1&&rules.bubbleSeconds<=15))return '显示时长要在 0.5–15 秒之间'
        if(!rules.bumpLines.length||!rules.mutterLines.length)return '台词至少要有一句'
        if([...rules.bumpLines,...rules.mutterLines].some(line=>line.length>80))return '每句台词不能超过 80 字'
        return ''
      }
      function changed(){
        const error=problemText(),dirty=JSON.stringify(rules)!==saved
        problem.textContent=error;problem.hidden=!error
        save.disabled=!dirty||!!error;state.textContent=dirty?'有改动未保存':'已是最新';state.classList.toggle('is-dirty',dirty)
        preview.textContent=rules.bumpLines[0]??''
      }
      reset.onclick=()=>paint(npcDefaults)
      form.onsubmit=event=>{
        event.preventDefault();if(save.disabled)return
        save.classList.add('is-busy');save.disabled=true
        void api('admin/npc',rules).then(()=>{saved=JSON.stringify(rules);changed();toast('已保存，新进场的玩家生效')})
          .catch(error=>{changed();toast(error instanceof Error?error.message:'保存失败，请检查参数','error')})
          .finally(()=>save.classList.remove('is-busy'))
      }
      slot.replaceChildren(form);changed()
      }
    }).catch(error=>slot.replaceChildren(errorState(error,()=>render())))
  },
  security() {
    const banSlot = h('div')
    const banUidIn = h('input', { type: 'search', name: 'banuid', placeholder: '例如 102276', 'aria-label': '封禁 UID' }) as HTMLInputElement
    const banFpIn = h('input', { type: 'search', name: 'banfp', placeholder: '例如 6f771cf0012fec6b', 'aria-label': '封禁设备指纹' }) as HTMLInputElement
    const banMinSel = h('select', { name: 'banmin', class: 'adm-select', 'aria-label': '封禁时长' },
      h('option', { value: '0' }, '永久'),
      h('option', { value: '10' }, '10 分钟'),
      h('option', { value: '60' }, '1 小时'),
      h('option', { value: '1440' }, '24 小时'),
      h('option', { value: '10080' }, '7 天')) as HTMLSelectElement
    const banReasonIn = h('input', { type: 'search', name: 'banreason', placeholder: '可留空', 'aria-label': '封禁原因' }) as HTMLInputElement
    type Account = { uid: string | number; nickname: string | null; lastLogin: string | number | null }
    type Device = { fp: string; model: string; browser: string; screen: string; ip24: string; isp: string; city: string; first: number; last: number; accounts?: Account[] }
    const sub = (text: string) => h('div', {class:'adm-sub'}, text)
    const summary = (device: Device) => [device.model, device.browser, device.isp, device.city].map(v=>v || '—').join(' · ')
    const accountText = (account: Account) => `UID ${account.uid} · ${account.nickname || '—'} · 最近登录 ${when(unix(account.lastLogin))}`
    const nick = h('input', {type:'search',placeholder:'搜索玩家昵称'})
    const results = h('div', {'aria-live':'polite'})
    let generation = 0, timer = 0
    const clearSearch = () => { generation++; clearTimeout(timer); results.replaceChildren() }
    banUidIn.oninput = () => { clearSearch(); nick.value = '' }
    nick.oninput = () => {
      clearSearch(); banUidIn.value = ''
      const query = nick.value.trim(), current = generation
      if (!query) return
      timer = window.setTimeout(async () => {
        try {
          const candidates = await api<(Account & {devices:Device[]})[]>(`admin/user-search?q=${encodeURIComponent(query)}`, undefined, 'GET')
          if (current !== generation) return
          results.replaceChildren(...(candidates.length ? candidates.map(account=>h('button', {type:'button', class:'adm-btn', onclick:()=>{
            clearSearch(); nick.value = account.nickname || ''; banUidIn.value = String(account.uid)
            results.replaceChildren(...(account.devices.length ? account.devices.map(device=>sub(summary(device))) : [sub('暂无设备记录')]))
          }}, `${account.nickname || '—'} · UID ${account.uid} · 最近登录 ${when(unix(account.lastLogin))}`)) : [sub('没有匹配的昵称')]))
        } catch (error) { if (current === generation) results.replaceChildren(sub((error as Error).message)) }
      }, 250)
    }
    const banForms = h('form', { class: 'adm-mp-filters', role: 'search' },
      h('label', null, '昵称', nick), results,
      h('label', null, 'UID', banUidIn),
      h('label', null, '设备指纹', banFpIn),
      h('label', null, '时长', banMinSel),
      h('label', null, '原因', banReasonIn),
      h('button', { type: 'submit', class: 'adm-btn adm-btn--sm' }, '封禁'))
    const accountsView = (accounts: Account[]) => h('details', null, h('summary', null, `关联账号 (${accounts.length})`),
      accounts.length ? accounts.map(account=>sub(accountText(account))) : sub('暂无账号记录'))
    const deviceView = (device: Device) => h('details', null, h('summary', null, `${device.fp.slice(0,8)} · ${summary(device)}`),
      sub(`屏幕 ${device.screen || '—'} · 网段 ${device.ip24 || '—'}`),
      sub(`首次出现 ${when(device.first ? new Date(Number(device.first)) : null)} · 最近出现 ${when(device.last ? new Date(Number(device.last)) : null)}`),
      device.accounts && accountsView(device.accounts))
    const banKind = (row: any) => row.actor === 'protocol' ? ['攻击', 'is-bad'] : row.actor === 'auto' ? ['外挂', 'adm-ban-auto'] : ['人工', '']
    const banRow = (row: any) => {
      const [label, tone] = banKind(row)
      return h('tr', null,
        h('td', null, h('span', { class: `adm-pill ${tone}` }, label)),
        h('td', null, row.kind === 'uid' ? `${row.nickname || '—'} · UID ${row.value}` : [
          `设备 ${String(row.value).slice(0,8)} `, h('button', {type:'button',class:'adm-btn',onclick:async()=>{
            try { await navigator.clipboard.writeText(String(row.value)); toast('已复制指纹') } catch { toast('复制失败','error') }
          }}, '复制'), accountsView(row.accounts ?? [])],
          row.devices?.length ? row.devices.map(deviceView) : sub('暂无设备记录')),
        h('td', null, row.reason || '—', row.recordId && h('div', { class: 'adm-sub adm-ban-record' }, `记录 ${String(row.recordId).slice(0, 8)}`)),
        h('td', { class: 'adm-nowrap' }, row.until ? when(new Date(row.until)) : h('span', { class: 'adm-pill is-bad' }, '永久')),
        h('td', { class: 'adm-right' }, h('button', {
          type: 'button', class: 'adm-btn adm-btn--sm adm-btn--ghost',
          onclick: async () => {
            if (!confirm(`解除${row.kind === 'uid' ? ` UID ${row.value}` : '该设备'}的联机封禁？`)) return
            try {
              await api('admin/unban', { uid: row.kind === 'uid' ? Number(row.value) : undefined, fp: row.kind === 'fp' ? row.value : undefined })
              void loadBans()
            } catch (error) { alert(String((error as Error)?.message ?? error)) }
          },
        }, '解封')))
    }
    const kindLabel: Record<string, string> = {
      speed: '超速移动', teleport: '违规瞬移', head_overlap: '贴在他人头顶跟随', altitude_unverified: '异常升空 / 滞空（仅记录）', ground_unverified: '疑似钻地（仅记录）',
      mount_player: '请求骑乘他人', foreign_position: '改写他人位置', oversize: '超大消息', invalid_packet: '非法消息', packet_rate: '刷包超频',
    }
    const detailLabel: Record<string, string> = { overflow: '超出 (m)', to: '落点', peer: '对象玩家', target: '对象玩家', size: '大小', rate: '频率' }
    const attack = new Set(['mount_player', 'foreign_position', 'oversize', 'invalid_packet', 'packet_rate'])
    const coord = (value: unknown) => Array.isArray(value) ? value.map((n) => Math.round(Number(n))).join(', ') : ''
    const clock = (at: number) => { const d = new Date(at); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}` }
    const reviewCard = (review: any) => {
      const events = (Array.isArray(review.evidence) ? review.evidence : []) as any[]
      const counts = new Map<string, number>()
      for (const event of events) counts.set(event.kind, (counts.get(event.kind) ?? 0) + 1)
      const reasonIn = h('input', { type: 'text', class: 'adm-input', placeholder: '处罚原因（玩家会看到）', 'aria-label': '处罚原因',
        value: [...counts.keys()].map((k) => kindLabel[k] ?? k).join('、') }) as HTMLInputElement
      const minutesSel = h('select', { class: 'adm-select', 'aria-label': '处罚时长' },
        ...[['60', '1 小时'], ['1440', '24 小时'], ['10080', '7 天'], ['0', '永久']].map(([v, t]) => h('option', { value: v }, t))) as HTMLSelectElement
      minutesSel.value = '1440'
      const act = async (button: HTMLButtonElement, run: () => Promise<unknown>) => {
        button.disabled = true
        try { await run(); await loadBans() } catch (error) { button.disabled = false; alert(String((error as Error)?.message ?? error)) }
      }
      const confirmBtn = h('button', { type: 'button', class: 'adm-btn adm-btn--sm adm-btn--danger' }, '确认违规并封禁') as HTMLButtonElement
      confirmBtn.onclick = () => {
        const reason = reasonIn.value.trim()
        if (!reason) { reasonIn.focus(); return }
        void act(confirmBtn, () => api('admin/ban', { uid: review.uid, reviewId: review.id, minutes: Number(minutesSel.value), reason }))
      }
      const dismissBtn = h('button', { type: 'button', class: 'adm-btn adm-btn--sm adm-btn--ghost' }, '不处罚') as HTMLButtonElement
      dismissBtn.onclick = () => { if (confirm(`结束 UID ${review.uid} 的复核，不处罚？`)) void act(dismissBtn, () => api('admin/unban', { uid: review.uid, reviewId: review.id, dismiss: true })) }
      return h('article', { class: 'adm-review' },
        h('header', { class: 'adm-review-head' },
          h('div', null,
            h('b', null, `UID ${review.uid}`),
            h('span', { class: 'adm-sub' }, ` · ${when(new Date(Number(review.opened_ms)))} 进入复核 · ${events.length} 条证据`)),
          h('div', { class: 'adm-chips' }, ...[...counts].map(([k, n]) =>
            h('span', { class: `adm-pill ${attack.has(k) ? 'is-bad' : 'adm-ban-auto'}` }, `${kindLabel[k] ?? k} ×${n}`)))),
        h('details', { class: 'adm-review-evidence' },
          h('summary', null, '证据时间线'),
          h('div', { class: 'adm-table-wrap' }, h('table', { class: 'adm-table adm-table--dense' },
            h('thead', null, h('tr', null, ...['时间', '类型', '起点', '详情'].map((t) => h('th', null, t)))),
            h('tbody', null, ...events.map((event) => {
              const { from, ...rest } = event.detail ?? {}
              const extra = Object.entries(rest).map(([k, v]) => `${detailLabel[k] ?? k}：${Array.isArray(v) ? coord(v) : typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ')
              return h('tr', null, h('td', { class: 'adm-nowrap' }, clock(Number(event.at))), h('td', null, kindLabel[event.kind] ?? event.kind),
                h('td', { class: 'adm-nowrap' }, coord(from) || '—'), h('td', { class: 'adm-sub' }, extra || '—'))
            }))))),
        h('div', { class: 'adm-review-actions' }, reasonIn, minutesSel, confirmBtn, dismissBtn))
    }
    const ipReasonMeta: Record<string, [string, string]> = {
      honeypot: ['蜜罐命中', 'is-bad'],
      scanner: ['扫描器拦截', 'is-bad'],
      waf: ['WAF 累计', 'adm-ban-auto'],
      rate: ['入口限流', 'adm-ban-auto'],
      'login-failed': ['登录爆破', 'is-bad'],
      'login-attempt': ['撞库枚举', 'adm-ban-auto'],
    }
    const attackRuleIds = new Set(['waf', 'scanner', 'honeypot', 'rate', 'auto-ban', 'login-ip-lock', 'login-failed', 'login-attempt'])
    const ipStatVal = h('b', null, dash)
    const ipStatHint = h('span', { class: 'adm-delta' }, '入口 / 登录防护')
    const ipStatCard = h('div', { class: 'adm-kpi adm-kpi--static', title: '当前生效中的入口与登录 IP 封禁数' },
      h('span', { class: 'adm-kpi-label' }, '生效 IP 封禁'), ipStatVal, ipStatHint)
    const banStats = h('div', { class: 'adm-kpis adm-kpis--small' }, ipStatCard)
    const reviewSlot = h('div', { class: 'adm-reviews' })
    const loadBans = async () => {
      try {
        const data = await api<any>('admin/bans', undefined, 'GET')
        const rows = (data?.bans ?? []) as any[]
        const reviews = (data?.reviews ?? []) as any[]
        const count = (actor: string) => rows.filter((row) => row.actor === actor).length
        banStats.replaceChildren(
          serverStat('生效封禁', String(rows.length), `${when(new Date())} 刷新`),
          serverStat('待复核', String(reviews.length), reviews.length ? '多类违规，等待人工确认' : '没有待处理'),
          serverStat('外挂自动短封', String(count('auto'))),
          serverStat('攻击自动短封', String(count('protocol'))),
          serverStat('人工封禁', String(rows.length - count('auto') - count('protocol'))),
          ipStatCard)
        reviewSlot.replaceChildren(...(reviews.length ? reviews.map(reviewCard) : [emptyState('没有待复核的记录', '同一账号命中多类移动违规时会出现在这里，不会自动长封')]))
        banSlot.replaceChildren(rows.length
          ? h('div', { class: 'adm-table-wrap' }, h('table', { class: 'adm-table' },
            h('thead', null, h('tr', null, ['分类', '对象', '原因', '到期', ''].map((t) => h('th', null, t)))),
            h('tbody', null, ...rows.map(banRow))))
          : emptyState('当前没有生效中的封禁'))
        labelTables(banSlot)
      } catch (error) { banSlot.replaceChildren(errorState(error as Error, () => void loadBans())) }
    }
    banForms.addEventListener('submit', async (event) => {
      event.preventDefault()
      const uidValue = banUidIn.value.trim(), fpValue = banFpIn.value.trim()
      if (!uidValue && !fpValue) { alert('UID 和设备指纹至少填一个'); return }
      try {
        await api('admin/ban', {
          uid: uidValue ? Number(uidValue) : undefined,
          fp: fpValue || undefined,
          minutes: Number(banMinSel.value),
          reason: banReasonIn.value.trim() || undefined,
        })
        clearSearch(); nick.value = ''; banUidIn.value = ''; banFpIn.value = ''; banReasonIn.value = ''
        void loadBans()
      } catch (error) { alert(String((error as Error)?.message ?? error)) }
    })
    const banCard = card('生效中的封禁', [banSlot], {
      sub: '账号与设备指纹任一命中即拦；解封后玩家马上可以重连。',
      actions: [navLink('操作记录 →', { view: 'audit', target_type: 'mp' }, { class: 'adm-link' }), navLink('封禁申诉 →', { view: 'feedback', status: '', kind: '封禁申诉' }, { class: 'adm-link' })],
    })
    const manualCard = card('人工封禁', banForms, { sub: '立即生效，在线玩家会被断开并看到原因与申诉入口。' })
    const reviewCardWrap = card('待复核', reviewSlot, { sub: '多类违规只进复核，由管理员看过证据后决定是否处罚。' })

    const ipBanSlot = h('div', null, skeleton(3))
    const protectionSlot = h('div', null, skeleton(5))
    const ipBanRow = (ban: any) => {
      const [labelText, tone] = ipReasonMeta[ban.reason] ?? [ban.reason || '自动拦截', '']
      const unbanBtn = h('button', { type: 'button', class: 'adm-btn adm-btn--sm adm-btn--ghost' }, '解封') as HTMLButtonElement
      unbanBtn.onclick = async () => {
        const ok = await confirmDialog({
          title: '解除 IP 封禁',
          tone: 'jade',
          confirm: '确认解封',
          body: h('p', null, '确认解除 IP ', h('code', null, String(ban.ip)), ' 的封禁（', labelText, '）？解除后该 IP 可立即恢复访问，并记入操作记录。'),
        })
        if (ok === null) return
        await act(unbanBtn, async () => {
          await api('admin/bans/ip/unban', { ip: ban.ip })
          toast(`已解除 ${ban.ip} 的封禁`)
          await loadProtection()
        })
      }
      return h('tr', null,
        h('td', { class: 'adm-nowrap' }, h('span', { class: `adm-pill ${tone}` }, labelText)),
        h('td', { class: 'adm-nowrap' }, h('span', { class: 'adm-ban-target' }, h('code', null, String(ban.ip)))),
        h('td', { class: 'adm-nowrap' }, when(new Date(ban.expires))),
        h('td', { class: 'adm-right' }, unbanBtn))
    }
    const protectionStatusPill = (rule: any) => rule.enabled
      ? h('span', { class: 'adm-pill is-good' }, '已开启')
      : rule.id === 'reputation'
        ? h('span', { class: 'adm-pill' }, '未启用')
        : h('span', { class: 'adm-pill adm-ban-auto' }, '未开启')
    const loadProtection = async () => {
      try {
        const data = await api<{ rules: any[]; bans: any[] }>('admin/bans/protection', undefined, 'GET')
        const rules = data.rules ?? []
        const ipBans = data.bans ?? []
        ipStatVal.textContent = String(ipBans.length)
        ipStatHint.textContent = `${when(new Date())} 刷新`
        const table = h('table', { class: 'adm-table adm-protect' },
          h('thead', null, h('tr', null,
            h('th', null, '防护项'),
            h('th', null, '状态'),
            h('th', null, '阈值 / 策略'),
            h('th', { class: 'num' }, '规则数'),
            h('th', { class: 'num' }, '近 24 小时命中'))),
          h('tbody', null, ...rules.map((rule) => {
            const hitCount = Number(rule.hits ?? 0)
            const warnHits = hitCount > 0 && attackRuleIds.has(rule.id)
            return h('tr', null,
              h('td', { class: 'adm-nowrap' }, h('b', null, String(rule.name))),
              h('td', { class: 'adm-nowrap' }, protectionStatusPill(rule)),
              h('td', { class: 'adm-sub' }, String(rule.threshold ?? dash)),
              h('td', { class: 'num' }, fmt.int(Number(rule.count ?? 0))),
              h('td', { class: `num${warnHits ? ' is-bad' : ''}` }, fmt.int(hitCount)))
          })))
        protectionSlot.replaceChildren(h('div', { class: 'adm-table-wrap' }, table))
        labelTables(protectionSlot)
        ipBanSlot.replaceChildren(ipBans.length
          ? h('div', { class: 'adm-table-wrap' }, h('table', { class: 'adm-table' },
            h('thead', null, h('tr', null, ['分类', 'IP 地址', '到期', ''].map((t) => h('th', null, t)))),
            h('tbody', null, ...ipBans.map(ipBanRow))))
          : emptyState('当前没有生效中的 IP 封禁', '开启来源校验与入口处罚后，触发蜜罐、扫描器或高频攻击的可信来源 IP 会列在这里'))
        labelTables(ipBanSlot)
      } catch (error) {
        const node = errorState(error as Error, () => void loadProtection())
        protectionSlot.replaceChildren(node)
        ipBanSlot.replaceChildren(errorState(error as Error, () => void loadProtection()))
      }
    }
    const ipBanCard = card('生效中的 IP 封禁', [ipBanSlot], {
      sub: '仅对通过回源校验的可信客户端 IP 生效；人工解封后会同步清除该 IP 的近期拦截计数。',
      actions: [navLink('IP 审计记录 →', { view: 'audit', target_type: 'ip' }, { class: 'adm-link' })],
    })
    const protectionCard = card('当前防护项', [protectionSlot], {
      sub: '按当前服务运行开关、规则库规模与最近 24 小时拦截记录实时展示。',
    })
    void loadProtection()
    paintTop(views.find((v) => v.key === 'security')!, [h('span', { class: 'adm-live-dot', 'aria-hidden': 'true' }), h('span', { class: 'adm-sub adm-live-stamp' }, '每 10 秒刷新'),
      navLink('联机概况 →', { view: 'mp' }, { class: 'adm-link' })])
    main.append(h('div', { class: 'adm-stack' }, card('封禁管理', [banStats, reviewCardWrap, banCard, manualCard, ipBanCard, protectionCard]), screenshotTrace(loadBans)))
    void loadBans()
    refreshTimer = window.setInterval(() => {
      if (document.visibilityState !== 'visible' || document.querySelector('dialog.adm-dialog')) return
      if (![reviewSlot, banSlot].some((slot) => slot.querySelector('details[open]') || slot.contains(document.activeElement))) void loadBans()
      if (!protectionSlot.contains(document.activeElement) && !ipBanSlot.contains(document.activeElement)) void loadProtection()
    }, 10000)
  },
  mp() {
    const stamp = h('span', { class: 'adm-sub adm-live-stamp' })
    paintTop(views.find((v) => v.key === 'mp')!, [
      h('span', { class: 'adm-live-dot', 'aria-hidden': 'true' }),
      stamp,
      navLink('安全中心 →', { view: 'security' }, { class: 'adm-link' }),
      navLink('运维侧 · 联机引擎 →', { view: 'rt' }, { class: 'adm-link' }),
    ])
    const range = ['24h', '7d', '30d', '90d'].includes(params.get('mprange') ?? '') ? params.get('mprange')! : '24h'
    const gpRange = ['24h', '7d', '30d', '90d'].includes(params.get('gprange') ?? '') ? params.get('gprange')! : '7d'
    const actRange = ['24h', '7d', '30d'].includes(params.get('actrange') ?? '') ? params.get('actrange')! : '7d'
    const uid = /^\d+$/.test(params.get('uid') ?? '') ? params.get('uid') : null
    const actFilter = params.get('act') ?? ''
    const kindFilter = params.get('actkind') ?? ''
    const actQ = params.get('actq') ?? ''

    const liveSlot = h('div')
    const gpSlot = h('div')
    const actSlot = h('div')
    const histSlot = h('div')
    const sessSlot = h('div')

    const actSearchIn = h('input', { type: 'search', name: 'actq', value: actQ, placeholder: '搜昵称 / UID / 地标 / 内容', 'aria-label': '搜索活动记录' }) as HTMLInputElement
    const actForm = h('form', { class: 'adm-mp-filters', role: 'search' },
      h('label', null, '玩法',
        select('act', actFilter, [['', '全部玩法'], ...Object.entries(mpActivityMeta).map(([k, v]) => [k, v.label] as [string, string])],
          (value) => go({ act: value || null }, true, true), '按玩法筛选')),
      h('label', null, '事件',
        select('actkind', kindFilter, [
          ['', '全部事件'], ['activity', '开始玩法'], ['activity_end', '结束玩法'], ['join', '进入联机'],
          ['leave', '离开联机'], ['chat', '发言聊天'], ['emote', '使用表情'], ['avatar', '更换造型'],
        ], (value) => go({ actkind: value || null }, true, true), '按事件类型筛选')),
      actSearchIn,
      h('button', { type: 'submit', class: 'adm-btn adm-btn--sm' }, '筛选'),
      (uid || actFilter || kindFilter || actQ)
        ? navLink('清除筛选', { uid: null, act: null, actkind: null, actq: null }, { class: 'adm-btn adm-btn--sm adm-btn--ghost' }, true)
        : null)
    actForm.addEventListener('submit', (event) => {
      event.preventDefault()
      go({ actq: actSearchIn.value.trim() || null }, true, true)
    })

    const activityCard = card(uid ? `账户最近活动记录 · UID ${uid}` : '账户最近活动记录（每个账户最近在做什么）', [actForm, actSlot], {
      sub: '点击任意账户芯片或在线玩家可聚焦该账户的玩法与行为时间线，实时合并持久化流水与当前在线事件',
      actions: segmented(actRange, [['24h', '24 小时'], ['7d', '7 天'], ['30d', '30 天']], (key) => go({ actrange: key }, true, true), '活动时间范围'),
    })
    activityCard.id = 'adm-mp-activities'

    main.append(h('div', { class: 'adm-stack' },
      liveSlot,
      card('玩法占用玩家时间对比', gpSlot, {
        sub: '统计每个玩法在所选时间段内占用的总玩家时长、占比、独立参与人数与趋势，方便对比哪种玩法最吸引玩家',
        actions: segmented(gpRange, [['24h', '24 小时'], ['7d', '7 天'], ['30d', '30 天'], ['90d', '90 天']], (key) => go({ gprange: key }, true, true), '玩法分析范围'),
      }),
      activityCard,
      card('同时在线历史', histSlot, {
        sub: '按上海时间分日；24 小时为分钟点，更长为小时均值',
        actions: segmented(range, [['24h', '24 小时'], ['7d', '7 天'], ['30d', '30 天'], ['90d', '90 天']], (key) => go({ mprange: key }, true, true), '历史范围'),
      }),
      card(uid ? `会话记录 · UID ${uid}` : '会话记录', sessSlot, {
        sub: '最近 100 场，每分钟同步；联机服务重启时没观测到离开的记为「未观测到离开」',
        actions: uid ? navLink('看全部玩家', { uid: null }, { class: 'adm-link' }, true) : undefined,
      })))

    const mine = generation
    let last = ''
    const load = (first: boolean) =>
      Promise.all([api<any>('admin/mp'), loadManifest()]).then(([state, world]) => {
        if (mine !== generation) return
        stamp.textContent = `每 10 秒自动刷新 · ${when(new Date())}`
        const json = JSON.stringify(state)
        if (json === last) return
        last = json
        liveSlot.replaceChildren(paintMp(state, world, () => load(false)))
        labelTables(liveSlot)
      }).catch((error) => {
        if (mine !== generation) return
        if (error instanceof ApiError && [401, 403].includes(error.status)) return denied(error.status)
        if (first) liveSlot.replaceChildren(errorState(error, () => load(true)))
        else stamp.textContent = `自动刷新失败：${error.message}`
      })
    liveSlot.append(skeleton(6))
    load(true)
    refreshTimer = window.setInterval(() => {if(document.visibilityState==='visible'&&!document.querySelector('dialog.adm-dialog'))void load(false)}, 10000)

    const actParams = new URLSearchParams({ range: actRange, limit: '100' })
    if (uid) actParams.set('uid', uid)
    if (actFilter) actParams.set('activity', actFilter)
    if (kindFilter) actParams.set('kind', kindFilter)
    if (actQ) actParams.set('q', actQ)

    async(gpSlot, () => api<any>(`admin/mp/gameplay?range=${gpRange}`), paintMpGameplay, skeleton(5))
    async(actSlot, () => api<any>(`admin/mp/activities?${actParams}`), (data) => paintMpActivities(data, uid), skeleton(5))
    async(histSlot, () => api<any>(`admin/mp/history?range=${range}`), paintMpHistory, skeleton(5))
    async(sessSlot, () => api<any>(`admin/mp/sessions?limit=100${uid ? `&uid=${uid}` : ''}`), paintMpSessions, skeleton(5))
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
        navLink([text, n != null ? h('em', null, n) : null], { view: 'feedback', status: key, q: query || null, user, kind: params.get('kind') }, {
          class: `adm-tab ${status === key ? 'is-on' : ''} ${key === 'pending' && n ? 'is-alert' : ''}`, role: 'tab', 'aria-selected': String(status === key),
        })))
    }
    paintTabs(lastStats ?? undefined)
    api('admin/stats').then((stats) => {
      lastStats = stats
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
      if(params.get('kind')==='封禁申诉')q.set('kind','封禁申诉')
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
        labelTables(main)
        paintMore(page.next_cursor)
      }))
      more.append(button)
    }
    async(slot, () => load(), (page) => {
      if (!page.items.length)
        return emptyState(status === 'pending' ? '没有待处理的反馈' : '没有符合条件的反馈', status === 'pending' ? '新的反馈提交后会出现在这里' : undefined)
      body.replaceChildren(...rowsOf(page.items))
      paintMore(page.next_cursor)
      return [h('div', { class: 'adm-table-wrap' }, h('table', { class: 'adm-table adm-feedback-list' },
        h('thead', null, h('tr', null, ['反馈', '状态', '提交人', '提交时间', '最近更新'].map((t) => h('th', null, t)))), body)), more]
    }, skeleton(8))
  },

  users() {
    const detailId = params.get('id')
    if (detailId) return userDetail(detailId)
    const role = params.get('role') ?? '',
      query = params.get('q') ?? '',
      signup = params.get('signup') ?? '',
      bound = params.get('bound') ?? '',
      state = params.get('state') ?? ''
    const statsSlot = h('div', { class: 'adm-kpis adm-kpis--small' })
    const search = h('input', { type: 'search', name: 'q', value: query, placeholder: '搜索邮箱或昵称', 'aria-label': '搜索用户' })
    const form = h('form', { class: 'adm-search', role: 'search' }, search, h('button', { class: 'adm-btn', type: 'submit' }, '搜索'))
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      go({ q: search.value.trim() || null }, true)
    })
    const channels = Object.entries(socialName) as [string, string][]
    const filters = h('div', { class: 'adm-toolbar adm-user-filters' },
      h('label', null, '注册方式', select('signup', signup, [['', '全部'], ['email', '邮箱'], ...channels], (value) => go({ signup: value || null }, true), '注册方式')),
      h('label', null, '已绑定', select('bound', bound, [['', '不限'], ...channels], (value) => go({ bound: value || null }, true), '已绑定渠道')),
      h('label', null, '状态', select('state', state, [['', '全部'], ['active', '正常'], ['banned', '已封禁']], (value) => go({ state: value || null }, true), '账号状态')))
    const slot = h('div')
    main.append(statsSlot, signupCard(),
      h('div', { class: 'adm-toolbar adm-toolbar--split' },
        segmented(role, [['', '全部'], ['admin', '管理员'], ['user', '普通用户']], (value) => go({ role: value || null }, true), '角色'), form),
      filters,
      card(null, slot, { className: 'adm-card--flush' }),
      h('p', { class: 'adm-note' }, '管理员可以查看全部数据、处理反馈和调整他人身份。只有已验证邮箱的用户才能设为管理员；系统始终保留至少一位管理员。封禁会立即让该用户下线，并拒绝其邮箱和第三方登录；管理员需先取消身份才能封禁。'))
    async(statsSlot, () => api<any>('admin/stats'), (stats) => [
      serverStat('用户总数', fmt.int(num(stats.total))),
      serverStat('已验证邮箱', fmt.int(num(stats.verified))),
      serverStat('24 小时新增', fmt.int(num(stats.new_24h))),
      serverStat('管理员', fmt.int(num(stats.admins))),
      serverStat('已封禁', fmt.int(num(stats.banned))),
    ], skeleton(1, 'adm-skel--kpi'))
    const body = h('tbody'),
      more = h('div', { class: 'adm-more' })
    const load = (cursor?: string) => {
      const q = new URLSearchParams()
      if (role) q.set('role', role)
      if (query) q.set('q', query)
      if (signup) q.set('signup', signup)
      if (bound) q.set('bound', bound)
      if (state) q.set('status', state)
      if (cursor) q.set('cursor', cursor)
      return api<{ items: any[]; next_cursor: string | null }>('admin/users?' + q)
    }
    const row = (user: any): HTMLTableRowElement => {
      const self = user.id === me.id,
        admin = user.role === 'admin',
        banned = !!num(user.banned_at)
      const button = h('button', {
        type: 'button',
        class: `adm-btn ${admin ? 'adm-btn--ghost' : 'adm-btn--jade'}`,
        disabled: (!admin && (!user.verified || banned)) || (admin && self),
        title: banned && !admin ? '已封禁的账号不能设为管理员' : !admin && !user.verified ? '该用户尚未验证邮箱' : admin && self ? '不能取消自己的管理员身份' : undefined,
      }, admin ? '取消管理员' : '设为管理员')
      button.addEventListener('click', () => act(button, async () => {
        const target = admin ? 'user' : 'admin'
        const ok = await confirmDialog({
          title: admin ? '取消管理员身份' : '设为管理员',
          tone: admin ? 'seal' : 'jade',
          confirm: admin ? '确认取消' : '确认设为管理员',
          body: h('div', null,
            h('p', null, h('b', null, user.nickname || user.email), `（${userContact(user)}）`),
            h('p', null, admin ? '取消后 TA 将无法再进入管理后台、处理反馈或修改他人身份。' : '设为管理员后，TA 可以查看全部遥测数据、处理反馈，并能设置或取消其他人的管理员身份。'),
            h('p', { class: 'adm-sub' }, '此操作会记录在「操作记录」中。')),
        })
        if (ok == null) return
        const result = await api<{ id: string; role: string }>(`admin/users/${encodeURIComponent(user.id)}/role`, { role: target })
        toast(result.role === 'admin' ? `已将 ${user.nickname || user.email} 设为管理员` : `已取消 ${user.nickname || user.email} 的管理员身份`)
        staleAll()
        repaint({ ...user, role: result.role })
      }))
      const ban = banButton(user, self, (next) => repaint({ ...user, ...next }))
      const repaint = (next: any) => {
        const fresh = row(next)
        current.replaceWith(fresh)
        current = fresh
      }
      let current = h('tr', { class: banned ? 'is-banned' : '' },
        h('td', { class: 'adm-cell-who' }, h('span', { class: 'adm-who' },
          h('b', null, navLink(user.nickname || '（未设置昵称）', { view: 'users', id: user.id }, { class: 'adm-link' }), self ? h('em', { class: 'adm-you' }, '你') : null),
          h('small', null, userContact(user)))),
        h('td', { 'data-label': '注册方式' }, signupTag(user.signup_method)),
        h('td', { 'data-label': '已绑定' }, channelChips(user)),
        h('td', { 'data-label': '状态' }, h('span', { class: 'adm-tags' },
          banned
            ? h('span', { class: 'adm-pill adm-banned', title: `封禁原因：${user.ban_reason || '未填写'}` }, '已封禁')
            : h('span', { class: `adm-pill ${admin ? 'adm-role--admin' : 'adm-muted'}` }, admin ? '管理员' : '用户'),
          !user.email_placeholder && !user.verified ? h('span', { class: 'adm-pill adm-muted' }, '邮箱未验证') : null)),
        h('td', { 'data-label': '注册时间' }, when(unix(user.created_at), true)),
        h('td', { class: 'num', 'data-label': '反馈' }, num(user.feedback_count) ? navLink(fmt.int(num(user.feedback_count)), { view: 'feedback', status: '', user: user.id }, { class: 'adm-link' }) : '0'),
        h('td', { class: 'adm-actions' }, h('span', { class: 'adm-btns' }, button, ban)))
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
      body.replaceChildren(...page.items.map(row))
      paintMore(page.next_cursor)
      return [h('div', { class: 'adm-table-wrap' }, h('table', { class: 'adm-table adm-users' },
        h('thead', null, h('tr', null, ['用户', '注册方式', '已绑定', '状态', '注册时间', '反馈', ''].map((t, i) => h('th', { class: i === 5 ? 'num' : '' }, t)))), body)), more]
    }, skeleton(8))
  },

  chat() {
    const tab = ['messages', 'reviews', 'mutes', 'words', 'settings'].includes(params.get('tab') ?? '') ? params.get('tab')! : 'messages'
    const reviewBadge = h('em', { class: 'adm-badge', hidden: true })
    const tabs = h('nav', { class: 'adm-chat-tabs', 'aria-label': '聊天管理' },
      ([['messages', '消息'], ['reviews', '待复核'], ['mutes', '禁言'], ['words', '敏感词'], ['settings', '设置与公告']] as [string, string][]).map(([key, text]) =>
        navLink([text, key === 'reviews' ? reviewBadge : null], { view: 'chat', tab: key === 'messages' ? null : key }, { class: `adm-chat-tab ${key === tab ? 'is-on' : ''}`, 'aria-current': key === tab ? 'page' : undefined })))
    main.append(tabs)
    api<any[]>('admin/chat/reviews?limit=100').then((rows) => {
      if (!rows.length) return
      reviewBadge.hidden = false
      reviewBadge.textContent = rows.length >= 100 ? '99+' : String(rows.length)
    }).catch(() => {})
    chatPages[tab]()
  },

  audit() {
    const type = params.get('target_type') ?? ''
    const slot = h('div')
    main.append(
      h('div', { class: 'adm-toolbar' }, segmented(type, [['', '全部'], ['user', '身份变更'], ['feedback', '反馈处理'], ['chat', '聊天管理'], ['mp', '联机封禁'], ['ip', 'IP 封禁']], (value) => go({ target_type: value || null }, true), '对象类型')),
      card(null, slot, { className: 'adm-card--flush' }))
    const actions: Record<string, string> = {
      role: '调整身份', status: '变更状态', start_ai: '发起 AI 制作', reply: '回复提交人',
      ban: '封禁账号', unban: '解除封禁', merge_users: '合并账号', reset_password: '重置密码', change_email: '修改邮箱', 'mp.kick': '踢出联机','mp.ban':'联机封禁','mp.unban':'联机解封','mp.dismiss':'复核不处罚',
      'web.ip.ban': 'IP 自动封禁', 'web.ip.unban': 'IP 人工解封',
      'chat.mute': '聊天禁言', 'chat.unmute': '解除禁言', 'chat.delete': '删除消息', 'chat.approve': '放行消息', 'chat.block': '拦截消息', 'chat.notice': '发布公告', 'chat.settings': '修改聊天规则', 'chat.words': '编辑敏感词', 'chat.words/delete': '删除敏感词', 'chat.lexicon_policy': '词库升级',
    }
    const ipReasonLabel: Record<string, string> = {
      honeypot: '蜜罐命中', scanner: '扫描器拦截', waf: 'WAF 累计', rate: '入口限流', 'login-failed': '登录爆破', 'login-attempt': '撞库枚举',
    }
    const body = h('tbody'),
      more = h('div', { class: 'adm-more' })
    const load = (cursor?: string) => {
      const q = new URLSearchParams()
      if (type) q.set('target_type', type)
      if (cursor) q.set('cursor', cursor)
      return api<{ items: any[]; next_cursor: string | null }>('admin/audit?' + q)
    }
    const who = (id: string, info?: { nickname?: string; email?: string; placeholder?: number }, link = false) => {
      if (!link && id === 'web-guard') return h('span', { class: 'adm-who' }, h('b', null, '网站入口防护'), h('small', null, '自动规则'))
      const name = info?.nickname || (info?.email && !info?.placeholder ? info.email : `用户 ${String(id).slice(0, 8)}`)
      return h('span', { class: 'adm-who' },
        h('b', null, link ? navLink(name, { view: 'users', id }, { class: 'adm-link' }) : name),
        info?.email && !info?.placeholder ? h('small', null, info.email) : null)
    }
    const rowsOf = (items: any[]) => items.map((item) => {
      const detail = typeof item.detail === 'string' ? JSON.parse(item.detail || '{}') : item.detail ?? {}
      const what: Child =
        item.action === 'role' ? (detail.role === 'admin' ? '设为管理员' : '取消管理员')
        : item.action === 'status' || item.action === 'start_ai' ? h('span', { class: 'adm-flow' }, detail.from ? pill(detail.from) : null, '→', detail.to ? pill(detail.to) : null)
        : item.action === 'change_email' ? h('span', { class: 'adm-flow' }, h('span', null, detail.from || '（无）'), '→', h('span', null, detail.to || dash))
        : item.action === 'merge_users' ? `并入 ${detail.from_email || String(detail.from ?? '').slice(0, 8) || '另一个账号'}${Array.isArray(detail.moved) && detail.moved.length ? ` · 搬来 ${detail.moved.length} 个绑定` : ''}`
        : item.action === 'ban' ? `原因：${detail.reason || '未填写'}`
        : item.action === 'reset_password' ? (detail.generated ? '生成了新密码' : '设置了新密码')
        : item.action === 'chat.mute' ? `${detail.until === -1 ? '永久' : detail.until ? `至 ${when(new Date(Number(detail.until)))}` : ''} · ${detail.source === 'auto' ? '自动' : ''}${detail.reason || ''}`
        : item.action === 'chat.words' ? `「${detail.word?.word ?? ''}」→ ${chatAction[detail.word?.action] ?? ''}${detail.word?.enabled === false ? '（停用）' : ''}`
        : item.action.startsWith('web.ip.') ? [ipReasonLabel[detail.reason] ?? detail.reason, detail.expires ? `至 ${when(new Date(detail.expires))}` : null].filter(Boolean).join(' · ')
        : item.action.startsWith('mp.') ? [detail.reason,detail.recordId,detail.reviewId].filter(Boolean).join(' · ')
        : item.action.startsWith('chat.') ? detail.reason || ''
        : ''
      const target = item.target_type === 'feedback'
        ? navLink('查看反馈', { view: 'feedback', id: item.target_id }, { class: 'adm-link' })
        : item.target_type === 'user' ? who(item.target_id, { nickname: item.target_nickname, email: item.target_email, placeholder: item.target_placeholder }, true)
        : item.target_type === 'chat' ? h('code', null, ['chat.mute', 'chat.unmute'].includes(item.action) ? `UID ${item.target_id}` : `#${item.target_id}`)
        : h('code', null, String(item.target_id ?? dash))
      return h('tr', null,
        h('td', { class: 'adm-audit-time' }, when(unix(item.created_at), true)),
        h('td', { class: 'adm-audit-actor' }, who(item.actor_id, { nickname: item.actor_nickname, email: item.actor_email, placeholder: item.actor_placeholder })),
        h('td', { class: 'adm-audit-action' }, actions[item.action] ?? item.action),
        h('td', { class: 'adm-audit-change' }, what),
        h('td', { class: 'adm-audit-target' }, target))
    })
    const paintMore = (next: string | null) => {
      more.replaceChildren()
      if (!next) return
      const button = h('button', { class: 'adm-btn adm-btn--ghost', type: 'button' }, '加载更多')
      button.addEventListener('click', () => act(button, async () => {
        const page = await load(next)
        body.append(...rowsOf(page.items))
        labelTables(main)
        paintMore(page.next_cursor)
      }))
      more.append(button)
    }
    async(slot, () => load(), (page) => {
      if (!page.items.length) return emptyState('还没有操作记录', '设置管理员、变更反馈状态、发起制作和回复都会记在这里')
      body.replaceChildren(...rowsOf(page.items))
      paintMore(page.next_cursor)
      return [h('div', { class: 'adm-table-wrap' }, h('table', { class: 'adm-table adm-audit' },
        h('thead', null, h('tr', null, ['时间', '操作人', '动作', '变化', '对象'].map((t) => h('th', null, t)))), body)), more]
    }, skeleton(8))
  },
}

/* ───────────── 聊天管理（IDOK-248） ───────────── */
const chatStatus: Record<string, string> = { normal: '正常', pending: '待复核', blocked: '已拦截', deleted: '已删除' }
const chatSource: Record<string, string> = { admin: '管理员', auto: '自动' }
const chatAction: Record<string, string> = { block: '拦截', review: '复核', allow: '白名单' }
const chatErrors = (error: unknown) => {
  if (error instanceof ApiError && error.status === 503) return new ApiError(503, 'chat', '聊天服务连不上（联机服务未启动或未配置）')
  return error
}
const chatApi = <T = any>(path: string, data?: unknown) => api<T>(`admin/chat/${path}`, data).catch((error) => { throw chatErrors(error) })
function chatCh(ch: string) {
  return h('span', { class: `adm-chat-ch adm-chat-ch--${ch}` }, ch === 'near' ? '附近' : '世界')
}
function chatPill(status: string) {
  return h('span', { class: `adm-pill adm-chat-st adm-chat-st--${status}` }, chatStatus[status] ?? status)
}
function chatUntil(until: number) {
  if (until === -1) return '永久'
  if (!until) return '已解除'
  const left = until - Date.now()
  return left <= 0 ? '已到期' : `${when(new Date(until))} 到期 · 剩 ${fmt.sec(left / 1000)}`
}
const contactName: Record<string, string> = { url: '网址', qq: 'QQ 号', wechat: '微信号' }
/** 为什么被拦 / 待复核：把审核标签翻成人话。 */
function chatWhy(row: any) {
  const summary = typeof row.summary === 'string' ? JSON.parse(row.summary || '{}') : row.summary ?? {}
  if (row.provider === 'local') {
    if (summary.contact) return `疑似导流：${contactName[summary.contact] ?? summary.contact}`
    return row.label === 'block' ? '命中拦截词' : row.label === 'review' ? '命中复核词' : row.label === 'seed_missing' ? '词库未就绪，转人工' : `本地词库：${row.label}`
  }
  if (row.label === 'provider_error') return `外部审核（${row.provider}）出错，转人工`
  if (row.label === 'unavailable') return '外部审核不可用，转人工'
  return `外部审核（${row.provider}）：${row.label === 'risky' ? '违规' : row.label === 'review' ? '疑似' : row.label}`
}
function chatSender(row: any) {
  if (row.sys) return h('span', { class: 'adm-who' }, h('b', null, '系统公告'))
  const name = row.account?.id ? navLink(row.name, { view: 'users', id: row.account.id }, { class: 'adm-link' }) : row.name
  return h('span', { class: 'adm-who' }, h('b', null, name),
    h('small', null, navLink(`UID ${row.uid}`, { view: 'chat', tab: null, uid: String(row.uid), name: null, q: null, status: null, ch: null, offset: null }, { class: 'adm-link', title: '只看这位玩家' }),
      row.account?.banned ? ' · 账号已封禁' : ''))
}
/** 禁言对话框：档位 + 自定义分钟 + 原因。返回 null = 取消。 */
async function chatMuteDialog(uid: number, name: string) {
  const presets: [string, string][] = [['60', '1 小时'], ['720', '12 小时'], ['1440', '24 小时'], ['10080', '7 天'], ['-1', '永久'], ['custom', '自定义']]
  const custom = h('input', { type: 'number', min: 1, max: 5256000, step: 1, placeholder: '分钟数', class: 'adm-chat-num', hidden: true, 'aria-label': '自定义分钟数' }) as HTMLInputElement
  let picked = '60'
  const seg = h('div', { class: 'adm-seg adm-chat-presets', role: 'radiogroup', 'aria-label': '禁言时长' })
  const paint = () => {
    seg.replaceChildren(...presets.map(([key, text]) => h('button', {
      type: 'button', role: 'radio', 'aria-checked': String(key === picked), class: key === picked ? 'is-on' : '',
      onclick: (() => { picked = key; custom.hidden = key !== 'custom'; paint(); if (key === 'custom') custom.focus() }) as EventListener,
    }, text)))
  }
  paint()
  const reason = await confirmDialog({
    title: '禁言', tone: 'seal', confirm: '确认禁言',
    body: h('div', null,
      h('p', null, h('b', null, name || `UID ${uid}`), `（UID ${uid}）在附近和世界频道都不能发言，输入框会显示剩余时长和原因。`),
      h('div', { class: 'adm-dialog-field' }, h('span', null, '时长'), seg, custom),
      h('p', { class: 'adm-sub' }, '只影响聊天，不影响联机和账号。操作会记入「操作记录」。')),
    message: { label: '原因', required: true, placeholder: '例如：辱骂其他玩家、刷屏广告', max: 200, hint: '请填写原因，玩家会看到' },
  })
  if (reason == null) return null
  const minutes = picked === 'custom' ? Math.round(Number(custom.value)) : Number(picked)
  if (!(minutes === -1 || (Number.isSafeInteger(minutes) && minutes >= 1))) { toast('自定义时长要填正整数分钟', 'error'); return null }
  return { minutes, reason }
}
async function chatReason(title: string, body: Child, confirm: string, tone: 'seal' | 'jade' = 'seal') {
  return confirmDialog({ title, tone, confirm, body, message: { label: '原因', required: true, max: 200, placeholder: '会写入操作记录', hint: '请填写原因' } })
}
function chatMuteButton(uid: number, name: string, onDone: () => void, label = '禁言') {
  const button = h('button', { type: 'button', class: 'adm-btn adm-btn--sm adm-btn--ghost' }, label) as HTMLButtonElement
  button.addEventListener('click', () => act(button, async () => {
    const picked = await chatMuteDialog(uid, name)
    if (!picked) return
    await chatApi('mute', { uid, ...picked })
    toast(`已禁言 ${name || uid}`)
    onDone()
  }))
  return button
}
async function chatContext(row: any) {
  const items = await chatApi<any[]>(`context?mid=${row.id}&n=8`)
  const listNode = h('ol', { class: 'adm-chat-context' }, items.map((m) =>
    h('li', { class: `${String(m.id) === String(row.id) ? 'is-center' : ''} ${m.sys ? 'is-sys' : ''}` },
      h('div', { class: 'adm-chat-context-head' }, h('b', null, m.sys ? '系统公告' : m.name), m.sys ? null : h('small', null, `UID ${m.uid}`), h('time', null, when(new Date(Number(m.created_at)))),
        m.status !== 'normal' ? chatPill(m.status) : null),
      h('p', null, m.text))))
  const close = h('button', { type: 'button', class: 'ui-btn adm-dialog-ok' }, '关闭')
  const dialog = h('dialog', { class: 'ui-panel adm-dialog adm-chat-context-dialog' }, h('form', { method: 'dialog' },
    h('header', null, h('h2', null, `上下文 · ${row.ch === 'near' ? '附近（同一地点 60 m 内）' : '世界'}`)),
    h('div', { class: 'adm-dialog-body' }, listNode),
    h('footer', null, close))) as HTMLDialogElement
  document.body.append(dialog)
  const done = () => { dialog.close(); dialog.remove() }
  close.addEventListener('click', done)
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); done() })
  dialog.showModal()
  dialog.querySelector('.is-center')?.scrollIntoView({ block: 'center' })
}
/** 消息表（消息页和复核页共用）。 */
function chatMessages(review: boolean) {
  const f = { ch: params.get('ch') ?? '', status: params.get('status') ?? '', name: params.get('name') ?? '', uid: params.get('uid') ?? '', q: params.get('q') ?? '', from: params.get('from') ?? '', to: params.get('to') ?? '' }
  const input = (name: string, value: string, placeholder: string, type = 'search') =>
    h('input', { type, name, value, placeholder, 'aria-label': placeholder, class: 'adm-chat-input' }) as HTMLInputElement
  const nameIn = input('name', f.name, '昵称'), uidIn = input('uid', f.uid, 'UID', 'search'), qIn = input('q', f.q, '消息关键词')
  const local = (ms: string) => { if (!ms) return ''; const d = new Date(Number(ms)); return Number.isNaN(+d) ? '' : new Date(+d - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 16) }
  const fromIn = input('from', local(f.from), '开始时间', 'datetime-local'), toIn = input('to', local(f.to), '结束时间', 'datetime-local')
  const form = h('form', { class: 'adm-chat-filters', role: 'search' },
    h('label', null, '频道', select('ch', f.ch, [['', '全部'], ['world', '世界'], ['near', '附近']], (value) => go({ ch: value || null, offset: null }, true), '频道')),
    review ? null : h('label', null, '状态', select('status', f.status, [['', '全部'], ['normal', '正常'], ['pending', '待复核'], ['blocked', '已拦截'], ['deleted', '已删除']], (value) => go({ status: value || null, offset: null }, true), '状态')),
    h('label', null, '玩家', nameIn), h('label', null, 'UID', uidIn), h('label', { class: 'adm-chat-grow' }, '内容', qIn),
    h('label', null, '从', fromIn), h('label', null, '到', toIn),
    h('div', { class: 'adm-btns' },
      h('button', { class: 'adm-btn', type: 'submit' }, '筛选'),
      navLink('清空', { view: 'chat', tab: review ? 'reviews' : null }, { class: 'adm-btn adm-btn--ghost' })))
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const ms = (v: string) => (v ? String(new Date(v).getTime()) : null)
    go({ name: nameIn.value.trim() || null, uid: /^\d+$/.test(uidIn.value.trim()) ? uidIn.value.trim() : null, q: qIn.value.trim() || null, from: ms(fromIn.value), to: ms(toIn.value), offset: null }, true)
  })
  const slot = h('div')
  main.append(form, card(null, slot, { className: 'adm-card--flush' }),
    h('p', { class: 'adm-note' }, review
      ? '本地词库判为「疑似」、或外部审核失败的消息会停在这里，玩家看不到。放行后按原频道补发（附近频道发给原地点 60 m 内此刻在线的人）；拦截会计入违规次数，达到阈值自动禁言。'
      : '这里是全部聊天记录，包括被拦截和删除的，只有管理员能看到。删除会立刻从所有在线玩家的聊天框里移除。'))
  const body = h('tbody'), more = h('div', { class: 'adm-more' })
  const query = (offset: number) => {
    const q = new URLSearchParams({ limit: '50', offset: String(offset) })
    for (const [key, value] of Object.entries(f)) if (value && !(review && key === 'status')) q.set(key, value)
    return chatApi<any[]>(`${review ? 'reviews' : 'messages'}?${q}`)
  }
  const reload = () => { staleAll(); render({ keepScroll: true }) }
  const rowOf = (row: any) => {
    const actions = h('div', { class: 'adm-btns adm-chat-actions' })
    const ctx = h('button', { type: 'button', class: 'adm-btn adm-btn--sm adm-btn--ghost' }, '上下文') as HTMLButtonElement
    ctx.addEventListener('click', () => act(ctx, () => chatContext(row)))
    actions.append(ctx)
    if (row.status === 'pending') {
      const pass = h('button', { type: 'button', class: 'adm-btn adm-btn--sm adm-btn--jade' }, '放行') as HTMLButtonElement
      pass.addEventListener('click', () => act(pass, async () => {
        const reason = await chatReason('放行消息', h('p', null, '这条消息会按原频道补发出去：', h('q', null, row.text)), '放行', 'jade')
        if (reason == null) return
        await chatApi('approve', { mid: Number(row.id), reason }); toast('已放行'); reload()
      }))
      const block = h('button', { type: 'button', class: 'adm-btn adm-btn--sm adm-btn--danger' }, '拦截') as HTMLButtonElement
      block.addEventListener('click', () => act(block, async () => {
        const reason = await chatReason('拦截消息', h('div', null, h('p', null, h('q', null, row.text)), h('p', { class: 'adm-sub' }, '拦截会计入该玩家的违规次数，达到阈值自动禁言。要直接禁言请用「禁言」。')), '确认拦截')
        if (reason == null) return
        await chatApi('block', { mid: Number(row.id), reason }); toast('已拦截'); reload()
      }))
      actions.append(pass, block)
    }
    if (row.status !== 'deleted' && row.status !== 'pending') {
      const del = h('button', { type: 'button', class: 'adm-btn adm-btn--sm adm-btn--danger' }, '删除') as HTMLButtonElement
      del.addEventListener('click', () => act(del, async () => {
        const reason = await chatReason('删除消息', h('div', null, h('p', null, h('q', null, row.text)), h('p', { class: 'adm-sub' }, '在线玩家的聊天框会立刻移除这条消息，历史里也不再出现。')), '删除')
        if (reason == null) return
        await chatApi('delete', { mid: Number(row.id), reason }); toast('已删除'); reload()
      }))
      actions.append(del)
    }
    if (!row.sys && row.uid) actions.append(chatMuteButton(Number(row.uid), row.name, reload))
    const why = row.status !== 'normal' && row.label && !['pass', 'local_only', 'notice'].includes(row.label) ? h('small', { class: 'adm-chat-why' }, chatWhy(row)) : null
    return h('tr', { class: `adm-chat-row ${row.sys ? 'is-sys' : ''}` },
      h('td', { class: 'adm-chat-time' }, h('code', null, `#${row.id}`), h('small', null, when(new Date(Number(row.created_at))))),
      h('td', null, chatCh(row.ch)),
      h('td', null, chatSender(row)),
      h('td', { class: 'adm-chat-text' }, h('p', null, row.text), why),
      h('td', null, chatPill(row.status)),
      h('td', null, actions))
  }
  let offset = 0
  const paintMore = (rows: any[]) => {
    more.replaceChildren()
    if (rows.length < 50) return
    const button = h('button', { class: 'adm-btn adm-btn--ghost', type: 'button' }, '加载更多') as HTMLButtonElement
    button.addEventListener('click', () => act(button, async () => {
      offset += 50
      const page = await query(offset)
      body.append(...page.map(rowOf)); labelTables(main); paintMore(page)
    }))
    more.append(button)
  }
  async(slot, () => query(0), (rows) => {
    if (!rows.length) return review ? emptyState('没有待复核的消息', '疑似违规或外部审核失败的消息会出现在这里') : emptyState('没有符合条件的消息')
    body.replaceChildren(...rows.map(rowOf))
    paintMore(rows)
    return [h('div', { class: 'adm-table-wrap' }, h('table', { class: 'adm-table adm-chat-table' },
      h('thead', null, h('tr', null, ['消息', '频道', '发送者', '内容', '状态', '操作'].map((t) => h('th', null, t)))), body)), more]
  }, skeleton(8))
}
const chatPages: Record<string, () => void> = {
  messages: () => chatMessages(false),
  reviews: () => chatMessages(true),
  mutes() {
    const uid = /^\d+$/.test(params.get('muid') ?? '') ? params.get('muid')! : ''
    const uidIn = h('input', { type: 'search', name: 'muid', value: uid, placeholder: '输入 UID 查禁言历史 / 手动禁言', 'aria-label': 'UID', inputmode: 'numeric', class: 'adm-chat-input' }) as HTMLInputElement
    const form = h('form', { class: 'adm-search', role: 'search' }, uidIn, h('button', { class: 'adm-btn', type: 'submit' }, '查看'))
    form.addEventListener('submit', (event) => { event.preventDefault(); go({ muid: /^\d+$/.test(uidIn.value.trim()) ? uidIn.value.trim() : null }, true) })
    const reload = () => { staleAll(); render({ keepScroll: true }) }
    const activeSlot = h('div'), histSlot = h('div')
    main.append(h('div', { class: 'adm-toolbar adm-toolbar--split' }, h('span', { class: 'adm-sub' }, '禁言对附近、世界两个频道同时生效'), form),
      uid ? card(`UID ${uid} 的禁言记录`, histSlot, { className: 'adm-card--flush', actions: [chatMuteButton(Number(uid), '', reload, '禁言这位玩家'), navLink('返回', { muid: null }, { class: 'adm-link' }, true)] }) : '',
      card('正在禁言', activeSlot, { className: 'adm-card--flush', sub: '每位玩家只显示最近一次禁言；永久禁言需手动解除' }))
    const unmute = (row: any) => {
      const button = h('button', { type: 'button', class: 'adm-btn adm-btn--sm adm-btn--jade' }, '解除') as HTMLButtonElement
      button.addEventListener('click', () => act(button, async () => {
        const reason = await chatReason('解除禁言', h('p', null, h('b', null, row.name || `UID ${row.uid}`), ' 会立刻可以发言。'), '解除禁言', 'jade')
        if (reason == null) return
        await chatApi('unmute', { uid: Number(row.uid), reason }); toast('已解除'); reload()
      }))
      return button
    }
    const table = (rows: any[], history: boolean) => h('div', { class: 'adm-table-wrap' }, h('table', { class: 'adm-table adm-chat-mutes' },
      h('thead', null, h('tr', null, (history ? ['时间', '操作', '期限', '原因', '来源 / 操作人'] : ['玩家', '期限', '原因', '来源 / 操作人', '']).map((t) => h('th', null, t)))),
      h('tbody', null, rows.map((row) => history
        ? h('tr', null, h('td', null, when(new Date(Number(row.created_at)), true)), h('td', null, Number(row.until_ms) ? '禁言' : '解除'),
            h('td', null, Number(row.until_ms) ? chatUntil(Number(row.until_ms)) : dash), h('td', null, row.reason), h('td', null, chatSource[row.source] ?? row.source, ' · ', h('code', null, String(row.actor).slice(0, 8))))
        : h('tr', null,
            h('td', null, h('span', { class: 'adm-who' }, h('b', null, row.name || dash), h('small', null, navLink(`UID ${row.uid}`, { muid: String(row.uid) }, { class: 'adm-link' }, true)))),
            h('td', null, chatUntil(Number(row.until_ms))), h('td', null, row.reason),
            h('td', null, chatSource[row.source] ?? row.source, row.source === 'admin' ? [' · ', h('code', null, String(row.actor).slice(0, 8))] : null),
            h('td', null, unmute(row)))))))
    async(activeSlot, () => chatApi<any[]>('mutes?limit=200'), (rows) => rows.length ? table(rows, false) : emptyState('现在没有人被禁言'), skeleton(4))
    if (uid) async(histSlot, () => chatApi<any[]>(`mutes?uid=${uid}&limit=200`), (rows) => rows.length ? table(rows, true) : emptyState('这位玩家没有禁言记录'), skeleton(3))
  },
  words() {
    const q = params.get('wq') ?? '', action = params.get('waction') ?? ''
    const qIn = h('input', { type: 'search', name: 'wq', value: q, placeholder: '搜索词或类别', 'aria-label': '搜索敏感词', class: 'adm-chat-input' }) as HTMLInputElement
    const form = h('form', { class: 'adm-search', role: 'search' }, qIn, h('button', { class: 'adm-btn', type: 'submit' }, '搜索'))
    form.addEventListener('submit', (event) => { event.preventDefault(); go({ wq: qIn.value.trim() || null }, true) })
    const reload = () => { staleAll(); render({ keepScroll: true }) }
    // 新增
    const word = h('input', { name: 'word', placeholder: '词', maxlength: 100, required: true, class: 'adm-chat-input', 'aria-label': '词' }) as HTMLInputElement
    const category = h('input', { name: 'category', placeholder: '类别，例如 运营补充', maxlength: 80, value: '运营补充', class: 'adm-chat-input', 'aria-label': '类别' }) as HTMLInputElement
    let pick = 'block'
    const actSel = select('action', pick, [['block', '拦截'], ['review', '转复核'], ['allow', '白名单（地名等，不误判）']], (value) => (pick = value), '动作')
    const add = h('button', { class: 'adm-btn adm-btn--jade', type: 'submit' }, '添加') as HTMLButtonElement
    const addForm = h('form', { class: 'adm-chat-addword' }, word, category, actSel, add)
    addForm.addEventListener('submit', (event) => {
      event.preventDefault()
      act(add, async () => {
        const text = word.value.trim()
        if (!text) return
        await chatApi('words', { word: text, category: category.value.trim() || '运营补充', action: pick, enabled: true, reason: '后台新增' })
        toast(`已添加「${text}」，下一条消息起生效`); word.value = ''; reload()
      })
    })
    const slot = h('div')
    main.append(
      card('添加词条', addForm, { sub: '拦截 = 直接拒发并提示玩家；转复核 = 先不发出，进「待复核」；白名单 = 包含在其中的片段不判违规' }),
      h('div', { class: 'adm-toolbar adm-toolbar--split' },
        segmented(action, [['', '全部'], ['block', '拦截'], ['review', '复核'], ['allow', '白名单']], (value) => go({ waction: value || null }, true), '动作'), form),
      card(null, slot, { className: 'adm-card--flush' }),
      h('p', { class: 'adm-note' }, '初始词库来自开源项目 konsheng/Sensitive-lexicon（MIT），地名白名单来自世界地标与街道名。停用比删除更好：重新导入词库时不会复活停用或删除的词，也不会覆盖你改过的动作。'))
    const row = (item: any) => {
      const toggle = h('button', { type: 'button', class: `adm-btn adm-btn--sm ${item.enabled ? 'adm-btn--ghost' : 'adm-btn--jade'}` }, item.enabled ? '停用' : '启用') as HTMLButtonElement
      toggle.addEventListener('click', () => act(toggle, async () => {
        await chatApi('words', { id: Number(item.id), word: item.word, category: item.category, action: item.action, enabled: !item.enabled, reason: item.enabled ? '后台停用' : '后台启用' })
        toast(item.enabled ? '已停用' : '已启用'); reload()
      }))
      const change = select('action', item.action, [['block', '拦截'], ['review', '复核'], ['allow', '白名单']], (value) => {
        void chatApi('words', { id: Number(item.id), word: item.word, category: item.category, action: value, enabled: item.enabled, reason: '后台改动作' })
          .then(() => { toast('已更新'); reload() }).catch((error) => toast(error instanceof Error ? error.message : '更新失败', 'error'))
      }, '动作')
      const del = h('button', { type: 'button', class: 'adm-btn adm-btn--sm adm-btn--danger' }, '删除') as HTMLButtonElement
      del.addEventListener('click', () => act(del, async () => {
        const reason = await chatReason('删除词条', h('p', null, `删除「${item.word}」？重新导入词库也不会再加回来。只想暂时不用请点「停用」。`), '删除')
        if (reason == null) return
        await chatApi('words/delete', { id: Number(item.id), reason }); toast('已删除'); reload()
      }))
      return h('tr', { class: item.enabled ? '' : 'is-off' },
        h('td', null, h('b', { class: 'adm-chat-word' }, item.word)), h('td', null, item.category),
        h('td', null, change), h('td', null, item.source === 'manual' || !item.source ? '手动' : h('code', null, item.source)),
        h('td', null, when(item.updated_at ? new Date(Number(item.updated_at)) : null, true)),
        h('td', null, h('div', { class: 'adm-btns adm-chat-actions' }, toggle, del)))
    }
    const body = h('tbody'), more = h('div', { class: 'adm-more' })
    let offset = 0
    const load = (at: number) => {
      const p = new URLSearchParams({ limit: '100', offset: String(at) })
      if (q) p.set('q', q)
      if (action) p.set('action', action)
      return chatApi<any[]>(`words?${p}`)
    }
    const paintMore = (rows: any[]) => {
      more.replaceChildren()
      if (rows.length < 100) return
      const button = h('button', { class: 'adm-btn adm-btn--ghost', type: 'button' }, '加载更多') as HTMLButtonElement
      button.addEventListener('click', () => act(button, async () => { offset += 100; const page = await load(offset); body.append(...page.map(row)); labelTables(main); paintMore(page) }))
      more.append(button)
    }
    async(slot, () => load(0), (rows) => {
      if (!rows.length) return emptyState(q ? `没有包含「${q}」的词条` : '词库是空的', '可以在上方添加')
      body.replaceChildren(...rows.map(row)); paintMore(rows)
      return [h('div', { class: 'adm-table-wrap' }, h('table', { class: 'adm-table adm-chat-words' },
        h('thead', null, h('tr', null, ['词', '类别', '动作', '来源', '更新', ''].map((t) => h('th', null, t)))), body)), more]
    }, skeleton(8))
  },
  settings() {
    const slot = h('div'), noticeSlot = h('div')
    main.append(h('div', { class: 'adm-grid-2 adm-chat-settings' }, card('聊天规则', slot, { sub: '改动立即生效，并记入操作记录' }), card('发系统公告', noticeSlot, { sub: '以「网上桂林」名义高亮显示在玩家聊天框里' })))
    async(slot, () => chatApi<any>('settings'), (cfg) => {
      const field = (key: string, label: string, value: number, unit: string, scale = 1, hint?: string) =>
        h('label', { class: 'adm-chat-field' }, h('span', null, label), h('div', null, h('input', { type: 'number', name: key, value: +(value / scale).toFixed(2), min: 0, step: 'any', class: 'adm-chat-num' }), h('em', null, unit)), hint && h('small', null, hint))
      const steps = h('input', { name: 'steps_minutes', value: (cfg.steps_minutes ?? []).join(', '), class: 'adm-chat-input' }) as HTMLInputElement
      const policy = select('unmoderated_policy', cfg.unmoderated_policy, [['local_only', '本地词库通过即发出'], ['pending', '全部进人工复核']], () => {}, '无外部审核时')
      const save = h('button', { class: 'adm-btn adm-btn--jade', type: 'submit' }, '保存') as HTMLButtonElement
      const form = h('form', { class: 'adm-chat-form' },
        field('radius', '附近频道半径', cfg.radius, '米'),
        field('max_length', '单条字数上限', cfg.max_length, '字'),
        field('near_ms', '附近频道发言间隔', cfg.near_ms, '秒', 1000),
        field('world_ms', '世界频道发言间隔', cfg.world_ms, '秒', 1000, '防刷屏：同一玩家两条之间至少隔这么久'),
        field('threshold', '自动禁言阈值', cfg.threshold, '次违规'),
        field('window_hours', '违规统计窗口', cfg.window_hours, '小时'),
        h('label', { class: 'adm-chat-field' }, h('span', null, '自动禁言阶梯'), h('div', null, steps, h('em', null, '分钟')), h('small', null, '逗号分隔，第 1 次触发用第一档，再犯逐级升级，最后一档封顶')),
        h('label', { class: 'adm-chat-field' }, h('span', null, '无外部审核时'), policy),
        h('div', { class: 'adm-chat-field' }, h('span', null, '外部审核'), (() => { const on = !!cfg.provider && !['none', '未配置'].includes(cfg.provider); return h('b', { class: on ? 'adm-ok' : 'adm-muted' }, on ? `已配置：${cfg.provider === 'wechat' ? '微信内容安全' : cfg.provider}（只对带微信身份的玩家生效）` : '未配置 · 只用本地词库') })()),
        h('div', { class: 'adm-btns' }, save))
      form.addEventListener('submit', (event) => {
        event.preventDefault()
        act(save, async () => {
          const data = new FormData(form)
          const n = (key: string, scale = 1) => Math.round(Number(data.get(key)) * scale)
          const patch = {
            radius: n('radius'), max_length: n('max_length'), near_ms: n('near_ms', 1000), world_ms: n('world_ms', 1000), threshold: n('threshold'), window_hours: n('window_hours'),
            steps_minutes: String(data.get('steps_minutes')).split(/[,，\s]+/).filter(Boolean).map(Number), unmoderated_policy: String(data.get('unmoderated_policy')),
          }
          const reason = await chatReason('保存聊天规则', h('p', null, '新规则对之后的每条消息生效。'), '保存', 'jade')
          if (reason == null) return
          await chatApi('settings', { patch, reason }); toast('已保存'); staleAll()
        })
      })
      return form
    }, skeleton(6))
    const text = h('textarea', { rows: 4, maxlength: 300, placeholder: '例如：今晚 20:00 两江四湖灯光秀，欢迎来逛', class: 'adm-chat-notice', 'aria-label': '公告内容' }) as HTMLTextAreaElement
    const send = h('button', { class: 'adm-btn', type: 'submit' }, '发到世界频道') as HTMLButtonElement
    const preview = h('div', { class: 'adm-chat-preview', 'aria-hidden': 'true' }, h('span', { class: 'adm-chat-ch adm-chat-ch--sys' }, '公告'), h('b', null, '网上桂林'), h('p', null, '公告会这样显示'))
    text.addEventListener('input', () => { preview.querySelector('p')!.textContent = text.value.trim() || '公告会这样显示' })
    const form = h('form', { class: 'adm-chat-form' }, text, preview, h('div', { class: 'adm-btns' }, send))
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      act(send, async () => {
        const body = text.value.trim()
        if (!body) return
        const reason = await chatReason('发送公告', h('p', null, '全城在线玩家都会立即看到：', h('q', null, body)), '发送', 'jade')
        if (reason == null) return
        await chatApi('notice', { ch: 'world', text: body, reason }); toast('公告已发送'); text.value = ''
      })
    })
    noticeSlot.append(form)
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
function paintLive(live: any, mpState?: any) {
  const online = num(live.online) ?? 0
  const modes = list<any>(live.modes).map((m) => ({ label: label('mode', m.mode), value: num(m.n) ?? 0 })).sort((a, b) => b.value - a.value)
  const regions = list<any>(live.regions).map((m) => ({ label: label('region', m.region), value: num(m.n) ?? 0 })).sort((a, b) => b.value - a.value).slice(0, 12)
  const server = live.server
  const sample = server ? (typeof server.sample === 'string' ? JSON.parse(server.sample) : server.sample) ?? {} : null
  const rtUp = mpState?.rt === 'up'
  const rtSrv = mpState?.server
  return h('div', { class: 'adm-live' },
    h('div', { class: 'adm-cols' },
      card('全站在线人数', [h('div', { class: 'adm-now-big adm-now-big--xl' }, h('b', null, fmt.int(online)), h('span', null, '人')), h('p', { class: 'adm-sub' }, '最近 5 分钟内有活动的会话')]),
      card('正在做什么', modes.length ? bars(modes, fmt.int) : emptyState('暂无在线玩家')),
      card('来自哪里', regions.length ? bars(regions, fmt.int) : emptyState('暂无在线玩家'))),
    card('API 服务端（最近一分钟）', sample
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
      { sub: server ? `采样时间 ${when(iso(server.minute))}` : undefined, actions: navLink('查看 API 服务端曲线 →', { view: 'server' }, { class: 'adm-link' }) }),
    card('联机引擎 RT（实时）', rtUp && rtSrv
      ? h('div', { class: 'adm-kpis adm-kpis--server' },
          serverStat('同城在线', `${fmt.int(rtSrv.online)} / ${fmt.int(rtSrv.maxPlayers)}`, `连接 ${fmt.int(rtSrv.connections)}`),
          serverStat('事件循环 p99', fmt.ms(rtSrv.loopP99Ms), `p50 ${fmt.ms(rtSrv.loopP50Ms)}`),
          serverStat('进程内存', `${fmt.num(rtSrv.rssMb)} MB`, `堆 ${fmt.num(rtSrv.heapMb)} MB`),
          serverStat('慢客户端跳过', fmt.int(rtSrv.skips), `断开 ${fmt.int(rtSrv.slowCloses)}`),
          serverStat('运行时长', mpDuration(rtSrv.uptimeSec)))
      : emptyState('联机服务未连接', mpState?.error ?? '联机服务未启动或不可达'),
      { actions: navLink('打开联机引擎详情 →', { view: 'rt' }, { class: 'adm-link' }) }))
}

/* ───────────── 联机运营（业务） & 联机引擎（运维） ───────────── */
const mpRejectText: Record<string, string> = { ticket: '票据无效', full: '满员', uidOnline: '账号已在线', banned: '联机封禁中', ipLimit: '同 IP 连接过多' }
const mpEventText: Record<string, string> = { join: '进入', leave: '离开', resume: '续连', kick: '踢出', reject: '拒绝' }
const mpCloseText: Record<number, string> = { 1000: '正常关闭', 1001: '页面离开', 1005: '未给原因', 1006: '断线', 1013: '网络太慢被断开', 4001: '被同账号顶号', 4003: '被踢 / 封禁' }
const msgText: Record<string, string> = { pos: '位置', act: '玩法状态', join: '进入', welcome: '欢迎包', leave: '离开', online: '人数', avatar: '换装', who: '名册', roster: '全服名册', chat: '聊天', emote: '表情', hit: '出拳', revive: '扶起', banned: '封禁通知', error: '错误', players: '名册回复', other: '其他' }
const mpActivityMeta: Record<string, { label: string; color: string; dotClass: string }> = {
  fishing: { label: '漓江钓鱼', color: '#3b82a6', dotClass: 'is-water' },
  mifen: { label: '田源米粉店', color: '#9e5f87', dotClass: 'is-life' },
  boat: { label: '划船 / 竹筏', color: '#2b6f8c', dotClass: 'is-water' },
  ebike: { label: '骑电动车', color: '#c49a4a', dotClass: 'is-bike' },
  bicycle: { label: '骑单车', color: '#d0a95f', dotClass: 'is-bike' },
  car: { label: '开车兜风', color: '#b4783c', dotClass: 'is-bike' },
  drone: { label: '无人机航拍', color: '#5b6fb0', dotClass: 'is-air' },
  photo: { label: '摄影拍照', color: '#6b82b8', dotClass: 'is-air' },
  mission: { label: '任务 / 跑腿', color: '#b25e52', dotClass: 'is-life' },
  shop: { label: '逛店 / 车库', color: '#8f6b94', dotClass: 'is-life' },
  smoke: { label: '抽烟休闲', color: '#7d8a84', dotClass: '' },
  walk: { label: '步行逛城', color: '#4f7f7a', dotClass: '' },
  idle: { label: '驻足 / 挂机', color: '#9ca39f', dotClass: '' },
}
const mpActKindText: Record<string, string> = {
  join: '进入联机', leave: '离开联机', activity: '开始玩法', activity_end: '结束玩法',
  chat: '发言聊天', emote: '使用表情', avatar: '更换造型', kick: '被踢出',
}
function mpActLabel(act: string | null | undefined) {
  return (act && mpActivityMeta[act]?.label) ?? act ?? '未知'
}
function mpActPill(act: string | null | undefined, detail?: string | null) {
  const meta = (act && mpActivityMeta[act]) || { label: act || '未知', color: '#6b7d78', dotClass: '' }
  return h('span', { class: 'adm-act-pill', title: detail || undefined },
    h('i', { style: `background:${meta.color}` }),
    meta.label,
    detail ? h('small', null, ` · ${detail}`) : null)
}
function mpDuration(sec: number | null | undefined) {
  if (sec == null || !Number.isFinite(sec)) return dash
  if (sec < 60) return `${Math.round(sec)} 秒`
  if (sec < 3600) return `${Math.floor(sec / 60)} 分 ${Math.round(sec % 60)} 秒`
  return `${Math.floor(sec / 3600)} 时 ${Math.floor((sec % 3600) / 60)} 分`
}
function mpDurationShort(sec: number | null | undefined) {
  if (sec == null || !Number.isFinite(sec)) return dash
  if (sec < 60) return `${Math.round(sec)} 秒`
  if (sec < 3600) return `${Math.floor(sec / 60)} 分`
  return `${(sec / 3600).toFixed(1)} 小时`
}
const mpRegion = (r: any) => r ? [r.country === 'CN' ? '' : r.country, r.region, r.city].filter(Boolean).join(' · ') || r.country || dash : dash
const mpUa = (ua: string | undefined) => {
  if (!ua) return dash
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '其他'
  const browser = /MicroMessenger/.test(ua) ? '微信' : /QQ\//.test(ua) ? 'QQ' : /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '浏览器'
  return `${os} · ${browser}`
}
/** 客户端地标双保险：优先服务端返回的 landmark，缺失或 auto-* 时用浏览器已拉取的 manifest 兜底计算，杜绝全员「野外」。 */
function resolvePlayerPlace(p: any, places: Place[]): { name: string | null; dist: number | null } {
  if (p.landmark && !/^auto-/.test(String(p.landmark))) {
    return { name: String(p.landmark), dist: num(p.landmarkDist) }
  }
  if (!places.length || !Number.isFinite(p.x) || !Number.isFinite(p.z)) return { name: null, dist: null }
  let best: Place | null = null, bestSq = Infinity
  for (const place of places) {
    const sq = (place.x - p.x) ** 2 + (place.z - p.z) ** 2
    if (sq < bestSq) { bestSq = sq; best = place }
  }
  return best ? { name: best.name, dist: Math.round(Math.sqrt(bestSq)) } : { name: null, dist: null }
}
function formatPlace(place: { name: string | null; dist: number | null }) {
  if (!place.name) return '城外'
  if (place.dist != null && place.dist > 1500) return `距${place.name} ${(place.dist / 1000).toFixed(1)} km`
  return place.dist != null ? `${place.name}附近（${place.dist} m）` : `${place.name}附近`
}
function mpKick(player: any, onDone: () => void) {
  const button = h('button', { type: 'button', class: 'adm-btn adm-btn--danger adm-btn--sm' }, '踢出') as HTMLButtonElement
  button.addEventListener('click', () => act(button, async () => {
    const minutesField = h('select', { class: 'adm-select', 'aria-label': '禁止重连时长' },
      [['10', '10 分钟'], ['60', '1 小时'], ['1440', '1 天'], ['10080', '7 天']].map(([v, t]) => h('option', { value: v }, t))) as HTMLSelectElement
    const reason = await confirmDialog({
      title: '踢出联机', tone: 'seal', confirm: '确认踢出',
      body: h('div', null,
        h('p', null, h('b', null, player.name), `（${player.uid}）会立即断开同城联机，期间重连会被拒绝。`),
        h('label', { class: 'adm-dialog-field' }, h('span', null, '禁止重连'), minutesField),
        h('p', { class: 'adm-sub' }, '只影响联机，不封账号；要封账号请到「用户与权限」。此操作会记录在「操作记录」中。')),
      message: { label: '原因', required: true, placeholder: '例如：刷屏、骚扰其他玩家', max: 200, hint: '请填写原因，玩家会看到' },
    })
    if (reason == null) return
    const result = await api<{ kicked: number }>('admin/mp/kick', { uid: player.uid, reason, minutes: Number(minutesField.value) })
    toast(result.kicked ? `已踢出 ${player.name}` : `${player.name} 已不在线，已写入联机封禁`)
    onDone()
  }))
  return button
}
function mpMap(players: any[], manifest: any, places: Place[]) {
  const hasExtent = Array.isArray(manifest?.extent) && manifest.extent.length === 4
  const [ex, ez, ew, ed] = hasExtent ? (manifest.extent as number[]) : [-2600, -1800, 3600, 5000]
  // 框住所有玩家，留 600 m 边；没有玩家时看整张图
  const xs = players.map((p) => p.x), zs = players.map((p) => p.z)
  const pad = 600
  let x0 = players.length ? Math.max(ex, Math.min(...xs) - pad) : ex, x1 = players.length ? Math.min(ex + ew, Math.max(...xs) + pad) : ex + ew
  let z0 = players.length ? Math.max(ez, Math.min(...zs) - pad) : ez, z1 = players.length ? Math.min(ez + ed, Math.max(...zs) + pad) : ez + ed
  const minSpan = 2400
  if (x1 - x0 < minSpan) { const c = (x0 + x1) / 2; x0 = c - minSpan / 2; x1 = c + minSpan / 2 }
  if (z1 - z0 < minSpan * 0.6) { const c = (z0 + z1) / 2; z0 = c - minSpan * 0.3; z1 = c + minSpan * 0.3 }
  const span = Math.max(x1 - x0, z1 - z0), r = span / 120, labels: number[][] = []
  const svg = s('svg', { viewBox: `${x0} ${z0} ${x1 - x0} ${z1 - z0}`, class: 'adm-mp-map', role: 'img', 'aria-label': '在线玩家位置' })
  if (hasExtent) {
    svg.append(s('image', { href: '/world/overview.png', x: ex, y: ez, width: ew, height: ed, preserveAspectRatio: 'none', class: 'adm-heat-base' }))
  } else {
    // 本地预览或清单暂不可用时绘制轻量坐标网格，避免报错并保留真实相对位置
    const step = 500
    for (let gx = Math.ceil(x0 / step) * step; gx <= x1; gx += step)
      svg.append(s('line', { x1: gx, y1: z0, x2: gx, y2: z1, stroke: 'rgba(60,72,66,.1)', 'stroke-width': r * 0.16 }))
    for (let gz = Math.ceil(z0 / step) * step; gz <= z1; gz += step)
      svg.append(s('line', { x1: x0, y1: gz, x2: x1, y2: gz, stroke: 'rgba(60,72,66,.1)', 'stroke-width': r * 0.16 }))
  }
  const tip = h('div', { class: 'adm-tip', hidden: true })
  for (const p of players) {
    const actKey = p.activity ?? (p.mode === 'bike' ? 'ebike' : 'walk')
    const meta = mpActivityMeta[actKey] ?? mpActivityMeta.walk
    const place = resolvePlayerPlace(p, places)
    const g = s('g', { class: `adm-mp-dot ${meta.dotClass} ${p.dn ? 'is-down' : ''}`, transform: `translate(${p.x} ${p.z})` })
    g.append(s('line', { x1: 0, y1: 0, x2: -Math.sin(p.yaw) * r * 2.4, y2: -Math.cos(p.yaw) * r * 2.4, 'stroke-width': r * 0.6 }))
    g.append(s('circle', { r, 'stroke-width': r * 0.35 }))
    // 名字互不重叠：挤在一起时只写第一个，其余看右侧「按地标」或悬停
    const fs = r * 3, w = p.name.length * fs * 0.9, box = [p.x - w / 2, p.z - r * 2 - fs, p.x + w / 2, p.z - r * 2]
    if (!labels.some(([a, b, c, d]) => box[0] < c && box[2] > a && box[1] < d && box[3] > b)) {
      labels.push(box)
      g.append(s('text', { y: -r * 2.2, 'font-size': fs, 'stroke-width': r * 0.8 }, p.name))
    }
    g.addEventListener('pointerenter', () => {
      tip.hidden = false
      tip.replaceChildren(
        h('b', null, `${p.name} · ${p.uid}`),
        h('span', null, formatPlace(place)),
        h('span', null, `${meta.label}${p.activityDetail ? `（${p.activityDetail}）` : ''} · ${fmt.num(p.v)} m/s · 延迟 ${fmt.ms(p.rttMs)}`))
    })
    g.addEventListener('pointermove', (event) => {
      const box = (svg.parentElement ?? svg).getBoundingClientRect()
      tip.style.left = `${Math.min(Math.max(event.clientX - box.left, 90), box.width - 90)}px`
      tip.style.top = `${event.clientY - box.top + 18}px`
    })
    g.addEventListener('pointerleave', () => (tip.hidden = true))
    svg.append(g)
  }
  return h('div', { class: 'adm-heat-stage adm-mp-stage' }, svg, tip,
    h('p', { class: 'adm-sub adm-mp-legend' },
      h('i', { class: 'is-walk' }), '步行',
      h('i', { class: 'is-bike' }), '载具',
      h('i', { class: 'is-water' }), '钓鱼/划船',
      h('i', { class: 'is-life' }), '米粉/逛店/任务',
      h('i', { class: 'is-air' }), '航拍/拍照',
      h('i', { class: 'is-down' }), '倒地', ' · 上北下南'))
}
function mpTable(head: string[], rows: Child[][], numCols: number[] = []) {
  return h('div', { class: 'adm-table-wrap' }, h('table', { class: 'adm-table adm-mp-table' },
    h('thead', null, h('tr', null, head.map((t, i) => h('th', { class: numCols.includes(i) ? 'num' : '' }, t)))),
    h('tbody', null, rows.map((row) => h('tr', null, row.map((cell, i) => h('td', { class: numCols.includes(i) ? 'num' : '' }, cell)))))))
}
function paintMp(state: any, manifest: any, reload: () => void) {
  if (state.rt !== 'up') return h('div', { class: 'adm-stack' },
    h('div', { class: 'adm-error', role: 'alert' }, h('b', null, '联机服务连不上'), h('span', null, `${state.error ?? '未知原因'}。游戏里的同城联机此时不可用；下方玩法统计、账户记录与历史数据仍可查看。`),
      navLink('前往运维侧排查 →', { view: 'rt' }, { class: 'adm-btn adm-btn--ghost adm-btn--sm' })))
  const server = state.server, players: any[] = [...state.players].sort((a, b) => a.joinedAt - b.joinedAt)
  const places = manifestPlaces(manifest)
  const now = Date.now()
  const rtts = players.map((p) => p.rttMs).filter((v): v is number => v != null).sort((a, b) => a - b)
  const byPlace = new Map<string, any[]>()
  const byAct = new Map<string, number>()
  for (const p of players) {
    const place = resolvePlayerPlace(p, places)
    const key = place.name ?? '城外'
    byPlace.set(key, [...(byPlace.get(key) ?? []), p])
    const actKey = p.activity ?? (p.mode === 'bike' ? 'ebike' : 'walk')
    byAct.set(actKey, (byAct.get(actKey) ?? 0) + 1)
  }
  const topAct = [...byAct.entries()].sort((a, b) => b[1] - a[1])[0]
  const kpis = h('div', { class: 'adm-kpis adm-kpis--server' },
    serverStat('同城在线', `${fmt.int(server.online)} / ${fmt.int(server.maxPlayers)}`, `连接 ${fmt.int(server.connections)}（含未进城）`),
    serverStat('本次启动峰值', fmt.int(server.peak), server.peakAt ? `${when(new Date(server.peakAt))}` : undefined),
    serverStat('活跃地标数', fmt.int(byPlace.size), players.length ? `已定位 ${players.filter((p) => resolvePlayerPlace(p, places).name).length}/${players.length} 人` : '暂无在线玩家'),
    serverStat('此刻最热玩法', topAct ? mpActLabel(topAct[0]) : dash, topAct ? `${topAct[1]} 人正在参与` : '暂无在线玩家'),
    serverStat('玩家延迟中位数', fmt.ms(rtts.length ? rtts[Math.floor(rtts.length / 2)] : null), rtts.length ? `最差 ${fmt.ms(rtts[rtts.length - 1])}` : '还没有测到'),
    serverStat('联机引擎', server.loopP99Ms > 50 ? '负载偏高' : '运行正常', `事件循环 p99 ${fmt.ms(server.loopP99Ms)} · 详情见运维侧`))

  const actBars = [...byAct.entries()].sort((a, b) => b[1] - a[1]).map(([act, count]) => ({ label: mpActLabel(act), value: count }))
  const mapCard = card('玩家在哪 & 正在玩什么', h('div', { class: 'adm-heat' }, mpMap(players, manifest, places),
    h('div', { class: 'adm-heat-side adm-mp-side-tabs' },
      h('div', null,
        h('p', { class: 'adm-heat-side-title' }, '按地标分布'),
        players.length
          ? h('ol', null, [...byPlace].sort((a, b) => b[1].length - a[1].length).map(([place, list]) =>
              h('li', null, h('i', { style: 'background:var(--ui-jade-500)' }), h('span', null, `${place}${place === '城外' ? '' : '附近'}`, h('small', null, list.map((p) => p.name).join('、'))), h('b', null, `${list.length} 人`))))
          : emptyState('现在没有人在联机')),
      h('div', null,
        h('p', { class: 'adm-heat-side-title' }, '此刻玩法分布'),
        actBars.length ? bars(actBars, fmt.int) : h('p', { class: 'adm-sub' }, '暂无在线玩家')),
      h('p', { class: 'adm-sub' }, server.landmarkSource === 'builtin'
        ? `已启用内置桂林核心地标坐标（共 ${fmt.int(server.landmarkCount || 0)} 处）定位。`
        : `地标取世界清单平面距离最近点（已载入 ${fmt.int(server.landmarkCount || places.length)} 个地标/山峰）。`))),
    { sub: '每 10 秒刷新 · 鼠标移到圆点上看玩法与坐标详情' })

  const signupName: Record<string, string> = { email: '邮箱', wx: '微信', qq: 'QQ' }
  const table = card(`在线玩家（${players.length}）`, players.length ? mpTable(
    ['玩家与账号', '当前玩法 / 状态', '位置（地标）', '本场玩法耗时', '地区 / 设备', '在线时长', '操作'],
    players.map((p) => {
      const place = resolvePlayerPlace(p, places)
      const actKey = p.activity ?? (p.mode === 'bike' ? 'ebike' : 'walk')
      const topTotals = Object.entries<number>(p.activityTotals ?? {}).filter(([, s]) => s >= 5).sort((a, b) => b[1] - a[1]).slice(0, 3)
      const traceLink = navLink('活动轨迹', { view: 'mp', uid: String(p.uid) }, { class: 'adm-btn adm-btn--ghost adm-btn--sm' }, true)
      const methodLabel = p.account?.signupMethod ? (signupName[p.account.signupMethod] ?? p.account.signupMethod) : ''
      return [
        h('div', { class: 'adm-mp-who' }, p.account?.id ? navLink(p.name, { view: 'users', id: p.account.id }, { class: 'adm-link' }) : h('b', null, p.name),
          h('small', null, `UID ${p.uid}${p.account ? ` · ${methodLabel ? methodLabel + '注册 ' : ''}${when(unix(p.account.createdAt), true)}` : ''}`), p.account?.banned && h('span', { class: 'adm-pill is-bad' }, '账号已封')),
        h('div', { class: 'adm-mp-state' },
          mpActPill(actKey, p.activityDetail),
          h('small', null, [`${fmt.num(p.v)} m/s`, `HP ${p.hp}`, p.dn ? '倒地' : '', p.sc ? '抽烟' : '', p.em ? `表情 ${p.em}` : '', p.chats ? `聊天 ${p.chats}` : ''].filter(Boolean).join(' · '))),
        h('div', null,
          h('span', { class: 'adm-nowrap' }, formatPlace(place)),
          h('small', { class: 'adm-sub adm-nowrap' }, `东 ${Math.round(p.x)} · 南 ${Math.round(p.z)} · 高 ${Math.round(p.y)}`)),
        topTotals.length
          ? h('div', { class: 'adm-act-chips' }, topTotals.map(([a, s]) => h('span', { class: 'adm-act-chip' }, mpActLabel(a), h('b', null, mpDurationShort(s)))))
          : h('span', { class: 'adm-act-chip' }, '刚进城'),
        h('div', null, h('span', null, mpRegion(p.region)), h('small', { class: 'adm-sub' }, [p.region?.isp, mpUa(p.ua)].filter(Boolean).join(' · '))),
        mpDuration((now - p.joinedAt) / 1000),
        h('div', { class: 'adm-btns' }, traceLink, mpKick(p, reload)),
      ]
    }), [5]) : emptyState('现在没有人在联机', '玩家登录并打开「同城联机」后会出现在这里'))

  const chats = [...state.chat].reverse()
  const chatCard = card('最近聊天', chats.length ? h('ol', { class: 'adm-mp-feed adm-mp-chat' }, chats.map((c: any) =>
    h('li', null, h('time', null, when(new Date(c.ts))), h('b', null, c.name), h('span', null, c.text))))
    : emptyState('还没有聊天'), { sub: '最近 100 条', actions: navLink('前往聊天管理 →', { view: 'chat' }, { class: 'adm-link' }) })
  const bans = card(`联机封禁（${state.bans.length}）`, state.bans.length ? mpTable(['uid', '原因', '到期'],
    state.bans.map((b: any) => [String(b.uid), b.reason || dash, `${when(new Date(b.until))}（${mpDurationShort((b.until - now) / 1000)}后）`]))
    : h('p',{class:'adm-sub'},'没有生效中的联机封禁'), { actions:navLink(`封禁 ${state.bans.length} · 管理 →`,{view:'security'},{class:'adm-btn adm-btn--sm adm-btn--ghost'}) })
  return h('div', { class: 'adm-stack' }, kpis, mapCard, table, h('div', { class: 'adm-grid-2' }, chatCard, bans))
}

function paintMpGameplay(data: any) {
  const rows: any[] = list<any>(data.activities)
  const totalSec = num(data.totalSeconds) ?? 0
  const totalPlayers = num(data.totalPlayers) ?? 0
  const top = rows[0]
  const activeTop = [...rows].sort((a, b) => (b.activeNow ?? 0) - (a.activeNow ?? 0)).find((r) => r.activeNow > 0)
  const summary = h('div', { class: 'adm-kpis adm-kpis--server' },
    serverStat('累计联机玩法时长', mpDurationShort(totalSec), `${rows.length} 种玩法有记录`),
    serverStat('参与联机账户数', fmt.int(totalPlayers), '按账号 UID 去重'),
    serverStat('最吸引玩家玩法', top ? mpActLabel(top.activity) : dash, top ? `占 ${fmt.pct(top.share)} · 人均 ${mpDurationShort(top.avgPerPlayerSec)}` : '等待玩家联机产生数据'),
    serverStat('此刻最多人在玩', activeTop ? mpActLabel(activeTop.activity) : dash, activeTop ? `${activeTop.activeNow} 人正在玩` : '当前无在线玩家'))

  const maxSec = Math.max(...rows.map((r) => r.seconds ?? 0), 1)
  const table = rows.length ? mpTable(
    ['玩法', '时间占比', '总占用玩家时间', '参与账户', '人均投入', '单次平均', '此刻在玩'],
    rows.map((r) => {
      const meta = mpActivityMeta[r.activity] ?? { label: r.activity, color: 'var(--ui-jade-500)' }
      return [
        mpActPill(r.activity),
        h('div', { class: 'adm-gp-bar' },
          h('span', { class: 'adm-gp-track' }, h('i', { style: `width:${Math.max(2, ((r.seconds || 0) / maxSec) * 100).toFixed(1)}%;background:${meta.color}` })),
          h('small', null, fmt.pct(r.share))),
        mpDurationShort(r.seconds),
        fmt.int(r.players),
        mpDurationShort(r.avgPerPlayerSec),
        r.avgSegmentSec != null ? mpDuration(r.avgSegmentSec) : dash,
        r.activeNow ? h('span', { class: 'adm-pill is-good' }, `${r.activeNow} 人`) : '0',
      ]
    }), [2, 3, 4, 5, 6]) : emptyState('该时间段还没有联机玩法时长数据', '玩家进入联机并游玩后，系统会实时累计各玩法的占用时间')

  // Top 6 玩法趋势曲线（分钟）
  const topNames = rows.slice(0, 6).map((r) => r.activity)
  const byAct = new Map<string, { t: Date; v: number }[]>()
  for (const pt of list<any>(data.series)) {
    if (!topNames.includes(pt.activity)) continue
    const arr = byAct.get(pt.activity) ?? []
    const t = data.grain === 'hour' ? new Date(pt.ts) : new Date(pt.ts + 'T00:00:00+08:00')
    arr.push({ t, v: Number(pt.seconds || 0) / 60 })
    byAct.set(pt.activity, arr)
  }
  const chartSeries: Series[] = topNames
    .map((act) => ({ name: mpActLabel(act), points: byAct.get(act) ?? [] }))
    .filter((s) => s.points.length)
  const minFmt: Fmt = (v) => (v == null ? dash : v === 0 ? '0 分' : v >= 120 ? `${(v / 60).toFixed(1)} 时` : `${v.toFixed(v >= 10 ? 0 : 1)} 分`)
  const trendBox = chartSeries.length
    ? h('div', null,
        h('p', { class: 'adm-sub', style: 'margin-bottom:6px' }, `Top ${chartSeries.length} 玩法占用时长趋势（${data.grain === 'hour' ? '按小时' : '按日'}，单位：玩家分钟）`),
        lineChart(chartSeries, minFmt, { bucket: data.grain === 'hour' ? '1h' : '1d', height: 220 }))
    : null

  const siteModes: any[] = list<any>(data.siteModes)
  const siteTotal = siteModes.reduce((sum, r) => sum + (r.seconds || 0), 0)
  const siteBox = siteModes.length
    ? h('div', { class: 'adm-health-strip' },
        h('span', null, `全站模式耗时参考（含非联机${data.siteRange && data.siteRange !== data.range ? ` · 近 ${data.siteRange === '24h' ? '24 小时' : '7 天'}` : ''} · ${fmt.int(data.siteSessions)} 会话）`),
        h('div', { class: 'adm-health-items' },
          siteModes.map((m) => h('span', { class: 'adm-health-item' },
            label('mode', m.mode), ' ',
            h('b', null, mpDurationShort(m.seconds)),
            h('small', null, siteTotal ? `(${fmt.pct(m.seconds / siteTotal)})` : '')))))
    : null

  return h('div', { class: 'adm-stack' }, summary, table, trendBox, siteBox)
}

function paintMpActivities(data: any, selectedUid: string | null) {
  const accounts: any[] = list<any>(data.accounts)
  const items: any[] = list<any>(data.items)
  const accountStrip = accounts.length
    ? h('div', { class: 'adm-mp-accounts' }, accounts.map((acc) => {
        const active = selectedUid === String(acc.uid)
        const topText = (acc.topActivities ?? []).slice(0, 2).map((a: any) => `${mpActLabel(a.activity)} ${mpDurationShort(a.seconds)}`).join(' · ')
        return navLink([
          h('div', { class: 'adm-mp-acct-head' },
            h('i', { class: `adm-mp-acct-dot ${acc.online ? 'is-on' : ''}`, title: acc.online ? '在线' : '离线' }),
            h('b', null, acc.name || `UID ${acc.uid}`),
            h('small', null, String(acc.uid))),
          h('small', null, [acc.currentActivity ? mpActLabel(acc.currentActivity) : '', acc.currentLandmark ? `${acc.currentLandmark}附近` : ''].filter(Boolean).join(' · ') || '暂无状态'),
          h('small', null, topText || `最近活跃 ${ago(iso(acc.lastActiveAt))}`),
        ], { view: 'mp', uid: active ? null : String(acc.uid) }, { class: `adm-mp-acct ${active ? 'is-on' : ''}` }, true)
      }))
    : null

  const table = items.length
    ? h('div', { class: 'adm-mp-scroll' }, mpTable(
        ['时间', '账户', '行为 / 玩法', '位置', '详情 / 耗时'],
        items.map((item) => [
          when(iso(item.ts)),
          h('div', { class: 'adm-mp-who' },
            navLink(item.name || `UID ${item.uid}`, { view: 'mp', uid: String(item.uid) }, { class: 'adm-link', title: '只看该账户的活动记录' }, true),
            h('small', null, `UID ${item.uid}`, item.accountId ? [' · ', navLink('账号详情', { view: 'users', id: item.accountId }, { class: 'adm-link' })] : null)),
          h('div', { class: 'adm-act-chips' },
            h('span', { class: `adm-pill ${item.kind === 'join' ? 'is-good' : item.kind === 'kick' ? 'is-bad' : ''}` }, mpActKindText[item.kind] ?? item.kind),
            item.activity ? mpActPill(item.activity) : null),
          item.landmark ? `${item.landmark}附近` : (item.x != null && item.z != null ? `东 ${Math.round(item.x)} · 南 ${Math.round(item.z)}` : dash),
          [item.detail || '', item.durationSec != null ? `耗时 ${mpDuration(item.durationSec)}` : ''].filter(Boolean).join(' · ') || dash,
        ])))
    : emptyState('没有符合条件的账户活动记录', selectedUid ? '该账户在此时间段暂无更多记录，可切换更长时间范围' : '玩家进入联机、切换玩法、钓鱼、煮米粉、骑车或发言后会自动记录在这里')

  return h('div', { class: 'adm-stack' }, accountStrip, table)
}

function paintRtOps(state: any) {
  if (state.rt !== 'up') return h('div', { class: 'adm-error', role: 'alert' },
    h('b', null, '联机服务连不上'), h('span', null, `${state.error ?? '未知原因'}。请检查 glol-rt Pod 与 RT_INTERNAL_URL / RT_ADMIN_TOKEN 配置。`))
  const server = state.server, players: any[] = [...state.players].sort((a, b) => a.joinedAt - b.joinedAt)
  const now = Date.now()
  const rtts = players.map((p) => p.rttMs).filter((v): v is number => v != null).sort((a, b) => a - b)
  const sum = (dir: 'in' | 'out') => Object.values<any>(server.traffic[dir] ?? {}).reduce((acc, v) => ({ packets: acc.packets + v.packets, bytes: acc.bytes + v.bytes }), { packets: 0, bytes: 0 })
  const tin = sum('in'), tout = sum('out')
  const rejects = Object.entries<number>(server.rejects ?? {}), rejectTotal = rejects.reduce((a, [, v]) => a + v, 0)
  const kpis = h('div', { class: 'adm-kpis adm-kpis--server' },
    serverStat('同城在线 / 上限', `${fmt.int(server.online)} / ${fmt.int(server.maxPlayers)}`, `连接 ${fmt.int(server.connections)}（含未进城）`),
    serverStat('本次启动峰值', fmt.int(server.peak), server.peakAt ? `${when(new Date(server.peakAt))}` : undefined),
    serverStat('运行时长', mpDurationShort(server.uptimeSec), `启动于 ${when(new Date(server.startedAt))}`),
    serverStat('延迟中位数', fmt.ms(rtts.length ? rtts[Math.floor(rtts.length / 2)] : null), rtts.length ? `最差 ${fmt.ms(rtts[rtts.length - 1])}` : '还没有测到'),
    serverStat('下行带宽', `${fmt.bytes(tout.bytes / 60)}/s`, `近 60 秒 ${fmt.int(tout.packets)} 包`),
    serverStat('上行带宽', `${fmt.bytes(tin.bytes / 60)}/s`, `近 60 秒 ${fmt.int(tin.packets)} 包`),
    serverStat('事件循环 p99', fmt.ms(server.loopP99Ms), `p50 ${fmt.ms(server.loopP50Ms)}`),
    serverStat('进程内存', `${fmt.num(server.rssMb)} MB`, `堆 ${fmt.num(server.heapMb)} MB`),
    serverStat('拒绝连接', fmt.int(rejectTotal), rejects.filter(([, v]) => v).map(([k, v]) => `${mpRejectText[k] ?? k} ${v}`).join(' · ') || '启动以来没有'),
    serverStat('慢客户端跳过', fmt.int(server.skips), `被断开 ${fmt.int(server.slowCloses)} 个`),
    serverStat('地标清单', `${fmt.int(server.landmarkCount ?? 0)} 个`, server.landmarkSource ? `来源 ${String(server.landmarkSource).replace(/^https?:\/\//, '')}` : '未加载'))

  const types = [...new Set([...Object.keys(server.traffic.in ?? {}), ...Object.keys(server.traffic.out ?? {})])]
    .map((t) => ({ t, i: server.traffic.in?.[t] ?? { packets: 0, bytes: 0 }, o: server.traffic.out?.[t] ?? { packets: 0, bytes: 0 } }))
    .sort((a, b) => b.o.bytes + b.i.bytes - a.o.bytes - a.i.bytes)
  const traffic = card('消息流量（近 60 秒）', types.length ? mpTable(['类型', '收到', '收到字节', '发出', '发出字节'],
    types.map(({ t, i, o }) => [h('span', null, msgText[t] ?? t, ' ', h('code', null, t)), fmt.int(i.packets), fmt.bytes(i.bytes), fmt.int(o.packets), fmt.bytes(o.bytes)]), [1, 2, 3, 4])
    : emptyState('近 60 秒没有消息'), { sub: '发出按每个接收方各算一次；字节不含 WebSocket 帧头' })

  const connTable = card(`在线连接网络明细（${players.length}）`, players.length ? mpTable(
    ['玩家 / UID', '延迟 / 均值', '位置包', '上行 / 下行', '发送缓冲', '慢跳过', '地区 / 运营商', '客户端 UA'],
    players.map((p) => [
      h('div', { class: 'adm-mp-who' }, h('b', null, p.name), h('small', null, `UID ${p.uid} · #${p.id}`)),
      h('span', { class: (p.rttMs ?? 0) > 300 ? 'is-bad' : '' }, `${fmt.ms(p.rttMs)} / ${fmt.ms(p.avgRttMs)}`),
      h('span', { title: `最后一次 ${p.lastPosAt ? ago(new Date(p.lastPosAt)) : '没有'}` }, `${fmt.num(p.posHz)}/s`),
      `${fmt.bytes(p.inBytes)} / ${fmt.bytes(p.outBytes)}`,
      p.bufferedAmount ? fmt.bytes(p.bufferedAmount) : '0',
      fmt.int(p.skips),
      h('div', null, h('span', null, mpRegion(p.region)), h('small', { class: 'adm-sub' }, p.region?.isp ?? '')),
      h('span', { title: p.ua ?? '' }, mpUa(p.ua)),
    ]), [1, 2, 3, 4, 5]) : emptyState('当前没有在线连接'))

  const events = [...state.events].reverse()
  const eventCard = card('连接进出与断线事件', events.length ? h('ol', { class: 'adm-mp-feed' }, events.slice(0, 80).map((e: any) =>
    h('li', { class: `is-${e.type}` }, h('time', null, when(new Date(e.ts))), h('b', null, mpEventText[e.type] ?? e.type),
      h('span', null, e.name || (e.uid ? String(e.uid) : '未进城连接')),
      h('small', null, [e.type === 'reject' ? mpRejectText[e.reason] ?? e.reason : e.reason, e.closeCode ? mpCloseText[e.closeCode] ?? `关闭码 ${e.closeCode}` : '', e.type === 'leave' && e.durationSec != null ? `待了 ${mpDurationShort(e.durationSec)}` : ''].filter(Boolean).join(' · ')))))
    : emptyState('联机服务启动以来还没有人进出'), { sub: '最近 300 条，含 WS 关闭码，重启后清空' })
  const bans = card(`联机封禁（${state.bans.length}）`, state.bans.length ? mpTable(['uid', '原因', '到期'],
    state.bans.map((b: any) => [String(b.uid), b.reason || dash, `${when(new Date(b.until))}（${mpDurationShort((b.until - now) / 1000)}后）`]))
    : emptyState('没有生效中的联机封禁'), { sub: '只存在联机服务内存里，重启后清空' })
  return h('div', { class: 'adm-stack' }, kpis, connTable, h('div', { class: 'adm-grid-2' }, traffic, bans), eventCard)
}
function paintMpHistory(history: any) {
  const series: Series[] = [{ name: '在线', points: list<any>(history.series).map((row) => ({ t: new Date(row.ts), v: num(row.online) ?? 0 })) }]
  const daily = list<any>(history.daily).slice().reverse()
  return h('div', { class: 'adm-stack' },
    history.peak != null && h('p', { class: 'adm-note' }, `这段时间同时在线最多 ${history.peak} 人（${when(iso(history.peakAt))}）`),
    series[0].points.length ? lineChart(series, fmt.int, { bucket: history.grain === 'minute' ? '5m' : '1h', height: 200, gap: history.grain === 'minute' ? 60e3 : 3600e3 })
      : emptyState('还没有采样', 'API 每分钟记一次在线人数，上线后开始积累'),
    daily.length ? mpTable(['日期', '联机人数', '场次', '平均时长', '中位时长', '最高同时在线'],
      daily.map((d: any) => [d.day, fmt.int(d.dau), fmt.int(d.sessions), mpDurationShort(num(d.avgDurationSec)), mpDurationShort(num(d.medianDurationSec)),
        d.peak != null ? `${d.peak}（${iso(d.peakAt)?.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}）` : dash]), [1, 2, 3, 4, 5]) : null)
}
function paintMpSessions(result: any) {
  const rows = list<any>(result.sessions)
  if (!rows.length) return emptyState('还没有会话记录')
  return h('div', { class: 'adm-mp-scroll' }, mpTable(['玩家', '进入', '离开', '时长', '离开原因', '地区'], rows.map((r) => [
    h('div', { class: 'adm-mp-who' }, navLink(r.name, { view: 'mp', uid: String(r.uid) }, { class: 'adm-link', title: '只看这个玩家' }, true),
      h('small', null, `UID ${r.uid}`, r.accountId ? [' · ', navLink('账号', { view: 'users', id: r.accountId }, { class: 'adm-link' })] : null)),
    when(iso(r.joinedAt)), r.leftAt ? when(iso(r.leftAt)) : h('span', { class: 'adm-pill is-good' }, '在线'),
    mpDurationShort(num(r.durationSec)),
    [r.reason && r.reason !== 'lost observation' ? r.reason : r.reason ? '未观测到离开' : '', r.closeCode ? mpCloseText[r.closeCode] ?? `关闭码 ${r.closeCode}` : ''].filter(Boolean).join(' · ') || dash,
    mpRegion(r.region)]), [3]))
}

const socialBrand: Record<string, string> = {
  qq: '#12b7f5', wx: '#07c160', alipay: '#1677ff', douyin: '#111111',
  google: '#4285f4', twitter: '#1d9bf0', feishu: '#3370ff',
}
const socialName: Record<string, string> = {
  qq: 'QQ', wx: '微信', alipay: '支付宝', douyin: '抖音', google: 'Google', twitter: 'X', feishu: '飞书',
}
const userContact = (user: any) => user.email_placeholder ? '未绑定邮箱' : user.email
/** 渠道徽标：有官方图标用图标，否则用品牌色底 + 首字。 */
function channelMark(type: string, size = 14) {
  const icon = socialIcon(type, size)
  return h('i', { class: `adm-mark${icon ? ' has-icon' : ''}`, style: icon ? '' : `background:${socialBrand[type] ?? '#5d655f'}`, 'aria-hidden': 'true' },
    icon ?? (socialName[type] ?? type).slice(0, 1))
}
function signupTag(method: string) {
  if (!method || method === 'email') return h('span', { class: 'adm-chan adm-chan--email' }, h('i', { class: 'adm-mark adm-mark--email', 'aria-hidden': 'true' }, '@'), '邮箱')
  return h('span', { class: 'adm-chan' }, channelMark(method), socialName[method] ?? method)
}
/** 绑定情况：邮箱 + 每个第三方渠道一枚小徽标，悬停看昵称与最近登录。 */
function channelChips(user: any) {
  const social: { type: string; nickname: string; last_login_at: number }[] = user.social ?? []
  const chips: Child[] = []
  if (!user.email_placeholder)
    chips.push(h('span', { class: `adm-chip${user.verified ? '' : ' is-off'}`, title: user.verified ? `邮箱 ${user.email}` : `邮箱未验证：${user.email}` },
      h('i', { class: 'adm-mark adm-mark--email', 'aria-hidden': 'true' }, '@'), '邮箱'))
  for (const item of social)
    chips.push(h('span', { class: 'adm-chip', title: `${socialName[item.type] ?? item.type}：${item.nickname || '（无昵称）'} · 最近登录 ${ago(unix(item.last_login_at))}` },
      channelMark(item.type), socialName[item.type] ?? item.type))
  return chips.length ? h('span', { class: 'adm-chips' }, ...chips) : h('span', { class: 'adm-sub' }, '无')
}
/** 封禁 / 解封按钮；成功后把新的封禁状态交给 onchange 重绘。 */
function banButton(user: any, self: boolean, onchange: (next: { banned_at: number; ban_reason: string }) => void) {
  const banned = !!num(user.banned_at),
    admin = user.role === 'admin'
  const button = h('button', {
    type: 'button',
    class: `adm-btn ${banned ? 'adm-btn--ghost' : 'adm-btn--danger'}`,
    disabled: !banned && (self || admin),
    title: !banned && self ? '不能封禁自己' : !banned && admin ? '请先取消管理员身份' : undefined,
  }, banned ? '解除封禁' : '封禁') as HTMLButtonElement
  const who = user.nickname || userContact(user)
  button.addEventListener('click', () => act(button, async () => {
    const reason = await confirmDialog(banned
      ? {
          title: '解除封禁',
          tone: 'jade',
          confirm: '确认解封',
          body: h('div', null,
            h('p', null, h('b', null, who), `（${userContact(user)}）`),
            h('p', null, `封禁原因：${user.ban_reason || '未填写'}`),
            h('p', { class: 'adm-sub' }, '解封后 TA 可以重新用邮箱或第三方账号登录。此操作会记录在「操作记录」中。')),
        }
      : {
          title: '封禁账号',
          tone: 'seal',
          confirm: '确认封禁',
          body: h('div', null,
            h('p', null, h('b', null, who), `（${userContact(user)}）`),
            h('p', null, '封禁后 TA 会立即下线，邮箱和第三方登录都会被拒绝，也无法提交反馈或同步存档。登录时会看到下面填写的原因。')),
          message: { label: '封禁原因', required: true, placeholder: '例如：多次发布骚扰内容', max: 200, hint: '请填写封禁原因，用户登录时会看到' },
        })
    if (reason == null) return
    const result = await api<{ banned_at: number; ban_reason: string }>(
      `admin/users/${encodeURIComponent(user.id)}/${banned ? 'unban' : 'ban'}`, banned ? {} : { reason })
    toast(banned ? `已解除 ${who} 的封禁` : `已封禁 ${who}`)
    staleAll()
    onchange(result)
  }))
  return button
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
    // 两个账号都有存档时后端返回 409 save_conflict（user_id 是主键，只能留一份）。
    // 这里必须再问一次：管理员确认丢弃被合并账号的存档后，才带 force:true 重发。
    const send = (force: boolean) =>
      api<{ moved: string[]; conflicts: string[]; adopted_email: string }>(
        `admin/users/${encodeURIComponent(target.id)}/merge`, force ? { from, force: true } : { from })
    let result
    try {
      result = await send(false)
    } catch (error) {
      if (!(error instanceof ApiError) || error.code !== 'save_conflict') throw error
      const discard = await confirmDialog({
        title: '两个账号都有存档',
        tone: 'seal',
        confirm: '丢弃它的存档并合并',
        body: h('p', null,
          `「${from}」和「${target.email || target.id}」都有游戏存档，合并后只能保留一份。继续会丢弃「${from}」的存档，这一步不可撤销。`),
      })
      if (discard === null) return
      result = await send(true)
    }
    const parts = [`已合并 ${result.moved.length} 个平台绑定`]
    if (result.adopted_email) parts.push(`继承了邮箱 ${result.adopted_email}`)
    if (result.conflicts.length) parts.push(`跳过冲突平台 ${result.conflicts.join('/')}`)
    toast(parts.join('，'))
    staleAll()
    render({ keepScroll: true })
  })
  return h('div', { class: 'adm-merge' },
    h('h3', { class: 'adm-section-title' }, '合并账号'),
    h('p', { class: 'adm-sub' }, '把另一个重复账号（同一人先用第三方注册、后来又用邮箱注册）并进当前账号。'),
    h('div', { class: 'adm-merge-row' }, input, button))
}
/** 详情页的封禁状态条：正常账号只给按钮，已封禁时说明原因、时间和操作人。 */
function banPanel(user: any, onchange: () => void) {
  const banned = !!num(user.banned_at)
  const button = banButton(user, user.id === me.id, onchange)
  if (!banned) return h('div', { class: 'adm-ban adm-ban--ok' }, h('span', null, '账号状态：', h('b', null, '正常')), button)
  return h('div', { class: 'adm-ban', role: 'status' },
    h('div', null,
      h('b', null, '该账号已被封禁'),
      h('p', null, `原因：${user.ban_reason || '未填写'}`),
      h('small', null, `${when(unix(user.banned_at), true)} 封禁${user.banned_by ? (user.banned_by === me.id ? ' · 操作人：你' : ` · 操作人 ID ${String(user.banned_by).slice(0, 8)}`) : ''}`)),
    button)
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
          `${user.email_placeholder ? '未绑定邮箱（仅第三方登录）' : user.email} · ${user.role === 'admin' ? '管理员' : '普通用户'}${user.email_placeholder ? '' : ` · ${user.verified ? '邮箱已验证' : '邮箱未验证'}`}`)),
      banPanel(user, () => (staleAll(), render({ keepScroll: true }))),
      h('dl', { class: 'adm-kv' },
        h('dt', null, '注册方式'), h('dd', null, signupTag(user.signup_method)),
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
      securityCard({ id: user.id, email: user.email }),
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
        staleAll()
        refreshPending()
        render({ keepScroll: true })
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
      staleAll()
      render({ keepScroll: true })
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
  markSurface(document.body); markSession(me.uid)
  // Legacy links: ?view=perf / ?view=timeseries etc.
  const legacy: Record<string, string> = { bans:'security', perf: 'breakdown', timeseries: 'trends', funnel: 'overview' }
  if (legacy[params.get('view') ?? '']) go({ view: legacy[params.get('view')!] }, false, true)
  else render()
  if (!['overview', 'feedback', 'users'].includes(currentView())) refreshPending()
}
boot()

function screenshotTrace(refresh:()=>Promise<void>) {
  const file=h('input',{type:'file',accept:'image/png,image/jpeg',required:true})
  const upload=h('button',{class:'adm-btn adm-btn--sm',type:'submit'},'识别截图')
  const form=h('form',{class:'adm-mp-filters'},h('label',null,'PNG / JPEG（最多 12 MiB）',file),upload)
  const result=h('div',{'aria-live':'polite',class:'adm-sub'},'尚未上传截图')
  file.onchange=()=>result.replaceChildren('尚未识别')
  form.onsubmit=async event=>{
    event.preventDefault()
    const image=file.files?.[0]
    if(!image || image.size>12*1024*1024){result.replaceChildren('请选择不超过 12 MiB 的截图');return}
    file.disabled=upload.disabled=true; result.replaceChildren('识别中…')
    try {
      const response=await fetch('/api/admin/trace',{method:'POST',body:image})
      const data=await response.json()
      if(!response.ok) throw Error(`识别失败：${data.error ?? response.status}`)
      if(!data.ok){result.replaceChildren('未识别到有效的截图来源');return}
      const reason=h('input',{type:'text',maxlength:200,required:true})
      const minutes=h('select',null,...[[0,'永久'],[10,'10 分钟'],[60,'1 小时'],[1440,'24 小时']].map(([value,label])=>h('option',{value},label)))
      const actions=h('div',{class:'adm-mp-filters'},h('label',null,'时长',minutes),h('label',null,'原因',reason))
      const notice=h('p',{class:'adm-sub'})
      for(const [scope,label] of [['mp','只封联机'],['account','封禁账户'],['both','两者都封']]){
        const button=h('button',{class:'adm-btn adm-btn--sm',type:'button'},label)
        actions.append(button)
        button.onclick=async()=>{
          if(!reason.value.trim()){reason.focus();notice.textContent='请填写封禁原因';return}
          if(scope!=='mp' && Number(minutes.value)!==0){notice.textContent='账户封禁仅支持永久时长';return}
          if(!confirm(`确认对 UID ${data.uid} 执行「${label}」（${minutes.selectedOptions[0].text}）？`))return
          const buttons=Array.from(actions.querySelectorAll('button'))
          buttons.forEach(control=>control.disabled=true)
          try {
            const reply=await fetch('/api/admin/trace/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uid:data.uid,scope,minutes:Number(minutes.value),reason:reason.value.trim()})})
            const state=await reply.json()
            if(!reply.ok || !state.ok) throw Error(state.accountApplied?'账户已封禁，联机封禁失败':`操作失败：${state.error ?? reply.status}`)
            notice.textContent=`已执行：${label}`; await refresh()
          } catch(error){notice.textContent=String(error);buttons.forEach(control=>control.disabled=false)}
        }
      }
      result.replaceChildren(h('p',null,`UID ${data.uid} · ${data.account?.nickname ?? '账号资料缺失'}`),
        h('p',null,`时间区间：${when(new Date(data.from*1000),true)} — ${when(new Date(data.to*1000),true)}`),
        ...((data.devices?.length ? data.devices : [null]).map((device:any)=>h('p',null,`设备：${device && [device.model,device.browser,device.isp,device.city].filter(Boolean).join(' · ') || '暂无设备画像'}`))),
        h('p',null,`同设备其他账号：${data.sameDeviceUids?.join('、') || '无'}`),actions,notice)
    } catch(error){result.replaceChildren(String(error))}
    finally{file.disabled=upload.disabled=false}
  }
  return card('截图溯源',[form,result])
}

function securityCard(user: { id: string; email: string }) {
  const output = h('p', { class: 'adm-sub' })
  const reset = h('button', { type: 'button', class: 'adm-btn' }, '重置密码') as HTMLButtonElement
  reset.onclick = () => void act(reset, async () => {
    const answer = await confirmDialog({
      title: '重置密码',
      tone: 'seal',
      confirm: '生成新密码',
      body: h('p', null, `给「${user.email || user.id}」生成一个新密码？旧密码和所有登录会话都会立即失效。`),
    })
    if (answer === null) return
    const result = await api<{ password: string }>(`admin/users/${encodeURIComponent(user.id)}/password`, {})
    const code = h('code', null, result.password)
    output.replaceChildren(document.createTextNode('新密码：'), code, document.createTextNode('（复制后转交用户，只显示这一次）'))
  })

  const emailInput = h('input', { class: 'adm-merge-input', placeholder: '新的邮箱地址' }) as HTMLInputElement
  const emailButton = h('button', { type: 'button', class: 'adm-btn' }, '改邮箱') as HTMLButtonElement
  emailButton.onclick = () => void act(emailButton, async () => {
    const email = emailInput.value.trim()
    if (!email) throw new Error('请填写新的邮箱')
    const result = await api<{ email: string }>(`admin/users/${encodeURIComponent(user.id)}/email`, { email })
    toast(`邮箱已改为 ${result.email}`)
    staleAll()
    render({ keepScroll: true })
  })

  return h('div', { class: 'adm-merge' },
    h('h3', { class: 'adm-section-title' }, '账号安全'),
    h('p', { class: 'adm-sub' }, '占位邮箱（第三方专用）账号没有可用密码，只能用这里重置或补邮箱。'),
    h('div', { class: 'adm-merge-row' }, reset),
    h('div', { class: 'adm-merge-row' }, emailInput, emailButton),
    output)
}
