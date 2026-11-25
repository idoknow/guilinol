import * as THREE from 'three'
import {Effect,EffectComposer,RenderPass,EffectPass,BloomEffect,SMAAEffect,SMAAPreset,HueSaturationEffect,BrightnessContrastEffect,BlendFunction} from 'postprocessing'
import {N8AOPostPass} from 'n8ao'
import {type gfxState,sample,type Tier} from './gfx-state'
import {env} from './time'
import {sunShadows} from './sun-shadows'
import {renderWithLabels} from './nameplates'

class DisplayScenePass extends RenderPass {
  mapping:THREE.ToneMapping=THREE.NeutralToneMapping
  override render(...args:Parameters<RenderPass['render']>){
    const [renderer,input]=args
    if(!input)throw Error('Display scene requires an offscreen target')
    const target=input as THREE.WebGLRenderTarget & {isXRRenderTarget?:boolean}
    const colorSpace=target.texture.colorSpace, mapping=renderer.toneMapping, presentation=target.isXRRenderTarget
    try{
      target.isXRRenderTarget=true;target.texture.colorSpace=renderer.outputColorSpace;renderer.toneMapping=this.mapping
      super.render(...args)
    }finally{target.isXRRenderTarget=presentation;target.texture.colorSpace=colorSpace;renderer.toneMapping=mapping}
  }
}

const nativeTone={neutral:THREE.NeutralToneMapping,agx:THREE.AgXToneMapping,aces:THREE.ACESFilmicToneMapping} as const
function decodeScene(enabled:THREE.Uniform<boolean>){
  return new Effect('DecodeScene',`uniform bool enabled; void mainImage(const in vec4 color,const in vec2 uv,out vec4 result){result=enabled?sRGBTransferEOTF(color):color;}`,{blendFunction:BlendFunction.SRC,uniforms:new Map([['enabled',enabled]])})
}

export function mainPass(renderer:THREE.WebGLRenderer,scene:THREE.Scene,camera:THREE.PerspectiveCamera,light:THREE.DirectionalLight,state:ReturnType<typeof gfxState>){
  renderer.toneMapping=THREE.NoToneMapping
  const composer=new EffectComposer(renderer,{frameBufferType:THREE.HalfFloatType})
  renderer.autoClear=true
  const shadows=sunShadows(renderer,scene,camera,light)
  const ao=new N8AOPostPass(scene,camera,1,1)
  ao.autoDetectTransparency=false;ao.configuration.transparencyAware=false;ao.configuration.gammaCorrection=false
  const bloom=new BloomEffect({mipmapBlur:true}), glow=new EffectPass(camera,bloom)
  const scenePass=new DisplayScenePass(scene,camera)
  const decode=new EffectPass(camera,decodeScene(new THREE.Uniform(true))), decodeInGrade=new THREE.Uniform(false)
  const saturation=new HueSaturationEffect(), contrast=new BrightnessContrastEffect()
  const grade=new EffectPass(camera,decodeScene(decodeInGrade),saturation,contrast), aa=new EffectPass(camera,new SMAAEffect({preset:SMAAPreset.LOW}))
  for(const pass of [scenePass,decode,ao,glow,grade,aa])composer.addPass(pass)
  let high:ReturnType<typeof import('./gfx-high').highEffects>|undefined
  let loading=false
  async function loadHigh(){
    loading=true;high=(await import('./gfx-high')).highEffects(light,camera)
    composer.addPass(high.rays,composer.passes.indexOf(glow));composer.addPass(high.focus,composer.passes.indexOf(aa))
  }
  let lastTier:Tier|undefined, width=0,height=0,config=state.config,hour=NaN,options=sample(config,env.hour),density=-1
  return {render(focus:THREE.Vector3){
    const canvas=renderer.domElement
    if(canvas.width!==width||canvas.height!==height){width=canvas.width;height=canvas.height;const ratio=renderer.getPixelRatio();composer.setSize(width/ratio,height/ratio,false)}
    if(config!==state.config||Math.abs(hour-env.hour)>.01||!Number.isFinite(hour)){config=state.config;hour=env.hour;options=sample(config,hour)}
    const quality=state.quality
    if(quality==='low'&&(state.direct||(!options.ao.lowEnabled&&options.saturation===1&&options.contrast===1))){
      shadows(quality,options.shadow,focus)
      renderer.toneMapping=nativeTone[state.direct?'neutral':options.toneMapping]
      renderer.toneMappingExposure=env.exposure*(state.direct?1:options.exposure)
      try{renderer.render(scene,camera)}finally{renderer.toneMapping=THREE.NoToneMapping}
      return 0
    }
    if(quality==='high'&&!loading)void loadHigh().catch(error=>console.warn('High effects unavailable',error))
    if(lastTier!==quality){
      lastTier=quality;ao.configuration.halfRes=quality!=='high';ao.setQualityMode(quality==='high'?'Low':'Performance')
      if(quality==='low'){ao.configuration.aoSamples=4;ao.configuration.denoiseIterations=1}
    }
    ao.enabled=quality==='low'?options.ao.lowEnabled:options.ao.enabled;ao.configuration.intensity=options.ao.intensity;ao.configuration.aoRadius=options.ao.radius
    glow.enabled=quality!=='low'&&options.bloom.enabled;bloom.intensity=options.bloom.intensity;bloom.luminanceMaterial.threshold=options.bloom.threshold
    scenePass.mapping=nativeTone[options.toneMapping]
    saturation.saturation=options.saturation-1;contrast.contrast=options.contrast-1
    renderer.toneMappingExposure=env.exposure*options.exposure
    const casters=shadows(quality,options.shadow,focus)
    if(high){
      high.rays.enabled=quality==='high'&&light.castShadow&&options.godrays.enabled&&env.sunUp>0
      const next=Math.round(options.godrays.intensity*env.sunUp*1000)/1000
      if(next!==density){density=next;high.rays.setParams({density:next/128,gammaCorrection:false})}
      high.focus.enabled=quality==='high'&&options.dof.enabled;high.dof.bokehScale=options.dof.bokeh;high.dof.cocMaterial.focusRange=options.dof.focusRange
    }
    renderer.autoClear=false
    decode.enabled=ao.enabled||glow.enabled||!!high?.rays.enabled
    decodeInGrade.value=!decode.enabled
    aa.enabled=quality!=='low'&&(decode.enabled||light.castShadow||!!high?.focus.enabled||options.saturation!==1||options.contrast!==1)
    grade.renderToScreen=!aa.enabled
    try{renderWithLabels(renderer,camera,ao.depthTexture,()=>composer.render())}finally{renderer.autoClear=true}
    return casters
  }}
}
