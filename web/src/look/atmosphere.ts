import * as THREE from 'three'
import {look} from './config'

const hex = (value:number)=>{const c=new THREE.Color(value);return `vec3(${c.r.toFixed(4)},${c.g.toFixed(4)},${c.b.toFixed(4)})`}

// Replace three's linear fog with layered aerial perspective: exponential distance fog,
// extra density near the valley floor, and a colour that walks from warm haze to 石青 blue
// to the sky horizon. Constants are baked from look/config at startup (M3 turns them into uniforms).
export function installAtmosphere() {
  const chunk = THREE.ShaderChunk
  chunk.fog_pars_vertex = `#ifdef USE_FOG\nvarying float vFogDepth;\nvarying vec3 vFogWorld;\n#endif`
  chunk.fog_vertex = `#ifdef USE_FOG\nvFogDepth = - mvPosition.z;\nvFogWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\n#endif`
  chunk.fog_pars_fragment = `#ifdef USE_FOG\nuniform vec3 fogColor;\nvarying float vFogDepth;\nvarying vec3 vFogWorld;\n#ifdef FOG_EXP2\nuniform float fogDensity;\n#else\nuniform float fogNear;\nuniform float fogFar;\n#endif\n#endif`
  chunk.fog_fragment = `#ifdef USE_FOG
    float fogDist = length(vFogWorld - cameraPosition);
    float fogLow = 0.5 * (vFogWorld.y + cameraPosition.y) - ${look.heightFogBase.toFixed(1)};
    float fogDensity2 = 1.0 + ${look.heightFogBoost.toFixed(3)} * exp(-max(fogLow, 0.0) / ${look.heightFogFalloff.toFixed(1)});
    fogDensity2 *= exp(-max(fogLow, 0.0) / ${look.airScaleHeight.toFixed(1)});
    float fogFactor = 1.0 - exp(-fogDist * fogDensity2 / ${look.fogLength.toFixed(1)});
    vec3 fogTint = mix(${hex(look.hazeNear)}, ${hex(look.hazeFar)}, smoothstep(${look.fogBlueFrom.toFixed(1)}, ${look.fogBlueTo.toFixed(1)}, fogDist));
    float fogEdge = smoothstep(${look.fogHorizonFrom.toFixed(1)}, ${look.fogHorizonTo.toFixed(1)}, fogDist);
    fogTint = mix(fogTint, ${hex(look.skyHorizon)}, fogEdge);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogTint, max(fogFactor, fogEdge));
  #endif`
}

export function sky() {
  const sun = new THREE.Vector3(...look.sunDirection).normalize()
  const material = new THREE.ShaderMaterial({
    side:THREE.BackSide, depthWrite:false, fog:false,
    uniforms:{zenith:{value:new THREE.Color(look.skyZenith)},horizon:{value:new THREE.Color(look.skyHorizon)},
      glow:{value:new THREE.Color(look.skyGlow)},sun:{value:sun}},
    vertexShader:`varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
    fragmentShader:`uniform vec3 zenith; uniform vec3 horizon; uniform vec3 glow; uniform vec3 sun; varying vec3 vDir;
      void main(){
        float up = clamp(vDir.y, 0.0, 1.0);
        vec3 col = mix(horizon, zenith, pow(up, 0.55));
        float halo = pow(max(dot(normalize(vDir), sun), 0.0), 6.0);
        col = mix(col, glow, halo * 0.45 * (1.0 - up * 0.6));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  })
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(9000,32,16),material)
  mesh.frustumCulled=false; mesh.renderOrder=-1
  mesh.onBeforeRender=(_r,_s,camera)=>mesh.position.copy(camera.position)
  return mesh
}

export function outerGround(extent:[number,number,number,number]) {
  const [left,top,width,depth] = extent
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(40000,40000).rotateX(-Math.PI/2),
    new THREE.MeshLambertMaterial({color:look.outerGround}))
  plane.position.set(left+width/2,look.outerGroundY,top+depth/2)
  return plane
}
