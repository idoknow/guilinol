// 漓江水面：镜像相机反射 RT（斜裁剪面）+ 滚动法线 + Fresnel + 落日碎金带 + 夜里双塔/象鼻山灯光倒影光柱。
import * as T from 'three'
import {PALETTE, SUN} from './config'
import {GLSL_OUT, HEAD, REFLECT, disp, shader, type Ctx} from './shared'
import type {ViewData} from './view'

export const WATER_LIGHTS = 3

export function createWater(ctx: Ctx, view: ViewData, normalTex: T.Texture, noiseTex: T.Texture, halfFloat: boolean) {
  const rt = ctx.track(
    new T.WebGLRenderTarget(16, 16, {type: halfFloat ? T.HalfFloatType : T.UnsignedByteType, depthBuffer: true}),
  )
  rt.texture.generateMipmaps = false
  const texMat = new T.Matrix4()
  const lightPos = Array.from({length: WATER_LIGHTS}, () => new T.Vector4(0, -100, 0, 0.002))
  const lightCol = Array.from({length: WATER_LIGHTS}, () => new T.Color(0, 0, 0))
  const mat = shader(
    ctx,
    /* glsl */ `uniform mat4 uTexMat; varying vec3 vW; varying vec4 vR;
    void main(){ vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; vR = uTexMat * w; gl_Position = projectionMatrix * viewMatrix * w; }`,
    HEAD +
      /* glsl */ `uniform sampler2D uRefl, uNrm; uniform vec4 uLP[${WATER_LIGHTS}]; uniform vec3 uLC[${WATER_LIGHTS}];
    uniform vec3 uWater; uniform float uNight; uniform vec2 uGlit;
    varying vec3 vW; varying vec4 vR;
    void main(){
      vec3 toC = cameraPosition - vW; float dist = length(toC); vec3 V = toC / dist; vec3 D = -V;
      vec2 p = vW.xz; float t = uTime;
      vec2 s1 = texture2D(uNrm, p * .011 + t * vec2(.003, .007)).xy * 2. - 1.;
      vec2 s2 = texture2D(uNrm, p * .037 + t * vec2(-.008, .003)).xy * 2. - 1.;
      vec2 s3 = texture2D(uNrm, p * .11 + t * vec2(.009, -.013)).xy * 2. - 1.;
      float nearF = 1. / (1. + dist * .0016);
      vec2 sl = (s1 + s2 * .7 + s3 * .45 * nearF) * mix(.004, .012, nearF);
      vec3 N = normalize(vec3(-sl.x, 1., -sl.y));
      vec2 ruv = vR.xy / vR.w + sl * vec2(.25, .5);
      vec3 refl = texture2D(uRefl, clamp(ruv, .002, .998)).rgb;
      float F = .02 + .98 * pow(1. - max(dot(N, V), 0.), 5.);
      vec3 c = mix(uWater * (uAmbUp * .6 + uAmbDn), refl, mix(.35, 1., F));
      // 落日碎金：方位窄、纵向长的高光柱，由强扰动法线打碎成闪点
      vec2 ng = (s2 + s3) * mix(.05, .12, nearF);
      vec3 Rg = reflect(D, normalize(vec3(-ng.x, 1., -ng.y)));
      vec2 dh = normalize(D.xz);
      vec3 sd = uSunDir; sd.y = max(sd.y, -.02);
      float az = 1. - dot(dh, normalize(sd.xz));
      // uGlit：碎金强度、方位宽度倍数（config SUN.glitter）
      float col = exp(-az / (mix(.0006, .004, nearF) * uGlit.y));
      float vy = (D.y + sd.y) * 6.;
      float vprof = .25 + .75 * exp(-vy * vy);
      float sp = pow(max(dot(Rg, sd), 0.), 140.);
      float flick = smoothstep(.55, .9, texture2D(uNoise, p * .05 + vec2(t * .04, -t * .025)).a);
      float sunUp = smoothstep(-.05, .02, uSunDir.y);
      c += uSunCol * col * vprof * (.05 + 3. * sp + 3. * flick * sp) * sunUp * uGlit.x;
      // 灯光倒影光柱（金塔 / 银塔 / 象鼻山泛光）
      for (int i = 0; i < ${WATER_LIGHTS}; i++) {
        vec3 Lp = uLP[i].xyz;
        vec3 dm = normalize(vec3(Lp.x, -Lp.y, Lp.z) - cameraPosition);
        float a = 1. - dot(dh, normalize(dm.xz));
        float ev = D.y - dm.y;
        float vp = ev > 0. ? exp(-ev * ev * 6000.) : exp(-ev * ev * 60.);
        float spk = pow(max(dot(Rg, normalize(Lp - vW)), 0.), 60.);
        c += uLC[i] * exp(-a / uLP[i].w) * vp * (.25 + 2. * spk) * uNight;
      }
      gl_FragColor = vec4(applyAir(c, vW, D, dist), 1.);
      ${GLSL_OUT}
    }`,
    {
      uRefl: {value: rt.texture},
      uNrm: {value: normalTex},
      uNoise: {value: noiseTex},
      uTexMat: {value: texMat},
      uLP: {value: lightPos},
      uLC: {value: lightCol},
      uWater: {value: disp(PALETTE.water, 1)},
      uGlit: {value: new T.Vector2(SUN.glitter.k, SUN.glitter.width)},
    },
  )
  // 只铺在水面掩码范围内（掩码外是地面，水面平面在地面之下也看不到）
  const W = view.water
  const geo = ctx.track(new T.PlaneGeometry(W.w * W.step, W.h * W.step).rotateX(-Math.PI / 2))
  geo.translate(W.x0 + (W.w * W.step) / 2, 0, W.z0 + (W.h * W.step) / 2)
  const mesh = new T.Mesh(geo, mat)
  mesh.frustumCulled = false

  // ---------- 镜像相机（Reflector 原理，平面固定为 y=0） ----------
  const vcam = new T.PerspectiveCamera()
  vcam.layers.set(REFLECT)
  const plane = new T.Plane(), clip = new T.Vector4(), q = new T.Vector4()
  const cp = new T.Vector3(), look = new T.Vector3(), rot = new T.Matrix4(), up = new T.Vector3()
  const n = new T.Vector3(0, 1, 0), o = new T.Vector3()

  function render(renderer: T.WebGLRenderer, scene: T.Scene, camera: T.PerspectiveCamera) {
    cp.setFromMatrixPosition(camera.matrixWorld)
    if (cp.y <= 0.05) return
    rot.extractRotation(camera.matrixWorld)
    look.set(0, 0, -1).applyMatrix4(rot).add(cp)
    vcam.position.set(cp.x, -cp.y, cp.z)
    up.set(0, 1, 0).applyMatrix4(rot).reflect(n)
    vcam.up.copy(up)
    vcam.lookAt(look.x, -look.y, look.z)
    vcam.far = camera.far
    vcam.updateMatrixWorld()
    vcam.projectionMatrix.copy(camera.projectionMatrix)
    // 镜像后 right 轴反向：主相机为菜单让位用了水平 setViewOffset（非对称视锥），这里把水平偏移取反
    vcam.projectionMatrix.elements[8] *= -1
    texMat.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
    texMat.multiply(vcam.projectionMatrix).multiply(vcam.matrixWorldInverse)
    // 斜裁剪：近裁面换成水面，水下部分不进反射
    plane.setFromNormalAndCoplanarPoint(n, o).applyMatrix4(vcam.matrixWorldInverse)
    clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant)
    const e = vcam.projectionMatrix.elements
    q.x = (Math.sign(clip.x) + e[8]) / e[0]
    q.y = (Math.sign(clip.y) + e[9]) / e[5]
    q.z = -1
    q.w = (1 + e[10]) / e[14]
    clip.multiplyScalar(2 / clip.dot(q))
    e[2] = clip.x
    e[6] = clip.y
    e[10] = clip.z + 1 - 0.003
    e[14] = clip.w
    vcam.projectionMatrixInverse.copy(vcam.projectionMatrix).invert()
    const prev = renderer.getRenderTarget()
    renderer.setRenderTarget(rt)
    renderer.render(scene, vcam)
    renderer.setRenderTarget(prev)
  }

  return {
    mesh,
    rt,
    vcam,
    render,
    setSize(w: number, h: number) {
      rt.setSize(Math.max(16, Math.round(w)), Math.max(16, Math.round(h)))
    },
    setLight(i: number, p: T.Vector3, c: T.Color, width = 0.002) {
      lightPos[i].set(p.x, p.y, p.z, width)
      lightCol[i].copy(c)
    },
  }
}
