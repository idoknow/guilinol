/**
 * geom.js — parametric geometry toolkit for the Qingju e-bike model.
 *
 * Coordinate system (bike local space):
 *   +X = rider's right,  +Y = up,  +Z = forward.  1 unit = 1 metre.
 *
 * Everything is built from a single primitive: `makeLoft(samples)` — a
 * grid of cross-section profiles placed on frames.  It returns not only a
 * buffer geometry but also an analytic surface sampler, which lets decals
 * be generated that follow the bodywork to within a fraction of a mm.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export { mergeGeometries };

/* ------------------------------------------------------------------ math */
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, x) => (x - a) / (b - a);
export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const DEG = Math.PI / 180;
export const UP = new THREE.Vector3(0, 1, 0);

/** small deterministic PRNG so the scene is identical on every load */
export function makeRandom(seed = 1337) {
  let s = seed >>> 0;
  return function random() {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

/** interpolate an array of plain-number records (uniform parameter v in [0,1]) */
export function interpSections(secs, v) {
  const n = secs.length;
  if (n === 1) return { ...secs[0] };
  const x = clamp(v, 0, 1) * (n - 1);
  const i = Math.min(Math.floor(x), n - 2);
  const t = x - i;
  const a = Math.max(0, i - 1), b = i, c = i + 1, d = Math.min(n - 1, i + 2);
  const out = {};
  for (const k in secs[0]) {
    const va = secs[a][k], vb = secs[b][k], vc = secs[c][k], vd = secs[d][k];
    if (typeof vb === 'number' && typeof vc === 'number') {
      let val = catmull(va ?? vb, vb, vc, vd ?? vc, t);
      // guard against overshoot turning dimensions negative / non-monotonic
      if (k === 'y' || k === 'z') val = clamp(val, Math.min(vb, vc), Math.max(vb, vc));
      if (k === 'w' || k === 'h' || k === 'rF' || k === 'rB' || k === 'rT' || k === 'rB2' ||
          k === 'zF' || k === 'zB' || k === 'y0' || k === 'y1' || k === 'd') {
        if (k !== 'zF' && k !== 'zB' && k !== 'y0' && k !== 'y1' && k !== 'z') val = Math.max(val, 1e-4);
      }
      out[k] = val;
    } else out[k] = vb;
  }
  return out;
}

/* -------------------------------------------------------- 2D cross sections */
/**
 * Rounded rectangle in the (u,v) plane, returned as a closed point loop.
 * `rp` rounds the +v end, `rn` the -v end.  Always the same point count:
 * 4 * (edgeSegs + cornerSegs).
 */
export function roundedRect(w, h, rp, rn, edgeSegs = 6, cornerSegs = 8) {
  const hw = w * 0.5, hh = h * 0.5;
  rp = clamp(rp, 0.0005, Math.min(hw - 0.0005, hh - 0.0005));
  rn = clamp(rn, 0.0005, Math.min(hw - 0.0005, hh - 0.0005));
  const pts = [];
  const push = (u, v) => pts.push([u, v]);
  // +v edge, running from +u toward -u
  for (let i = 0; i < edgeSegs; i++) {
    const t = i / edgeSegs;
    push(lerp(hw - rp, -hw + rp, t), hh);
  }
  // top-left corner (from +v edge to -u edge)
  for (let i = 0; i < cornerSegs; i++) {
    const a = Math.PI * 0.5 + (i / cornerSegs) * Math.PI * 0.5;
    push(-hw + rp + Math.cos(a) * rp, hh - rp + Math.sin(a) * rp);
  }
  // -u edge, from +v toward -v
  for (let i = 0; i < edgeSegs; i++) {
    const t = i / edgeSegs;
    push(-hw, lerp(hh - rp, -hh + rn, t));
  }
  // bottom-left corner
  for (let i = 0; i < cornerSegs; i++) {
    const a = Math.PI + (i / cornerSegs) * Math.PI * 0.5;
    push(-hw + rn + Math.cos(a) * rn, -hh + rn + Math.sin(a) * rn);
  }
  // -v edge, running from -u toward +u
  for (let i = 0; i < edgeSegs; i++) {
    const t = i / edgeSegs;
    push(lerp(-hw + rn, hw - rn, t), -hh);
  }
  // bottom-right corner
  for (let i = 0; i < cornerSegs; i++) {
    const a = -Math.PI * 0.5 + (i / cornerSegs) * Math.PI * 0.5;
    push(hw - rn + Math.cos(a) * rn, -hh + rn + Math.sin(a) * rn);
  }
  // +u edge, from -v toward +v
  for (let i = 0; i < edgeSegs; i++) {
    const t = i / edgeSegs;
    push(hw, lerp(-hh + rn, hh - rp, t));
  }
  // top-right corner
  for (let i = 0; i < cornerSegs; i++) {
    const a = 0 + (i / cornerSegs) * Math.PI * 0.5;
    push(hw - rp + Math.cos(a) * rp, hh - rp + Math.sin(a) * rp);
  }
  return pts;
}

/* ------------------------------------------------------------------- loft */
/**
 * Build a closed lofted surface from an array of samples:
 *   { o:Vector3 origin, x:Vector3, y:Vector3, profile:[[a,b],...] }
 * All profiles must share the same point count.
 *
 * Returns { geometry, point(u,v), normal(u,v), rows, cols }.
 */
export function makeLoft(samples, opts = {}) {
  const { capStart = true, capEnd = true, vSmooth = true, flipNormals = false, flipWinding = false } = opts;
  const rows = samples.length;
  const cols = samples[0].profile.length;

  const world = (s, a, b, target = new THREE.Vector3()) =>
    target.set(
      s.o.x + s.x.x * a + s.y.x * b,
      s.o.y + s.x.y * a + s.y.y * b,
      s.o.z + s.x.z * a + s.y.z * b
    );

  // ---- sample the surface analytically (periodic in u) ----
  const wrapIndex = (i) => ((i % cols) + cols) % cols;
  function rowAt(v) {
    const f = clamp(v, 0, 1) * (rows - 1);
    const i = Math.min(Math.floor(f), rows - 2);
    const t = f - i;
    return { i, t: rows === 1 ? 0 : t };
  }
  function profilePoint(ri, t, u) {
    const s0 = samples[ri], s1 = samples[ri + 1] ?? samples[ri];
    const f = (((u % 1) + 1) % 1) * cols;
    const ci = Math.floor(f), ct = f - ci;
    const a0 = s0.profile[wrapIndex(ci)], a1 = s0.profile[wrapIndex(ci + 1)];
    const b0 = s1.profile[wrapIndex(ci)], b1 = s1.profile[wrapIndex(ci + 1)];
    const au = lerp(a0[0], a1[0], ct), av = lerp(a0[1], a1[1], ct);
    const bu = lerp(b0[0], b1[0], ct), bv = lerp(b0[1], b1[1], ct);
    return [lerp(au, bu, t), lerp(av, bv, t)];
  }
  const point = (u, v, target = new THREE.Vector3()) => {
    const { i, t } = rowAt(v);
    const s0 = samples[i];
    const s1 = samples[Math.min(i + 1, rows - 1)];
    const p = profilePoint(i, t, u);
    // blend the frame as well as the profile, otherwise the surface has a
    // y-staircase between rows and du×dv collapses to a constant axis
    const ox = lerp(s0.o.x, s1.o.x, t), oy = lerp(s0.o.y, s1.o.y, t), oz = lerp(s0.o.z, s1.o.z, t);
    const xx = lerp(s0.x.x, s1.x.x, t), xy = lerp(s0.x.y, s1.x.y, t), xz = lerp(s0.x.z, s1.x.z, t);
    const yx = lerp(s0.y.x, s1.y.x, t), yy = lerp(s0.y.y, s1.y.y, t), yz = lerp(s0.y.z, s1.y.z, t);
    return target.set(
      ox + xx * p[0] + yx * p[1],
      oy + xy * p[0] + yy * p[1],
      oz + xz * p[0] + yz * p[1]
    );
  };
  // per-row centroid of the cross-section, in profile space — used to orient
  // normals outward for any closed swept profile (bodies, tyres, fenders).
  const centroids = samples.map((s) => {
    let a = 0, b = 0;
    for (const p of s.profile) { a += p[0]; b += p[1]; }
    return [a / s.profile.length, b / s.profile.length];
  });
  const centerPoint = (v, target = new THREE.Vector3()) => {
    const { i, t } = rowAt(v);
    const s0 = samples[i], s1 = samples[i + 1] ?? samples[i];
    const c0 = centroids[i], c1 = centroids[Math.min(i + 1, centroids.length - 1)];
    const cu = lerp(c0[0], c1[0], t), cv = lerp(c0[1], c1[1], t);
    const ox = lerp(s0.o.x, s1.o.x, t), oy = lerp(s0.o.y, s1.o.y, t), oz = lerp(s0.o.z, s1.o.z, t);
    const xx = lerp(s0.x.x, s1.x.x, t), xy = lerp(s0.x.y, s1.x.y, t), xz = lerp(s0.x.z, s1.x.z, t);
    const yx = lerp(s0.y.x, s1.y.x, t), yy = lerp(s0.y.y, s1.y.y, t), yz = lerp(s0.y.z, s1.y.z, t);
    return target.set(
      ox + xx * cu + yx * cv,
      oy + xy * cu + yy * cv,
      oz + xz * cu + yz * cv
    );
  };
  const normal = (u, v, target = new THREE.Vector3()) => {
    const e = 1e-3;
    const vv = clamp(v, e, 1 - e);
    const p = point(u, vv);
    const pu = point(u + e, vv);
    const pv = point(u, vv + e);
    const du = pu.sub(p);
    const dv = pv.sub(p);
    target.crossVectors(du, dv).normalize();
    const c = centerPoint(vv);
    const radial = p.clone().sub(c);
    if (target.dot(radial) < 0) target.negate();
    if (flipNormals) target.negate();
    return target;
  };

  // ---- build the grid (an extra column duplicates u=0 for UV continuity) ----
  const pos = [], nor = [], uv = [], idx = [];
  const tmpN = new THREE.Vector3();
  for (let j = 0; j < rows; j++) {
    const v = j / (rows - 1);
    for (let i = 0; i <= cols; i++) {
      const u = i / cols;
      const p = point(u, v);
      const n = normal(u, v, tmpN);
      pos.push(p.x, p.y, p.z);
      nor.push(n.x, n.y, n.z);
      uv.push(u, v);
    }
  }
  const stride = cols + 1;
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * stride + i, b = a + 1, c = a + stride, d = c + 1;
      if (flipWinding) idx.push(a, b, c, b, d, c);
      else idx.push(a, c, b, b, c, d);
    }
  }
  // ---- caps (triangle fan around the profile centroid) ----
  function addCap(j, sign) {
    const v = j / (rows - 1);
    const s = samples[j];
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < cols; i++) {
      const p = point(i / cols, v);
      cx += p.x; cy += p.y; cz += p.z;
    }
    cx /= cols; cy /= cols; cz /= cols;
    const cIdx = pos.length / 3;
    pos.push(cx, cy, cz);
    const n = new THREE.Vector3().subVectors(centerPoint(v), s.o).normalize();
    // cap normal = direction along the loft axis (frame y is the "forward" of the path for our bodies)
    const axis = new THREE.Vector3();
    if (j === 0) axis.subVectors(samples[0].o, samples[1].o);
    else axis.subVectors(samples[rows - 1].o, samples[rows - 2].o);
    axis.normalize();
    nor.push(axis.x, axis.y, axis.z);
    uv.push(0.5, 0.5);
    const base = j * stride;
    for (let i = 0; i < cols; i++) {
      const a = base + i, b = base + i + 1;
      // caps are emitted with both windings so an end face can never be culled
      idx.push(cIdx, a, b, cIdx, b, a);
    }
  }
  if (capStart) addCap(0, -1);
  if (capEnd) addCap(rows - 1, 1);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(idx);
  geometry.computeBoundingSphere();
  return { geometry, point, normal, rows, cols };
}

