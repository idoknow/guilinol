import {getPlayMode,onPlayMode} from '../game/play-mode'
import './street-hud.css'
import {isGlobalHotkeyBlocked} from '../walk/input-guard'
import {getState, onEvent, onState} from '../game/state'

// Phase 2 街头 HUD (docs/style.md 第二期 · HUD). Pure view: it renders whatever state it is given and never
// touches engine objects. G1+ wires `mountStreetHud` to `onState` from web/src/game/state.ts; until then
// `?hud=street` mounts it on a demo state so the layout can be judged on the real scene.
// Layout: 左下 小地图 + 路名牌 · 右上 钱 · 底部居中 任务字幕 · 右下 速度表 · 手机（Tab）= 菜单。

export type HudMode = 'foot'|'ebike'|'bike'|'car'|'boat'|'fly'
export interface HudState {
  mode: HudMode
  vehicle: {kind:string; speedKmh:number; gear?:'D'|'R'|'N'; damage:number} | null
  money: number
  mission: {id:string; title:string; step:string; timer?:number; meter?:{label:string; value:number}; line?:{who:string; text:string}} | null
  zone: {quiet:boolean; name?:string}
  clock?: {time:string; weather:string}
  prompt?: {key:string; text:string} | null
}
export interface HudSource { get():Readonly<HudState>; on(fn:(s:Readonly<HudState>)=>void):()=>void }

const VEHICLE: Record<string,string> = {ebike:'电驴', bike:'单车', car:'汽车', boat:'快艇', taxi:'出租车'}
const APPS = [
  {id:'map', glyph:'图', name:'地图', tint:'#20d6c1'}, {id:'jobs', glyph:'活', name:'接活', tint:'#ffc53d'},
  {id:'wardrobe', glyph:'衣', name:'衣橱', tint:'#ff5d8f'}, {id:'garage', glyph:'车', name:'车库', tint:'#ff8a3d'},
  {id:'settings', glyph:'设', name:'设置', tint:'#9aa3ad'},
]
const money = (n:number)=>n.toLocaleString('zh-CN')
/** 共享电车理赔入账（= walk/shared-ebike-logic.ts SHARED_EBIKE_COMPENSATION_REASON）；钱只对这一笔做跳动反馈 */
const COMPENSATION_REASON = 'shared_ebike_compensation'
const CASH_BOUNCE_MS = 680, CASH_DELTA_MS = 900
const clockText = (s:number)=>`${String(Math.floor(s/60)).padStart(2,'0')}:${String(Math.floor(s%60)).padStart(2,'0')}`

