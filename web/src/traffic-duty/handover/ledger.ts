import type {Actor} from '../../traffic/sim.ts'
import {isActiveViolation, VIOLATION_LABELS, type ActiveViolation} from '../types.ts'
import {
  DUPLICATE_CITATION_MESSAGE,
  type CitationNetSyncPayload,
  type CitationRecord,
  type FineLineItem,
  type SerializedCitationLedger,
} from './types.ts'

export interface CiteCheckResult {
  readonly allowed: boolean
  readonly vehicleKey: string
  readonly reason?: 'already_cited'
  readonly message?: string
  readonly existingRecord?: CitationRecord
}

export interface CitationLedger {
  deriveVehicleKey(actor?: Partial<Actor> | null, explicitKey?: string, plateNo?: string): string
  checkCanCite(actor?: Partial<Actor> | null, explicitKey?: string, plateNo?: string): CiteCheckResult
  hasCited(actorOrKey: Partial<Actor> | string | null | undefined, plateNo?: string): boolean
  record(entry: CitationRecord, actor?: Actor | null): CitationRecord
  getRecord(actorOrKey: Partial<Actor> | string | null | undefined, plateNo?: string): CitationRecord | null
  getAllRecords(): CitationRecord[]
  size(): number
  toJSON(): SerializedCitationLedger
  serialize(): string
  restore(payload: string | SerializedCitationLedger): number
  exportNetSyncPayload(senderId?: string): CitationNetSyncPayload
  serializeNetSync(senderId?: string): string
  mergeNetSyncPayload(payload: string | CitationNetSyncPayload): number
  clear(): void
}

const actorKeyCache = new WeakMap<object, string>()
let fallbackActorSeq = 1

function normalizeKey(raw: string | undefined | null): string {
  return (raw ?? '').trim()
}

function isValidViolation(v: unknown): v is ActiveViolation {
  return isActiveViolation(v)
}

