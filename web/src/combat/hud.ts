import './combat.css'
import { config } from './net'
import type { Fighter, Phase } from './state'
export function hud() {
  const root = document.createElement('div')
  root.className = 'cb-ui'
  root.hidden = true
  root.innerHTML =
    '<div class="cb-hp"><i class="cb-hp-fill"></i><span class="cb-hp-text"></span><span class="cb-down-ring"></span></div><div class="cb-tip"></div><div class="cb-revive-bar"></div><div class="cb-controls"><button class="cb-btn-punch">出拳</button><button class="cb-btn-revive">救援</button></div>'
  document.body.append(root)
  const el = (cls: string) => root.querySelector<HTMLElement>('.cb-' + cls)!
  const hp = el('hp'),
    fill = el('hp-fill'),
    text = el('hp-text'),
    ring = el('down-ring'),
    bar = el('revive-bar'),
    tip = el('tip'),
    punch = el('btn-punch'),
    revive = el('btn-revive')
  let lastHp = -1,
    lastState = ''
  return {
    root,
    punch,
    revive,
    tip,
    update(f: Fighter, state: Phase, now: number, prompt: string, progress: number) {
      if (root.hidden) root.hidden = false
      if (lastHp !== f.hp) {
        lastHp = f.hp
        text.textContent = Math.ceil(f.hp) + ' / ' + config.hpMax
        fill.style.transform = 'scaleX(' + f.hp / config.hpMax + ')'
        hp.classList.toggle('is-low', f.hp < config.hpMax * 0.25)
        hp.classList.toggle('is-down', f.down)
        window.dispatchEvent(new CustomEvent('combat:hp', { detail: { hp: f.hp, max: config.hpMax } }))
      }
      if (lastState !== state) {
        lastState = state
        window.dispatchEvent(new CustomEvent('combat:state', { detail: { state } }))
      }
      ring.hidden = !f.down
      if (f.down) {
        const ms = Math.max(0, f.deadline - now)
        ring.textContent = '待救援 ' + Math.ceil(ms / 1000) + 's'
        ring.style.setProperty('--p', String(ms / (1000 * config.downSeconds)))
      }
      if (tip.textContent !== prompt) tip.textContent = prompt
      bar.hidden = !progress
      bar.style.setProperty('--p', String(progress))
      revive.hidden = !prompt || prompt === '正在被救援'
      punch.hidden = f.down || !!f.helping
    },
  }
}
