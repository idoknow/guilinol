import assert from 'node:assert/strict'
import {buildRoadBarriers, ROAD_BARRIER_STRIDE} from '../web/src/road-barriers.ts'
import {SHIZIJIE_ORIGIN} from '../web/src/shizijie-zone.ts'

const tile = [-1024, -256]
const barriers = buildRoadBarriers([], () => 151.3, tile)
function blocked(east, south) {
  for (let offset = 0; offset < barriers.length; offset += ROAD_BARRIER_STRIDE) {
    const [cx, , cz, hx, , hz, yaw] = barriers.subarray(offset, offset + ROAD_BARRIER_STRIDE)
    const dx = SHIZIJIE_ORIGIN[0] + east - tile[0] - cx
    const dz = SHIZIJIE_ORIGIN[1] + south - tile[1] - cz
    if (Math.abs(dx * Math.cos(yaw) - dz * Math.sin(yaw)) <= hx &&
        Math.abs(dx * Math.sin(yaw) + dz * Math.cos(yaw)) <= hz) return true
  }
  return false
}

assert(blocked(-2.5 - (70 - 64.8) * 9.6 / 28, 70), 'keep the modeled fence blocking')
for (let south = 73; south <= 92; south += .25) {
  assert(!blocked(-2.5 - (south - 64.8) * 9.6 / 28, south), `phantom rail at south=${south}`)
}
