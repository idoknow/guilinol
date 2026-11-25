import * as THREE from 'three'

// 钓鱼画面效果（IDOK-336 重做）：可弯的鱼竿、抛竿飞饵、水面鱼影 / 试探涟漪 / 咬钩水花。
// 都是轻量几何 + 少量材质，按需显示；不进物理、不投影。

/** 鱼竿：软木握把 + 轮座 + 纺车轮 + 6 节逐渐变细的竿身（每节是上一节的子节点，弯曲时逐节累积角度）。 */
export function createRod(tipLocal:THREE.Vector3){
  const root=new THREE.Group(),L=tipLocal.length()
  const blank=new THREE.MeshStandardMaterial({color:0x1d2b28,roughness:.32,metalness:.45})
  const accent=new THREE.MeshStandardMaterial({color:0xa9503c,roughness:.45,metalness:.2})
  const cork=new THREE.MeshStandardMaterial({color:0xb38a5a,roughness:.9})
  const metal=new THREE.MeshStandardMaterial({color:0xd6d0bf,roughness:.25,metalness:.85})
  const align=new THREE.Group();align.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),tipLocal.clone().normalize());root.add(align)
  const handle=new THREE.Mesh(new THREE.CylinderGeometry(.026,.03,.38,14),cork);handle.position.y=-.06;align.add(handle)
  const butt=new THREE.Mesh(new THREE.SphereGeometry(.024,12,8),blank);butt.position.y=-.245;align.add(butt)
  const seat=new THREE.Mesh(new THREE.CylinderGeometry(.016,.016,.07,12),metal);seat.position.y=.15;align.add(seat)
  const reel=new THREE.Group();reel.position.set(0,.15,-.06);align.add(reel)
  const spool=new THREE.Mesh(new THREE.CylinderGeometry(.032,.034,.04,18),metal);spool.rotation.x=Math.PI/2;reel.add(spool)
  const body=new THREE.Mesh(new THREE.CylinderGeometry(.036,.036,.03,18),blank);body.rotation.x=Math.PI/2;body.position.z=.03;reel.add(body)
  const crank=new THREE.Mesh(new THREE.BoxGeometry(.06,.006,.006),metal);crank.position.set(.03,0,.045);reel.add(crank)
  const knob=new THREE.Mesh(new THREE.SphereGeometry(.009,8,6),accent);knob.position.set(.06,0,.045);reel.add(knob)
  // 竿身 6 节：从轮座往上，半径 .014 → .004
  const N=6,segLen=(L-.18)/N,segs:THREE.Group[]=[]
  let parent:THREE.Object3D=align,base=.18
  for(let i=0;i<N;i++){
    const g=new THREE.Group();g.position.y=i===0?base:segLen;parent.add(g)
    const r0=.024-.0028*i,r1=.024-.0028*(i+1)
    const m=new THREE.Mesh(new THREE.CylinderGeometry(r1,r0,segLen,10),blank);m.position.y=segLen/2;g.add(m)
    if(i===0){const wrap=new THREE.Mesh(new THREE.CylinderGeometry(r0+.002,r0+.002,.03,10),accent);wrap.position.y=.02;g.add(wrap)}
    const ring=new THREE.Mesh(new THREE.TorusGeometry(.012-.0013*i,.0018,5,14),metal);ring.rotation.y=Math.PI/2;ring.position.set(0,segLen*.85,-(.014-.0015*i));g.add(ring)
    segs.push(g);parent=g
  }
  const tip=new THREE.Object3D();tip.name='fishing-tip';tip.position.y=segLen;segs[N-1].add(tip)
  const tipBall=new THREE.Mesh(new THREE.SphereGeometry(.012,8,6),accent);tip.add(tipBall)
  let bend=0,side=0,shake=0,clock=0
  return {root,tip,reel,
    /** amount 0..1：弯向鱼线方向（竿头往前下压）；side −1..1 让竿尖左右偏；shake 竿尖抖动幅度 */
    set(amount:number,toward=0,jitter=0){bend=amount;side=toward;shake=jitter},
    tick(dt:number){clock+=dt
      for(let i=0;i<N;i++){const k=(i+1)/N,w=k*k
        segs[i].rotation.x=bend*.32*w+(shake?Math.sin(clock*38+i)*shake*.05*w:0)
        segs[i].rotation.z=-side*bend*.12*w}
    }}
}

