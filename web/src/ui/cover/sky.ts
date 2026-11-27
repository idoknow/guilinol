// 天穹：随时间的渐变 + 太阳与日晕 + 两层被夕照镶边的云 + 程序星空（被云遮挡）。一个 draw call。
import * as T from 'three'
import {GLSL_OUT, HEAD, REFLECT, shader, type Ctx} from './shared'

export function createSky(ctx: Ctx, noise: T.Texture) {
  const geo = ctx.track(new T.SphereGeometry(24000, 48, 24))
  const mat = shader(
    ctx,
    /* glsl */ `varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    HEAD +
      /* glsl */ `uniform sampler2D uNoise; uniform vec3 uCloudLit, uCloudDark; uniform float uTime, uStars, uNight, uStarK;
    varying vec3 vD;
    float layer(vec2 p, float cover){
      float n = texture2D(uNoise, p).r * .55 + texture2D(uNoise, p * 2.3 + .17).g * .3 + texture2D(uNoise, p * 5.1 - .31).b * .15;
      return smoothstep(cover, cover + .22, n);
    }
    void main(){
      vec3 d = normalize(vD);
      vec3 c = skyColor(d);
      // 太阳：盘面 + 贴地被大气压扁变红（盘面亮度远超 1，经 ACES 成白里透金）
      float s = dot(d, uSunDir), r = .0165;
      float aa = fwidth(s) * 1.5;
      float disc = smoothstep(cos(r) - aa, cos(r) + aa * .5, s);
      c += uSunCol * disc * mix(4., 14., smoothstep(-.01, .05, uSunDir.y));
      // 云：投影到 2.4 km 高的云底平面；高层卷云 + 低层碎积云，靠近太阳的边缘透光发亮
      float h = d.y;
      if (h > .004) {
        vec2 p = d.xz / (h + .06);
        vec2 w = vec2(uTime * .0016, uTime * .0006);
        float hi = layer(p * vec2(.09, .3) + w, .6) * .55;
        float lo = layer(p * .22 + w * 1.7 + vec2(.4, .1), .58);
        float fade = smoothstep(.004, .09, h) * (1. - smoothstep(.45, .9, h) * .6);
        float sun = pow(max(s, 0.), 5.), near = pow(max(s, 0.), 40.);
        vec3 lit = mix(uCloudDark, uCloudLit, .25 + .75 * sun);
        // 薄边（密度低）更透光：银边
        vec3 hiC = lit * (1.1 + near * 2.);
        float edge = lo * (1. - lo) * 4.;
        vec3 loC = mix(uCloudDark * .85, lit * 1.25, sun * .8 + edge * .35 * (.3 + sun)) + uGlow * near * edge * 1.5;
        // 入夜：云底被城市灯光从下面照成暖褐色
        loC += vec3(.16, .085, .04) * uNight * (1. - smoothstep(.02, .3, h)) * .35;
        c = mix(c, hiC, hi * fade * .7);
        c = mix(c, loC, lo * fade * .9);
        // 星空：方向网格里每格一颗，亮度随机、轻微闪烁；被云遮
        vec3 g = d * 260.; vec3 cell = floor(g);
        float hs = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
        if (hs > .84) {
          vec3 at = cell + .5 + (vec3(fract(hs * 13.1), fract(hs * 71.7), fract(hs * 37.3)) - .5) * .7;
          float px = length(fwidth(g)) + 1e-4;
          float dd = length(g - at) / px;
          float tw = .75 + .25 * sin(uTime * (1.5 + hs * 3.) + hs * 40.);
          float mag = pow((hs - .84) / .16, 3.);
          c += vec3(.85, .9, 1.) * exp(-dd * dd * 1.4) * mag * tw * uStars * uStarK * 1.6 * (1. - lo) * (1. - hi) * smoothstep(.03, .25, h);
        }
      }
      gl_FragColor = vec4(c, 1.);
      ${GLSL_OUT}
    }`,
    {uNoise: {value: noise}, uStarK: {value: 1}},
    {side: T.BackSide, depthWrite: false},
  )
  const mesh = new T.Mesh(geo, mat)
  // 倒影里星星被水波打碎成白斑：反射 pass 压暗
  mesh.onBeforeRender = (_r, _s, cam) => {
    mat.uniforms.uStarK.value = cam.layers.isEnabled(0) ? 1 : 0.06
  }
  mesh.frustumCulled = false
  mesh.renderOrder = -2
  mesh.layers.enable(REFLECT)
  return mesh
}
