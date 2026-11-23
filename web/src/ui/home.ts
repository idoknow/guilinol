import './home.css'
import {spots} from '../play/spots'
import {SOURCE_URL} from './source'
import {initial, onUser} from './account'
import {openCreator} from './creator'
import {checkBan,civicUser,openCivicCard} from './civic'
import {hairNames, hairStyles, lookNames, looks, type Avatar} from '../../../lib/avatar'

// 主界面（title screen）. Shown on every plain visit before the 3D city loads; the menu button in game brings it back.
// It owns no engine state: it calls `play()` and the entry module decides whether that boots or resumes the city.
// Backdrops are real in-game shots, regenerated with scripts/home-shots.mjs.
const slides:[file:string,caption:string][] = [
  ['elephant','象鼻山 · 黄昏'],['pagodas','日月双塔 · 入夜'],['lijiang','漓江 · 清晨'],['duxiu','独秀峰 · 靖江王城'],
]
const SLIDE_MS = 7000

export interface Home {open(resume:boolean):void; close():void; readonly shown:boolean}

export function home(play:()=>void):Home {
  const root = document.createElement('section')
  root.className = 'home'; root.setAttribute('aria-label','网上桂林 · 主界面')
  const stamps = (()=>{try{return (JSON.parse(localStorage.getItem('glol.stamps')??'[]') as unknown[]).length}catch{return 0}})()
  root.innerHTML = `
  <div class="home-bg" aria-hidden="true">${slides.map(([file],i)=>`<img alt="" decoding="async" ${i?'data-src':'src'}="./home/${file}.webp"${i?'':' class="on"'}>`).join('')}</div>
  <div class="home-shade" aria-hidden="true"></div>

  <header class="lc-top">
    <span class="lc-brandmark"><b>GUILIN</b> <i>ONLINE</i></span><span class="lc-brand-sub">网上桂林 · 二创网站</span>
    <div class="lc-top-end">
      <button type="button" class="lc-account home-account" data-umami-event="home-account"></button>
      <a class="lc-src" href="${SOURCE_URL}" target="_blank" rel="noopener" data-umami-event="home-source">源地图 · OpenStreetMap</a>
    </div>
  </header>

  <main class="lc-stage">
    <div class="lc-logo">
      <span class="lc-seal home-seal" aria-hidden="true">桂</span>
      <h1>
        <span class="lc-en">GUILIN</span>
        <span class="lc-en lc-en--thin">ONLINE</span>
        <span class="lc-cn">网上桂林</span>
      </h1>
      <p class="lc-tag">按真实地图搭起来的 3D 桂林<br>飞上天看山水，落地走街巷</p>
    </div>

    <nav class="lc-menu" aria-label="主菜单">
      <button type="button" class="home-mode--tour lc-item lc-item--primary" data-umami-event="home-tour">
        
        <span class="lc-label">单人模式<small>自由飞行 · 落地步行 · ${spots.length} 处名胜</small></span>
        <span class="lc-go home-go">进入</span>
        <small class="home-progress lc-progress"></small>
      </button>
      <button type="button" class="lc-item" id="lc-mp">
        <span class="lc-label">多人联机<span class="lc-hint">多人联机可能导致服务器卡顿，可发电支持满 60 开新服务器</span></span>
      </button>
      <button type="button" class="lc-item" data-act="look" data-umami-event="home-look">
        <span class="lc-label">我的角色<small class="home-look-sub">男 · 微分碎盖 · 校服</small></span>
        <i class="home-look-chip" aria-hidden="true"></i>
      </button>      <button type="button" class="lc-item" data-act="settings" data-umami-event="home-settings"><span class="lc-label">设置</span></button>
      <button type="button" class="lc-item lc-item--sub" data-act="guide" data-umami-event="home-guide">
        <span class="lc-label">玩法说明<small>操作 · 地图 · 景册</small></span>
      </button>
      <button type="button" class="lc-item lc-item--sub" data-act="about" data-umami-event="home-about">
        <span class="lc-label">关于游戏<small>数据来源 · 制作</small></span>
      </button>
      <div class="lc-item lc-item--sub lc-item--off" aria-disabled="true">
        <span class="lc-label">故事模式<small>即将推出</small></span>
      </div>
    </nav>
  </main>

  <footer class="lc-foot">
    <span class="home-caption lc-caption" aria-live="off"></span>
    <span class="lc-credit">二创网站封闭测试版本，内容可能调整 · <button type="button" class="lc-logout">退出登录</button> · UID: <b class="civic-uid">GL------</b> · <span class="home-ver">v—</span></span>
  </footer>

  <aside class="home-group">
    <button type="button" class="home-group-card" data-umami-event="home-group" aria-haspopup="dialog" aria-label="二创玩家群 · 微信扫码进群">
      <span class="home-group-head">
        <i class="home-group-dot" aria-hidden="true"></i>
        <b class="home-group-title">二创玩家群</b>
        <span class="home-group-badge">微信</span>
      </span>
      <span class="home-group-code"><img src="./home/erchuang-qr.png" alt="二创玩家群 微信群二维码" width="1008" height="1008" decoding="async"></span>
      <span class="home-group-note">扫码进群 · 同人 / 模型 / 地图</span>
    </button>
  </aside>`
  const progress = root.querySelector('.home-progress')!
  progress.textContent = stamps ? `已集 ${Math.min(stamps,spots.length)} / ${spots.length} 枚印章` : ''
  const go = root.querySelector<HTMLElement>('.home-go')!, tour = root.querySelector<HTMLButtonElement>('.home-mode--tour')!
  // 进游戏前先捏人：选性别 → 选角色 → 换上衣/裤子/鞋子，确认后进桂林。
  // 必须开卡才能进游戏；每次进入前都向服务端查一次封禁状态。
  const startSolo = () => {
    if (localStorage.getItem('guiling.created') === '1') { play(); return }
    openCreator(() => play())
  }
  tour.onclick = () => {
    localStorage.setItem('guiling.mp', '0')
    if (!civicUser()) {
      openCivicCard(user => { if (user) { paintHomeAccount(); void checkBan().then(banned => { if (!banned) startSolo() }) } })
      return
    }
    void checkBan().then(banned => { if (!banned) startSolo() })
  }
  root.querySelector<HTMLButtonElement>('#lc-mp')!.onclick = () => {
    const enterMp = () => { localStorage.setItem('guiling.mp','1'); play() }
    if (!civicUser()) { openCivicCard(user => { if (user) { paintHomeAccount(); collectAndPlay(enterMp) } }); return }
    collectAndPlay(enterMp)
  }
  function collectAndPlay(next:()=>void){
    void checkBan().then(banned => {
      if (banned) return
      if (localStorage.getItem('guiling.created') === '1') { next(); return }
      openCreator(() => next())
    })
  }
  let lookSaveToast = false
  root.querySelector<HTMLButtonElement>('[data-act=look]')!.onclick = () => {
    // 我的角色：只保存，保存完回到主页（不播入场白幕、也不自动进游戏）。
    // 之后点「单人模式 / 联机模式」就直接进，不会再被逼着重新捏人。
    lookSaveToast = true
    if (civicUser()) { openCreator(); return }
    openCivicCard(user => { if (user) { paintHomeAccount(); openCreator() } })
  }

  // —— 我的角色入口上的当前外形：缩略图 + 一句话，保存后立刻更新 ——
  const lookItem = root.querySelector<HTMLButtonElement>('[data-act=look]')!
  const lookSmall = lookItem.querySelector<HTMLElement>('.lc-label small')!
  const lookChip = lookItem.querySelector<HTMLElement>('.home-look-chip')!
  lookChip.style.cssText =
    'display:none;flex:0 0 auto;width:34px;height:34px;margin-left:10px;border-radius:9px;' +
    'background-image:url(./avatar/creator-options.webp);background-size:600% 1100%;' +
    'border:1px solid rgba(255,255,255,.28);box-shadow:0 4px 14px rgba(0,0,0,.35)'
  const lookFallback = lookSmall.textContent
  function currentAvatar(): Avatar | undefined {
    try {
      const raw = JSON.parse(localStorage.getItem('glol.avatar.v1') ?? 'null') as Avatar | null
      if (raw && raw.v === 1 && (raw.body === 'm' || raw.body === 'f')) return raw
    } catch {
      /* 坏数据就当没有 */
    }
    return undefined
  }
  function paintLook() {
    const a = currentAvatar()
    if (!a) {
      lookChip.style.display = 'none'
      lookSmall.textContent = lookFallback
      return
    }
    const hairIndex = Math.max(0, (hairStyles[a.body] as readonly string[]).indexOf(a.hair))
    const lookIndex = Math.max(0, looks.indexOf(a.look))
    lookSmall.textContent = `${a.body === 'm' ? '男' : '女'} · ${hairNames[a.body][hairIndex]} · ${lookNames[lookIndex]}`
    lookChip.style.display = 'block'
    // 缩略图用角色页那张精灵图：6 列（脸型） × 11 行（体型 0 / 男 1–5 / 女 6–10）
    lookChip.style.backgroundPosition = `${(a.face * 100) / 5}% ${(a.body === 'm' ? 1 : 6) * 10}%`
  }

  // 保存后的提示条（只在「我的角色」保存时出现，避免和「进入桂林」抢注意力）
  const toast = document.createElement('div')
  toast.style.cssText =
    'position:fixed;left:50%;bottom:calc(104px + env(safe-area-inset-bottom));z-index:120;' +
    'transform:translateX(-50%) translateY(12px);padding:10px 20px;border-radius:999px;' +
    'background:rgba(9,17,15,.9);color:#e2f6ef;border:1px solid rgba(47,214,166,.45);' +
    'font:600 13px/1.4 system-ui;opacity:0;pointer-events:none;' +
    'transition:opacity .25s ease,transform .25s ease;white-space:nowrap'
  root.append(toast)
  let toastTimer = 0
  function say(text: string) {
    toast.textContent = text
    toast.style.opacity = '1'
    toast.style.transform = 'translateX(-50%) translateY(0)'
    clearTimeout(toastTimer)
    toastTimer = window.setTimeout(() => {
      toast.style.opacity = '0'
      toast.style.transform = 'translateX(-50%) translateY(12px)'
    }, 3200)
  }
  addEventListener('glol:avatar', () => paintLook())
  // 角色页关掉之后再提示（保存时还要播 1.2 s 挥手 + 0.6 s 淡出，提示早弹会被对话框盖住）
  addEventListener('glol:creator-close', (event) => {
    paintLook()
    if (!lookSaveToast) return
    lookSaveToast = false
    if ((event as CustomEvent<{saved?: boolean}>).detail?.saved) say('外形已保存 · 点「单人模式」或「联机模式」进入桂林')
  })
  paintLook()
  // 主页脚注显示构建号，方便确认线上跑的是哪一版
  void fetch('./version.json')
    .then(response => response.json())
    .then((info: {sha?: string}) => {
      if (info?.sha) root.querySelector('.home-ver')!.textContent = 'v' + info.sha
    })
    .catch(() => {})
  // 二创玩家群：右下角那张二维码卡，点一下放大成能直接用微信扫的码（手机端长按识别）。
  root.querySelector<HTMLButtonElement>('.home-group-card')!.onclick = ()=>openGroupSheet()
  root.querySelector<HTMLButtonElement>('[data-act=guide]')!.onclick = ()=>guide()
  const settingsButton = root.querySelector<HTMLButtonElement>('[data-act=settings]')
  if (settingsButton) settingsButton.onclick = () => document.querySelector<HTMLButtonElement>('.btn-menu')?.click()
  root.querySelector<HTMLButtonElement>('[data-act=about]')!.onclick = ()=>void import('./about').then(m=>m.openAbout())
  const account = root.querySelector<HTMLButtonElement>('.home-account')!
  const paintHomeAccount = () => {
    const cu = civicUser()
    if (!cu) {
      // 退出登录：清掉市民身份（物品、照片标记一起清），回到登录页
  const logout = root.querySelector<HTMLButtonElement>('.lc-logout')
  if (logout) {
    logout.onclick = () => {
      if (!confirm('退出登录？本机的市民卡与物品背包会一起清空')) return
      try {
        localStorage.removeItem('guiling.civic.v1')
        localStorage.removeItem('guiling.items.v1')
        for (const key of Object.keys(localStorage)) {
          if (key.startsWith('guiling.photo.') || key.startsWith('guiling.portrait.')) localStorage.removeItem(key)
        }
      } catch {
        /* 忽略 */
      }
      location.reload()
    }
  }
  account.innerHTML = '<span>市民卡登录 / 注册</span>'
      account.toggleAttribute('data-guest', true)
      return
    }
    // 有市民身份就显示「头像 + 名字 + UID」两行；身份存在本地，刷新/退出后仍在
    account.innerHTML = ''
    const avatar = document.createElement('i')
    avatar.className = 'home-avatar'
    avatar.textContent = [...cu.name][0] ?? '客'
    const box = document.createElement('span')
    box.className = 'home-account-text'
    const name = document.createElement('b')
    name.textContent = cu.name
    const uid = document.createElement('small')
    uid.textContent = 'UID ' + (cu.uid ? String(cu.uid).slice(0, 8) : '------')
    box.append(name, uid)
    account.append(avatar, box)
    account.removeAttribute('data-guest')
  }
  paintHomeAccount()
  // 一打开首页就查封禁，被封直接红屏
  void checkBan()
  account.onclick = () => {
    if (civicUser()) {
      // 已有市民卡：点卡片看「市民二代身份证」
      void import('./idcard').then(module => void module.openIdCard())
      return
    }
    openCivicCard(() => paintHomeAccount())
  }
  // 邮箱账号只是「额外」信息：没登录时不要覆盖市民卡身份，否则右上角永远显示「登录 / 注册」
  onUser(user=>{
    if(user){
      account.innerHTML = `<i class="home-avatar"></i><span></span>`
      account.querySelector('i')!.textContent = initial(user.nickname)
      account.querySelector('span')!.textContent = user.nickname
      return
    }
    paintHomeAccount()
  })
  paintHomeAccount()
  // 角色外形跨设备同步：本机没有就从服务器拉，本机有就推上去
  void import('../items').then(module => module.syncAvatar())
  // 老玩家补发二代身份证（这段在首页就会执行）
  void import('../items').then(module => module.ensureIdCardItem())
  // 手游：首页全屏门禁（这段在首页就会跑）
  void import('./fullgate').then(module => module.mountFullGate())
  // 静默把大头照传到服务器（老玩家不点身份证也能让别人扫到真人头像）
  window.setTimeout(() => {
    void import('../items').then(module => module.ensurePortraitUpload())
  }, 4000)
  // 主菜单也要方向提示（挂载点原来只在进入游戏后才会执行）
  void import('./orient').then(module => module.mountOrientHint())
  addEventListener('account:play',()=>{if(shown)play()})

  // Backdrop: cross-fade with a slow push-in. Later slides load only after the first one is on screen.
  const images = Array.from(root.querySelectorAll<HTMLImageElement>('.home-bg img')), caption = root.querySelector('.home-caption')!
  let index = 0, timer = 0
  caption.textContent = slides[0][1]
  images[0].addEventListener('load',()=>{for(const img of images) if(img.dataset.src){img.src = img.dataset.src; delete img.dataset.src}},{once:true})
  const step = ()=>{const next = (index+1)%images.length; if(!images[next].complete||!images[next].naturalWidth) return
    images[index].classList.remove('on'); images[next].classList.add('on'); index = next; caption.textContent = slides[index][1]}
  const reduce = matchMedia('(prefers-reduced-motion:reduce)').matches

  let shown = false
  // Keys must not reach the paused game underneath (V/J/P/M toggle things).
  addEventListener('keydown',event=>{if(shown&&!(event.target as Element)?.closest?.('dialog,.about-mask')) {event.stopImmediatePropagation()
    if(event.code==='Enter'&&document.activeElement===document.body){event.preventDefault(); play()}
    else if(event.code==='Escape'&&!event.repeat&&root.classList.contains('resume')) play()}},{capture:true})
  document.body.append(root)
  const api:Home = {
    get shown(){return shown},
    open(resume){
      shown = true; root.hidden = false; root.classList.toggle('resume',resume)
      go.textContent = resume?'继续游览':'开始游览'
      paintLook()
      requestAnimationFrame(()=>{root.classList.add('show'); tour.focus({preventScroll:true})})
      if(!reduce&&!timer) timer = window.setInterval(step,SLIDE_MS)
      document.body.dataset.home = ''
    },
    close(){
      shown = false; root.classList.remove('show'); clearInterval(timer); timer = 0; delete document.body.dataset.home
      if(groupSheet) groupSheet.hidden = true
      setTimeout(()=>{if(!shown) root.hidden = true},450)
    },
  }
  return api
}

