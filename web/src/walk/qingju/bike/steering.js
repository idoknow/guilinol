/**
 * steering.js — everything that turns with the handlebars: fork, wheel,
 * front mudguard, stem, head unit, grips, levers, display, basket.
 * Authored in bike-space; bike.js applies rotation about the steering axis.
 */
import * as THREE from 'three';
import {
  loftSectionsZ, loftSectionsY, meshOf, mergeGeos, placed, roundedBoxGeometry,
  setShadowFlags, cylinderBetween, tubeFromPoints, makeFender, clamp, DEG,
  decalGeometry, sideURange,
} from '../util/geom.js';
import * as T from '../util/textures.js';
import { DIM } from './dims.js';
import { buildWheel } from './wheels.js';

const { PI } = Math;
const tanRake = Math.tan(DIM.rake);

/** z position of the fork leg centre-line at height y */
export function forkZ(y) {
  return DIM.frontAxle.z - tanRake * (y - DIM.frontAxle.y);
}

export function buildSteering(mats) {
  const group = new THREE.Group();
  group.name = 'steering';
  const parts = {};
  const add = (m) => { group.add(m); return m; };

  /* =============================================================== fork == */
  const legX = 0.071;
  const legs = [];
  for (const s of [1, -1]) {
    const x = s * legX;
    // lower leg (black casting) — from the dropout up
    const l0 = new THREE.Vector3(x, 0.220, forkZ(0.220) + 0.004);
    const l1 = new THREE.Vector3(x, 0.452, forkZ(0.452) + 0.004);
    const lower = cylinderBetween(l0, l1, 0.0280, 0.0245, 20);
    legs.push(lower);
    // dropout / axle boss
    const boss = placed(new THREE.CylinderGeometry(0.021, 0.023, 0.026, 20), {
      p: [x, 0.228, forkZ(0.228) + 0.004], r: [0, 0, PI / 2],
    });
    legs.push(boss);
    // caliper / reflector mount lug
    const lug = placed(roundedBoxGeometry(0.014, 0.070, 0.026, 0.005, { segments: 8 }), {
      p: [x + s * 0.020, 0.300, forkZ(0.300)], r: [0, 0, 0],
    });
    legs.push(lug);
  }
  // fork brace (arch in front of the tyre)
  {
    const brace = [];
    const n = 9;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const x = (t - 0.5) * 2 * legX;
      const bulge = Math.cos((t - 0.5) * PI) * 0.042;
      const y = 0.395 + bulge * 0.55;
      const z = forkZ(y) + 0.030 + bulge * 0.25;
      const ring = [];
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * PI * 2;
        ring.push([0.020 * Math.cos(a), 0.012 * Math.sin(a)]);
      }
      brace.push({ o: new THREE.Vector3(x, y, z), x: new THREE.Vector3(0, 0, 1), y: new THREE.Vector3(0, 1, 0), profile: ring });
    }
    legs.push(new THREELoft(brace));
  }
  add(meshOf(mergeGeos(legs), mats.blackGloss));

  // chrome stanchions
  const stanchions = [];
  for (const s of [1, -1]) {
    const x = s * legX;
    const a = new THREE.Vector3(x, 0.418, forkZ(0.418) + 0.004);
    const b = new THREE.Vector3(x, 0.573, forkZ(0.573) + 0.004);
    stanchions.push(cylinderBetween(a, b, 0.0192, 0.0192, 20));
    // dust seal
    const seal = new THREE.CylinderGeometry(0.0265, 0.0275, 0.020, 20);
    seal.translate(0, 0, 0);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, 0.448, forkZ(0.448) + 0.004),
      new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, Math.cos(DIM.rake), -Math.sin(DIM.rake))),
      new THREE.Vector3(1, 1, 1)
    );
    seal.applyMatrix4(m);
    stanchions.push(seal);
  }
  add(meshOf(mergeGeos(stanchions), mats.chrome));

  // amber side reflector on the right leg
  {
    const refl = meshOf(roundedBoxGeometry(0.014, 0.044, 0.020, 0.006, { segments: 8 }), mats.reflectorAmber);
    refl.position.set(legX + 0.020, 0.335, forkZ(0.335) + 0.004);
    add(refl);
  }

  // brake caliper
  {
    const cal = meshOf(roundedBoxGeometry(0.026, 0.072, 0.048, 0.008, { segments: 8 }), mats.blackMetal);
    cal.position.set(0.046, 0.300, DIM.frontAxle.z - 0.052);
    cal.rotation.x = 0.35;
    add(cal);
    const hose = meshOf(tubeFromPoints([
      new THREE.Vector3(0.052, 0.340, DIM.frontAxle.z - 0.070),
      new THREE.Vector3(0.070, 0.430, forkZ(0.430) - 0.020),
      new THREE.Vector3(0.090, 0.560, forkZ(0.560) - 0.010),
      new THREE.Vector3(0.105, 0.760, forkZ(0.760) + 0.030),
    ], 0.0038, { radialSegs: 6, tubularSegs: 40 }), mats.cable);
    add(hose);
  }

  /* =========================================================== front wheel */
  const wheel = buildWheel(mats, { rOut: DIM.wheelR, halfWidth: 0.037, disc: true, motor: false });
  wheel.group.position.copy(DIM.frontAxle);
  group.add(wheel.group);
  parts.frontWheel = wheel.spin;
  parts.frontWheelRadius = wheel.radius;

  /* ========================================================= front fender */
  {
    const center = new THREE.Vector3(0, DIM.frontAxle.y, DIM.frontAxle.z);
    const fen = makeFender({
      center, rIn: 0.234, rOut: 0.249, halfWidth: 0.046,
      a0: -66, a1: 70, segs: 90, curl: 0.0035, lateralSegs: 9, taper: 0.40,
    });
    add(meshOf(fen.geometry, mats.teal));
    const liner = makeFender({
      center, rIn: 0.230, rOut: 0.234, halfWidth: 0.040,
      a0: -64, a1: 68, segs: 80, curl: 0.0035, lateralSegs: 7,
    });
    add(meshOf(liner.geometry, mats.plasticSoft));
    // mounting brackets onto the fork legs
    for (const s of [1, -1]) {
      const br = meshOf(roundedBoxGeometry(0.012, 0.020, 0.070, 0.005, { segments: 6 }), mats.blackMetal);
      br.position.set(s * 0.062, 0.430, DIM.frontAxle.z - 0.020);
      br.rotation.x = 0.50;
      add(br);
    }
  }

  /* ============================================================ steerer === */
  {
    const a = new THREE.Vector3(0, 0.600, forkZ(0.600));
    const b = new THREE.Vector3(0, 1.045, forkZ(1.045));
    add(meshOf(cylinderBetween(a, b, 0.0235, 0.0225, 20), mats.darkAlu));
    // lower crown (hidden inside the shield, but visible from below)
    const crown = meshOf(roundedBoxGeometry(0.200, 0.048, 0.082, 0.016, { segments: 10 }), mats.blackMetal);
    crown.position.set(0, 0.588, forkZ(0.588) + 0.004);
    crown.rotation.x = DIM.rake;
    add(crown);
    parts.crown = crown;
  }

  /* ================================================================ bars == */
  const barY = DIM.barY;
  const barZ = 0.262;
  const barHalf = DIM.barHalfWidth;
  {
    const barPts = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const s = t * 2 - 1;
      const ax = Math.abs(s);
      barPts.push(new THREE.Vector3(
        s * barHalf,
        barY + 0.028 * ax * ax - 0.004,
        barZ - 0.085 * ax * ax - 0.010 * ax
      ));
    }
    add(meshOf(tubeFromPoints(barPts, 0.0125, { radialSegs: 14, tubularSegs: 64 }), mats.blackGloss));
  }
  // grips
  {
    for (const s of [1, -1]) {
      const gx = s * (barHalf - 0.010);
      const inner = new THREE.Vector3(gx - s * 0.060, barY + 0.022, barZ - 0.070);
      const outer = new THREE.Vector3(gx + s * 0.062, barY + 0.030, barZ - 0.082);
      const dir = new THREE.Vector3().subVectors(outer, inner);
      const len = dir.length();
      const g = new THREE.CylinderGeometry(0.0195, 0.0195, len, 20);
      g.rotateZ(PI / 2);
      g.translate(0, 0, 0);
      const mtx = new THREE.Matrix4().compose(
        inner.clone().add(outer).multiplyScalar(0.5),
        new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir.clone().normalize()),
        new THREE.Vector3(1, 1, 1)
      );
      g.applyMatrix4(mtx);
      add(meshOf(g, mats.gripRubber));
      // grip ribs
      for (let i = 0; i < 4; i++) {
        const t = 0.28 + i * 0.16;
        const p = inner.clone().lerp(outer, t);
        const rib = new THREE.TorusGeometry(0.0205, 0.0022, 8, 18);
        rib.applyMatrix4(new THREE.Matrix4().compose(
          p, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.clone().normalize()), new THREE.Vector3(1, 1, 1)
        ));
        add(meshOf(rib, mats.gripRubber));
      }
      // bar end cap
      const cap = meshOf(new THREE.CylinderGeometry(0.0205, 0.0180, 0.016, 18), mats.blackGloss);
      cap.position.copy(outer);
      cap.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
      add(cap);
    }
  }
  // brake levers (both sides)
  {
    for (const s of [1, -1]) {
      const clampPos = new THREE.Vector3(s * 0.118, barY + 0.014, barZ - 0.052);
      const lever = meshOf(roundedBoxGeometry(0.115, 0.019, 0.026, 0.008, { segments: 8 }), mats.blackGloss);
      lever.position.set(s * (0.118 + 0.058), barY + 0.020, barZ - 0.072);
      lever.rotation.z = s * 0.10;
      lever.rotation.y = s * -0.20;
      add(lever);
      const master = meshOf(roundedBoxGeometry(0.045, 0.038, 0.040, 0.012, { segments: 8 }), mats.blackGloss);
      master.position.copy(clampPos);
      master.rotation.y = s * -0.12;
      add(master);
      // lever pivot bolt
      const bolt = meshOf(new THREE.CylinderGeometry(0.006, 0.006, 0.048, 10), mats.steel);
      bolt.position.copy(clampPos);
      bolt.rotation.z = PI / 2;
      add(bolt);
      // brake cable running down the fork
      const cable = tubeFromPoints([
        new THREE.Vector3(s * 0.104, barY - 0.004, barZ - 0.040),
        new THREE.Vector3(s * 0.088, 1.010, barZ - 0.100),
        new THREE.Vector3(s * 0.080, 0.880, forkZ(0.880) + 0.040),
        new THREE.Vector3(s * 0.086, 0.700, forkZ(0.700) + 0.055),
        new THREE.Vector3(s * 0.082, 0.520, forkZ(0.520) + 0.030),
      ], 0.0032, { radialSegs: 6, tubularSegs: 48 });
      add(meshOf(cable, mats.cable));
    }
  }

  /* ============================================================== cowl ==== */
  {
    const cowl = loftSectionsZ([
      { z: 0.170, y0: 1.045, y1: 1.150, w: 0.150, rT: 0.048, rB: 0.028 },
      { z: 0.220, y0: 1.036, y1: 1.170, w: 0.220, rT: 0.056, rB: 0.030 },
      { z: 0.290, y0: 1.030, y1: 1.180, w: 0.248, rT: 0.062, rB: 0.032 },
      { z: 0.360, y0: 1.034, y1: 1.172, w: 0.238, rT: 0.060, rB: 0.032 },
      { z: 0.412, y0: 1.048, y1: 1.142, w: 0.196, rT: 0.050, rB: 0.030 },
      { z: 0.440, y0: 1.062, y1: 1.116, w: 0.140, rT: 0.036, rB: 0.024 },
    ], { segments: 34, edgeSegs: 8, cornerSegs: 10 });
    add(meshOf(cowl.geometry, mats.teal));
    parts.cowl = cowl;

    // instrument cluster: coloured bezel + live speed LCD
    const cluster = new THREE.Group();
    cluster.position.set(-0.018, 1.1745, 0.306);
    cluster.rotation.x = -0.13;
    add(cluster);

    const disp = meshOf(roundedBoxGeometry(0.108, 0.016, 0.084, 0.010, { segments: 10 }), mats.screen);
    cluster.add(disp);

    const speedDisplay = T.makeSpeedDisplay(512, 400);
    const dispFace = new THREE.Mesh(
      new THREE.PlaneGeometry(0.100, 0.078),
      new THREE.MeshStandardMaterial({
        map: speedDisplay.texture,
        emissiveMap: speedDisplay.texture,
        emissive: new THREE.Color('#7fe9dc'),
        emissiveIntensity: 0.85,
        color: new THREE.Color('#ffffff'),
        roughness: 0.18,
        metalness: 0.15,
      })
    );
    // lying on the bezel: normal +Y, artwork "up" toward the front, right toward -X
    dispFace.rotation.set(-Math.PI / 2, 0, Math.PI);
    dispFace.position.set(0, 0.0082, 0);
    cluster.add(dispFace);
    parts.display = speedDisplay;

    // headlamp in the cowl's nose
    const lampHousing = meshOf(roundedBoxGeometry(0.130, 0.058, 0.036, 0.016, { segments: 10 }), mats.white);
    lampHousing.position.set(0, 1.106, 0.414);
    lampHousing.rotation.x = 0.10;
    add(lampHousing);
    const lamp = meshOf(roundedBoxGeometry(0.106, 0.036, 0.012, 0.012, { segments: 10 }), mats.lensHead);
    lamp.position.set(0, 1.106, 0.4315);
    lamp.rotation.x = 0.10;
    add(lamp);
    parts.headLens = lamp;

    // rubber boot where the steerer leaves the shield
    const boot = meshOf(new THREE.CylinderGeometry(0.048, 0.055, 0.034, 20), mats.plasticSoft);
    boot.position.set(0, 1.012, 0.394);
    boot.rotation.x = -DIM.rake;
    add(boot);

    // stem clamp block
    const stem = meshOf(roundedBoxGeometry(0.070, 0.070, 0.080, 0.014, { segments: 10 }), mats.blackGloss);
    stem.position.set(0, 1.052, 0.364);
    stem.rotation.x = 0.10;
    add(stem);
  }

  /* ========================================================= phone mount == */
  {
    const mount = new THREE.Group();
    const clampM = meshOf(roundedBoxGeometry(0.030, 0.028, 0.042, 0.008, { segments: 8 }), mats.plastic);
    clampM.position.set(0.112, barY - 0.004, barZ - 0.042);
    mount.add(clampM);
    const arm = meshOf(roundedBoxGeometry(0.014, 0.052, 0.018, 0.006, { segments: 6 }), mats.plastic);
    arm.position.set(0.112, barY + 0.030, barZ - 0.040);
    arm.rotation.x = -0.22;
    mount.add(arm);
    const plate = meshOf(roundedBoxGeometry(0.080, 0.006, 0.112, 0.008, { segments: 8 }), mats.plastic);
    plate.position.set(0.112, barY + 0.058, barZ - 0.046);
    plate.rotation.x = -0.34;
    mount.add(plate);
    const pad = new THREE.Mesh(
      new THREE.PlaneGeometry(0.062, 0.086),
      new THREE.MeshStandardMaterial({ color: new THREE.Color('#2b3033'), roughness: 0.62, metalness: 0.05 })
    );
    pad.position.set(0.112, barY + 0.0625, barZ - 0.047);
    pad.rotation.x = -PI / 2 - 0.34;
    mount.add(pad);
    add(mount);
  }

  /* ============================================================= basket === */
  {
    const basket = new THREE.Group();
    const bw = 0.330, bd = 0.296, bh = 0.222;
    const y0 = 0.792;
    const y1 = y0 + bh;
    const cz = 0.742;
    const tealGeos = [];
    const blackGeos = [];

    // floor tray
    const floor = roundedBoxGeometry(bw - 0.012, 0.016, bd - 0.012, 0.022, { segments: 8 });
    floor.translate(0, y0 + 0.006, cz);
    tealGeos.push(floor);

    // horizontal slats — the open slots are what you read in the reference
    const barCount = 5;
    for (let i = 0; i < barCount; i++) {
      const t = i / (barCount - 1);
      const y = y0 + 0.040 + t * (bh - 0.078);
      const halfW = (bw - 0.022) * 0.5 + t * 0.005;
      const halfD = (bd - 0.022) * 0.5 + t * 0.005;
      for (const s of [1, -1]) {
        const side = roundedBoxGeometry(0.014, 0.015, halfD * 2, 0.006, { segments: 5, edgeSegs: 4, cornerSegs: 5 });
        side.translate(s * halfW, y, cz);
        tealGeos.push(side);
        const front = roundedBoxGeometry(halfW * 2, 0.015, 0.014, 0.006, { segments: 5, edgeSegs: 4, cornerSegs: 5 });
        front.translate(0, y, cz + s * halfD);
        tealGeos.push(front);
      }
    }
    // corner posts
    for (const sx of [1, -1]) {
      for (const sz of [1, -1]) {
        const post = roundedBoxGeometry(0.017, bh - 0.026, 0.017, 0.007, { segments: 6 });
        post.translate(sx * (bw * 0.5 - 0.010), y0 + bh * 0.5, cz + sz * (bd * 0.5 - 0.010));
        tealGeos.push(post);
      }
    }
    // top rim, as a closed rounded-rectangle tube
    {
      const hw = bw * 0.5 - 0.006, hd = bd * 0.5 - 0.006, r = 0.028;
      const pts = [];
      const arcs = [[hw - r, hd - r, 0], [-(hw - r), hd - r, PI / 2], [-(hw - r), -(hd - r), PI], [hw - r, -(hd - r), PI * 1.5]];
      for (const [cx, czz, a0] of arcs) {
        for (let i = 0; i < 6; i++) {
          const a = a0 + (i / 6) * PI / 2;
          pts.push(new THREE.Vector3(cx + Math.cos(a) * r, y1, cz + czz + Math.sin(a) * r));
        }
      }
      const rim = tubeFromPoints(pts, 0.0125, { radialSegs: 10, tubularSegs: 120, closed: true });
      tealGeos.push(rim);
    }
    // brackets up to the steering column, above the leg shield's nose
    for (const s of [1, -1]) {
      const arm = tubeFromPoints([
        new THREE.Vector3(s * 0.062, y0 + 0.150, cz - bd * 0.5 - 0.004),
        new THREE.Vector3(s * 0.052, y0 + 0.200, cz - bd * 0.5 - 0.070),
        new THREE.Vector3(s * 0.034, y0 + 0.246, cz - bd * 0.5 - 0.150),
        new THREE.Vector3(s * 0.026, y0 + 0.262, cz - bd * 0.5 - 0.215),
      ], 0.0085, { radialSegs: 8, tubularSegs: 30 });
      blackGeos.push(arm);
    }
    const crossBar = roundedBoxGeometry(0.140, 0.015, 0.017, 0.006, { segments: 5 });
    crossBar.translate(0, y0 + 0.262, cz - bd * 0.5 - 0.215);
    blackGeos.push(crossBar);
    // clamp that grips the steerer tube
    const clampBar = roundedBoxGeometry(0.086, 0.038, 0.048, 0.012, { segments: 6 });
    clampBar.translate(0, y0 + 0.262, cz - bd * 0.5 - 0.232);
    blackGeos.push(clampBar);

    basket.add(meshOf(mergeGeos(tealGeos), mats.teal));
    basket.add(meshOf(mergeGeos(blackGeos), mats.blackGloss));
    add(basket);
    parts.basket = basket;
  }

  setShadowFlags(group);
  return { group, parts };
}

/** tiny helper: build a loft mesh from sample data (kept local for the brace) */
class THREELoft extends THREE.BufferGeometry {
  constructor(samples) {
    super();
    const pos = [], idx = [];
    const rows = samples.length, cols = samples[0].profile.length;
    for (const s of samples) {
      for (let i = 0; i < cols; i++) {
        const p = s.profile[i];
        pos.push(
          s.o.x + s.x.x * p[0] + s.y.x * p[1],
          s.o.y + s.x.y * p[0] + s.y.y * p[1],
          s.o.z + s.x.z * p[0] + s.y.z * p[1]
        );
      }
    }
    for (let j = 0; j < rows - 1; j++) {
      for (let i = 0; i < cols; i++) {
        const a = j * cols + i, b = j * cols + ((i + 1) % cols);
        const c = (j + 1) * cols + i, d = (j + 1) * cols + ((i + 1) % cols);
        idx.push(a, c, b, b, c, d);
      }
    }
    this.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.setIndex(idx);
    this.computeVertexNormals();
  }
}
