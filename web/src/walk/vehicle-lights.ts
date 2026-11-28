import * as T from 'three'
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js'
import {shareAtmosphere} from '../look/atmosphere'
import {look} from '../look/config'
import {WATER_LAYER} from '../look/water'
import type {TwoWheelHeadlightMode, TwoWheelVehicleKind} from './ebike-state-coupling'

/**
 * Atmosphere-fused, zero-dynamic-light, low-draw-call vehicle lighting system (IDOK-546).
 *
 * Performance & architectural contract:
 *  - ZERO Three.js dynamic lights (SpotLight / PointLight / RectAreaLight).
 *  - Shares global `atmo` uniforms via `shareAtmosphere()` (0 CPU cost per frame).
 *  - Outputs through the exact same Three.js `#include <tonemapping_fragment>` +
 *    `#include <colorspace_fragment>` display path as city geometry, preventing clipped white decals.
 *  - E-bike & car headlight rigs strictly stay <= 2 draw calls when active (0 when off, 1 during wheelie).
 *  - Boat lantern rigs put glowing shells on layer 0 (free planar water reflection) and water-shimmer
 *    planes on `WATER_LAYER` (layer 1, excluded from mirror camera), <= 2 draw calls at night, 0 by day.
 */

export type VehicleLightKind = 'bike' | 'car'
export type BoatLanternKind = 'rowboat' | 'freeRaft' | 'cruise' | 'huafang'

/** Shared sRGB hex palette calibrated against Guilin's sodium roadLight (0xffe2bc) & bridgeLamp (0xffd08a). */
export const LIGHT_PALETTE = {
  bikeLow: 0xffe7c6,       // ~4300K warm halogen-LED
  bikeHigh: 0xfff0dc,      // ~5000K neutral warm white
  bikeTier2Low: 0xf6f3ec,  // dual-projector crisp warm white
  bikeTier2High: 0xeef2ff, // dual-projector clean high beam
  carLow: 0xffe9cf,        // ~4500K refined projector low beam
  carHigh: 0xfff3e6,       // ~5500K refined projector high beam
  carDrl: 0xfff6ea,
  tailIdle: 0xb81f16,
  tailHalo: 0xff3b22,
  brakeCore: 0xff1e12,
  brakeHalo: 0xff462b,
  reverseWarm: 0xfff4e4,   // warm tungsten-white reverse lamp (replaces harsh cold white)
  amberTurn: 0xffa21a,
  lanternCore: 0xffb85c,
  lanternPaper: 0xe0532e,
  lanternGlow: 0xffae42,
  fishFire: 0xffc46a,
  cruiseEave: 0xffcf7a,
  lensOffFront: 0xc8c7bd,
  lensOffTail: 0x7a1a16,
  lensOffReverse: 0x454a50,
} as const

export interface HeadlightPolicy {
  /** Whether the rider/driver can manually switch between off / low / high beam. */
  switchable: boolean
  /** Highest beam tier permitted for this vehicle. */
  maxMode: 'off' | 'low' | 'high'
  /** User-facing explanation when a manual switch is intercepted. */
  rejectMessage?: string
}

/**
 * Authoritative headlight switching policy shared across physics (`ride.ts`), state coupling,
 * HUD bindings, and tests:
 *  - Shared bicycles & shared e-bikes CANNOT toggle low/high beam (auto night low-beam only).
 *  - Personal/normal e-bikes and cars support full off / low / high beam switching.
 */
export function headlightPolicyFor(
  kind: TwoWheelVehicleKind | 'car',
  vehicleType: 'normal' | 'shared' = 'normal',
): HeadlightPolicy {
  if (kind === 'bicycle') {
    return {
      switchable: false,
      maxMode: 'off',
      rejectMessage: '共享单车不支持切换远近光',
    }
  }
  if (kind === 'bike' && vehicleType === 'shared') {
    return {
      switchable: false,
      maxMode: 'low',
      rejectMessage: '共享电动车为自动感应车灯，不支持切换远近光',
    }
  }
  return {switchable: true, maxMode: 'high'}
}

export interface HeadlightBeamUpdate {
  mode: TwoWheelHeadlightMode
  night: number
  wheelie?: number
  crashed?: boolean
  batteryDepleted?: boolean
  /** Voltage sag multiplier during car starter cranking (0.55..1, default 1). */
  crankDim?: number
  /** Upgrade lens tier for personal e-bikes (0 = stock, 1 = bright, 2 = dual projector). */
  tier?: 0 | 1 | 2
}

export interface HeadlightBeamProbe {
  mode: TwoWheelHeadlightMode
  intensity: number
  beamActive: boolean
  coneVisible: boolean
  poolVisible: boolean
  drawCalls: number
  usesDynamicLights: false
}

export interface HeadlightBeamRig {
  group: T.Group
  coneMesh: T.Mesh
  poolMesh: T.Mesh
  setTier: (tier: 0 | 1 | 2) => void
  update: (state: HeadlightBeamUpdate) => void
  probe: () => HeadlightBeamProbe
  dispose: () => void
}

let cachedBikeCone: T.BufferGeometry | null = null
let cachedCarTwinCone: T.BufferGeometry | null = null
let cachedPoolPlane: T.BufferGeometry | null = null

function buildUnitBeamCone(): T.BufferGeometry {
  // Narrow end (r=0.06, uv.y=1) at local origin (0,0,0), wide end (r=1.0, uv.y=0) at (0,0,-1).
  const g = new T.CylinderGeometry(0.06, 1.0, 1.0, 14, 1, true)
  g.translate(0, -0.5, 0)
  g.rotateX(Math.PI / 2)
  return g
}

function getBikeConeGeometry(): T.BufferGeometry {
  cachedBikeCone ??= buildUnitBeamCone()
  return cachedBikeCone
}

function getCarTwinConeGeometry(): T.BufferGeometry {
  if (!cachedCarTwinCone) {
    const left = buildUnitBeamCone()
    left.translate(-0.62, 0, 0)
    const right = buildUnitBeamCone()
    right.translate(0.62, 0, 0)
    cachedCarTwinCone = mergeGeometries([left, right], false)
    left.dispose()
    right.dispose()
  }
  return cachedCarTwinCone
}

function getPoolGeometry(): T.BufferGeometry {
  if (!cachedPoolPlane) {
    const g = new T.PlaneGeometry(1, 1, 1, 1)
    g.rotateX(-Math.PI / 2)
    g.translate(0, 0, -0.5)
    cachedPoolPlane = g
  }
  return cachedPoolPlane
}

