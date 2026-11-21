import './home.css'
import {spots} from '../play/spots'
import {SOURCE_URL} from './source'
import {initial, onUser, openAccount} from './account'
import {readLastView, requestRestore} from '../lastview'

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
  <header class="home-top">
    <a class="home-src" href="${SOURCE_URL}" target="_blank" rel="noopener" data-umami-event="home-source"><i aria-hidden="true"></i><span>开源 · 免费</span></a>
    <button type="button" class="ui-btn home-account" data-umami-event="home-account"></button>
  </header>
  <div class="home-main">
    <div class="home-title">
      <span class="home-seal" aria-hidden="true">桂</span>
      <h1>网上桂林</h1>
      <p class="home-tag">一座按真实地图搭起来的 3D 桂林。<br>飞上天看山水，落地逛街巷，走到哪儿算哪儿。</p>
      <p class="home-meta"><span>登录就能玩</span><span>电脑 · 手机都行</span><span>不用下载</span></p>
    </div>
    <div class="home-modes" role="list">
      <button type="button" class="home-mode home-mode--tour" role="listitem" data-umami-event="home-tour">
        <span class="home-mode-seal" aria-hidden="true">游</span>
        <span class="home-mode-text"><b>游览模式</b><span>自由飞行、落地步行，走遍 ${spots.length} 处名胜，在景册里集齐印章。</span>
          <small class="home-progress"></small></span>
        <span class="ui-btn ui-btn--seal ui-btn--lg home-go">开始游览</span>
        <span class="ui-btn ui-btn--ghost ui-btn--lg home-resume" role="button" tabindex="0" data-umami-event="home-resume">回到上次离开的地方</span>
      </button>
      <div class="home-mode home-mode--soon" role="listitem" aria-disabled="true">
        <span class="home-mode-seal" aria-hidden="true">事</span>
        <span class="home-mode-text"><b>故事模式 <em class="ui-tag">即将推出</em></b><span>跟着一段桂林故事，走进老城的街巷与山水。</span></span>
        <span class="ui-btn ui-btn--lg home-go" aria-disabled="true">敬请期待</span>
      </div>
    </div>
    <nav class="home-links">
      <button type="button" class="ui-btn ui-btn--ghost" data-act="guide" data-umami-event="home-guide">玩法说明</button>
      <button type="button" class="ui-btn ui-btn--ghost" data-act="about" data-umami-event="home-about">关于游戏</button>
      <a class="ui-btn ui-btn--ghost" href="${SOURCE_URL}" target="_blank" rel="noopener" data-umami-event="home-source-link">源代码 ↗</a>
    </nav>
  </div>
  <footer class="home-foot"><span class="home-caption" aria-live="off"></span><span class="home-credit">地图数据 © OpenStreetMap 贡献者 · v${__APP_VERSION__}</span></footer>`
  const progress = root.querySelector('.home-progress')!
  progress.textContent = stamps ? `已集 ${Math.min(stamps,spots.length)} / ${spots.length} 枚印章` : ''
  const go = root.querySelector<HTMLElement>('.home-go')!, tour = root.querySelector<HTMLButtonElement>('.home-mode--tour')!
  tour.onclick = ()=>play()
  // IDOK-105: offer to resume the last view only when one is stored. Placeholder styles — sg claude
  // owns the final look; `.home-resume` is the styling hook.
  const resume = root.querySelector<HTMLElement>('.home-resume')!
  const resumeClick = (event?: Event) => { event?.stopPropagation(); requestRestore(); play() }
  resume.onclick = resumeClick
  resume.onkeydown = (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); resumeClick(event) } }
  const resumeButton = resume
  root.querySelector<HTMLButtonElement>('[data-act=guide]')!.onclick = ()=>guide()
  root.querySelector<HTMLButtonElement>('[data-act=about]')!.onclick = ()=>void import('./about').then(m=>m.openAbout())
  const account = root.querySelector<HTMLButtonElement>('.home-account')!
  account.onclick = ()=>void openAccount()
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
    if(event.code==='Enter'&&document.activeElement===document.body){event.preventDefault(); play()}
    else if(event.code==='Escape'&&!event.repeat&&root.classList.contains('resume')) play()}},{capture:true})
  document.body.append(root)
  const api:Home = {
    get shown(){return shown},
    open(resume){
      shown = true; root.hidden = false; root.classList.toggle('resume',resume)
      go.textContent = resume?'继续游览':'开始游览'
      // IDOK-105: only offer to resume on a fresh entry (not the mid-game "继续游览" menu) and only
      // when a usable view is stored; sg claude owns the final copy and placement.
      resumeButton.hidden = resume || !readLastView()
      requestAnimationFrame(()=>{root.classList.add('show'); tour.focus({preventScroll:true})})
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
