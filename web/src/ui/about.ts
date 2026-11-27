import './about.css'
import { readJson } from '../lib/json'
import {photoCredits} from './photo-credits'
import {SOURCE_URL} from './source'
import {contributors, KIND_LABEL, type ContribKind, type Contributor} from './contributors'
import {defaultAvatar, type Avatar} from '../../../lib/avatar'

const dataLines = [
  '© OpenStreetMap contributors（ODbL）',
  'Overture Maps / Zenodo 8174931 建筑（CC BY 4.0）',
  'Mapzen Terrarium 高程瓦片',
]

const FILTERS:[ContribKind|'all',string][] = [['all','全部'],['code','写代码'],['design','设计'],['feedback','提反馈']]

let mask:HTMLDivElement|undefined

/** 关于：Logo 与一句话介绍、贡献者（按人、按做了什么）、致谢、数据与照片署名、版本。由主界面打开。 */
export function openAbout() {
  if (!mask) {
    let people = contributors
    const count = (kind:ContribKind) => people.filter(p => p.items.some(i => i.kind === kind)).length
    const stats = () => `<b>${people.length}</b> 位伙伴 · <b>${count('code')}</b> 位写过代码 · <b>${count('feedback')}</b> 位提过反馈`
    mask = document.createElement('div')
    mask.className = 'about-mask'
    mask.hidden = true
    mask.innerHTML = `<div class="about-panel about-panel--wide" role="dialog" aria-modal="true" aria-labelledby="about-title">
      <header><h2 id="about-title">关于网上桂林</h2><button type="button" class="about-close" aria-label="关闭">关闭</button></header>
      <div class="about-body">
        <section class="ab-hero">
          <div class="ab-logo"><img src="./brand/logo.webp" width="377" height="291" alt="网上桂林 Guilin Online 标志"></div>
          <div class="ab-intro">
            <p class="ab-lead">把整座桂林城，<br>照着真实地图搬进浏览器。</p>
            <p>山在哪、江怎么弯、街道怎么走，都和现实一一对应。可以飞上天看两江四湖，也可以落地沿着街巷慢慢逛。</p>
            <div class="ab-actions">
              <a class="ui-btn ui-btn--paper" href="${SOURCE_URL}" target="_blank" rel="noopener" data-umami-event="about-source">源代码在 GitHub ↗</a>
              <span class="ab-version">v${escape(__APP_VERSION__)}</span>
            </div>
          </div>
        </section>

        <section class="ab-people" aria-labelledby="ab-people-title">
          <div class="ab-people-head">
            <h3 id="ab-people-title">一起做网上桂林的人</h3>
            <p class="ab-stats">${stats()}</p>
          </div>
          <div class="ab-filter" role="toolbar" aria-label="按贡献筛选">
            ${FILTERS.map(([kind,label],i) => `<button type="button" class="ab-chip" data-kind="${kind}" aria-pressed="${i === 0}">${kind === 'all' ? '' : `<i>${KIND_LABEL[kind].seal}</i>`}${label}</button>`).join('')}
          </div>
          <ul class="ab-grid">${people.map(card).join('')}</ul>
          <p class="ab-join">在游戏里点右上角「反馈」告诉我们哪里不像桂林——被采纳的反馈，会在这里署上你的昵称。</p>
        </section>

        <section class="ab-thanks">
          <h3>致谢</h3>
          <p>网上桂林受 <a href="https://nanningol.com" target="_blank" rel="noopener">网上南宁</a>（nanningol.com）启发而做。是他们先把一座真实的城市搬进浏览器，让我们想到也给桂林做一个——谢谢网上南宁。</p>
        </section>

        <details class="ab-fine">
          <summary>数据与署名</summary>
          <div class="ab-fine-body">
            <section><h4>地图数据</h4><ul>${dataLines.map(line => `<li>${line}</li>`).join('')}</ul></section>
            <section><h4>参考照片</h4>${photoHtml()}</section>
            <section><h4>角色</h4><p>城市漫游者模型与动画为原创，以 CC0 1.0 提供。</p></section>
          </div>
        </details>
        <p class="ab-build">v${escape(__APP_VERSION__)} · 构建 ${escape(formatBuild(__BUILD_TIME__))}</p>
      </div>
    </div>`
    const close = () => { mask!.hidden = true }
    const grid = mask.querySelector<HTMLElement>('.ab-grid')!
    // 反馈上线后自动署名（IDOK-186）：从 /api/contributors 取，合进手写名单；取不到就只显示手写名单
    void loadFeedbackPeople().then(extra => {
      if (!extra.length || !mask) return
      people = merge(contributors, extra)
      mask.querySelector('.ab-stats')!.innerHTML = stats()
      grid.innerHTML = people.map(card).join('')
      mask.querySelector<HTMLButtonElement>(`.ab-chip[aria-pressed="true"]`)?.click()
      void drawPortraits(grid)
    })
    mask.querySelectorAll<HTMLButtonElement>('.ab-chip').forEach(chip => chip.addEventListener('click', () => {
      mask!.querySelectorAll('.ab-chip').forEach(other => other.setAttribute('aria-pressed', String(other === chip)))
      const kind = chip.dataset.kind!
      grid.dataset.filter = kind
      let shown = 0
      grid.querySelectorAll<HTMLElement>('.ab-card').forEach(el => {
        const on = kind === 'all' || el.dataset.kinds!.split(' ').includes(kind)
        el.hidden = !on
        if (on) el.style.setProperty('--i', String(shown++))
      })
      grid.classList.remove('ab-replay'); void grid.offsetWidth; grid.classList.add('ab-replay')
    }))
    mask.querySelector('.about-close')!.addEventListener('click', close)
    mask.addEventListener('click', event => { if (event.target === mask) close() })
    window.addEventListener('keydown', event => { if (event.code === 'Escape' && !mask!.hidden) close() })
    document.body.append(mask)
  }
  mask.hidden = false
  const grid = mask.querySelector<HTMLElement>('.ab-grid')!
  grid.classList.remove('ab-replay'); void grid.offsetWidth; grid.classList.add('ab-replay')
  mask.querySelector<HTMLButtonElement>('.about-close')!.focus()
}

