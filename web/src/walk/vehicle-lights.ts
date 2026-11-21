import * as T from 'three'
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js'
import type {TwoWheelHeadlightMode} from './ebike-state-coupling'

/**
 * Zero-recompile, low-draw-call volumetric headlight beam & ground light pool for active vehicles.
 *
 * Performance design for Guilin's 2-light PBR + water-mirror pipeline:
 *  - Uses ZERO Three.js SpotLight / PointLight objects (eliminates 200-800ms global shader
 *    recompilation hitches and avoids doubling fragment lighting cost across city chunks & water mirror).
 *  - Reuses module-cached low-poly open frustum (24 tris single / 48 tris twin-car merged) + 1 ground
 *    projection quad (2 tris), rendered with custom Fresnel edge-faded additive ShaderMaterials.
 *  - Strictly `FrontSide` (no `DoubleSide` overdraw), `depthWrite: false`, zero per-frame allocations.
 *  - When off (or parked unattended), both meshes stay `visible = false` => 0 GPU draw calls.
 *  - Active maximum budget: 2 draw calls total for either e-bike or twin-headlamp sedan.
 */

export type VehicleLightKind = 'bike' | 'car'

export interface HeadlightBeamUpdate {
  mode: TwoWheelHeadlightMode
  night: number
  wheelie?: number
  crashed?: boolean
  batteryDepleted?: boolean
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
  update: (state: HeadlightBeamUpdate) => void
  probe: () => HeadlightBeamProbe
  dispose: () => void
}

let cachedBikeCone: T.BufferGeometry | null = null
let cachedCarTwinCone: T.BufferGeometry | null = null
let cachedPoolPlane: T.BufferGeometry | null = null

function buildUnitBeamCone(): T.BufferGeometry {
  // Narrow end (r=0.06, uv.y=1) at local origin (0,0,0), wide end (r=1.0, uv.y=0) at (0,0,-1).
  const g = new T.CylinderGeometry(.06, 1.0, 1.0, 12, 1, true)
  g.translate(0, -.5, 0)
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
    left.translate(-.62, 0, 0)
    const right = buildUnitBeamCone()
    right.translate(.62, 0, 0)
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
    g.translate(0, 0, -.5)
    cachedPoolPlane = g
  }
  return cachedPoolPlane
}

const CONE_VERT = /* glsl */ `
varying vec2 vUv;
varying float vFacing;
void main() {
  vUv = uv;
  vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
  vec3 viewNormal = normalize(normalMatrix * normal);
  vec3 viewDir = normalize(-mvPos.xyz);
  vFacing = abs(dot(viewNormal, viewDir));
  gl_Position = projectionMatrix * mvPos;
}
`

const CONE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uIntensity;
varying vec2 vUv;
varying float vFacing;
void main() {
  float dist = 1.0 - vUv.y;
  float nearSoft = smoothstep(0.0, 0.16, dist);
  float axial = pow(max(0.0, 1.0 - dist), 1.45);
  float edge = pow(clamp(vFacing, 0.0, 1.0), 1.35);
  float alpha = nearSoft * axial * edge * uIntensity;
  if (alpha < 0.002) discard;
  gl_FragColor = vec4(uColor * alpha, min(0.65, alpha));
}
`

const POOL_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const POOL_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uIntensity;
varying vec2 vUv;
void main() {
  // vUv.y = 0 ahead of front tire, vUv.y = 1 at far tip; vUv.x = 0.5 centerline.
  float z = clamp(vUv.y, 0.0, 1.0);
  float halfSpread = mix(0.14, 0.50, pow(z, 0.58));
  float xNorm = abs(vUv.x - 0.5) / max(0.01, halfSpread);
  float radial = 1.0 - smoothstep(0.22, 1.0, xNorm);
  float core = 1.0 - smoothstep(0.0, 0.56, xNorm);
  float enterSoft = smoothstep(0.0, 0.14, z);
  float midBody = 1.0 - smoothstep(0.42, 1.0, z) * 0.62;
  float farFade = pow(max(0.0, 1.0 - z), 1.05);
  float lum = enterSoft * midBody * farFade * (radial * 0.64 + core * 0.44) * uIntensity;
  if (lum < 0.002) discard;
  // Softly compress highlights so asphalt texture stays legible rather than clipping to solid white.
  float mapped = lum / (1.0 + lum * 0.52);
  gl_FragColor = vec4(uColor * mapped, min(0.78, mapped));
}
`

