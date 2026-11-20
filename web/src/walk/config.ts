export const walkConfig = {
  height:1.7, radius:.29, walk:4, run:9, jump:1.2, gravity:-20, fallGravity:-28,
  accel:50, decel:135, grip:220, airAccel:18, pivotBoost:2.2, turnRate:20, coyote:.1, jumpBuffer:.12,
  slope:52*Math.PI/180, step:.62, stepWidth:.08, snap:.65, skin:.025, collisionRadius:384, peakRadius:600, search:64,
  // Camera (M2 look): figure stays small, scenery fills the frame (docs/style.md 原则 6).
  near:4.5, far:11, zoomMin:2.5, zoomMax:22, sensitivity:.003, touchSensitivity:.0046,
  pitch:.3, camRadius:.22, camRecover:9,
  gate:{x:-588,z:-212,yaw:Math.PI},
}

/** E-bike longitudinal dynamics, cornering lean, and transition parameters (25 km/h cap). */
export const bikeConfig = {
  maxSpeed:25/3.6, reverseMax:-1.8, accel:4.2, torqueDecay:.65, torquePow:.65,
  brake:7.5, revHold:.22, revAccel:2.4, rollDrag:.42, aeroDrag:.09,
  pivotTurn:.9, peakTurn:1.65, topTurn:1.12, steerDamp:10,
  leanMax:.26, leanDamp:7.5, pitchMax:.18, pitchDamp:8,
  mountDuration:.22, dismountDuration:.16,
  stickDeadFwd:.1, stickDeadTurn:.12, slideDamp:1.8,
  uphillDrag:0, uphillCapScale:0, offRoadCap:4.2, step:.42, maxSlope:Math.PI/4,
}

/** Pedal bicycle dynamics (~5.0 m/s = 18 km/h cap, gentler human launch, noticeable uphill gravity drag). */
export const bicycleConfig: typeof bikeConfig = {
  maxSpeed:18/3.6, reverseMax:-1.3, accel:2.35, torqueDecay:.45, torquePow:.85,
  brake:6.8, revHold:.22, revAccel:1.9, rollDrag:.36, aeroDrag:.08,
  pivotTurn:.95, peakTurn:1.72, topTurn:1.18, steerDamp:10,
  leanMax:.24, leanDamp:7.5, pitchMax:.18, pitchDamp:8,
  mountDuration:.22, dismountDuration:.16,
  stickDeadFwd:.1, stickDeadTurn:.12, slideDamp:1.8,
  uphillDrag:13.5, uphillCapScale:3.2, offRoadCap:3.4, step:.42, maxSlope:Math.PI/4,
}

/** Passenger car dynamics (40 km/h cap, Ackermann steering R_min ~ 4.85m, delayed -12 km/h reverse). */
export const carConfig = {
  maxSpeed:40/3.6, reverseMax:-12/3.6, accel:5.2, torqueDecay:.58, torquePow:.75,
  brake:11.5, revHold:.24, revAccel:3.6, rollDrag:.35, aeroDrag:.06,
  wheelbase:2.65, halfWidth:.91, halfLength:2.24,
  maxSteerAngle:.50, speedSteer:2.2, steerDamp:8.5,
  bodyRollMax:.035, rollDamp:8, pitchMax:.22, pitchDamp:9,
  maxSlope:.32, slideDamp:2.2,
  mountDuration:.28, dismountDuration:.20, cameraArmOffset:4.2,
  stickDeadFwd:.1, stickDeadTurn:.12, strictMotorway:true,
}