/** Shared GLSL helpers aligned with `look/atmosphere.ts` transmittance & soft highlight rolloff. */
const VL_COMMON = /* glsl */ `
uniform vec3 uHazeNear;
uniform vec3 uHazeFar;
uniform vec3 uHorizon;
uniform vec4 uFog;
uniform vec4 uFogBands;
uniform float uNight;
uniform float uTime;
uniform float uRain;
uniform vec3 uSun;
uniform vec3 uSunColor;

float vlFogLayer(float y) {
  return exp(-max(y - uFog.z, 0.0) / max(1.0, uFog.w));
}

float vlTransmittance(vec3 worldPos) {
  float fogLen = max(200.0, uFog.x);
  float dist = length(worldPos - cameraPosition);
  float dy = worldPos.y - cameraPosition.y;
  float valley = abs(dy) < 1.0
    ? vlFogLayer(0.5 * (worldPos.y + cameraPosition.y))
    : clamp(uFog.w * (vlFogLayer(cameraPosition.y) - vlFogLayer(worldPos.y)) / dy, 0.0, 1.0);
  float low = 0.5 * (worldPos.y + cameraPosition.y) - uFog.z;
  float dens = (1.0 + uFog.y * valley) * exp(-max(low, 0.0) / ${look.airScaleHeight.toFixed(1)});
  float fogFactor = 1.0 - exp(-dist * dens / fogLen);
  float edge = smoothstep(uFogBands.z, uFogBands.w, dist);
  return clamp(1.0 - max(fogFactor, edge), 0.0, 1.0);
}

float vlFogThick() {
  float fogLen = uFog.x > 1.0 ? uFog.x : 3600.0;
  return clamp((2600.0 - fogLen) / 1800.0, 0.0, 1.0);
}

vec3 vlSoftKnee(vec3 c, float peak) {
  return peak * (1.0 - exp(-max(c, vec3(0.0)) / max(0.01, peak)));
}

float vlHash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vlHgPhase(float cosTheta, float g) {
  float g2 = g * g;
  float denom = max(0.08, 1.0 + g2 - 2.0 * g * cosTheta);
  return (1.0 - g2) / (4.0 * 3.14159265 * pow(denom, 1.5));
}

float vlLuma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

float vlNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = vlHash21(i);
  float b = vlHash21(i + vec2(1.0, 0.0));
  float c = vlHash21(i + vec2(0.0, 1.0));
  float d = vlHash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// 0 at clear noon -> 1 at night. Daytime murk lifts it a little so beams still read in fog/rain.
float vlDayVis() {
  return smoothstep(0.04, 0.62, uNight + 0.45 * vlFogThick() + 0.2 * uRain);
}

vec3 vlSunHue() {
  return uSunColor / max(1e-4, max(uSunColor.r, max(uSunColor.g, uSunColor.b)));
}

// Sunset warm-gold window (dusk, uNight 0.12 -> 0.5), gated by how golden the sun really is.
float vlDuskGold() {
  vec3 h = vlSunHue();
  float sunLum = max(uSunColor.r, max(uSunColor.g, uSunColor.b));
  float warm = smoothstep(0.25, 0.7, h.r - h.b) * smoothstep(0.03, 0.3, sunLum);
  return warm * smoothstep(0.06, 0.14, uNight) * (1.0 - smoothstep(0.46, 0.6, uNight));
}

// Blue hour (uNight 0.5 -> 0.9).
float vlBlueHour() {
  return smoothstep(0.42, 0.56, uNight) * (1.0 - smoothstep(0.86, 0.97, uNight));
}

// Luminance-preserving time-of-day grade for lamp light (linear in, linear out):
// dusk absorbs 15% sunset gold, blue hour settles to ~4600K warm neutral, deep night stays one notch
// cleaner/whiter than sodium roadLight 0xffe2bc and bridgeLamp 0xffd08a.
vec3 vlGradeLamp(vec3 c) {
  float L = vlLuma(c);
  vec3 h = vlSunHue();
  vec3 gold = h / max(0.05, vlLuma(h));
  c = mix(c, L * gold, 0.15 * vlDuskGold());
  c = mix(c, L * vec3(1.13, 0.985, 0.84), 0.38 * vlBlueHour());
  c = mix(c, vec3(L), 0.06 * smoothstep(0.9, 1.0, uNight));
  return c;
}

// Linear -> display-referred hue, normalised to max channel 1 (display-space authoring: the scene buffer is sRGB).
vec3 vlDisplayHue(vec3 c) {
  vec3 d = pow(max(c, vec3(1e-4)), vec3(1.0 / 2.2));
  return d / max(1e-3, max(d.r, max(d.g, d.b)));
}

// Scattered light picks up a whisper of the ambient haze hue in fog.
vec3 vlFogTint(vec3 c) {
  vec3 hz = uHazeNear / max(0.03, vlLuma(uHazeNear));
  return mix(c, c * clamp(hz, vec3(0.6), vec3(1.5)), 0.12 * vlFogThick());
}

// Linear below the knee, exponential roll into the cap above it.
float vlShoulder(float x, float knee, float cap) {
  return x < knee ? x : knee + (cap - knee) * (1.0 - exp(-(x - knee) / max(1e-3, cap - knee)));
}
`

const CONE_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vViewPos;
varying vec3 vViewNormal;
varying vec3 vBeamDir;
void main() {
  vUv = uv;
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  vBeamDir = normalize((modelMatrix * vec4(0.0, 0.0, -1.0, 0.0)).xyz);
  vec4 mvPos = viewMatrix * worldPos;
  vViewPos = mvPos.xyz;
  vViewNormal = normalMatrix * normal;
  gl_Position = projectionMatrix * mvPos;
}
`

const CONE_FRAG = /* glsl */ `
${VL_COMMON}
uniform vec3 uColor;
uniform float uIntensity;
uniform float uReach;
uniform float uPeakCap;
uniform float uHigh;
uniform float uGroundY;
varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vViewPos;
varying vec3 vViewNormal;
varying vec3 vBeamDir;

// Fine falling rain lit inside the beam: two camera-aligned column layers, AA'd by fwidth, fading to an
// even shimmer once columns shrink below a pixel (no moire, no blocky cells).
float vlRainStreaks(vec3 wp) {
  vec2 camRight = normalize(vec2(viewMatrix[0][0], viewMatrix[2][0]) + vec2(1e-4, 0.0));
  float hx = dot(wp.xz, camRight);
  float acc = 0.0;
  for (int k = 0; k < 2; k++) {
    float layer = float(k);
    float cx = hx * mix(6.0, 11.0, layer) + layer * 0.37;
    float colId = floor(cx);
    float r = vlHash21(vec2(colId, 17.0 * layer + 1.0));
    float r2 = vlHash21(vec2(colId * 1.7, 3.1 + layer));
    float fw = fwidth(cx);
    float lane = 1.0 - smoothstep(0.06, 0.06 + 1.5 * fw, abs(fract(cx) - 0.5));
    float fall = wp.y * (1.1 + 0.6 * r2) + uTime * (7.5 + 3.0 * r) + r * 11.0;
    float seg = fract(fall * 0.55);
    float drop = smoothstep(0.0, 0.05, seg) * (1.0 - smoothstep(0.1, 0.42, seg));
    float aa = 1.0 - smoothstep(0.35, 0.9, fw);
    acc += mix(0.07, lane * drop * step(0.42, r), aa) * mix(1.0, 0.6, layer);
  }
  return acc;
}

void main() {
  float t = clamp(1.0 - vUv.y, 0.0, 1.0);
  float d = t * max(1.0, uReach);
  // Quadratic emergence over the first ~1.6 m: the beam grows out of the lens glow, no lip at the exit.
  float nearSoft = smoothstep(0.0, 1.6, d);
  nearSoft *= nearSoft;
  float invR = 1.0 / (1.0 + d / mix(3.2, 6.5, uHigh));
  float farFade = 1.0 - smoothstep(0.45, 1.0, t);
  farFade *= farFade;

  // Fresnel-style rim falloff: the silhouette has the shortest optical path, so it melts away.
  float facing = abs(dot(normalize(vViewNormal), normalize(-vViewPos)));
  float edge = smoothstep(0.02, 0.6, facing) * (0.45 + 0.55 * facing);

  // Henyey-Greenstein view scattering with a soft-saturated forward lobe: head-on glows but never spears,
  // from behind the beam reads as light, airy side scatter.
  vec3 ray = normalize(vWorldPos - cameraPosition);
  float cosT = dot(normalize(vBeamDir), -ray);
  float base = mix(0.5, 1.0, smoothstep(-1.0, 0.35, cosT));
  float hg = vlHgPhase(cosT, 0.62) * 12.566;
  float phase = 0.55 * base + 0.45 * 4.0 * (1.0 - exp(-hg / 4.0));

  // Clear night stays restrained; fog drifts a rich, soft Tyndall column; rain adds a little body.
  float fogK = vlFogThick();
  float fogN = vlNoise(vWorldPos.xz * 0.44 + vec2(uTime * 0.08, -uTime * 0.05)) * 0.54
             + vlNoise(vWorldPos.xz * 1.32 - vec2(uTime * 0.14, uTime * 0.04)) * 0.46;
  float dens = 0.28 + 2.25 * fogK * (0.48 + 1.04 * fogN) + 0.58 * uRain;

  // Melt where the cone meets the road instead of a hard depth-test seam.
  float groundSoft = smoothstep(0.0, 0.55, vWorldPos.y - uGroundY);
  float vis = mix(0.05, 1.0, vlDayVis()) * (1.0 + 0.15 * vlBlueHour()) * vlTransmittance(vWorldPos);
  float body = uIntensity * nearSoft * invR * farFade * groundSoft * vis;

  float e = body * edge * phase * dens * 2.6;
  float rain = uRain > 0.01 ? uRain * vlRainStreaks(vWorldPos) * body * (0.2 + 0.8 * edge) * 0.8 : 0.0;

  vec3 col = vlFogTint(vlGradeLamp(uColor));
  vec3 hue = vlDisplayHue(col);
  hue *= mix(vec3(1.0), vec3(0.93, 0.98, 1.06), uHigh * (1.0 - facing) * 0.7);
  vec3 lit = vlSoftKnee(hue * (e + rain), uPeakCap);
  if (max(lit.r, max(lit.g, lit.b)) < 0.0006) discard;
  // Display-space additive (scene buffer is sRGB-referred): no tonemap lift of near-zero energy into edges.
  gl_FragColor = vec4(lit, 0.0);
}
`

const POOL_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorldPos;
void main() {
  vUv = uv;
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`

