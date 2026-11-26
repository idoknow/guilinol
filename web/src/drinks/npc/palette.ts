import { resolveInteractionBadge, type ResolvedBadgeVisual } from './dialogue-copy.ts'
import type { DrinksNpcSkinConfig } from './types.ts'
import type { InteractionBubbleKind } from '../sim/types.ts'

export const DEFAULT_DRINKS_NPC_SKIN: DrinksNpcSkinConfig = {
  shopBrandName: '蜜雪林城旗舰店',
  clerkShirtColor: '#f6f3eb',
  clerkApronColor: '#d93d35',
  clerkCapColor: '#d93d35',
  clerkPantsColor: '#252a31',
  cupBrandBandColor: '#d93d35',
}

export function resolveDrinksNpcSkin(patch?: Partial<DrinksNpcSkinConfig>): DrinksNpcSkinConfig {
  if (!patch) return { ...DEFAULT_DRINKS_NPC_SKIN }
  return {
    ...DEFAULT_DRINKS_NPC_SKIN,
    ...patch,
  }
}

export type BadgeVisual = ResolvedBadgeVisual

export function getInteractionBadgeVisual(
  kind: InteractionBubbleKind | null,
  skin: DrinksNpcSkinConfig,
  textVar: string | null,
  variantIndex = 0,
): BadgeVisual | null {
  return resolveInteractionBadge(kind, skin, textVar, variantIndex)
}
