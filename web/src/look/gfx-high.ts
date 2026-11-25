import {GodraysPass} from 'three-good-godrays'
import {DepthOfFieldEffect,EffectPass} from 'postprocessing'
import type {PerspectiveCamera,DirectionalLight} from 'three'
export function highEffects(light:DirectionalLight,camera:PerspectiveCamera){
  const rays=new GodraysPass(light,camera,{gammaCorrection:false})
  const dof=new DepthOfFieldEffect(camera,{focusDistance:.02})
  return {rays,dof,focus:new EffectPass(camera,dof)}
}
