/**
 * 爱发电（赞助）面板
 *
 * 左边：赞赏码（public/support/qr.jpg）
 * 右边：赞助名单（public/support/sponsors.json，由管理员维护）
 *
 * 管理员入口：地址后面加 ?support=admin
 *   · 可添加/删除赞助条目（名字、留言、金额）
 *   · 编辑结果存在本机 localStorage，点「导出 JSON」下载 sponsors.json，上传覆盖即可
 *   （站点是静态托管，没有可写的后端，所以用「导出文件 + 覆盖」这套流程最稳）
 */
import './support.css'

interface Sponsor {
  name: string
  message?: string
  amount?: number
  date?: string
}

interface SupportFile {
  updated?: string
  note?: string
  sponsors?: Sponsor[]
}

const DRAFT_KEY = 'guiling.support.draft'
const DATA_URL = './support/sponsors.json'
/** 后台（MySQL）维护的名单；拿不到时退回静态 JSON */
const API_URL = '/api/sponsors'
const QR_URL = './support/qr.jpg'

let mask: HTMLElement | null = null
let draft: Sponsor[] | null = null

function loadDraft(): Sponsor[] | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function saveDraft(list: Sponsor[]) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(list))
  } catch {
    /* 忽略 */
  }
}

function isAdmin() {
  // 三种写法都认：?support=admin（查询参数）、/admin（路径，靠 nginx 回落 index.html）、#support-admin（hash）
  if (new URLSearchParams(location.search).get('support') === 'admin') return true
  if (/\/admin\/?$/i.test(location.pathname)) return true
  return /support-?admin/i.test(location.hash)
}

function money(amount?: number) {
  if (!amount || amount <= 0) return ''
  return '¥' + (Number.isInteger(amount) ? amount : amount.toFixed(2))
}

