import type { AchievementDef, MifenRecipe } from '../types.ts'
import type { MifenSaveState } from '../state.ts'

export const DEFAULT_ACHIEVEMENTS: readonly AchievementDef[] = [
  { id: 'ach_first_rush', name: '早市开门红', metric: 'totalBowlsServed', target: 12, rewardFunds: 12, unlocksRecipeId: 'sanxian_mifen' },
  { id: 'ach_combo_master', name: '粉票连击手', metric: 'streak', target: 5, rewardFunds: 15 },
  { id: 'ach_delivery_pro', name: '汤卤分离达人', metric: 'totalDeliveries', target: 6, rewardFunds: 18, unlocksRecipeId: 'brisket_lucai' },
  { id: 'ach_retail_craft', name: '老卤外带口碑', metric: 'totalRetailSold', target: 8, rewardFunds: 16 },
  { id: 'ach_reputation_star', name: '三多路必吃老店', metric: 'reputation', target: 4.7, rewardFunds: 25, unlocksRecipeId: 'you_cha_combo' },
  { id: 'ach_three_streams', name: '三线齐飞', metric: 'threeStreamsDay', target: 1, rewardFunds: 20 },
  { id: 'ach_flagship_store', name: '旗舰总店开业', metric: 'shopLevel', target: 3, rewardFunds: 30 },
]

export function resolveAchievements(defs?: readonly AchievementDef[]): readonly AchievementDef[] {
  return defs && defs.length > 0 ? defs : DEFAULT_ACHIEVEMENTS
}

export function readAchievementMetric(state: Readonly<MifenSaveState>, metric: AchievementDef['metric']): number {
  switch (metric) {
    case 'totalBowlsServed':
      return state.totalBowlsServed
    case 'perfectBowls':
      return state.perfectBowls
    case 'streak':
      return state.streak
    case 'totalDeliveries':
      return state.totalDeliveries
    case 'totalRetailSold':
      return state.totalRetailSold
    case 'reputation':
      return state.reputation
    case 'shopLevel':
      return state.shopLevel
    case 'dailyNetPeak':
      return state.dailyNetPeak
    case 'threeStreamsDay':
      return state.threeStreamsDays
  }
}

export interface AchievementEvalResult {
  newlyUnlocked: AchievementDef[]
  unlockedRecipeIds: string[]
  totalRewardFunds: number
}

/**
 * 纯函数评估当前经营进度新达成的成就与解锁的新粉品。
 */
export function evaluateAchievements(
  state: Readonly<MifenSaveState>,
  defs?: readonly AchievementDef[],
): AchievementEvalResult {
  const list = resolveAchievements(defs)
  const owned = new Set(state.unlockedAchievements)
  const alreadyRecipes = new Set(state.unlockedRecipes)
  const newlyUnlocked: AchievementDef[] = []
  const unlockedRecipeIds: string[] = []
  let totalRewardFunds = 0

  for (const def of list) {
    if (owned.has(def.id)) continue
    const val = readAchievementMetric(state, def.metric)
    if (val + 1e-6 >= def.target) {
      newlyUnlocked.push(def)
      totalRewardFunds += def.rewardFunds
      if (def.unlocksRecipeId && !alreadyRecipes.has(def.unlocksRecipeId)) {
        unlockedRecipeIds.push(def.unlocksRecipeId)
      }
    }
  }

  return { newlyUnlocked, unlockedRecipeIds, totalRewardFunds }
}

export function isRecipeUnlocked(recipe: MifenRecipe, unlockedRecipeIds: readonly string[]): boolean {
  if (!recipe.unlockAchievementId) return true
  return unlockedRecipeIds.includes(recipe.id)
}

export function getAvailableRecipes(
  recipes: readonly MifenRecipe[],
  unlockedRecipeIds: readonly string[],
): MifenRecipe[] {
  return recipes.filter(r => isRecipeUnlocked(r, unlockedRecipeIds))
}