function card(person:Contributor, index:number) {
  const kinds = [...new Set(person.items.map(i => i.kind))]
  const main = kinds[0]
  const hasLogo = person.items.some(i => i.kind === 'design')
  const name = person.github
    ? `<a href="https://github.com/${encodeURIComponent(person.github)}" target="_blank" rel="noopener" title="GitHub @${escape(person.github)}">${escape(person.name)}<span class="ab-gh" aria-hidden="true">↗</span></a>`
    : escape(person.name)
  return `<li class="ab-card ab-card--${main}" data-kinds="${kinds.join(' ')}" style="--i:${index}">
    <div class="ab-card-top">
      ${person.portrait
        ? `<span class="ab-avatar" aria-hidden="true"><img src="./contributors/${encodeURIComponent(person.portrait)}.webp" alt="" width="96" height="96" loading="lazy" decoding="async"></span>`
        : `<span class="ab-avatar ab-avatar--seal" aria-hidden="true"><i>${escape(Array.from(person.name)[0] ?? '友')}</i></span>`}
      <div class="ab-who"><b>${name}</b><small>${escape(person.role)}</small></div>
    </div>
    ${hasLogo ? '<div class="ab-card-logo"><img src="./brand/emblem.webp" alt="" width="371" height="144" loading="lazy"></div>' : ''}
    <ul class="ab-items">${person.items.map((item,j) => `<li data-kind="${item.kind}" title="${KIND_LABEL[item.kind].label}" style="--j:${j}"><i aria-hidden="true">${KIND_LABEL[item.kind].seal}</i>${escape(item.text)}</li>`).join('')}</ul>
  </li>`
}

