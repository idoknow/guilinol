/**
 * 触屏补充按钮：手机上没键盘，给「叫车 / 全屏 / 视角 / 下车」四个能点的入口。
 * 桌面端（pointer:fine）不显示。
 */
const KEY = (code: string) => window.dispatchEvent(new KeyboardEvent('keydown', {code, bubbles: true}))

export function installTouchBar() {
  if (document.getElementById('touch-bar')) return
  const coarse = matchMedia('(pointer:coarse)').matches
  if (!coarse) return

  const bar = document.createElement('div')
  bar.id = 'touch-bar'
  bar.innerHTML = `
    <button type="button" data-t="hail"><b>叫车</b><small>PHONE</small></button>
    <button type="button" data-t="view"><b>人称</b><small>VIEW</small></button>
    <button type="button" data-t="exit"><b>下车</b><small>EXIT</small></button>
    <button type="button" data-t="full"><b>全屏</b><small>FULL</small></button>`
  document.body.append(bar)

  // 手机：进入游戏后第一次触摸就全屏（浏览器要求用户手势）
  const autoFullscreen = () => {
    if (document.fullscreenElement) return
    void document.documentElement.requestFullscreen?.().catch(() => {})
    window.removeEventListener('pointerdown', autoFullscreen)
  }
  window.addEventListener('pointerdown', autoFullscreen, {once: false})
  const hail = async () => {
    KEY('KeyL')
    for (let i = 0; i < 12; i++) {
      await new Promise(r => setTimeout(r, 120))
      const button = document.querySelector<HTMLElement>('[data-act="hail"]')
      if (button && button.offsetParent !== null) {
        button.click()
        setTimeout(() => KEY('KeyL'), 900)
        return
      }
    }
  }
  const full = () => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void document.documentElement.requestFullscreen().catch(() => {})
  }

  bar.addEventListener('click', event => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-t]')
    if (!target) return
    switch (target.dataset.t) {
      case 'hail':
        void hail()
        break
      case 'view':
        KEY('F3')
        break
      case 'exit':
        KEY('KeyE')
        break
      case 'full':
        full()
        break
    }
  })
}

/** 手机：把所有按钮收进一个汉堡菜单 */
export function installBurgerMenu() {
  if (!matchMedia('(pointer:coarse)').matches) return
  if (document.getElementById('hud-burger')) return
  const KEY = (code: string) => window.dispatchEvent(new KeyboardEvent('keydown', {code, bubbles: true}))
  const click = (selector: string) => document.querySelector<HTMLElement>(selector)?.click()

  const burger = document.createElement('button')
  burger.id = 'hud-burger'
  burger.type = 'button'
  burger.setAttribute('aria-label', '更多功能')
  burger.textContent = '☰'

  const sheet = document.createElement('div')
  sheet.id = 'hud-sheet'
  sheet.innerHTML = `
    <button data-m="fly">起飞 / 落地<small>V</small></button>
    <button data-m="book">景册<small>J</small></button>
    <button data-m="photo">拍照<small>P</small></button>
    <button data-m="feedback">反馈<small>F</small></button>
    <button data-m="map">地图<small>M</small></button>
    <button data-m="hail">叫车<small>L</small></button>
    <button data-m="view">切换人称<small>F3</small></button>
    <button data-m="exit">下车 / 扫码<small>E</small></button>
    <button data-m="full">全屏<small>F10</small></button>`

  document.body.append(sheet, burger)

  const close = () => {
    sheet.classList.remove('open')
    burger.classList.remove('open')
  }
  burger.addEventListener('click', () => {
    const open = sheet.classList.toggle('open')
    burger.classList.toggle('open', open)
  })
  sheet.addEventListener('click', event => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-m]')
    if (!target) return
    switch (target.dataset.m) {
      case 'fly': click('.btn-mode'); break
      case 'book': click('.dock-book'); break
      case 'photo': click('.dock-photo'); break
      case 'feedback': click('.dock-feedback'); break
      case 'map': click('.dock-map'); break
      case 'hail': {
        KEY('KeyL')
        setTimeout(() => {
          document.querySelector<HTMLElement>('[data-act="hail"]')?.click()
          setTimeout(() => KEY('KeyL'), 900)
        }, 320)
        break
      }
      case 'view': KEY('F3'); break
      case 'exit': KEY('KeyE'); break
      case 'full':
        if (document.fullscreenElement) void document.exitFullscreen()
        else void document.documentElement.requestFullscreen().catch(() => {})
        break
    }
    close()
  })
  document.addEventListener('pointerdown', event => {
    if (!sheet.contains(event.target as Node) && event.target !== burger) close()
  }, true)
}