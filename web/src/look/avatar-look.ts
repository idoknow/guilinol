import * as THREE from 'three'
import {look} from './config'
import {shareAtmosphere} from './atmosphere'
import {atmo, env} from './time'

/**
 * Character Style-Fusion Shader & Grounded Contact Shadow (`web/src/look/avatar-look.ts`).
 *
 * Calibrates the player avatar (and outfit accessories) into Guilin's Phase 2 street aesthetic:
 *  - Eliminates uniform chalky/plastic roughness via per-zone surface response (skin SSS wrap,
 *    hair top-sheen, matte woven cloth with subtle breakup, crisper shoes/helmets).
 *  - Couples directly with `atmo` uniforms (`uSun`, `uSunColor`, `uHorizon`, `uNight`, `uRain`):
 *    warm streetlamp pools (exact 22 m grid matching `look/night.ts`) + subtle storefront neon
 *    bounce at night, rain-dampened cloth darkening & shoulder sheen in rain, soft atmospheric rim.
 *  - Adds a 1-draw-call procedural ground contact shadow decal (0 dynamic Three.js lights,
 *    0 network bytes, never parented inside `figure` so vessel-bounds Box3 measurements stay pure).
 */

export const AVATAR_SURFACE = {
  SKIN: 0,
  HAIR: 1,
  FABRIC: 2,
  ACCESSORY: 3,
} as const

export type AvatarSurfaceKind = (typeof AVATAR_SURFACE)[keyof typeof AVATAR_SURFACE]

const cHex = (v: number) => new THREE.Color(v)

export const sharedAvatarUniforms = {
  uAvatarLamp: {value: cHex(look.roadLight)},
  uAvatarNeon: {value: look.buildings.neon.map(cHex)},
  uAvatarGround: {value: new THREE.Color(look.hemiGround)},
  uAvatarSunDir: {value: new THREE.Vector3(...look.sunDirection).normalize()},
  uAvatarSunCol: {value: new THREE.Color(look.sunColor)},
  uAvatarHorizon: {value: new THREE.Color(look.skyHorizon)},
  uAvatarSunUp: {value: 1},
}

/** Sync CPU-side time/weather colors into the shared avatar shader uniforms once per walk frame. */
export function syncAvatarLookUniforms(): void {
  sharedAvatarUniforms.uAvatarGround.value.copy(env.hemiGround)
  sharedAvatarUniforms.uAvatarSunDir.value.copy(env.sunDir)
  sharedAvatarUniforms.uAvatarSunCol.value.copy(env.sunColor).multiplyScalar(Math.min(1.6, env.sunPower * 0.52))
  sharedAvatarUniforms.uAvatarHorizon.value.copy(env.horizon)
  sharedAvatarUniforms.uAvatarSunUp.value = env.sunUp
}

export interface AvatarStyleOptions {
  /** Default surface kind when geometry lacks an `aAvatarSurface` attribute (e.g. procedural hats/bags). */
  defaultSurface?: AvatarSurfaceKind
  /** Slightly glossier specular for rigid helmets/visors. */
  glossyShell?: boolean
  /** Minimum local Y of the character geometry in bind pose (default 0 m). */
  minY?: number
  /** Nominal character height in local units for vertical contact-AO gradient (default 1.75 m). */
  heightSpan?: number
}

/**
 * Stamps per-vertex surface classification (`aAvatarSurface`) onto an avatar BufferGeometry
 * from semantic zone IDs (`OUTFIT_ZONE`) or a heuristic callback so a single draw call can shade
 * skin, hair, fabric, and footwear with distinct roughness, SSS wrap, and rain response.
 */
export function applyAvatarSurfaceAttribute(
  geometry: THREE.BufferGeometry,
  classifyVertex: (vertexIndex: number) => AvatarSurfaceKind,
): THREE.BufferAttribute {
  const pos = geometry.getAttribute('position')
  const count = pos ? pos.count : 0
  const data = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    data[i] = classifyVertex(i)
  }
  const attr = new THREE.BufferAttribute(data, 1)
  geometry.setAttribute('aAvatarSurface', attr)
  return attr
}

