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
  personalEbikeTuningConfigs,
  resolveEbikeKind,
  resolveEbikeProfile,
  resolveEbikeTier,
  resolvePersonalEbikeProfile,
  type EbikeBatteryStatus,
  type EbikeGearProfile,
  type EbikeTier,
  type EbikeUpgradeMods,
  type EbikeVehicleType,
  type NormalizedEbikeUpgrades,
  type PersonalEbikeTierId,
  type PersonalEbikeTuningSpec,
  type ResolvedEbikeProfile,
} from './tuning'
import {EBIKE_COMPLIANT_CAP_KMH} from './tuning'

export type TwoWheelCrashReason = '' | 'impact' | 'lowside' | 'loopout'
export type TwoWheelCrashPhase = 'none' | 'sliding' | 'downed' | 'rider_rising' | 'bike_down' | 'picking_up'
export type EbikeHeadlightMode = 'off' | 'low' | 'high'
export type EbikeTurnSignal = 'off' | 'left' | 'right'

export const walkConfig = {
  height:1.7, radius:.29, walk:4, run:9, crouch:2.2, jump:1.2, gravity:-20, fallGravity:-28,
  accel:50, decel:135, grip:220, airAccel:18, pivotBoost:2.2, turnRate:20, coyote:.1, jumpBuffer:.12,
  slope:52*Math.PI/180, step:.62, stepWidth:.08, snap:.65, skin:.025, collisionRadius:384, peakRadius:600, search:64,
  // Camera (M2 look): figure stays small, scenery fills the frame (docs/style.md 原则 6).
  near:4.5, far:11, zoomMin:2.5, zoomMax:22, sensitivity:.003, touchSensitivity:.0046,
  pitch:.3, camRadius:.22, camRecover:9,
  gate:{x:-588,z:-212,yaw:Math.PI},
}

/** E-bike longitudinal dynamics, speed-scaled lean responsiveness, explicit mandatory fall angle, and real P/lights/cruise tuning. */
export const bikeConfig = {
  maxSpeed: EBIKE_COMPLIANT_CAP_KMH / 3.6, reverseMax: -1.9, accel: 4.8, torqueDecay: .56, torquePow: .74,
  brake: 9.6, revHold: .20, revAccel: 2.5, rollDrag: .21, aeroDrag: .0048,
  pivotTurn: .98, peakTurn: 1.70, topTurn: 1.14, steerDamp: 10.5,
  // Normal steering stays comfortably below wet/off-road/braking fatal limits so non-tuck cornering
  // never false-crashes on a light brake tap or wet patch; deep tuck (Shift) crosses the fatal angle cleanly.
  leanMax: .43, tuckLeanMax: .68, leanDamp: 6.2,
  leanRateMin: 2.3, leanRateMax: 11.4, leanRecoverRate: 8.6, leanTargetMinRad: .14,
  pitchMax: .22, pitchDamp: 8.5,
  mountDuration: .22, dismountDuration: .16,
  stickDeadFwd: .1, stickDeadTurn: .12, slideDamp: 1.9,
  uphillDrag: 5.5, uphillCapScale: 1.1, offRoadCap: 4.2, step: .42, maxSlope: Math.PI / 4,
  crash: {
    // Explicit physical mandatory fall angle (~31 deg dry) replacing unpredictable jerk timers.
    mandatoryFallLeanRad: .54,
    wetGripPenaltyRad: .08,
    offRoadGripPenaltyRad: .07,
    brakeInLeanPenaltyRad: .06,
    minEffectiveFallRad: .36,
    wheelieTargetRad: .56,
    wheelieRaiseRate: 3.4,
    wheelieFallRate: 6.4,
    wheelieCrashRad: .68,
    wheelieMinSpeedMs: 1.2,
    impactCrashMs: 4.0,
    angledImpactCrashMs: 2.8,
    angledImpactLeanRad: .24,
    offRoadShockMs: 9.8,
  },
}

/** Pedal bicycle dynamics: 3 tactile gears, calm low-speed control, speed-coupled lean rate, and clear fall angle (~27.5 deg). */
export const bicycleConfig: typeof bikeConfig = {
  maxSpeed: 21 / 3.6, reverseMax: -1.4, accel: 2.9, torqueDecay: .48, torquePow: .82,
  brake: 8.0, revHold: .20, revAccel: 2.0, rollDrag: .17, aeroDrag: .0056,
  pivotTurn: 1.05, peakTurn: 1.80, topTurn: 1.20, steerDamp: 11.0,
  leanMax: .40, tuckLeanMax: .60, leanDamp: 6.6,
  leanRateMin: 2.6, leanRateMax: 12.4, leanRecoverRate: 9.0, leanTargetMinRad: .13,
  pitchMax: .20, pitchDamp: 8.5,
  mountDuration: .22, dismountDuration: .16,
  stickDeadFwd: .1, stickDeadTurn: .12, slideDamp: 1.85,
  uphillDrag: 21.0, uphillCapScale: 4.5, offRoadCap: 3.6, step: .42, maxSlope: Math.PI / 4,
  crash: {
    mandatoryFallLeanRad: .48,
    wetGripPenaltyRad: .07,
    offRoadGripPenaltyRad: .06,
    brakeInLeanPenaltyRad: .05,
    minEffectiveFallRad: .32,
    wheelieTargetRad: .50,
    wheelieRaiseRate: 3.6,
    wheelieFallRate: 6.8,
    wheelieCrashRad: .62,
    wheelieMinSpeedMs: 1.0,
    impactCrashMs: 3.6,
    angledImpactCrashMs: 2.4,
    angledImpactLeanRad: .22,
    offRoadShockMs: 7.4,
  },
}

/** Real electric two-wheeler feature constants: P-gear lockouts, blinker auto-cancel, hazard blink cadence, cruise control. */
export const ebikeRealFeaturesConfig = {
  parkEngageMaxSpeedMs: 1.25,
  brakeUnlockHoldSec: .08,
  cruiseMinSpeedKmh: 10,
  turnAutoCancelYawRad: .52,
  turnAutoCancelStraightHoldSec: .24,
  turnAutoCancelSteerBand: .14,
  blinkFreqHz: 1.8,
  lowBeamDrainPerSec: .008,
  highBeamDrainPerSec: .018,
  hornPulseSec: .18,
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
