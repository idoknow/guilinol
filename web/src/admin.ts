import { labels, viewToken } from '../../lib/feedback-contract'
import './admin.css'

const main = document.querySelector('main')!,
  nav = document.querySelector('nav')!
const params = new URLSearchParams(location.search)
function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: unknown) {
  const node = document.createElement(tag)
  if (text != null) node.textContent = String(text)
  return node
}
function link(label: string, href: string) {
  const node = el('a', label)
  node.href = href
  return node
}
function external(label: string, href: string) {
  if (!href.startsWith('https://') && !href.startsWith('/api/feedback/')) return el('span', label)
  const node = link(label, href)
  node.target = '_blank'
  node.rel = 'noopener noreferrer'
  return node
}
const date = (stamp: unknown) => (stamp ? new Date(Number(stamp) * 1000).toLocaleString('zh-CN') : '—')
class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}
async function api(path: string, data?: unknown) {
  const response = await fetch(
    `/api/${path}`,
    data
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }
      : {},
  )
  const result = await response.json()
  if (!response.ok) throw new ApiError(response.status, result.error?.message || '读取失败')
  return result
}
function failure(error: unknown) {
  if (error instanceof ApiError && [401, 403].includes(error.status)) {
    nav.replaceChildren(link('返回首页', '/'))
    main.replaceChildren(error.status === 401 ? link('请回首页登录', '/') : el('p', '无权限'))
  } else main.prepend(el('p', error instanceof Error ? error.message : '请求失败'))
}
function table(headers: string[], rows: (string | number | Node)[][]) {
  const grid = el('table')
  grid.className = 'adm-table'
  const head = grid.createTHead().insertRow()
  for (const header of headers) head.append(el('th', header))
  const body = grid.createTBody()
  for (const values of rows) {
    const row = body.insertRow()
    for (const value of values) row.insertCell().append(value instanceof Node ? value : String(value))
  }
  main.append(grid)
  if (!rows.length) main.append(el('p', '没有符合条件的记录'))
}
function pill(status: string) {
  const node = el('span', labels[status] ?? status)
  node.className = `adm-pill adm-status--${status}`
  return node
}
function option(value: string, label: string) {
  const node = el('option', label)
  node.value = value
  return node
}
type User = {
  id: string
  email: string
  nickname: string
  verified: boolean
  role: string
  created_at: number
  feedback_count: number
  last_submitted_at: number | null
}
type Feedback = {
  unread:number
  id: string
  title: string
  kind: string
  status: string
  email: string
  nickname: string
  lat: number
  lon: number
  photo_count: number
  submitted_at: number | null
  updated_at: number
}
function filters(users: boolean) {
  const form = el('form'),
    query = el('input'),
    view = el('input')
  form.className = 'adm-filters'
  view.type = 'hidden'
  view.name = 'view'
  view.value = users ? 'users' : 'feedback'
  form.append(view)
  const queryLabel = el('label', users ? '邮箱或昵称 ' : '标题、正文或提交人 ')
  query.type = 'search'
  query.name = 'q'
  query.value = params.get('q') || ''
  queryLabel.append(query)
  form.append(queryLabel)
  if(users){const role=el('select');role.name='role';role.append(option('','所有角色'),option('admin','管理员'),option('user','用户'));role.value=params.get('role')??'';form.append(role)}
  if (!users) {
    const status = el('select')
    status.name = 'status'
    status.append(option('pending','待批准'),option('', '所有状态'), ...Object.entries(labels).map(([key, label]) => option(key, label)))
    status.value = params.get('status') || ''
    const label = el('label', ' 状态 ')
    label.append(status)
    form.append(label)
    if (params.get('user')) {
      const user = el('input')
      user.type = 'hidden'
      user.name = 'user'
      user.value = params.get('user')!
      form.append(user, link('清除提交人筛选', '?view=feedback'))
    }
  }
  form.append(el('button', '搜索'))
  main.append(form)
}
async function list(users: boolean) {
  if(!users&&!params.has('status'))params.set('status','pending')
  if (users) {
    const stats = await api('admin/stats')
    main.append(el('h2', '统计'))
    const cards = el('section')
    cards.className = 'adm-stats'
    for (const [name, value] of [
      ['用户总数', stats.total],
      ['已验证', stats.verified],
      ['24 小时新增', stats.new_24h],
    ]) {
      const card = el('div')
      card.className = 'adm-stat'
      card.append(el('b', value), el('span', name))
      cards.append(card)
    }
    const counts = el('div')
    counts.className = 'adm-counts'
    for (const [key, name] of Object.entries(labels)) {
      const chip = link(`${name} ${stats.feedback[key] || 0}`, `?view=feedback&status=${key}`)
      chip.className = `adm-pill adm-status--${key}`
      counts.append(chip)
    }
    main.append(cards, el('h2', '反馈状态'), counts)
  }
  main.append(el('h2', users ? '用户列表' : '反馈列表'))
  filters(users)
  const page = await api(`admin/${users ? 'users' : 'feedback'}?${params}`)
  if (users)
    table(
      ['邮箱', '昵称', '验证', '角色', '注册时间', '反馈数', '最近提交'],
      page.items.map((user: User) => [
        user.email,
        user.nickname,
        user.verified ? '已验证' : '未验证',
        (()=>{const button=el('button',user.role==='admin'?'取消管理员':'设为管理员')
          button.disabled=!user.verified
          button.onclick=async()=>{try{await api('admin/users/'+encodeURIComponent(user.id)+'/role',{role:user.role==='admin'?'user':'admin'});location.reload()}catch(error){failure(error)}}
          const cell=el('span',user.role+' ');cell.append(button);return cell})(),
        date(user.created_at),
        link(String(user.feedback_count), `?view=feedback&user=${encodeURIComponent(user.id)}`),
        date(user.last_submitted_at),
      ]),
    )
  else
    table(
      ['标题', '类型', '状态', '提交人', '经纬度', '照片', '提交时间', '更新时间'],
      page.items.map((item: Feedback) => [
        link(item.title+(item.unread?`（${item.unread} 条未读）`:''), '?id=' + encodeURIComponent(item.id)),
        item.kind,
        pill(item.status),
        `${item.nickname} (${item.email})`,
        `${item.lon}, ${item.lat}`,
        item.photo_count,
        date(item.submitted_at),
        date(item.updated_at),
      ]),
    )
  const next = new URLSearchParams(params)
  if (params.has('cursor')) {
    next.delete('cursor')
    main.append(link('回到第一页', '?' + next), ' ')
  }
  if (page.next_cursor) {
    next.set('cursor', page.next_cursor)
    main.append(link('下一页', '?' + next))
  }
}
async function detail(id: string) {
  const path = 'admin/feedback/' + encodeURIComponent(id),
    item = await api(path)
  main.append(
    el('h2', item.title),
    (() => {
      const meta = el('p')
      meta.className = 'adm-meta'
      meta.append(pill(item.status), ` ${item.kind} · ${item.nickname} (${item.email})`)
      return meta
    })(),
    (() => {
      const body = el('p', item.body)
      body.className = 'adm-body'
      return body
    })(),
    el(
      'p',
      `经度 ${item.lon}，纬度 ${item.lat}；朝向 ${item.heading ?? '—'}；地标 ${item.landmark_id ?? '—'}`,
    ),
    el('p', `提交 ${date(item.submitted_at)}，更新 ${date(item.updated_at)}`),
  )
  if (item.issue_url) main.append(external('Multica issue', item.issue_url), ' ')
  if (item.pr_url) main.append(external('查看 PR', item.pr_url))
  if(item.view){main.append(el('h3','游戏视角'),el('pre',JSON.stringify(item.view,null,2)),link('在游戏中打开此视角','/?view='+viewToken(item.view)))}
  if(item.has_view_shot){const image=el('img');image.alt='反馈视角截图';image.src=`/api/feedback/${encodeURIComponent(id)}/view-shot`;main.append(image)}
  main.append(el('h3', '照片'))
  const photos = el('div')
  photos.className = 'adm-photos'
  main.append(photos)
  for (const photo of item.photos) {
    const url = `/api/feedback/${encodeURIComponent(id)}/photos/${photo.n}`,
      anchor = external('', url),
      image = el('img')
    image.src = url
    image.loading = 'lazy'
    image.alt = `照片 ${photo.n}`
    anchor.append(image)
    const figure = el('figure')
    figure.append(
      anchor,
      el(
        'figcaption',
        `${photo.view_label ?? '未标注视角'} · ${photo.mime} · ${photo.bytes} 字节 · EXIF 纬度 ${photo.exif_lat ?? '—'}，经度 ${photo.exif_lon ?? '—'}，朝向 ${photo.exif_dir ?? '—'}，时间 ${photo.exif_time ?? '—'}`,
      ),
    )
    photos.append(figure)
  }
  main.append(el('h3', '时间线'))
  const events = el('ol')
  events.className = 'adm-timeline'
  for (const event of [...item.events,...item.messages].sort((left,right)=>left.created_at-right.created_at)) {
    if(event.author_kind){const msg=el('li');msg.className=`adm-msg adm-msg--${event.author_kind}`;const meta=el('span');meta.className='adm-msg-meta';meta.append(el('b',event.author_name),' ',el('time',date(event.created_at)));const text=el('p',event.body);text.className='adm-msg-body';msg.append(meta,text);events.append(msg);continue}
    const entry = el('li', `${date(event.created_at)} · ${labels[event.status]} · ${event.message} `)
    if (event.screenshot_url) entry.append(external('查看截图', event.screenshot_url))
    events.append(entry)
  }
  main.append(events)
  if(!['draft','live','rejected','duplicate'].includes(item.status)){const input=el('textarea'),send=el('button','以管理员身份回复'),box=el('div');box.className='adm-compose';input.maxLength=1000;input.rows=3;input.placeholder='回复提交人（会同时发邮件提醒）';input.setAttribute('aria-label','管理员回复内容');box.append(input,send);main.append(box);send.onclick=async()=>{try{await api(path+'/messages',{body:input.value});location.reload()}catch(error){failure(error)}}}
  if(item.allowed_transitions.some((t:{status:string})=>t.status==='approved')){const start=el('button','发起 AI 制作'),gate=el('div');start.className='adm-primary';gate.className='adm-gate';gate.append(el('p','确认信息足够后发起制作，协调人会收到开工通知。'),start);main.append(gate);start.onclick=async()=>{try{await api(path+'/status',{status:'approved'});location.reload()}catch(error){failure(error)}}}
  const transitions=item.allowed_transitions.filter((t:{status:string})=>t.status!=='approved') as {status:string;label:string;needs_message:boolean}[]
  if (!transitions.length) return
  const form = el('form'),
    select = el('select'),
    statusLabel = el('label', '新状态 '),
    messageLabel = el('label', ' 说明 '),
    message = el('textarea'),
    button = el('button', '保存状态')
  message.required = true
  message.maxLength = 2000
  for (const t of transitions) select.append(option(t.status,t.label))
  select.onchange=()=>{message.required=transitions[select.selectedIndex].needs_message}
  message.required=transitions[0].needs_message
  statusLabel.append(select)
  messageLabel.append(message)
  form.className = 'adm-status-form'
  form.append(statusLabel, messageLabel, button)
  main.append(el('h3', '更改状态'), form)
  form.onsubmit = async (event) => {
    event.preventDefault()
    button.disabled = true
    try {
      await api(path + '/status', { status: select.value, message: message.value })
      location.reload()
    } catch (error) {
      failure(error)
      button.disabled = false
    }
  }
}
async function start() {
  const profile = await api('me')
  if (profile.role !== 'admin') throw new ApiError(403, '无权限')
  nav.append(' · ',link('性能遥测','?view=perf'),' · ', link('统计与用户', '?view=users'), ' · ', link('反馈列表', '?view=feedback'))
  main.replaceChildren()
  const id = params.get('id')
  const views={overview:'概览',timeseries:'时间序列',breakdown:'维度',funnel:'漏斗',errors:'错误',live:'实时',audit:'审计'}
  for(const [key,label] of Object.entries(views))nav.append(' · ',link(label,'?view='+key))
  const view=params.get('view')??''
  if(Object.hasOwn(views,view))main.append(el('pre',JSON.stringify(await api('admin/'+view+'?'+params),null,2)))
  else if(params.get('view')==='perf') main.append(el('pre',JSON.stringify(await api('admin/perf?group=device'),null,2)))
  else if (id) await detail(id)
  else await list(params.get('view') !== 'feedback')
}
start().catch(failure)
