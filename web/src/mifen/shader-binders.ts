import * as THREE from 'three'
import {shareAtmosphere} from '../look/atmosphere'

export function bindAtmo<T extends THREE.Material>(mat: T): T {
  mat.onBeforeCompile = shader => shareAtmosphere(shader)
  return mat
}

/** 顶点色合批材质的夜间补光按 vColor 调制，避免深色发丝/黑金属/食材在夜间被统一 emissive 洗成灰白 */
export function bindVcEmissive<T extends THREE.Material>(mat: T): T {
  mat.onBeforeCompile = shader => {
    shareAtmosphere(shader)
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n#ifdef USE_COLOR\ntotalEmissiveRadiance *= vColor.rgb;\n#endif',
    )
  }
  mat.customProgramCacheKey = () => 'guilinol-mifen-vc-emissive'
  return mat
}

/** 合批主材质的店内夜间程度（updateNight 写入），所有 surface master 共享 */
export const SHOP_SURF_NIGHT: THREE.IUniform<number> = {value: 0}

/** surface master 的附加贴图层：key 由被合批材质的 userData.surfTex 引用，repeat = 1 / 图案周期（米） */
export interface SurfLayer {
  key: string
  tex: THREE.Texture
  periodM: readonly [number, number]
}

/**
 * IDOK-305：合批主材质按顶点选贴图层 + 按顶点自发光。
 *
 * 合批（IDOK-294）把杉木条、花岗岩、人行道砖、吊顶和灯盘都并进了几张顶点色主材质，
 * 原来各自的贴图和"店里日光灯常亮"的自发光一起丢了。这里不加 draw call：
 * - aSurf.x 选层：0 = 主材质自己的 map，1/2 = layers 里的贴图（几何 UV 以米为单位），3 = 纯色；
 * - aSurf.y / aSurf.z = 白天底光 / 夜间增量，自发光 = emissive × 本色（贴图 × 顶点色）×（y + 夜间 × z），
 *   与合批前 litSurfaces 表 + emissiveMap = map 的观感一致。
 * 主材质自身的 emissiveMap / emissiveIntensity 不再使用（固定为 null / 1）。
 */
export function bindSurfaceMaster(mat: THREE.MeshStandardMaterial, layers: SurfLayer[], glow: [number, number]): THREE.MeshStandardMaterial {
  mat.userData.surfLayers = Object.fromEntries(layers.map((l, i) => [l.key, i + 1]))
  mat.userData.glow = glow
  mat.emissiveMap = null
  mat.emissiveIntensity = 1
  const l1 = layers[0] ?? null
  const l2 = layers[1] ?? l1
  const fallback = mat.map
  mat.onBeforeCompile = shader => {
    shareAtmosphere(shader)
    shader.uniforms.uShopNight = SHOP_SURF_NIGHT
    shader.uniforms.uSurfL1 = {value: l1?.tex ?? fallback}
    shader.uniforms.uSurfL2 = {value: l2?.tex ?? fallback}
    shader.uniforms.uSurfR1 = {value: new THREE.Vector2(1 / (l1?.periodM[0] ?? 1), 1 / (l1?.periodM[1] ?? 1))}
    shader.uniforms.uSurfR2 = {value: new THREE.Vector2(1 / (l2?.periodM[0] ?? 1), 1 / (l2?.periodM[1] ?? 1))}
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aSurf;\nvarying vec3 vSurf;\nvarying vec2 vSurfUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvSurf = aSurf;\nvSurfUv = uv;')
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uShopNight;\nuniform sampler2D uSurfL1;\nuniform sampler2D uSurfL2;\nuniform vec2 uSurfR1;\nuniform vec2 uSurfR2;\nvarying vec3 vSurf;\nvarying vec2 vSurfUv;',
      )
      .replace(
        '#include <map_fragment>',
        [
          '#ifdef USE_MAP',
          'vec4 surfT0 = texture2D( map, vMapUv );',
          '#else',
          'vec4 surfT0 = vec4( 1.0 );',
          '#endif',
          // 三层都先采样再选，避免按三角形分支时导数失效（层边缘的 mip 跳变）
          'vec4 surfT1 = texture2D( uSurfL1, vSurfUv * uSurfR1 );',
          'vec4 surfT2 = texture2D( uSurfL2, vSurfUv * uSurfR2 );',
          'vec4 surfTex = vSurf.x < 0.5 ? surfT0 : vSurf.x < 1.5 ? surfT1 : vSurf.x < 2.5 ? surfT2 : vec4( 1.0 );',
          'diffuseColor *= surfTex;',
        ].join('\n'),
      )
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance = emissive * diffuseColor.rgb * ( vSurf.y + uShopNight * vSurf.z );',
      )
  }
  mat.customProgramCacheKey = () => 'guilinol-mifen-surface-master'
  return mat
}
