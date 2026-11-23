/**
 * textures.js — procedural artwork & material maps.
 *
 * All imagery (brand decals, plates, stickers, tread, brick paving, sky) is
 * drawn at runtime on <canvas>, so the whole experience is a self-contained
 * web page with no binary assets.
 */
import * as THREE from 'three';
import { clamp, lerp, makeRandom } from './geom.js';

export const BRAND = {
  teal: '#25c8b6',
  tealDeep: '#12a99c',
  tealDark: '#0d8f86',
  orange: '#f6a01a',
  ink: '#1b1e21',
};

/* ------------------------------------------------------------ canvas utils */
export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  return { canvas: c, ctx };
}

export function canvasTexture(canvas, o = {}) {
  const { srgb = true, repeat = [1, 1], aniso = 8, flipY = true, clampEdge = false } = o;
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = clampEdge ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = aniso;
  t.flipY = flipY;
  t.needsUpdate = true;
  return t;
}

const FONT_CN = '"Microsoft YaHei","PingFang SC","Hiragino Sans GB","Noto Sans CJK SC","Source Han Sans SC",sans-serif';
const FONT_EN = '"Inter","Helvetica Neue",Arial,sans-serif';

export const fonts = { cn: FONT_CN, en: FONT_EN };

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}
export { roundRectPath };