/** Loft horizontal slices stacked along +Y (scooter bodywork). */
export function loftSectionsY(sections, opts = {}) {
  const { segments = 64, edgeSegs = 8, cornerSegs = 12, capStart = true, capEnd = true } = opts;
  const X = new THREE.Vector3(1, 0, 0);
  const Z = new THREE.Vector3(0, 0, 1);
  const samples = [];
  for (let j = 0; j <= segments; j++) {
    const v = j / segments;
    const s = interpSections(sections, v);
    const depth = Math.max(s.zF - s.zB, 0.001);
    const prof = roundedRect(s.w, depth, s.rF, s.rB, edgeSegs, cornerSegs);
    samples.push({ o: new THREE.Vector3(0, s.y, (s.zF + s.zB) * 0.5), x: X, y: Z, profile: prof, v });
  }
  return makeLoft(samples, { capStart, capEnd });
}

/** Loft slices stacked along +Z (saddle, deck pad, various mouldings). */
export function loftSectionsZ(sections, opts = {}) {
  const { segments = 48, edgeSegs = 6, cornerSegs = 10, capStart = true, capEnd = true } = opts;
  const X = new THREE.Vector3(1, 0, 0);
  const Y = new THREE.Vector3(0, 1, 0);
  const samples = [];
  for (let j = 0; j <= segments; j++) {
    const v = j / segments;
    const s = interpSections(sections, v);
    const h = Math.max(s.y1 - s.y0, 0.001);
    const prof = roundedRect(s.w, h, s.rT, s.rB, edgeSegs, cornerSegs);
    samples.push({ o: new THREE.Vector3(0, (s.y0 + s.y1) * 0.5, s.z), x: X, y: Y, profile: prof, v });
  }
  return makeLoft(samples, { capStart, capEnd, flipWinding: true });
}

