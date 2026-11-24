// 玩法引导（IDOK-221）：三件东西，一份数据。
//  · 按键卡 .keys-card —— 电脑端左下角，随「步行 / 飞行 / 电驴 / 单车 / 汽车 / 船」切换，只放当下最常用的几个键；可折叠，记住状态。
//    手机（pointer:coarse）和窄屏不显示：那边按钮本身就写着字，键盘提示没有意义。
//  · 玩法指南 .guide-sheet —— 全部玩法怎么用 + 全部按键 / 触屏手势。入口：按键卡底部、左上「?」按钮、F1 或 ?、首页「怎么玩」。
//  · 新手引导 .coach —— 第一次进城时按真实 HUD 位置点亮 4–6 步（找不到的按钮自动跳过），只出现一次，可在指南里重看。
// 键名一律走 keymap 的 bindingLabel，玩家改键后这里跟着变。
import './guide.css'
import {bindingLabel, type Action} from '../input/keymap'
import {onPrefs} from './prefs'
import {getPlayMode} from '../game/play-mode'
import {isGlobalHotkeyBlocked} from '../walk/input-guard'

type Ctx = 'walk' | 'fly' | 'bike' | 'bicycle' | 'car' | 'boat'
type Row = {keys: string[]; label: string; solo?: boolean; free?: boolean; id?: string}

const touch = () => matchMedia('(pointer:coarse)').matches
const solo = () => getPlayMode() === 'solo'
const k = (action: Action) => bindingLabel(action).split(' / ')[0]
const move = () => [k('forward'), k('left'), k('back'), k('right')]

const CTX_NAME: Record<Ctx, string> = {walk: '步行', fly: '飞行', bike: '骑电驴', bicycle: '骑单车', car: '开车', boat: '划船'}

// 每个场景最多 10 格（两列五行），按「最常用」排序。free = 只在可以飞的模式（游览 / 联机）里出现。
function rows(ctx: Ctx): Row[] {
  switch (ctx) {
    case 'walk': return [
      {keys: move(), label: '走路'}, {keys: [k('run')], label: '跑'},
      {keys: [k('jump')], label: '跳'}, {keys: [k('crouch')], label: '蹲'},
      {keys: [k('interact')], label: '上车 / 交互'}, {keys: [k('emote')], label: '表情（长按）', id: 'emote'},
      {keys: ['L'], label: '叫共享电驴', solo: true}, {keys: ['O'], label: '随身衣橱', solo: true},
      {keys: [k('view')], label: '第一 / 第三人称'}, {keys: ['V'], label: '起飞', free: true},
      {keys: ['M'], label: '地图'}, {keys: ['P'], label: '拍照'},
    ]
    case 'fly': return [
      {keys: move(), label: '飞'}, {keys: ['Q', 'E'], label: '降 / 升'},
      {keys: ['Shift'], label: '加速'}, {keys: ['V'], label: '落地步行'},
      {keys: ['M'], label: '地图传送'}, {keys: ['J'], label: '景册'},
      {keys: ['P'], label: '拍照'}, {keys: ['Esc'], label: '菜单'},
    ]
    case 'bike': return [
      {keys: move(), label: '骑'}, {keys: ['Q', 'E'], label: '降 / 升挡'},
      {keys: [k('jump')], label: '翘头 / 扶车'}, {keys: [k('run')], label: '压弯'},
      {keys: ['H'], label: '喇叭'}, {keys: ['L'], label: '车灯'},
      {keys: ['Z', 'X'], label: '左 / 右转灯'}, {keys: ['K'], label: '边撑'},
      {keys: ['U'], label: '定速'}, {keys: [k('interact')], label: '下车'},
    ]
    case 'bicycle': return [
      {keys: move(), label: '骑'}, {keys: ['Q', 'E'], label: '换挡'},
      {keys: [k('jump')], label: '翘头 / 扶车'}, {keys: [k('run')], label: '压弯'},
      {keys: ['H'], label: '铃铛'}, {keys: ['K'], label: '边撑'},
      {keys: ['C'], label: '视距'}, {keys: [k('interact')], label: '下车'},
    ]
    case 'car': return [
      {keys: move(), label: '驾驶'}, {keys: [k('jump')], label: '手刹 / 漂移'},
      {keys: ['Q', 'E'], label: '切驾驶模式'}, {keys: ['L'], label: '车灯'},
      {keys: ['C'], label: '视距'}, {keys: [k('interact')], label: '下车'},
    ]
    case 'boat': return [
      {keys: move(), label: '划船'}, {keys: [k('interact')], label: '靠岸下船'},
      {keys: ['C'], label: '视距'}, {keys: ['V'], label: '起飞', free: true},
    ]
  }
}