const POOL_FRAG = /* glsl */ `
${VL_COMMON}
uniform vec3 uColor;
uniform float uIntensity;
uniform float uHighBeam;
uniform float uSharpCutoff;
varying vec2 vUv;
varying vec3 vWorldPos;

// Soft-screen illumination (src.rgb + dst.rgb * (1 - src.a)): clearly lights dark night/dusk asphalt
// with an asymmetric right-hand kerb cutoff while never clipping bright streetlit roads to dead white,
// and works identically on both HalfFloat high-quality and 8-bit low-quality targets.
void main() {
  float u = vUv.x * 2.0 - 1.0;   // -1 left .. +1 right (kerb side, right-hand traffic)
  float v = clamp(vUv.y, 0.0, 1.0); // 0 at the bumper .. 1 at full throw
  float soft = mix(0.24, 0.11, uSharpCutoff);
  float fore = smoothstep(0.0, 0.12, v);

  // Low beam: plan-view spread widens with throw; asymmetric cutoff kinks ~15 deg up the kerb side so the
  // right throws to ~98% while the oncoming lane is cut at ~68%; warm luminous carpet visible past car hood.
  float s = mix(0.32, 1.0, sqrt(clamp(v / 0.68, 0.0, 1.0)));
  float lateral = exp(-(u * u) / (s * s) * 2.15);
  float reachL = mix(0.68, 0.98, smoothstep(-0.08, 0.30, u));
  float cutL = 1.0 - smoothstep(reachL - soft, reachL, v);
  float fill = (0.64 + 0.36 * smoothstep(0.03, 0.26, v)) * (1.0 - 0.22 * smoothstep(0.46, 0.96, v));
  float du = (u - 0.14) / 0.32;
  float dv = (v - 0.40) / 0.22;
  float hot = exp(-du * du - dv * dv);
  float low = (0.88 * fill * lateral + 0.82 * hot) * cutL * fore;

  // High beam: wide fill + long penetrating central core, no cutoff, soft far tail.
  float sh = mix(0.36, 1.0, sqrt(clamp(v / 0.52, 0.0, 1.0)));
  float wide = exp(-(u * u) / (sh * sh) * 1.65) * (1.0 - smoothstep(0.62, 1.0, v));
  float coreW = 0.17 + 0.23 * v;
  float core = exp(-(u * u) / (coreW * coreW)) * smoothstep(0.04, 0.36, v) * (1.0 - smoothstep(0.76, 1.0, v));
  float high = (0.56 * wide + 0.96 * core + 0.26 * low) * fore;
  float g = mix(low, high, uHighBeam);

  // Rainy night: wet asphalt puddles catch elongated specular sheen + subtle rain-dimpled glints (AA'd).
  float pud = vlNoise(vWorldPos.xz * 0.46) * 0.62 + vlNoise(vWorldPos.xz * 1.65 + 7.3) * 0.38;
  float puddle = smoothstep(0.52, 0.68, pud) * uRain;
  float wetStreak = (0.72 + 0.28 * sin(vWorldPos.z * 16.0 + vWorldPos.x * 11.0 + pud * 6.0 - uTime * 2.4)) * uRain;
  vec2 gp = vWorldPos.xz * 7.0;
  float gfw = fwidth(gp.x) + fwidth(gp.y);
  float gh = vlHash21(floor(gp));
  float twinkle = 0.5 + 0.5 * sin(uTime * (5.0 + 6.0 * gh) + gh * 40.0);
  float dotM = 1.0 - smoothstep(0.08, 0.08 + gfw, length(fract(gp) - 0.5));
  float glint = step(0.86, gh) * twinkle * dotM * (1.0 - smoothstep(0.3, 0.8, gfw));
  g *= (1.0 - 0.10 * uRain) * (1.0 + puddle * (0.52 + 1.1 * glint) + 0.18 * wetStreak);

  vec2 bd = min(vUv, 1.0 - vUv);
  float border = smoothstep(0.0, 0.08, bd.x) * smoothstep(0.0, 0.03, bd.y);
  // Dusk & blue hour stay clearly visible (no double attenuation); fog gently reins in mid-pool peak to prevent whiteout.
  float envVis = mix(0.46, 1.0, vlDayVis());
  float energy = uIntensity * 0.72 * g * border * envVis * vlTransmittance(vWorldPos);
  float fogPeakTrim = 1.0 - 0.18 * vlFogThick();
  energy = vlShoulder(energy, mix(0.35, 0.44, uHighBeam) * fogPeakTrim, mix(0.54, 0.64, uHighBeam) * fogPeakTrim);
  if (energy < 0.0015) discard;

  vec3 hue = vlDisplayHue(vlGradeLamp(uColor));
  hue *= mix(vec3(1.0), vec3(1.0, 0.96, 0.88), clamp(hot * cutL, 0.0, 1.0) * 0.85 * (1.0 - uHighBeam));
  hue *= mix(vec3(1.0), vec3(0.93, 0.975, 1.04), smoothstep(0.18, 0.9, abs(u) / sh) * uHighBeam);
  vec3 lit = hue * energy;
  float screenA = clamp(vlLuma(lit) * 0.72, 0.0, 0.54);
  gl_FragColor = vec4(lit, screenA);
}
`

function smoothstep01(t: number): number {
  const c = T.MathUtils.clamp(t, 0, 1)
  return c * c * (3 - 2 * c)
}

const _seatPos = new T.Vector3()
const _seatQuat = new T.Quaternion()
const _seatScale = new T.Vector3()
const _seatYaw = new T.Quaternion()
const _seatPitch = new T.Quaternion()
const _seatVec = new T.Vector3()
const _seatInv = new T.Matrix4()
const X_AXIS = new T.Vector3(1, 0, 0)
const Y_AXIS = new T.Vector3(0, 1, 0)

/**
 * Seats the road pool on the ground below the lamp, cancelling vehicle roll/lean while gently tracking
 * road pitch so the beam pool hugs sloped Guilin roads without floating or sinking under asphalt.
 */
function seatPoolOnGround(group: T.Object3D, pool: T.Object3D, mountHeight: number, ahead: number): number {
  group.matrixWorld.decompose(_seatPos, _seatQuat, _seatScale)
  const upY = _seatVec.set(0, 1, 0).applyQuaternion(_seatQuat).y
  const scaleY = Math.max(0.05, Math.abs(_seatScale.y))
  const groundY = _seatPos.y - mountHeight * scaleY * Math.max(0.2, upY)
  _seatVec.set(0, 0, -1).applyQuaternion(_seatQuat)
  const horiz = Math.hypot(_seatVec.x, _seatVec.z)
  const pitch = horiz > 1e-4 ? T.MathUtils.clamp(Math.atan2(_seatVec.y, horiz), -0.14, 0.14) : 0
  _seatYaw.setFromAxisAngle(Y_AXIS, Math.atan2(-_seatVec.x, -_seatVec.z))
  _seatPitch.setFromAxisAngle(X_AXIS, pitch)
  _seatYaw.multiply(_seatPitch)
  _seatVec.set(0, 0, -ahead * scaleY).applyQuaternion(_seatYaw).add(_seatPos)
  _seatVec.y = groundY + 0.055
  _seatInv.copy(group.matrixWorld).invert()
  pool.position.copy(_seatVec).applyMatrix4(_seatInv)
  pool.quaternion.copy(_seatQuat).invert().multiply(_seatYaw)
  return groundY
}

