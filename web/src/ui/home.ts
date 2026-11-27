import {getPlayMode, lastPlayMode, type PlayMode} from '../game/play-mode'
import {openGuide} from './guide'
import {mpEnabled, mpExplicitlyDisabled, setMpEnabled} from './mp-pref'
import {onMpOnline, startLive} from './live'
import './home.css'
import {spots} from '../play/spots'
import {SOURCE_URL} from './source'
import {initial, onUser, openAccount} from './account'
import {lastViewSavedAt, requestRestore} from '../lastview'
import type {Cover, CoverTier} from './cover'

// 主界面（title screen）. Shown on every plain visit before the 3D city loads; the menu button in game brings it back.
// It owns no engine state: it calls `play()` and the entry module decides whether that boots or resumes the city.
// IDOK-386: a fresh visit gets a live 3D night scene (ui/cover, its own chunk) behind the menu; the first in-game shot
// is its poster until the first frame. The slideshow stays as the fallback (no WebGL, context lost, ?nocover) and as
// the backdrop of the in-game menu, which never builds the scene. Backdrops: scripts/home-shots.mjs.
const slides:[file:string,caption:string][] = [
  ['elephant','象鼻山 · 黄昏'],['pagodas','日月双塔 · 入夜'],['lijiang','漓江 · 清晨'],['duxiu','独秀峰 · 靖江王城'],
]
const SLIDE_MS = 7000

export interface Home {open(resume:boolean):void; close():void; idle():void; readonly shown:boolean
  /** Resolves once the entry dive (started by a mode card) has played far enough for the loader to cover it. */
  launch():Promise<void>}