const visible = (row: Row) => (!row.solo || solo()) && (!row.free || !solo())

function current(): Ctx {
  const body = document.body.dataset
  if (body.mode !== 'walk') return 'fly'
  if (document.body.hasAttribute('data-aboard')) {
    const ride = body.ride
    if (ride === 'bike' || ride === 'bicycle' || ride === 'car' || ride === 'boat') return ride
  }
  return 'walk'
}

const caps = (keys: string[]) => keys.map(key => `<kbd>${key}</kbd>`).join('')

// ─── 按键卡 ──────────────────────────────────────────────────────────────────────────────────────
const FOLD_KEY = 'glol.keys.fold'
let card: HTMLElement | undefined
let lastCtx: Ctx | undefined

function mountCard() {
  card = document.createElement('section')
  card.className = 'keys-card'
  card.setAttribute('aria-label', '常用按键')
  card.innerHTML = `<button type="button" class="keys-head" aria-expanded="true" title="折叠 / 展开按键">
      <span class="keys-title">按键</span><span class="keys-ctx"></span><i class="keys-fold" aria-hidden="true"></i></button>
    <ul class="keys-list"></ul>
    <button type="button" class="keys-more">全部按键与玩法<kbd>F1</kbd></button>`
  card.querySelector<HTMLButtonElement>('.keys-head')!.onclick = () => setFold(!card!.classList.contains('folded'))
  card.querySelector<HTMLButtonElement>('.keys-more')!.onclick = () => openGuide('keys')
  document.body.append(card)
  setFold(localStorage.getItem(FOLD_KEY) === '1', false)
}

function setFold(folded: boolean, remember = true) {
  if (!card) return
  card.classList.toggle('folded', folded)
  card.querySelector('.keys-head')!.setAttribute('aria-expanded', String(!folded))
  if (remember) localStorage.setItem(FOLD_KEY, folded ? '1' : '0')
}

function renderCard() {
  if (!card) return
  const ctx = current()
  card.querySelector('.keys-ctx')!.textContent = CTX_NAME[ctx]
  card.querySelector('.keys-list')!.innerHTML = rows(ctx).filter(visible)
    .map(row => `<li${row.id ? ` data-id="${row.id}"` : ''}><span class="keys-caps">${caps(row.keys)}</span><span>${row.label}</span></li>`).join('')
  // 第一次上某种车：卡片自动展开并闪一下，告诉玩家「这辆车的键在这儿」。
  if (lastCtx && ctx !== lastCtx && ctx !== 'walk' && ctx !== 'fly') {
    const seen = `glol.keys.seen.${ctx}`
    if (!localStorage.getItem(seen)) {
      localStorage.setItem(seen, '1')
      if (card.classList.contains('folded')) setFold(false, false)
      card.classList.remove('pulse'); void card.offsetWidth; card.classList.add('pulse')
      window.dispatchEvent(new CustomEvent('walk:toast', {detail: {text: `第一次${CTX_NAME[ctx]}：左下角是它的按键`, ms: 3200}}))
    }
  }
  lastCtx = ctx
}

