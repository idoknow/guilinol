/**
 * wheels.js — cast 5-spoke wheels with hub motor, disc brake and tyre detail.
 * Local frame: origin at the axle, spin axis = X.
 */
import * as THREE from 'three';
import {
  DEG, makeFender, meshOf, mergeGeos, placed, revolveProfile, ringGeometry,
  roundedBoxGeometry, cylinderBetween, revolveProfile as revolve,
} from '../util/geom.js';

const PI = Math.PI;

function tireProfile(rOut, half) {
  const base = [
    [0.1580, -0.830], [0.1690, -0.950], [0.1860, -1.000], [0.2010, -0.975],
    [0.2130, -0.870], [0.2215, -0.700], [0.2266, -0.430], [0.2280, -0.150],
    [0.2280, 0.150], [0.2266, 0.430], [0.2215, 0.700], [0.2130, 0.870],
    [0.2010, 0.975], [0.1860, 1.000], [0.1690, 0.950], [0.1580, 0.830],
  ];
  return base.map(([r, a]) => [r * (rOut / 0.228), a * half]);
}

export function buildWheel(mats, o = {}) {
  const {
    rOut = 0.228, halfWidth = 0.036, motor = false, disc = false, spokes = 5,
    rimR = 0.158, labels = true,
  } = o;

  const group = new THREE.Group();
  const spin = new THREE.Group();
  group.add(spin);

  /* ---------------------------------------------------------------- tyre */
  const tireLoft = revolveProfile(tireProfile(rOut, halfWidth), { segs: 108 });
  const tireMesh = meshOf(tireLoft.geometry, motor ? mats.tireRear : mats.tireFront);
  spin.add(tireMesh);

  // sidewall lettering strip (subtle, only visible up close)
  if (labels) {
    const swTex = makeSidewallTexture();
    const dMat = mats.decal(swTex, { roughness: 0.75, metalness: 0.0 });
    for (const side of [1, -1]) {
      // build a thin strip that follows the sidewall bulge
      const rows = 64;
      const pos = [], uv = [], idx = [];
      const a0 = side === 1 ? 0.72 : 0.72;
      for (let j = 0; j <= rows; j++) {
        const ang = (j / rows) * PI * 2;
        const radial = new THREE.Vector3(0, Math.cos(ang), Math.sin(ang));
        const prof = [[0.1735 * (rOut / 0.228), side * 0.86 * halfWidth],
        [0.1880 * (rOut / 0.228), side * 0.995 * halfWidth],
        [0.2010 * (rOut / 0.228), side * 1.005 * halfWidth]];
        for (let i = 0; i < prof.length; i++) {
          const p = radial.clone().multiplyScalar(prof[i][0]);
          p.x = prof[i][1];
          pos.push(p.x, p.y, p.z);
          uv.push(j / rows, i / (prof.length - 1));
        }
      }
      const S = 3;
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < S - 1; i++) {
          const a = j * S + i, b = a + 1, c = a + S, d = c + 1;
          if (side === 1) idx.push(a, b, c, b, d, c);
          else idx.push(a, c, b, b, c, d);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, dMat);
      m.castShadow = false; m.receiveShadow = true;
      spin.add(m);
    }
  }

  /* ----------------------------------------------------------------- rim */
  const rimParts = [];
  // outer rim barrel with a machined lip
  const rimShape = new THREE.Shape();
  rimShape.absarc(0, 0, rimR + 0.0135, 0, PI * 2, false);
  const rimHole = new THREE.Path();
  rimHole.absarc(0, 0, rimR - 0.010, 0, PI * 2, true);
  rimShape.holes.push(rimHole);
  const rimGeo = new THREE.ExtrudeGeometry(rimShape, {
    depth: halfWidth * 1.42, bevelEnabled: true, bevelSize: 0.0022,
    bevelThickness: 0.0022, bevelSegments: 2, curveSegments: 72,
  });
  rimGeo.translate(0, 0, -halfWidth * 0.71);
  rimGeo.rotateY(PI / 2);
  rimParts.push(rimGeo);
  // rim well (dark)
  rimParts.push(placed(new THREE.CylinderGeometry(rimR - 0.006, rimR - 0.006, halfWidth * 1.5, 48, 1, true), { r: [0, 0, PI / 2] }));
  const rimMesh = meshOf(mergeGeos(rimParts), mats.blackGloss);
  spin.add(rimMesh);

  // polished rim lip ring
  const lip = ringGeometry(rimR + 0.0145, rimR + 0.0205, 0.004, 64);
  const lipMesh = meshOf(lip, mats.alu);
  lipMesh.geometry.rotateY(PI / 2);
  lipMesh.geometry.translate(0, 0, 0);
  lipMesh.position.x = 0;
  spin.add(lipMesh);

  /* --------------------------------------------------------------- spokes */
  const spokeGeo = buildSpokeGeo(rimR - 0.012, halfWidth);
  for (let i = 0; i < spokes; i++) {
    const g = spokeGeo.clone();
    g.rotateX((i / spokes) * PI * 2);
    const m = meshOf(g, mats.blackGloss);
    spin.add(m);
  }

  /* ------------------------------------------------------------------ hub */
  const hubParts = [];
  if (!motor) {
    // front hub: compact barrel + domed caps
    hubParts.push(placed(new THREE.CylinderGeometry(0.044, 0.044, 0.078, 32), { r: [0, 0, PI / 2] }));
    for (const s of [1, -1]) {
      const cap = revolveProfile([[0.006, s * 0.040], [0.020, s * 0.043], [0.036, s * 0.042], [0.046, s * 0.036], [0.050, s * 0.026]], { segs: 40, center: new THREE.Vector3(0, 0, 0) });
      hubParts.push(cap.geometry);
    }
    // 6 hub bolts
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * PI * 2;
      const b = placed(new THREE.CylinderGeometry(0.0042, 0.0042, 0.012, 6), {
        p: [0.042, Math.cos(a) * 0.030, Math.sin(a) * 0.030], r: [0, 0, PI / 2],
      });
      hubParts.push(b);
    }
  } else {
    // rear hub motor: big finned can
    const R = 0.086;
    hubParts.push(placed(new THREE.CylinderGeometry(R, R * 0.97, 0.108, 56), { r: [0, 0, PI / 2] }));
    // domed covers
    for (const s of [1, -1]) {
      const cap = revolveProfile(
        [[0.008, s * 0.055], [0.030, s * 0.058], [R * 0.55, s * 0.058], [R * 0.82, s * 0.056], [R * 0.97, s * 0.050], [R, s * 0.040]],
        { segs: 56 }
      );
      hubParts.push(cap.geometry);
    }
    // radial cooling fins on both faces
    for (const s of [1, -1]) {
      for (let i = 0; i < 34; i++) {
        const a = (i / 34) * PI * 2;
        const f = new THREE.BoxGeometry(0.0035, 0.048, 0.006);
        f.translate(0, 0.058, 0);
        f.rotateX(a);
        f.translate(s * 0.0565, 0, 0);
        hubParts.push(f);
      }
    }
    // centre cap + bolts
    for (const s of [1, -1]) {
      const cap = placed(new THREE.CylinderGeometry(0.024, 0.028, 0.012, 24), { p: [s * 0.061, 0, 0], r: [0, 0, PI / 2] });
      hubParts.push(cap);
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * PI * 2;
      for (const s of [1, -1]) {
        hubParts.push(placed(new THREE.CylinderGeometry(0.0038, 0.0038, 0.010, 6), {
          p: [s * 0.057, Math.cos(a) * 0.070, Math.sin(a) * 0.070], r: [0, 0, PI / 2],
        }));
      }
    }
  }
  const hubMesh = meshOf(mergeGeos(hubParts), mats.darkAlu);
  spin.add(hubMesh);

  /* ------------------------------------------------------------ disc brake */
  if (disc) {
    const discX = 0.052;
    const shape = new THREE.Shape();
    shape.absarc(0, 0, 0.092, 0, PI * 2, false);
    const hole = new THREE.Path();
    hole.absarc(0, 0, 0.052, 0, PI * 2, true);
    shape.holes.push(hole);
    // lightening holes
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * PI * 2;
      const h = new THREE.Path();
      h.absarc(Math.cos(a) * 0.072, Math.sin(a) * 0.072, 0.0072, 0, PI * 2, true);
      shape.holes.push(h);
    }
    for (let i = 0; i < 6; i++) {
      const a = ((i + 0.5) / 6) * PI * 2;
      const h = new THREE.Path();
      h.absarc(Math.cos(a) * 0.045, Math.sin(a) * 0.045, 0.0045, 0, PI * 2, true);
      shape.holes.push(h);
    }
    const dg = new THREE.ExtrudeGeometry(shape, {
      depth: 0.0035, bevelEnabled: true, bevelSize: 0.0006, bevelThickness: 0.0006, bevelSegments: 1, curveSegments: 40,
    });
    dg.rotateY(PI / 2);
    dg.translate(discX, 0, 0);
    const dm = meshOf(dg, mats.steel);
    spin.add(dm);
    // rotor carrier
    const car = ringGeometry(0.050, 0.056, 0.006, 48);
    car.rotateY(PI / 2);
    car.translate(discX - 0.004, 0, 0);
    spin.add(meshOf(car, mats.blackMetal));
  }

  /* ------------------------------------------------------ axle, valve, misc */
  const axleLen = (halfWidth + 0.055) * 2;
  const axle = meshOf(placed(new THREE.CylinderGeometry(0.0085, 0.0085, axleLen, 16), { r: [0, 0, PI / 2] }), mats.steel);
  spin.add(axle);
  for (const s of [1, -1]) {
    const nut = meshOf(placed(new THREE.CylinderGeometry(0.0135, 0.0135, 0.011, 6), {
      p: [s * (halfWidth + 0.050), 0, 0], r: [0, 0, PI / 2],
    }), mats.blackMetal);
    spin.add(nut);
  }
  // valve stem
  const va = new THREE.Vector3(0.026, Math.cos(0.5) * (rimR - 0.006), Math.sin(0.5) * (rimR - 0.006));
  const vb = new THREE.Vector3(0.045, va.y * 1.03, va.z * 1.03);
  const valve = meshOf(cylinderBetween(va, vb, 0.0035, 0.0035, 8), mats.blackMetal);
  spin.add(valve);
  // factory balance weight
  const wt = meshOf(roundedBoxGeometry(0.026, 0.008, 0.012, 0.003, { segments: 6 }), mats.steel);
  wt.position.set(0, Math.cos(4.4) * (rimR - 0.004), Math.sin(4.4) * (rimR - 0.004));
  wt.rotation.x = -4.4;
  spin.add(wt);

  group.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
  return { group, spin, radius: rOut, tireLoft };
}

