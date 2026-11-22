import * as T from 'three'
import {shareAtmosphere} from '../look/atmosphere'
import {sharedAvatarUniforms} from '../look/avatar-look'

export type CreatorSurfaceMode = 'body' | 'hair' | 'cloth' | 'face'

/**
 * Guilin Phase 2 3D style-fusion shader for creator characters (male/female bodies, hairstyles,
 * facial features, skirts and starter trim).
 *
 * Replaces flat 2D cel cutouts with real Three.js PBR lighting + per-zone surface response:
 *  - Smooth-shaded skin with warm SSS terminator wrap & albedo decompression (never muddy clay or flat paper)
 *  - Soft woven matte cloth with micro-weave breakup & subtle vertical ground-contact AO
 *  - Sculpted hair top-sheen so dark hair reads with clean form in daylight & streetlamps
 *  - Direct coupling with `atmo` (`uNight`, `uRain`) & Guilin's 22 m streetlamp / storefront neon grid
 *  - Preserves 100% of IDOK-136 `clothing` garment uniforms (sleeves, shorts, sandals, school panels)
 *  - Works cleanly both on Guilin streets (`USE_FOG`) and inside the Character Creator studio (no fog)
 */
export function streetShading(
  material: T.MeshStandardMaterial,
  garment = false,
  surfaceMode: CreatorSurfaceMode = garment ? 'body' : 'cloth',
) {
  const clothing = {
    sleeve: {value: 1.0},
    shortHem: {value: 0},
    sandal: {value: 0},
    schoolTop: {value: 0},
    schoolBlue: {value: new T.Color('#536e90')},
    skinTone: {value: new T.Color()},
  }
  if (garment) material.userData.clothing = clothing

  // Smooth normals on face/body prevent patchy cheek triangles; sculpted low-poly facets on hair match Guilin trees/stone.
  material.flatShading = surfaceMode === 'hair'
  material.roughness = surfaceMode === 'hair' ? 0.58 : surfaceMode === 'face' ? 0.65 : 0.94
  material.metalness = 0.01
  material.customProgramCacheKey = () => `creator-guilin-pbr-v3-${garment ? 'garment' : surfaceMode}`

  material.onBeforeCompile = (shader, renderer) => {
    T.Material.prototype.onBeforeCompile.call(material, shader, renderer)
    shareAtmosphere(shader)
    Object.assign(shader.uniforms, sharedAvatarUniforms)

    if (garment) {
      Object.assign(shader.uniforms, clothing)
      // A zone is a per-face ID. Flat interpolation prevents cloth/skin bleed on seams.
      shader.vertexShader =
        'attribute float clothZone; flat out float zone; varying vec3 rest;\n' +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nzone = clothZone; rest = position;',
        )
    }

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
varying float vAvatarLocalY;
varying vec3 vAvatarWorldN;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vAvatarLocalY = clamp(position.y / 1.72, 0.0, 1.25);`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
vAvatarWorldN = normalize(mat3(modelMatrix) * objectNormal);`,
      )

    const zoneDecl = garment
      ? 'flat in float zone; varying vec3 rest; uniform float sleeve, shortHem, sandal, schoolTop; uniform vec3 skinTone, schoolBlue;\n'
      : ''

    shader.fragmentShader =
      zoneDecl +
      shader.fragmentShader
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
varying float vAvatarLocalY;
varying vec3 vAvatarWorldN;`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
{
  float isSkin = ${surfaceMode === 'face' ? '1.0' : '0.0'};
  float isHair = ${surfaceMode === 'hair' ? '1.0' : '0.0'};
  float isFabric = ${surfaceMode === 'cloth' ? '1.0' : '0.0'};
  float isShoe = 0.0;
${
  garment
    ? `  float x = abs(rest.x);
  bool isSkinRegion = (zone < 0.5);
  if (schoolTop > 0.5 && zone == 1.0 && (x > 0.19 || rest.y > 1.37)) diffuseColor.rgb = schoolBlue;
  bool neck = sleeve < 0.2 && rest.z > -0.015 && rest.y > 1.365 + 0.102 * pow(min(1.0, x / 0.074), 2.0);
  if ((zone == 1.0 && (x > sleeve || neck)) || (zone == 2.0 && rest.y < shortHem)) {
    diffuseColor.rgb = skinTone;
    isSkinRegion = true;
  }
  if (zone == 3.0 && sandal > 0.5 && rest.y > 0.026) {
    float strap = abs(rest.z - 0.10 + abs(x - 0.092) * 0.7);
    if (strap < 0.013) {
      diffuseColor.rgb = vec3(.13, .12, .10);
    } else {
      diffuseColor.rgb = skinTone;
      isSkinRegion = true;
    }
  }
  isSkin = isSkinRegion ? 1.0 : 0.0;
  isShoe = (!isSkinRegion && zone > 2.5) ? 1.0 : 0.0;
  isFabric = (!isSkinRegion && zone >= 0.5 && zone <= 2.5) ? 1.0 : 0.0;`
    : ''
}
  // Gentle albedo decompression in street fog pass so Phase 2 uGrade (sat 1.22, contrast 1.12) stays natural.
  #ifdef USE_FOG
  float luma = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  diffuseColor.rgb = mix(vec3(luma), diffuseColor.rgb, mix(0.93, 0.90, isSkin));
  float weave = sin(vFogWorld.x * 48.0 + vFogWorld.y * 24.0) * cos(vFogWorld.z * 48.0 - vFogWorld.y * 18.0);
  diffuseColor.rgb *= 1.0 + weave * 0.020 * isFabric;
  #endif

  // Subtle vertical contact-AO grounding (adds 3D weight near feet/hem, keeps face/chest bright).
  float verticalAo = mix(0.87, 1.01, smoothstep(0.0, 0.42, vAvatarLocalY));
  diffuseColor.rgb *= mix(verticalAo, 1.0, max(isSkin, isHair));

  // Rain wetness darkens fabric & hair in sync with wet Guilin streets.
  #ifdef USE_FOG
  diffuseColor.rgb *= mix(1.0, mix(0.83, 0.93, isSkin), uRain);
  #endif
}`,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
{
  float isSkin = ${surfaceMode === 'face' ? '1.0' : '0.0'};
  float isHair = ${surfaceMode === 'hair' ? '1.0' : '0.0'};
  float isShoe = 0.0;
${
  garment
    ? `  float xR = abs(rest.x);
  bool neckR = sleeve < 0.2 && rest.z > -0.015 && rest.y > 1.365 + 0.102 * pow(min(1.0, xR / 0.074), 2.0);
  bool skinR = (zone < 0.5) || (zone == 1.0 && (xR > sleeve || neckR)) || (zone == 2.0 && rest.y < shortHem);
  isSkin = skinR ? 1.0 : 0.0;
  isShoe = (!skinR && zone > 2.5) ? 1.0 : 0.0;`
    : ''
}
  float baseRough = mix(0.95, 0.76, isSkin);
  baseRough = mix(baseRough, 0.58, isHair);
  baseRough = mix(baseRough, 0.62, isShoe);
  vec3 wn = normalize(vAvatarWorldN);
  float topCatch = smoothstep(0.15, 0.85, wn.y);
  #ifdef USE_FOG
  roughnessFactor = clamp(mix(baseRough, mix(0.46, 0.30, isShoe + isHair * 0.5), uRain * (0.45 + 0.55 * topCatch)), 0.26, 0.96);
  #else
  roughnessFactor = baseRough;
  #endif
}`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
{
  vec3 wn = normalize(vAvatarWorldN);
  float isSkin = ${surfaceMode === 'face' ? '1.0' : '0.0'};
  float isHair = ${surfaceMode === 'hair' ? '1.0' : '0.0'};
${
  garment
    ? `  float xE = abs(rest.x);
  bool neckE = sleeve < 0.2 && rest.z > -0.015 && rest.y > 1.365 + 0.102 * pow(min(1.0, xE / 0.074), 2.0);
  bool skinE = (zone < 0.5) || (zone == 1.0 && (xE > sleeve || neckE)) || (zone == 2.0 && rest.y < shortHem);
  isSkin = skinE ? 1.0 : 0.0;`
    : ''
}
  float ndl = dot(wn, normalize(uAvatarSunDir));
  float sssBand = smoothstep(-0.35, 0.22, ndl) * (1.0 - smoothstep(0.22, 0.68, ndl));

  #ifdef USE_FOG
  // 1) Warm skin SSS terminator wrap (eliminates dead cold-gray shadow side on faces/arms).
  vec3 warmSkinWrap = vec3(0.95, 0.50, 0.36) * diffuseColor.rgb * sssBand * isSkin * (0.14 * uAvatarSunUp + 0.04 * (1.0 - uNight));

  // 2) Subtle sky-horizon / rain Fresnel rim & warm street ground bounce.
  vec3 viewDirW = normalize(cameraPosition - vFogWorld);
  float fresnel = pow(1.0 - max(dot(wn, viewDirW), 0.0), 3.0);
  float upMask = smoothstep(-0.2, 0.65, wn.y);
  vec3 dayRim = mix(uAvatarHorizon, uAvatarSunCol + uAvatarHorizon * 0.5, 0.45) * fresnel * upMask * (0.08 + 0.06 * uRain) * (1.0 - uNight * 0.75);
  vec3 groundBounce = uAvatarGround * diffuseColor.rgb * smoothstep(0.2, -0.75, wn.y) * (0.11 * (1.0 - uNight * 0.5));

  // 3) Night 22 m streetlamp pool & storefront neon coupling (matches look/night.ts nightStreets).
  vec2 lampCell = floor(vFogWorld.xz / 22.0);
  vec2 lampF = vFogWorld.xz / 22.0 - lampCell - 0.5;
  float lampPool = 1.0 - smoothstep(0.06, 0.48, length(lampF));
  float lampHash = fract(sin(dot(lampCell, vec2(12.9898, 78.233))) * 43758.5453);
  vec3 neonTint = uAvatarNeon[int(min(5.0, floor(fract(lampHash * 9.7) * 6.0)))];
  vec3 nightKey = uAvatarLamp * (0.10 + 0.34 * lampPool) * (0.48 + 0.52 * upMask);
  vec3 nightRim = mix(uAvatarLamp, neonTint, 0.38) * fresnel * (0.15 + 0.14 * uRain);
  vec3 nightContrib = (diffuseColor.rgb * nightKey + nightRim * (0.55 + 0.45 * isHair)) * uNight;

  // 4) Soft hair top-sheen so dark hair reads with crisp 3D volume.
  vec3 hairSheen = mix(uAvatarSunCol, uAvatarLamp, uNight) * isHair * smoothstep(0.42, 0.92, wn.y) * (0.055 * (1.0 - uNight) + 0.045 * uNight);

  totalEmissiveRadiance += warmSkinWrap + dayRim + groundBounce + nightContrib + hairSheen;
  #else
  // Studio portrait pass: soft warm skin SSS wrap & clean hair top highlight.
  totalEmissiveRadiance += vec3(0.95, 0.52, 0.38) * diffuseColor.rgb * sssBand * isSkin * 0.08;
  totalEmissiveRadiance += vec3(1.0, 0.96, 0.90) * isHair * smoothstep(0.45, 0.92, wn.y) * 0.045;
  #endif
}`,
        )
  }
  material.needsUpdate = true
}

/**
 * Retained for API compatibility. Guilin Phase 2 street aesthetic uses clean zero-outline 3D shading
 * (`docs/style.md`: "低多边形但不卡通，不加描边") so the avatar fuses into buildings, trees, and vehicles.
 */
export function addOutline(_mesh: T.Mesh, _width: number) {
  // Intentionally disabled in Guilin Phase 2 3D style-fusion mode (saves 2 draw calls for contact shadow).
}