export function mountStreetHud(source:HudSource, opts:{phone?:boolean; onApp?:(id:string)=>void}={}) {
  document.body.dataset.hud = 'street'
  const root = document.createElement('div'); root.className = 'st-hud'
  root.innerHTML = `
    <div class="st-cash" aria-live="polite"><b class="st-money"></b></div>
    <div class="st-clock"></div>
    <button class="st-phone-btn" type="button" aria-label="打开手机（Tab）"><i></i><span>手机</span><kbd>Tab</kbd></button>
    <section class="st-mission" hidden><header><span class="st-line"></span><b class="st-step"></b><time class="st-timer"></time></header>
      <div class="st-meter"><span></span><i><em></em></i></div><p class="st-sub"></p></section>
    <div class="st-speed" hidden><b></b><small>km/h</small><span class="st-gear"></span><em class="st-ride"></em><i class="st-damage"><s></s></i></div>
    <div class="st-prompt" hidden><kbd></kbd><span></span></div>
    <div class="st-quiet" hidden>安静区 · 学校周边，任务不进入</div>
    <aside class="st-phone" hidden aria-label="手机"><div class="st-phone-body">
      <header><span class="st-phone-time"></span><span>桂林通 5G</span></header>
      <div class="st-phone-cash"><small>余额</small><b></b></div>
      <ol class="st-apps">${APPS.map(a=>`<li><button type="button" data-app="${a.id}"><i style="--tint:${a.tint}">${a.glyph}</i><span>${a.name}</span></button></li>`).join('')}</ol>
      <footer><kbd>Tab</kbd> 收起</footer></div></aside>`
  document.body.append(root)
  registerPageUI(root)
  const $ = <T extends HTMLElement>(sel:string)=>root.querySelector<T>(sel)!
  const phone = $('.st-phone'), phoneButton = $('.st-phone-btn')
  const togglePhone = (on = phone.hidden)=>{phone.hidden = !on; document.body.toggleAttribute('data-phone', on)}
  phoneButton.onclick = ()=>togglePhone()
  for(const btn of Array.from(root.querySelectorAll<HTMLButtonElement>('.st-apps button[data-app]'))) {
    btn.onclick = ()=>{togglePhone(false); opts.onApp?.(btn.dataset.app!)}
  }
  const onKeyDown = (e:KeyboardEvent)=>{if(e.code==='Tab'&&!isGlobalHotkeyBlocked(e.target)){e.preventDefault(); togglePhone()}}
  const onGameEvent = (e:Event)=>{const detail=(e as CustomEvent<{type?:string}>).detail; if(detail?.type==='shop:open'&&!phone.hidden) togglePhone(false)}
  addEventListener('keydown', onKeyDown)
  addEventListener('game:event', onGameEvent)
  if(opts.phone) togglePhone(true)

  function render(s:Readonly<HudState>) {updatePageUI(root,()=>paint(s))}
  function paint(s:Readonly<HudState>) {
    $('.st-money').textContent = `¥${money(s.money)}`
    $('.st-phone-cash b').textContent = `¥${money(s.money)}`
    $('.st-clock').textContent = s.clock ? `${s.clock.time} · ${s.clock.weather}` : ''
    $('.st-phone-time').textContent = s.clock?.time ?? ''
    const m = getPlayMode()==='solo' && s.mission, box = $('.st-mission'); box.hidden = !m
    if(m) {
      $('.st-line').textContent = m.title; $('.st-step').textContent = m.step
      const timer = $('.st-timer'); timer.hidden = m.timer===undefined; timer.textContent = m.timer!==undefined ? clockText(m.timer) : ''
      timer.classList.toggle('low', (m.timer ?? 99) < 30)
      const meter = $('.st-meter'); meter.hidden = !m.meter
      if(m.meter){meter.querySelector('span')!.textContent = m.meter.label; meter.querySelector('em')!.style.width = `${Math.round(m.meter.value*100)}%`}
      const sub = $('.st-sub'); sub.hidden = !m.line
      if(m.line){const speaker=document.createElement('b');speaker.textContent=m.line.who;sub.replaceChildren(speaker,m.line.text)}
    }
    const v = s.vehicle, speed = $('.st-speed'); speed.hidden = !v
    if(v) {
      speed.querySelector('b')!.textContent = String(Math.round(v.speedKmh))
      $('.st-gear').textContent = v.gear ?? ''; $('.st-ride').textContent = VEHICLE[v.kind] ?? v.kind
      $('.st-damage s').style.width = `${Math.round((1-v.damage)*100)}%`
    }
    const p = $('.st-prompt'); p.hidden = !s.prompt
    if(s.prompt){p.querySelector('kbd')!.textContent = s.prompt.key; p.querySelector('span')!.textContent = s.prompt.text}
    $('.st-quiet').hidden = !s.zone.quiet
    document.body.dataset.ride = s.vehicle ? s.vehicle.kind : 'foot'
  }
  function renderMode() {
    const solo = getPlayMode()==='solo'
    $('.st-money').hidden = !solo
    $('.st-phone-cash').hidden = !solo
    for(const id of ['jobs','wardrobe','garage']) $(`[data-app="${id}"]`).parentElement!.hidden = !solo
    render(source.get())
  }
  renderMode()
  const offMode = onPlayMode(renderMode)
  const off = source.on(render)
  // IDOK-545：理赔到账时金额跳一下，旁边飘出一枚金色 +¥ 浮标（900ms 后自毁）
  const cash = $('.st-cash'), cashMoney = $('.st-money')
  let bounceTimer = 0, deltaTimer = 0, deltaTag:HTMLElement|null = null
  function pulseCash(delta:number) {
    if(cashMoney.hidden) return
    cash.classList.remove('is-comp-bounce'); void cash.offsetWidth; cash.classList.add('is-comp-bounce')
    clearTimeout(bounceTimer)
    bounceTimer = window.setTimeout(()=>{cash.classList.remove('is-comp-bounce'); bounceTimer = 0}, CASH_BOUNCE_MS)
    clearTimeout(deltaTimer); deltaTag?.remove()
    const tag = document.createElement('span'); tag.className = 'st-cash-delta'; tag.setAttribute('aria-hidden', 'true')
    tag.textContent = `+¥${money(Math.round(delta))}`
    cash.append(tag); deltaTag = tag
    deltaTimer = window.setTimeout(()=>{tag.remove(); if(deltaTag===tag) deltaTag = null; deltaTimer = 0}, CASH_DELTA_MS)
  }
  const offCash = onEvent(ev=>{if(ev.type==='money:change'&&ev.delta>0&&ev.reason===COMPENSATION_REASON) pulseCash(ev.delta)})
  return {root, togglePhone, dispose(){offMode(); off(); offCash(); clearTimeout(bounceTimer); clearTimeout(deltaTimer); deltaTag?.remove(); deltaTag = null
    removeEventListener('keydown', onKeyDown); removeEventListener('game:event', onGameEvent); root.remove(); delete document.body.dataset.hud}}
}

