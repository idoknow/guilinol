import './combat.css'
import { config } from './net'
import type { Fighter, Phase } from './state'

// IDOK-423 拳击 HUD：左下「气血签」+ 倒地倒计时 + 救援读条 + 手机拳/救援键。
// 视觉规则见 combat.css 顶部注释；这里只负责状态 → class / CSS 变量。
export function hud() {
  const root = document.createElement('div')
  root.className = 'cb-ui'
  root.hidden = true
  root.innerHTML =
    '<div class="cb-hp is-calm" role="meter" aria-label="气血" aria-valuemin="0">' +
    '<span class="cb-hp-label">气血</span>' +
    '<span class="cb-hp-track"><i class="cb-hp-lag"></i><i class="cb-hp-fill"></i></span>' +
    '<span class="cb-hp-text"></span>' +
    '<span class="cb-down-ring" hidden></span>' +
    '</div>' +
    '<div class="cb-tip" hidden></div>' +
    '<div class="cb-revive-bar" hidden><span>救援中</span><i></i></div>' +
    '<div class="cb-vignette"></div>' +
    '<div class="cb-controls"><button class="cb-btn-punch" type="button" aria-label="出拳">拳</button>' +
    '<button class="cb-btn-revive" type="button" aria-label="长按救援" hidden>扶</button></div>'
  document.body.append(root)
  const el = (cls: string) => root.querySelector<HTMLElement>('.cb-' + cls)!
  const hp = el('hp'),
    text = el('hp-text'),
    ring = el('down-ring'),
    bar = el('revive-bar'),
    tip = el('tip'),
    punch = el('btn-punch'),
    revive = el('btn-revive'),
    vignette = el('vignette')
  hp.setAttribute('aria-valuemax', String(config.hpMax))
  let lastHp = -1,
    lastState = '',
    calmSince = 0
  return {
    root,
    punch,
    revive,
    tip,
    update(f: Fighter, state: Phase, now: number, prompt: string, progress: number) {
      if (root.hidden) root.hidden = false
      if (lastHp !== f.hp) {
        const prev = lastHp,
          dropped = prev >= 0 && f.hp < prev
        lastHp = f.hp
        const p = Math.max(0, Math.min(1, f.hp / config.hpMax))
        text.textContent = String(Math.ceil(f.hp))
        hp.style.setProperty('--hp', String(p))
        hp.setAttribute('aria-valuenow', String(Math.ceil(f.hp)))
        hp.classList.toggle('is-mid', p < 0.6 && p >= 0.3)
        hp.classList.toggle('is-low', p < 0.3 && !f.down)
        // 自己掉血：屏幕四角一圈很淡的朱砂晕，强度随这一下的伤害；回血不触发
        if (dropped && !f.down)
          vignette.animate([{ opacity: Math.min(0.8, 0.25 + (prev - f.hp) / 30) }, { opacity: 0 }], {
            duration: prev - f.hp >= config.damage.hook ? 520 : 360,
            easing: 'ease-out',
          })
        window.dispatchEvent(new CustomEvent('combat:hp', { detail: { hp: f.hp, max: config.hpMax } }))
      }
      if (lastState !== state) {
        lastState = state
        window.dispatchEvent(new CustomEvent('combat:state', { detail: { state } }))
      }
      // 满血且 4 s 没动手 → 安静态（半透明）；一出拳 / 挨打立刻提亮
      const busy = f.hp < config.hpMax || state !== 'idle'
      if (busy) calmSince = now
      hp.classList.toggle('is-calm', !busy && now - calmSince > 4000)
      hp.classList.toggle('is-down', f.down)
      ring.hidden = !f.down
      if (f.down) {
        const ms = Math.max(0, f.deadline - now)
        ring.textContent = (f.progress > 0 ? '正被扶起' : '待救援') + ' ' + Math.ceil(ms / 1000) + 's'
        hp.style.setProperty('--down', String(ms / (1000 * config.downSeconds)))
      }
      tip.hidden = !prompt
      if (tip.textContent !== prompt) tip.textContent = prompt
      tip.classList.toggle('is-busy', prompt === '正在被救援')
      bar.hidden = !progress
      bar.style.setProperty('--p', String(progress))
      revive.hidden = !prompt || prompt === '正在被救援'
      punch.hidden = f.down || !!f.helping || !revive.hidden
    },
  }
}
