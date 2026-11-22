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
import vehicles from '../drive/vehicles.json' with {type:'json'}
import camera from '../drive/camera.json' with {type:'json'}

function dynamics<T extends {maxKmh:number;reverseKmh:number}>(spec:T){
  return {...spec,maxSpeed:spec.maxKmh/3.6,reverseMax:-spec.reverseKmh/3.6}
}

export type TwoWheelCrashReason = '' | 'impact' | 'lowside' | 'loopout'
export type TwoWheelCrashPhase = 'none' | 'sliding' | 'downed' | 'rider_rising' | 'bike_down' | 'picking_up'
export type EbikeHeadlightMode = 'off' | 'low' | 'high'
export type EbikeTurnSignal = 'off' | 'left' | 'right'

export const walkConfig = {
  height:1.7, radius:.29, walk:1.65, run:9, crouch:1.2, jump:1.2, gravity:-20, fallGravity:-28,
  accel:50, decel:135, grip:220, airAccel:18, pivotBoost:2.2, turnRate:20, coyote:.1, jumpBuffer:.12,
  slope:52*Math.PI/180, step:.62, stepWidth:.08, snap:.65, skin:.025, collisionRadius:384, peakRadius:600, search:64,
  // Camera (M2 look): figure stays small, scenery fills the frame (docs/style.md 原则 6).
  near:4.5, far:11, zoomMin:2.5, zoomMax:22, sensitivity:.003, touchSensitivity:.0046,
  // Phone look stick (IDOK-93): full deflection turns this many rad/s; deadzone as a fraction of the stick radius.
  lookYaw:2.2, lookPitch:1.2, lookDead:.12,
  pitch:.3, camRadius:.22, camRecover:9,
  gate:{x:-588,z:-212,yaw:Math.PI},
}

/** E-bike longitudinal dynamics, speed-scaled lean responsiveness, explicit mandatory fall angle, and real P/lights/cruise tuning. */
export const bikeConfig = dynamics(vehicles.ebike)

/** Pedal bicycle dynamics: 3 tactile gears, calm low-speed control, speed-coupled lean rate, and clear fall angle (~27.5 deg). */
export const bicycleConfig = dynamics(vehicles.bike)

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
export const carConfig = {...dynamics(vehicles.sedan),maxSteerAngle:vehicles.sedan.steerRad,cameraArmOffset:camera.distance-walkConfig.near,speedCameraPull:camera.pullbackAtMaxSpeed}
