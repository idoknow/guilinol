import {BlendFunction,DepthOfFieldEffect,Effect,EffectAttribute,EffectPass} from 'postprocessing'
import {Uniform,type PerspectiveCamera,type DirectionalLight,type Texture} from 'three'
import {env} from './time'

const fragment=`
uniform sampler2D blockers;
uniform mat4 inverseProjection, cameraWorld, worldToShadow;
uniform float reach, density;
uniform vec3 sunColor, sunDirection;
float bayer2(vec2 pixel){vec2 bit=mod(floor(pixel),2.);return 2.*bit.x+3.*bit.y-4.*bit.x*bit.y;}
void mainImage(const in vec4 color,const in vec2 uv,const in float depth,out vec4 result){
  vec4 view=inverseProjection*vec4(uv*2.-1.,depth*2.-1.,1.);
  vec3 end=view.xyz/view.w;
  float lengthM=min(length(end),reach);
  vec3 direction=mat3(cameraWorld)*normalize(end);
  float stepLength=lengthM/32.;
  vec3 stepWorld=direction*stepLength;
  float jitter=(4.*bayer2(gl_FragCoord.xy)+bayer2(gl_FragCoord.xy*.5)+.5)/16.;
  vec3 sampleWorld=cameraWorld[3].xyz+jitter*stepWorld;
  float inscatter=0.;
  for(int index=0;index<32;index++){
    vec3 coord=(worldToShadow*vec4(sampleWorld,1.)).xyz;
    if(all(greaterThan(coord,vec3(0.)))&&all(lessThan(coord,vec3(1.)))){
      float depthM=unpackRGBAToDepth(texture2D(blockers,coord.xy));
      if(depthM>=coord.z-.00035)inscatter+=stepLength*density;
    }
    sampleWorld+=stepWorld;
  }
  float forwardPhase=pow(max(0.,dot(direction,sunDirection)),12.);
  result=vec4(color.rgb+sunColor*min(inscatter*forwardPhase,.15),color.a);
}`

export function highEffects(light:DirectionalLight,camera:PerspectiveCamera){
  const blockers=new Uniform<Texture|null>(null),reach=new Uniform(0),scattering=new Uniform(0)
  const effect=new Effect('OccludedSun',fragment,{attributes:EffectAttribute.DEPTH,blendFunction:BlendFunction.SRC,
    uniforms:new Map<string,Uniform>([['blockers',blockers],['reach',reach],['density',scattering],['sunColor',new Uniform(light.color)],
      ['sunDirection',new Uniform(env.sunDir)],['inverseProjection',new Uniform(camera.projectionMatrixInverse)],['cameraWorld',new Uniform(camera.matrixWorld)],['worldToShadow',new Uniform(light.shadow.matrix)]])})
  effect.update=()=>{blockers.value=light.shadow.map?.texture??null;reach.value=Math.min(64,light.shadow.camera.right*2)}
  const dof=new DepthOfFieldEffect(camera,{focusDistance:.02})
  return {rays:new EffectPass(camera,effect),scattering,dof,focus:new EffectPass(camera,dof)}
}