/** One tapered, slightly curved mag spoke, in the wheel plane (YZ). */
function buildSpokeGeo(radOut, halfWidth) {
  const stations = [
    { r: 0.048, w: 0.060, h: 0.026, offset: 0 },
    { r: 0.070, w: 0.058, h: 0.024, offset: 0.0035 },
    { r: 0.100, w: 0.050, h: 0.021, offset: 0.0060 },
    { r: 0.130, w: 0.043, h: 0.018, offset: 0.0058 },
    { r: radOut, w: 0.036, h: 0.015, offset: 0.0035 },
  ];
  const X = new THREE.Vector3(1, 0, 0);
  const samples = stations.map((s) => {
    const dir = new THREE.Vector3(0, 1, 0);
    const prof = [];
    const N = 5;
    // rounded rectangle in (lateral, tangential)
    const pts = [];
    const push = (a, b) => pts.push([a, b]);
    const hw = s.h * 0.5, hh = s.w * 0.5, rr = Math.min(hw, hh) * 0.75;
    for (let i = 0; i < N; i++) push(-hw + rr + (2 * (hw - rr) * i) / N, hh);
    for (let i = 0; i < N; i++) {
      const a = PI / 2 + (i / N) * PI / 2;
      push(hw - rr + Math.cos(a) * rr, hh - rr + Math.sin(a) * rr);
    }
    for (let i = 0; i < N; i++) push(hw, hh - rr - (2 * (hh - rr) * i) / N);
    for (let i = 0; i < N; i++) {
      const a = PI + (i / N) * PI / 2;
      push(hw - rr + Math.cos(a) * rr, -hh + rr + Math.sin(a) * rr);
    }
    for (let i = 0; i < N; i++) push(hw - rr - (2 * (hw - rr) * i) / N, -hh);
    for (let i = 0; i < N; i++) {
      const a = -PI / 2 + (i / N) * PI / 2;
      push(-hw + rr + Math.cos(a) * rr, -hh + rr + Math.sin(a) * rr);
    }
    for (let i = 0; i < N; i++) push(-hw, -hh + rr + (2 * (hh - rr) * i) / N);
    for (let i = 0; i < N; i++) {
      const a = (i / N) * PI / 2;
      push(-hw + rr + Math.cos(a) * rr, hh - rr + Math.sin(a) * rr);
    }
    return {
      o: new THREE.Vector3(0, s.r, s.offset),
      x: new THREE.Vector3(1, 0, 0),
      y: new THREE.Vector3(0, 0, 1),
      profile: pts,
    };
  });
  // eslint-disable-next-line no-undef
  return revolveSpoke(samples);
}