export function createHeadlightBeamRig(
  kind: VehicleLightKind,
  opts?: {tier?: 0 | 1 | 2; mountHeight?: number},
): HeadlightBeamRig {
  const isCar = kind === 'car'
  let tier: 0 | 1 | 2 = opts?.tier ?? 0
  const mountHeight = opts?.mountHeight ?? (isCar ? 0.64 : 1.106)
  const poolAhead = isCar ? 0.45 : 0.55
  const group = new T.Group()
  group.name = `${kind}-headlight-beams`

  const coneUniforms: Record<string, T.IUniform> = {
    uColor: {value: new T.Color(isCar ? LIGHT_PALETTE.carLow : LIGHT_PALETTE.bikeLow)},
    uIntensity: {value: 0},
    uReach: {value: isCar ? 17 : 13.5},
    uPeakCap: {value: isCar ? 0.30 : 0.38},
    uHigh: {value: 0},
    uGroundY: {value: -mountHeight},
  }
  shareAtmosphere({uniforms: coneUniforms})

  const poolUniforms: Record<string, T.IUniform> = {
    uColor: {value: new T.Color(isCar ? LIGHT_PALETTE.carLow : LIGHT_PALETTE.bikeLow)},
    uIntensity: {value: 0},
    uHighBeam: {value: 0},
    uSharpCutoff: {value: 0},
  }
  shareAtmosphere({uniforms: poolUniforms})

  const coneMat = new T.ShaderMaterial({
    vertexShader: CONE_VERT,
    fragmentShader: CONE_FRAG,
    uniforms: coneUniforms,
    transparent: true,
    depthWrite: false,
    blending: T.CustomBlending,
    blendEquation: T.AddEquation,
    blendSrc: T.OneFactor,
    blendDst: T.OneMinusSrcAlphaFactor,
    side: T.FrontSide,
    fog: false,
  })
  // Soft-screen light-up: rgb = src + dst * (1 - screenA); visible on dark dusk/night asphalt without ever
  // washing streetlit roads into clipped dead white, consistent on HalfFloat and 8-bit targets.
  const poolMat = new T.ShaderMaterial({
    vertexShader: POOL_VERT,
    fragmentShader: POOL_FRAG,
    uniforms: poolUniforms,
    transparent: true,
    depthWrite: false,
    blending: T.CustomBlending,
    blendEquation: T.AddEquation,
    blendSrc: T.OneFactor,
    blendDst: T.OneMinusSrcAlphaFactor,
    blendEquationAlpha: T.AddEquation,
    blendSrcAlpha: T.ZeroFactor,
    blendDstAlpha: T.OneFactor,
    polygonOffset: true,
    polygonOffsetFactor: -8,
    polygonOffsetUnits: -8,
    fog: false,
  })

  const coneMesh = new T.Mesh(isCar ? getCarTwinConeGeometry() : getBikeConeGeometry(), coneMat)
  coneMesh.name = `${kind}-beam-cone`
  coneMesh.visible = false
  coneMesh.frustumCulled = false
  coneMesh.renderOrder = 5
  coneMesh.position.set(0, 0, -0.12)

  const poolMesh = new T.Mesh(getPoolGeometry(), poolMat)
  poolMesh.name = `${kind}-beam-pool`
  poolMesh.visible = false
  poolMesh.frustumCulled = false
  poolMesh.renderOrder = 4
  poolMesh.position.set(0, 0.025 - mountHeight, -poolAhead)

  group.add(coneMesh, poolMesh)

  let lastMode: TwoWheelHeadlightMode = 'off'
  let lastIntensity = 0
  let lastConeVisible = false
  let lastPoolVisible = false

  return {
    group,
    coneMesh,
    poolMesh,
    setTier(nextTier: 0 | 1 | 2) {
      tier = nextTier
    },
    update(state: HeadlightBeamUpdate) {
      lastMode = state.mode
      if (state.tier !== undefined) tier = state.tier
      const crankDim = state.crankDim !== undefined ? T.MathUtils.clamp(state.crankDim, 0, 1) : 1

      if (state.mode === 'off' || crankDim <= 0.005) {
        coneMesh.visible = false
        poolMesh.visible = false
        coneUniforms.uIntensity.value = 0
        poolUniforms.uIntensity.value = 0
        lastIntensity = 0
        lastConeVisible = false
        lastPoolVisible = false
        return
      }

      const high = state.mode === 'high'
      const nightMix = smoothstep01(state.night)
      // Faster dusk ramp so 18:15-18:45 dusk and 19:30 blue hour immediately show crisp low-beam throw.
      const duskRamp = smoothstep01(state.night * 2.4)
      const batScale = state.batteryDepleted ? 0.42 : 1
      const crashScale = state.crashed ? 0.28 : 1
      const tierGain = !isCar && tier === 2 ? 1.18 : !isCar && tier === 1 ? 1.08 : 1

      const baseStrength = high
        ? T.MathUtils.lerp(0.14, 0.60, nightMix)
        : T.MathUtils.lerp(0.09, 0.38, duskRamp)
      const coneAlpha = baseStrength * batScale * crashScale * crankDim * tierGain

      const reach = (isCar ? (high ? 31 : 20) : (high ? 24 : 15.5)) * (state.crashed ? 0.32 : 1) * (!isCar && tier === 2 ? 1.1 : 1)
      const spread = isCar ? (high ? 2.55 : 1.78) : (high ? 2.30 : 1.56)
      coneMesh.scale.set(spread, spread * 0.62, reach)
      coneMesh.rotation.x = high ? 0.008 : -0.026

      const lowHex = isCar ? LIGHT_PALETTE.carLow : tier === 2 ? LIGHT_PALETTE.bikeTier2Low : LIGHT_PALETTE.bikeLow
      const highHex = isCar ? LIGHT_PALETTE.carHigh : tier === 2 ? LIGHT_PALETTE.bikeTier2High : LIGHT_PALETTE.bikeHigh
      ;(coneUniforms.uColor.value as T.Color).setHex(high ? highHex : lowHex)
      coneUniforms.uIntensity.value = coneAlpha
      coneUniforms.uReach.value = reach
      coneUniforms.uHigh.value = high ? 1 : 0
      coneUniforms.uGroundY.value = seatPoolOnGround(group, poolMesh, mountHeight, poolAhead)
      coneMesh.visible = coneAlpha > 0.005
      lastConeVisible = coneMesh.visible

      const wheelieFade = 1 - smoothstep01(((state.wheelie ?? 0) - 0.10) / 0.24)
      const poolStrength = state.crashed
        ? 0
        : (high ? T.MathUtils.lerp(0.32, 1.25, duskRamp) : T.MathUtils.lerp(0.36, 1.10, duskRamp)) *
          batScale *
          wheelieFade *
          crankDim *
          tierGain
      const poolWidth = isCar ? (high ? 11.0 : 8.6) : (high ? 7.8 : 6.4)
      const poolLength = isCar ? (high ? 35 : 24) : (high ? 25 : 18)
      poolMesh.scale.set(poolWidth, 1, poolLength)
      ;(poolUniforms.uColor.value as T.Color).setHex(high ? highHex : lowHex)
      poolUniforms.uIntensity.value = poolStrength
      poolUniforms.uHighBeam.value = high ? 1 : 0
      poolUniforms.uSharpCutoff.value = isCar || tier === 2 ? 1 : 0
      poolMesh.visible = poolStrength > 0.005
      lastPoolVisible = poolMesh.visible

      lastIntensity = Math.max(coneAlpha, poolStrength)
    },
    probe(): HeadlightBeamProbe {
      const drawCalls = (lastConeVisible ? 1 : 0) + (lastPoolVisible ? 1 : 0)
      return {
        mode: lastMode,
        intensity: +lastIntensity.toFixed(4),
        beamActive: drawCalls > 0,
        coneVisible: lastConeVisible,
        poolVisible: lastPoolVisible,
        drawCalls,
        usesDynamicLights: false,
      }
    },
    dispose() {
      coneMat.dispose()
      poolMat.dispose()
      group.removeFromParent()
    },
  }
}