function noiseCanvas(size, { octaves = 4, gain = 0.5, seed = 7, base = 0.5, contrast = 1 } = {}) {
  const { canvas, ctx } = makeCanvas(size, size);
  const img = ctx.createImageData(size, size);
  const rnd = makeRandom(seed);
  const grids = [];
  for (let o = 0; o < octaves; o++) {
    const n = 2 << o;
    const g = new Float32Array(n * n);
    for (let i = 0; i < g.length; i++) g[i] = rnd();
    grids.push({ n, g });
  }
  const smooth = (t) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0, amp = 0.5, tot = 0;
      for (let o = 0; o < octaves; o++) {
        const { n, g } = grids[o];
        const fx = (x / size) * n, fy = (y / size) * n;
        const x0 = Math.floor(fx) % n, y0 = Math.floor(fy) % n;
        const tx = smooth(fx - Math.floor(fx)), ty = smooth(fy - Math.floor(fy));
        const s = (X, Y) => g[((Y % n) + n) % n * n + (((X % n) + n) % n)];
        const a = lerp(s(x0, y0), s(x0 + 1, y0), tx);
        const b = lerp(s(x0, y0 + 1), s(x0 + 1, y0 + 1), tx);
        v += lerp(a, b, ty) * amp;
        tot += amp; amp *= gain;
      }
      v /= tot;
      v = clamp(base + (v - 0.5) * contrast, 0, 1);
      const p = (y * size + x) * 4;
      const c = Math.round(v * 255);
      img.data[p] = c; img.data[p + 1] = c; img.data[p + 2] = c; img.data[p + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export function heightToNormal(canvas, strength = 2.0) {
  const w = canvas.width, h = canvas.height;
  const src = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const { canvas: out, ctx } = makeCanvas(w, h);
  const img = ctx.createImageData(w, h);
  const at = (x, y) => {
    const xi = ((x % w) + w) % w, yi = ((y % h) + h) % h;
    return src[(yi * w + xi) * 4] / 255;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      let nx = -dx, ny = -dy, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      const p = (y * w + x) * 4;
      img.data[p] = Math.round((nx * 0.5 + 0.5) * 255);
      img.data[p + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      img.data[p + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      img.data[p + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

/* ============================================================== BRAND ART */

/** The Didi 青桔 badge: white rounded tile + orange "D" mark. */
export function drawDidiBadge(ctx, x, y, size, o = {}) {
  const { tile = true, mark = BRAND.orange } = o;
  const s = size;
  if (tile) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.25)';
    ctx.shadowBlur = s * 0.06;
    ctx.shadowOffsetY = s * 0.01;
    ctx.fillStyle = '#ffffff';
    roundRectPath(ctx, x, y, s, s, s * 0.22);
    ctx.fill();
    ctx.restore();
  }
  // orange "D" — thick ring, opened at lower-left, with a diamond notch
  const cx = x + s * 0.5, cy = y + s * 0.52, R = s * 0.31;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, Math.PI * 0.30, Math.PI * 1.78, false);
  ctx.lineWidth = s * 0.175;
  ctx.strokeStyle = mark;
  ctx.lineCap = 'butt';
  ctx.stroke();
  // the notch: a white wedge cut from the ring at the lower-left
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.moveTo(cx - R * 0.55, cy + R * 0.05);
  ctx.lineTo(cx - R * 1.15, cy + R * 0.62);
  ctx.lineTo(cx - R * 0.18, cy + R * 0.55);
  ctx.closePath();
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.restore();
  // small "bullet" nub
  ctx.save();
  ctx.fillStyle = mark;
  ctx.translate(cx - R * 0.72, cy + R * 0.42);
  ctx.rotate(-0.5);
  roundRectPath(ctx, -s * 0.055, -s * 0.035, s * 0.11, s * 0.07, s * 0.03);
  ctx.fill();
  ctx.restore();
}

/** Generic decal texture factory.  `wM/hM` are physical metres on the model. */
export function decalTexture(wM, hM, draw, o = {}) {
  const ppm = o.ppm ?? 2600;
  const w = Math.max(8, Math.round(wM * ppm));
  const h = Math.max(8, Math.round(hM * ppm));
  const { canvas, ctx } = makeCanvas(w, h);
  ctx.scale(w / wM, h / hM); // work in metres
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  draw(ctx, wM, hM, { ppm, px: 1 / ppm });
  return canvasTexture(canvas, { clampEdge: true, srgb: true, aniso: 16 });
}

/** Vertical 滴滴青桔 wordmark, exactly like the side panel. */
export function drawSideBrand(ctx, x, y, hM, o = {}) {
  // x,y = bottom-left of the text block, hM = total height in metres
  const { color = '#ffffff', badge = true } = o;
  const charH = hM * (badge ? 0.148 : 0.17);
  const gap = charH * 0.14;
  let cy = y;
  ctx.save();
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${charH}px ${FONT_CN}`;
  if (badge) {
    // badge sits above the four characters
    drawDidiBadge(ctx, x - charH * 0.5, cy, charH);
    cy += charH + gap * 1.4;
  }
  const chars = ['青', '桂', '出', '行'];
  for (const ch of chars) {
    ctx.fillText(ch, x, cy + charH * 0.5);
    cy += charH + gap;
  }
  ctx.restore();
  return cy;
}

/** thin diagonal rule + tagline used next to the badge */
export function drawTagline(ctx, x, y, hM) {
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 0.0022;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + hM * 0.16, y - hM * 0.95);
  ctx.stroke();
  ctx.translate(x + hM * 0.055, y - hM * 0.30);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = '#ffffff';
  ctx.font = `600 ${hM * 0.052}px ${FONT_EN}`;
  ctx.letterSpacing = '0.02em';
  ctx.fillText('Every ride safe', 0, 0);
  ctx.font = `700 ${hM * 0.062}px ${FONT_EN}`;
  ctx.fillText('DIDI Bike', -hM * 0.075, 0);
  ctx.restore();
}

/* -------------------------------------------------------------- the models */

/** Big side-panel decal: horizontal 青桂出行 wordmark only */
export function makeSidePanelDecal(wM, hM) {
  return decalTexture(wM, hM, (ctx, w, h) => {
    const fs = Math.min(h * 0.34, w * 0.235);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(0,40,36,0.18)';
    ctx.shadowBlur = fs * 0.10;
    ctx.shadowOffsetY = fs * 0.02;
    ctx.font = `700 ${fs}px ${FONT_CN}`;
    ctx.letterSpacing = `${fs * 0.16}px`;
    ctx.fillText('青桂出行', w * 0.5, h * 0.5);
    ctx.shadowColor = 'transparent';
  }, { ppm: 3400 });
}

/** White leg-shield plate with the teal slogan and halftone fade. */
export function makeShieldPanelDecal(wM, hM) {
  return decalTexture(wM, hM, (ctx, w, h) => {
    ctx.fillStyle = '#f2f4f3';
    roundRectPath(ctx, 0, 0, w, h, Math.min(w, h) * 0.05);
    ctx.fill();
    // gentle vertical shading so the plate reads as painted metal
    const g = ctx.createLinearGradient(0, 0, w, h * 0.4);
    g.addColorStop(0, 'rgba(0,0,0,0.05)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.10)');
    g.addColorStop(1, 'rgba(0,0,0,0.03)');
    ctx.fillStyle = g;
    ctx.fill();

    // upright characters stacked down the panel
    const fs = Math.min(h * 0.072, w * 0.135);
    const cx = w * 0.60;
    let cy = h * 0.055 + fs * 0.5;
    ctx.fillStyle = BRAND.tealDeep;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${fs}px ${FONT_CN}`;
    for (const ch of '一路美好') {
      ctx.fillText(ch, cx, cy);
      cy += fs * 1.14;
    }
    cy += fs * 0.25;
    for (const ch of '自在骑行') {
      ctx.fillText(ch, cx, cy);
      cy += fs * 1.14;
    }

    // halftone dot fade at the lower end of the plate
    const dotsTop = h * 0.66;
    const dotsBot = h * 0.985;
    const rnd = makeRandom(11);
    const stepY = h * 0.020;
    const stepX = h * 0.021;
    for (let y = dotsTop, row = 0; y < dotsBot; y += stepY, row++) {
      const t = (y - dotsTop) / (dotsBot - dotsTop);
      for (let x = w * 0.10; x < w * 0.92; x += stepX) {
        if (rnd() < 0.10) continue;
        const r = h * 0.0032 * (0.5 + t * 1.7) * (0.75 + rnd() * 0.5);
        ctx.globalAlpha = clamp(0.10 + t * 0.62, 0, 0.8);
        ctx.fillStyle = BRAND.teal;
        ctx.beginPath();
        ctx.arc(x + (row % 2) * stepX * 0.5, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    // teal edge rule along the leading side of the plate
    ctx.strokeStyle = 'rgba(30,150,140,0.35)';
    ctx.lineWidth = Math.max(0.0012, w * 0.006);
    ctx.beginPath();
    ctx.moveTo(w * 0.955, h * 0.02);
    ctx.lineTo(w * 0.955, h * 0.98);
    ctx.stroke();
    // panel seam
    ctx.strokeStyle = 'rgba(40,60,60,0.14)';
    ctx.lineWidth = 0.0014;
    roundRectPath(ctx, 0.0008, 0.0008, w - 0.0016, h - 0.0016, Math.min(w, h) * 0.045);
    ctx.stroke();
  }, { ppm: 2600 });
}

/** e-bike licence plate: 桂林 in large type on top, system plate below */
export function makePlateDecal(wM = 0.19, hM = 0.105, region = '桂林', plate = 'G7K2F') {
  return decalTexture(wM, hM, (ctx, w, h) => {
    ctx.fillStyle = '#12559c';
    roundRectPath(ctx, 0, 0, w, h, h * 0.055);
    ctx.fill();
    ctx.strokeStyle = '#eaf2ff';
    ctx.lineWidth = h * 0.032;
    roundRectPath(ctx, h * 0.045, h * 0.045, w - h * 0.09, h - h * 0.09, h * 0.035);
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    // 桂林 — large, on top
    ctx.font = `700 ${h * 0.34}px ${FONT_CN}`;
    ctx.letterSpacing = `${h * 0.045}px`;
    ctx.fillText(region, w * 0.5, h * 0.305);
    // thin rule
    ctx.strokeStyle = 'rgba(230,240,255,0.45)';
    ctx.lineWidth = h * 0.014;
    ctx.beginPath();
    ctx.moveTo(w * 0.12, h * 0.50);
    ctx.lineTo(w * 0.88, h * 0.50);
    ctx.stroke();
    // GXXXX — issued number, below
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 ${h * 0.34}px ${FONT_EN}`;
    ctx.letterSpacing = `${h * 0.02}px`;
    ctx.fillText(plate, w * 0.5, h * 0.715);
  }, { ppm: 3400 });
}

/** Seat sticker — 已消毒 / clean-ride label. */
export function makeSeatSticker(wM = 0.115, hM = 0.05) {
  return decalTexture(wM, hM, (ctx, w, h) => {
    ctx.fillStyle = '#f2f7f7';
    roundRectPath(ctx, 0, 0, w, h, h * 0.18);
    ctx.fill();
    ctx.fillStyle = '#2a3438';
    ctx.font = `600 ${h * 0.21}px ${FONT_CN}`;
    ctx.textBaseline = 'middle';
    ctx.fillText('青桂出行', w * 0.045, h * 0.30);
    // main line
    ctx.fillStyle = '#116e86';
    ctx.font = `800 ${h * 0.30}px ${FONT_CN}`;
    ctx.fillText('请清洁座垫', w * 0.045, h * 0.64);
    // ribbon: 已消毒
    ctx.fillStyle = BRAND.teal;
    roundRectPath(ctx, w * 0.55, h * 0.50, w * 0.40, h * 0.40, h * 0.10);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 ${h * 0.26}px ${FONT_CN}`;
    ctx.fillText('已消毒', w * 0.585, h * 0.70);
  }, { ppm: 3400 });
}

/** plain painted panel with a rounded alpha outline (used for trim panels) */
export function makeRoundedPanel(wM, hM, color = '#f2f4f3') {
  return decalTexture(wM, hM, (ctx, w, h) => {
    ctx.fillStyle = color;
    roundRectPath(ctx, 0, 0, w, h, Math.min(w, h) * 0.16);
    ctx.fill();
    const g = ctx.createLinearGradient(0, 0, w * 0.4, h);
    g.addColorStop(0, 'rgba(255,255,255,0.22)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.02)');
    g.addColorStop(1, 'rgba(0,0,0,0.06)');
    ctx.fillStyle = g;
    ctx.fill();
  }, { ppm: 3000 });
}

/** small "MPC · 青桔" marking on the white head unit */
export function makeCowlMark(wM, hM) {
  return decalTexture(wM, hM, (ctx, w, h) => {
    ctx.fillStyle = '#22282a';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = `800 ${h * 0.78}px ${FONT_EN}`;
    ctx.letterSpacing = `${h * 0.10}px`;
    ctx.fillText('MPC', w * 0.02, h * 0.52);
    ctx.fillStyle = 'rgba(28,34,36,0.55)';
    ctx.font = `600 ${h * 0.40}px ${FONT_CN}`;
    ctx.fillText('青桂', w * 0.52, h * 0.56);
  }, { ppm: 6000 });
}

/** recessed vent grille decal for the leg shield flanks */
export function makeVentDecal(wM, hM) {
  return decalTexture(wM, hM, (ctx, w, h) => {
    ctx.fillStyle = '#0e1618';
    roundRectPath(ctx, 0, 0, w, h, h * 0.16);
    ctx.fill();
    const n = 5;
    for (let i = 0; i < n; i++) {
      const y = h * (0.10 + (i / n) * 0.80);
      const g = ctx.createLinearGradient(0, y, 0, y + h * 0.10);
      g.addColorStop(0, 'rgba(255,255,255,0.10)');
      g.addColorStop(0.5, 'rgba(0,0,0,0.72)');
      g.addColorStop(1, 'rgba(255,255,255,0.05)');
      ctx.fillStyle = g;
      roundRectPath(ctx, w * 0.06, y, w * 0.88, h * 0.10, h * 0.05);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 0.0012;
    roundRectPath(ctx, 0.0006, 0.0006, w - 0.0012, h - 0.0012, h * 0.15);
    ctx.stroke();
  }, { ppm: 4200 });
}

/** small white wordmark used low on the leg shield */
export function makeShieldSideMark(wM, hM) {
  return decalTexture(wM, hM, (ctx, w, h) => {
    ctx.fillStyle = 'rgba(255,255,255,0.96)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const fs = Math.min(h * 0.62, w * 0.19);
    ctx.font = `700 ${fs}px ${FONT_CN}`;
    ctx.letterSpacing = `${fs * 0.08}px`;
    ctx.fillText('青桂出行', w * 0.5, h * 0.46);
    ctx.font = `600 ${fs * 0.34}px ${FONT_EN}`;
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText('E - BIKE', w * 0.5, h * 0.83);
  }, { ppm: 2600 });
}

/** Fake-but-convincing QR code (deterministic). */
export function makeQRDecal(wM = 0.05, hM = 0.05, seed = 4242) {
  return decalTexture(wM, hM, (ctx, w, h) => {
    const n = 25;
    const cell = Math.min(w, h) / n;
    const rnd = makeRandom(seed);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#101314';
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const inFinder = (fx, fy) => x >= fx && x < fx + 8 && y >= fy && y < fy + 8;
        if (inFinder(0, 0) || inFinder(n - 8, 0) || inFinder(0, n - 8)) continue;
        if (rnd() < 0.46) ctx.fillRect(x * cell, y * cell, cell * 0.92, cell * 0.92);
      }
    }
    const finder = (fx, fy) => {
      ctx.fillStyle = '#101314';
      ctx.fillRect(fx * cell, fy * cell, cell * 7, cell * 7);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect((fx + 1) * cell, (fy + 1) * cell, cell * 5, cell * 5);
      ctx.fillStyle = '#101314';
      ctx.fillRect((fx + 2) * cell, (fy + 2) * cell, cell * 3, cell * 3);
    };
    finder(0, 0); finder(n - 7, 0); finder(0, n - 7);
  }, { ppm: 5000 });
}

/** Handlebar instrument cluster: live speed read-out on a small canvas. */
export function makeSpeedDisplay(wPx = 512, hPx = 400) {
  const { canvas, ctx } = makeCanvas(wPx, hPx);
  const tex = canvasTexture(canvas, { clampEdge: true, aniso: 8, srgb: true });
  let lastKmh = -99, lastBatt = -1;
  function draw(kmh = 0, battery = 0.86) {
    const v = Math.round(kmh * 10) / 10;
    if (Math.abs(v - lastKmh) < 0.05 && Math.abs(battery - lastBatt) < 0.004) return false;
    lastKmh = v; lastBatt = battery;
    ctx.save();
    // glass background
    const g = ctx.createLinearGradient(0, 0, 0, hPx);
    g.addColorStop(0, '#0c1a1b');
    g.addColorStop(1, '#05090a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, wPx, hPx);
    // faint grid
    ctx.strokeStyle = 'rgba(120,240,220,0.06)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 8; i++) {
      ctx.beginPath(); ctx.moveTo(0, (i / 8) * hPx); ctx.lineTo(wPx, (i / 8) * hPx); ctx.stroke();
    }
    // speed digits
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#8bf5e4';
    ctx.shadowColor = 'rgba(80,240,215,0.65)';
    ctx.shadowBlur = 24;
    ctx.font = `800 ${hPx * 0.50}px ${FONT_EN}`;
    ctx.fillText(v.toFixed(1), wPx * 0.5, hPx * 0.42);
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(150,230,220,0.72)';
    ctx.font = `600 ${hPx * 0.10}px ${FONT_EN}`;
    ctx.fillText('km/h', wPx * 0.5, hPx * 0.685);
    // battery bar
    const bx = wPx * 0.20, bw = wPx * 0.60, by = hPx * 0.83, bh = hPx * 0.045;
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    roundRectPath(ctx, bx, by, bw, bh, bh * 0.5); ctx.fill();
    const bgr = ctx.createLinearGradient(bx, 0, bx + bw, 0);
    bgr.addColorStop(0, '#19b7a6');
    bgr.addColorStop(1, '#7df1df');
    ctx.fillStyle = bgr;
    roundRectPath(ctx, bx, by, bw * Math.max(0.02, battery), bh, bh * 0.5); ctx.fill();
    // tick marks around the digits
    ctx.strokeStyle = 'rgba(130,240,225,0.20)';
    ctx.lineWidth = 3;
    for (let i = 0; i < 22; i++) {
      const a = Math.PI * (1.08 + (i / 21) * 0.84);
      const r0 = wPx * 0.40, r1 = r0 + 10;
      const cx = wPx * 0.5, cy = hPx * 0.46;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.stroke();
    }
    ctx.restore();
    tex.needsUpdate = true;
    return true;
  }
  draw(0, 0.86);
  return { texture: tex, draw, canvas };
}

/** Handlebar instrument display (legacy artwork, unused). */
export function makeDisplayDecal(wM = 0.105, hM = 0.075) {
  return decalTexture(wM, hM, (ctx, w, h) => {
    ctx.fillStyle = '#101314';
    roundRectPath(ctx, 0, 0, w, h, h * 0.12);
    ctx.fill();
    // QR area
    ctx.fillStyle = '#ffffff';
    roundRectPath(ctx, w * 0.06, h * 0.10, w * 0.40, h * 0.78, h * 0.06);
    ctx.fill();
    const n = 12;
    const cell = Math.min(w * 0.36, h * 0.66) / n;
    const rnd = makeRandom(77);
    ctx.fillStyle = '#101314';
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      if ((x < 3 && y < 3) || (x > n - 4 && y < 3) || (x < 3 && y > n - 4)) continue;
      if (rnd() < 0.5) ctx.fillRect(w * 0.08 + x * cell, h * 0.16 + y * cell, cell * 0.9, cell * 0.9);
    }
    // green status pill
    ctx.save();
    ctx.fillStyle = '#2ad39a';
    roundRectPath(ctx, w * 0.54, h * 0.14, w * 0.40, h * 0.24, h * 0.08);
    ctx.fill();
    ctx.fillStyle = '#08321f';
    ctx.font = `700 ${h * 0.17}px ${FONT_CN}`;
    ctx.textBaseline = 'middle';
    ctx.fillText('扫码即开', w * 0.575, h * 0.265);
    ctx.fillStyle = '#dfe7e6';
    ctx.font = `600 ${h * 0.12}px ${FONT_CN}`;
    ctx.fillText('青桂出行', w * 0.55, h * 0.52);
    // battery pips
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i < 3 ? '#39e0ad' : '#3a4145';
      roundRectPath(ctx, w * 0.55 + i * w * 0.085, h * 0.64, w * 0.06, h * 0.10, h * 0.02);
      ctx.fill();
    }
    ctx.fillStyle = '#8fa0a3';
    ctx.font = `500 ${h * 0.09}px ${FONT_EN}`;
    ctx.fillText('READY', w * 0.55, h * 0.86);
    ctx.restore();
  }, { ppm: 5200 });
}

/** Warning / instruction labels scattered on the bodywork. */
export function makeSmallLabels() {
  const labels = {};
  labels.warning = decalTexture(0.10, 0.028, (ctx, w, h) => {
    ctx.fillStyle = '#e99a1b';
    roundRectPath(ctx, 0, 0, w, h, h * 0.16);
    ctx.fill();
    ctx.fillStyle = '#2a1a00';
    ctx.font = `700 ${h * 0.42}px ${FONT_CN}`;
    ctx.textBaseline = 'middle';
    ctx.fillText('请勿载人', w * 0.07, h * 0.53);
    ctx.font = `600 ${h * 0.24}px ${FONT_EN}`;
    ctx.fillText('NO RIDING', w * 0.62, h * 0.53);
  }, { ppm: 4200 });
  labels.charging = decalTexture(0.06, 0.03, (ctx, w, h) => {
    ctx.fillStyle = '#e8eef0';
    roundRectPath(ctx, 0, 0, w, h, h * 0.2);
    ctx.fill();
    ctx.fillStyle = '#0e5f74';
    ctx.font = `700 ${h * 0.36}px ${FONT_CN}`;
    ctx.textBaseline = 'middle';
    ctx.fillText('充电口', w * 0.06, h * 0.52);
    ctx.strokeStyle = '#0e5f74';
    ctx.lineWidth = h * 0.06;
    ctx.beginPath();
    ctx.arc(w * 0.83, h * 0.5, h * 0.2, 0, Math.PI * 2);
    ctx.stroke();
  }, { ppm: 4200 });
  labels.number = decalTexture(0.10, 0.028, (ctx, w, h) => {
    ctx.fillStyle = '#f1f3f3';
    roundRectPath(ctx, 0, 0, w, h, h * 0.14);
    ctx.fill();
    ctx.fillStyle = '#26302f';
    ctx.font = `700 ${h * 0.46}px ${FONT_EN}`;
    ctx.textBaseline = 'middle';
    ctx.fillText('QJ-0227', w * 0.07, h * 0.54);
  }, { ppm: 4200 });
  return labels;
}

/** headlight lens pattern */
export function makeLensTexture() {
  const { canvas, ctx } = makeCanvas(512, 512);
  const g = ctx.createRadialGradient(256, 256, 20, 256, 256, 250);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.45, '#dfeaf0');
  g.addColorStop(1, '#8d9ba3');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 512);
  ctx.strokeStyle = 'rgba(90,110,120,0.55)';
  ctx.lineWidth = 3;
  for (let r = 40; r < 250; r += 26) {
    ctx.beginPath();
    ctx.arc(256, 256, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  return canvasTexture(canvas, { clampEdge: true, aniso: 8 });
}

/* ======================================================= MATERIAL SURFACES */

export function makeTireTextures() {
  // Layout matches the wheel UVs: x = across the tyre (u), y = around (v).
  const W = 512, H = 2048;
  const { canvas, ctx } = makeCanvas(W, H);
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, W, H);
  // tread blocks around the crown
  const blocks = 46;
  const cell = H / blocks;
  ctx.fillStyle = '#5a5a5a';
  for (let i = 0; i < blocks; i++) {
    const y = i * cell;
    // central circumferential groove
    ctx.fillRect(W * 0.455, y, W * 0.09, cell * 0.16);
    // chevron grooves either side of the crown
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(W * (side > 0 ? 0.63 : 0.37), y + cell * (side > 0 ? 0.55 : 0.15));
      ctx.rotate(side * 0.55);
      ctx.fillRect(-W * 0.11, -cell * 0.055, W * 0.22, cell * 0.11);
      ctx.restore();
    }
    // shoulder sipes
    ctx.fillRect(W * 0.07, y + cell * 0.12, W * 0.085, cell * 0.42);
    ctx.fillRect(W * 0.845, y + cell * 0.32, W * 0.085, cell * 0.42);
    // fine lateral sipes
    ctx.fillRect(W * 0.20, y + cell * 0.62, W * 0.055, cell * 0.30);
    ctx.fillRect(W * 0.745, y + cell * 0.04, W * 0.055, cell * 0.30);
  }
  // sidewall ribs at both edges
  for (const [x0, x1] of [[0.0, 0.055], [0.945, 1.0]]) {
    ctx.fillStyle = 'rgba(120,120,120,0.85)';
    ctx.fillRect(W * x0, 0, W * (x1 - x0), H);
    ctx.fillStyle = 'rgba(158,158,158,0.7)';
    for (let i = 0; i < 8; i++) ctx.fillRect(W * (x0 + (x1 - x0) * (i / 8)), 0, W * 0.003, H);
  }
  // moulding texture
  const rnd = makeRandom(3);
  for (let i = 0; i < 5000; i++) {
    ctx.fillStyle = `rgba(255,255,255,${rnd() * 0.05})`;
    ctx.fillRect(rnd() * W, rnd() * H, 2, 2);
  }
  const normal = heightToNormal(canvas, 3.2);
  const normalMap = canvasTexture(normal, { srgb: false, repeat: [1, 1], aniso: 16 });
  const heightMap = canvasTexture(canvas, { srgb: false, repeat: [1, 1], aniso: 8 });
  return { normalMap, heightMap };
}