/**
 * Patches any `MeshStandardMaterial` (vertex-colored, UV-textured, or multi-material)
 * into the Guilin Phase 2 avatar shader with ZERO extra draw calls and ZERO dynamic lights.
 */
export function applyAvatarStyleMaterial(
  material: THREE.Material,
  options: AvatarStyleOptions = {},
): THREE.Material {
  if (!(material instanceof THREE.MeshStandardMaterial)) return material
  if (material.userData.__guilinAvatarStyled) return material

  const defaultSurface = options.defaultSurface ?? AVATAR_SURFACE.FABRIC
  const glossyShell = Boolean(options.glossyShell)
  const minY = Number.isFinite(options.minY) ? (options.minY as number) : 0
  const heightSpan = Math.max(0.35, options.heightSpan ?? 1.75)

  if (!material.roughnessMap) material.roughness = glossyShell ? 0.44 : 0.84
  if (!material.metalnessMap) material.metalness = glossyShell ? 0.08 : 0.02
  material.userData.__guilinAvatarStyled = true
  material.userData.__guilinAvatarStyleMeta = {defaultSurface, glossyShell, minY, heightSpan}

  const prevCompile = material.onBeforeCompile
  const cacheKey = `guilinol-avatar-style-v2-${defaultSurface}-${glossyShell ? 1 : 0}-${Math.round(minY * 100)}-${Math.round(heightSpan * 100)}`
  material.customProgramCacheKey = () => cacheKey

  material.onBeforeCompile = function (shader, renderer) {
    if (typeof prevCompile === 'function') prevCompile.call(this, shader, renderer)
    shareAtmosphere(shader)
    Object.assign(shader.uniforms, sharedAvatarUniforms)

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
#ifdef USE_AVATAR_SURFACE_ATTR
attribute float aAvatarSurface;
#endif
varying float vAvatarSurf;
varying float vAvatarLocalY;
varying vec3 vAvatarWorldN;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
#ifdef USE_AVATAR_SURFACE_ATTR
vAvatarSurf = aAvatarSurface;
#else
vAvatarSurf = ${defaultSurface.toFixed(1)};
#endif
vAvatarLocalY = clamp((position.y - (${minY.toFixed(3)})) / ${heightSpan.toFixed(3)}, 0.0, 1.25);`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
vAvatarWorldN = normalize(mat3(modelMatrix) * objectNormal + vec3(0.0, 1e-5, 0.0));`,
      )

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uNight;
uniform float uRain;
uniform vec3 uAvatarLamp;
uniform vec3 uAvatarNeon[6];
uniform vec3 uAvatarGround;
uniform vec3 uAvatarSunDir;
uniform vec3 uAvatarSunCol;
uniform vec3 uAvatarHorizon;
uniform float uAvatarSunUp;
varying float vAvatarSurf;
varying float vAvatarLocalY;
varying vec3 vAvatarWorldN;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  // Zone weights: 0=skin, 1=hair, 2=fabric, 3=shoes/accessory
  float isSkin = 1.0 - smoothstep(0.25, 0.75, vAvatarSurf);
  float isHair = smoothstep(0.25, 0.75, vAvatarSurf) * (1.0 - smoothstep(1.25, 1.75, vAvatarSurf));
  float isFabric = smoothstep(1.25, 1.75, vAvatarSurf) * (1.0 - smoothstep(2.25, 2.75, vAvatarSurf));
  float isAcc = smoothstep(2.25, 2.75, vAvatarSurf);

  // Subtle albedo decompression so Phase 2 uGrade (sat 1.22, contrast 1.12) does not turn cloth neon or skin plastic.
  float luma = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  float satScale = isSkin * 0.91 + isHair * 0.94 + isFabric * 0.84 + isAcc * 0.90;
  diffuseColor.rgb = mix(vec3(luma), diffuseColor.rgb, satScale);

  // Micro-weave tonal breakup on fabric & ground-contact vertical AO gradient (eliminates flat clay look).
  #ifdef USE_FOG
  float weave = sin(vFogWorld.x * 46.0 + vFogWorld.y * 22.0) * cos(vFogWorld.z * 46.0 - vFogWorld.y * 18.0);
  diffuseColor.rgb *= 1.0 + weave * 0.022 * isFabric;
  #endif
  float verticalAo = mix(0.84, 1.02, smoothstep(0.0, 0.44, vAvatarLocalY));
  diffuseColor.rgb *= mix(verticalAo, mix(0.94, 1.02, smoothstep(0.0, 0.35, vAvatarLocalY)), isSkin);

  // Rain wetness: cloth & hair darken naturally like Guilin's wet asphalt instead of looking chalk-dry.
  float wetDarken = mix(1.0, mix(0.82, 0.91, isSkin), uRain);
  diffuseColor.rgb *= wetDarken;
  // Slightly deepen hair base so dark hair does not wash out gray under bright sky light.
  diffuseColor.rgb *= mix(1.0, 0.90, isHair * (1.0 - uNight * 0.5));
  // Subtle leather/trim crispness on shoes & accessories
  diffuseColor.rgb *= mix(1.0, 0.97, isAcc * uRain);
}`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
{
  float isSkin = 1.0 - smoothstep(0.25, 0.75, vAvatarSurf);
  float isHair = smoothstep(0.25, 0.75, vAvatarSurf) * (1.0 - smoothstep(1.25, 1.75, vAvatarSurf));
  float isFabric = smoothstep(1.25, 1.75, vAvatarSurf) * (1.0 - smoothstep(2.25, 2.75, vAvatarSurf));
  float isAcc = smoothstep(2.25, 2.75, vAvatarSurf);
  float zoneRough = isSkin * 0.72 + isHair * 0.52 + isFabric * 0.90 + isAcc * ${glossyShell ? '0.42' : '0.60'};
  #ifdef USE_ROUGHNESSMAP
  float baseRough = mix(roughnessFactor, zoneRough, 0.35);
  #else
  float baseRough = zoneRough;
  #endif
  vec3 wn = normalize(vAvatarWorldN);
  float topCatch = smoothstep(0.15, 0.85, wn.y);
  // Wet sheen on top-facing shoulders, hair, and shoes during rain.
  float rainRough = mix(baseRough, mix(0.46, 0.30, isAcc + isHair * 0.5), uRain * (0.45 + 0.55 * topCatch));
  roughnessFactor = clamp(rainRough, 0.24, 0.96);
}`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
{
  vec3 wn = normalize(vAvatarWorldN);
  float isSkin = 1.0 - smoothstep(0.25, 0.75, vAvatarSurf);
  float isHair = smoothstep(0.25, 0.75, vAvatarSurf) * (1.0 - smoothstep(1.25, 1.75, vAvatarSurf));
  float ndl = dot(wn, normalize(uAvatarSunDir));

  // 1) Warm skin subsurface-scattering terminator wrap (eliminates dead cold-gray shadow side on faces/arms).
  float sssBand = smoothstep(-0.35, 0.20, ndl) * (1.0 - smoothstep(0.20, 0.65, ndl));
  vec3 warmSkinWrap = vec3(0.95, 0.48, 0.34) * diffuseColor.rgb * sssBand * isSkin * (0.14 * uAvatarSunUp + 0.04 * (1.0 - uNight));

  // 2) Subtle sky-horizon / rain Fresnel rim & warm street bounce (integrates silhouette into Guilin atmosphere).
  #ifdef USE_FOG
  vec3 viewDirW = normalize(cameraPosition - vFogWorld);
  float fresnel = pow(1.0 - max(dot(wn, viewDirW), 0.0), 3.1);
  float upMask = smoothstep(-0.2, 0.65, wn.y);
  vec3 dayRim = mix(uAvatarHorizon, uAvatarSunCol + uAvatarHorizon * 0.5, 0.45) * fresnel * upMask * (0.09 + 0.06 * uRain) * (1.0 - uNight * 0.72);
  vec3 groundBounce = uAvatarGround * diffuseColor.rgb * smoothstep(0.2, -0.75, wn.y) * (0.10 * (1.0 - uNight * 0.5));

  // 3) Night 22 m streetlamp pool & storefront neon coupling (exact same grid as look/night.ts nightStreets!).
  vec2 lampCell = floor(vFogWorld.xz / 22.0);
  vec2 lampF = vFogWorld.xz / 22.0 - lampCell - 0.5;
  float lampPool = 1.0 - smoothstep(0.06, 0.46, length(lampF));
  float lampHash = fract(sin(dot(lampCell, vec2(12.9898, 78.233))) * 43758.5453);
  vec3 neonTint = uAvatarNeon[int(min(5.0, floor(fract(lampHash * 9.7) * 6.0)))];
  vec3 nightKey = uAvatarLamp * (0.06 + 0.30 * lampPool) * (0.35 + 0.65 * upMask);
  vec3 nightFloorBounce = uAvatarLamp * (0.04 + 0.14 * lampPool) * smoothstep(0.35, -0.65, wn.y);
  vec3 nightRim = mix(uAvatarLamp, neonTint, 0.42) * fresnel * (0.14 + 0.14 * uRain);
  vec3 nightContrib = (diffuseColor.rgb * (nightKey + nightFloorBounce) + nightRim * (0.55 + 0.45 * isHair)) * uNight;

  // 4) View-dependent cool-neutral hair highlight so dark hair reads crisp without a flat brown top cap.
  vec3 halfVec = normalize(normalize(uAvatarSunDir) + viewDirW);
  float hairSpec = pow(max(dot(wn, halfVec), 0.0), 10.0) * smoothstep(0.15, 0.85, wn.y);
  vec3 hairTint = mix(mix(uAvatarHorizon, uAvatarSunCol, 0.35), uAvatarLamp, uNight);
  vec3 hairSheen = hairTint * isHair * (hairSpec * 0.095 + smoothstep(0.55, 0.95, wn.y) * 0.015) * (1.0 - uNight * 0.35);

  totalEmissiveRadiance += warmSkinWrap + dayRim + groundBounce + nightContrib + hairSheen;
  #else
  totalEmissiveRadiance += warmSkinWrap;
  #endif
}`,
      )
  }

  material.needsUpdate = true
  return material
}

/** Enable the per-vertex `aAvatarSurface` define on a styled material once its geometry has the attribute. */
export function enableAvatarSurfaceAttributeOnMaterial(material: THREE.Material): void {
  if (!(material instanceof THREE.MeshStandardMaterial)) return
  const matWithDefines = material as THREE.MeshStandardMaterial & {defines?: Record<string, unknown>}
  matWithDefines.defines = {...(matWithDefines.defines ?? {}), USE_AVATAR_SURFACE_ATTR: 1}
  material.userData.__guilinAvatarHasSurfaceAttr = true
  const baseKey = material.customProgramCacheKey?.() ?? 'guilinol-avatar-style-v2'
  if (!baseKey.endsWith('-attr')) {
    material.customProgramCacheKey = () => `${baseKey}-attr`
  }
  material.needsUpdate = true
}

export interface AvatarContactShadowUpdate {
  visible: boolean
  x: number
  z: number
  groundY: number
  footY: number
  crouching: boolean
  /** Character heading yaw (radians) for subtle stance alignment */
  yaw: number
}

export interface AvatarContactShadow {
  readonly mesh: THREE.Mesh
  update(params: AvatarContactShadowUpdate): void
  getState(): {visible: boolean; opacity: number; scaleX: number; scaleZ: number; y: number}
  dispose(): void
}

let cachedShadowTex: THREE.CanvasTexture | null = null

function getContactShadowTexture(): THREE.CanvasTexture | null {
  if (cachedShadowTex) return cachedShadowTex
  if (typeof document === 'undefined') return null
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const cx = size * 0.5
  const cy = size * 0.5
  const grad = ctx.createRadialGradient(cx, cy, size * 0.06, cx, cy, size * 0.48)
  grad.addColorStop(0.0, 'rgba(10, 14, 20, 0.88)')
  grad.addColorStop(0.42, 'rgba(12, 16, 22, 0.52)')
  grad.addColorStop(0.75, 'rgba(14, 18, 24, 0.16)')
  grad.addColorStop(1.0, 'rgba(14, 18, 24, 0.0)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)
  const tex = new THREE.CanvasTexture(canvas)
  tex.needsUpdate = true
  cachedShadowTex = tex
  return tex
}

/**
 * Lightweight 1-draw-call grounded soft contact shadow added directly to `scene`
 * (NEVER child of `figure`, keeping vessel-bounds Box3 measurements 100% pure).
 * Responds to sun azimuth/elevation, jump air height, crouching stance, mist/rain diffusion, and night.
 */
export function createAvatarContactShadow(scene: THREE.Scene): AvatarContactShadow {
  const geom = new THREE.PlaneGeometry(1, 1)
  geom.rotateX(-Math.PI / 2)
  const tex = getContactShadowTexture()
  const mat = new THREE.MeshBasicMaterial({
    color: 0x0d1218,
    ...(tex ? {map: tex} : {}),
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    fog: true,
  })
  const mesh = new THREE.Mesh(geom, mat)
  mesh.name = 'avatar-contact-shadow'
  mesh.renderOrder = 3
  mesh.frustumCulled = false
  mesh.visible = false
  scene.add(mesh)

  let lastOpacity = 0
  let lastScaleX = 0.72
  let lastScaleZ = 0.72

  return {
    mesh,
    update(p: AvatarContactShadowUpdate) {
      if (!p.visible || !Number.isFinite(p.groundY)) {
        mesh.visible = false
        lastOpacity = 0
        return
      }
      const airHeight = Math.max(0, p.footY - p.groundY)
      const airFade = Math.max(0, 1 - airHeight / 1.45)
      if (airFade <= 0.02) {
        mesh.visible = false
        lastOpacity = 0
        return
      }

      // Diffuse shadow softly in rain/mist/night; sharper & subtly sun-elongated in direct sun.
      const weatherSoft = Math.max(env.rain * 0.55, env.mix.grey * 0.45)
      const sunLen = Math.hypot(env.sunDir.x, env.sunDir.z)
      const sunLow = Math.max(0, 1 - Math.max(0.15, env.sunDir.y)) * env.sunUp * (1 - weatherSoft)
      const dirX = sunLen > 1e-3 ? -env.sunDir.x / sunLen : 0
      const dirZ = sunLen > 1e-3 ? -env.sunDir.z / sunLen : 0
      const shift = sunLow * 0.22

      const crouchMul = p.crouching ? 1.16 : 1.0
      const airSpread = 1 + airHeight * 0.24
      const baseRadius = 0.74 * crouchMul * airSpread
      const elongate = 1 + sunLow * 0.42

      mesh.position.set(p.x + dirX * shift, p.groundY + 0.024, p.z + dirZ * shift)
      if (sunLow > 0.05 && sunLen > 1e-3) {
        mesh.rotation.y = Math.atan2(dirX, dirZ)
        lastScaleX = baseRadius
        lastScaleZ = baseRadius * elongate
      } else {
        mesh.rotation.y = p.yaw
        lastScaleX = baseRadius
        lastScaleZ = baseRadius * 0.92
      }
      mesh.scale.set(lastScaleX, 1, lastScaleZ)

      // Calibrated opacity: clear daylight 0.44 -> overcast/rain 0.28 -> night ambient occlusion 0.22.
      const dayBase = 0.44 * (1 - weatherSoft * 0.36)
      const baseAlpha = THREE.MathUtils.lerp(dayBase, 0.22, env.night)
      lastOpacity = baseAlpha * airFade * airFade
      mat.opacity = lastOpacity
      mesh.visible = lastOpacity > 0.015
    },
    getState() {
      return {
        visible: mesh.visible,
        opacity: +lastOpacity.toFixed(3),
        scaleX: +lastScaleX.toFixed(3),
        scaleZ: +lastScaleZ.toFixed(3),
        y: +mesh.position.y.toFixed(3),
      }
    },
    dispose() {
      mesh.removeFromParent()
      geom.dispose()
      mat.dispose()
    },
  }
}

export {atmo}