/** 反馈被处理并上线的玩家：昵称 + 几个字 + 游戏角色外形（服务端只给这些） */
interface FeedbackPerson {name:string; avatar:Avatar|null; items:string[]}

let players:Contributor[] = []

async function loadFeedbackPeople():Promise<FeedbackPerson[]> {
  try {
    const response = await fetch('/api/contributors', {signal: AbortSignal.timeout(8000)})
    if (!response.ok) return []
    const rows = await readJson<unknown>(response)
    return Array.isArray(rows) ? rows.filter(row => typeof row?.name === 'string' && Array.isArray(row.items)) : []
  } catch {
    return []
  }
}

/** 同名的并进手写名单那一项（只补没写过的几个字），新的人排在后面，按头像实时渲染 */
function merge(base:Contributor[], extra:FeedbackPerson[]) {
  const list = base.map(person => ({...person, items: [...person.items]}))
  players = []
  for (const row of extra) {
    const texts = row.items.filter((text):text is string => typeof text === 'string' && !!text.trim())
    const known = list.find(person => person.name.toLowerCase() === row.name.toLowerCase())
    if (known) {
      for (const text of texts) if (!known.items.some(item => item.text === text)) known.items.push({kind: 'feedback', text})
      continue
    }
    if (!texts.length) continue
    const person:Contributor = {name: row.name, role: '玩家', portrait: '', avatar: {...defaultAvatar(1), ...(row.avatar ?? {})}, items: texts.map(text => ({kind: 'feedback' as const, text}))}
    list.push(person)
    players.push(person)
  }
  return list
}

/** 没有预渲染头像的玩家：用角色创建页同一套舞台现场画头像（和 scripts/contributor-portraits.mjs 一致）；画不出来就留昵称首字印章 */
async function drawPortraits(grid:HTMLElement) {
  const seals = Array.from(grid.querySelectorAll<HTMLElement>('.ab-avatar--seal'))
  if (!seals.length) return
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-400px;top:0;width:192px;height:192px;pointer-events:none'
  document.body.append(host)
  let stage:ReturnType<typeof import('./creator-stage').creatorStage> | undefined
  try {
    const {creatorStage} = await import('./creator-stage')
    stage = creatorStage(host, true, true)
    const canvas = host.querySelector('canvas')!
    for (const seal of seals) {
      const name = seal.closest('.ab-card')?.querySelector('.ab-who b')?.textContent
      const person = players.find(item => item.name === name)
      if (!person) continue
      try {
        await stage.apply(person.avatar)
        stage.angle(0.35)
        stage.frameHead(true, 0.955)
        await new Promise(done => setTimeout(done, 900))
        const square = document.createElement('canvas')
        square.width = square.height = 192
        square.getContext('2d')!.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, 192, 192)
        const img = new Image(96, 96)
        img.alt = ''
        img.src = square.toDataURL('image/webp', 0.9)
        seal.classList.remove('ab-avatar--seal')
        seal.replaceChildren(img)
      } catch {
        // 这个人的外形画不出来：保留首字印章，继续下一个
      }
    }
  } catch {
    // WebGL 不可用：保留首字印章
  } finally {
    stage?.dispose()
    host.remove()
  }
}

function photoHtml() {
  if (!photoCredits.length) return '<p>地标按 Wikimedia Commons 照片参照建模；照片不入库、不作贴图。</p>'
  const items = photoCredits.map(row => {
    const who = row.authors.length ? row.authors.join('、') : 'Commons 贡献者'
    const lic = row.licenses.join(' / ')
    return `<li><strong>${escape(row.name)}</strong> — ${escape(who)}（${escape(lic)}）</li>`
  }).join('')
  return `<p>地标按 Wikimedia Commons 照片参照建模；照片不入库、不作贴图。</p><ul class="about-photos">${items}</ul>`
}

function formatBuild(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`
}

function escape(text: string) {
  return text.replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]!))
}
