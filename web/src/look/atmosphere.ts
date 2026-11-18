import * as THREE from 'three'
import {look} from './config'
import {atmo, env} from './time'

// Layered aerial perspective (M1) driven by time-of-day uniforms (M3): exponential distance fog,
// analytic height fog integrated along the view ray (so 晨雾 pools in the valleys and peaks rise out
// of it), colour walking from near haze → far 石青 blue → sky horizon. Fog is applied after tone
// mapping + sRGB encode, so atmo colours are uploaded in display space (time.ts).
export function installAtmosphere() {
  const chunk = THREE.ShaderChunk
  chunk.fog_pars_vertex = `#ifdef USE_FOG\nvarying float vFogDepth;\nvarying vec3 vFogWorld;\n#endif`
  chunk.fog_vertex = `#ifdef USE_FOG\nvFogDepth = - mvPosition.z;\nvFogWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\n#endif`
  chunk.fog_pars_fragment = `#ifdef USE_FOG
    uniform vec3 fogColor; varying float vFogDepth; varying vec3 vFogWorld;
    uniform vec3 uHazeNear; uniform vec3 uHazeFar; uniform vec3 uHorizon; uniform vec4 uFog;
    float fogLayer(float y) { return exp(-max(y - uFog.z, 0.0) / uFog.w); }
  #endif`
  chunk.fog_fragment = `#ifdef USE_FOG
    float fogDist = length(vFogWorld - cameraPosition);
    float fogDy = vFogWorld.y - cameraPosition.y;
    float fogValley = abs(fogDy) < 1.0 ? fogLayer(0.5 * (vFogWorld.y + cameraPosition.y))
      : clamp(uFog.w * (fogLayer(cameraPosition.y) - fogLayer(vFogWorld.y)) / fogDy, 0.0, 1.0);
    float fogLow = 0.5 * (vFogWorld.y + cameraPosition.y) - uFog.z;
    float fogDensity2 = (1.0 + uFog.y * fogValley) * exp(-max(fogLow, 0.0) / ${look.airScaleHeight.toFixed(1)});
    float fogFactor = 1.0 - exp(-fogDist * fogDensity2 / uFog.x);
    vec3 fogTint = mix(uHazeNear, uHazeFar, smoothstep(${look.fogBlueFrom.toFixed(1)}, ${look.fogBlueTo.toFixed(1)}, fogDist));
    float fogEdge = smoothstep(${look.fogHorizonFrom.toFixed(1)}, ${look.fogHorizonTo.toFixed(1)}, fogDist);
    fogTint = mix(fogTint, uHorizon, fogEdge);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogTint, max(fogFactor, fogEdge));
  #endif`
  // Every built-in material shares the same atmo uniform objects, so one update per frame retints the world.
  THREE.Material.prototype.onBeforeCompile = function(shader) { shareAtmosphere(shader) }
}
export function shareAtmosphere(shader:{uniforms:Record<string,THREE.IUniform>}) { Object.assign(shader.uniforms,atmo) }

export function sky() {
  const uniforms = {zenith:{value:env.zenith},horizon:{value:env.horizon},glow:{value:env.glow},
    cloudLit:{value:env.cloudLit},cloudShade:{value:env.cloudShade},sunUp:{value:0},cover:{value:0},
    uSun:atmo.uSun,uNight:atmo.uNight,uTime:atmo.uTime}
  const material = new THREE.ShaderMaterial({
    side:THREE.BackSide, depthWrite:false, fog:false, toneMapped:false, uniforms,
    vertexShader:`varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
    fragmentShader:`uniform vec3 zenith, horizon, glow, cloudLit, cloudShade, uSun; uniform float sunUp, cover, uNight, uTime; varying vec3 vDir;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
      float fbm(vec2 p){ float s = 0.0, a = 0.5; for(int i = 0; i < 5; i++){ s += a*noise(p); p = p*2.03 + 7.1; a *= 0.5; } return s; }
      void main(){
        vec3 dir = normalize(vDir);
        float up = clamp(dir.y, 0.0, 1.0);
        vec3 col = mix(horizon, zenith, pow(up, 0.55));
        float toward = max(dot(dir, uSun), 0.0);
        col = mix(col, glow, pow(toward, 6.0) * 0.5 * (1.0 - up * 0.6));
        // Stars and moon at night; sun disc by day.
        vec2 cell = floor(dir.xz / (dir.y + 0.25) * 260.0);
        float star = step(0.9965, hash(cell)) * smoothstep(0.05, 0.35, dir.y) * uNight;
        col += vec3(0.85, 0.9, 1.0) * star * (0.5 + 0.5 * sin(uTime * 2.0 + hash(cell + 3.0) * 40.0));
        float disc = smoothstep(0.9993, 0.9997, toward);
        col += mix(vec3(1.0, 0.93, 0.8) * 1.6 * sunUp, vec3(0.8, 0.86, 0.95) * uNight, uNight) * disc;
        col += vec3(0.5, 0.56, 0.7) * pow(toward, 400.0) * uNight * 0.5;
        // Soft drifting clouds on a dome plane: lit on the sun side, flattened toward the horizon.
        if (dir.y > 0.0) {
          vec2 p = dir.xz / (dir.y + 0.12) * 1.6 + vec2(uTime * 0.004, uTime * 0.0015);
          float shape = fbm(p) + 0.18 * fbm(p * 3.1 - uTime * 0.006);
          float mask = smoothstep(1.02 - cover, 1.32 - cover * 0.6, shape) * smoothstep(0.0, 0.18, dir.y);
          vec3 cloud = mix(cloudShade, cloudLit, clamp(0.35 + 0.65 * pow(toward, 3.0) + (shape - 0.6), 0.0, 1.0));
          col = mix(col, cloud, mask * 0.88);
        }
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  })
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(9000,32,16),material)
  mesh.frustumCulled=false; mesh.renderOrder=-1
  mesh.onBeforeRender=(_r,_s,camera)=>mesh.position.copy(camera.position)
  return Object.assign(mesh,{update(){uniforms.sunUp.value=env.sunUp;uniforms.cover.value=env.clouds}})
}

export function outerGround(extent:[number,number,number,number]) {
  const [left,top,width,depth] = extent
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(40000,40000).rotateX(-Math.PI/2),
    new THREE.MeshLambertMaterial({color:look.outerGround}))
  plane.position.set(left+width/2,look.outerGroundY,top+depth/2)
  return plane
}
