import {photoCredits} from './photo-credits'

const dataLines = [
  '© OpenStreetMap contributors（ODbL）',
  'Overture Maps / Zenodo 8174931 建筑（CC BY 4.0）',
  'Mapzen Terrarium 高程瓦片',
]

export function aboutPanel() {
  void import('./account').then(module=>module.accountPanel())
  const btn = document.createElement('button')
  btn.className = 'btn-about'
  btn.type = 'button'
  btn.textContent = '关于'
  btn.setAttribute('aria-haspopup', 'dialog')

  const mask = document.createElement('div')
  mask.className = 'about-mask'
  mask.hidden = true
  mask.innerHTML = `<div class="about-panel" role="dialog" aria-modal="true" aria-labelledby="about-title">
    <header><h2 id="about-title">关于网上桂林</h2><button type="button" class="about-close" aria-label="关闭">关闭</button></header>
    <div class="about-body"></div>
  </div>`
  const body = mask.querySelector('.about-body')!
  const close = () => { mask.hidden = true; btn.setAttribute('aria-expanded', 'false') }
  const open = () => { mask.hidden = false; btn.setAttribute('aria-expanded', 'true') }

  body.innerHTML = ''
  body.append(
    section('简介', '<p>真实地理布局的桂林第三人称 3D 城市漫游。飞、走，看山水与街区。</p>'),
    section('操作', controlsHtml()),
    section('数据署名', `<ul>${dataLines.map(line => `<li>${line}</li>`).join('')}</ul>`),
    section('参考照片', photoHtml()),
    section('角色', '<p>城市漫游者模型与动画为原创，以 CC0 1.0 提供。</p>'),
    section('版本', `<p>v${escape(__APP_VERSION__)} · 构建 ${escape(formatBuild(__BUILD_TIME__))}</p>`),
  )

  btn.onclick = () => (mask.hidden ? open() : close())
  mask.querySelector('.about-close')!.addEventListener('click', close)
  mask.addEventListener('click', event => { if (event.target === mask) close() })
  window.addEventListener('keydown', event => { if (event.code === 'Escape' && !mask.hidden) close() })
  document.body.append(btn, mask)
  btn.setAttribute('aria-expanded', 'false')
}

function section(title: string, html: string) {
  const el = document.createElement('section')
  el.innerHTML = `<h3>${title}</h3>${html}`
  return el
}

function controlsHtml() {
  return `<div class="about-cols">
    <div><h4>桌面</h4><ul>
      <li>飞行：WASD 移动，Q/E 升降，Shift 加速</li>
      <li>步行：WASD 走，Shift 跑，空格跳</li>
      <li>拖动转视角，滚轮远近，V 切换飞行/步行</li>
    </ul></div>
    <div><h4>手机</h4><ul>
      <li>飞行：单指转向，双指拖移</li>
      <li>步行：左摇杆移动，右半屏转向</li>
      <li>右上「落地步行 / 起飞」切换模式</li>
    </ul></div>
  </div>`
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