/* ---------------- Batched Multi-Channel Lamp Clusters (Lens + Halo + Wet Streak) ---------------- */

export interface LampDef {
  /** Channel index 0..7 controlled via `setChannels(Float32Array)`. */
  channel: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7
  /** Local center position on parent group. */
  pos: readonly [number, number, number]
  /** Lens box dimensions [w, h, d]. */
  size: readonly [number, number, number]
  /** Optional Euler rotation [x, y, z] for the lens housing. */
  rot?: readonly [number, number, number]
  /** Outward emission normal direction (unit vector in local space). */
  dir: readonly [number, number, number]
  /** Lit core color (sRGB hex). */
  color: number
  /** Unlit housing color when channel is 0 (sRGB hex). */
  offColor: number
  /** Halo billboard radius (m); 0 disables halo. */
  haloSize?: number
  /** Halo color override (defaults to `color`). */
  haloColor?: number
  /** Ground Y in parent local space for rain-wet road streak; omit to skip wet streak. */
  wetGroundY?: number
  /** Wet streak half-width (m). */
  wetWidth?: number
}

function appendClusterQuad(
  positions: number[],
  normals: number[],
  uvs: number[],
  anchors: number[],
  dirs: number[],
  colors: number[],
  offColors: number[],
  meta: number[],
  anchor: readonly [number, number, number],
  dir: readonly [number, number, number],
  litCol: T.Color,
  offCol: T.Color,
  kind: number, // 0=lens, 1=halo billboard, 2=wet streak
  channel: number,
  size: number,
  extra: number,
) {
  // 2 triangles covering quad corners (-1,-1),(1,-1),(1,1), (-1,-1),(1,1),(-1,1)
  const corners: readonly [number, number][] = [
    [-1, -1], [1, -1], [1, 1],
    [-1, -1], [1, 1], [-1, 1],
  ]
  for (const [cx, cy] of corners) {
    positions.push(anchor[0], anchor[1], anchor[2])
    normals.push(dir[0], dir[1], dir[2])
    uvs.push(cx * 0.5 + 0.5, cy * 0.5 + 0.5)
    anchors.push(anchor[0], anchor[1], anchor[2])
    dirs.push(dir[0], dir[1], dir[2])
    colors.push(litCol.r, litCol.g, litCol.b)
    offColors.push(offCol.r, offCol.g, offCol.b)
    meta.push(kind, channel, size, extra)
  }
}

/**
 * Builds one merged geometry for an entire front or rear lamp cluster, split into two groups:
 *  - group 0 (material 0): opaque lens boxes — write depth;
 *  - group 1 (material 1): camera-facing halos + rain-night wet-road streaks — additive, never write depth.
 * Render with `new Mesh(geom, handle.materials)`.
 */
export function buildLampClusterGeometry(lamps: readonly LampDef[]): T.BufferGeometry {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const anchors: number[] = []
  const dirs: number[] = []
  const colors: number[] = []
  const offColors: number[] = []
  const meta: number[] = [] // [kind, channel, size, extra]

  const litCol = new T.Color()
  const offCol = new T.Color()
  const haloCol = new T.Color()
  const mat4 = new T.Matrix4()
  const euler = new T.Euler()
  const v = new T.Vector3()

  // Pass 1: opaque lens boxes (kind = 0)
  for (const lamp of lamps) {
    litCol.setHex(lamp.color)
    offCol.setHex(lamp.offColor)
    const box = new T.BoxGeometry(lamp.size[0], lamp.size[1], lamp.size[2]).toNonIndexed()
    if (lamp.rot) {
      euler.set(lamp.rot[0], lamp.rot[1], lamp.rot[2], 'XYZ')
      mat4.makeRotationFromEuler(euler)
    } else {
      mat4.identity()
    }
    mat4.setPosition(lamp.pos[0], lamp.pos[1], lamp.pos[2])
    const bPos = box.attributes.position
    const bNorm = box.attributes.normal
    const bUv = box.attributes.uv
    for (let i = 0; i < bPos.count; i++) {
      v.fromBufferAttribute(bPos, i).applyMatrix4(mat4)
      positions.push(v.x, v.y, v.z)
      v.fromBufferAttribute(bNorm, i).transformDirection(mat4)
      normals.push(v.x, v.y, v.z)
      uvs.push(bUv.getX(i), bUv.getY(i))
      anchors.push(lamp.pos[0], lamp.pos[1], lamp.pos[2])
      dirs.push(lamp.dir[0], lamp.dir[1], lamp.dir[2])
      colors.push(litCol.r, litCol.g, litCol.b)
      offColors.push(offCol.r, offCol.g, offCol.b)
      meta.push(0, lamp.channel, 1.0, 0)
    }
    box.dispose()
  }
  const lensCount = positions.length / 3

  // Pass 2: additive glow (kind 1 = camera-facing halo, kind 2 = wet-road reflection streak)
  for (const lamp of lamps) {
    offCol.setHex(lamp.offColor)
    haloCol.setHex(lamp.haloColor ?? lamp.color)
    if (lamp.haloSize && lamp.haloSize > 0) {
      appendClusterQuad(
        positions, normals, uvs, anchors, dirs, colors, offColors, meta,
        lamp.pos, lamp.dir, haloCol, offCol, 1, lamp.channel, lamp.haloSize, 0,
      )
    }
    if (lamp.wetGroundY !== undefined) {
      // extra = lamp height above the wet road (drives the mirror-point streak length)
      const groundAnchor: readonly [number, number, number] = [lamp.pos[0], lamp.wetGroundY, lamp.pos[2]]
      appendClusterQuad(
        positions, normals, uvs, anchors, dirs, colors, offColors, meta,
        groundAnchor, lamp.dir, haloCol, offCol, 2, lamp.channel, lamp.wetWidth ?? 0.28,
        Math.max(0.05, lamp.pos[1] - lamp.wetGroundY),
      )
    }
  }
  const total = positions.length / 3

  const geom = new T.BufferGeometry()
  geom.setAttribute('position', new T.Float32BufferAttribute(positions, 3))
  geom.setAttribute('normal', new T.Float32BufferAttribute(normals, 3))
  geom.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2))
  geom.setAttribute('aAnchor', new T.Float32BufferAttribute(anchors, 3))
  geom.setAttribute('aDir', new T.Float32BufferAttribute(dirs, 3))
  geom.setAttribute('aLitColor', new T.Float32BufferAttribute(colors, 3))
  geom.setAttribute('aOffColor', new T.Float32BufferAttribute(offColors, 3))
  geom.setAttribute('aMeta', new T.Float32BufferAttribute(meta, 4))
  geom.addGroup(0, lensCount, 0)
  if (total > lensCount) geom.addGroup(lensCount, total - lensCount, 1)
  geom.computeBoundingSphere()
  return geom
}

