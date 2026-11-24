import type { ClerkState, CustomerPhase, CustomerRoleKind } from '../sim/types.ts'
import type { DrinksNpcSkinConfig } from './types.ts'

export const DEFAULT_DRINKS_NPC_SKIN: DrinksNpcSkinConfig = {
  shopBrandName: '王城鲜饮旗舰店',
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

export interface BadgeVisual {
  key: string
  text: string
  accent: string
  bg: string
}

export function getClerkBadgeVisual(state: ClerkState, actionLabel: string): BadgeVisual | null {
  switch (state) {
    case 'taking_order':
      return { key: 'clerk:order', text: '点单', accent: '#f59e0b', bg: 'rgba(20, 24, 30, 0.88)' }
    case 'making':
      return { key: 'clerk:make', text: '制茶', accent: '#20d6c1', bg: 'rgba(20, 24, 30, 0.88)' }
    case 'calling':
      return { key: `clerk:call:${actionLabel}`, text: actionLabel.slice(0, 7) || '叫号', accent: '#ffc53d', bg: 'rgba(30, 24, 16, 0.92)' }
    case 'restocking':
      return { key: 'clerk:restock', text: '补料', accent: '#38bdf8', bg: 'rgba(20, 24, 30, 0.88)' }
    default:
      return null
  }
}

export function getCustomerBadgeVisual(
  phase: CustomerPhase,
  roleKind: CustomerRoleKind,
  angry: boolean,
  patienceRatio: number,
): BadgeVisual | null {
  if (angry) {
    return { key: 'cust:angry', text: '太挤了', accent: '#ef4444', bg: 'rgba(36, 16, 18, 0.88)' }
  }
  switch (phase) {
    case 'ordering':
      return { key: 'cust:ordering', text: '点单中', accent: '#ffc53d', bg: 'rgba(22, 24, 28, 0.86)' }
    case 'picking_up':
      return { key: 'cust:pickup', text: '取餐', accent: '#34d399', bg: 'rgba(18, 28, 24, 0.88)' }
    case 'queuing':
      if (patienceRatio < 0.35) {
        return { key: 'cust:rush', text: '等急了', accent: '#f97316', bg: 'rgba(32, 20, 14, 0.88)' }
      }
      if (roleKind === 'rider') {
        return { key: 'cust:rider', text: '骑手', accent: '#38bdf8', bg: 'rgba(20, 24, 30, 0.84)' }
      }
      return null
    default:
      return null
  }
}