// ─── 玩法指南 ────────────────────────────────────────────────────────────────────────────────────
type Feature = {seal: string; title: string; pc: string; phone: string; only?: 'solo' | 'free'}
const FEATURES = (): Feature[] => [
  {seal: '行', title: '走路与视角',
    pc: `${caps(move())} 走，<kbd>${k('run')}</kbd> 跑，<kbd>${k('jump')}</kbd> 跳，<kbd>${k('crouch')}</kbd> 蹲。按住鼠标拖动转视角，滚轮拉远拉近，<kbd>${k('view')}</kbd> 切第一 / 第三人称。`,
    phone: '左下摇杆走路，推到底就是跑；右半边屏幕滑动转视角，双指捏合拉远拉近。右下「跃」「蹲」「远近」分别是跳、蹲、换视距。'},
  {seal: '情', title: '表情动作',
    pc: `<b>长按</b> <kbd>${k('emote')}</kbd> 打开动作盘，鼠标移到想做的动作上松手；<b>短按</b> <kbd>${k('emote')}</kbd> 重播上一个。联机时别人也能看到。`,
    phone: '点右边「表情」打开动作盘，再点一个动作。联机时别人也能看到。'},
  {seal: '骑', title: '骑车、开车、划船',
    pc: `走到路边的电驴、单车、汽车或码头的船旁边，按 <kbd>${k('interact')}</kbd> 上去，再按一次下来。附近没车可以按 <kbd>L</kbd> 叫一辆共享电驴。上车后左下按键卡会换成这辆车的键。`,
    phone: '走到车旁边，点屏幕下方出现的上车按钮。附近没车就点右下「叫车」，共享电驴会停到你身边。骑上去后右下会换成挡位、翘头、压弯这些按钮。'},
  {seal: '活', title: '接活赚钱', only: 'solo',
    pc: '点屏幕上方的「¥ 接活」，挑一单：送米粉、跑腿、拉客、跑环城夜赛。跟着地图上的路线走，完成就进账。',
    phone: '点屏幕上方的「¥ 接活」，挑一单：送米粉、跑腿、拉客、跑环城夜赛。跟着地图上的路线走，完成就进账。'},
  {seal: '衣', title: '换装与买车', only: 'solo',
    pc: '按 <kbd>O</kbd> 打开随身衣橱换衣服。走进街边的服装店、车行可以花钱买新衣服、新电驴和改装件。',
    phone: '走进街边的服装店、车行，可以花钱买新衣服、新电驴和改装件。'},
  {seal: '飞', title: '飞上天', only: 'free',
    pc: `按 <kbd>V</kbd> 起飞，${caps(move())} 飞，<kbd>Q</kbd> / <kbd>E</kbd> 降 / 升，<kbd>Shift</kbd> 加速；再按 <kbd>V</kbd> 落地步行。`,
    phone: '点右上「起飞」。一根手指拖动转方向，两根手指拖着走；点「落地步行」回到地面。'},
  {seal: '图', title: '地图与传送',
    pc: '按 <kbd>M</kbd> 或点右上「地图」。可以搜地名，点地图上任意一处就直接过去；右上角小圆图随时告诉你在哪条路。',
    phone: '点右上「地图」，搜地名或点地图上任意一处，直接传送过去。'},
  {seal: '印', title: '景册集印章',
    pc: '名胜附近地上有朱红色圆圈，走进去就盖一枚印章。按 <kbd>J</kbd> 翻景册，看还差哪几处，也能从景册直接去。',
    phone: '名胜附近地上有朱红色圆圈，走进去就盖一枚印章。点「景册」看还差哪几处，也能从景册直接去。'},
  {seal: '摄', title: '拍照与相机',
    pc: '按 <kbd>P</kbd> 或点「拍照」进入拍照模式，可以换时辰、天气和滤镜，拍完直接存图。点「相机」挑一台相机戴上，拍出来就是那台相机的画质，还能录像。',
    phone: '点「拍照」进入拍照模式，可以换时辰、天气和滤镜。点「相机」挑一台相机戴上，还能录像。'},
  {seal: '物', title: '背包里的东西',
    pc: `点左上账号 → 我的背包，点物品旁的「使用」，回到城里它就在手上；按 <kbd>${k('useItem')}</kbd> 用它，<kbd>Esc</kbd> 收起。`,
    phone: '点左上账号 → 我的背包，点物品旁的「使用」，回到城里它就在手上。'},
  {seal: '时', title: '时辰与天气', only: 'free',
    pc: '左上角的时辰条可以切晨、午、昏、夜和晴、雾、雨，点 ▶ 让时间自己走。',
    phone: '左上角的时辰条可以切晨、午、昏、夜和晴、雾、雨。'},
  {seal: '设', title: '设置与改键',
    pc: `按 <kbd>${k('settings')}</kbd> 或点「设置」：改键、开关读数（<kbd>${k('stats')}</kbd>）、表情显示。左上「视野」调远处画多少，电脑卡就调小一点。`,
    phone: '点「设置」开关读数和表情显示。左上「视野」调远处画多少，手机发烫就调小一点。'},
]

