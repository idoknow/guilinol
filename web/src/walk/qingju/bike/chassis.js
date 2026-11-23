/**
 * chassis.js — the teal monocoque: leg shield, footboard, rear body,
 * mudguards, swingarm, lighting and every bolt-on detail.
 */
import * as THREE from 'three';
import {
  loftSectionsY, loftSectionsZ, makeLoft, decalGeometry, sideURange, uRangeForCoord,
  meshOf, mergeGeos, setShadowFlags, placed, roundedBoxGeometry, ringGeometry, cylinderBetween,
  tubeFromPoints, springGeometry, clamp, DEG, makeFender,
} from '../util/geom.js';
import * as T from '../util/textures.js';
import { DIM, axisAtY } from './dims.js';
import { getVehicle } from '../vehicle.js';

const { PI } = Math;

export function buildChassis(mats) {
  const vehicle = getVehicle();
  const group = new THREE.Group();
  group.name = 'chassis';
  const parts = {};
  const add = (m) => { group.add(m); return m; };

  /* ==================================================== leg shield ======= */
  const shieldSections = [
    { y: 0.240, zF: 0.395, zB: 0.215, w: 0.300, rF: 0.045, rB: 0.065 },
    { y: 0.320, zF: 0.435, zB: 0.228, w: 0.315, rF: 0.050, rB: 0.070 },
    { y: 0.400, zF: 0.485, zB: 0.245, w: 0.322, rF: 0.055, rB: 0.075 },
    { y: 0.480, zF: 0.545, zB: 0.262, w: 0.322, rF: 0.060, rB: 0.080 },
    { y: 0.560, zF: 0.590, zB: 0.278, w: 0.320, rF: 0.070, rB: 0.085 },
    { y: 0.620, zF: 0.612, zB: 0.290, w: 0.316, rF: 0.085, rB: 0.090 },
    { y: 0.700, zF: 0.600, zB: 0.302, w: 0.310, rF: 0.090, rB: 0.095 },
    { y: 0.780, zF: 0.565, zB: 0.312, w: 0.300, rF: 0.085, rB: 0.098 },
    { y: 0.860, zF: 0.525, zB: 0.318, w: 0.288, rF: 0.080, rB: 0.098 },
    { y: 0.920, zF: 0.495, zB: 0.320, w: 0.276, rF: 0.078, rB: 0.096 },
    { y: 0.960, zF: 0.474, zB: 0.318, w: 0.262, rF: 0.075, rB: 0.092 },
    { y: 0.985, zF: 0.458, zB: 0.310, w: 0.238, rF: 0.068, rB: 0.085 },
    { y: 1.000, zF: 0.440, zB: 0.300, w: 0.205, rF: 0.055, rB: 0.070 },
  ];
  const shield = loftSectionsY(shieldSections, { segments: 90, edgeSegs: 9, cornerSegs: 14 });
  add(meshOf(shield.geometry, mats.teal));
  parts.shield = shield;

  // white front graphic panel (wraps the nose, opaque)
  {
    const dec = decalGeometry(shield, {
      u0: -0.104, u1: 0.202, v0: 0.520, v1: 0.936,
      offset: 0.0018, project: 'xy', uSegs: 40, vSegs: 44,
    });
    const tex = T.makeShieldPanelDecal(dec.size.x, dec.size.y);
    const mesh = new THREE.Mesh(dec.geometry, mats.decal(tex, { roughness: 0.24, metalness: 0.04 }));
    mesh.receiveShadow = true;
    add(mesh);
    parts.shieldPanel = mesh;
  }

  // shield grille decal on both flanks (recessed vents)
  {
    const ventTex = T.makeVentDecal(0.075, 0.048);
    for (const s of [1, -1]) {
      const dec = decalGeometry(shield, {
        u0: s > 0 ? 0.755 : 0.255, u1: s > 0 ? 0.845 : 0.345,
        v0: 0.055, v1: 0.135,
        offset: 0.0016, project: 'yz', uSegs: 10, vSegs: 8, flipU: s > 0,
      });
      add(new THREE.Mesh(dec.geometry, mats.decal(ventTex, { roughness: 0.6 })));
    }
  }

  // inset headlamp in the shield's nose, just above the front tyre
  {
    const insetHeadlamp = new THREE.Group();
    // recessed bezel sunk into the panel
    const bezel = meshOf(roundedBoxGeometry(0.158, 0.078, 0.028, 0.018, { segments: 10 }), mats.plastic);
    bezel.position.set(0, 0.612, 0.601);
    bezel.rotation.x = 0.16;
    insetHeadlamp.add(bezel);
    // inner reflector
    const reflector = meshOf(roundedBoxGeometry(0.140, 0.062, 0.012, 0.014, { segments: 8 }), mats.chrome);
    reflector.position.set(0, 0.612, 0.6115);
    reflector.rotation.x = 0.16;
    insetHeadlamp.add(reflector);
    // lens
    const lens = meshOf(roundedBoxGeometry(0.128, 0.050, 0.014, 0.014, { segments: 10 }), mats.lensHead);
    lens.position.set(0, 0.612, 0.6175);
    lens.rotation.x = 0.16;
    insetHeadlamp.add(lens);
    parts.shieldLens = lens;
    // LED day-running strips either side
    for (const s of [1, -1]) {
      const strip = meshOf(roundedBoxGeometry(0.052, 0.010, 0.008, 0.004, { segments: 6 }), mats.lensHead);
      strip.position.set(s * 0.050, 0.5665, 0.6115);
      strip.rotation.x = 0.16;
      strip.rotation.z = s * -0.16;
      insetHeadlamp.add(strip);
    }
    // small projector in the middle
    const proj = meshOf(new THREE.CylinderGeometry(0.021, 0.024, 0.014, 20), mats.lensHead);
    proj.rotation.x = Math.PI / 2 + 0.16;
    proj.position.set(0, 0.612, 0.6245);
    insetHeadlamp.add(proj);
    add(insetHeadlamp);
    parts.insetHeadlamp = insetHeadlamp;
  }

  // bag hook on the rider-facing side of the leg shield
  {
    const hook = new THREE.Group();
    const base = meshOf(roundedBoxGeometry(0.034, 0.046, 0.012, 0.010, { segments: 8 }), mats.plastic);
    base.position.set(0, 0.662, 0.2925);
    base.rotation.x = 0.12;
    hook.add(base);
    const arm = meshOf(tubeFromPoints([
      new THREE.Vector3(0, 0.664, 0.288),
      new THREE.Vector3(0, 0.658, 0.266),
      new THREE.Vector3(0, 0.647, 0.252),
      new THREE.Vector3(0, 0.652, 0.242),
      new THREE.Vector3(0, 0.668, 0.240),
    ], 0.0085, { radialSegs: 10, tubularSegs: 26 }), mats.plastic);
    hook.add(arm);
    add(hook);
    parts.hook = hook;
  }

  // charging port flap on the shield's right flank
  {
    const flap = meshOf(roundedBoxGeometry(0.012, 0.048, 0.048, 0.008, { segments: 8 }), mats.plasticSoft);
    flap.position.set(0.160, 0.430, 0.320);
    add(flap);
  }

  /* ======================================================== footboard ==== */
  const deckSections = [
    { z: -0.302, y0: 0.170, y1: 0.256, w: 0.240, rT: 0.030, rB: 0.044 },
    { z: -0.272, y0: 0.156, y1: 0.268, w: 0.292, rT: 0.032, rB: 0.050 },
    { z: -0.180, y0: 0.148, y1: 0.272, w: 0.310, rT: 0.032, rB: 0.052 },
    { z: 0.000, y0: 0.146, y1: 0.274, w: 0.316, rT: 0.030, rB: 0.054 },
    { z: 0.180, y0: 0.146, y1: 0.274, w: 0.316, rT: 0.030, rB: 0.054 },
    { z: 0.320, y0: 0.154, y1: 0.272, w: 0.306, rT: 0.032, rB: 0.050 },
    { z: 0.398, y0: 0.172, y1: 0.266, w: 0.282, rT: 0.038, rB: 0.044 },
    { z: 0.442, y0: 0.196, y1: 0.254, w: 0.238, rT: 0.040, rB: 0.040 },
  ];
  const deck = loftSectionsZ(deckSections, { segments: 40, edgeSegs: 8, cornerSegs: 10 });
  add(meshOf(deck.geometry, mats.tealSolid));
  parts.deck = deck;

  // folding footpegs on both flanks
  for (const s of [1, -1]) {
    const peg = new THREE.Group();
    const hinge = meshOf(roundedBoxGeometry(0.030, 0.046, 0.052, 0.012, { segments: 8 }), mats.plastic);
    hinge.position.set(s * 0.150, 0.262, -0.118);
    peg.add(hinge);
    const shaft = meshOf(new THREE.CylinderGeometry(0.0135, 0.0135, 0.058, 14), mats.blackMetal);
    shaft.rotation.z = PI / 2;
    shaft.position.set(s * 0.196, 0.258, -0.118);
    peg.add(shaft);
    const cap = meshOf(new THREE.CylinderGeometry(0.0155, 0.0155, 0.030, 14), mats.gripRubber);
    cap.rotation.z = PI / 2;
    cap.position.set(s * 0.222, 0.258, -0.118);
    peg.add(cap);
    add(peg);
    parts['peg' + s] = peg;
  }

  /* =================================================== rear body ======== */
  const rearSections = [
    { y: 0.208, zF: -0.180, zB: -0.300, w: 0.282, rF: 0.040, rB: 0.055 },
    { y: 0.280, zF: -0.188, zB: -0.330, w: 0.300, rF: 0.050, rB: 0.065 },
    { y: 0.350, zF: -0.194, zB: -0.365, w: 0.311, rF: 0.060, rB: 0.075 },
    { y: 0.410, zF: -0.200, zB: -0.430, w: 0.316, rF: 0.070, rB: 0.085 },
    { y: 0.470, zF: -0.208, zB: -0.700, w: 0.316, rF: 0.080, rB: 0.100 },
    { y: 0.530, zF: -0.215, zB: -0.822, w: 0.312, rF: 0.090, rB: 0.110 },
    { y: 0.590, zF: -0.222, zB: -0.850, w: 0.305, rF: 0.100, rB: 0.120 },
    { y: 0.640, zF: -0.232, zB: -0.848, w: 0.300, rF: 0.105, rB: 0.125 },
    { y: 0.672, zF: -0.246, zB: -0.828, w: 0.296, rF: 0.110, rB: 0.128 },
    { y: 0.695, zF: -0.272, zB: -0.790, w: 0.288, rF: 0.108, rB: 0.126 },
    { y: 0.706, zF: -0.312, zB: -0.740, w: 0.268, rF: 0.096, rB: 0.112 },
  ];
  const rear = loftSectionsY(rearSections, { segments: 80, edgeSegs: 9, cornerSegs: 12 });
  add(meshOf(rear.geometry, mats.teal));
  parts.rearBody = rear;

  // side brand decals
  for (const s of [1, -1]) {
    const ur = uRangeForCoord(rear, 0.60, {
      coord: 'z', min: -0.78, max: -0.30, side: s, axis: 'x', threshold: 0.22,
    });
    const dec = decalGeometry(rear, {
      u0: ur[0] + 0.004, u1: ur[1] - 0.004, v0: 0.292, v1: 0.892,
      offset: 0.0018, project: 'yz', uSegs: 26, vSegs: 30, flipU: s > 0,
    });
    const tex = T.makeSidePanelDecal(dec.size.x, dec.size.y);
    add(new THREE.Mesh(dec.geometry, mats.decal(tex, { roughness: 0.3 })));
  }

  // rear fender / wheel cover
  const rearFender = makeFender({
    center: new THREE.Vector3(0, DIM.rearAxle.y, DIM.rearAxle.z),
    rIn: 0.238, rOut: 0.256, halfWidth: 0.150,
    a0: -76, a1: 52, segs: 100, curl: 0.004, lateralSegs: 11, taper: 0.32,
  });
  add(meshOf(rearFender.geometry, mats.teal));
  parts.rearFender = rearFender;

  // inner fender liner
  {
    const liner = makeFender({
      center: new THREE.Vector3(0, DIM.rearAxle.y, DIM.rearAxle.z),
      rIn: 0.233, rOut: 0.238, halfWidth: 0.140,
      a0: -74, a1: 50, segs: 90, curl: 0.004, lateralSegs: 8,
    });
    add(meshOf(liner.geometry, mats.plasticSoft));
  }

  // rear reflector on the fender tail
  {
    const refl = meshOf(roundedBoxGeometry(0.058, 0.024, 0.008, 0.006), mats.reflectorRed);
    refl.position.set(0, 0.318, -0.856);
    refl.rotation.x = 0.55;
    add(refl);
  }

  /* ================================================ tail light & plate == */
  {
    const housing = meshOf(roundedBoxGeometry(0.150, 0.062, 0.030, 0.014, { segments: 10 }), mats.plastic);
    housing.position.set(0, 0.660, -0.858);
    housing.rotation.x = -0.16;
    add(housing);
    const lens = meshOf(roundedBoxGeometry(0.132, 0.040, 0.014, 0.010, { segments: 10 }), mats.lensTail);
    lens.position.set(0, 0.659, -0.872);
    lens.rotation.x = -0.16;
    add(lens);
    parts.tailLens = lens;
    // licence plate assembly
    const bracket = meshOf(roundedBoxGeometry(0.100, 0.130, 0.014, 0.010, { segments: 8 }), mats.plastic);
    bracket.position.set(0, 0.545, -0.868);
    bracket.rotation.x = 0.20;
    add(bracket);
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(0.190, 0.105),
      mats.decal(T.makePlateDecal(0.190, 0.105, vehicle.region, vehicle.plate), { roughness: 0.35, metalness: 0.15 })
    );
    plate.position.set(0, 0.548, -0.8785);
    plate.rotation.x = 0.20;
    plate.rotation.y = PI;
    add(plate);
    parts.plate = plate;
    // plate frame
    const frame = meshOf(roundedBoxGeometry(0.202, 0.117, 0.006, 0.008, { segments: 8 }), mats.blackMetal);
    frame.position.set(0, 0.548, -0.8745);
    frame.rotation.x = 0.20;
    frame.rotation.y = PI;
    add(frame);
  }

  /* ======================================================= grab rail ==== */
  {
    const rail = tubeFromPoints([
      new THREE.Vector3(-0.104, 0.712, -0.600),
      new THREE.Vector3(-0.100, 0.744, -0.672),
      new THREE.Vector3(-0.062, 0.756, -0.706),
      new THREE.Vector3(0.000, 0.758, -0.716),
      new THREE.Vector3(0.062, 0.756, -0.706),
      new THREE.Vector3(0.100, 0.744, -0.672),
      new THREE.Vector3(0.104, 0.712, -0.600),
    ], 0.0105, { radialSegs: 10, tubularSegs: 48 });
    add(meshOf(rail, mats.blackGloss));
    // mounting bosses
    for (const s of [1, -1]) {
      const boss = meshOf(new THREE.CylinderGeometry(0.016, 0.018, 0.020, 12), mats.blackGloss);
      boss.position.set(s * 0.104, 0.706, -0.598);
      add(boss);
    }
  }

  /* ==================================================== swingarm, shocks = */
  {
    const armGeo = [];
    for (const s of [1, -1]) {
      const a1 = new THREE.Vector3(s * 0.100, 0.320, -0.300);
      const a2 = new THREE.Vector3(s * 0.098, 0.240, -0.620);
      const seg = cylinderBetween(a1, a2, 0.019, 0.016, 12);
      armGeo.push(roundedBoxGeoBetween(a1, a2, 0.026, 0.030));
      void seg;
    }
    add(meshOf(mergeGeos(armGeo), mats.blackMetal));
    // axle plates
    for (const s of [1, -1]) {
      const plate = meshOf(roundedBoxGeometry(0.016, 0.070, 0.052, 0.010, { segments: 8 }), mats.blackMetal);
      plate.position.set(s * 0.105, 0.238, -0.620);
      add(plate);
    }
    // coil-over shocks
    parts.shocks = [];
    for (const s of [1, -1]) {
      const sg = new THREE.Group();
      const top = new THREE.Vector3(s * 0.112, 0.516, -0.404);
      const bot = new THREE.Vector3(s * 0.118, 0.288, -0.548);
      const body = meshOf(cylinderBetween(bot, bot.clone().lerp(top, 0.55), 0.016, 0.019, 14), mats.blackMetal);
      sg.add(body);
      const rod = meshOf(cylinderBetween(bot.clone().lerp(top, 0.5), top, 0.0085, 0.0085, 10), mats.chrome);
      sg.add(rod);
      const spring = meshOf(springGeometry(bot.clone().lerp(top, 0.10), bot.clone().lerp(top, 0.88), {
        coils: 7.5, radius: 0.026, wire: 0.0048, segments: 260,
      }), mats.springSteel);
      sg.add(spring);
      const capTop = meshOf(new THREE.CylinderGeometry(0.021, 0.021, 0.012, 12), mats.blackMetal);
      capTop.position.copy(top);
      capTop.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().sub(bot).normalize());
      sg.add(capTop);
      add(sg);
      parts.shocks.push(sg);
    }
  }

  /* ======================================================= kickstand ==== */
  {
    const stand = new THREE.Group();
    const pivot = new THREE.Vector3(0.128, 0.300, -0.318);
    stand.position.copy(pivot);
    const arm = meshOf(roundedBoxGeometry(0.020, 0.250, 0.040, 0.008, { segments: 8 }), mats.blackMetal);
    arm.position.set(0.010, -0.120, -0.045);
    arm.rotation.x = 0.30;
    stand.add(arm);
    const foot = meshOf(roundedBoxGeometry(0.028, 0.016, 0.060, 0.006, { segments: 8 }), mats.blackMetal);
    foot.position.set(0.016, -0.246, -0.086);
    foot.rotation.x = 0.30;
    stand.add(foot);
    const spring = meshOf(springGeometry(new THREE.Vector3(0.004, -0.030, 0.010), new THREE.Vector3(0.010, -0.100, -0.010), {
      coils: 4, radius: 0.010, wire: 0.0022, segments: 90,
    }), mats.springSteel);
    stand.add(spring);
    add(stand);
    parts.kickstand = stand;
  }

  /* ================================================= frame (hidden) ==== */
  {
    // a short harness stub that stays inside the bodywork, plus the rear brake
    // hose that follows the swingarm
    const hoses = [];
    hoses.push(tubeFromPoints([
      new THREE.Vector3(0.112, 0.470, -0.470),
      new THREE.Vector3(0.118, 0.400, -0.520),
      new THREE.Vector3(0.108, 0.320, -0.585),
      new THREE.Vector3(0.100, 0.262, -0.615),
    ], 0.0042, { radialSegs: 8, tubularSegs: 34 }));
    add(meshOf(mergeGeos(hoses), mats.cable));
  }

  setShadowFlags(group);
  return { group, parts };
}

/* ------------------------------------------------------------- utilities */
function lerpAngle(a, b, t) { return a + (b - a) * t; }

function interpArr(arr, t) {
  const n = arr.length - 1;
  const x = clamp(t, 0, 1) * n;
  const i = Math.min(Math.floor(x), n - 1);
  const f = x - i;
  const out = {};
  for (const k of Object.keys(arr[0])) out[k] = arr[i][k] + (arr[i + 1][k] - arr[i][k]) * f;
  return out;
}

function ringProfile(halfW, zF, zB, r) {
  const pts = [];
  const n = 16;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * PI * 2;
    pts.push([halfW * Math.cos(a), (zF + zB) * 0.5 + (zF - zB) * 0.5 * Math.sin(a)]);
  }
  return pts;
}

/** a rectangular beam between two points (used for the swingarm) */
function roundedBoxGeoBetween(a, b, w, h) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const geo = roundedBoxGeometry(w, h, len, Math.min(w, h) * 0.4, { segments: 12 });
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.clone().normalize());
  m.compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
  geo.applyMatrix4(m);
  return geo;
}