function splashTexture(){
  const c=document.createElement('canvas');c.width=c.height=64;const g=c.getContext('2d')!
  const grad=g.createRadialGradient(32,32,2,32,32,30);grad.addColorStop(0,'rgba(255,255,255,.95)');grad.addColorStop(.5,'rgba(230,245,245,.55)');grad.addColorStop(1,'rgba(230,245,245,0)')
  g.fillStyle=grad;g.fillRect(0,0,64,64);const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t
}

/** 水面效果：飞饵弧线、落水 / 试探涟漪、鱼影靠近与逃走、咬钩水花。 */
export function createWaterFx(scene:THREE.Scene){
  const group=new THREE.Group();group.name='fishing-fx';scene.add(group)
  // 飞饵（路亚饵 / 台钓铅坠）
  const lure=new THREE.Mesh(new THREE.SphereGeometry(.09,12,10),new THREE.MeshStandardMaterial({color:0xd8b04a,metalness:.6,roughness:.3,emissive:0x2a1c05}))
  lure.visible=false;group.add(lure)
  // 涟漪：几个可复用的扁圆环
  const rippleGeo=new THREE.RingGeometry(.82,1,40).rotateX(-Math.PI/2)
  const ripples=Array.from({length:6},()=>{const m=new THREE.Mesh(rippleGeo,new THREE.MeshBasicMaterial({color:0xf4fbf8,transparent:true,opacity:0,depthWrite:false,depthTest:false,fog:false}));m.visible=false;m.renderOrder=12;group.add(m);return {m,t:1,dur:1,size:1}})
  // 鱼影：水面下一条深色的拉长椭圆，带尾巴摆动
  const shadowShape=new THREE.Shape();shadowShape.absellipse(0,0,.5,.16,0,Math.PI*2,false,0)
  const tail=new THREE.Shape();tail.moveTo(-.45,0);tail.lineTo(-.78,.16);tail.lineTo(-.72,0);tail.lineTo(-.78,-.16);tail.closePath()
  const shadowGeo=new THREE.ShapeGeometry([shadowShape,tail],12).rotateX(-Math.PI/2)
  const shadow=new THREE.Mesh(shadowGeo,new THREE.MeshBasicMaterial({color:0x0b1c1a,transparent:true,opacity:0,depthWrite:false,depthTest:false,fog:false}))
  shadow.visible=false;shadow.renderOrder=11;group.add(shadow)
  // 水花：一组粒子小精灵
  const splashMat=new THREE.SpriteMaterial({map:splashTexture(),transparent:true,depthWrite:false})
  const drops=Array.from({length:18},()=>{const s=new THREE.Sprite(splashMat.clone());s.visible=false;group.add(s);return {s,v:new THREE.Vector3(),t:1}})
  let pulse:{at:THREE.Vector3,every:number,size:number,t:number}|undefined
  let fly:{from:THREE.Vector3,to:THREE.Vector3,t:number,dur:number,done?:()=>void}|undefined
  let fish:{pos:THREE.Vector3,goal:THREE.Vector3,speed:number,size:number,fade:number,leaving:boolean}|undefined
  const tmp=new THREE.Vector3()
  function ripple(at:THREE.Vector3,size=1,dur=1.1){const r=ripples.find(r=>r.t>=r.dur)??ripples[0];r.m.position.set(at.x,at.y+.06,at.z);r.t=0;r.dur=dur;r.size=size;r.m.visible=true}
  function splash(at:THREE.Vector3,power=1){
    for(const d of drops){d.s.position.set(at.x,at.y+.05,at.z);const a=Math.random()*Math.PI*2,s=(.8+Math.random()*1.6)*power
      d.v.set(Math.cos(a)*s*.6,(1.6+Math.random()*1.8)*power,Math.sin(a)*s*.6);d.t=0;d.s.visible=true;d.s.scale.setScalar(.3+.25*Math.random()*power)}
    ripple(at,1.4*power,1.2);ripple(at,.8*power,.8)
  }
  const sizeScale=(size:string)=>2.2*(({'微型':.35,'小型':.55,'中型':.85,'大型':1.25,'巨型':1.8} as Record<string,number>)[size]??.8)
  return {
    /** 抛竿：饵从竿梢沿抛物线飞到落点，落水时一圈涟漪 */
    cast(from:THREE.Vector3,to:THREE.Vector3,done?:()=>void){const d=from.distanceTo(to);fly={from:from.clone(),to:to.clone(),t:0,dur:.35+d*.022,done};lure.visible=true},
    flying(){return fly?lure.position:undefined},
    approach(target:THREE.Vector3,side:number,size:string){
      const s=sizeScale(size),dir=new THREE.Vector3(side||(Math.random()<.5?-1:1),0,Math.random()-.5).normalize()
      fish={pos:target.clone().addScaledVector(dir,4+2*s),goal:target.clone().addScaledVector(dir,.35*s),speed:1.4,size:s,fade:0,leaving:false}
      shadow.scale.setScalar(s);shadow.visible=true
    },
    /** 咬钩期间持续冒水花圈，直到 stopPulse */
    pulse(target:THREE.Vector3,every=.35,size=1.1){pulse={at:target.clone(),every,size,t:0}},
    stopPulse(){pulse=undefined},
    nibble(target:THREE.Vector3){ripple(target,.45,.7);if(fish)fish.goal.lerp(target,.6)},
    hit(target:THREE.Vector3){splash(target,1);if(fish)fish.goal.copy(target)},
    hooked(target:THREE.Vector3){splash(target,.7)},
    spook(){if(!fish)return;fish.leaving=true;fish.speed=4
      const away=tmp.copy(fish.pos).sub(fish.goal).setY(0);if(away.lengthSq()<1e-4)away.set(1,0,0);fish.goal.copy(fish.pos).addScaledVector(away.normalize(),8)},
    /** 角力中鱼影跟着线头走 */
    follow(p:THREE.Vector3){if(fish&&!fish.leaving){fish.goal.copy(p);fish.speed=3.2}},
    surge(target:THREE.Vector3){ripple(target,.9,.6)},
    landed(target:THREE.Vector3){splash(target,.8);fish=undefined;shadow.visible=false},
    clear(){pulse=undefined;fish=undefined;shadow.visible=false;lure.visible=false;fly=undefined},
    tick(dt:number){
      if(pulse){pulse.t-=dt;if(pulse.t<=0){pulse.t=pulse.every;ripple(pulse.at,pulse.size,.8)}}
      if(fly){fly.t+=dt;const u=Math.min(1,fly.t/fly.dur),h=Math.max(1.5,fly.from.distanceTo(fly.to)*.28)
        lure.position.lerpVectors(fly.from,fly.to,u);lure.position.y+=Math.sin(Math.PI*u)*h
        if(u>=1){ripple(fly.to,.7,.9);const done=fly.done;fly=undefined;lure.visible=false;done?.()}}
      for(const r of ripples){if(r.t>=r.dur){r.m.visible=false;continue}r.t+=dt;const u=r.t/r.dur
        r.m.scale.setScalar(.4+u*r.size*3);(r.m.material as THREE.MeshBasicMaterial).opacity=.55*(1-u)}
      for(const d of drops){if(d.t>=1){d.s.visible=false;continue}d.t+=dt*1.4;d.v.y-=9.8*dt;d.s.position.addScaledVector(d.v,dt)
        ;(d.s.material as THREE.SpriteMaterial).opacity=1-d.t}
      if(fish){
        const to=tmp.copy(fish.goal).sub(fish.pos);to.y=0;const dist=to.length()
        if(dist>.02){fish.pos.addScaledVector(to.normalize(),Math.min(dist,fish.speed*dt));shadow.rotation.y=Math.atan2(-to.z,to.x)}
        fish.fade=Math.min(1,fish.fade+dt*(fish.leaving?-1.2:1.5))
        shadow.position.set(fish.pos.x,fish.pos.y+.05,fish.pos.z)
        ;(shadow.material as THREE.MeshBasicMaterial).opacity=.55*Math.max(0,fish.fade)
        shadow.scale.set(fish.size*(1+Math.sin(performance.now()/90)*.04),1,fish.size)
        if(fish.leaving&&fish.fade<=0){fish=undefined;shadow.visible=false}
      }
    },
  }
}
