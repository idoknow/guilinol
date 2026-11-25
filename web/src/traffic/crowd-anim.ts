import * as THREE from 'three'

const BLEND_SECONDS = 0.25

export function blendPasserbyWeights(walkWeight: number, moving: boolean, dt: number) {
  const target = moving ? 1 : 0
  const delta = Math.min(1, Math.max(0, dt) / BLEND_SECONDS)
  if (walkWeight < target) return Math.min(target, walkWeight + delta)
  if (walkWeight > target) return Math.max(target, walkWeight - delta)
  return target
}

export function syncPasserbyActions(
  walk: THREE.AnimationAction | undefined,
  idle: THREE.AnimationAction | undefined,
  walkWeight: number,
) {
  const w = THREE.MathUtils.clamp(Number.isFinite(walkWeight) ? walkWeight : 0, 0, 1)
  if (walk && idle) {
    walk.enabled = true
    idle.enabled = true
    if (!walk.isRunning()) walk.play()
    if (!idle.isRunning()) idle.play()
    walk.setEffectiveWeight(w)
    idle.setEffectiveWeight(1 - w)
    return
  }
  const only = walk ?? idle
  if (only) {
    only.enabled = true
    if (!only.isRunning()) only.play()
    only.setEffectiveWeight(1)
  }
}