/** 二创玩家群：把右下角的码放大，桌面用微信扫、手机长按识别。 */
let groupSheet:HTMLDivElement|undefined
function openGroupSheet() {
  if(!groupSheet){
    groupSheet = document.createElement('div')
    groupSheet.className = 'about-mask home-group-sheet'
    groupSheet.hidden = true
    groupSheet.innerHTML = `<div class="about-panel" role="dialog" aria-modal="true" aria-labelledby="group-title">
      <header><h2 id="group-title">二创玩家群</h2><button type="button" class="about-close" aria-label="关闭">关闭</button></header>
      <div class="home-group-sheet-body">
        <span class="home-group-code"><img src="./home/erchuang-qr.png" alt="二创玩家群 微信群二维码" width="1008" height="1008" decoding="async"></span>
        <p>微信扫一扫，加入「二创玩家群」</p>
        <p class="home-group-tip">同人图 · 模型 · 地图 · 攻略，一起把桂林玩出新花样。<br>手机上可长按二维码识别。</p>
      </div>
    </div>`
    const close = ()=>{groupSheet!.hidden = true}
    groupSheet.querySelector('.about-close')!.addEventListener('click',close)
    groupSheet.addEventListener('click',event=>{if(event.target===groupSheet) close()})
    addEventListener('keydown',event=>{if(event.code==='Escape'&&!groupSheet!.hidden) close()})
    document.body.append(groupSheet)
  }
  groupSheet.hidden = false
  groupSheet.querySelector<HTMLButtonElement>('.about-close')!.focus()
}