/** Rubber insert drawn as a covered decal (rounded outline, no separate slab) */
export function makeDeckInsert(wM, hM) {
  const ppm = 2200;
  const W = Math.max(64, Math.round(wM * ppm));
  const H = Math.max(64, Math.round(hM * ppm));
  // height field for the rib pattern
  const { canvas: height, ctx: hctx } = makeCanvas(W, H);
  hctx.fillStyle = '#808080';
  hctx.fillRect(0, 0, W, H);
  const rnd = makeRandom(5);
  const step = Math.max(8, Math.round(W / 17));
  hctx.fillStyle = '#585858';
  for (let y = 0; y < H; y += step) {
    for (let x = 0; x < W; x += step) {
      hctx.save();
      hctx.translate(x + step / 2, y + step / 2);
      hctx.rotate(Math.PI / 4);
      roundRectPath(hctx, -step * 0.32, -step * 0.10, step * 0.64, step * 0.20, step * 0.1);
      hctx.fill();
      hctx.restore();
    }
  }
  for (let i = 0; i < 3000; i++) {
    hctx.fillStyle = `rgba(0,0,0,${rnd() * 0.35})`;
    hctx.fillRect(rnd() * W, rnd() * H, 2, 2);
  }
  // colour canvas with a rounded-rect alpha mask
  const { canvas, ctx } = makeCanvas(W, H);
  ctx.save();
  roundRectPath(ctx, 0, 0, W, H, Math.min(W, H) * 0.16);
  ctx.clip();
  ctx.fillStyle = '#1d2124';
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 0.85;
  ctx.drawImage(height, 0, 0);
  ctx.globalAlpha = 1;
  ctx.restore();
  const map = canvasTexture(canvas, { clampEdge: true, aniso: 8 });
  const normalMap = canvasTexture(heightToNormal(height, 1.7), { srgb: false, clampEdge: true, aniso: 8 });
  return { map, normalMap };
}