export function gameStateHudSource():HudSource {
  const toHud = ():Readonly<HudState>=>{
    const s = getState()
    return {
      mode: s.mode,
      vehicle: s.vehicle ? {kind:s.vehicle.kind, speedKmh:s.vehicle.speedKmh, gear:s.vehicle.gear, damage:s.vehicle.damage} : null,
      money: s.money,
      mission: s.mission ? {id:s.mission.id, title:s.mission.title, step:s.mission.step, timer:s.mission.timer, meter:s.mission.meter, line:s.mission.line} : null,
      zone: s.zone,
      prompt: s.prompt ? {key:s.prompt.key, text:s.prompt.text} : null,
    }
  }
  return {
    get: toHud,
    on: fn=>onState(()=>fn(toHud())),
  }
}

// Demo states for `?hud=street&hudDemo=…` (style sheets and review screenshots only).
export function demoSource(name:string|null):HudSource {
  const base:HudState = {
    mode:'ebike', vehicle:{kind:'ebike', speedKmh:32, damage:.12}, money:1280,
    mission:{id:'noodle-01', title:'米粉外卖', step:'送到 中山中路 18 号', timer:134, meter:{label:'汤', value:.86},
      line:{who:'粉店阿姨', text:'“汤满的，急刹车会洒，慢点拐弯！”'}},
    zone:{quiet:false}, clock:{time:'13:40', weather:'晴'}, prompt:null,
  }
  const states:Record<string,Partial<HudState>> = {
    noodle:{},
    night:{clock:{time:'21:30', weather:'小雨'}, vehicle:{kind:'car', speedKmh:68, gear:'D', damage:.35},
      mission:{id:'race-01', title:'环城夜赛', step:'检查点 3 / 8 · 解放桥', timer:52,
        line:{who:'阿杰', text:'“前面就是解放桥，过了桥钻东西巷！”'}}},
    foot:{mode:'foot', vehicle:null, prompt:{key:'F', text:'骑上电驴'}},
  }
  const state = {...base, ...(states[name ?? 'noodle'] ?? {})}
  return {get:()=>state, on:()=>()=>{}}
}
import {registerPageUI,updatePageUI} from '../capture-page'
