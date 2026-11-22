import type {Camera, Scene} from 'three'
import {createGameDebugProbe} from './index'
import {createMissionBeacon, listMissionsForUi, MissionRunnerEngine} from './missions'
import {flushThrottledSave} from './save'
import {mountMissionUi} from './mission-ui'
import {getState, onState, type PlayerMode} from './state'
export * as commerce from './commerce'
export {mountShopOverlay} from '../ui/shop-overlay'

// The active order belongs to this engine session. Only mounted layers advance its clock.
const missionRunner = new MissionRunnerEngine()
interface StoryContext {
  scene: Scene
  camera: Camera
  sampleMissionGroundY(x:number, z:number): number
  walker(): Awaited<ReturnType<typeof import('../walk').walk>> | undefined
  tour(): Awaited<ReturnType<typeof import('../play').play>> | undefined
  paused(): boolean
}
export async function mountStoryLayer(ctx: StoryContext) {
  const {scene, camera, sampleMissionGroundY} = ctx
  const missionBeacon = createMissionBeacon(scene, sampleMissionGroundY)
  const playerPos = () => {
    const walker = ctx.walker()
    return walker?.active ? walker.position : undefined
  }
  const missionUi = mountMissionUi(missionRunner, playerPos)
  const hideBeacon = () => !!ctx.tour()?.photo?.active || ctx.paused()
  const off = onState((state, changed) => {
    if (changed.has('mission')) missionBeacon.sync(state.mission?.target, playerPos() ?? camera.position, hideBeacon(), 0)
  })
  window.addEventListener('game:open-missions', missionUi.openBoard)

  function step(dt: number, frozen = false) {
    const walker = ctx.walker()
    const vehicle = walker?.active ? walker.vehicle : 'fly'
    const mode: PlayerMode = vehicle === 'bike' ? 'ebike' : vehicle === 'bicycle' ? 'bike' : vehicle
    const pos = playerPos() ?? camera.position
    const eb = walker?.active ? walker.ebike?.state : null
    missionRunner.step({dt, x:pos.x, y:pos.y, z:pos.z, mode, speedMs:Math.abs(walker?.speed ?? 0),
      braking:!!eb?.braking, parkLocked:!!eb?.parkLocked, crashPhase:eb?.crashPhase ?? 'none', frozen})
    missionBeacon.sync(getState().mission?.target, pos, hideBeacon(), dt)
  }
  const gameProbe = createGameDebugProbe({
    missions: {
      list: listMissionsForUi,
      start: (id: string) => missionRunner.start(id, playerPos()),
      abandon: () => missionRunner.abandon(),
      status: () => missionRunner.getSnapshot(),
      forceSpill: (drop: number) => missionRunner.forceSpillDrop(drop),
      advanceTimerForTest: (seconds: number) => {
        const steps = Math.max(1, Math.ceil(seconds / 0.1))
        const stepDt = seconds / steps
        for (let i = 0; i < steps; i++) step(stepDt)
      },
      beaconVisible: () => missionBeacon.isVisible(),
      beaconTarget: () => missionBeacon.getTarget(),
      openBoard: () => missionUi.openBoard(),
      closeBoard: () => missionUi.closeBoard(),
    },
  })
  return {step: (dt:number) => step(dt, hideBeacon() || !!ctx.tour()?.map?.active || missionUi.boardOpen || !!getState().activeShop), probe: gameProbe, dispose() {
    window.removeEventListener('game:open-missions', missionUi.openBoard)
    flushThrottledSave()
    off()
    missionUi.dispose()
    missionBeacon.dispose()
  }}
}