export function makeDeckMatTextures() {
  const { canvas, ctx } = makeCanvas(512, 1024);
  ctx.fillStyle = '#1e2225';
  ctx.fillRect(0, 0, 512, 1024);
  // ribbed diamond plate pattern
  const rnd = makeRandom(5);
  for (let y = 0; y < 1024; y += 34) {
    for (let x = 0; x < 512; x += 34) {
      ctx.save();
      ctx.translate(x + 17, y + 17);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = `rgba(70,76,80,${0.55 + rnd() * 0.2})`;
      roundRectPath(ctx, -11, -3.5, 22, 7, 3);
      ctx.fill();
      ctx.restore();
    }
  }
  // speckle
  for (let i = 0; i < 3000; i++) {
    ctx.fillStyle = `rgba(0,0,0,${rnd() * 0.35})`;
    ctx.fillRect(rnd() * 512, rnd() * 1024, 2, 2);
  }
  const normalMap = canvasTexture(heightToNormal(canvas, 1.7), { srgb: false, aniso: 8 });
  const map = canvasTexture(canvas, { aniso: 8 });
  return { map, normalMap };
}

export function makeQuiltTextures() {
  const S = 1024;
  const { canvas, ctx } = makeCanvas(S, S);
  ctx.fillStyle = '#8b9094';
  ctx.fillRect(0, 0, S, S);
  // diamond quilting
  const cell = 128;
  ctx.save();
  ctx.translate(S / 2, S / 2);
  ctx.rotate(Math.PI / 4);
  for (let y = -S; y < S; y += cell) {
    for (let x = -S; x < S; x += cell) {
      const g = ctx.createRadialGradient(x + cell / 2, y + cell / 2, 2, x + cell / 2, y + cell / 2, cell * 0.55);
      g.addColorStop(0, 'rgba(255,255,255,0.16)');
      g.addColorStop(0.6, 'rgba(0,0,0,0.02)');
      g.addColorStop(1, 'rgba(0,0,0,0.20)');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, cell, cell);
      ctx.strokeStyle = 'rgba(0,0,0,0.22)';
      ctx.lineWidth = 3;
      ctx.strokeRect(x, y, cell, cell);
    }
  }
  ctx.restore();
  // stitching dots
  const rnd = makeRandom(9);
  for (let i = 0; i < 1200; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.06 + rnd() * 0.08})`;
    ctx.fillRect(rnd() * S, rnd() * S, 2, 2);
  }
  const normalMap = canvasTexture(heightToNormal(canvas, 1.3), { srgb: false, aniso: 8 });
  const map = canvasTexture(canvas, { aniso: 8, repeat: [2, 2] });
  normalMap.repeat.set(2, 2);
  return { map, normalMap };
}

export function makePlasticRoughness() {
  // roughness maps multiply the material roughness, so they must sit near 1.0
  const c = noiseCanvas(256, { octaves: 4, contrast: 0.30, base: 0.90, seed: 21 });
  return canvasTexture(c, { srgb: false, repeat: [3, 3], aniso: 4 });
}

export function makePaintRoughness() {
  const { canvas, ctx } = makeCanvas(512, 512);
  ctx.fillStyle = '#e8e8e8';
  ctx.fillRect(0, 0, 512, 512);
  // faint polish marks only — keeps the clear coat mirror-smooth but not chrome
  const rnd = makeRandom(31);
  for (let i = 0; i < 700; i++) {
    const a = rnd() * Math.PI;
    ctx.save();
    ctx.translate(rnd() * 512, rnd() * 512);
    ctx.rotate(a);
    ctx.fillStyle = `rgba(255,255,255,${rnd() * 0.05})`;
    ctx.fillRect(-40, -1, 80, 2);
    ctx.restore();
  }
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = `rgba(190,190,190,${0.10 + rnd() * 0.12})`;
    const r = 2 + rnd() * 9;
    ctx.beginPath();
    ctx.arc(rnd() * 512, rnd() * 512, r, 0, Math.PI * 2);
    ctx.fill();
  }
  return canvasTexture(canvas, { srgb: false, repeat: [2, 2], aniso: 4 });
}

/* ============================================================ ENVIRONMENT */

/** Returns { sky, env } — `env` is a dimmed copy used for image-based lighting
 *  so bright skylight cannot blow the paint out to white. */
export function makeSkyPair(sunDir = new THREE.Vector3(-0.35, 0.55, -0.75), envGain = 0.42) {
  const W = 3072, H = 1536;
  const { canvas, ctx } = makeCanvas(W, H);
  // equirect: u = azimuth, v = 0 (top / zenith) .. 1 (bottom / nadir)
  const sky = ctx.createLinearGradient(0, 0, 0, H * 0.52);
  sky.addColorStop(0, '#2f6fb8');
  sky.addColorStop(0.35, '#67a6e0');
  sky.addColorStop(0.7, '#bcd8ee');
  sky.addColorStop(1, '#e8eff2');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H * 0.52);
  // ground half: warm haze
  const grd = ctx.createLinearGradient(0, H * 0.5, 0, H);
  grd.addColorStop(0, '#dfe6e4');
  grd.addColorStop(0.25, '#b9bfb7');
  grd.addColorStop(1, '#6f746c');
  ctx.fillStyle = grd;
  ctx.fillRect(0, H * 0.5, W, H * 0.5);

  // sun position from direction
  const az = Math.atan2(sunDir.x, sunDir.z); // 0 = +z
  const el = Math.asin(clamp(sunDir.y, -1, 1));
  const sx = ((az / (Math.PI * 2)) + 0.5) * W;
  const sy = (0.5 - el / Math.PI) * H;
  const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, W * 0.22);
  glow.addColorStop(0, 'rgba(255,250,235,1)');
  glow.addColorStop(0.05, 'rgba(255,246,220,0.95)');
  glow.addColorStop(0.2, 'rgba(255,238,196,0.35)');
  glow.addColorStop(1, 'rgba(255,238,196,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H * 0.55);

  // clouds: soft blurred blobs, banded near the horizon
  ctx.save();
  try { ctx.filter = 'blur(14px)'; } catch (e) { /* ignore */ }
  const rnd = makeRandom(2024);
  for (let i = 0; i < 150; i++) {
    const u = rnd();
    const band = rnd();
    const v = 0.06 + Math.pow(band, 0.65) * 0.40;
    const x = u * W;
    const y = v * H;
    const rw = (0.02 + rnd() * 0.10) * W;
    const rh = rw * (0.06 + rnd() * 0.13);
    const g = ctx.createRadialGradient(x, y, 0, x, y, rw);
    const a = 0.16 + rnd() * 0.5;
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(0.55, `rgba(248,251,255,${a * 0.55})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, y, rw, rh, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  // horizon glow band
  const hz = ctx.createLinearGradient(0, H * 0.44, 0, H * 0.53);
  hz.addColorStop(0, 'rgba(255,255,255,0)');
  hz.addColorStop(0.7, 'rgba(255,252,244,0.55)');
  hz.addColorStop(1, 'rgba(220,228,226,0)');
  ctx.fillStyle = hz;
  ctx.fillRect(0, H * 0.44, W, H * 0.09);
  const tex = canvasTexture(canvas, { clampEdge: true, aniso: 4 });
  tex.mapping = THREE.EquirectangularReflectionMapping;
  // dimmed variant for IBL
  const { canvas: envCanvas, ctx: ectx } = makeCanvas(W / 2, H / 2);
  ectx.fillStyle = '#000';
  ectx.fillRect(0, 0, envCanvas.width, envCanvas.height);
  ectx.globalAlpha = envGain;
  ectx.drawImage(canvas, 0, 0, envCanvas.width, envCanvas.height);
  ectx.globalAlpha = 1;
  const envTex = canvasTexture(envCanvas, { clampEdge: true, aniso: 4 });
  envTex.mapping = THREE.EquirectangularReflectionMapping;
  return { sky: tex, env: envTex };
}

