export const AVATAR_KEY = 'glol.avatar.v1'
export const hairStyles = {
  m: ['m_buzz', 'm_crop', 'm_perm', 'm_fade', 'm_mullet', 'm_part'],
  f: ['f_long', 'f_pony', 'f_bun', 'f_lob', 'f_wolf', 'f_bangs'],
} as const
export const looks = ['basic', 'sport', 'outdoor', 'chinese', 'office', 'campus'] as const
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
    skin: 1,
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
    skin: index(a.skin, 5, 1),
    face: index(a.face, 3),
    brows: index(a.brows, 3),
    eyes: index(a.eyes, 3),
    hairColor: index(a.hairColor, 4),
    hair: hairStyles[a.body].find((h) => h === a.hair) ?? hairStyles[a.body][0],
    look: looks.find((l) => l === a.look) ?? 'basic',
  }
}

export const lookNames = ['基础', '运动休闲', '城市户外', '新中式', '通勤知识风', '校园']
export const lookPalette = [
  ['#e9e7e1', '#2a2c30', '#f2f1ed', '#d8d5cd'],
  ['#a7a8a5', '#34363a', '#ecebe5', '#e4e2d9'],
  ['#738370', '#938771', '#625c50', '#b3b39b'],
  ['#e0d7c5', '#586967', '#f5f0e6', '#887963'],
  ['#777265', '#5c5c59', '#74675b', '#e9e6dc'],
  ['#e8e8df', '#97afc0', '#faf6e9', '#a4b2bc'],
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
