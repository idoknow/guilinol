import {BRANDS, rules, type BrandId} from './data.ts'

// Keep the original wire codes for idle, ignition and burning.
const phases = ['idle','light','smoking','draw','sealed','tear','open','take','ready','drawOpened'] as const
export type SmokePhase = typeof phases[number]
export const brandIndex = (id:string) => Math.max(0, BRANDS.findIndex(b => b.id === id))
const duration = {draw:0.95, drawOpened:0.95, tear:0.75, take:1.45, light:1.45}
const nextPhase = {draw:'sealed', drawOpened:'open', tear:'open', take:'ready', light:'smoking'} as const
const prompts = {sealed:'撕开', open:'拿取', ready:'点燃', smoking:'吸一口'} as const
export interface SmokeView {
  phase:SmokePhase; progress:number; hold:number; carry:number; light:number; puff:number; ember:number
  burn:number; length:number; flame:number; puffs:number; brand:BrandId; lit:boolean; cig:number; strength:number; remaining:number
}
function render(phase:SmokePhase,progress:number,length:number,burn:number,puffs:number,puff:number,brand:string,strength:number,remaining=20):SmokeView {
  const taking = phase === 'take', lighting = phase === 'light', lit = phase === 'smoking'
  const pack = ['draw','drawOpened','sealed','tear','open'].includes(phase)
  return {phase,progress,hold:phase==='idle'?0:1,carry:pack?1:taking?Math.min(1,Math.max(0,(.95-progress)/.18)):0,
    light:phase==='ready'?1:lighting?Math.min(1,(1-progress)*5):taking?Math.max(0,(progress-.72)/.28):0,
    cig:lit || lighting || phase==='ready' || taking?1:0, puff,ember:lit || lighting && progress>.62?1:0,
    flame:lighting?Math.max(0,Math.sin((progress-.32)/.68*Math.PI)):0, lit,length,burn,puffs,brand,strength,remaining}
}
export const IDLE_VIEW = render('idle',0,0,0,0,0,BRANDS[0].id,1)
export class SmokeSession {
  phase:SmokePhase='idle'
  brand=BRANDS[0].id
  burn=0
  total=0
  puffs=0
  strength=1
  remaining=20
  private elapsed=0
  private puffTime=0
  private readonly random:()=>number
  constructor(random:()=>number=Math.random){this.random=random}
  get active(){return this.phase!=='idle'}
  get lit(){return this.phase==='smoking'}
  get wire(){return phases.indexOf(this.phase)}
  get length(){return this.total?this.burn/this.total:0}
  get inMouth(){return this.phase==='light'||this.phase==='ready'||this.lit}
  get prompt(){return this.puffTime===0 && this.phase in prompts ? prompts[this.phase as keyof typeof prompts] : ''}
  start(brand:string|undefined,remaining=20,opened=false){
    if(!brand||this.active)return false
    this.remaining=remaining
    this.brand=brand
    this.phase=opened || remaining<20?'drawOpened':'draw'
    this.elapsed=0
    this.total=rules.minSeconds+(rules.maxSeconds-rules.minSeconds)*this.random()
    this.burn=this.total
    this.puffs=0
    this.strength=1
    return true
  }
  stop(){this.phase='idle';this.elapsed=this.puffTime=this.burn=0}
  act(take:()=>boolean,unseal:()=>boolean=()=>true){
    if(!this.prompt)return false
    if(this.phase==='sealed'){
      if(!unseal())return false
      this.phase='tear'
    }
    else if(this.phase==='open'){
      if(!take())return false
      this.remaining--
      this.phase='take'
    }else if(this.phase==='ready')this.phase='light'
    else{
      this.strength=this.random()<rules.doubleChance?2:1
      this.burn=Math.max(0,this.burn-this.total*rules.puffSegments*this.strength/10)
      this.puffs++
      this.puffTime=1.2
    }
    this.elapsed=0
    return true
  }
  advance(dt:number){
    const step=Math.max(0,dt)
    this.elapsed+=step
    if(this.lit){
      this.puffTime=Math.max(0,this.puffTime-step)
      this.burn=Math.max(0,this.burn-step)
      if(!this.burn){this.stop();return true}
    }else if(this.phase in duration){
      const phase=this.phase as keyof typeof duration
      if(this.elapsed>=duration[phase]){this.phase=nextPhase[phase];this.elapsed=0}
    }
    return false
  }
  view(){return render(this.phase,Math.min(1,this.elapsed/(duration[this.phase as keyof typeof duration]??1)),this.length,this.burn,this.puffs,Math.sin(this.puffTime/1.2*Math.PI),this.brand,this.strength,this.remaining)}
}
export class RemoteSmoke {
  private current=IDLE_VIEW
  private elapsed=0
  private puffTime=0
  get active(){return this.current.phase!=='idle'}
  update(sc:number,sb:number,sp:number,br:number,dt:number,strength=1,remaining=20){
    const phase=phases[sc]??'idle'
    this.elapsed=phase===this.current.phase?this.elapsed+dt:0
    this.puffTime=phase==='smoking' && sp!==this.current.puffs?1.2:Math.max(0,this.puffTime-dt)
    this.current=render(phase,Math.min(1,this.elapsed/(duration[phase as keyof typeof duration]??1)),
      Math.max(0,Math.min(1,sb/1800)),sb/10,sp,Math.sin(this.puffTime/1.2*Math.PI),BRANDS[br]?.id??BRANDS[0].id,strength,remaining)
  }
  view(){return this.current}
}
