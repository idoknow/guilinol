import {
  formatDutyReportTitle,
  type LeaderboardEntry,
  type LeaderboardSummary,
  type ViolationBreakdown,
} from './types.ts'

export const TRAFFIC_DUTY_LEADERBOARD_KEY = 'glol.trafficDuty.leaderboard.v1'
export const TRAFFIC_DUTY_LEADERBOARD_CORRUPT_KEY = 'glol.trafficDuty.leaderboard.v1.corrupt'
export const MAX_LEADERBOARD_ENTRIES = 10

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem?(key: string): void
}

export interface TrafficDutyLeaderboardProvider {
  load(): LeaderboardSummary
  record(entry: Omit<LeaderboardEntry, 'id' | 'title'>): {
    summary: LeaderboardSummary
    rank: number | null
    isNewRecord: boolean
    entry: LeaderboardEntry
  }
  clear(): void
}

let testStorage: StorageLike | null = null

export function setLeaderboardStorageForTest(storage: StorageLike | null): void {
  testStorage = storage
}

function getStorage(): StorageLike | null {
  if (testStorage) return testStorage
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage
  } catch {
    return null
  }
  return null
}

function clampInt(value: unknown, min: number, max: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, Math.trunc(n)))
}

function sanitizeBreakdown(raw: unknown): ViolationBreakdown {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {
    no_helmet: clampInt(src.no_helmet, 0, 10000),
    bike_double: clampInt(src.bike_double, 0, 10000),
    ebike_overload: clampInt(src.ebike_overload, 0, 10000),
  }
}

function sanitizeEntry(raw: unknown, index: number): LeaderboardEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const totalFineYuan = clampInt(obj.totalFineYuan, 0, 9_999_999)
  const citedCount = clampInt(obj.citedCount, 0, 10000)
  const durationSec = clampInt(obj.durationSec, 1, 86400)
  const achievedAt = clampInt(obj.achievedAt, 0, 9_999_999_999_999)
  const rawName = typeof obj.playerName === 'string' ? obj.playerName.trim() : ''
  const playerName = (rawName || '桂林市民').slice(0, 24)
  const id = typeof obj.id === 'string' && obj.id ? obj.id.slice(0, 64) : `duty_${achievedAt}_${index}`
  return {
    id,
    playerName,
    totalFineYuan,
    citedCount,
    breakdown: sanitizeBreakdown(obj.breakdown),
    durationSec,
    completed: Boolean(obj.completed),
    title: formatDutyReportTitle(totalFineYuan),
    achievedAt,
  }
}

function sortEntries(entries: LeaderboardEntry[]): LeaderboardEntry[] {
  return [...entries].sort((a, b) => {
    if (b.totalFineYuan !== a.totalFineYuan) return b.totalFineYuan - a.totalFineYuan
    if (b.citedCount !== a.citedCount) return b.citedCount - a.citedCount
    return a.achievedAt - b.achievedAt
  })
}

function persistEntries(storage: StorageLike, entries: LeaderboardEntry[]): boolean {
  const payload = JSON.stringify({version: 1, entries})
  try {
    storage.setItem(TRAFFIC_DUTY_LEADERBOARD_KEY, payload)
    return true
  } catch {
    // Trim down to top 5 if localStorage quota is tight
    try {
      const compact = JSON.stringify({version: 1, entries: entries.slice(0, 5)})
      storage.setItem(TRAFFIC_DUTY_LEADERBOARD_KEY, compact)
      return true
    } catch {
      return false
    }
  }
}

export function loadLocalLeaderboard(): LeaderboardSummary {
  const storage = getStorage()
  if (!storage) return {entries: [], bestFineYuan: 0}
  let raw: string | null = null
  try {
    raw = storage.getItem(TRAFFIC_DUTY_LEADERBOARD_KEY)
  } catch {
    return {entries: [], bestFineYuan: 0}
  }
  if (!raw) return {entries: [], bestFineYuan: 0}
  try {
    const parsed = JSON.parse(raw) as unknown
    const list = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && Array.isArray((parsed as {entries?: unknown}).entries)
        ? (parsed as {entries: unknown[]}).entries
        : null
    if (!list) throw new Error('invalid leaderboard payload')
    const sanitized = sortEntries(
      list.map((item, idx) => sanitizeEntry(item, idx)).filter((item): item is LeaderboardEntry => item !== null),
    ).slice(0, MAX_LEADERBOARD_ENTRIES)
    return {
      entries: sanitized,
      bestFineYuan: sanitized[0]?.totalFineYuan ?? 0,
    }
  } catch {
    try {
      storage.setItem(TRAFFIC_DUTY_LEADERBOARD_CORRUPT_KEY, raw)
      storage.removeItem?.(TRAFFIC_DUTY_LEADERBOARD_KEY)
    } catch {
      // ignore backup failures in restricted storage
    }
    return {entries: [], bestFineYuan: 0}
  }
}

export function recordLocalLeaderboardEntry(
  input: Omit<LeaderboardEntry, 'id' | 'title'>,
): {
  summary: LeaderboardSummary
  rank: number | null
  isNewRecord: boolean
  entry: LeaderboardEntry
} {
  const current = loadLocalLeaderboard()
  const prevBest = current.bestFineYuan
  const entry = sanitizeEntry(
    {
      ...input,
      id: `td_${input.achievedAt}_${Math.random().toString(36).slice(2, 7)}`,
    },
    current.entries.length,
  )!
  const merged = sortEntries([...current.entries, entry]).slice(0, MAX_LEADERBOARD_ENTRIES)
  const storage = getStorage()
  if (storage) persistEntries(storage, merged)
  const idx = merged.findIndex(item => item.id === entry.id)
  return {
    summary: {
      entries: merged,
      bestFineYuan: merged[0]?.totalFineYuan ?? 0,
    },
    rank: idx >= 0 ? idx + 1 : null,
    isNewRecord: entry.totalFineYuan > 0 && entry.totalFineYuan > prevBest,
    entry,
  }
}

export function createLocalLeaderboardProvider(): TrafficDutyLeaderboardProvider {
  return {
    load: loadLocalLeaderboard,
    record: recordLocalLeaderboardEntry,
    clear() {
      const storage = getStorage()
      try {
        storage?.removeItem?.(TRAFFIC_DUTY_LEADERBOARD_KEY)
      } catch {
        // ignore
      }
    },
  }
}
