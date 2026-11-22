import {QUIET_BUFFER_METERS, findQuietZoneAt} from '../game/quiet-zones'
import errand01 from './errand-wangcheng-nikoniko.json'
import errand02 from './errand-nikoniko-shizijie.json'
import noodle01 from './noodle-jiefang-binjiang.json'
import noodle02 from './noodle-zhengyang-shanhu.json'
import noodle03 from './noodle-shizijie-elephant.json'

import taxi01 from './taxi-01.json'
import taxi02 from './taxi-02.json'
import taxi03 from './taxi-03.json'
import race01 from './race-01.json'
import race02 from './race-02.json'
import race03 from './race-03.json'

export type MissionLine = 'noodle' | 'errand' | 'taxi' | 'race'
export type MissionStepKind = 'goto' | 'pickup' | 'deliver' | 'checkpoint'
export type MissionFailCondition = 'timeout' | 'spill' | 'wanted'

export interface MissionStepDef {
  kind: MissionStepKind
  at: [number, number]
  radius: number
  timer?: number
  text: string
  npc?: {
    who: string
    text: string
  }
}

export interface MissionDef {
  id: string
  line: MissionLine
  title: string
  summary?: string
  recommendedVehicle?: 'any' | 'foot' | 'ebike' | 'bike' | 'car'
  giver: [number, number]
  steps: MissionStepDef[]
  reward: number
  fullSoupBonus?: number
  repeatReward?: number
  repeatFullSoupBonus?: number
  minReward?: number
  repeatMinReward?: number
  failOn: MissionFailCondition[]
}

export const MISSIONS: readonly MissionDef[] = [
  errand01 as MissionDef,
  errand02 as MissionDef,
  noodle01 as MissionDef,
  noodle02 as MissionDef,
  noodle03 as MissionDef,
  taxi01 as MissionDef,
  taxi02 as MissionDef,
  taxi03 as MissionDef,
  race01 as MissionDef,
  race02 as MissionDef,
  race03 as MissionDef,
]

export function getMissionById(id: string): MissionDef | undefined {
  return MISSIONS.find(mission => mission.id === id)
}

export interface MissionQuietViolation {
  missionId: string
  pointLabel: string
  coords: [number, number]
  quietZoneId: string
  quietZoneName: string
}

/**
 * Static acceptance audit: verifies every mission `giver` and every step `at` coordinate
 * lies strictly outside all school quiet zones (+5m outward buffer).
 */
export function auditMissionsAgainstQuietZones(
  missions: readonly MissionDef[] = MISSIONS,
  bufferM = QUIET_BUFFER_METERS,
): MissionQuietViolation[] {
  const violations: MissionQuietViolation[] = []
  for (const mission of missions) {
    const giverHit = findQuietZoneAt(mission.giver[0], mission.giver[1], bufferM)
    if (giverHit) {
      violations.push({
        missionId: mission.id,
        pointLabel: 'giver',
        coords: mission.giver,
        quietZoneId: giverHit.id,
        quietZoneName: giverHit.name,
      })
    }
    for (let index = 0; index < mission.steps.length; index++) {
      const step = mission.steps[index]
      const stepHit = findQuietZoneAt(step.at[0], step.at[1], bufferM)
      if (stepHit) {
        violations.push({
          missionId: mission.id,
          pointLabel: `step[${index}](${step.kind})`,
          coords: step.at,
          quietZoneId: stepHit.id,
          quietZoneName: stepHit.name,
        })
      }
    }
  }
  return violations
}