const KEY_GROUPS = (): {title: string; rows: Row[]}[] => [
  {title: '步行', rows: rows('walk').concat([{keys: ['C'], label: '视距'}, {keys: ['J'], label: '景册'}, {keys: [k('useItem')], label: '使用手中物品'}])},
  {title: '飞行', rows: rows('fly'), },
  {title: '电驴', rows: rows('bike').concat([{keys: ['1', '2', '3', '4'], label: '直接选挡'}, {keys: ['0'], label: '驻车 P 挡'}, {keys: ['B'], label: '双闪'}, {keys: ['G'], label: '改装'}])},
  {title: '单车', rows: rows('bicycle')},
  {title: '汽车', rows: rows('car').concat([{keys: ['1', '2', '3'], label: '直接选模式'}])},
  {title: '船', rows: rows('boat')},
  {title: '界面', rows: [
    {keys: ['M'], label: '地图'}, {keys: ['J'], label: '景册'}, {keys: ['P'], label: '拍照'},
    {keys: [k('settings')], label: '设置'}, {keys: [k('stats')], label: '读数'}, {keys: ['Tab'], label: '手机（街头界面）'},
    {keys: ['F1'], label: '这份指南'}, {keys: ['Esc'], label: '关闭 / 菜单'},
  ]},
]

const TOUCH_ROWS: [string, string][] = [
  ['左下摇杆', '走路；推到底是跑'], ['右半屏滑动', '转视角'], ['双指捏合', '拉远拉近'],
  ['跃 / 蹲 / 远近', '跳、蹲、换视距'], ['叫车', '叫一辆共享电驴到身边'], ['上车 / 下车', '车旁边出现，点一下'],
  ['表情', '打开动作盘'], ['右上一排', '起飞、景册、拍照、相机、地图、设置'], ['左上「视野」', '画面远近与流畅度'],
]

let sheet: HTMLDivElement | undefined
type Tab = 'play' | 'keys'

export function openGuide(tab: Tab = 'play') {
  if (!sheet) {
    sheet = document.createElement('div')
    sheet.className = 'about-mask guide-mask'
    sheet.hidden = true
    sheet.innerHTML = `<div class="about-panel guide-sheet" role="dialog" aria-modal="true" aria-labelledby="guide-sheet-title">
      <header><h2 id="guide-sheet-title">玩法指南</h2>
        <nav class="guide-tabs" role="tablist"><button type="button" role="tab" data-tab="play">玩法</button><button type="button" role="tab" data-tab="keys"></button></nav>
        <button type="button" class="about-close">关闭</button></header>
      <div class="guide-body"></div>
      <div class="guide-foot"><button type="button" class="ui-btn guide-replay">重看新手引导</button></div>
    </div>`
    const close = () => { sheet!.hidden = true }
    sheet.querySelector('.about-close')!.addEventListener('click', close)
    sheet.addEventListener('click', event => { if (event.target === sheet) close() })
    addEventListener('keydown', event => { if (event.code === 'Escape' && !sheet!.hidden) { event.stopImmediatePropagation(); close() } }, true)
    sheet.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(button => button.onclick = () => renderSheet(button.dataset.tab as Tab))
    sheet.querySelector<HTMLButtonElement>('.guide-replay')!.onclick = () => { close(); void startTour(true) }
    document.body.append(sheet)
  }
  // 首页（还没进城）打开时没有 HUD 可以点亮，不给「重看新手引导」。
  sheet.querySelector<HTMLElement>('.guide-foot')!.hidden = document.body.hasAttribute('data-home') || !document.body.dataset.mode
  renderSheet(tab)
  sheet.hidden = false
  sheet.querySelector<HTMLButtonElement>('.about-close')!.focus()
}

