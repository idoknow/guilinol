import './ui/theme.css'
import './ui/hud.css'
import {home} from './ui/home'
import {accountEntry, onUser, requireUser} from './ui/account'

// Page entry. A plain visit lands on the title screen (ui/home.ts) and the 3D city (main.ts, three.js + world data)
// only boots on 开始游览. Deep links — shares, feedback views, test harnesses — skip the title screen and boot directly.
const params = new URLSearchParams(location.search)
if (params.has('verify') || params.has('debug')) document.body.dataset.debug = ''
const deepLink = ['verify', 'spawn', 'view', 'mode', 'cam', 'feedback', 'play'].some(key => params.has(key))
// Playing requires a signed-in account (IDOK-99). Local test harnesses (Playwright on 127.0.0.1 with deep-link params) skip it.
const harness = deepLink && ['127.0.0.1', 'localhost'].includes(location.hostname)

let engine: Promise<typeof import('./main')> | undefined
const loadEngine = () => engine ??= import('./main')
let started = false

const title = home(() => void enter())
let entering = false
async function enter() {
  if (entering) return
  if (!harness) {
    entering = true
    const user = await requireUser().finally(() => { entering = false })
    if (!user) { if (!title.shown) title.open(started); return }
  }
  title.close()
  const main = await loadEngine()
  if (started) { main.setPaused(false); return }
  started = true
  hud(main)
  void main.boot()
}

function hud(main: typeof import('./main')) {
  // Signing out mid-game goes back to the title screen; 继续游览 then asks for a login again.
  if (!harness) onUser(user => { if (!user && !title.shown) { main.setPaused(true); title.open(true) } })
  const box = document.createElement('div'); box.className = 'hud-me'
  const menu = document.createElement('button'); menu.type = 'button'; menu.className = 'btn-menu'
  menu.innerHTML = '<span>菜单</span>'; menu.setAttribute('aria-label', '主菜单'); menu.title = '主菜单（Esc）'
  menu.onclick = () => { main.setPaused(true); title.open(true) }
  box.append(menu); accountEntry(box); document.body.append(box)
  // Phase 2 street HUD preview (IDOK-109): demo state until web/src/game/state.ts lands in G1.
  const street = params.get('hud') === 'street'
  if (street) void Promise.all([import('./ui/street-hud'), import('./play/map')]).then(([hudModule, map]) => {
    map.setMapPalette('street'); hudModule.mountStreetHud(hudModule.demoSource(params.get('hudDemo')), {phone: params.has('phone')})
  })
  addEventListener('keydown', event => {
    if (event.code !== 'Escape' || title.shown || document.querySelector('dialog[open],.about-mask:not([hidden]),.atlas:not([hidden]),.book:not([hidden]),.spot-card:not([hidden]),.photo-bar:not([hidden]),.render-pop:not([hidden])')) return
    menu.click()
  })
}

if (deepLink) void enter()
else {
  title.open(false)
  // Warm the engine module while the player reads the menu; the world data is already preloaded by index.html.
  const warm = () => void loadEngine()
  if ('requestIdleCallback' in window) requestIdleCallback(warm, {timeout: 2500}); else setTimeout(warm, 1200)
}