const CLUSTER_VERT = /* glsl */ `
attribute vec3 aAnchor;
attribute vec3 aDir;
attribute vec3 aLitColor;
attribute vec3 aOffColor;
attribute vec4 aMeta; // x=kind(0 lens,1 halo,2 wet), y=channel, z=size, w=extra

uniform float uChannels[8];
uniform float uRain;
uniform float uNight;
uniform vec4 uFog;

varying vec2 vUv;
varying vec3 vLitColor;
varying vec3 vOffColor;
varying vec3 vWorldPos;
varying float vKind;
varying float vChVal;
varying float vFacing;

float vcFogThick() {
  float fogLen = uFog.x > 1.0 ? uFog.x : 3600.0;
  return clamp((2600.0 - fogLen) / 1800.0, 0.0, 1.0);
}

void main() {
  vUv = uv;
  vLitColor = aLitColor;
  vOffColor = aOffColor;
  vKind = aMeta.x;
  int ch = int(clamp(aMeta.y + 0.5, 0.0, 7.0));
  float chVal = uChannels[0];
  if (ch == 1) chVal = uChannels[1];
  else if (ch == 2) chVal = uChannels[2];
  else if (ch == 3) chVal = uChannels[3];
  else if (ch == 4) chVal = uChannels[4];
  else if (ch == 5) chVal = uChannels[5];
  else if (ch == 6) chVal = uChannels[6];
  else if (ch == 7) chVal = uChannels[7];
  vChVal = chVal;

  vec3 worldDir = normalize((modelMatrix * vec4(aDir, 0.0)).xyz);
  vec4 worldAnchor = modelMatrix * vec4(aAnchor, 1.0);

  if (aMeta.x < 0.5) {
    // Lens housing box
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vec3 toCam = normalize(cameraPosition - wp.xyz);
    vFacing = dot(worldDir, toCam);
    gl_Position = projectionMatrix * viewMatrix * wp;
  } else if (aMeta.x < 1.5) {
    // Camera-facing halo billboard pulled 0.14m toward camera to avoid body clipping
    vec3 toCam = normalize(cameraPosition - worldAnchor.xyz);
    vFacing = dot(worldDir, toCam);
    float fogThick = vcFogThick();
    float scale = aMeta.z * (0.68 + 0.36 * fogThick + 0.22 * uRain) * step(0.01, chVal);
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
    vec3 up = cross(toCam, right);
    vec2 corner = uv * 2.0 - 1.0;
    vec3 wp = worldAnchor.xyz + toCam * 0.14 + (right * corner.x + up * corner.y) * scale;
    vWorldPos = wp;
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  } else {
    // Rain-night wet road streak stretched toward camera along XZ plane; aMeta.w is lamp height above road.
    vec3 toCam = cameraPosition - worldAnchor.xyz;
    vec2 camHoriz = normalize(toCam.xz + vec2(1e-4, 0.0));
    vec2 across = vec2(-camHoriz.y, camHoriz.x);
    vFacing = dot(worldDir, normalize(toCam));
    float activeStreak = step(0.02, chVal) * step(0.02, uRain * uNight);
    float lampH = max(0.28, aMeta.w);
    float len = clamp(lampH * (4.4 + 6.2 * uRain), 2.6, 8.2) * activeStreak;
    float cy = uv.y; // 0 at lamp base, 1 toward camera
    float halfW = aMeta.z * (0.78 + 0.85 * cy) * (1.0 + 0.25 * uRain) * activeStreak;
    float cx = uv.x * 2.0 - 1.0;
    vec3 wp = worldAnchor.xyz;
    wp.xz += camHoriz * (cy * len) + across * (cx * halfW);
    wp.y += 0.035;
    vWorldPos = wp;
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  }
}
`

const CLUSTER_FRAG = /* glsl */ `
${VL_COMMON}
varying vec2 vUv;
varying vec3 vLitColor;
varying vec3 vOffColor;
varying vec3 vWorldPos;
varying float vKind;
varying float vChVal;
varying float vFacing;

void main() {
  float trans = vlTransmittance(vWorldPos);

  if (vKind < 0.5) {
    // Opaque lens face: reflector bowl center hot-spot + soft-knee saturation guard (prevents crimson -> pink wash).
    vec2 p = vUv * 2.0 - 1.0;
    float r2 = dot(p, p);
    float bowl = mix(0.55, 1.0, exp(-r2 * 4.5));
    float bevel = 1.0 - 0.18 * smoothstep(0.72, 1.0, max(abs(p.x), abs(p.y)));
    float litAmt = clamp(vChVal, 0.0, 2.2);
    vec3 gradedLit = vlGradeLamp(vLitColor);
    vec3 litCol = vlSoftKnee(gradedLit * (0.95 + 0.65 * bowl) * litAmt, 1.35);
    vec3 col = mix(vOffColor * mix(0.95, 0.42, uNight), litCol, clamp(litAmt, 0.0, 1.0)) * bevel;
    col = mix(uHazeNear, col, trans);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    return;
  }

  if (vKind < 1.5) {
    // Tight jewel-like core + pow(1-r, 3.4) exponential aureole (no milky fog blob over car nose).
    if (vChVal <= 0.01) discard;
    float dirVis = smoothstep(-0.18, 0.55, vFacing);
    if (dirVis <= 0.002) discard;
    vec2 p = vUv * 2.0 - 1.0;
    float r2 = dot(p, p);
    if (r2 >= 1.0) discard;
    float r = sqrt(r2);
    float halo = exp(-34.0 * r2) * 0.76 + pow(max(0.0, 1.0 - r), 3.4) * 0.44;
    float dayScale = mix(0.10, 1.0, vlDayVis());
    float atmosBoost = (1.0 + 0.14 * vlBlueHour()) * (1.0 + 0.28 * vlFogThick() + 0.22 * uRain);
    float energy = halo * dirVis * vChVal * dayScale * atmosBoost * trans;
    if (energy < 0.0012) discard;
    vec3 hue = vlDisplayHue(vlFogTint(vlGradeLamp(vLitColor)));
    vec3 glow = vlSoftKnee(hue * energy, 0.48);
    gl_FragColor = vec4(glow, 0.0);
    return;
  }

  // Rain-night wet road reflection streak with fine horizontal asphalt ripple breakup.
  float wetMask = uRain * smoothstep(0.12, 0.78, uNight);
  if (vChVal <= 0.02 || wetMask <= 0.01) discard;
  float across = vUv.x * 2.0 - 1.0;
  float along = vUv.y;
  float n1 = vlNoise(vWorldPos.xz * 2.6 + vec2(0.0, -uTime * 0.65));
  float n2 = vlNoise(vWorldPos.xz * 9.5 + vec2(3.1, uTime * 1.1));
  float waveBand = 0.5 + 0.5 * sin(along * 34.0 + n1 * 7.0 - uTime * 3.0);
  float ripple = 0.34 + 0.66 * smoothstep(0.22, 0.80, waveBand) * (0.45 + 0.55 * smoothstep(0.18, 0.82, n2));
  float lateralSpread = mix(0.12, 0.24, along);
  float streak = exp(-across * across / lateralSpread) * pow(max(0.0, 1.0 - along), 1.32) * smoothstep(0.0, 0.07, along) * ripple;
  float energy = streak * vChVal * wetMask * 0.56 * trans;
  if (energy < 0.0012) discard;
  vec3 hue = vlDisplayHue(vlGradeLamp(vLitColor));
  vec3 col = vlSoftKnee(hue * energy, 0.48);
  gl_FragColor = vec4(col, 0.0);
}
`

export interface LampClusterHandle {
  /** Opaque lens material (group 0). */
  material: T.ShaderMaterial
  /** Two-pass material array `[opaqueLensMat, additiveGlowMat]` matching `buildLampClusterGeometry` groups 0 & 1. */
  materials: [T.ShaderMaterial, T.ShaderMaterial]
  channels: Float32Array
  /** Updates all 8 channel intensities in place (zero per-frame allocations). */
  setChannel: (idx: number, value: number) => void
  setChannels: (values: ArrayLike<number>) => void
  dispose: () => void
}

export function createLampClusterMaterial(): LampClusterHandle {
  const channels = new Float32Array(8)
  const uniforms: Record<string, T.IUniform> = {
    uChannels: {value: channels},
  }
  shareAtmosphere({uniforms})

  const lensMat = new T.ShaderMaterial({
    vertexShader: CLUSTER_VERT,
    fragmentShader: CLUSTER_FRAG,
    uniforms,
    transparent: false,
    depthWrite: true,
    side: T.FrontSide,
    fog: false,
  })

  const glowMat = new T.ShaderMaterial({
    vertexShader: CLUSTER_VERT,
    fragmentShader: CLUSTER_FRAG,
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: T.CustomBlending,
    blendEquation: T.AddEquation,
    blendSrc: T.OneFactor,
    blendDst: T.OneMinusSrcAlphaFactor,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
    side: T.DoubleSide,
    fog: false,
  })

  return {
    material: lensMat,
    materials: [lensMat, glowMat],
    channels,
    setChannel(idx: number, value: number) {
      if (idx >= 0 && idx < 8) channels[idx] = value
    },
    setChannels(values: ArrayLike<number>) {
      const n = Math.min(8, values.length)
      for (let i = 0; i < n; i++) channels[i] = values[i]
    },
    dispose() {
      lensMat.dispose()
      glowMat.dispose()
    },
  }
}

