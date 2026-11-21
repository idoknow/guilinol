export {
  BICYCLE_DEFAULT_GEAR,
  EBIKE_COMPLIANT_CAP_KMH,
  EBIKE_DEFAULT_GEAR,
  EBIKE_SHARED_MAX_KMH,
  EBIKE_STANDARD_MAX_KMH,
  EBIKE_UPGRADE_MAX_KMH,
  bicycleGearConfigs,
  ebikeBatteryConfig,
  ebikeTierConfigs,
  resolveEbikeKind,
  resolveEbikeProfile,
  resolveEbikeTier,
  type EbikeBatteryStatus,
  type EbikeGearProfile,
  type EbikeTier,
  type EbikeUpgradeMods,
  type EbikeVehicleType,
  type NormalizedEbikeUpgrades,
  type ResolvedEbikeProfile,
} from './tuning'
import {EBIKE_COMPLIANT_CAP_KMH} from './tuning'

export type TwoWheelCrashReason = '' | 'impact' | 'lowside' | 'loopout'
export type TwoWheelCrashPhase = 'none' | 'sliding' | 'downed' | 'rider_rising' | 'bike_down' | 'picking_up'

export const walkConfig = {
  height:1.7, radius:.29, walk:4, run:9, jump:1.2, gravity:-20, fallGravity:-28,
  accel:50, decel:135, grip:220, airAccel:18, pivotBoost:2.2, turnRate:20, coyote:.1, jumpBuffer:.12,
  slope:52*Math.PI/180, step:.62, stepWidth:.08, snap:.65, skin:.025, collisionRadius:384, peakRadius:600, search:64,
  // Camera (M2 look): figure stays small, scenery fills the frame (docs/style.md 原则 6).
  near:4.5, far:11, zoomMin:2.5, zoomMax:22, sensitivity:.003, touchSensitivity:.0046,
  pitch:.3, camRadius:.22, camRecover:9,
  gate:{x:-588,z:-212,yaw:Math.PI},
}

/** E-bike longitudinal dynamics, coasting inertia, high-sensitivity lean/wheelie, and easy crash tuning. */
export const bikeConfig = {
  maxSpeed: EBIKE_COMPLIANT_CAP_KMH / 3.6, reverseMax: -1.9, accel: 4.6, torqueDecay: .58, torquePow: .72,
  brake: 9.2, revHold: .20, revAccel: 2.5, rollDrag: .22, aeroDrag: .0048,
  pivotTurn: .98, peakTurn: 1.72, topTurn: 1.18, steerDamp: 11.5,
  leanMax: .44, tuckLeanMax: .56, leanDamp: 8.5, pitchMax: .22, pitchDamp: 8.5,
  mountDuration: .22, dismountDuration: .16,
  stickDeadFwd: .1, stickDeadTurn: .12, slideDamp: 1.9,
  uphillDrag: 5.5, uphillCapScale: 1.1, offRoadCap: 4.2, step: .42, maxSlope: Math.PI / 4,
  crash: {
    lowsideLeanRad: .34,
    wetGripPenaltyRad: .11,
    offRoadGripPenaltyRad: .11,
    brakeInLeanPenaltyRad: .08,
    highSpeedPenaltyStartMs: 8.2,
    highSpeedPenaltyRad: .06,
    sharpSteerSpeedMs: 5.8,
    sharpSteerInput: .78,
    sharpSteerWindowSec: .36,
    wheelieTargetRad: .50,
    wheelieRaiseRate: 4.4,
    wheelieFallRate: 6.2,
    wheelieCrashRad: .56,
    wheelieMinSpeedMs: 1.1,
    impactCrashMs: 3.2,
    angledImpactCrashMs: 2.0,
    angledImpactLeanRad: .14,
    offRoadShockMs: 8.2,
  },
}

