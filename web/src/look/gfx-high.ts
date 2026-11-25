import {BlendFunction,DepthOfFieldEffect,Effect,EffectAttribute,EffectPass} from 'postprocessing'
import {Uniform,type PerspectiveCamera,type DirectionalLight,type Texture} from 'three'

const fragment=`
uniform sampler2D blockers;
uniform mat4 inverseProjection, cameraWorld, worldToShadow;
uniform float reach, density;
uniform vec3 sunColor;
void mainImage(const in vec4 color,const in vec2 uv,const in float depth,out vec4 result){
  vec4 view=inverseProjection*vec4(uv*2.-1.,depth*2.-1.,1.);
  vec3 end=view.xyz/view.w;
  float lengthM=min(length(end),reach);
  vec3 stepWorld=mat3(cameraWorld)*normalize(end)*(lengthM/32.);
  vec3 sampleWorld=cameraWorld[3].xyz+.5*stepWorld;
  float lit=0.,blocked=0.;
  for(int index=0;index<32;index++){
    vec3 coord=(worldToShadow*vec4(sampleWorld,1.)).xyz;
    if(all(greaterThan(coord,vec3(0.)))&&all(lessThan(coord,vec3(1.)))){
      float depthM=unpackRGBAToDepth(texture2D(blockers,coord.xy));
      if(depthM<coord.z-.00035)blocked++;else lit++;
    }
    sampleWorld+=stepWorld;
  }
  float shaft=(1.-exp(-density*lengthM*lit/32.))*blocked/32.;
  result=vec4(mix(color.rgb,sunColor,shaft),color.a);
}`

export function highEffects(light:DirectionalLight,camera:PerspectiveCamera){
  const blockers=new Uniform<Texture|null>(null),reach=new Uniform(0),scattering=new Uniform(0)
  const effect=new Effect('OccludedSun',fragment,{attributes:EffectAttribute.DEPTH,blendFunction:BlendFunction.SRC,
    uniforms:new Map<string,Uniform>([['blockers',blockers],['reach',reach],['density',scattering],['sunColor',new Uniform(light.color)],
      ['inverseProjection',new Uniform(camera.projectionMatrixInverse)],['cameraWorld',new Uniform(camera.matrixWorld)],['worldToShadow',new Uniform(light.shadow.matrix)]])})
  effect.update=()=>{blockers.value=light.shadow.map?.texture??null;reach.value=light.shadow.camera.right*2}
  const dof=new DepthOfFieldEffect(camera,{focusDistance:.02})
  return {rays:new EffectPass(camera,effect),scattering,dof,focus:new EffectPass(camera,dof)}
}