/** Loft along an arbitrary polyline using a rounded-rect profile per station. */
export function loftPath(stations, opts = {}) {
  const { edgeSegs = 5, cornerSegs = 8, capStart = true, capEnd = true } = opts;
  const samples = stations.map((st) => {
    const dir = st.dir ? st.dir.clone().normalize() : new THREE.Vector3(0, 1, 0);
    let xa = st.xAxis ? st.xAxis.clone() : new THREE.Vector3(1, 0, 0);
    // re-orthogonalise
    xa.sub(dir.clone().multiplyScalar(xa.dot(dir))).normalize();
    const ya = new THREE.Vector3().crossVectors(dir, xa).normalize();
    const prof = roundedRect(st.w, st.h, st.rT ?? st.h * 0.5, st.rB ?? st.h * 0.5, edgeSegs, cornerSegs);
    return { o: st.p.clone(), x: xa.clone().multiplyScalar(-1), y: ya, profile: prof, dir };
  });
  return makeLoft(samples, { capStart, capEnd });
}

/**
 * Revolve a cross-section around the X axis (tyres, hub caps, rims).
 * `profile` points are [radius, axial].
 */
export function revolveProfile(profile, o = {}) {
  const { center = new THREE.Vector3(), segs = 96 } = o;
  const X = new THREE.Vector3(1, 0, 0);
  const samples = [];
  for (let j = 0; j <= segs; j++) {
    const a = (j / segs) * Math.PI * 2;
    const radial = new THREE.Vector3(0, Math.cos(a), Math.sin(a));
    samples.push({ o: center.clone(), x: radial, y: X.clone(), profile });
  }
  return makeLoft(samples, { capStart: false, capEnd: false });
}