function renderSheet(tab: Tab) {
  const phone = touch()
  sheet!.querySelector('[data-tab=keys]')!.textContent = phone ? '触屏操作' : '全部按键'
  sheet!.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(button => button.setAttribute('aria-selected', String(button.dataset.tab === tab)))
  const body = sheet!.querySelector<HTMLElement>('.guide-body')!
  const mode = document.body.dataset.mode ? solo() ? 'solo' : 'free' : undefined
  if (tab === 'play') {
    body.innerHTML = `<ul class="guide-features">${FEATURES().filter(f => !f.only || !mode || f.only === mode).map(f =>
      `<li><span class="ui-seal">${f.seal}</span><div><b>${f.title}</b><p>${phone ? f.phone : f.pc}</p></div></li>`).join('')}</ul>`
  } else if (phone) {
    body.innerHTML = `<dl class="guide-touch">${TOUCH_ROWS.map(([what, how]) => `<dt>${what}</dt><dd>${how}</dd>`).join('')}</dl>
      <p class="guide-note">接了蓝牙键盘也能用键盘玩，按键和电脑一样。</p>`
  } else {
    body.innerHTML = `<div class="guide-keygrid">${KEY_GROUPS().map(group => `<section><h3>${group.title}</h3><ul>${group.rows.filter(row => !mode || visible(row))
      .map(row => `<li><span class="keys-caps">${caps(row.keys)}</span><span>${row.label}</span></li>`).join('')}</ul></section>`).join('')}</div>
      <p class="guide-note">改过的键这里会跟着变；在「设置」里可以改键。</p>`
  }
  body.scrollTop = 0
}

// ─── 新手引导 ────────────────────────────────────────────────────────────────────────────────────
const TOUR_KEY = 'glol.tour.v1'
type Step = {target: () => Element | null; title: string; pc: string; phone?: string}

const shown = (el: Element | null) => {
  if (!el) return null
  const rect = el.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== 'hidden' ? el : null
}
const q = (selector: string) => () => shown(document.querySelector(selector))

