import {getPlayMode, lastPlayMode, type PlayMode} from '../game/play-mode'
import {openGuide} from './guide'
import {mpEnabled, setMpEnabled} from './mp-pref'
import {onMpOnline, startLive} from './live'
import './home.css'
import {spots} from '../play/spots'
import {SOURCE_URL} from './source'
import {initial, onUser, openAccount} from './account'
import {lastViewSavedAt, requestRestore} from '../lastview'

// 主界面（title screen）. Shown on every plain visit before the 3D city loads; the menu button in game brings it back.
// It owns no engine state: it calls `play()` and the entry module decides whether that boots or resumes the city.
// Backdrops are real in-game shots, regenerated with scripts/home-shots.mjs.
const slides:[file:string,caption:string][] = [
  ['elephant','象鼻山 · 黄昏'],['pagodas','日月双塔 · 入夜'],['lijiang','漓江 · 清晨'],['duxiu','独秀峰 · 靖江王城'],
]
const SLIDE_MS = 7000

export interface Home {open(resume:boolean):void; close():void; idle():void; readonly shown:boolean}

export function home(play:(mode:PlayMode)=>void):Home {
  const root = document.createElement('section')
  root.className = 'home'; root.setAttribute('aria-label','网上桂林 · 主界面')
  const stamps = (()=>{try{return (JSON.parse(localStorage.getItem('glol.stamps')??'[]') as unknown[]).length}catch{return 0}})()
  root.innerHTML = `
  <div class="home-bg" aria-hidden="true">${slides.map(([file],i)=>`<img alt="" decoding="async" ${i?'data-src':'src'}="./home/${file}.webp"${i?'':' class="on"'}>`).join('')}</div>
  <div class="home-shade" aria-hidden="true"></div>
  <header class="home-top">
    <nav class="home-social" aria-label="官方社群">
       <button type="button" class="home-social-item home-social-official" data-act="douyin" data-umami-event="home-douyin" aria-label="打开抖音官方号二维码">
         <img src="./icons/douyin-mark.webp" width="72" height="30" alt=""><span>抖音官号<small>扫码关注</small></span>
       </button>
       <button type="button" class="home-social-item" data-act="qq" data-umami-event="home-qq" aria-label="打开 QQ 群二维码">
         <i class="home-social-glyph home-social-glyph--qq">Q</i><span>QQ群<small>扫码或链接加入</small></span>
       </button>
       <button type="button" class="home-social-item" data-act="douyin-group" data-umami-event="home-douyin-group" aria-label="打开抖音群二维码">
         <img class="home-social-code" src="./icons/douyin-group.webp" width="560" height="560" alt=""><span>抖音群<small>扫码或链接加入</small></span>
       </button>
     </nav>
     <button type="button" class="ui-btn home-account" data-umami-event="home-account"></button>
  </header>
  <div class="home-main">
    <div class="home-title">
      <span class="home-seal" aria-hidden="true"><img src="./brand/emblem.webp" width="371" height="144" alt=""></span>
      <h1>网上桂林</h1>
      <p class="home-tag">一座按真实地图搭起来的 3D 桂林。<br>穿街走巷接单赚钱，也能飞上天看山水。</p>
      <p class="home-meta"><span>登录就能玩</span><span>电脑 · 手机都行</span><span>不用下载</span></p>
    </div>
    <div class="home-modes" role="list">
      <button type="button" class="home-mode home-mode--solo" role="listitem" data-umami-event="home-solo">
        <span class="home-mode-seal" aria-hidden="true">街</span>
        <span class="home-mode-text"><b>单人模式</b><span>骑电驴、开车穿街走巷，接单送米粉、拉客、跑夜赛，赚了钱换车换装。</span>
          <small class="home-wallet"></small></span>
        <span class="home-go home-go--solo">开始</span>
      </button>
      <button type="button" class="home-mode home-mode--mp" role="listitem" data-umami-event="home-mp">
        <span class="home-mode-seal" aria-hidden="true">联</span>
        <span class="home-mode-text"><b>联机模式<i class="home-mp-live" hidden></i></b><span>和其他玩家同城逛街骑车，看得到彼此的样子和昵称。</span></span>
        <span class="home-go home-go--mp">进入联机</span>
      </button>
      <button type="button" class="home-mode home-mode--tour" role="listitem" data-umami-event="home-tour">
        <span class="home-mode-seal" aria-hidden="true">游</span>
        <span class="home-mode-text"><b>游览模式</b><span>自由飞行看山水，走遍 ${spots.length} 处名胜集印章。</span>
          <small class="home-progress"></small></span>
        <span class="home-go home-go--tour">开始游览</span>
      </button>
      <div class="home-resume-row" role="listitem" hidden>
        <button type="button" class="home-resume" data-umami-event="home-resume">
          <i aria-hidden="true"></i><span>回到上次离开的地方</span><small class="home-resume-ago"></small>
        </button>
      </div>
    </div>
    <nav class="home-links">
      <button type="button" class="ui-btn ui-btn--ghost" data-act="guide" data-umami-event="home-guide">玩法说明</button>
      <button type="button" class="ui-btn ui-btn--ghost" data-act="about" data-umami-event="home-about">关于游戏</button>
      <a class="ui-btn ui-btn--ghost" href="${SOURCE_URL}" target="_blank" rel="noopener" data-umami-event="home-source-link">源代码 ↗</a>
    </nav>
  </div>
  <!-- 社群入口已移动到左上角 home-social -->
  <div class="home-foot"><span class="home-caption" aria-live="off"></span><span class="home-credit">受 <a href="https://nanningol.com" target="_blank" rel="noopener" data-umami-event="home-thanks-nanning">网上南宁</a> 启发 · 地图数据 © OpenStreetMap 贡献者 · v${__APP_VERSION__}</span></div>`
  const progress = root.querySelector('.home-progress')!
  progress.textContent = stamps ? `已集 ${Math.min(stamps,spots.length)} / ${spots.length} 枚印章` : ''
  const go = root.querySelector<HTMLElement>('.home-go--tour')!, tour = root.querySelector<HTMLButtonElement>('.home-mode--tour')!
  const solo = root.querySelector<HTMLButtonElement>('[data-umami-event=home-solo]')!, wallet = root.querySelector('.home-wallet')!
  // IDOK-216: entering waits on the network (login check, cloud save, avatar) before the loader can show,
  // so the pressed card answers at once: spinner in its pill, other cards held until entry.ts calls idle().
  let busyCard:HTMLElement|undefined, busyLabel = ''
  const press = (card:HTMLElement, label:string, run:()=>void)=>{
    if(busyCard) return
    const pill = card.querySelector<HTMLElement>('.home-go'); busyCard = card; busyLabel = pill?.textContent ?? ''
    card.setAttribute('aria-busy','true'); root.dataset.busy = ''
    if(pill) pill.innerHTML = `<i class="home-spin" aria-hidden="true"></i><span>${label}</span>`
    run()
  }
  const idle = ()=>{
    if(!busyCard) return
    const pill = busyCard.querySelector<HTMLElement>('.home-go'); if(pill) pill.textContent = busyLabel
    busyCard.removeAttribute('aria-busy'); delete root.dataset.busy; busyCard = undefined
  }
  const pending = (button:HTMLElement, task:()=>Promise<unknown>)=>{
    if(button.hasAttribute('aria-busy')) return
    const timer = setTimeout(()=>button.setAttribute('aria-busy','true'),120)
    void task().finally(()=>{clearTimeout(timer); button.removeAttribute('aria-busy')})
  }
  solo.onclick = ()=>press(solo,'正在进入',()=>{setMpEnabled(false); play('solo')})
  tour.onclick = ()=>press(tour,'正在进入',()=>{setMpEnabled(false); play('tour')})
  // IDOK-105: a slim strip under the tour card, shown only when a usable last view is stored.
  // 开始游览 still opens on a random frame; this is the opt-in way back.
  const resumeRow = root.querySelector<HTMLElement>('.home-resume-row')!, resumeAgo = root.querySelector('.home-resume-ago')!
  root.querySelector<HTMLButtonElement>('.home-resume')!.onclick = ()=>press(tour,'正在进入',()=>{requestRestore(); play('tour')})
  root.querySelector<HTMLButtonElement>('[data-act=guide]')!.onclick = ()=>openGuide('play')
  const about = root.querySelector<HTMLButtonElement>('[data-act=about]')!
  about.onclick = ()=>pending(about,()=>import('./about').then(m=>m.openAbout()))
  root.querySelector<HTMLButtonElement>('[data-act=qq]')!.onclick = ()=>qqGroup()
  root.querySelector<HTMLButtonElement>('[data-act=douyin]')!.onclick = ()=>douyin()
  root.querySelector<HTMLButtonElement>('[data-act=douyin-group]')!.onclick = ()=>douyinGroup()
  // IDOK-192 联机模式：街头玩法 + 同城联机。单人/游览会把联机关掉，walk 那边当场连上或断开。
  const mp = root.querySelector<HTMLButtonElement>('.home-mode--mp')!, mpGo = root.querySelector('.home-go--mp')!
  const mpLive = root.querySelector<HTMLElement>('.home-mp-live')!
  startLive()
  mp.onclick = ()=>press(mp,'正在连接',()=>{setMpEnabled(true); play('solo')})
  onMpOnline(value=>{mpLive.hidden = !value; if(value) mpLive.textContent = String(value)})
  const account = root.querySelector<HTMLButtonElement>('.home-account')!
  account.onclick = ()=>pending(account,openAccount)
  onUser(user=>{account.innerHTML = user?`<i class="home-avatar"></i><span></span>`:'<span>登录 / 注册</span>'
    if(user){account.querySelector('i')!.textContent = initial(user.nickname); account.querySelector('span')!.textContent = user.nickname}})
  account.innerHTML = '<span>登录 / 注册</span>'

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
    if(event.code==='Enter'&&document.activeElement===document.body){event.preventDefault(); const mode = lastPlayMode(); press(mode==='solo'?(mpEnabled()?mp:solo):tour,'正在进入',()=>play(mode))}
    else if(event.code==='Escape'&&!event.repeat&&root.classList.contains('resume')) play(getPlayMode())}},{capture:true})
  document.body.append(root)
  let playedSolo = false
  const api:Home = {
    get shown(){return shown},
    idle,
    open(resume){
      idle()
      shown = true; root.hidden = false; root.classList.toggle('resume',resume)
      playedSolo ||= resume && getPlayMode() === 'solo'
      let hasProgress = false, money:number|null = null
      try { const raw = localStorage.getItem('glol.save.v1'); hasProgress = raw !== null
        const value = raw ? (JSON.parse(raw) as {money?:unknown}).money : null; if(typeof value==='number'&&Number.isFinite(value)) money = Math.round(value) } catch {}
      const inMp = resume && mpEnabled()
      solo.querySelector('.home-go')!.textContent = !inMp && (playedSolo || hasProgress) ? '继续' : '开始'
      mpGo.textContent = inMp ? '继续联机' : '进入联机'
      wallet.textContent = hasProgress && money!==null ? `钱包 ¥${money.toLocaleString('zh-CN')}` : ''
      go.textContent = resume?'继续游览':'开始游览'
      // IDOK-105: only on a fresh entry (not the mid-game 继续游览 menu) and only with a usable record.
      const saved = resume ? null : lastViewSavedAt()
      resumeRow.hidden = saved===null; if(saved!==null) resumeAgo.textContent = ago(saved)
      requestAnimationFrame(()=>{root.classList.add('show'); ((resume?getPlayMode():lastPlayMode())==='solo'?(resume&&mpEnabled()?mp:solo):tour).focus({preventScroll:true})})
      if(!reduce&&!timer) timer = window.setInterval(step,SLIDE_MS)
      document.body.dataset.home = ''
    },
    close(){
      shown = false; root.classList.remove('show'); clearInterval(timer); timer = 0; delete document.body.dataset.home
      setTimeout(()=>{if(!shown) root.hidden = true},450)
    },
  }
  return api
}