/**
 * Mudguard band: a thin shell swept about a wheel axis, curled across its
 * width so it hugs the tyre.  Angles in degrees, 0 = straight up, +90 = forward.
 */
export function makeFender(o) {
  const {
    center, rIn, rOut, halfWidth, a0, a1, segs = 90, curl = 0.02,
    lateralSegs = 8, taper = 0,
  } = o;
  const t = rOut - rIn;
  const X = new THREE.Vector3(1, 0, 0);
  const N = lateralSegs;
  const profile = [];
  const radAt = (s, k) => rIn + curl * s * s + (t * (1 - taper * Math.abs(s))) * k;
  for (let i = 0; i <= N; i++) {
    const s = -1 + (2 * i) / N;
    profile.push([radAt(s, 1), s * halfWidth]);
  }
  for (let i = N - 1; i >= 1; i--) {
    const s = -1 + (2 * i) / N;
    profile.push([radAt(s, 0), s * halfWidth]);
  }
  const samples = [];
  for (let j = 0; j <= segs; j++) {
    const ang = (a0 + (a1 - a0) * (j / segs)) * DEG;
    const radial = new THREE.Vector3(0, Math.cos(ang), Math.sin(ang));
    samples.push({ o: center.clone(), x: radial, y: X.clone(), profile });
  }
  return makeLoft(samples, { capStart: true, capEnd: true });
}