/** convenience wrapper returning just the visible sky texture */
export function makeSkyTexture(sunDir) {
  return makeSkyPair(sunDir).sky;
}

export function makeAsphaltTextures() {
  const S = 1024;
  const base = noiseCanvas(S, { octaves: 5, contrast: 0.85, base: 0.44, seed: 3 });
  const { canvas, ctx } = makeCanvas(S, S);
  ctx.drawImage(base, 0, 0);
  const rnd = makeRandom(17);
  // aggregate speckles
  for (let i = 0; i < 24000; i++) {
    const x = rnd() * S, y = rnd() * S, r = 0.6 + rnd() * 2.2;
    const v = rnd() < 0.5 ? 30 + rnd() * 40 : 120 + rnd() * 70;
    ctx.fillStyle = `rgba(${v},${v},${v + 3},${0.25 + rnd() * 0.5})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // broad patching / wear
  for (let i = 0; i < 14; i++) {
    const g = ctx.createRadialGradient(rnd() * S, rnd() * S, 0, rnd() * S, rnd() * S, 120 + rnd() * 260);
    g.addColorStop(0, `rgba(${rnd() < 0.5 ? '30,32,34' : '90,92,92'},0.18)`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  }
  const map = canvasTexture(canvas, { repeat: [8, 8], aniso: 16 });
  const rough = canvasTexture(noiseCanvas(256, { octaves: 3, base: 0.62, contrast: 0.5, seed: 44 }), {
    srgb: false, repeat: [10, 10], aniso: 8,
  });
  const normalMap = canvasTexture(heightToNormal(base, 1.2), { srgb: false, repeat: [8, 8], aniso: 8 });
  return { map, rough, normalMap };
}

export function makeBrickTexture() {
  const S = 1024;
  const { canvas, ctx } = makeCanvas(S, S);
  const rnd = makeRandom(61);
  // 1 texture = 2m x 2m, bricks 0.2 x 0.1 m  => 10 x 20 bricks, running bond
  const cols = 10, rows = 20;
  ctx.fillStyle = '#8e8b84';
  ctx.fillRect(0, 0, S, S);
  const bw = S / cols, bh = S / rows;
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) * bw * 0.5;
    for (let c = -1; c < cols + 1; c++) {
      const x = c * bw + off, y = r * bh;
      const isRed = rnd() < 0.15;
      const base = isRed ? [150, 112, 104] : [148, 147, 143];
      const k = 0.82 + rnd() * 0.36;
      ctx.fillStyle = `rgb(${base[0] * k | 0},${base[1] * k | 0},${base[2] * k | 0})`;
      ctx.fillRect(x + 1.5, y + 1.5, bw - 3, bh - 3);
      // subtle top highlight / bottom shade
      ctx.fillStyle = 'rgba(255,255,255,0.09)';
      ctx.fillRect(x + 1.5, y + 1.5, bw - 3, 2);
      ctx.fillStyle = 'rgba(0,0,0,0.13)';
      ctx.fillRect(x + 1.5, y + bh - 3.5, bw - 3, 2);
      // speckle
      for (let i = 0; i < 14; i++) {
        ctx.fillStyle = `rgba(0,0,0,${rnd() * 0.12})`;
        ctx.fillRect(x + 2 + rnd() * (bw - 4), y + 2 + rnd() * (bh - 4), 2, 2);
      }
    }
  }
  const map = canvasTexture(canvas, { repeat: [6, 6], aniso: 16 });
  const normalMap = canvasTexture(heightToNormal(canvas, 1.6), { srgb: false, repeat: [6, 6], aniso: 8 });
  return { map, normalMap, rough: canvasTexture(noiseCanvas(256, { seed: 5, base: 0.7, contrast: 0.4 }), { srgb: false, repeat: [8, 8] }) };
}

export function makeConcreteTexture() {
  const S = 512;
  const { canvas, ctx } = makeCanvas(S, S);
  ctx.drawImage(noiseCanvas(S, { octaves: 4, base: 0.72, contrast: 0.4, seed: 12 }), 0, 0);
  const rnd = makeRandom(23);
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = `rgba(0,0,0,${rnd() * 0.12})`;
    ctx.fillRect(rnd() * S, rnd() * S, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  return { map: canvasTexture(canvas, { repeat: [4, 4], aniso: 8 }) };
}

export function makeGrassTexture() {
  const S = 512;
  const { canvas, ctx } = makeCanvas(S, S);
  ctx.fillStyle = '#39562f';
  ctx.fillRect(0, 0, S, S);
  const rnd = makeRandom(88);
  for (let i = 0; i < 9000; i++) {
    const x = rnd() * S, y = rnd() * S;
    const g = 60 + rnd() * 80;
    ctx.strokeStyle = `rgba(${g * 0.55 | 0},${g | 0},${g * 0.42 | 0},${0.25 + rnd() * 0.5})`;
    ctx.lineWidth = 1 + rnd();
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rnd() - 0.5) * 4, y - 3 - rnd() * 5);
    ctx.stroke();
  }
  return { map: canvasTexture(canvas, { repeat: [24, 24], aniso: 8 }) };
}

/** Painted bike-lane pictogram + text as a decal on the road. */
export function makeRoadMarkTexture() {
  const W = 1024, H = 1024;
  const { canvas, ctx } = makeCanvas(W, H);
  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = '#f2f4f0';
  ctx.fillStyle = '#f2f4f0';
  // bicycle pictogram
  ctx.lineWidth = 26;
  ctx.beginPath(); ctx.arc(W * 0.32, H * 0.62, 74, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(W * 0.70, H * 0.62, 74, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 22;
  ctx.beginPath();
  ctx.moveTo(W * 0.32, H * 0.62); ctx.lineTo(W * 0.46, H * 0.40);
  ctx.lineTo(W * 0.62, H * 0.40); ctx.lineTo(W * 0.70, H * 0.62);
  ctx.moveTo(W * 0.46, H * 0.40); ctx.lineTo(W * 0.55, H * 0.62);
  ctx.lineTo(W * 0.62, H * 0.40);
  ctx.stroke();
  // handlebar + saddle
  ctx.beginPath();
  ctx.moveTo(W * 0.44, H * 0.36); ctx.lineTo(W * 0.52, H * 0.36);
  ctx.moveTo(W * 0.60, H * 0.34); ctx.lineTo(W * 0.68, H * 0.34);
  ctx.stroke();
  return canvasTexture(canvas, { clampEdge: true, aniso: 16 });
}

export function makeBasketBrand() {
  return decalTexture(0.16, 0.03, (ctx, w, h) => {
    ctx.fillStyle = BRAND.tealDeep;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 ${h * 0.62}px ${FONT_CN}`;
    ctx.textBaseline = 'middle';
    ctx.fillText('青桂出行', w * 0.06, h * 0.54);
  }, { ppm: 3000 });
}