function ago(t:number){
  const min = Math.max(0,(Date.now()-t)/60000)
  return min<2?'刚刚':min<60?`${Math.round(min)} 分钟前`:min<60*24?`${Math.round(min/60)} 小时前`:`${Math.round(min/1440)} 天前`
}

// 二维码卡片（QQ 群 / 抖音官方号）：一张码（public/icons/ 自托管）+ 号码一键复制。
// 手机上没法扫自己的屏幕，所以号码必须能复制出来；复制失败（非 https / 老浏览器）就把号码选中，让玩家自己按。
interface CodeCard {key:string; title:string; img:string; w:number; h:number; alt:string; note:string; num:string; copyLabel:string}
const QQ_GROUP = '1137384288', DOUYIN_ID = '65873904990', DOUYIN_NAME = '@网上桂林official'
const QQ_GROUP_URL = 'https://qm.qq.com/q/gD64ZbmYMM'
const DOUYIN_GROUP_ID = '837801239688', DOUYIN_GROUP_URL = 'https://v.douyin.com/group/837801239688'
const QQ_CARD:CodeCard = {key:'qq',title:'QQ 群',img:'./icons/qq-group.webp',w:881,h:1101,alt:`网上桂林 QQ 群二维码，群号 ${QQ_GROUP}`,
  note:`用 QQ 扫一扫，或在 QQ 里搜群号加入。<br><a href="${QQ_GROUP_URL}" target="_blank" rel="noopener">打开 QQ 群链接 ↗</a>`,num:QQ_GROUP,copyLabel:'复制群号'}