/* ------------------------------------------------------- decals on surfaces */
/**
 * Build a patch that hugs a lofted surface and carries a texture.
 * The patch is pushed out along the surface normal by `offset`.
 * `project` controls how UVs map: 'yz' = side view, 'xz' = top view,
 * 'uv' = follow the surface parameterisation.
 */
export function decalGeometry(loft, o = {}) {
  const {
    u0 = 0, u1 = 1, v0 = 0, v1 = 1,
    offset = 0.0014, project = 'uv', uSegs = 24, vSegs = 24,
    flipU = false, flipV = false,
  } = o;
  const pts = [], uvs = [], idx = [], nors = [];
  const n = new THREE.Vector3();
  const grid = [];
  for (let j = 0; j <= vSegs; j++) {
    const row = [];
    for (let i = 0; i <= uSegs; i++) {
      const u = lerp(u0, u1, i / uSegs);
      const v = lerp(v0, v1, j / vSegs);
      const p = loft.point(u, v);
      loft.normal(u, v, n);
      p.addScaledVector(n, offset);
      row.push(p);
    }
    grid.push(row);
  }
  // projected UVs over the patch bounding box, so artwork keeps its aspect
  let bb = new THREE.Box3();
  for (const row of grid) for (const p of row) bb.expandByPoint(p);
  const size = bb.getSize(new THREE.Vector3());
  const min = bb.min;
  const axes = project === 'xz' ? ['x', 'z'] : project === 'yz' ? ['z', 'y'] : project === 'zx' ? ['z', 'x'] : ['x', 'y'];
  const denom = [Math.max(size[axes[0]], 1e-5), Math.max(size[axes[1]], 1e-5)];
  for (let j = 0; j <= vSegs; j++) {
    for (let i = 0; i <= uSegs; i++) {
      const p = grid[j][i];
      const u = clamp((p[axes[0]] - min[axes[0]]) / denom[0], 0, 1);
      const v = clamp((p[axes[1]] - min[axes[1]]) / denom[1], 0, 1);
      pts.push(p.x, p.y, p.z);
      nors.push(0, 0, 0);
      uvs.push(flipU ? 1 - u : u, flipV ? 1 - v : v);
    }
  }
  const stride = uSegs + 1;
  for (let j = 0; j < vSegs; j++) {
    for (let i = 0; i < uSegs; i++) {
      const a = j * stride + i, b = a + 1, c = a + stride, d = c + 1;
      if (u1 > u0) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return { geometry: g, size: new THREE.Vector2(denom[0], denom[1]), bbox: bb };
}

/** Scan a loft for the u-range that faces sideways (side ~= +1 right, -1 left).
 *  Returns an unwrapped range (may start below 0 / end above 1) so patches
 *  never fold back across the seam. */
export function sideURange(loft, v, side = 1, threshold = 0.30, axis = 'x') {
  const n = new THREE.Vector3();
  const N = 720;
  const face = (u) => {
    loft.normal(u, v, n);
    return n[axis] * side;
  };
  // centre of the side = the u with the most extreme lateral normal
  let bestU = 0, bestD = -2;
  for (let i = 0; i < N; i++) {
    const u = i / N;
    const d = face(u);
    if (d > bestD) { bestD = d; bestU = u; }
  }
  const step = 1 / N;
  let lo = bestU, hi = bestU;
  for (let k = 0; k < N * 0.5; k++) {
    if (face(lo - step) < threshold) break;
    lo -= step;
  }
  for (let k = 0; k < N * 0.5; k++) {
    if (face(hi + step) < threshold) break;
    hi += step;
  }
  return [lo, hi];
}

/**
 * Find a contiguous u-range whose surface points satisfy a coordinate window
 * and face the requested direction — used to place decals by physical size.
 */
export function uRangeForCoord(loft, v, o = {}) {
  const {
    coord = 'z', min = -Infinity, max = Infinity,
    side = 1, axis = 'x', threshold = 0.25,
  } = o;
  const p = new THREE.Vector3(), n = new THREE.Vector3();
  const test = (u) => {
    loft.point(u, v, p);
    loft.normal(u, v, n);
    return p[coord] >= min && p[coord] <= max && n[axis] * side > threshold;
  };
  const N = 720;
  let bestU = null, bestScore = -1e9;
  for (let i = 0; i < N; i++) {
    const u = i / N;
    loft.point(u, v, p);
    loft.normal(u, v, n);
    const ok = p[coord] >= min && p[coord] <= max && n[axis] * side > threshold;
    const score = (ok ? 4 : 0) + n[axis] * side;
    if (score > bestScore) { bestScore = score; bestU = u; }
  }
  if (bestU === null || !test(bestU)) return [0, 1];
  const step = 1 / N;
  let lo = bestU, hi = bestU;
  for (let k = 0; k < N * 0.6; k++) { if (!test(lo - step)) break; lo -= step; }
  for (let k = 0; k < N * 0.6; k++) { if (!test(hi + step)) break; hi += step; }
  return [lo, hi];
}

/* ------------------------------------------------------------ solid pieces */
export function tubeFromPoints(points, radius, opts = {}) {
  const { radialSegs = 10, tubularSegs = 64, closed = false, radiusFn = null, tension = 0.5 } = opts;
  const curve = new THREE.CatmullRomCurve3(points.map((p) => p.clone()), closed, 'catmullrom', tension);
  if (!radiusFn) return new THREE.TubeGeometry(curve, tubularSegs, radius, radialSegs, closed);
  // variable radius tube
  const geo = new THREE.TubeGeometry(curve, tubularSegs, radius, radialSegs, closed);
  const pos = geo.attributes.position;
  const frames = curve.computeFrenetFrames(tubularSegs, closed);
  const v = new THREE.Vector3();
  for (let i = 0; i <= tubularSegs; i++) {
    const t = i / tubularSegs;
    const r = radiusFn(t);
    const c = curve.getPointAt(t);
    for (let j = 0; j <= radialSegs; j++) {
      const k = i * (radialSegs + 1) + j;
      v.fromBufferAttribute(pos, k).sub(c);
      const norm = frames.normals[i].clone().multiplyScalar(v.dot(frames.normals[i]));
      const bin = frames.binormals[i].clone().multiplyScalar(v.dot(frames.binormals[i]));
      const dir = norm.add(bin).normalize();
      pos.setXYZ(k, c.x + dir.x * r, c.y + dir.y * r, c.z + dir.z * r);
    }
  }
  geo.computeVertexNormals();
  return geo;
}

export function cylinderBetween(a, b, r1, r2 = r1, segs = 16, open = false) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const geo = new THREE.CylinderGeometry(r2, r1, len, segs, 1, open);
  geo.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize());
  geo.applyQuaternion(q);
  geo.translate(a.x, a.y, a.z);
  return geo;
}

