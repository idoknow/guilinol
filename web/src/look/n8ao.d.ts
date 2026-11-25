declare module 'n8ao' {
  import {Pass} from 'postprocessing'
  import type {Scene,PerspectiveCamera} from 'three'
  export class N8AOPostPass extends Pass {
    constructor(scene:Scene,camera:PerspectiveCamera,width:number,height:number)
    configuration:{halfRes:boolean;intensity:number;aoRadius:number;gammaCorrection:boolean;transparencyAware:boolean;aoSamples:number;denoiseIterations:number}
    autoDetectTransparency:boolean
    setQualityMode(mode:string):void
  }
}