/** Pedal bicycle dynamics: 3 tactile gears, agile steering, realistic coasting inertia, and easy two-wheel spills. */
export const bicycleConfig: typeof bikeConfig = {
  maxSpeed: 21 / 3.6, reverseMax: -1.4, accel: 2.9, torqueDecay: .48, torquePow: .82,
  brake: 7.8, revHold: .20, revAccel: 2.0, rollDrag: .17, aeroDrag: .0056,
  pivotTurn: 1.05, peakTurn: 1.82, topTurn: 1.24, steerDamp: 12.0,
  leanMax: .42, tuckLeanMax: .52, leanDamp: 9.0, pitchMax: .20, pitchDamp: 8.5,
  mountDuration: .22, dismountDuration: .16,
  stickDeadFwd: .1, stickDeadTurn: .12, slideDamp: 1.85,
  uphillDrag: 17.5, uphillCapScale: 3.9, offRoadCap: 3.6, step: .42, maxSlope: Math.PI / 4,
  crash: {
    lowsideLeanRad: .31,
    wetGripPenaltyRad: .10,
    offRoadGripPenaltyRad: .10,
    brakeInLeanPenaltyRad: .07,
    highSpeedPenaltyStartMs: 6.0,
    highSpeedPenaltyRad: .05,
    sharpSteerSpeedMs: 4.8,
    sharpSteerInput: .76,
    sharpSteerWindowSec: .34,
    wheelieTargetRad: .46,
    wheelieRaiseRate: 4.6,
    wheelieFallRate: 6.6,
    wheelieCrashRad: .52,
    wheelieMinSpeedMs: .9,
    impactCrashMs: 2.8,
    angledImpactCrashMs: 1.8,
    angledImpactLeanRad: .12,
    offRoadShockMs: 6.2,
  },
}

/** Two-wheel crash slide, rider-gets-up-first, and approach-to-pickup state machine timings/distances. */
export const twoWheelCrashFlowConfig = {
  slideFriction: 5.4,
  riderSlideMul: 1.18,
  riderFriction: 4.8,
  minSlideSec: .42,
  bikeLayRollRad: 1.42,
  riderRiseSec: .58,
  pickupSec: .65,
  pickupRadius: 2.4,
  approachRadius: 4.5,
  autoRiseDelaySec: 1.4,
}

export type CarDriveMode = 'cruise' | 'street' | 'sport'

export interface CarDriveModeSpec {
  id: CarDriveMode
  label: string
  shortLabel: string
  maxKmh: number
  accelScale: number
  driftSlipGain: number
}

export const carDriveModes: Record<CarDriveMode, CarDriveModeSpec> = {
  cruise: {id: 'cruise', label: '合规', shortLabel: '合规40', maxKmh: 40, accelScale: 1.0, driftSlipGain: .75},
  street: {id: 'street', label: '街道', shortLabel: '街道75', maxKmh: 75, accelScale: 1.38, driftSlipGain: 1.05},
  sport: {id: 'sport', label: '运动', shortLabel: '运动108', maxKmh: 108, accelScale: 1.78, driftSlipGain: 1.35},
}

export const CAR_DRIVE_MODE_ORDER: readonly CarDriveMode[] = ['cruise', 'street', 'sport']

/** GTA-grade passenger car dynamics (5-speed auto, 3 drive modes 40/75/108 km/h, 2D tire slip & handbrake drift, weight transfer, momentum rebound). */
export const carConfig = {
  maxSpeed:40/3.6, reverseMax:-14/3.6, accel:5.6, torqueDecay:.52, torquePow:.72,
  brake:13.2, revHold:.24, revAccel:4.2, rollDrag:.34, aeroDrag:.0048,
  wheelbase:2.65, halfWidth:.91, halfLength:2.24,
  maxSteerAngle:.50, speedSteer:1.75, steerDamp:9.5,
  frontGrip:11.8, rearGrip:10.6, handbrakeRearGrip:2.1, handbrakeDrag:5.0,
  driftYawBoost:1.45, driftCounterAssist:2.4, yawDamp:9.5,
  bodyRollMax:.105, rollDamp:7.5, pitchMax:.22, pitchDamp:9, dynPitchMax:.072,
  reboundRestitution:.24, reboundMinSpeed:4.0, reboundDuration:.22,
  maxSlope:.32, slideDamp:2.2,
  mountDuration:.28, dismountDuration:.20, cameraArmOffset:4.2, speedCameraPull:1.75,
  stickDeadFwd:.1, stickDeadTurn:.12, strictMotorway:true,
  gearUpshiftKmh:[18, 36, 56, 80] as readonly number[],
  gearTorque:[1.30, 1.14, 1.00, .90, .82] as readonly number[],
}