function esc(text: string) {
  return text.replace(/[&<>"']/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[ch] ?? ch))
}

function render(list: Sponsor[]) {
  if (!mask) return
  const body = mask.querySelector<HTMLElement>('.sponsor-list')!
  const total = list.reduce((sum, item) => sum + (item.amount ?? 0), 0)
  const count = mask.querySelector<HTMLElement>('.sponsor-count')!
  count.textContent = `${list.length} 位 · 累计 ${money(total) || '¥0'}`
  if (!list.length) {
    body.innerHTML = '<p class="sponsor-empty">还没有赞助记录。<br>扫码支持一下，留言写上你的<b>游戏名字 + 想说的话</b>，就会出现在这里。</p>'
    return
  }
  body.innerHTML = list
    .map(
      item => `<article class="sponsor-item">
        <header><b>${esc(item.name || '匿名')}</b>${item.amount ? `<em>${money(item.amount)}</em>` : ''}</header>
        ${item.message ? `<p>${esc(item.message)}</p>` : ''}
        ${item.date ? `<time>${esc(item.date)}</time>` : ''}
      </article>`,
    )
    .join('')
}

function renderAdmin(list: Sponsor[]) {
  if (!mask) return
  const box = mask.querySelector<HTMLElement>('.sponsor-admin')!
  box.hidden = !isAdmin()
  if (!isAdmin()) return
  const rows = list
    .map(
      (item, index) => `<li>
        <span>${esc(item.name || '匿名')}${item.amount ? ' · ' + money(item.amount) : ''}${item.message ? ' · ' + esc(item.message) : ''}</span>
        <button type="button" data-del="${index}" aria-label="删除">×</button>
      </li>`,
    )
    .join('')
  box.innerHTML = `
    <h3>管理员：赞助名单</h3>
    <form class="sponsor-form">
      <input name="name" placeholder="游戏名字" maxlength="24" required>
      <input name="amount" placeholder="金额（元）" type="number" min="0" step="1">
      <input name="message" placeholder="留言" maxlength="60">
      <button type="submit">添加</button>
    </form>
    <ul class="sponsor-rows">${rows}</ul>
    <div class="sponsor-actions">
      <button type="button" class="sponsor-export">导出 sponsors.json</button>
      <button type="button" class="sponsor-reset">放弃本机修改</button>
    </div>
    <p class="sponsor-hint">导出后上传覆盖 <code>public/support/sponsors.json</code>（服务器上的 <code>/support/sponsors.json</code>）。</p>`

  box.querySelector<HTMLFormElement>('.sponsor-form')!.onsubmit = event => {
    event.preventDefault()
    const form = event.target as HTMLFormElement
    const data = new FormData(form)
    const name = String(data.get('name') || '').trim()
    if (!name) return
    const amountRaw = Number(data.get('amount'))
    list.unshift({
      name,
      message: String(data.get('message') || '').trim() || undefined,
      amount: Number.isFinite(amountRaw) && amountRaw > 0 ? amountRaw : undefined,
      date: new Date().toISOString().slice(0, 10),
    })
    commit(list)
  }
  for (const button of Array.from(box.querySelectorAll<HTMLButtonElement>('[data-del]'))) {
    button.onclick = () => {
      list.splice(Number(button.dataset.del), 1)
      commit(list)
    }
  }
  box.querySelector<HTMLButtonElement>('.sponsor-export')!.onclick = () => {
    const text = JSON.stringify({updated: new Date().toISOString().slice(0, 10), note: '管理员维护', sponsors: list}, null, 1)
    const blob = new Blob([text], {type: 'application/json'})
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = 'sponsors.json'
    link.click()
    setTimeout(() => URL.revokeObjectURL(link.href), 2000)
  }
  box.querySelector<HTMLButtonElement>('.sponsor-reset')!.onclick = () => {
    try {
      localStorage.removeItem(DRAFT_KEY)
    } catch {
      /* 忽略 */
    }
    void open(true)
  }
}

function commit(list: Sponsor[]) {
  saveDraft(list)
  render(list)
  renderAdmin(list)
}

async function fetchList(): Promise<Sponsor[]> {
  // 1) 后台接口（管理员在 /admin 里改完立刻生效）
  try {
    const response = await fetch(API_URL, {cache: 'no-cache'})
    if (response.ok) {
      const json = (await response.json()) as {sponsors?: Sponsor[]}
      if (Array.isArray(json.sponsors)) return json.sponsors
    }
  } catch {
    /* 没有接口就走静态文件 */
  }
  // 2) 静态 JSON（没部署后台时仍能显示）
  try {
    const response = await fetch(DATA_URL, {cache: 'no-cache'})
    if (!response.ok) throw Error(String(response.status))
    const json = (await response.json()) as SupportFile
    return Array.isArray(json.sponsors) ? json.sponsors : []
  } catch {
    return []
  }
}

export async function open(force = false) {
  if (mask && !force) {
    mask.hidden = false
    return
  }
  if (!mask) {
    mask = document.createElement('div')
    mask.className = 'sponsor-mask'
    mask.innerHTML = `
      <section class="sponsor-panel" role="dialog" aria-modal="true" aria-label="爱发电">
        <button class="sponsor-close" type="button" aria-label="关闭">×</button>
        <header class="sponsor-head">
          <h2>爱发电</h2>
          <p>「网上桂林」免费开放，服务器和素材都要钱。愿意的话请我喝杯奶茶。</p>
        </header>
        <div class="sponsor-body">
          <aside class="sponsor-qr">
            <img src="${QR_URL}" alt="赞赏码" width="240" height="240">
            <p class="sponsor-ask">扫码支持 · 请留言<b>游戏名字 + 想说的话</b></p>
          </aside>
          <section class="sponsor-list-wrap">
            <div class="sponsor-list-head">
              <h3>赞助名单</h3>
              <span class="sponsor-count"></span>
            </div>
            <div class="sponsor-list"></div>
            <div class="sponsor-admin" hidden></div>
          </section>
        </div>
      </section>`
    document.body.append(mask)
    mask.querySelector('.sponsor-close')!.addEventListener('click', () => {
      mask!.hidden = true
    })
    mask.addEventListener('click', event => {
      if (event.target === mask) mask!.hidden = true
    })
  }
  mask.hidden = false
  const local = isAdmin() ? loadDraft() : null
  const list = local ?? (await fetchList())
  draft = list
  render(list)
  renderAdmin(list)
}

/** 给 dock 按钮用：点一下开面板 */
export function mountSupportButton() {
  const buttons = document.querySelector<HTMLElement>('.dock-buttons')
  if (!buttons) {
    // 首页没有工具栏：管理员进来也要能看到面板
    if (isAdmin()) setTimeout(() => void open(), 800)
    return
  }
  if (buttons.querySelector('.dock-support')) return
  const button = document.createElement('button')
  button.className = 'dock-support'
  button.textContent = '爱发电'
  button.title = '赞助 · 爱发电'
  button.setAttribute('aria-label', '打开爱发电赞助面板')
  // 排在最后（地图下方），不依赖插入顺序
  button.style.order = '99'
  button.onclick = () => void open()
  buttons.append(button)
  // 管理员入口（/admin、?support=admin、#support-admin）进来就直接弹面板，
  // 不用再找按钮，省得以为「没有添加选项」。
  if (isAdmin()) setTimeout(() => void open(), 1200)
}
