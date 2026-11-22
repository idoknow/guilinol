import {photoCredits} from './photo-credits'
import {SOURCE_URL} from './source'

const dataLines = [
  '© OpenStreetMap contributors（ODbL）',
  'Overture Maps / Zenodo 8174931 建筑（CC BY 4.0）',
  'Mapzen Terrarium 高程瓦片',
]

let mask:HTMLDivElement|undefined

/** 关于：作品介绍、开源地址、致谢、数据与照片署名、版本。由主界面打开。 */
export function openAbout() {
  if (!mask) {
    mask = document.createElement('div')
    mask.className = 'about-mask'
    mask.hidden = true
    mask.innerHTML = `<div class="about-panel" role="dialog" aria-modal="true" aria-labelledby="about-title">
      <header><h2 id="about-title">关于网上桂林</h2><button type="button" class="about-close" aria-label="关闭">关闭</button></header>
      <div class="about-body"></div>
    </div>`
    const close = () => { mask!.hidden = true }
    mask.querySelector('.about-body')!.append(
      section('这是什么', '<p>一款 3D 漫游游戏。整座桂林城按真实地图搭建：山在哪、江怎么弯、街道怎么走，都和现实一一对应。你可以飞上天看两江四湖，也可以落地沿着街巷慢慢逛。</p>'),
      section('开源', `<p>代码公开在 GitHub，欢迎任何人查看、提建议或参与制作：<br><a href="${SOURCE_URL}" target="_blank" rel="noopener">${SOURCE_URL.replace('https://', '')}</a></p>`),
      section('致谢', '<p>网上桂林受 <a href="https://nanningol.com" target="_blank" rel="noopener">网上南宁</a>（nanningol.com）启发而做。是他们先把一座真实的城市搬进浏览器，让我们想到也给桂林做一个——谢谢网上南宁。</p>'),
      section('地图数据', `<ul>${dataLines.map(line => `<li>${line}</li>`).join('')}</ul>`),
      section('参考照片', photoHtml()),
      section('角色', '<p>城市漫游者模型与动画为原创，以 CC0 1.0 提供。</p>'),
      section('版本', `<p>v${escape(__APP_VERSION__)} · 构建 ${escape(formatBuild(__BUILD_TIME__))}</p>`),
    )
    mask.querySelector('.about-close')!.addEventListener('click', close)
    mask.addEventListener('click', event => { if (event.target === mask) close() })
    window.addEventListener('keydown', event => { if (event.code === 'Escape' && !mask!.hidden) close() })
    document.body.append(mask)
  }
  mask.hidden = false
  mask.querySelector<HTMLButtonElement>('.about-close')!.focus()
}

function section(title: string, html: string) {
  const el = document.createElement('section')
  el.innerHTML = `<h3>${title}</h3>${html}`
  return el
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
