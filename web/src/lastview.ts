import * as THREE from 'three'
import { validView, type FeedbackView } from '../../lib/feedback-contract'

// IDOK-105: remember where the player left off so the title screen can offer "回到上次离开的地方".
// Storage reuses the feedback FeedbackView shape (read with validView(), restored with applyLastView),
// wrapped with a save time so stale entries expire. Deep-linked sessions neither read nor write this.
export const LAST_VIEW_KEY = 'glol.lastView'
const MAX_AGE = 30 * 24 * 60 * 60 * 1000 // 30 days

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export function readLastView(store: Store = localStorage): FeedbackView | null {
  let raw: string | null = null
  try { raw = store.getItem(LAST_VIEW_KEY) } catch { return null }
  if (!raw) return null
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return null }
  const record = parsed as { v?: unknown; t?: unknown } | null
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null
  if (typeof record.t !== 'number' || !Number.isFinite(record.t)) return null
  if (Date.now() - record.t > MAX_AGE) return null
  if (!validView(record.v,'saved')) return null
  return record.v as FeedbackView
}

// Save time of a usable stored view (ms since epoch), or null — the title screen shows how long ago it was.
export function lastViewSavedAt(store: Store = localStorage): number | null {
  if (!readLastView(store)) return null
  try { return (JSON.parse(store.getItem(LAST_VIEW_KEY)!) as { t: number }).t } catch { return null }
}

export function saveLastView(view: FeedbackView, store: Store = localStorage): void {
  try { store.setItem(LAST_VIEW_KEY, JSON.stringify({ v: view, t: Date.now() })) } catch { /* private mode */ }
}

export function clearLastView(store: Store = localStorage): void {
  try { store.removeItem(LAST_VIEW_KEY) } catch { /* private mode */ }
}

// Restore a saved FeedbackView onto a fresh camera (always flying; a walking session comes back as a
// fly-over at the same pose). Mirrors feedback-view.setView() minus the walker/host wiring.
export function applyLastView(camera: THREE.PerspectiveCamera, view: FeedbackView): void {
  camera.position.set(view.x, view.y, view.z)
  camera.rotation.set(THREE.MathUtils.degToRad(view.pitch), THREE.MathUtils.degToRad(view.yaw), 0, 'YXZ')
  camera.fov = view.fov
  camera.updateProjectionMatrix()
}

// One-shot signal from the title screen's "回到上次离开的地方" button to main.ts, which restores
// the camera after the scene boots. Kept in-module so the button stays a dumb trigger.
let pending = false
export function requestRestore(): void { pending = true }
export function cancelRestore(): void { pending = false }
export function consumeRestore(): boolean { const value = pending; pending = false; return value }
