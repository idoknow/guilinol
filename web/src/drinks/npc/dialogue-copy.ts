import type { InteractionBubbleKind } from '../sim/types.ts'
import type { DrinksNpcSkinConfig } from './types.ts'

export interface DialogueCopySpec {
  readonly kind: InteractionBubbleKind
  readonly templates: readonly string[]
  readonly accent: string
  readonly bg: string
  readonly priority: number
}

export const DRINKS_DIALOGUE_COPY: Readonly<Record<InteractionBubbleKind, DialogueCopySpec>> = {
  clerk_greet_player: {
    kind: 'clerk_greet_player',
    templates: ['欢迎光临！', '{brand}欢迎您'],
    accent: '#fbbf24',
    bg: 'rgba(28, 22, 16, 0.92)',
    priority: 100,
  },
  remind_cut_in: {
    kind: 'remind_cut_in',
    templates: ['请按序排队', '队尾在后面'],
    accent: '#fb923c',
    bg: 'rgba(34, 20, 14, 0.92)',
    priority: 98,
  },
  queue_yield_player: {
    kind: 'queue_yield_player',
    templates: ['您先请', '借让一下'],
    accent: '#38bdf8',
    bg: 'rgba(18, 26, 34, 0.90)',
    priority: 94,
  },
  handover_cup: {
    kind: 'handover_cup',
    templates: ['请拿好！', '{var}好啦'],
    accent: '#34d399',
    bg: 'rgba(16, 28, 22, 0.92)',
    priority: 92,
  },
  receive_cup: {
    kind: 'receive_cup',
    templates: ['谢谢！', '收到好喝'],
    accent: '#34d399',
    bg: 'rgba(16, 28, 22, 0.90)',
    priority: 90,
  },
  call_number: {
    kind: 'call_number',
    templates: ['叫号 {var}', '{var}请取餐'],
    accent: '#ffc53d',
    bg: 'rgba(32, 24, 14, 0.92)',
    priority: 88,
  },
  look_up_called: {
    kind: 'look_up_called',
    templates: ['叫我了！', '来取餐啦'],
    accent: '#20d6c1',
    bg: 'rgba(16, 28, 28, 0.90)',
    priority: 86,
  },
  complain_leave: {
    kind: 'complain_leave',
    templates: ['等太久走了', '排太长啦'],
    accent: '#ef4444',
    bg: 'rgba(38, 16, 18, 0.92)',
    priority: 91,
  },
  order_ask: {
    kind: 'order_ask',
    templates: ['喝点啥？', '今天推荐柠檬'],
    accent: '#f59e0b',
    bg: 'rgba(22, 24, 30, 0.90)',
    priority: 82,
  },
  order_reply: {
    kind: 'order_reply',
    templates: ['来杯{var}', '少冰七分糖'],
    accent: '#fbbf24',
    bg: 'rgba(22, 24, 30, 0.90)',
    priority: 81,
  },
  make_change: {
    kind: 'make_change',
    templates: ['找您 {var}', '扫码成功'],
    accent: '#fde047',
    bg: 'rgba(24, 24, 18, 0.90)',
    priority: 80,
  },
  receive_change: {
    kind: 'receive_change',
    templates: ['收好零钱', '谢谢老板'],
    accent: '#fde047',
    bg: 'rgba(24, 24, 18, 0.88)',
    priority: 76,
  },
  urge_order: {
    kind: 'urge_order',
    templates: ['快好了吗？', '还有几杯'],
    accent: '#f97316',
    bg: 'rgba(34, 20, 14, 0.90)',
    priority: 78,
  },
  clerk_reassure: {
    kind: 'clerk_reassure',
    templates: ['马上出杯', '正在制作'],
    accent: '#20d6c1',
    bg: 'rgba(18, 26, 28, 0.88)',
    priority: 74,
  },
  chat_pair_a: {
    kind: 'chat_pair_a',
    templates: ['好喝不贵！', '人好多呀'],
    accent: '#f472b6',
    bg: 'rgba(28, 20, 26, 0.88)',
    priority: 72,
  },
  chat_pair_b: {
    kind: 'chat_pair_b',
    templates: ['等下一起走', '今天超热闹'],
    accent: '#f472b6',
    bg: 'rgba(28, 20, 26, 0.88)',
    priority: 71,
  },
  take_photo: {
    kind: 'take_photo',
    templates: ['拍照打卡', '真出片！'],
    accent: '#a78bfa',
    bg: 'rgba(24, 20, 34, 0.88)',
    priority: 70,
  },
  claim_seat: {
    kind: 'claim_seat',
    templates: ['这有空座', '我先占座'],
    accent: '#60a5fa',
    bg: 'rgba(18, 24, 34, 0.86)',
    priority: 64,
  },
  clean_table: {
    kind: 'clean_table',
    templates: ['我来收桌', '清理桌面'],
    accent: '#38bdf8',
    bg: 'rgba(18, 26, 34, 0.88)',
    priority: 68,
  },
  yield_way: {
    kind: 'yield_way',
    templates: ['借过一下', '您先走'],
    accent: '#cbd5e1',
    bg: 'rgba(20, 24, 30, 0.84)',
    priority: 52,
  },
  restock: {
    kind: 'restock',
    templates: ['巡台补料', '加满冰块'],
    accent: '#38bdf8',
    bg: 'rgba(18, 26, 34, 0.86)',
    priority: 48,
  },
  making: {
    kind: 'making',
    templates: ['制茶中', '摇匀封杯'],
    accent: '#20d6c1',
    bg: 'rgba(18, 26, 28, 0.84)',
    priority: 40,
  },
}

function clampShortBubble(text: string): string {
  const clean = text.trim()
  return clean.length > 8 ? clean.slice(0, 8) : clean
}

export interface ResolvedBadgeVisual {
  key: string
  text: string
  accent: string
  bg: string
  priority: number
}

export function resolveInteractionBadge(
  kind: InteractionBubbleKind | null,
  skin: DrinksNpcSkinConfig,
  textVar: string | null,
  variantIndex = 0,
): ResolvedBadgeVisual | null {
  if (!kind) return null
  const spec = DRINKS_DIALOGUE_COPY[kind]
  const overrideList = skin.dialogueOverrides?.[kind]
  const pool = overrideList && overrideList.length > 0 ? overrideList : spec.templates
  const tpl =
    kind === 'clerk_greet_player' && skin.greetingLine
      ? skin.greetingLine
      : pool[Math.abs(variantIndex) % pool.length] ?? pool[0]!

  const brandShort = skin.shopBrandName.slice(0, 4)
  const varStr = (textVar ?? '').trim().slice(0, 5)
  const text = clampShortBubble(
    tpl
      .replace(/\{brand\}/g, brandShort)
      .replace(/\{var\}/g, varStr || ''),
  )
  return {
    key: `${kind}:${text}`,
    text,
    accent: spec.accent,
    bg: spec.bg,
    priority: spec.priority,
  }
}
