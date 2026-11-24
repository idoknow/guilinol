export class GroundMirrorGate {
  active=false
  ready=0
  private switched=-Infinity
  private seen=-Infinity
  private previous=0

  get radius(){return this.active?140:120}

  reset(now:number){
    this.active=false;this.ready=0;this.switched=this.seen=-Infinity;this.previous=now
  }

  step(now:number,visible:boolean){
    if(visible)this.seen=now
    if(now-this.switched>=1500 && (this.active ? now-this.seen>=1000 : visible)){
      this.active=!this.active;this.switched=now
    }
    const elapsed=Math.max(0,now-this.previous)
    const delta=Math.min(.06,elapsed/(this.active?350:500))
    this.ready=this.active?Math.min(1,this.ready+delta):Math.max(0,this.ready-delta)
    this.previous=now
  }
}