function revolveSpoke(samples) {
  // local import-free copy of the loft (keeps the module dependency-light)
  const pos = [], nor = [], uv = [], idx = [];
  const rows = samples.length, cols = samples[0].profile.length;
  const world = (s, a, b) => new THREE.Vector3(
    s.o.x + s.x.x * a + s.y.x * b,
    s.o.y + s.x.y * a + s.y.y * b,
    s.o.z + s.x.z * a + s.y.z * b
  );
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i <= cols; i++) {
      const p = samples[j].profile[i % cols];
      const w = world(samples[j], p[0], p[1]);
      pos.push(w.x, w.y, w.z);
      uv.push(i / cols, j / (rows - 1));
    }
  }
  const stride = cols + 1;
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * stride + i, b = a + 1, c = a + stride, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  // caps
  for (const [j, flip] of [[0, true], [rows - 1, false]]) {
    let cx = 0, cy = 0, cz = 0;
    for (const p of samples[j].profile) {
      const w = world(samples[j], p[0], p[1]);
      cx += w.x; cy += w.y; cz += w.z;
    }
    const n = samples[j].profile.length;
    const cIdx = pos.length / 3;
    pos.push(cx / n, cy / n, cz / n);
    uv.push(0.5, 0.5);
    const base = j * stride;
    for (let i = 0; i < cols; i++) {
      if (flip) idx.push(cIdx, base + i + 1, base + i);
      else idx.push(cIdx, base + i, base + i + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // ensure outward winding via signed volume
  const p = g.attributes.position;
  let vol = 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const index = g.index;
  for (let i = 0; i < index.count; i += 3) {
    a.fromBufferAttribute(p, index.getX(i));
    b.fromBufferAttribute(p, index.getX(i + 1));
    c.fromBufferAttribute(p, index.getX(i + 2));
    vol += a.dot(b.clone().cross(c)) / 6;
  }
  if (vol < 0) {
    const arr = index.array;
    for (let i = 0; i < arr.length; i += 3) { const t = arr[i + 1]; arr[i + 1] = arr[i + 2]; arr[i + 2] = t; }
    g.computeVertexNormals();
  }
  return g;
}

function makeSidewallTexture() {
  const c = document.createElement('canvas');
  c.width = 2048; c.height = 96;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.fillStyle = 'rgba(58,62,64,0.92)';
  ctx.font = '700 54px "Inter","Helvetica Neue",Arial,sans-serif';
  ctx.textBaseline = 'middle';
  const text = 'QINGJU  E-BIKE   14×2.50   TUBELESS   ';
  ctx.fillText(text, 20, c.height * 0.52);
  ctx.fillText(text, 20 + ctx.measureText(text).width, c.height * 0.52);
  ctx.font = '600 30px "Inter","Helvetica Neue",Arial,sans-serif';
  ctx.fillStyle = 'rgba(52,56,58,0.8)';
  ctx.fillText('MAX 340 kPa', 1600, c.height * 0.86);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 8;
  return t;
}

/* ---------------------------------------------------------------- fenders */
export function buildFrontFender(mats) {
  const center = new THREE.Vector3(0, 0, 0);
  const f = makeFender({
    center, rIn: 0.242, rOut: 0.300, halfWidth: 0.050,
    a0: -52, a1: 196, segs: 120, curl: 0.028, lateralSegs: 9, taper: 0.25,
  });
  const m = meshOf(f.geometry, mats.teal);
  const g = new THREE.Group();
  g.add(m);
  // dark inner liner
  const liner = makeFender({
    center, rIn: 0.232, rOut: 0.242, halfWidth: 0.046,
    a0: -50, a1: 194, segs: 90, curl: 0.024, lateralSegs: 7,
  });
  g.add(meshOf(liner.geometry, mats.plasticSoft));
  // leading edge trim
  return { group: g, loft: f };
}

export function buildRearFender(mats) {
  const center = new THREE.Vector3(0, 0, 0);
  const f = makeFender({
    center, rIn: 0.245, rOut: 0.305, halfWidth: 0.150,
    a0: 22, a1: 208, segs: 130, curl: 0.030, lateralSegs: 12, taper: 0.22,
  });
  const g = new THREE.Group();
  g.add(meshOf(f.geometry, mats.teal));
  const liner = makeFender({
    center, rIn: 0.236, rOut: 0.245, halfWidth: 0.140,
    a0: 20, a1: 206, segs: 90, curl: 0.026, lateralSegs: 8,
  });
  g.add(meshOf(liner.geometry, mats.plasticSoft));
  return { group: g, loft: f };
}
