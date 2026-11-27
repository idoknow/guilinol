import * as T from 'three'

/**
 * 「夜渡口 · 青石台」舞台环境：天球、淡月、三层喀斯特峰林、雾带、青石台、浅水面、灯火微尘、河灯。
 * 全部是自定义 shader（不吃场景灯、不用 scene.fog——人物的 toon 材质会被 fog 影响），
 * 颜色在线性空间计算，最后 linearToOutputTexel 输出。
 */

const C = (hex: string, scale = 1) => new T.Color(hex).multiplyScalar(scale)

const palette = {
  top: C('#0b1622'),
  horizon: C('#1f3d41'),
  warm: C('#c07a4c', 0.55),
  moon: C('#e6eef0'),
  deep: C('#03090b'),
  mountain: C('#0c1b1f'),
  jade: C('#8fc1b5'),
  ember: C('#ffb469'),
  lamp: C('#ffc27a'),
  far: C('#ffcf8f'),
  key: C('#ffe2bd', 1.25),
  rim: C('#9ec9e6'),
  amb: C('#24383e', 0.9),
}

// The body shot looks ~23° toward +x; the moon hangs up-left of the character in that frame and the
// afterglow sits low right behind them. Keep STUDIO_LIGHT.rimFrom (creator-stage.ts) on the moon side.
export const MOON_DIR = new T.Vector3(0.21, 0.13, 1).normalize()
const WARM_DIR = new T.Vector3(0.45, 0, 1).normalize()
const KEY_DIR = new T.Vector3(-0.55, 0.85, -0.7).normalize()

const NOISE = /* glsl */ `
float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float vnoise(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1.,0.)),u.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),u.x),u.y);}
float fbm(vec2 p){float s=0.,a=.5;for(int i=0;i<4;i++){s+=a*vnoise(p);p=p*2.03+vec2(1.7,9.2);a*=.5;}return s;}
`

const SKY = /* glsl */ `
uniform vec3 uTop,uHorizon,uWarm,uMoonCol,uMoonDir,uWarmDir;
vec3 sky(vec3 d){
  float h=d.y;
  vec3 c=mix(uHorizon,uTop,pow(smoothstep(-.04,.62,h),.75));
  vec2 flat2=normalize(d.xz+1e-5);
  float w=max(dot(flat2,uWarmDir.xz),0.);
  c+=uWarm*pow(w,5.)*exp(-abs(h)*11.);
  float m=max(dot(d,uMoonDir),0.);
  c+=uMoonCol*(pow(m,40.)*.09+pow(m,700.)*.28);
  return c;
}
`

function skyUniforms() {
  return {
    uTop: {value: palette.top},
    uHorizon: {value: palette.horizon},
    uWarm: {value: palette.warm},
    uMoonCol: {value: palette.moon},
    uMoonDir: {value: MOON_DIR},
    uWarmDir: {value: WARM_DIR},
  }
}

/** Mulberry32: the same skyline every visit. */
function seeded(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A curtain of karst towers on an arc around the stage (steep sides, rounded crowns). */
function karstRidge(rng: () => number, radius: number, count: number, hMin: number, hMax: number, cols: number) {
  const a0 = -1.75,
    a1 = 1.75
  const peaks = Array.from({length: count}, () => {
    const h = hMin + rng() ** 1.4 * (hMax - hMin)
    return {c: a0 + rng() * (a1 - a0), w: (h * (0.38 + rng() * 0.42)) / radius, h, p: 0.32 + rng() * 0.3}
  })
  const pos: number[] = [],
    top: number[] = [],
    index: number[] = []
  for (let i = 0; i <= cols; i++) {
    const a = a0 + ((a1 - a0) * i) / cols
    let y = hMin * 0.18 * (0.6 + 0.4 * Math.sin(a * 7.3 + radius))
    for (const k of peaks) {
      const d = (a - k.c) / k.w
      if (Math.abs(d) < 1) y = Math.max(y, k.h * (1 - d * d) ** k.p)
    }
    const x = Math.sin(a) * radius,
      z = Math.cos(a) * radius
    pos.push(x, -3, z, x, y, z)
    top.push(y, y)
    if (i < cols) {
      const b = i * 2
      index.push(b, b + 2, b + 1, b + 1, b + 2, b + 3)
    }
  }
  const g = new T.BufferGeometry()
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3))
  g.setAttribute('aTop', new T.Float32BufferAttribute(top, 1))
  g.setIndex(index)
  return g
}

function glowTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!,
    r = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  r.addColorStop(0, 'rgba(255,255,255,1)')
  r.addColorStop(0.25, 'rgba(255,255,255,.45)')
  r.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = r
  g.fillRect(0, 0, 64, 64)
  const t = new T.CanvasTexture(c)
  t.colorSpace = T.SRGBColorSpace
  return t
}

export function creatorEnv(reduced: boolean, coarse: boolean) {
  const group = new T.Group()
  group.name = 'creator-env'
  const geometries: T.BufferGeometry[] = [],
    materials: T.Material[] = [],
    textures: T.Texture[] = []
  const keep = <G extends T.BufferGeometry, M extends T.Material>(g: G, m: M) => {
    geometries.push(g)
    materials.push(m)
    return new T.Mesh(g, m)
  }
  const time = {value: 0},
    glow = {value: 1},
    flash = {value: 0},
    pulseU = {value: -1}

  // --- 天球 + 淡月 + 星 -----------------------------------------------------------------------------
  const sky = keep(
    new T.SphereGeometry(380, 48, 24),
    new T.ShaderMaterial({
      uniforms: {...skyUniforms(), uTime: time},
      vertexShader: /* glsl */ `varying vec3 vDir;
        void main(){vDir=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader:
        NOISE +
        SKY +
        /* glsl */ `uniform float uTime;varying vec3 vDir;
        void main(){
          vec3 d=normalize(vDir);
          vec3 c=sky(d);
          float m=dot(d,uMoonDir);
          float disc=smoothstep(.99962,.99978,m);
          vec3 side=normalize(cross(uMoonDir,vec3(0.,1.,0.)));
          vec2 q=vec2(dot(d,side),d.y-uMoonDir.y)*70.;
          c=mix(c,uMoonCol*(.95-.16*fbm(q*1.7+3.)),disc*.92);
          if(d.y>.04){
            vec2 g=d.xz/(d.y+.35)*110.;
            vec2 cell=floor(g);float r=hash(cell);
            float s=step(.986,r)*smoothstep(.2,.02,length(fract(g)-.5));
            c+=vec3(.55,.65,.8)*s*.32*smoothstep(.04,.45,d.y)*(.65+.35*sin(uTime*1.1+r*90.))*(1.-smoothstep(.97,.995,m));
          }
          gl_FragColor=linearToOutputTexel(vec4(c,1.));
        }`,
      side: T.BackSide,
      depthWrite: false,
      depthTest: false,
    }),
  )
  sky.renderOrder = -10
  sky.frustumCulled = false
  group.add(sky)

  // --- 峰林：三层剪影，远层几乎溶进地平线雾色 ------------------------------------------------------------
  const rng = seeded(386)
  const layers = [
    {r: 230, n: 26, h0: 18, h1: 62, color: '#24454c', density: 0.42, rim: 0.05},
    {r: 125, n: 20, h0: 10, h1: 34, color: '#142c31', density: 0.72, rim: 0.08},
    {r: 58, n: 11, h0: 4, h1: 15, color: '#0a171b', density: 0.94, rim: 0.12},
  ]
  for (const L of layers) {
    const ridge = keep(
      karstRidge(rng, L.r, L.n, L.h0, L.h1, coarse ? 220 : 360),
      new T.ShaderMaterial({
        uniforms: {
          uColor: {value: C(L.color)},
          uFog: {value: palette.horizon},
          uRim: {value: palette.rim.clone().multiplyScalar(L.rim)},
          uDensity: {value: L.density},
          uMist: {value: L.h1 * 0.5},
          uEdge: {value: L.r / 90},
        },
        vertexShader: /* glsl */ `attribute float aTop;varying float vTop;varying vec3 vW;
          void main(){vTop=aTop;vec4 w=modelMatrix*vec4(position,1.);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}`,
        fragmentShader: /* glsl */ `uniform vec3 uColor,uFog,uRim;uniform float uDensity,uMist,uEdge;varying float vTop;varying vec3 vW;
          void main(){
            float mist=smoothstep(-.3,uMist,vW.y);
            vec3 c=mix(uFog,uColor,mist*uDensity);
            float toTop=vTop-vW.y;
            c+=uRim*(1.-smoothstep(0.,.55*uEdge,toTop))*smoothstep(1.,6.,vTop);
            gl_FragColor=linearToOutputTexel(vec4(c,1.));
          }`,
        side: T.DoubleSide,
      }),
    )
    ridge.frustumCulled = false
    group.add(ridge)
  }

  // --- 雾带：层间两道薄雾，让峰脚溶进夜色 -----------------------------------------------------------------
  for (const [r, h, a] of [
    [92, 9, 0.5],
    [42, 3.2, 0.32],
  ] as const) {
    const mist = keep(
      new T.CylinderGeometry(r, r, h, 96, 1, true),
      new T.ShaderMaterial({
        uniforms: {uFog: {value: palette.horizon}, uH: {value: h}, uA: {value: a}, uTime: time},
        vertexShader: /* glsl */ `varying vec3 vW;void main(){vec4 w=modelMatrix*vec4(position,1.);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}`,
        fragmentShader:
          NOISE +
          /* glsl */ `uniform vec3 uFog;uniform float uH,uA,uTime;varying vec3 vW;
          void main(){
            float y=clamp((vW.y+.2)/uH,0.,1.);
            float wisp=.55+.45*fbm(vec2(atan(vW.z,vW.x)*9.+uTime*.012,y*2.5));
            gl_FragColor=linearToOutputTexel(vec4(uFog,uA*(1.-smoothstep(0.,1.,y))*wisp));
          }`,
        side: T.BackSide,
        transparent: true,
        depthWrite: false,
      }),
    )
    mist.position.y = h / 2 - 0.2
    mist.frustumCulled = false
    group.add(mist)
  }

  // --- 河灯 -----------------------------------------------------------------------------------------------
  const glowMap = glowTexture()
  textures.push(glowMap)
  const lampGeo = [
    new T.CylinderGeometry(0.07, 0.085, 0.028, 12),
    new T.ConeGeometry(0.08, 0.085, 8, 1, true),
    new T.SphereGeometry(0.02, 8, 6),
  ]
  geometries.push(...lampGeo)
  const lampMat = [
    new T.MeshBasicMaterial({color: '#2b1f17'}),
    new T.MeshBasicMaterial({color: '#e9a865', side: T.DoubleSide}),
    new T.MeshBasicMaterial({color: '#fff3d6'}),
  ]
  materials.push(...lampMat)
  const lamps = [0, 1].map((i) => {
    const g = new T.Group()
    const base = new T.Mesh(lampGeo[0], lampMat[0]),
      petals = new T.Mesh(lampGeo[1], lampMat[1]),
      flame = new T.Mesh(lampGeo[2], lampMat[2])
    petals.rotation.x = Math.PI
    petals.position.y = 0.05
    flame.position.y = 0.045
    const halo = new T.SpriteMaterial({
      map: glowMap,
      color: palette.lamp,
      blending: T.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    })
    materials.push(halo)
    const sprite = new T.Sprite(halo)
    sprite.scale.setScalar(0.6)
    sprite.position.y = 0.06
    g.add(base, petals, flame, sprite)
    group.add(g)
    // phase 0.37 ≈ x 1.8: the first lantern is already drifting behind the character when the page opens
    return {g, halo, phase: i ? 0.87 : 0.37, z: i ? 3.6 : 2.3}
  })
  const lampU = [new T.Vector4(), new T.Vector4()]

  // --- 水面：程序化涟漪法线 + 天空/月光/河灯/台光的假反射 -------------------------------------------------
  const WATER_Y = -0.13
  const water = keep(
    new T.CircleGeometry(300, 64),
    new T.ShaderMaterial({
      uniforms: {
        ...skyUniforms(),
        uTime: time,
        uPulse: pulseU,
        uGlow: glow,
        uDeep: {value: palette.deep},
        uJade: {value: palette.jade},
        uLampCol: {value: palette.lamp},
        uFog: {value: palette.horizon},
        uMountain: {value: palette.mountain},
        uKeyCol: {value: palette.key},
        uLamps: {value: lampU},
      },
      vertexShader: /* glsl */ `varying vec3 vW;void main(){vec4 w=modelMatrix*vec4(position,1.);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}`,
      fragmentShader:
        SKY +
        /* glsl */ `uniform float uTime,uPulse,uGlow;uniform vec3 uDeep,uJade,uLampCol,uFog,uMountain,uKeyCol;uniform vec4 uLamps[2];varying vec3 vW;
        vec2 slope(vec2 p,float fade){
          float r=max(length(p),1e-3);vec2 dir=p/r;
          vec2 g=dir*.09*exp(-(r-1.1)*.45)*cos(r*9.-uTime*1.25);
          vec2 d2=normalize(vec2(1.,.35));g+=d2*.03*cos(dot(p,d2)*5.+uTime*.8);
          vec2 d3=normalize(vec2(-.4,1.));g+=d3*.045*cos(dot(p,d3)*11.-uTime*1.6);
          vec2 d4=normalize(vec2(.8,-.6));g+=d4*.05*cos(dot(p,d4)*23.+uTime*2.2);
          if(uPulse>0.&&uPulse<1.){
            float rr=1.1+uPulse*2.6,w=.09+uPulse*.12,x=(r-rr)/w;
            g+=dir*(-2.*x/w)*exp(-x*x)*.03*(1.-uPulse);
          }
          return g*fade;
        }
        void main(){
          vec3 toP=vW-cameraPosition;float dist=length(toP);vec3 V=toP/dist;
          vec2 g=slope(vW.xz,exp(-dist*.05));
          vec3 N=normalize(vec3(-g.x,1.,-g.y));
          vec3 R=reflect(V,N);R.y=abs(R.y);
          float fres=.02+.98*pow(1.-clamp(-dot(V,N),0.,1.),5.);
          vec3 refl=mix(uMountain,sky(R),smoothstep(.012,.17,R.y));
          vec3 c=uDeep+refl*fres;
          c+=uMoonCol*pow(max(dot(R,uMoonDir),0.),1600.)*2.6;
          float r=length(vW.xz);
          for(int i=0;i<2;i++){
            vec4 L=uLamps[i];
            if(L.w<.001)continue;
            vec2 d=vW.xz-L.xz;vec2 vd=normalize(L.xz-cameraPosition.xz+1e-4);
            float along=dot(d,vd),across=dot(d,vec2(-vd.y,vd.x));
            float s=exp(-across*across/.01-along*along/(along<0.?.5:.04));
            s*=.7+.3*sin(along*38.+uTime*2.6+across*14.);
            c+=uLampCol*(s*.7+exp(-dot(d,d)/.03)*.35)*L.w;
          }
          c+=uJade*uGlow*.12*exp(-max(r-1.1,0.)*4.5);
          c+=uKeyCol*.05*exp(-dot(vW.xz-vec2(-.6,-1.4),vW.xz-vec2(-.6,-1.4))*.6);
          if(uPulse>0.&&uPulse<1.){
            float rr=1.1+uPulse*2.6,x=(r-rr)/(.045+uPulse*.09);
            c+=uJade*exp(-x*x)*(1.-uPulse)*(1.-uPulse)*.75;
          }
          c=mix(c,uFog,smoothstep(16.,240.,dist));
          gl_FragColor=linearToOutputTexel(vec4(c,1.));
        }`,
    }),
  )
  water.rotation.x = -Math.PI / 2
  water.position.y = WATER_Y
  group.add(water)

  // --- 青石台：两级圆台，程序化石纹 + 接触阴影 + 嵌入的青玉光环 -------------------------------------------
  const stone = new T.ShaderMaterial({
    uniforms: {
      uKeyDir: {value: KEY_DIR},
      uKeyCol: {value: palette.key},
      uMoonDir: {value: MOON_DIR},
      uRimCol: {value: palette.rim},
      uAmb: {value: palette.amb},
      uJade: {value: palette.jade},
      uGlow: glow,
      uFlash: flash,
    },
    vertexShader: /* glsl */ `varying vec3 vW,vN;void main(){vec4 w=modelMatrix*vec4(position,1.);vW=w.xyz;vN=normalize(mat3(modelMatrix)*normal);gl_Position=projectionMatrix*viewMatrix*w;}`,
    fragmentShader:
      NOISE +
      /* glsl */ `uniform vec3 uKeyDir,uKeyCol,uMoonDir,uRimCol,uAmb,uJade;uniform float uGlow,uFlash;varying vec3 vW,vN;
      float sq(float x){return x*x;}
      void main(){
        vec3 N=normalize(vN);vec3 V=normalize(cameraPosition-vW);
        float r=length(vW.xz);bool top=N.y>.5;
        vec2 q=top?vW.xz*3.:vec2(atan(vW.z,vW.x)*3.,vW.y*3.);
        float n=fbm(q*1.6),fine=vnoise(q*22.);
        vec3 albedo=mix(vec3(.026,.036,.04),vec3(.085,.1,.1),n)*(.82+.36*fine);
        float vein=smoothstep(.04,0.,abs(fbm(q*.8+3.1)-.5));
        albedo=mix(albedo,albedo*.5,vein*.75);
        float line=0.,lit=.6;
        if(top){
          albedo*=1.-.4*exp(-sq((r-.6)/.004));
          line=exp(-sq((r-.84)/.0045));
          albedo*=1.-.65*exp(-sq((r-.84)/.014));
          albedo*=1.-.62*exp(-r*r/.045)-.22*exp(-r*r/.28);
          lit=.45+1.1*exp(-r*r/.5);
        }else{
          albedo=mix(albedo,albedo*.4,smoothstep(-.05,-.13,vW.y));
        }
        vec3 H=normalize(uKeyDir+V);
        float spec=pow(max(dot(N,H),0.),48.)*(.03+.14*fine);
        vec3 c=albedo*(uAmb+uKeyCol*max(dot(N,uKeyDir),0.)*lit+uRimCol*max(dot(N,uMoonDir),0.)*.5)+uKeyCol*spec*.3;
        c+=uRimCol*pow(1.-max(dot(N,V),0.),3.)*.06;
        if(top)c+=uJade*(line*(1.5*uGlow+3.*uFlash)+exp(-sq((r-.84)/.06))*.04*(uGlow+uFlash));
        else c+=uJade*.06*uGlow*smoothstep(-.06,-.13,vW.y);
        gl_FragColor=linearToOutputTexel(vec4(c,1.));
      }`,
  })
  materials.push(stone)
  const tierA = new T.CylinderGeometry(0.9, 0.92, 0.07, 128, 1),
    tierB = new T.CylinderGeometry(1.08, 1.12, 0.26, 128, 1)
  geometries.push(tierA, tierB)
  const upper = new T.Mesh(tierA, stone),
    lower = new T.Mesh(tierB, stone)
  upper.position.y = -0.004 - 0.035
  lower.position.y = -0.074 - 0.13
  group.add(upper, lower)

  // 光环晕：贴在台面上方一点点的加色环，给发光槽一圈柔光
  const halo = keep(
    new T.RingGeometry(0.6, 1.1, 160, 1),
    new T.ShaderMaterial({
      uniforms: {uJade: {value: palette.jade}, uGlow: glow, uFlash: flash},
      vertexShader: /* glsl */ `varying vec3 vW;void main(){vec4 w=modelMatrix*vec4(position,1.);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}`,
      fragmentShader: /* glsl */ `uniform vec3 uJade;uniform float uGlow,uFlash;varying vec3 vW;
        void main(){float x=length(vW.xz)-.84;
          float a=exp(-x*x/.0016)*.22*(uGlow+2.5*uFlash)+exp(-x*x/.00008)*.3*uGlow;
          gl_FragColor=linearToOutputTexel(vec4(uJade*a,1.));}`,
      blending: T.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    }),
  )
  halo.rotation.x = -Math.PI / 2
  halo.position.y = 0.002
  group.add(halo)

  // 顶光：极淡的暖色光柱，给人物一个「被照亮的舞台」
  const shaft = keep(
    new T.CylinderGeometry(0.32, 1.05, 4.6, 48, 1, true),
    new T.ShaderMaterial({
      uniforms: {uKeyCol: {value: palette.key}, uGlow: glow},
      vertexShader: /* glsl */ `varying vec3 vW,vN;varying float vH;void main(){vH=uv.y;vec4 w=modelMatrix*vec4(position,1.);vW=w.xyz;vN=normalize(mat3(modelMatrix)*normal);gl_Position=projectionMatrix*viewMatrix*w;}`,
      fragmentShader: /* glsl */ `uniform vec3 uKeyCol;uniform float uGlow;varying vec3 vW,vN;varying float vH;
        void main(){float f=abs(dot(normalize(vN),normalize(cameraPosition-vW)));
          float a=pow(f,2.5)*pow(1.-vH,1.6)*smoothstep(0.,.05,vH)*.05;
          gl_FragColor=linearToOutputTexel(vec4(uKeyCol*a,1.));}`,
      blending: T.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      side: T.DoubleSide,
    }),
  )
  shaft.position.y = 2.3
  group.add(shaft)

  // --- 灯火微尘 / 换装上扬的光尘 / 对岸人家 ------------------------------------------------------------------
  const motes = coarse ? 90 : 150,
    burst = reduced ? 0 : 56,
    far = 28
  const seeds: number[] = [],
    kinds: number[] = []
  const prng = seeded(17)
  for (let i = 0; i < motes + burst; i++) {
    seeds.push(prng(), prng(), prng(), prng())
    kinds.push(i < motes ? 0 : 1)
  }
  for (let i = 0; i < far; i++) {
    const near = i < far / 2,
      a = (prng() - 0.5) * 2.6,
      r = near ? 48 + prng() * 7 : 100 + prng() * 14
    seeds.push(Math.sin(a) * r, -0.05 + prng() * (near ? 0.5 : 1.2), Math.cos(a) * r, prng())
    kinds.push(2)
  }
  const pg = new T.BufferGeometry()
  pg.setAttribute('position', new T.Float32BufferAttribute(new Float32Array(kinds.length * 3), 3))
  pg.setAttribute('aSeed', new T.Float32BufferAttribute(seeds, 4))
  pg.setAttribute('aKind', new T.Float32BufferAttribute(kinds, 1))
  const burstU = {value: -1},
    sizeU = {value: 26},
    pixelU = {value: 1}
  const points = new T.Points(
    pg,
    new T.ShaderMaterial({
      uniforms: {
        uTime: time,
        uBurst: burstU,
        uSize: sizeU,
        uPixel: pixelU,
        uWarm: {value: palette.ember},
        uJade: {value: palette.jade},
        uFar: {value: palette.far},
      },
      vertexShader: /* glsl */ `attribute vec4 aSeed;attribute float aKind;uniform float uTime,uBurst,uSize,uPixel;uniform vec3 uWarm,uJade,uFar;
        varying float vA;varying vec3 vCol;
        void main(){
          vec3 p;float a,size=1.;
          if(aKind<.5){
            float ang=aSeed.x*6.2832+uTime*.025*(aSeed.y-.5);
            float rad=.75+pow(aSeed.y,.8)*5.5,span=4.;
            float y=mod(aSeed.z*span+uTime*(.035+.06*aSeed.w),span)-.1;
            p=vec3(sin(ang)*rad+sin(uTime*.6+aSeed.z*20.)*.12,y,cos(ang)*rad+cos(uTime*.5+aSeed.x*20.)*.12);
            a=sin(3.1416*clamp(y/span,0.,1.))*(.5+.5*sin(uTime*(.9+aSeed.w*2.)+aSeed.x*40.))*.85;
            size=.45+aSeed.w;
            vCol=mix(uWarm,vec3(1.,.9,.7),aSeed.z*.6);
          }else if(aKind<1.5){
            float t=uBurst;
            if(t<=0.||t>=1.){gl_Position=vec4(2.,2.,2.,1.);gl_PointSize=0.;vA=0.;vCol=vec3(0.);return;}
            float ang=aSeed.x*6.2832+t*(aSeed.y-.5)*1.4;
            float rad=.84+(aSeed.y-.4)*.1+t*.4*aSeed.z;
            p=vec3(sin(ang)*rad,t*(.5+1.7*aSeed.w),cos(ang)*rad);
            a=pow(1.-t,1.4)*smoothstep(0.,.06,t)*1.3;
            size=.4+aSeed.w*.8;
            vCol=mix(uJade,uWarm,aSeed.z*.7);
          }else{
            p=aSeed.xyz;
            a=(.6+.4*sin(uTime*.7+aSeed.w*30.));
            vCol=uFar;
          }
          vec4 mv=modelViewMatrix*vec4(p,1.);
          gl_Position=projectionMatrix*mv;
          float z=-mv.z;
          if(aKind>1.5){gl_PointSize=uPixel*(2.+1.6*fract(aSeed.w*7.));a*=mix(1.,.4,smoothstep(40.,120.,z));}
          else{gl_PointSize=min(uSize*size/z,uPixel*24.);a*=smoothstep(.35,1.3,z);}
          vA=a;
        }`,
      fragmentShader: /* glsl */ `varying float vA;varying vec3 vCol;
        void main(){vec2 d=gl_PointCoord-.5;float r2=dot(d,d)*4.;if(r2>1.)discard;
          float g=exp(-r2*4.)*.55+exp(-r2*24.);
          gl_FragColor=linearToOutputTexel(vec4(vCol*g*vA,1.));}`,
      blending: T.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    }),
  )
  geometries.push(pg)
  materials.push(points.material)
  points.frustumCulled = false
  group.add(points)

  let glowTarget = 1,
    pulseAt = -10,
    clock = 0
  const speed = reduced ? 0 : 1
  return {
    group,
    /** Pixel ratio feeds point sizes so motes look the same on every DPR. */
    pixelRatio(pr: number) {
      sizeU.value = 26 * pr
      pixelU.value = pr
    },
    update(dt: number, camera: T.Camera) {
      clock += dt
      time.value += dt * speed
      sky.position.copy(camera.position)
      glow.value += (glowTarget - glow.value) * Math.min(1, dt * 6)
      const p = (clock - pulseAt) / (reduced ? 0.9 : 1.5)
      flash.value = p >= 0 && p < 1 ? (1 - p) ** 2 * (reduced ? 0.6 : 1) : 0
      pulseU.value = !reduced && p >= 0 && p < 1 ? p : -1
      const b = (clock - pulseAt) / 1.7
      burstU.value = burst && b >= 0 && b < 1 ? b : -1
      lamps.forEach((l, i) => {
        const u = (l.phase + time.value / 150) % 1,
          x = 7 - 14 * u
        l.g.position.set(x, WATER_Y + 0.006 * Math.sin(time.value * 1.3 + i * 2), l.z + 0.25 * Math.sin(u * 6 + i))
        l.g.rotation.y = time.value * 0.1 + i
        const fade = Math.min(1, (7 - Math.abs(x)) / 1.5)
        l.halo.opacity = fade * (0.75 + 0.15 * Math.sin(time.value * 3.1 + i * 5))
        lampU[i].set(l.g.position.x, l.g.position.y, l.g.position.z, fade)
      })
    },
    hover(on: boolean) {
      glowTarget = on ? 1.45 : 1
    },
    /** Ring flash + expanding water ring + a lift of motes (reduced motion: flash only). */
    pulse() {
      if (clock - pulseAt > 0.4) pulseAt = clock
    },
    dispose() {
      group.removeFromParent()
      for (const g of geometries) g.dispose()
      for (const m of materials) m.dispose()
      for (const t of textures) t.dispose()
    },
  }
}