function steps(): Step[] {
  const list: Step[] = [
    {target: () => touch() ? shown(document.querySelector('.walk-ui .joystick')) : shown(document.querySelector('.keys-card')),
      title: document.body.dataset.mode === 'walk' ? '先走两步' : '先飞一圈',
      pc: document.body.dataset.mode === 'walk'
        ? `${caps(move())} 走路，<kbd>${k('run')}</kbd> 跑，按住鼠标拖动转视角。常用按键都在这张卡上，上车后会自动换成车的按键。`
        : `${caps(move())} 飞，<kbd>Q</kbd> / <kbd>E</kbd> 降 / 升，按住鼠标拖动转方向。常用按键都在这张卡上。`,
      phone: '左下摇杆走路，推到底就是跑；右半边屏幕滑动转视角。'},
    {target: q('.gl-mission-entry'), title: '接活赚钱',
      pc: '点这里挑一单：送米粉、跑腿、拉客、跑夜赛。赚的钱能买衣服、买电驴、改装。'},
    {target: () => touch() ? shown(document.querySelector('.walk-ui .btn-hail')) : null, title: '骑上电驴',
      pc: '', phone: '走到路边的车旁边点「上车」；附近没车就点这里，叫一辆共享电驴过来。'},
    {target: () => touch() ? shown(document.querySelector('.emote-toggle')) : shown(document.querySelector('.keys-card:not(.folded) [data-id=emote]')) ?? shown(document.querySelector('.keys-card')), title: '做个表情',
      pc: `<b>长按</b> <kbd>${k('emote')}</kbd> 打开动作盘：点赞、奶蛙笑……移到想做的动作上松手。联机时别人也能看到。`,
      phone: '点这里打开动作盘：点赞、奶蛙笑……联机时别人也能看到。'},
    {target: q('.dock-map'), title: '地图',
      pc: '搜地名，或者点地图上任意一处，直接传送过去。快捷键 <kbd>M</kbd>。', phone: '搜地名，或者点地图上任意一处，直接传送过去。'},
    {target: q('.dock-book'), title: '景册',
      pc: '名胜附近地上有朱红色圆圈，走进去就盖一枚印章，集齐全城名胜。快捷键 <kbd>J</kbd>。',
      phone: '名胜附近地上有朱红色圆圈，走进去就盖一枚印章。'},
    {target: q('.dock-photo'), title: '拍照',
      pc: '换时辰、天气、滤镜，拍下来直接存图。旁边的「相机」可以挑相机、录像。快捷键 <kbd>P</kbd>。',
      phone: '换时辰、天气、滤镜，拍下来直接存图。旁边的「相机」可以挑相机、录像。'},
    {target: q('.btn-mode'), title: '飞上天',
      pc: '按 <kbd>V</kbd> 或点这里起飞，像无人机一样看山水；再按一次落地步行。',
      phone: '点这里起飞，像无人机一样看山水；再点一次落地步行。'},
    {target: q('.btn-guide'), title: '忘了怎么玩？',
      pc: '随时点这里，或按 <kbd>F1</kbd>，看全部玩法和按键。新手引导也能在里面重看。',
      phone: '随时点这里看全部玩法和触屏操作，新手引导也能在里面重看。'},
  ]
  return list.filter(step => (touch() ? step.phone ?? step.pc : step.pc) !== '')
}

