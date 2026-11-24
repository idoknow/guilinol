export const AVATAR_KEY = 'glol.avatar.v1'
export const hairStyles = {
  m: ['m_buzz', 'm_crop', 'm_perm', 'm_fade', 'm_mullet', 'm_part'],
  f: ['f_long', 'f_pony', 'f_bun', 'f_lob', 'f_wolf', 'f_bangs'],
} as const
// IDOK-229: +6 present-day looks (城市户外冲锋衣、卫衣工装、牛仔外套、叠穿衬衫、针织开衫、运动套装).
export const looks = [
  'basic', 'sport', 'outdoor', 'chinese', 'office', 'campus',
  'hoodie', 'shell', 'denim', 'plaid', 'knit', 'track',
] as const
export const faceNames = ['圆脸', '鹅蛋脸', '方下颌', '瓜子脸', '长脸', '宽颧脸']
export const browNames = ['平直眉', '舒展眉', '微挑眉', '剑眉']
export const eyeNames = ['细长眼', '杏仁眼', '内双眼', '圆眼']
export const skinTones = ['#f3d7bf', '#e9c3a1', '#dcb08a', '#c99772', '#a97b58']
export const hairColors = ['#1b1a1a', '#2e2219', '#4a3022', '#5a4b44']

export interface Avatar {
  v: 1
  body: keyof typeof hairStyles
  skin: number
  face: number
  brows: number
  eyes: number
  hair: (typeof hairStyles)[keyof typeof hairStyles][number]
  hairColor: number
  look: (typeof looks)[number]
  createdAt: number
}
export function defaultAvatar(createdAt = Date.now()): Avatar {
  return {
    v: 1,
    body: 'm',
    skin: 2,
    face: 0,
    brows: 0,
    eyes: 0,
    hair: 'm_buzz',
    hairColor: 0,
    look: 'basic',
    createdAt,
  }
}

export function sanitizeAvatar(raw: unknown): Avatar | undefined {
  if (!raw || typeof raw !== 'object') return
  const a = raw as Partial<Avatar>
  if (a.v !== 1 || !(a.body === 'm' || a.body === 'f') || !Number.isSafeInteger(a.createdAt) || !(a.createdAt! > 0))
    return
  const index = (n: unknown, count: number, fallback = 0) =>
    typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < count ? n : fallback
  return {
    v: 1,
    body: a.body,
    createdAt: a.createdAt!,
    skin: index(a.skin, 5, 2),
    face: index(a.face, faceNames.length),
    brows: index(a.brows, browNames.length),
    eyes: index(a.eyes, eyeNames.length),
    hairColor: index(a.hairColor, 4),
    hair: hairStyles[a.body].find((h) => h === a.hair) ?? hairStyles[a.body][0],
    look: looks.find((l) => l === a.look) ?? 'basic',
  }
}

export const lookNames = ['基础', '夏天街头', '短袖 T 恤', '防晒衣', '通勤', '校服', '卫衣工装', '城市冲锋衣', '牛仔外套', '叠穿衬衫', '针织开衫', '运动套装']
export const lookPalette = [
  ['#e9e7e1', '#2a2c30', '#f2f1ed', '#d8d5cd'],
  ['#eeeae0', '#50545a', '#696961', '#c7bda7'],
  ['#728795', '#a89a7d', '#deded7', '#697b81'],
  ['#a5bfce', '#44484c', '#f5f0e6', '#cbd4d4'],
  ['#acb8a7', '#575859', '#393936', '#818d7d'],
  ['#e6e6df', '#536e90', '#faf6e9', '#546f93'],
  // top, bottom, shoes, accent (accent = inner tee / stripe / yoke colour, see web/src/walk/outfits.ts)
  ['#9b9d99', '#66654f', '#efece4', '#7e807c'],
  ['#3f5a4c', '#4a4d50', '#8c8170', '#262b2e'],
  ['#6f8fae', '#26282c', '#f2f1ed', '#f1efe9'],
  ['#9a3f35', '#b8aa8a', '#e6e0d1', '#2b2727'],
  ['#d8cab0', '#4d6a8c', '#3b302a', '#f3f0e8'],
  ['#28344a', '#28344a', '#f2f1ed', '#eeede6'],
]
export const hairNames = {
  m: ['寸头', '微分碎盖', '纹理烫', '渐变短发', '狼尾', '中分'],
  f: ['长直发', '高马尾', '低丸子头', '锁骨发', '短狼尾', '齐刘海短发'],
}

export function starterOutfit(look: Avatar['look']) {
  const basic = look === 'basic'
  return {
    top: basic ? 'top_default_tee' : 'top_starter_' + look,
    bottom: basic ? 'bottom_default_pants' : 'bottom_starter_' + look,
    shoes: basic ? 'shoes_default_sneaker' : 'shoes_starter_' + look,
    hat: 'hat_none',
    bag: 'bag_none',
  }
}
