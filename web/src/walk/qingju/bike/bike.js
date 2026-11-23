/**
 * bike.js — assembles the complete vehicle and exposes the animation API
 * used by the ride simulation.
 */
import * as THREE from 'three';
import { DIM, axisAtY } from './dims.js';
import { buildChassis } from './chassis.js';
import { buildSteering } from './steering.js';
import { buildSaddle } from './saddle.js';
import { buildWheel } from './wheels.js';
import { meshOf, clamp } from '../util/geom.js';
import * as T from '../util/textures.js';

export function buildBike(mats, opts = {}) {
  const root = new THREE.Group();
  root.name = 'bike';

  const body = new THREE.Group();
  body.name = 'body';
  root.add(body);

  const chassis = buildChassis(mats);
  body.add(chassis.group);

  const steering = buildSteering(mats);
  body.add(steering.group);

  const saddle = buildSaddle(mats);
  body.add(saddle.group);

  // rear wheel on its own pivot (so it can rise/fall a touch)
  const rearPivot = new THREE.Group();
  rearPivot.position.set(0, 0.320, -0.300);
  body.add(rearPivot);
  const rearWheel = buildWheel(mats, { rOut: DIM.wheelR, halfWidth: 0.041, motor: true, disc: false });
  rearWheel.group.position.set(0, -0.092, -0.320);
  rearPivot.add(rearWheel.group);

  /* ---------------------------------------------------- steering rotation */
  const steerPivot = axisAtY(0.228);
  const steerAxis = DIM.steerDir.clone();
  const tmpQ = new THREE.Quaternion();
  const tmpV = new THREE.Vector3();
  let steerAngle = 0;
  function applySteer(angle) {
    steerAngle = angle;
    tmpQ.setFromAxisAngle(steerAxis, angle);
    steering.group.quaternion.copy(tmpQ);
    tmpV.copy(steerPivot).applyQuaternion(tmpQ);
    steering.group.position.copy(steerPivot).sub(tmpV);
  }
  applySteer(0);

  /* ------------------------------------------------------------- lighting */
  const headLight = new THREE.SpotLight(0xfff2d8, 0, 26, 0.42, 0.5, 1.4);
  if (opts.noLights) { headLight.visible = false }
  headLight.position.set(0, 1.108, 0.44);
  headLight.target.position.set(0, 0.15, 8.5);
  headLight.castShadow = false;
  steering.group.add(headLight);
  steering.group.add(headLight.target);
  const shieldLight = new THREE.SpotLight(0xfff4dc, 0, 30, 0.48, 0.55, 1.3);
  if (opts.noLights) { shieldLight.visible = false }
  shieldLight.position.set(0, 0.612, 0.62);
  shieldLight.target.position.set(0, -0.6, 9.5);
  shieldLight.castShadow = false;
  body.add(shieldLight);
  body.add(shieldLight.target);
  const tailGlow = new THREE.PointLight(0xff2b1e, 0, 3.2, 2);
  if (opts.noLights) { tailGlow.visible = false }
  tailGlow.position.set(0, 0.66, -0.92);
  if (!opts.noLights) body.add(tailGlow);
  const headGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: T.makeGlowSprite(), color: 0xfff0cc, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  headGlow.scale.set(0.5, 0.5, 1);
  headGlow.position.set(0, 1.108, 0.45);
  if (!opts.noLights) steering.group.add(headGlow);
  const tailSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: T.makeGlowSprite(), color: 0xff3a26, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  tailSprite.scale.set(0.26, 0.26, 1);
  tailSprite.position.set(0, 0.659, -0.885);
  if (!opts.noLights) body.add(tailSprite);

  /* --------------------------------------------------------- contact shadow */
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1.15, 2.35),
    new THREE.MeshBasicMaterial({
      map: T.makeContactShadow(), transparent: true, opacity: 0.85,
      depthWrite: false, color: 0x000000, blending: THREE.NormalBlending,
    })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(0, 0.004, -0.02);
  root.add(shadow);

  /* ------------------------------------------------------------------ state */
  const state = {
    steer: 0, lean: 0, pitch: 0,
    frontAngle: 0, rearAngle: 0,
    lights: false, kickstand: 0,
    frontWheelRadius: steering.parts.frontWheelRadius,
    rearWheelRadius: rearWheel.radius,
  };

  const bike = {
    root, body, chassis, steering, saddle, rearWheel, rearPivot,
    parts: { ...chassis.parts, ...steering.parts, ...saddle.parts },
    state,
    headLight, shieldLight, tailGlow, headGlow, tailSprite, shadow,
    setSteer(a) { applySteer(a); },
    setLights(on) {
      state.lights = on;
      mats.lensHead.emissiveIntensity = on ? 2.8 : 0.12;
      mats.lensTail.emissiveIntensity = on ? 2.2 : 0.45;
      headLight.intensity = on ? 22 : 0;
      shieldLight.intensity = on ? 42 : 0;
      tailGlow.intensity = on ? 0.9 : 0;
      headGlow.material.opacity = on ? 0.85 : 0;
      tailSprite.material.opacity = on ? 0.7 : 0.15;
      mats.screen.emissive?.set?.(on ? 0x1b3a33 : 0x000000);
    },
    /** advance wheel spin, body attitude and small dynamic details */
    update(dt, s) {
      // wheel spin follows travelled distance (plus a little motor surge)
      const v = s.speed || 0;
      if (s.wheelTravel !== undefined) {
        state.frontAngle = s.wheelTravel / state.frontWheelRadius;
        state.rearAngle = s.wheelTravel / state.rearWheelRadius;
      }
      steering.parts.frontWheel.rotation.x = -state.frontAngle;
      rearWheel.spin.rotation.x = -state.rearAngle;

      // steering
      applySteer(s.steer || 0);

      // attitude: lean into the turn, pitch under accel/brake
      const leanTarget = s.lean || 0;
      state.lean += (leanTarget - state.lean) * clamp(dt * 6, 0, 1);
      const pitchTarget = clamp(-(s.longAccel || 0) * 0.010, -0.045, 0.055);
      state.pitch += (pitchTarget - state.pitch) * clamp(dt * 5, 0, 1);
      body.rotation.z = state.lean;
      body.rotation.x = state.pitch;
      // tiny high-frequency shimmy from the road surface
      const judder = Math.min(v / 7, 1);
      body.position.y = Math.sin(performance.now() * 0.021) * 0.0016 * judder;
      body.position.x = Math.sin(performance.now() * 0.013 + 1.7) * 0.0012 * judder;

      // kickstand folds up as soon as you pull away
      const target = v < 0.12 && !s.riding ? 0 : 1;
      state.kickstand += (target - state.kickstand) * clamp(dt * 4, 0, 1);
      if (chassis.parts.kickstand) {
        chassis.parts.kickstand.rotation.z = -1.28 * state.kickstand;
        chassis.parts.kickstand.visible = true;
      }
      // contact shadow softens with speed
      shadow.material.opacity = 0.85 - Math.min(v * 0.05, 0.35);
      shadow.visible = true;
    },
  };

  // initial pose
  bike.setLights(false);
  bike.update(0, { speed: 0, wheelTravel: 0, steer: 0, lean: 0 });
  return bike;
}