function smoothstep01(t: number): number {
  const c = T.MathUtils.clamp(t, 0, 1)
  return c * c * (3 - 2 * c)
}

export function createHeadlightBeamRig(kind: VehicleLightKind): HeadlightBeamRig {
  const isCar = kind === 'car'
  const group = new T.Group()
  group.name = `${kind}-headlight-beams`

  const coneUniforms = {
    uColor: {value: new T.Color(isCar ? 0xfff6e2 : 0xfff2d2)},
    uIntensity: {value: 0},
  }
  const poolUniforms = {
    uColor: {value: new T.Color(isCar ? 0xfff4dc : 0xffefd0)},
    uIntensity: {value: 0},
  }

  const coneMat = new T.ShaderMaterial({
    vertexShader: CONE_VERT,
    fragmentShader: CONE_FRAG,
    uniforms: coneUniforms,
    transparent: true,
    depthWrite: false,
    blending: T.AdditiveBlending,
    side: T.FrontSide,
    fog: false,
  })
  const poolMat = new T.ShaderMaterial({
    vertexShader: POOL_VERT,
    fragmentShader: POOL_FRAG,
    uniforms: poolUniforms,
    transparent: true,
    depthWrite: false,
    blending: T.AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
    fog: false,
  })

  const coneMesh = new T.Mesh(isCar ? getCarTwinConeGeometry() : getBikeConeGeometry(), coneMat)
  coneMesh.name = `${kind}-beam-cone`
  coneMesh.visible = false
  coneMesh.frustumCulled = false
  coneMesh.renderOrder = 5
  coneMesh.position.set(0, 0, -.12)

  const poolMesh = new T.Mesh(getPoolGeometry(), poolMat)
  poolMesh.name = `${kind}-beam-pool`
  poolMesh.visible = false
  poolMesh.frustumCulled = false
  poolMesh.renderOrder = 4
  // Project light pool ahead of front tire and clear of subtle pavement crown/slopes.
  poolMesh.position.set(0, isCar ? -.36 : -.42, isCar ? -.45 : -.55)
  poolMesh.rotation.x = .024

  group.add(coneMesh, poolMesh)

  let lastMode: TwoWheelHeadlightMode = 'off'
  let lastIntensity = 0
  let lastConeVisible = false
  let lastPoolVisible = false

  return {
    group,
    coneMesh,
    poolMesh,
    update(state: HeadlightBeamUpdate) {
      lastMode = state.mode
      if (state.mode === 'off') {
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
      const batScale = state.batteryDepleted ? .42 : 1
      const crashScale = state.crashed ? .28 : 1

      // Subtle in daylight, atmospheric forward shaft & clear low-vs-high road pool at night.
      const baseStrength = high
        ? T.MathUtils.lerp(.12, .56, nightMix)
        : T.MathUtils.lerp(.07, .34, nightMix)
      const coneAlpha = baseStrength * batScale * crashScale

      const reach = (isCar ? (high ? 30 : 17) : (high ? 24 : 13.5)) * (state.crashed ? .32 : 1)
      const spread = isCar ? (high ? 2.4 : 1.65) : (high ? 2.25 : 1.50)
      coneMesh.scale.set(spread, spread * .52, reach)
      coneMesh.rotation.x = high ? -.002 : -.034
      coneUniforms.uColor.value.setHex(high ? 0xedf6ff : 0xffebc0)
      coneUniforms.uIntensity.value = coneAlpha
      coneMesh.visible = coneAlpha > .005
      lastConeVisible = coneMesh.visible

      // Fade ground pool smoothly during high wheelies or crashes so decal never hovers or clips weirdly.
      const wheelieFade = 1 - smoothstep01(((state.wheelie ?? 0) - .10) / .24)
      const poolStrength = state.crashed
        ? 0
        : (high ? T.MathUtils.lerp(.10, 1.15, nightMix) : T.MathUtils.lerp(.06, .78, nightMix)) * batScale * wheelieFade
      const poolWidth = isCar ? (high ? 10.6 : 7.4) : (high ? 7.6 : 5.2)
      const poolLength = isCar ? (high ? 34 : 19) : (high ? 25 : 14.5)
      poolMesh.scale.set(poolWidth, 1, poolLength)
      poolMesh.rotation.x = high ? .042 : .024
      poolUniforms.uColor.value.setHex(high ? 0xeef7ff : 0xffe8b2)
      poolUniforms.uIntensity.value = poolStrength
      poolMesh.visible = poolStrength > .005
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
