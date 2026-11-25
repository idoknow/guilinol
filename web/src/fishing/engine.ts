import {chooseFish,fishForce,junk,sizes,tackle,type Method,type Species,type Water} from './config.ts'
import {basePrice} from './grades.ts'

export type Stage='idle'|'equip'|'cast'|'retrieve'|'hook'|'fight'|'wait'|'bite'|'strike'|'land'|'snap'|'escape'|'miss'|'junk'
export type Catch={id:string,speciesId:string,name:string,grade:string,size:string,weight:number,water:string,method:Method,time:number,price:number}
type Setup={water:Water,method:Method,line:number,rod:number,bait:string,float:boolean,drag:boolean}
type Signal=(kind:string,detail:unknown)=>void
export class FishingEngine {
  stage:Stage='idle'; direction=0; pull=0; reel=false; tension=0; stamina=1; force=0
  private clock=0; private red=0; private turn=0; private fish?:Species; private setup?:Setup
  private random:()=>number; private signal:Signal; private accept:(item:Catch)=>boolean
  constructor(signal:Signal,accept:(item:Catch)=>boolean,random=Math.random){this.signal=signal;this.accept=accept;this.random=random}
  setSeed(seed:number){this.random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32)}
  private go(stage:Stage,seconds=0){this.stage=stage;this.clock=seconds;this.signal('state',stage)}
  equip(){this.go('equip')}
  cancel(){this.setup=undefined;this.reel=false;this.pull=0;this.go('idle');this.signal('float',null)}
  cast(setup:Setup){
    if(!['equip','land','snap','escape','miss','junk'].includes(this.stage))return false
    this.setup=setup;this.tension=.2;this.stamina=1;this.red=0;this.turn=0;this.pull=0;this.reel=false
    this.fish=undefined;this.go('cast',.2);this.signal('float',{target:setup.water.spot.target,sunk:false});return true
  }
  bite(force=false){
    if(!this.setup||!['cast','retrieve','wait'].includes(this.stage))return
    const setup=this.setup
    if(!force&&this.random()>(setup.method==='路亚'?.92:.7)){this.go(setup.method==='路亚'?'escape':'miss');return}
    this.fish=chooseFish(setup.water,setup.method,setup.bait,setup.line,this.random)
    if(setup.method==='路亚'){
      if(!this.fish){this.go('escape');return}
      this.force=fishForce(this.fish);this.go('hook',.15)
    }else{this.go('bite',Math.min(1.2,.5+.6*this.random()+(setup.float?.12:0)));this.signal('float',{target:setup.water.spot.target,sunk:true})}
  }
  strike(){if(this.stage!=='bite')return;this.go('strike',this.fish && sizes.indexOf(this.fish.size)>=2?.8:.15)}
  private land(trash=false){
    const fish=this.fish, setup=this.setup!
    if(!fish&&!trash){this.go('miss');return}
    const fraction=this.random(), size=fish?sizes.indexOf(fish.size):0
    const item:Catch={id:crypto.randomUUID(),speciesId:trash?'':fish!.id,name:trash?junk[Math.floor(this.random()*junk.length)]:fish!.name,
      grade:trash?'junk':fish!.grade,size:trash?'':fish!.size,weight:trash?0:Math.round((.1+fraction)*[.1,.7,3,16,70][size]*100)/100,
      water:setup.water.id,method:setup.method,time:Date.now(),price:trash?1+Math.floor(this.random()*5):basePrice(fish!.grade,fraction)}
    if(!this.accept(item)){this.go('miss');return}
    this.go(trash?'junk':'land');this.signal('catch',item)
  }
  tick(dt:number){
    const setup=this.setup;if(!setup)return
    this.clock-=dt
    if(this.stage==='cast'&&this.clock<=0)this.go(setup.method==='路亚'?'retrieve':'wait',1.5+this.random()*3)
    else if((this.stage==='wait'||this.stage==='retrieve')&&this.clock<=0&&(this.stage==='wait'||this.reel))this.bite()
    else if(this.stage==='hook'&&this.clock<=0)this.go('fight',45)
    else if(this.stage==='bite'&&this.clock<=0)this.go('miss')
    else if(this.stage==='strike'&&this.clock<=0)this.land(this.random()<.19)
    else if(this.stage==='fight'){
      this.turn-=dt;if(this.turn<=0){this.direction=Math.floor(this.random()*3)-1;this.turn=.6+.9*this.random();this.signal('force',{direction:this.direction,force:this.force})}
      const matched=this.direction===this.pull, load=this.force/tackle[setup.rod-1].force
      this.tension=Math.max(0,Math.min(1,this.tension+dt*(this.reel?(matched?-.35:.6+load*.4):-.28)))
      if(this.reel&&matched)this.stamina-=dt*.48/(.65+load)
      if(this.tension>=.8)this.red+=dt
      this.signal('tension',{tension:this.tension,stamina:this.stamina})
      if(this.red>tackle[setup.line-1].snapSeconds+(setup.drag?.4:0)){this.go('snap');this.signal('snap',null)}
      else if(this.stamina<=0)this.land();else if(this.clock<=0)this.go('escape')
    }
  }
}
