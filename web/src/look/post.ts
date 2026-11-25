import * as THREE from 'three'
import {EffectComposer,RenderPass,EffectPass,BloomEffect,ToneMappingEffect,ToneMappingMode,SMAAEffect,SMAAPreset,HueSaturationEffect,BrightnessContrastEffect} from 'postprocessing'
import {N8AOPostPass} from 'n8ao'
import {type gfxState,sample,type Tier} from './gfx-state'
import {env} from './time'
import {sunShadows} from './sun-shadows'

export function mainPass(renderer:THREE.WebGLRenderer,scene:THREE.Scene,camera:THREE.PerspectiveCamera,light:THREE.DirectionalLight,state:ReturnType<typeof gfxState>){
  renderer.toneMapping=THREE.NoToneMapping
  const composer=new EffectComposer(renderer,{frameBufferType:THREE.HalfFloatType})
  renderer.autoClear=true
  const shadows=sunShadows(renderer,scene,camera,light)
  const ao=new N8AOPostPass(scene,camera,1,1)
  ao.autoDetectTransparency=false;ao.configuration.transparencyAware=false;ao.configuration.gammaCorrection=false
  const bloom=new BloomEffect({mipmapBlur:true}), glow=new EffectPass(camera,bloom)
  const tone=new ToneMappingEffect({mode:ToneMappingMode.AGX}), saturation=new HueSaturationEffect(), contrast=new BrightnessContrastEffect()
  const grade=new EffectPass(camera,tone,saturation,contrast), aa=new EffectPass(camera,new SMAAEffect({preset:SMAAPreset.LOW}))
  for(const pass of [new RenderPass(scene,camera),ao,glow,grade,aa])composer.addPass(pass)
  let high:ReturnType<typeof import('./gfx-high').highEffects>|undefined
  let loading=false
  async function loadHigh(){
    loading=true;high=(await import('./gfx-high')).highEffects(light,camera)
    composer.addPass(high.rays,2);composer.addPass(high.focus,composer.passes.indexOf(aa))
  }
  let lastTier:Tier|undefined, width=0,height=0,config=state.config,hour=NaN,options=sample(config,env.hour),density=-1
  return {render(){
    const canvas=renderer.domElement
    if(canvas.width!==width||canvas.height!==height){width=canvas.width;height=canvas.height;const ratio=renderer.getPixelRatio();composer.setSize(width/ratio,height/ratio,false)}
    if(config!==state.config||Math.abs(hour-env.hour)>.01||!Number.isFinite(hour)){config=state.config;hour=env.hour;options=sample(config,hour)}
    const quality=state.quality
    if(quality==='high'&&!loading)void loadHigh().catch(error=>console.warn('High effects unavailable',error))
    if(lastTier!==quality){
      lastTier=quality;ao.configuration.halfRes=quality!=='high';ao.setQualityMode(quality==='high'?'Low':'Performance')
      if(quality==='low'){ao.configuration.aoSamples=4;ao.configuration.denoiseIterations=1}
      aa.enabled=quality!=='low';grade.renderToScreen=!aa.enabled
    }
    ao.enabled=options.ao.enabled;ao.configuration.intensity=options.ao.intensity;ao.configuration.aoRadius=options.ao.radius
    glow.enabled=quality!=='low'&&options.bloom.enabled;bloom.intensity=options.bloom.intensity;bloom.luminanceMaterial.threshold=options.bloom.threshold
    tone.mode=options.toneMapping==='agx'?ToneMappingMode.AGX:ToneMappingMode.ACES_FILMIC
    saturation.saturation=options.saturation-1;contrast.contrast=options.contrast-1
    renderer.toneMappingExposure=env.exposure*options.exposure
    shadows(quality,options.shadow)
    if(high){
      high.rays.enabled=quality==='high'&&light.castShadow&&options.godrays.enabled&&env.sunUp>0
      const next=Math.round(options.godrays.intensity*env.sunUp*1000)/1000
      if(next!==density){density=next;high.rays.setParams({density:next/128,gammaCorrection:false})}
      high.focus.enabled=quality==='high'&&options.dof.enabled;high.dof.bokehScale=options.dof.bokeh;high.dof.cocMaterial.focusRange=options.dof.focusRange
    }
    renderer.autoClear=false
    try{composer.render()}finally{renderer.autoClear=true}
  }}
}
