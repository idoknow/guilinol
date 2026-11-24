/**
 * 田源米粉表叔 NPC 角色立绘/头像资源表（GTA 动漫游戏风，5 种表情）。
 * 与 `web/public/mifen/story/uncle-*.png` 一一对应，兼容 dev 与 vite build 产物路径。
 */
export type UncleExpressionId = 'neutral' | 'smile' | 'worry' | 'proud' | 'laugh'

export const UNCLE_EXPRESSION_IDS: readonly UncleExpressionId[] = [
  'neutral',
  'smile',
  'worry',
  'proud',
  'laugh',
]

export const UNCLE_PORTRAITS: Readonly<Record<UncleExpressionId, string>> = {
  neutral: new URL('../../../../public/mifen/story/uncle-neutral.png', import.meta.url).href,
  smile: new URL('../../../../public/mifen/story/uncle-smile.png', import.meta.url).href,
  worry: new URL('../../../../public/mifen/story/uncle-worry.png', import.meta.url).href,
  proud: new URL('../../../../public/mifen/story/uncle-proud.png', import.meta.url).href,
  laugh: new URL('../../../../public/mifen/story/uncle-laugh.png', import.meta.url).href,
}

/** 玩家主角剪影头像（暗青绿圆晕底 + 硬朗浅米金边缘轮廓，适配对话演出框） */
export const PLAYER_PORTRAIT: string =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">' +
      '<rect width="128" height="128" fill="#132220"/>' +
      '<circle cx="64" cy="60" r="50" fill="#1b302c"/>' +
      '<circle cx="64" cy="60" r="38" fill="#213a35"/>' +
      '<path d="M22 128 C25 101 42 91 53 88 L55 77 C48 72 45 64 45 55 C41 53 41 44 45 43 C44 26 57 18 70 21 C82 23 87 34 85 45 C89 47 88 56 84 57 C83 66 79 73 73 77 L75 88 C86 91 103 101 106 128 Z" fill="#0d1715" stroke="#e4d6ba" stroke-width="2.2" stroke-linejoin="round"/>' +
      '<path d="M47 40 C51 28 65 24 77 29 C81 31 83 36 83 41 C75 36 58 35 47 40 Z" fill="#172825"/>' +
      '<path d="M49 92 L64 103 L79 92" fill="none" stroke="#c8b08a" stroke-width="1.6" stroke-linecap="round" opacity="0.72"/>' +
    '</svg>',
  )

export function getUnclePortraitUrl(expression: string = 'neutral'): string {
  const key = (expression in UNCLE_PORTRAITS ? expression : 'neutral') as UncleExpressionId
  return UNCLE_PORTRAITS[key]
}