export function createCitationLedger(): CitationLedger {
  const byVehicleKey = new Map<string, CitationRecord>()
  const byPlateNo = new Map<string, CitationRecord>()
  const citedActors = new WeakMap<object, CitationRecord>()
  let netSeq = 0

  function deriveVehicleKey(actor?: Partial<Actor> | null, explicitKey?: string, plateNo?: string): string {
    const cleanExplicit = normalizeKey(explicitKey)
    if (cleanExplicit) {
      if (actor && typeof actor === 'object') actorKeyCache.set(actor, cleanExplicit)
      return cleanExplicit
    }
    if (actor && typeof actor === 'object') {
      const tagged =
        (actor as {citationKey?: string; netVehicleId?: string}).citationKey ??
        (actor as {netVehicleId?: string}).netVehicleId
      if (tagged && tagged.trim()) {
        const k = tagged.trim()
        actorKeyCache.set(actor, k)
        return k
      }
      const cached = actorKeyCache.get(actor)
      if (cached) return cached
      const cleanPlate = normalizeKey(plateNo)
      if (cleanPlate) {
        const keyFromPlate = `veh:${cleanPlate}`
        actorKeyCache.set(actor, keyFromPlate)
        return keyFromPlate
      }
      const generated = `veh_local_${fallbackActorSeq++}`
      actorKeyCache.set(actor, generated)
      return generated
    }
    const cleanPlate = normalizeKey(plateNo)
    if (cleanPlate) return `veh:${cleanPlate}`
    return `veh_anon_${fallbackActorSeq++}`
  }

  function getRecord(actorOrKey: Partial<Actor> | string | null | undefined, plateNo?: string): CitationRecord | null {
    if (typeof actorOrKey === 'string') {
      const k = normalizeKey(actorOrKey)
      if (k && byVehicleKey.has(k)) return byVehicleKey.get(k)!
      if (k && byPlateNo.has(k)) return byPlateNo.get(k)!
    } else if (actorOrKey && typeof actorOrKey === 'object') {
      const direct = citedActors.get(actorOrKey)
      if (direct) return direct
      const tagged =
        (actorOrKey as {citationKey?: string; netVehicleId?: string}).citationKey ??
        (actorOrKey as {netVehicleId?: string}).netVehicleId ??
        actorKeyCache.get(actorOrKey)
      if (tagged && byVehicleKey.has(tagged)) return byVehicleKey.get(tagged)!
    }
    const cleanPlate = normalizeKey(plateNo)
    if (cleanPlate) {
      if (byPlateNo.has(cleanPlate)) return byPlateNo.get(cleanPlate)!
      if (byVehicleKey.has(`veh:${cleanPlate}`)) return byVehicleKey.get(`veh:${cleanPlate}`)!
    }
    return null
  }

  function hasCited(actorOrKey: Partial<Actor> | string | null | undefined, plateNo?: string): boolean {
    if (actorOrKey && typeof actorOrKey === 'object' && Boolean((actorOrKey as Partial<Actor>).cited)) {
      return true
    }
    return getRecord(actorOrKey, plateNo) !== null
  }

  function checkCanCite(actor?: Partial<Actor> | null, explicitKey?: string, plateNo?: string): CiteCheckResult {
    const vehicleKey = deriveVehicleKey(actor, explicitKey, plateNo)
    const existing =
      (actor ? getRecord(actor, plateNo) : null) ??
      getRecord(vehicleKey, plateNo)
    if (existing || Boolean(actor?.cited)) {
      return {
        allowed: false,
        vehicleKey,
        reason: 'already_cited',
        message: DUPLICATE_CITATION_MESSAGE,
        ...(existing ? {existingRecord: existing} : {}),
      }
    }
    return {allowed: true, vehicleKey}
  }

  function record(entry: CitationRecord, actor?: Actor | null): CitationRecord {
    const cleanViolations = Array.isArray(entry.violations)
      ? entry.violations.filter(isValidViolation)
      : [entry.violation]
    const cleanLineItems: readonly FineLineItem[] | undefined = Array.isArray(entry.lineItems)
      ? entry.lineItems.flatMap(it => {
          const v = it?.violation
          if (!isValidViolation(v)) return []
          return [
            Object.freeze({
              violation: v,
              label: String(it.label || VIOLATION_LABELS[v]),
              fineYuan: Math.max(0, Math.round(Number(it.fineYuan) || 0)),
            }),
          ]
        })
      : undefined

    const frozen: CitationRecord = Object.freeze({
      ticketId: String(entry.ticketId).trim(),
      vehicleKey: String(entry.vehicleKey).trim(),
      plateNo: String(entry.plateNo).trim(),
      violation: entry.violation,
      violations: Object.freeze(cleanViolations.length ? cleanViolations : [entry.violation]),
      violationLabel: entry.violationLabel || cleanViolations.map(v => VIOLATION_LABELS[v]).join(' + ') || VIOLATION_LABELS[entry.violation],
      ...(cleanLineItems ? {lineItems: Object.freeze(cleanLineItems)} : {}),
      fineYuan: Math.max(0, Math.round(entry.fineYuan)),
      officerBadgeId: String(entry.officerBadgeId).trim(),
      qrPayload: String(entry.qrPayload).trim(),
      zoneName: String(entry.zoneName).trim() || '解放桥',
      note: String(entry.note ?? '').trim(),
      issuedAtMs: Number.isFinite(entry.issuedAtMs) ? entry.issuedAtMs : Date.now(),
      heldInHand: entry.heldInHand !== false,
      ...(entry.handedSide === 'left' || entry.handedSide === 'right' ? {handedSide: entry.handedSide} : {}),
    })
    byVehicleKey.set(frozen.vehicleKey, frozen)
    if (frozen.plateNo) {
      byPlateNo.set(frozen.plateNo, frozen)
    }
    if (actor && typeof actor === 'object') {
      actorKeyCache.set(actor, frozen.vehicleKey)
      citedActors.set(actor, frozen)
      actor.cited = true
      ;(actor as Actor & {citationKey?: string; heldTicketId?: string}).citationKey = frozen.vehicleKey
      ;(actor as Actor & {heldTicketId?: string}).heldTicketId = frozen.ticketId
    }
    return frozen
  }

  function ingestRawRecord(raw: unknown): boolean {
    if (!raw || typeof raw !== 'object') return false
    const rawObj = raw as Partial<CitationRecord>
    if (!rawObj.ticketId || !rawObj.vehicleKey || !isValidViolation(rawObj.violation)) return false
    const validViolation: ActiveViolation = rawObj.violation
    const existing = byVehicleKey.get(String(rawObj.vehicleKey).trim())
    if (existing && existing.issuedAtMs <= (Number(rawObj.issuedAtMs) || Infinity)) {
      return false
    }
    record({
      ticketId: String(rawObj.ticketId),
      vehicleKey: String(rawObj.vehicleKey),
      plateNo: String(rawObj.plateNo ?? ''),
      violation: validViolation,
      ...(Array.isArray(rawObj.violations) ? {violations: rawObj.violations.filter(isValidViolation)} : {}),
      violationLabel: String(rawObj.violationLabel || VIOLATION_LABELS[validViolation]),
      ...(Array.isArray(rawObj.lineItems) ? {lineItems: rawObj.lineItems} : {}),
      fineYuan: Number(rawObj.fineYuan) || 0,
      officerBadgeId: String(rawObj.officerBadgeId || 'GL-JLQ-01'),
      qrPayload: String(rawObj.qrPayload || ''),
      zoneName: String(rawObj.zoneName || '解放桥'),
      note: String(rawObj.note ?? ''),
      issuedAtMs: Number(rawObj.issuedAtMs) || 0,
      heldInHand: rawObj.heldInHand !== false,
      ...(rawObj.handedSide === 'left' || rawObj.handedSide === 'right' ? {handedSide: rawObj.handedSide} : {}),
    })
    return true
  }

  function toJSON(): SerializedCitationLedger {
    return {
      version: 1,
      exportedAtMs: Date.now(),
      records: [...byVehicleKey.values()].map(r => ({...r})),
    }
  }

  function serialize(): string {
    return JSON.stringify(toJSON())
  }

  function restore(payload: string | SerializedCitationLedger): number {
    const parsed: SerializedCitationLedger =
      typeof payload === 'string' ? (JSON.parse(payload) as SerializedCitationLedger) : payload
    if (!parsed || typeof parsed !== 'object' || parsed.version !== 1 || !Array.isArray(parsed.records)) {
      throw new Error('Invalid SerializedCitationLedger payload')
    }
    byVehicleKey.clear()
    byPlateNo.clear()
    let count = 0
    for (const raw of parsed.records) {
      if (ingestRawRecord(raw)) count++
    }
    return count
  }

  function exportNetSyncPayload(senderId = 'local_officer'): CitationNetSyncPayload {
    return {
      type: 'glol.duty.citation.sync.v1',
      senderId,
      seq: ++netSeq,
      sentAtMs: Date.now(),
      records: [...byVehicleKey.values()].map(r => ({...r})),
    }
  }

  function serializeNetSync(senderId = 'local_officer'): string {
    return JSON.stringify(exportNetSyncPayload(senderId))
  }

  function mergeNetSyncPayload(payload: string | CitationNetSyncPayload): number {
    const parsed: CitationNetSyncPayload =
      typeof payload === 'string' ? (JSON.parse(payload) as CitationNetSyncPayload) : payload
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      parsed.type !== 'glol.duty.citation.sync.v1' ||
      !Array.isArray(parsed.records)
    ) {
      throw new Error('Invalid CitationNetSyncPayload')
    }
    let added = 0
    for (const raw of parsed.records) {
      if (ingestRawRecord(raw)) added++
    }
    return added
  }

  function clear(): void {
    byVehicleKey.clear()
    byPlateNo.clear()
  }

  return {
    deriveVehicleKey,
    checkCanCite,
    hasCited,
    record,
    getRecord,
    getAllRecords: () => [...byVehicleKey.values()],
    size: () => byVehicleKey.size,
    toJSON,
    serialize,
    restore,
    exportNetSyncPayload,
    serializeNetSync,
    mergeNetSyncPayload,
    clear,
  }
}

export const sharedCitationLedger = createCitationLedger()