/* ---------------- Guilin Night-Mooring Boat Lantern & Water Shimmer Rig ---------------- */

export interface BoatLanternUpdate {
  night: number
  /** Distance from camera/player (m) for LOD gating (>260m hides water shimmer, >600m hides lanterns). */
  distance?: number
  /** Optional manual override: null = auto (on when night > 0.12), true = force on, false = force off. */
  manualOn?: boolean | null
  /** Whether water shimmer is allowed under global active budget (<= 4 shimmer planes). */
  allowShimmer?: boolean
}

export interface BoatLanternProbe {
  kind: BoatLanternKind
  lit: boolean
  lanternVisible: boolean
  shimmerVisible: boolean
  drawCalls: number
  usesDynamicLights: false
}

export interface BoatLanternRig {
  group: T.Group
  lanternMesh: T.Mesh
  shimmerMesh: T.Mesh
  update: (state: BoatLanternUpdate) => void
  probe: () => BoatLanternProbe
  dispose: () => void
}

interface LanternPoint {
  x: number
  y: number
  z: number
  radius: number
  colorHex: number
  flicker: number
}

function getBoatLanternLayout(kind: BoatLanternKind): {
  points: LanternPoint[]
  poleParts: {x: number; y: number; z: number; h: number}[]
  shimmerSize: [number, number]
} {
  if (kind === 'rowboat') {
    // Low bow bamboo post + single warm paper lantern (keeps clear of low Four-Lakes stone arches)
    return {
      points: [{x: 0, y: 0.66, z: -1.52, radius: 0.12, colorHex: LIGHT_PALETTE.lanternPaper, flicker: 1}],
      poleParts: [{x: 0, y: 0.44, z: -1.46, h: 0.46}],
      shimmerSize: [5.6, 13.0],
    }
  }
  if (kind === 'freeRaft') {
    // Classic Li River cormorant-raft stern fishing lantern ("漓江渔火")
    return {
      points: [{x: 0.14, y: 1.02, z: 1.88, radius: 0.115, colorHex: LIGHT_PALETTE.fishFire, flicker: 1}],
      poleParts: [{x: 0.14, y: 0.56, z: 1.88, h: 0.96}],
      shimmerSize: [6.0, 14.2],
    }
  }
  if (kind === 'cruise') {
    // Guilin sightseeing cruise boat: 6 steady warm eave lights + 2 bow navigation warm lamps
    const pts: LanternPoint[] = [
      {x: -0.92, y: 1.66, z: -2.0, radius: 0.085, colorHex: LIGHT_PALETTE.cruiseEave, flicker: 0},
      {x: 0.92, y: 1.66, z: -2.0, radius: 0.085, colorHex: LIGHT_PALETTE.cruiseEave, flicker: 0},
      {x: -0.92, y: 1.66, z: 0.0, radius: 0.085, colorHex: LIGHT_PALETTE.cruiseEave, flicker: 0},
      {x: 0.92, y: 1.66, z: 0.0, radius: 0.085, colorHex: LIGHT_PALETTE.cruiseEave, flicker: 0},
      {x: -0.92, y: 1.66, z: 2.0, radius: 0.085, colorHex: LIGHT_PALETTE.cruiseEave, flicker: 0},
      {x: 0.92, y: 1.66, z: 2.0, radius: 0.085, colorHex: LIGHT_PALETTE.cruiseEave, flicker: 0},
      {x: -0.68, y: 0.86, z: -2.75, radius: 0.095, colorHex: LIGHT_PALETTE.lanternCore, flicker: 0},
      {x: 0.68, y: 0.86, z: -2.75, radius: 0.095, colorHex: LIGHT_PALETTE.lanternCore, flicker: 0},
    ]
    return {points: pts, poleParts: [], shimmerSize: [7.2, 14.0]}
  }
  // Traditional Guilin huafang painted barge: 4 corner red paper lanterns + 2 bow warm lanterns
  const pts: LanternPoint[] = [
    {x: -0.88, y: 1.48, z: -1.9, radius: 0.135, colorHex: LIGHT_PALETTE.lanternPaper, flicker: 1},
    {x: 0.88, y: 1.48, z: -1.9, radius: 0.135, colorHex: LIGHT_PALETTE.lanternPaper, flicker: 1},
    {x: -0.88, y: 1.48, z: 1.9, radius: 0.135, colorHex: LIGHT_PALETTE.lanternPaper, flicker: 1},
    {x: 0.88, y: 1.48, z: 1.9, radius: 0.135, colorHex: LIGHT_PALETTE.lanternPaper, flicker: 1},
    {x: -0.56, y: 0.78, z: -2.78, radius: 0.10, colorHex: LIGHT_PALETTE.lanternCore, flicker: 0.6},
    {x: 0.56, y: 0.78, z: -2.78, radius: 0.10, colorHex: LIGHT_PALETTE.lanternCore, flicker: 0.6},
  ]
  return {points: pts, poleParts: [], shimmerSize: [7.6, 14.5]}
}

const lanternGeomCache = new Map<BoatLanternKind, T.BufferGeometry>()
let cachedShimmerGeom: T.BufferGeometry | null = null

function getBoatLanternGeometry(kind: BoatLanternKind): T.BufferGeometry {
  const existing = lanternGeomCache.get(kind)
  if (existing) return existing

  const layout = getBoatLanternLayout(kind)
  const parts: T.BufferGeometry[] = []
  const coreCol = new T.Color(LIGHT_PALETTE.lanternCore)
  const capCol = new T.Color(0x2e211a)
  const poleCol = new T.Color(0x5b4632)
  const paperCol = new T.Color()
  const tmp = new T.Color()

  for (const pole of layout.poleParts) {
    const cyl = new T.CylinderGeometry(0.018, 0.024, pole.h, 6).toNonIndexed()
    cyl.translate(pole.x, pole.y, pole.z)
    const count = cyl.attributes.position.count
    const colors = new Float32Array(count * 3)
    const flickers = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      colors[i * 3] = poleCol.r
      colors[i * 3 + 1] = poleCol.g
      colors[i * 3 + 2] = poleCol.b
      flickers[i] = -1 // non-emissive bamboo bracket
    }
    cyl.setAttribute('color', new T.BufferAttribute(colors, 3))
    cyl.setAttribute('aFlicker', new T.BufferAttribute(flickers, 1))
    parts.push(cyl)
  }

  for (let idx = 0; idx < layout.points.length; idx++) {
    const pt = layout.points[idx]
    paperCol.setHex(pt.colorHex)
    const sph = new T.SphereGeometry(pt.radius, 12, 8).toNonIndexed()
    sph.scale(1, 1.24, 1)
    const pos = sph.attributes.position
    const count = pos.count
    const colors = new Float32Array(count * 3)
    const flickers = new Float32Array(count)
    const maxY = pt.radius * 1.24
    for (let i = 0; i < count; i++) {
      const ly = pos.getY(i)
      const capBand = Math.abs(ly) / maxY
      if (capBand > 0.82) {
        tmp.copy(capCol)
        flickers[i] = -1
      } else {
        // Warm glowing lantern core in the belly tapering into rich vermilion/amber paper
        const coreMix = Math.max(0, 1 - capBand * 1.4)
        tmp.copy(paperCol).lerp(coreCol, coreMix * 0.65)
        flickers[i] = pt.flicker * (1 + idx * 0.37)
      }
      colors[i * 3] = tmp.r
      colors[i * 3 + 1] = tmp.g
      colors[i * 3 + 2] = tmp.b
    }
    sph.translate(pt.x, pt.y, pt.z)
    sph.setAttribute('color', new T.BufferAttribute(colors, 3))
    sph.setAttribute('aFlicker', new T.BufferAttribute(flickers, 1))
    parts.push(sph)
  }

  const merged = mergeGeometries(parts, false)
  for (const p of parts) p.dispose()
  if (!merged) throw new Error(`Failed to merge boat lantern geometry for ${kind}`)
  lanternGeomCache.set(kind, merged)
  return merged
}