let guideMask:HTMLDivElement|undefined
function guide() {
  if(!guideMask){
    guideMask = document.createElement('div'); guideMask.className = 'about-mask'
    guideMask.innerHTML = `<div class="about-panel guide" role="dialog" aria-modal="true" aria-labelledby="guide-title">
      <header><h2 id="guide-title">怎么玩</h2><button type="button" class="about-close">关闭</button></header>
      <ol class="guide-steps">
        <li><span class="ui-seal">飞</span><div><b>飞上天看全城</b><p>一进来你在空中。像无人机一样四处飞，看两江四湖、看远处一层层的山。</p></div></li>
        <li><span class="ui-seal">走</span><div><b>落地去逛街</b><p>点右上角「落地步行」，就变成一个小人站在街上。走累了可以骑路边的单车，江边还能坐船。</p></div></li>
        <li><span class="ui-seal">印</span><div><b>集印章</b><p>名胜附近地上有朱红色的圆圈，走进去就盖一枚印，还会弹出景点介绍。打开「景册」看看还差哪几处。</p></div></li>
        <li><span class="ui-seal">拍</span><div><b>拍一张</b><p>按「拍照」可以换时辰和天气，晨雾、黄昏、夜景都能拍，拍好直接保存。</p></div></li>
      </ol>
      <div class="guide-keys">
        <section><h3>电脑</h3><ul>
          <li><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 前后左右</li>
          <li>按住鼠标拖动 转视角 · 滚轮 拉远拉近</li>
          <li><kbd>Q</kbd>/<kbd>E</kbd> 飞高飞低 · <kbd>Shift</kbd> 加速 / 跑</li>
          <li><kbd>空格</kbd> 跳 · <kbd>V</kbd> 起飞或落地 · <kbd>E</kbd> 上下车船</li>
          <li><kbd>M</kbd> 地图 · <kbd>J</kbd> 景册 · <kbd>P</kbd> 拍照</li>
        </ul></section>
        <section><h3>手机</h3><ul>
          <li>飞行时：一根手指转方向，两根手指拖着走</li>
          <li>步行时：左下摇杆走路，右半边屏幕滑动转视角</li>
          <li>右上角按钮：落地 / 起飞、地图、景册、拍照</li>
          <li>横过来玩，视野更开阔</li>
        </ul></section>
      </div></div>`
    const close = ()=>{guideMask!.hidden = true}
    guideMask.querySelector('.about-close')!.addEventListener('click',close)
    guideMask.addEventListener('click',event=>{if(event.target===guideMask) close()})
    addEventListener('keydown',event=>{if(event.code==='Escape'&&!guideMask!.hidden) close()})
    document.body.append(guideMask)
  }
  guideMask.hidden = false
  guideMask.querySelector<HTMLButtonElement>('.about-close')!.focus()
}