/** A spring (helix) between two points. */
export function springGeometry(a, b, o = {}) {
  const { coils = 7, radius = 0.018, wire = 0.0035, segments = 220, taper = 0 } = o;
  const axis = new THREE.Vector3().subVectors(b, a);
  const len = axis.length();
  const dir = axis.clone().normalize();
  let side = new THREE.Vector3(1, 0, 0);
  if (Math.abs(dir.dot(side)) > 0.9) side.set(0, 0, 1);
  const u = new THREE.Vector3().crossVectors(dir, side).normalize();
  const v = new THREE.Vector3().crossVectors(dir, u).normalize();
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const ang = t * coils * Math.PI * 2;
    const r = radius * (1 - taper * Math.sin(Math.PI * t) * 0);
    const p = a.clone()
      .addScaledVector(dir, len * t)
      .addScaledVector(u, Math.cos(ang) * r)
      .addScaledVector(v, Math.sin(ang) * r);
    pts.push(p);
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), segments, wire, 6, false);
}

export function roundedBoxGeometry(w, h, d, r = 0.01, o = {}) {
  const { segments = 20, edgeSegs = 6, cornerSegs = 6 } = o;
  const rr = Math.min(r, Math.min(w, d) * 0.49, h * 0.49);
  const sections = [
    { y: -h / 2, w: w - 2 * rr * 0.45, zF: d / 2 - rr * 0.45, zB: -d / 2 + rr * 0.45, rF: rr * 0.5, rB: rr * 0.5 },
    { y: -h / 2 + rr, w, zF: d / 2, zB: -d / 2, rF: rr, rB: rr },
    { y: h / 2 - rr, w, zF: d / 2, zB: -d / 2, rF: rr, rB: rr },
    { y: h / 2, w: w - 2 * rr * 0.45, zF: d / 2 - rr * 0.45, zB: -d / 2 + rr * 0.45, rF: rr * 0.5, rB: rr * 0.5 },
  ];
  return loftSectionsY(sections, { segments, edgeSegs, cornerSegs }).geometry;
}