function getBoatShimmerGeometry(): T.BufferGeometry {
  if (!cachedShimmerGeom) {
    const g = new T.PlaneGeometry(1, 1, 1, 1)
    g.rotateX(-Math.PI / 2)
    cachedShimmerGeom = g
  }
  return cachedShimmerGeom
}

const LANTERN_VERT = /* glsl */ `
attribute float aFlicker;
varying vec3 vColor;
varying float vFlicker;
varying vec3 vWorldPos;
void main() {
  vColor = color;
  vFlicker = aFlicker;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`

const LANTERN_FRAG = /* glsl */ `
${VL_COMMON}
uniform float uIntensity;
varying vec3 vColor;
varying float vFlicker;
varying vec3 vWorldPos;
void main() {
  float trans = vlTransmittance(vWorldPos);
  if (vFlicker < -0.5) {
    // Non-emissive pole / dark cap
    vec3 col = vColor * mix(0.85, 0.28, uNight);
    col = mix(uHazeNear, col, trans);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    return;
  }
  float seed = vFlicker;
  float wave = vFlicker > 0.05
    ? (0.92 + 0.05 * sin(11.3 * uTime + seed * 7.0) + 0.03 * sin(23.1 * uTime + seed * 13.0))
    : 1.0;
  vec3 lit = vColor * (0.35 + 1.55 * uIntensity * wave);
  lit = mix(uHazeNear, lit, trans);
  gl_FragColor = vec4(lit, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

const SHIMMER_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorldPos;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`

const SHIMMER_FRAG = /* glsl */ `
${VL_COMMON}
uniform vec3 uColor;
uniform float uIntensity;
varying vec2 vUv;
varying vec3 vWorldPos;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (r2 >= 1.0) discard;

  // Tighter warm-gold radial water bounce around the bow with smooth zero edge
  float edgeFade = 1.0 - smoothstep(0.54, 1.0, r2);
  float radial = exp(-r2 * 5.8) * edgeFade;

  // Fine dual-layer broken-gold Li River ripples whose width undulates organically along view vector
  vec2 toCam = normalize(cameraPosition.xz - vWorldPos.xz + vec2(1e-4, 0.0));
  float along = dot(p, toCam);
  float across = dot(p, vec2(-toCam.y, toCam.x));
  float distFrac = clamp((along + 0.22) / 1.15, 0.0, 1.0);
  float nWave = vlNoise(vWorldPos.xz * 3.2 + vec2(uTime * 0.55, -uTime * 0.42));
  float nFine = vlNoise(vWorldPos.xz * 11.0 - vec2(uTime * 1.1, uTime * 0.7));
  float spread = mix(0.065, 0.26, distFrac) * (0.72 + 0.56 * nWave);
  float ripA = 0.5 + 0.5 * sin(along * 42.0 + uTime * 2.6 + nWave * 6.5);
  float ripB = 0.5 + 0.5 * sin(along * 25.0 - uTime * 1.9 + nFine * 5.2 + across * 8.0);
  float flecks = smoothstep(0.46, 0.88, ripA) * 0.68 + smoothstep(0.52, 0.92, ripB) * 0.52;
  float brokenGold = flecks * (0.45 + 0.55 * nFine)
    * exp(-(across * across) / max(0.008, spread * spread))
    * smoothstep(-0.22, 0.18, along) * pow(max(0.0, 1.0 - distFrac), 1.25);

  float rippleMod = 0.80 + 0.20 * sin(vWorldPos.x * 2.4 + vWorldPos.z * 1.9 + uTime * 2.5);
  float trans = vlTransmittance(vWorldPos);
  float energy = (radial * 0.24 + brokenGold * 0.82) * rippleMod * uIntensity * trans * (1.0 + 0.25 * uRain);
  if (energy < 0.0012) discard;

  vec3 hue = vlDisplayHue(vlGradeLamp(uColor));
  vec3 col = vlSoftKnee(hue * energy, 0.48);
  // Display-space additive: zero gamma step at edge so water bounce dissolves naturally into Li River water.
  gl_FragColor = vec4(col, 0.0);
}
`

export function createBoatLanternRig(kind: BoatLanternKind): BoatLanternRig {
  const layout = getBoatLanternLayout(kind)
  const group = new T.Group()
  group.name = `boat-lantern-rig-${kind}`

  const lanternUniforms: Record<string, T.IUniform> = {
    uIntensity: {value: 0},
  }
  shareAtmosphere({uniforms: lanternUniforms})

  const lanternMat = new T.ShaderMaterial({
    vertexShader: LANTERN_VERT,
    fragmentShader: LANTERN_FRAG,
    uniforms: lanternUniforms,
    vertexColors: true,
    fog: false,
  })

  const lanternMesh = new T.Mesh(getBoatLanternGeometry(kind), lanternMat)
  lanternMesh.name = `boat-lantern-${kind}`
  lanternMesh.visible = false
  lanternMesh.layers.set(0) // Layer 0 => automatically appears in planar water mirror!

  const shimmerColor =
    kind === 'freeRaft'
      ? LIGHT_PALETTE.fishFire
      : kind === 'cruise'
        ? LIGHT_PALETTE.cruiseEave
        : LIGHT_PALETTE.lanternGlow
  const shimmerUniforms: Record<string, T.IUniform> = {
    uColor: {value: new T.Color(shimmerColor)},
    uIntensity: {value: 0},
  }
  shareAtmosphere({uniforms: shimmerUniforms})

  const shimmerMat = new T.ShaderMaterial({
    vertexShader: SHIMMER_VERT,
    fragmentShader: SHIMMER_FRAG,
    uniforms: shimmerUniforms,
    transparent: true,
    depthWrite: false,
    blending: T.CustomBlending,
    blendEquation: T.AddEquation,
    blendSrc: T.OneFactor,
    blendDst: T.OneMinusSrcAlphaFactor,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
    fog: false,
  })

  const shimmerMesh = new T.Mesh(getBoatShimmerGeometry(), shimmerMat)
  shimmerMesh.name = `boat-shimmer-${kind}`
  shimmerMesh.scale.set(layout.shimmerSize[0], 1, layout.shimmerSize[1])
  shimmerMesh.position.set(0, 0.035, kind === 'freeRaft' ? 1.65 : kind === 'rowboat' ? -1.45 : 0)
  shimmerMesh.visible = false
  shimmerMesh.renderOrder = 3
  shimmerMesh.layers.set(WATER_LAYER) // Layer 1 => drawn on water only, never doubled inside mirror

  group.add(lanternMesh, shimmerMesh)

  let lastLit = false
  let lastLanternVis = false
  let lastShimmerVis = false

  return {
    group,
    lanternMesh,
    shimmerMesh,
    update(state: BoatLanternUpdate) {
      const dist = state.distance ?? 0
      const autoIntensity = smoothstep01((state.night - 0.12) / 0.58)
      const manual = state.manualOn
      const intensity = manual === false ? 0 : manual === true ? Math.max(0.62, autoIntensity) : autoIntensity

      const active = intensity > 0.01 && dist <= 600
      const showShimmer = active && (state.allowShimmer !== false) && dist <= 260

      lanternUniforms.uIntensity.value = active ? intensity : 0
      shimmerUniforms.uIntensity.value = showShimmer ? intensity * (0.75 + 0.25 * smoothstep01(state.night)) : 0
      lanternMesh.visible = active
      shimmerMesh.visible = showShimmer

      lastLit = active
      lastLanternVis = active
      lastShimmerVis = showShimmer
    },
    probe(): BoatLanternProbe {
      const drawCalls = (lastLanternVis ? 1 : 0) + (lastShimmerVis ? 1 : 0)
      return {
        kind,
        lit: lastLit,
        lanternVisible: lastLanternVis,
        shimmerVisible: lastShimmerVis,
        drawCalls,
        usesDynamicLights: false,
      }
    },
    dispose() {
      lanternMat.dispose()
      shimmerMat.dispose()
      group.removeFromParent()
    },
  }
}