export function home(play:(mode:PlayMode)=>void):Home {
  const root = document.createElement('section')
  root.className = 'home'; root.setAttribute('aria-label','网上桂林 · 主界面')
  const stamps = (()=>{try{return (JSON.parse(localStorage.getItem('glol.stamps')??'[]') as unknown[]).length}catch{return 0}})()
  root.innerHTML = `
  <div class="home-bg" aria-hidden="true">${slides.map(([file],i)=>`<img alt="" decoding="async" ${i?'data-src':'src'}="./home/${file}.webp"${i?'':' class="on"'}>`).join('')}</div>
  <div class="home-shade" aria-hidden="true"></div>
  <header class="home-top">
    <button type="button" class="ui-btn home-account" data-umami-event="home-account"></button>
  </header>
  <div class="home-main">
    <div class="home-title">
      <h1><span class="home-h1-net">网上</span><span class="home-h1-city"><span class="home-h1-text">桂林</span><span class="home-seal" aria-hidden="true"><img src="./brand/emblem-clear.webp" width="363" height="136" alt=""></span><i class="home-wordmark" aria-hidden="true"></i></span></h1>
    </div>
    <div class="home-modes" role="list" aria-label="选择模式">
      <div class="home-row home-row--mp" role="listitem">
        <button type="button" class="home-mode home-mode--mp" data-umami-event="home-mp">
          <span class="home-mode-seal ui-seal" aria-hidden="true"></span>
          <span class="home-mode-text"><b>联机模式<i class="home-mp-live ui-num" hidden></i></b><span>同城玩家一起逛街接单</span>
            <small class="home-wallet ui-num"></small></span>
          <span class="home-go home-go--mp">进入联机</span>
        </button>
      </div>
      <div class="home-row home-row--tour" role="listitem">
        <button type="button" class="home-mode home-mode--tour" data-umami-event="home-tour">
          <span class="home-mode-seal ui-seal ui-seal--ink" aria-hidden="true"></span>
          <span class="home-mode-text"><b>游览模式</b><span>飞遍 ${spots.length} 处名胜集印章</span>
            <small class="home-progress ui-num"></small></span>
          <span class="home-go home-go--tour">开始游览</span>
        </button>
        <div class="home-resume-row" hidden>
          <button type="button" class="home-resume ui-link" data-umami-event="home-resume">
            <i aria-hidden="true"></i><span>回到上次离开的地方</span><small class="home-resume-ago"></small>
          </button>
        </div>
      </div>
      <div class="home-row home-row--solo" role="listitem">
        <button type="button" class="home-mode home-mode--solo" data-umami-event="home-solo">
          <span class="home-mode-seal ui-seal ui-seal--ink" aria-hidden="true"></span>
          <span class="home-mode-text"><b>单人模式</b><span>离线逛街，进度照存</span></span>
          <span class="home-go home-go--solo">进入</span>
        </button>
      </div>
    </div>
    <nav class="home-links" id="home-links" aria-label="更多">
      <button type="button" class="ui-btn ui-btn--ghost" data-act="guide" data-umami-event="home-guide">玩法说明</button>
      <button type="button" class="ui-btn ui-btn--ghost" data-act="about" data-umami-event="home-about">关于游戏</button>
      <button type="button" class="ui-btn ui-btn--ghost" data-act="qq" data-umami-event="home-qq">QQ 群</button>
      <a class="ui-btn ui-btn--ghost" href="${SOURCE_URL}" target="_blank" rel="noopener" data-umami-event="home-source-link">源代码<span aria-hidden="true"> ↗</span></a>
    </nav>
    <button type="button" class="ui-btn ui-btn--ghost home-more" aria-expanded="false" aria-controls="home-links">更多</button>
  </div>
  <button type="button" class="home-douyin" data-umami-event="home-douyin" aria-label="抖音官方号 ${DOUYIN_NAME}，点开看二维码">
    <img class="home-douyin-code" src="./icons/douyin-code.webp" width="560" height="560" decoding="async" loading="lazy" alt="">
    <span class="home-douyin-text"><img class="home-douyin-mark" src="./icons/douyin-mark.webp" width="284" height="120" alt=""><b>${DOUYIN_NAME}</b></span>
  </button>
  <div class="home-foot"><span class="home-caption" aria-live="off"></span><span class="home-credit">受 <a href="https://nanningol.com" target="_blank" rel="noopener" data-umami-event="home-thanks-nanning">网上南宁</a> 启发 · 地图 © OpenStreetMap 贡献者 <span class="home-ver">· v${__APP_VERSION__}</span></span></div>`
  const progress = root.querySelector('.home-progress')!
  progress.textContent = stamps ? `已集 ${Math.min(stamps,spots.length)} / ${spots.length} 枚印章` : ''
  const go = root.querySelector<HTMLElement>('.home-go--tour')!, tour = root.querySelector<HTMLButtonElement>('.home-mode--tour')!
  const solo = root.querySelector<HTMLButtonElement>('[data-umami-event=home-solo]')!, soloGo = root.querySelector<HTMLElement>('.home-go--solo')!
  const wallet = root.querySelector('.home-wallet')!
  // IDOK-216: entering waits on the network (login check, cloud save, avatar) before the loader can show,
  // so the pressed card answers at once: spinner in its pill, other cards held until entry.ts calls idle().
  let busyCard:HTMLElement|undefined, busyLabel = ''
  const press = (card:HTMLElement, label:string, run:()=>void)=>{
    if(busyCard) return
    const pill = card.querySelector<HTMLElement>('.home-go'); busyCard = card; busyLabel = pill?.textContent ?? ''
    card.setAttribute('aria-busy','true'); root.dataset.busy = ''
    // The live cover answers the press: the hero turns to the river and the camera dives past his shoulder (~1.5 s, holds wait),
    // the login check runs meanwhile and entry.ts awaits launch() before the loader fades in.
    if(cover && !reduce && root.dataset.cover==='live'){
      diveAt = performance.now(); cover.dive(); clearTimeout(swoop); swoop = window.setTimeout(()=>{swoop = 0; syncHolds()},1500)
    }
    hold('busy',true)
    if(pill) pill.innerHTML = `<i class="home-spin" aria-hidden="true"></i><span>${label}</span>`
    run()
  }
  const idle = ()=>{
    if(!busyCard) return
    const pill = busyCard.querySelector<HTMLElement>('.home-go'); if(pill) pill.textContent = busyLabel
    busyCard.removeAttribute('aria-busy'); delete root.dataset.busy; busyCard = undefined; hold('busy',false)
  }
  const pending = (button:HTMLElement, task:()=>Promise<unknown>)=>{
    if(button.hasAttribute('aria-busy')) return
    const timer = setTimeout(()=>button.setAttribute('aria-busy','true'),120)
    void task().finally(()=>{clearTimeout(timer); button.removeAttribute('aria-busy')})
  }
  solo.onclick = ()=>press(solo,'正在进入',()=>{setMpEnabled(false,true); play('solo')})
  tour.onclick = ()=>press(tour,'正在进入',()=>{setMpEnabled(false); play('tour')})
  // IDOK-105: a slim strip under the tour card, shown only when a usable last view is stored.
  // 开始游览 still opens on a random frame; this is the opt-in way back.
  const resumeRow = root.querySelector<HTMLElement>('.home-resume-row')!, resumeAgo = root.querySelector('.home-resume-ago')!
  root.querySelector<HTMLButtonElement>('.home-resume')!.onclick = ()=>press(tour,'正在进入',()=>{requestRestore(); play('tour')})
  root.querySelector<HTMLButtonElement>('[data-act=guide]')!.onclick = ()=>openGuide('play')
  const about = root.querySelector<HTMLButtonElement>('[data-act=about]')!
  about.onclick = ()=>pending(about,()=>import('./about').then(m=>m.openAbout()))
  root.querySelector<HTMLButtonElement>('[data-act=qq]')!.onclick = ()=>qqGroup()
  root.querySelector<HTMLButtonElement>('.home-douyin')!.onclick = ()=>douyin()
  // 手机收起（IDOK-468）：竖屏 / 横屏手机默认只留模式名和动作，次要说明、底部链接、署名点「更多」才出现。
  // 状态只有一份：按钮的 aria-expanded，CSS 用 :has() 读它；桌面上按钮不显示、内容始终展开。
  const more = root.querySelector<HTMLButtonElement>('.home-more')!
  more.onclick = ()=>{const open = more.getAttribute('aria-expanded')!=='true'
    more.setAttribute('aria-expanded',String(open)); more.textContent = open?'收起':'更多'}
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
  const startSlides = ()=>{if(!reduce&&!timer&&!cover) timer = window.setInterval(step,SLIDE_MS)}

  // Live cover. Lifecycle: open(false) loads it, busy / creator pause it, close() pauses at once and frees every GPU
  // resource and the canvas once the fade-out ends. data-cover on .home tells tests and agents where it is:
  // loading → live, or off (fallback slideshow).
  const params = new URLSearchParams(location.search)
  const bg = root.querySelector<HTMLElement>('.home-bg')!, main = root.querySelector<HTMLElement>('.home-main')!
  const modes = root.querySelector<HTMLElement>('.home-modes')!
  const UI = 'button,a,input,select,textarea,label,dialog,[role=dialog],.about-mask,.home-top'
  const narrow = matchMedia('(max-width:760px)'), short = matchMedia('(max-height:520px) and (orientation:landscape)')
  let cover:Cover|undefined, coverWanted = false, coverOff = params.has('nocover')
  const holds = new Set<string>()
  let swoop = 0, diveAt = -1
  const syncHolds = ()=>{if(holds.size) cover?.pause(); else cover?.resume()}
  function hold(reason:string, on:boolean){
    if(on) holds.add(reason); else holds.delete(reason)
    if(!swoop) syncHolds()
  }
  // The menu covers the left column (desktop), the thumb zone at the bottom (portrait phone) or the right column
  // (landscape phone); the scene frames the hero and landmarks in the rest.
  const safe = ()=>narrow.matches
    ? {left:0, right:0, bottom:Math.max(0, innerHeight - modes.getBoundingClientRect().top + 8)}
    : short.matches
      ? {left:0, right:Math.max(0, innerWidth - modes.getBoundingClientRect().left + 8), bottom:0}
      : {left:Math.max(0, main.getBoundingClientRect().right - 40), right:0, bottom:0}
  const resafe = ()=>{cover?.setSafeArea(safe())}
  new ResizeObserver(resafe).observe(main)
  // Rotating may not resize .home-main, so a media-query flip recomputes too.
  narrow.addEventListener('change', resafe); short.addEventListener('change', resafe)
  const dropCover = (off:boolean)=>{
    cover?.dispose(); cover = undefined; coverOff ||= off
    root.classList.remove('live'); root.dataset.cover = 'off'; caption.textContent = slides[index][1]
    if(shown) startSlides()
  }
  const loadCover = ()=>{
    if(cover||coverOff||!coverWanted) return
    root.dataset.cover = 'loading'
    import('./cover').then(m=>{
      if(cover||!coverWanted) return
      const tier = params.get('covertier') as CoverTier|null
      cover = m.mountCover(bg,{reduced:reduce, surface:root, ignore:t=>!!t.closest(UI), safe:safe(), tier:tier??undefined,
        onReady(){root.classList.add('live'); root.dataset.cover = 'live'; clearInterval(timer); timer = 0; caption.textContent = ''},
        onHover(name){caption.textContent = name ?? ''},
        onLost(){dropCover(true)}})
      if(holds.size) cover.pause()
      if(params.has('coverstats')) (window as Window & {glolCover?:Cover}).glolCover = cover
    }).catch(()=>dropCover(true))
  }
  addEventListener('glol:creator',event=>hold('creator',!!(event as CustomEvent<{open?:boolean}>).detail?.open))

  let shown = false, currentResume = false
  const focusTarget = (resume:boolean) => {
    const mode = resume ? getPlayMode() : lastPlayMode()
    if (mode === 'tour') return tour
    if (resume) return mpEnabled() ? mp : solo
    return mpExplicitlyDisabled() ? solo : mp
  }
  // Keys must not reach the paused game underneath (V/J/P/M toggle things).
  addEventListener('keydown',event=>{if(shown&&!(event.target as Element)?.closest?.('dialog,.about-mask')) {event.stopImmediatePropagation()
    if(event.code==='Enter'&&document.activeElement===document.body){event.preventDefault(); focusTarget(currentResume).click()}
    else if(event.code==='Escape'&&!event.repeat&&root.classList.contains('resume')) play(getPlayMode())}},{capture:true})
  document.body.append(root)
  const api:Home = {
    get shown(){return shown},
    idle,
    launch(){
      const wait = diveAt < 0 ? 0 : diveAt + 800 - performance.now(); diveAt = -1
      return new Promise(done=>setTimeout(done, Math.max(0, wait)))
    },
    open(resume){
      idle()
      shown = true; currentResume = resume; root.hidden = false; root.classList.toggle('resume',resume)
      let hasProgress = false, money:number|null = null
      try { const raw = localStorage.getItem('glol.save.v1'); hasProgress = raw !== null
        const value = raw ? (JSON.parse(raw) as {money?:unknown}).money : null; if(typeof value==='number'&&Number.isFinite(value)) money = Math.round(value) } catch {}
      const inMp = resume && getPlayMode() === 'solo' && mpEnabled()
      const inSolo = resume && getPlayMode() === 'solo' && !mpEnabled()
      const inTour = resume && getPlayMode() === 'tour'
      mp.classList.toggle('is-current', inMp)
      solo.classList.toggle('is-current', inSolo)
      tour.classList.toggle('is-current', inTour)
      mpGo.textContent = inMp ? '继续联机' : '进入联机'
      soloGo.textContent = inSolo ? '继续单人' : '进入'
      wallet.textContent = hasProgress && money!==null ? `钱包 ¥${money.toLocaleString('zh-CN')}` : ''
      go.textContent = inTour ? '继续游览' : '开始游览'
      // IDOK-105: only on a fresh entry (not the mid-game 继续游览 menu) and only with a usable record.
      const saved = resume ? null : lastViewSavedAt()
      resumeRow.hidden = saved===null; if(saved!==null) resumeAgo.textContent = ago(saved)
      requestAnimationFrame(()=>{root.classList.add('show'); focusTarget(resume).focus({preventScroll:true})})
      coverWanted = !resume
      hold('closed',false)
      if(resume) dropCover(false); else loadCover()
      startSlides()
      document.body.dataset.home = ''
    },
    close(){
      shown = false; coverWanted = false; root.classList.remove('show'); clearInterval(timer); timer = 0; delete document.body.dataset.home
      hold('closed',true)
      setTimeout(()=>{if(!shown){root.hidden = true; if(cover) dropCover(false)}},450)
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
const QQ_CARD:CodeCard = {key:'qq',title:'QQ 群',img:'./icons/qq-group.webp',w:881,h:1101,alt:`网上桂林 QQ 群二维码，群号 ${QQ_GROUP}`,
  note:'用 QQ 扫一扫，或在 QQ 里搜群号加入。',num:QQ_GROUP,copyLabel:'复制群号'}
const DOUYIN_CARD:CodeCard = {key:'douyin',title:'抖音官方号',img:'./icons/douyin-code.webp',w:560,h:560,alt:`网上桂林抖音官方号 ${DOUYIN_NAME} 二维码，抖音号 ${DOUYIN_ID}`,
  note:`<b>${DOUYIN_NAME}</b>打开抖音，在搜索页点扫一扫；或搜索抖音号关注。`,num:DOUYIN_ID,copyLabel:'复制抖音号'}
const qqGroup = ()=>codeCard(QQ_CARD), douyin = ()=>codeCard(DOUYIN_CARD)
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
        <div class="qq-row"><b class="qq-num">${card.num}</b><button type="button" class="ui-btn ui-btn--line qq-copy">${card.copyLabel}</button></div>
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
