// 收尾：一张全屏三角形，直接混合到帧缓冲（不额外开 RT）：暗角 × dst + 细颗粒 + 边缘冷暖偏色（伪色差）+ 落日眩光，几乎零成本。
import * as T from 'three'
import {SUN} from './config'
import {shader, type Ctx} from './shared'

export function createPost(ctx: Ctx) {
  const g = ctx.track(new T.BufferGeometry())
  g.setAttribute('position', new T.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3))
  const mat = shader(
    ctx,
    /* glsl */ `varying vec2 vUv; void main(){ vUv = position.xy * .5 + .5; gl_Position = vec4(position.xy, 0., 1.); }`,
    /* glsl */ `uniform float uTime, uGrain, uAspect; uniform vec3 uSun, uFlare; varying vec2 vUv;
    float h(vec2 p){ vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
    void main(){
      vec2 q = (vUv - .5) * vec2(uAspect, 1.);
      float r = length(q * vec2(.82, 1.));
      float vig = mix(1., smoothstep(1.15, .35, r), .55);
      float n = h(gl_FragCoord.xy + fract(uTime * 7.3) * 517.) * uGrain;
      // 色差：边缘左偏青、右偏暖，用很轻的加色模拟
      float e = smoothstep(.45, 1.1, r);
      vec3 ca = (q.x > 0. ? vec3(.010, .004, 0.) : vec3(0., .004, .010)) * e;
      // 落日眩光：柔光晕 + 一道横向拉丝（变形宽银幕镜头味），太阳越接近画面中心越强
      vec2 sd = (vUv - uSun.xy) * vec2(uAspect, 1.);
      float sr = length(sd);
      // uFlare：大柔晕、紧光晕、横向拉丝倍数（config SUN.flare）
      vec3 flare = vec3(1., .72, .42) * (exp(-sr * 5.5) * .16 * uFlare.x + exp(-sr * 22.) * .22 * uFlare.y)
        + vec3(1., .62, .36) * exp(-abs(sd.y) * 160.) * exp(-abs(sd.x) * 2.4) * .07 * uFlare.z;
      flare *= uSun.z * (1. - smoothstep(.3, 1.2, length(uSun.xy - .5)));
      gl_FragColor = vec4(vec3(n) + ca + flare, vig);
    }`,
    {
      uGrain: {value: ctx.spec.grain ? 0.022 : 0},
      uAspect: {value: 1},
      uSun: {value: new T.Vector3()},
      uFlare: {value: new T.Vector3(SUN.flare.veil, SUN.flare.core, SUN.flare.streak)},
    },
    {
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      blending: T.CustomBlending,
      blendSrc: T.OneFactor,
      blendDst: T.SrcAlphaFactor,
    },
  )
  const mesh = new T.Mesh(g, mat)
  mesh.frustumCulled = false
  mesh.renderOrder = 999
  return {mesh, aspect: mat.uniforms.uAspect, sun: mat.uniforms.uSun as T.IUniform<T.Vector3>}
}