let touring = false
export async function startTour(force = false) {
  if (touring || (!force && localStorage.getItem(TOUR_KEY))) return
  touring = true
  localStorage.setItem(TOUR_KEY, String(Date.now()))
  // 目标按好多是懒加载的：每一步现查，找不到就跳过；计数只算此刻能点亮的步。
  const list = steps()
  if (!list.some(step => step.target())) { touring = false; return }
  const root = document.createElement('div')
  root.className = 'coach'
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', '新手引导')
  root.innerHTML = `<div class="coach-hole"></div>
    <div class="coach-card" role="document"><span class="coach-count"></span><h3></h3><p></p>
      <div class="coach-actions"><button type="button" class="ui-btn ui-btn--ghost coach-skip">跳过</button><button type="button" class="ui-btn ui-btn--seal coach-next"></button></div></div>`
  document.body.append(root)
  const hole = root.querySelector<HTMLElement>('.coach-hole')!, box = root.querySelector<HTMLElement>('.coach-card')!
  const next = root.querySelector<HTMLButtonElement>('.coach-next')!
  let index = 0
  const finish = () => { root.classList.remove('in'); removeEventListener('keydown', onKey, true); removeEventListener('resize', place); setTimeout(() => root.remove(), 220); touring = false }
  const onKey = (event: KeyboardEvent) => {
    if (event.code === 'Escape') finish()
    else if (event.code === 'Enter' || event.code === 'Space' || event.code === 'ArrowRight') go(index + 1)
    else if (event.code === 'ArrowLeft') go(index - 1)
    else return
    event.preventDefault(); event.stopImmediatePropagation()
  }
  function place() {
    const el = list[index].target()
    if (!el) return
    const r = el.getBoundingClientRect(), pad = 8
    Object.assign(hole.style, {left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px`,
      borderRadius: r.width < 140 && Math.abs(r.width - r.height) < 24 ? '50%' : '18px'})
    // 卡片放在目标旁边空间最大的一侧，再夹进屏幕。
    const W = innerWidth, H = innerHeight, cw = Math.min(300, W - 24), ch = box.offsetHeight || 160, gap = 18
    const space = {right: W - r.right, left: r.left, below: H - r.bottom, above: r.top}
    let x: number, y: number
    if (space.right >= cw + gap * 2 || space.left >= cw + gap * 2) {
      x = space.right >= space.left ? r.right + gap + pad : r.left - cw - gap - pad
      y = r.top + r.height / 2 - ch / 2
    } else {
      x = r.left + r.width / 2 - cw / 2
      y = space.below >= space.above ? r.bottom + gap + pad : r.top - ch - gap - pad
    }
    box.style.width = `${cw}px`
    box.style.left = `${Math.max(12, Math.min(W - cw - 12, x))}px`
    box.style.top = `${Math.max(12, Math.min(H - ch - 12, y))}px`
  }
  function go(to: number) {
    const dir = to < index ? -1 : 1
    while (to >= 0 && to < list.length && !list[to].target()) to += dir
    if (to < 0) return
    if (to >= list.length) return finish()
    index = to
    const step = list[index]
    const live = list.filter((item, i) => i === index || item.target())
    box.querySelector('.coach-count')!.textContent = `${live.indexOf(step) + 1} / ${live.length}`
    box.querySelector('h3')!.textContent = step.title
    box.querySelector('p')!.innerHTML = touch() ? step.phone ?? step.pc : step.pc
    next.textContent = live.indexOf(step) === live.length - 1 ? '开始逛' : '下一步'
    box.classList.remove('swap'); void box.offsetWidth; box.classList.add('swap')
    place(); requestAnimationFrame(place)
  }
  next.onclick = () => go(index + 1)
  root.querySelector<HTMLButtonElement>('.coach-skip')!.onclick = finish
  addEventListener('keydown', onKey, true)
  addEventListener('resize', place)
  go(0)
  requestAnimationFrame(() => root.classList.add('in'))
  next.focus({preventScroll: true})
}

// ─── 挂载 ────────────────────────────────────────────────────────────────────────────────────────
/** 进城后调用一次：按键卡、左上「?」、F1 / ? 热键、首次进城的新手引导。 */
export function mountGuide(opts: {autoTour: boolean}) {
  mountCard()
  const help = document.createElement('button')
  help.type = 'button'; help.className = 'btn-guide'; help.textContent = '?'
  help.setAttribute('aria-label', '玩法指南'); help.title = '玩法指南（F1）'
  help.onclick = () => openGuide()
  const me = document.querySelector('.hud-me')
  if (me) me.append(help); else document.body.append(help)

  addEventListener('keydown', event => {
    if (event.repeat || isGlobalHotkeyBlocked(event.target)) return
    if (event.code === 'F1' || (event.code === 'Slash' && event.shiftKey)) { event.preventDefault(); openGuide(event.code === 'F1' ? 'play' : 'keys') }
  })

  renderCard()
  new MutationObserver(renderCard).observe(document.body, {attributes: true, attributeFilter: ['data-mode', 'data-aboard', 'data-ride']})
  onPrefs(renderCard)

  if (!opts.autoTour || localStorage.getItem(TOUR_KEY)) return
  // 等加载卡、传送遮罩、首页都退场，画面稳定 1.2 s 后再开始。
  // 右侧按钮（地图 / 景册 / 拍照）是懒加载的，等它们挂上再开始，最多等 20 s。
  let calm = 0
  const since = performance.now()
  const timer = setInterval(() => {
    const busy = document.querySelector('#boot,.ld-veil,.about-mask:not([hidden]),dialog[open]') || document.body.hasAttribute('data-home') || !document.body.dataset.mode
      || (!document.querySelector('.dock-map') && performance.now() - since < 20000)
    calm = busy ? 0 : calm + 1
    if (calm >= 3) { clearInterval(timer); void startTour() }
  }, 400)
}

