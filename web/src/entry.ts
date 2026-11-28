import {getPlayMode, lastPlayMode, linkedPlayMode, setPlayMode, type PlayMode} from './game/play-mode'
import './telemetry'
import './ui/theme.css'
import './ui/hud.css'
registerPrecache()
// 禁止右键菜单和长按菜单（输入框除外），避免手机长按按钮弹出复制/保存图片
document.addEventListener('contextmenu',event=>{if(!(event.target as Element|null)?.closest?.('input,textarea,[contenteditable]:not([contenteditable=false])'))event.preventDefault()})
document.addEventListener('dragstart',event=>{if((event.target as Element|null)?.tagName==='IMG')event.preventDefault()})
import {fullscreenOnEntry} from './ui/orientation'
import {home} from './ui/home'
import {accountEntry, consumeCreatorSpawn, onUser, requireUser} from './ui/account'
import {isDeepLink} from './deeplink'
import {cancelRestore} from './lastview'
import {fullLoader,veil,inlineBusy,type FullLoader,type Veil} from './ui/loading'
import {watchForUpdates} from './ui/update-check'
import {registerPrecache} from './precache'

// Page entry. A plain visit lands on the title screen (ui/home.ts) and the 3D city (main.ts, three.js + world data)
// only boots on 开始游览. Deep links — shares, feedback views, test harnesses — skip the title screen and boot directly.
const params = new URLSearchParams(location.search)
if (params.has('verify') || params.has('debug')) document.body.dataset.debug = ''
const deepLink = isDeepLink(params)
watchForUpdates()
onUser(user => markSession(user?.uid ?? null))
// Playing requires a signed-in account (IDOK-99). Local test harnesses (Playwright on 127.0.0.1 with deep-link params) skip it.
const harness = deepLink && ['127.0.0.1', 'localhost'].includes(location.hostname)

let engine: Promise<typeof import('./main')> | undefined
const loadEngine = () => engine ??= import('./main')
let started = false

import {mpEnabled,setMpEnabled,waitForOnline} from './ui/mp-pref'
const title = home((mode,online) => {
  if (!started && !entering) fullscreenOnEntry()
  void enter(mode,true,online)
})
window.addEventListener('glol:registered',()=>void enter(lastPlayMode()))
let entering = false
async function enter(mode: PlayMode, remember = true, online=mode==='solo'&&mpEnabled()) {
  if (entering) return
  entering = true
  const previous=getPlayMode(),initial=!started,controller=new AbortController()
  const wasOnline=mpEnabled(),changed=previous!==mode||wasOnline!==online
  let loader:FullLoader|undefined,cover:Veil|undefined,timer=0,cancelTimer=0
  let main:typeof import('./main')|undefined
  const cancel=()=>{controller.abort();if(initial)location.replace(location.pathname)}
  try {
    if (!harness) {
      const user = await requireUser()
      if (!user) { cancelRestore(); if (!title.shown) title.open(started); return }
    }
    // The title camera dives on the press; let it play before the loader covers it (~0.8 s, 0 without a live cover).
    await title.launch()
    const creator=consumeCreatorSpawn()
    if(initial){
      loader=fullLoader([{id:'engine',label:'准备引擎',weight:15},{id:'terrain',label:'载入地形',weight:20},{id:'overview',label:'铺开山水',weight:20},{id:'ring',label:'载入街区',weight:40},{id:'frame',label:'即将抵达',weight:5}]);loader.stage('engine',0,1)
      const start=performance.now(),chunks=Object.entries<number>(JSON.parse(document.querySelector<HTMLMetaElement>('meta[name=engine-chunks]')?.content??'{}'))
      const total=chunks.reduce((sum,[,size])=>sum+size,0)
      timer=window.setInterval(()=>{let done=0
        for(const [path,size] of chunks){const url=new URL(path,document.baseURI);const resource=performance.getEntriesByName(url.href)[0] as PerformanceResourceTiming|undefined
          if(resource?.responseEnd)done+=Math.min(size,resource.decodedBodySize||size)}
        loader?.stage('engine',done&&total?Math.min(.95,done/total):.9*(1-Math.exp((start-performance.now())/1000)),1)
      },100)
      const cancelButton=document.querySelector<HTMLButtonElement>('.ld-cancel')!;cancelButton.onclick=cancel
      cancelTimer=window.setTimeout(()=>cancelButton.hidden=false,15000)
    }else cover=veil(creator?'正在进入桂林':'正在切换模式',{onCancel:cancel})
    main=await loadEngine();clearInterval(timer);loader?.stage('engine',1,1)
    main.setTitleTransition({signal:controller.signal,view:cover,cancel})
    controller.signal.throwIfAborted()
    if(started&&changed)main.leaveLocation()
    if(changed||remember)setMpEnabled(online,!online&&mode==='solo')
    await setPlayMode(mode,false,controller.signal)
    if(started)await main.waitForMode()
    if(started&&changed&&previous===mode)await main.enterLocation()
    controller.signal.throwIfAborted()
    title.close()
    if(started){if(creator)await main.spawnCreatedCharacter();main.setPaused(false)}
    else {hud(main);await main.boot(loader!,creator);started=true}
    if(online&&remember&&(changed||initial))await waitForOnline(controller.signal)
    controller.signal.throwIfAborted()
    if(remember)await setPlayMode(mode,true)
  } catch(error) {
    if(loader){loader.fail(error instanceof Error&&error.message.includes('街区')?error.message:'网络或场景资源不可用，请重试',()=>{sessionStorage.setItem('glol.retryMode',mode);location.reload()});return}
    main?.setTitleTransition(undefined)
    if(changed&&started){main?.leaveLocation(false);setMpEnabled(wasOnline);await setPlayMode(previous,false);await main?.waitForMode();if(previous===mode)await main?.enterLocation()}
    main?.setPaused(true)
    title.open(started)
    if(!controller.signal.aborted)window.alert(error instanceof Error ? error.message : '无法进入模式')
  } finally {
    clearInterval(timer);clearTimeout(cancelTimer);main?.setTitleTransition(undefined);await cover?.done()
    title.idle()
    entering = false
  }
}

