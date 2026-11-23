/**
 * 身份证独立页面（微信扫码打开的就是这个）
 *
 * URL: /id.html?id=45032620261123729166
 *
 * · 先按卡号去后台查市民档案（GET /api/citizen?id=），拿不到就用本机档案 / 兜底
 * · 直接把横版身份证铺满屏幕；手机竖屏时整体旋转 90°
 */
import {idNumberFor, renderIdCardCanvas} from './ui/idcard'

const params = new URLSearchParams(location.search)
const wanted = (params.get('id') ?? '').replace(/\D/g, '')

interface Citizen {
  uid: string
  name: string
  registeredAt?: number
  createdAt?: number
}

function localCitizen(): Citizen | null {
  try {
    const raw = JSON.parse(localStorage.getItem('guiling.civic.v1') ?? 'null')
    if (raw && typeof raw.uid === 'string' && typeof raw.name === 'string') return raw
  } catch {
    /* 忽略 */
  }
  return null
}

async function lookupCitizen(id: string): Promise<Citizen | null> {
  try {
    const response = await fetch(`/api/citizen?id=${encodeURIComponent(id)}`, {cache: 'no-cache'})
    if (response.ok) {
      const body = (await response.json()) as {citizen?: Citizen}
      if (body.citizen && body.citizen.uid && body.citizen.name) return body.citizen
    }
  } catch {
    /* 没有接口就用本机 */
  }
  return null
}

function fitOrientation() {
  // 竖屏手机：旋转卡片，让横版身份证铺满
  document.body.classList.toggle('rotate', window.innerHeight > window.innerWidth * 0.9)
}

async function main() {
  fitOrientation()
  window.addEventListener('resize', fitOrientation)
  window.addEventListener('orientationchange', () => setTimeout(fitOrientation, 220))

  const status = document.getElementById('status')!
  const stage = document.getElementById('card-stage')!

  // 关键：URL 指定了卡号时，绝不能回退到本机档案（那会显示扫码者自己的卡）
  let citizen: Citizen | null = wanted ? await lookupCitizen(wanted) : localCitizen()

  // 卡号对不上（扫到别人的卡，且后台没有接口）→ 用卡号造一个只读档案
  if (!citizen) {
    if (!wanted) {
      status.textContent = '链接里没有身份证号'
      return
    }
    const stamp = wanted.slice(6, 14)
    citizen = {
      uid: wanted.slice(-8) || '00000000',
      name: '市民',
      registeredAt: new Date(
        Number(stamp.slice(0, 4)),
        Number(stamp.slice(4, 6)) - 1,
        Number(stamp.slice(6, 8)),
      ).getTime(),
    }
  }

  // 卡号以 URL 里的为准，保证扫出来的号就是展示的号
  const info = idNumberFor(citizen)
  if (wanted && info.number !== wanted) {
    citizen = {...citizen, uid: wanted.slice(-8)}
  }

  // 别人的卡：卡号以 URL 为准，姓名未知时性别显示「—」（不能取本机头像的性别）
  const unknown = citizen.name === '市民'
  // 先试服务器上存的照片；没有就用数据库里的外形现渲染一张（不再用那颗手绘圆脸）
  let photoData: string | undefined
  const avatar = (citizen as {avatar?: unknown}).avatar
  if (avatar && !(citizen as {photo?: string | null}).photo) {
    try {
      status.textContent = '正在生成角色头像…'
      const module = await import('./ui/portrait')
      photoData = (await module.characterPortraitFor(avatar)) ?? undefined
    } catch {
      photoData = undefined
    }
  }
  const canvas = await renderIdCardCanvas(citizen, {
    number: wanted || undefined,
    gender: unknown ? '—' : undefined,
    photoUrl: (citizen as {photo?: string | null}).photo ?? undefined,
    photoData,
  })
  stage.replaceChildren(canvas)
  status.hidden = true
}

void main()