export function ringGeometry(rIn, rOut, thickness, segs = 64) {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, rOut, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  hole.absarc(0, 0, rIn, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness, bevelEnabled: true, bevelSize: thickness * 0.25, bevelThickness: thickness * 0.25, bevelSegments: 2, curveSegments: segs,
  });
  geo.translate(0, 0, -thickness / 2);
  return geo;
}

/* ---------------------------------------------------------------- helpers */
export function applyShadow(mesh, cast = true, receive = true) {
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  return mesh;
}

/** Flag meshes for shadow casting, skipping decal overlays (they sit microns
 *  above the body and would self-shadow into dashed artefacts). */
export function setShadowFlags(group) {
  group.traverse((o) => {
    if (!o.isMesh) return;
    const mat = o.material;
    const isDecal = !!(mat && mat.map && mat.transparent);
    o.castShadow = !isDecal;
    o.receiveShadow = true;
  });
  return group;
}

export function meshOf(geo, material, cast = true, receive = true) {
  const m = new THREE.Mesh(geo, material);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}

export function mergeGeos(list) {
  const clean = [];
  for (const g0 of list) {
    if (!g0) continue;
    const g = g0.index ? g0.toNonIndexed() : g0;
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) {
      const n = g.attributes.position.count;
      g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
    }
    g.clearGroups();
    clean.push(g);
  }
  if (!clean.length) return new THREE.BufferGeometry();
  const merged = mergeGeometries(clean, false);
  if (!merged) throw new Error('mergeGeos failed');
  clean.forEach((g) => g.dispose && g.dispose());
  return merged;
}

/** Rounded-rectangle hole cutter used to fake vents and recesses. */
export function slotShape(w, h, r) {
  const s = new THREE.Shape();
  const hw = w / 2, hh = h / 2;
  s.moveTo(-hw + r, -hh);
  s.lineTo(hw - r, -hh);
  s.quadraticCurveTo(hw, -hh, hw, -hh + r);
  s.lineTo(hw, hh - r);
  s.quadraticCurveTo(hw, hh, hw - r, hh);
  s.lineTo(-hw + r, hh);
  s.quadraticCurveTo(-hw, hh, -hw, hh - r);
  s.lineTo(-hw, -hh + r);
  s.quadraticCurveTo(-hw, -hh, -hw + r, -hh);
  return s;
}

/** Transform a geometry with position / euler / scale, returning it. */
export function placed(geo, { p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1] } = {}) {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(...p),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)),
    new THREE.Vector3(...s)
  );
  geo.applyMatrix4(m);
  return geo;
}