function hud(main: typeof import('./main')) {
  // Signing out mid-game goes back to the title screen; 继续游览 then asks for a login again.
  if (!harness) onUser(user => { if (!user && !title.shown) { main.setPaused(true); title.open(true) } })
  const box = document.createElement('div'); box.className = 'hud-me'
  const menu = document.createElement('button'); menu.type = 'button'; menu.className = 'btn-menu'
  menu.innerHTML = '<span>菜单</span>'; menu.setAttribute('aria-label', '主菜单'); menu.title = '主菜单（Esc）'
  menu.onclick = () => { main.setPaused(true); title.open(true) }
  box.append(menu); accountEntry(box); document.body.append(box)
  registerPageUI(box)
  // Phase 2 street HUD (IDOK-109 / IDOK-123): live game state by default, demoSource when ?hudDemo= is passed.
  const street = params.get('hud') === 'street'
  if (street) {const done=inlineBusy(menu,'载入街道界面');void Promise.all([import('./ui/street-hud'), import('./play/map')]).then(([hudModule, map]) => {
    map.setMapPalette('street')
    const source = params.has('hudDemo') ? hudModule.demoSource(params.get('hudDemo')) : hudModule.gameStateHudSource()
    hudModule.mountStreetHud(source, {
      phone: params.has('phone'),
      onApp: id => {
        if (getPlayMode() !== 'solo') return
        if (id === 'jobs') window.dispatchEvent(new CustomEvent('game:open-missions'))
        else if (id === 'wardrobe') window.dispatchEvent(new CustomEvent('game:open-wardrobe'))
        else if (id === 'garage') window.dispatchEvent(new CustomEvent('game:open-garage'))
      },
    })
  }).finally(done)}
  addEventListener('keydown', event => {
    if (
      event.code !== 'Escape' ||
      event.defaultPrevented ||
      title.shown ||
      document.body.dataset.drinksUiOpen === '1' ||
      document.body.dataset.mifenCooking === '1' ||
      document.body.dataset.mifenDrawer === '1' ||
      document.body.dataset.mifenStoryActive === '1' ||
      document.querySelector('dialog[open],.about-mask:not([hidden]),.atlas:not([hidden]),.book:not([hidden]),.spot-card:not([hidden]),.photo-bar:not([hidden]),.render-pop:not([hidden]),.shop-overlay.show,.wardrobe-overlay.show,.garage-overlay.show,.drinks-order-panel:not([hidden]),.mifen-cook-panel:not([hidden]),.mifen-upgrade-drawer:not([hidden]),.mifen-econ-panel:not([hidden]),.mifen-story-dialog:not([hidden]),[data-story-dialog="1"]:not([hidden])')
    ) return
    menu.click()
  })
}

const retry=sessionStorage.getItem('glol.retryMode');sessionStorage.removeItem('glol.retryMode')
if(retry==='solo'||retry==='tour')void enter(retry)
else if (deepLink) void enter(linkedPlayMode(params), false)
else {
  title.open(false)
  // Warm the engine module while the player reads the menu; the world data is already preloaded by index.html.
  const warm = () => void loadEngine().catch(()=>{})
  if ('requestIdleCallback' in window) requestIdleCallback(warm, {timeout: 2500}); else setTimeout(warm, 1200)
}
import {markSession} from './session-mark'
import {registerPageUI} from './capture-page'