/** soft round glow used for lamp bloom sprites */
export function makeGlowSprite() {
  const S = 256;
  const { canvas, ctx } = makeCanvas(S, S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.16)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return canvasTexture(canvas, { clampEdge: true, srgb: true });
}

/** contact shadow decal under the bike */
export function makeContactShadow() {
  const W = 256, H = 512;
  const { canvas, ctx } = makeCanvas(W, H);
  const g = ctx.createRadialGradient(W / 2, H / 2, 8, W / 2, H / 2, H / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.62)');
  g.addColorStop(0.32, 'rgba(0,0,0,0.34)');
  g.addColorStop(0.62, 'rgba(0,0,0,0.10)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // squash horizontally to follow the bike's footprint
  const { canvas: out, ctx: octx } = makeCanvas(W, H);
  octx.drawImage(canvas, 0, 0, W, H);
  return canvasTexture(out, { clampEdge: true, srgb: true });
}

/** three facade textures for the distant skyline */
export function makeBuildingTextures() {
  function facade(opts) {
    const { cols, rows, base, glass, seed, accent } = opts;
    const S = 512;
    const { canvas, ctx } = makeCanvas(S, S);
    const rnd = makeRandom(seed);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, S, S);
    const cw = S / cols, ch = S / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = c * cw, y = r * ch;
        const lit = rnd();
        ctx.fillStyle = lit > 0.86 ? accent : glass;
        ctx.globalAlpha = 0.55 + rnd() * 0.35;
        ctx.fillRect(x + cw * 0.18, y + ch * 0.16, cw * 0.64, ch * 0.56);
        ctx.globalAlpha = 1;
        // mullion shadow
        ctx.fillStyle = 'rgba(0,0,0,0.12)';
        ctx.fillRect(x, y + ch * 0.80, cw, ch * 0.06);
      }
    }
    // slab lines
    ctx.fillStyle = 'rgba(0,0,0,0.10)';
    for (let r = 0; r <= rows; r++) ctx.fillRect(0, r * ch - 1, S, 2);
    return canvasTexture(canvas, { repeat: [1, 1], aniso: 8 });
  }
  return {
    a: facade({ cols: 6, rows: 10, base: '#9aa0a2', glass: '#5d6b72', accent: '#c9d6d8', seed: 5 }),
    b: facade({ cols: 5, rows: 12, base: '#8e9aa4', glass: '#4c5c68', accent: '#b9cdd8', seed: 9 }),
    c: facade({ cols: 8, rows: 8, base: '#b0a89c', glass: '#6a6a66', accent: '#d8d2c4', seed: 13 }),
  };
}

export async function waitFonts() {
  try {
    await document.fonts.ready;
    // explicitly touch the CJK face so canvas metrics are final
    await Promise.all([
      document.fonts.load(`700 64px ${FONT_CN}`, '滴滴青桔'),
      document.fonts.load(`600 32px ${FONT_EN}`, 'DIDI Bike'),
    ]);
  } catch (e) { /* ignore */ }
}