const DOUYIN_CARD:CodeCard = {key:'douyin',title:'抖音官方号',img:'./icons/douyin-code.webp',w:560,h:560,alt:`网上桂林抖音官方号 ${DOUYIN_NAME} 二维码，抖音号 ${DOUYIN_ID}`,
  note:`<b>${DOUYIN_NAME}</b>打开抖音，在搜索页点扫一扫；或搜索抖音号关注。`,num:DOUYIN_ID,copyLabel:'复制抖音号'}
const DOUYIN_GROUP_CARD:CodeCard = {key:'douyin-group',title:'抖音群',img:'./icons/douyin-group.webp',w:560,h:560,alt:`网上桂林抖音群二维码，群号 ${DOUYIN_GROUP_ID}`,
  note:`抖音群号 ${DOUYIN_GROUP_ID}，也可以直接打开群链接加入。<br><a href="${DOUYIN_GROUP_URL}" target="_blank" rel="noopener">打开抖音群链接 ↗</a>`,num:DOUYIN_GROUP_ID,copyLabel:'复制群号'}
const qqGroup = ()=>codeCard(QQ_CARD), douyin = ()=>codeCard(DOUYIN_CARD), douyinGroup = ()=>codeCard(DOUYIN_GROUP_CARD)
const codeMasks = new Map<string,HTMLDivElement>()
function codeCard(card:CodeCard) {
  let mask = codeMasks.get(card.key)
  if (!mask) {
    const m = mask = document.createElement('div')
    m.className = 'about-mask'
    m.hidden = true
    m.innerHTML = `<div class="about-panel qq qq--${card.key}" role="dialog" aria-modal="true" aria-labelledby="${card.key}-title">
      <header><h2 id="${card.key}-title">${card.title}</h2><button type="button" class="about-close" aria-label="关闭">关闭</button></header>
      <div class="qq-body">
        <img class="qq-code" src="${card.img}" width="${card.w}" height="${card.h}" decoding="async" alt="${card.alt}">
        <p class="qq-note">${card.note}</p>
        <div class="qq-row"><b class="qq-num">${card.num}</b><button type="button" class="ui-btn ui-btn--ghost qq-copy">${card.copyLabel}</button></div>
      </div>
    </div>`
    const close = () => { m.hidden = true }
    m.querySelector('.about-close')!.addEventListener('click', close)
    m.addEventListener('click', event => { if (event.target === m) close() })
    addEventListener('keydown', event => { if (event.code === 'Escape' && !m.hidden) close() })
    const copy = m.querySelector<HTMLButtonElement>('.qq-copy')!, num = m.querySelector<HTMLElement>('.qq-num')!
    copy.addEventListener('click', () => {
      const done = () => { copy.textContent = '已复制' }
      const manual = () => {
        copy.textContent = '请手动复制'
        const range = document.createRange(); range.selectNodeContents(num)
        const selection = getSelection(); selection?.removeAllRanges(); selection?.addRange(range)
      }
      const later = () => { setTimeout(() => { copy.textContent = card.copyLabel }, 1800) }
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(card.num).then(done, manual).finally(later)
      else { manual(); later() }
    })
    document.body.append(m)
    codeMasks.set(card.key, m)
  }
  mask.hidden = false
  mask.querySelector<HTMLButtonElement>('.about-close')!.focus()
}
