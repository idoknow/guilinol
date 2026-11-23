/**
 * dims.js — one source of truth for the bike's proportions (metres).
 * Measured against the reference photographs: 1.71 m long, 1.20 m tall,
 * 1.28 m wheelbase, 18" wheels.
 */
import * as THREE from 'three';

export const DIM = {
  wheelR: 0.228,
  frontAxle: new THREE.Vector3(0, 0.228, 0.660),
  rearAxle: new THREE.Vector3(0, 0.228, -0.620),
  wheelbase: 1.280,

  // steering axis: passes through the ground point 0.03 m ahead of the axle
  steerGround: new THREE.Vector3(0, 0, 0.690),
  rake: 15.3 * Math.PI / 180,
  get steerDir() { return new THREE.Vector3(0, Math.cos(this.rake), -Math.sin(this.rake)); },

  deckTop: 0.272,
  deckY0: 0.196,
  deckZF: 0.420,
  deckZB: -0.280,
  deckW: 0.316,

  seatTop: 0.792,
  barY: 1.128,
  barHalfWidth: 0.318,
  cowlY: 1.100,
  cowlZ: 0.300,

  shieldTop: 1.055,
  rearBodyTop: 0.735,
};

/** point on the steering axis at height y */
export function axisAtY(y) {
  const d = DIM.steerDir;
  const t = (y - DIM.steerGround.y) / d.y;
  return new THREE.Vector3(
    DIM.steerGround.x + d.x * t,
    y,
    DIM.steerGround.z + d.z * t
  );
}

export const TEAL = '#22c3b1';
export const ORANGE = '#f6a01a';
