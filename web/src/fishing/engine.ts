import {castRules,chooseFish,fishForce,junk,sizes,tackle,type Method,type Species,type Water} from './config.ts'
import {basePrice} from './grades.ts'

export type Stage='idle'|'equip'|'cast'|'retrieve'|'approach'|'nibble'|'hit'|'fight'|'wait'|'land'|'snap'|'escape'|'miss'|'junk'|'empty-hook'
export type Catch={id:string,speciesId:string,name:string,grade:string,size:string,weight:number,water:string,method:Method,time:number,price:number}
type Setup={water:Water,method:Method,line:number,rod:number,bait:string,float:boolean,drag:boolean,distance:number}
type Signal=(kind:string,detail:unknown)=>void
// 品级越高鱼劲越大：冲得更猛、更频繁、体力掉得更慢（需求方 2026-11-25）
const gradeGrit={low:1,medium:1.1,high:1.3,legendary:1.6}
export class FishingEngine {
  stage:Stage='idle'; direction=0; distance=0; reel=false; tension=0; stamina=1; force=0
  private slack=0; private surge=0; private nibbles=0; private count=0; private jerks=0; private clock=0; private red=0; private turn=0; private fish?:Species; private setup?:Setup
  private random:()=>number; private signal:Signal; private accept:(item:Catch)=>boolean|'BAG_FULL'
  constructor(signal:Signal,accept:(item:Catch)=>boolean|'BAG_FULL',random=Math.random){this.signal=signal;this.accept=accept;this.random=random}
  setSeed(seed:number){this.random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32)}
  private go(stage:Stage,seconds=0){this.stage=stage;this.clock=seconds;this.signal('state',stage)}
  equip(){this.go('equip')}
  cancel(){this.setup=undefined;this.reel=false;this.go('idle');this.signal('float',null)}
  cast(setup:Setup){
    if(!setup.water.methods.includes(setup.method)||!['equip','land','snap','escape','miss','junk','empty-hook'].includes(this.stage))return false
    this.setup=setup;this.tension=.2;this.stamina=1;this.red=0;this.turn=1.5+2.5*this.random();this.distance=setup.distance;this.slack=this.surge=this.jerks=0;this.reel=false
    this.fish=undefined;this.go('cast',.2);return true
  }
  approach(force=false){
    const setup=this.setup
    if(!setup||!['cast','wait','retrieve'].includes(this.stage))return
    if(!force&&this.random()>(setup.method==='路亚'?.92:.7)){this.go(setup.method==='路亚'?'escape':'miss');return}
    this.fish=chooseFish(setup.water,setup.method,setup.bait,setup.line,this.random)
    if(!this.fish){this.go('empty-hook');return}
    this.nibbles=Math.floor(this.random()*4);this.count=0;this.go('approach',.4)
    this.signal('approach',{side:Math.floor(this.random()*3)-1,size:this.fish.size})
  }
  hit(){if(!['approach','nibble'].includes(this.stage))return;this.go('hit',castRules.hitSeconds);this.signal('hit',{})}
  press(){
    if(this.reel)return
    this.reel=true
    if(this.stage==='hit'){this.force=fishForce(this.fish!);this.go('fight');this.signal('hooked',{});return}
    const lure=this.setup?.method==='路亚'
    if((!lure&&this.stage==='nibble')||(lure&&['cast','retrieve','approach','nibble'].includes(this.stage)&&++this.jerks>=3)){
      this.fish=undefined;this.jerks=0;this.go(lure?'retrieve':'wait',2+2*this.random());this.signal('spooked',{})
    }
  }
  private land(trash=false){
    const fish=this.fish, setup=this.setup!
    if(!fish&&!trash){this.go('miss');return}
    const fraction=this.random(), size=fish?sizes.indexOf(fish.size):0
    const item:Catch={id:crypto.randomUUID(),speciesId:trash?'':fish!.id,name:trash?junk[Math.floor(this.random()*junk.length)]:fish!.name,
      grade:trash?'junk':fish!.grade,size:trash?'':fish!.size,weight:trash?0:Math.round((.1+fraction)*[.1,.7,3,16,70][size]*100)/100,
      water:setup.water.id,method:setup.method,time:Date.now(),price:trash?Math.floor(this.random()*3):basePrice(fish!.grade,fraction)}
    const accepted=this.accept(item)
    if(accepted==='BAG_FULL'){this.setup=undefined;this.go('miss');return}
    if(!accepted){this.go('miss');return}
    this.go(trash?'junk':'land');this.signal('catch',item)
  }
  tick(dt:number){
    const setup=this.setup;if(!setup)return
    if(this.stage==='retrieve'&&!this.reel)return
    this.clock-=dt
    if(this.stage==='cast'&&this.clock<=0){
      const range=Math.max(0,(setup.distance-6)/24)
      this.go(setup.method==='路亚'?'retrieve':'wait',(1.5+this.random()*3)*(1-.3*range))
    }else if((this.stage==='wait'||this.stage==='retrieve')&&this.clock<=0)this.approach()
    else if(this.stage==='approach'&&this.clock<=0){
      if(this.count>=this.nibbles)this.hit()
      else{this.go('nibble',.3);this.signal('nibble',{n:++this.count})}
    }else if(this.stage==='nibble'&&this.clock<=0)this.go('approach',.35)
    else if(this.stage==='hit'&&this.clock<=0){this.go('miss');this.signal('missed',{})}
    else if(this.stage==='fight'){
      this.turn-=dt;this.surge-=dt
      const grit=gradeGrit[this.fish!.grade as keyof typeof gradeGrit]??1
      if(this.turn<=0){this.surge=(.6+.6*this.random())*Math.sqrt(grit);this.turn=(1.5+2.5*this.random())/Math.sqrt(grit);this.direction=this.random()<.5?-1:1}
      const surge=this.surge>0,easy=setup.method==='台钓'&&sizes.indexOf(this.fish!.size)<=2
      const load=this.force/tackle[setup.rod-1].force, strength=(easy?.5:1)*(.3+load)*(.2+.8*this.stamina)*grit
      this.tension=Math.min(1,Math.max(0,this.tension+dt*((this.reel?.20:-.45)+(surge?(this.reel?.55:.12)*strength:0))))
      if(this.reel){if(surge)this.distance+=dt*2*strength;else if(this.tension<.85)this.distance-=dt*(3+.35*setup.rod)}
      this.stamina=Math.max(0,this.stamina-dt*(this.reel?.04:.012)/Math.sqrt(grit));if(this.tension>=.85)this.red+=dt
      this.slack=this.tension<=.1?this.slack+dt:0
      this.signal('fight',{tension:this.tension,distance:this.distance,stamina:this.stamina,surge,side:surge?this.direction:0})
      if(this.red>tackle[setup.line-1].snapSeconds+(setup.drag?.4:0)+(easy?.5:0)){this.go('snap');this.signal('snap',null)}
      else if(this.slack>=2.5)this.go('escape');else if(this.distance<=1.5)this.land(setup.method==='台钓'&&this.random()<.19)
    }
  }
}
