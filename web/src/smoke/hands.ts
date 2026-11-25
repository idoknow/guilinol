import * as T from 'three'
import {fingerPose} from '../walk/ebike-grip'

// Coordinates in millimetres relative to the box, lighter, or pinch contact.
// Each row locates the knuckle, hinge and fingertip. The wrist and palm share
// the same frame as the fingers, including while the prop rotates.
type Point = [number,number,number]
type Digit = [Point,Point,Point]
interface Pose {
  wrist:Point
  digits:Digit[]
}

const box:Pose = {
  wrist:[-38,-40,-23],
  digits:[
    [[-28,6,-20],[-37,12,9],[-20,16,17]],
    ...[16,4,-8,-19].map((y,i):Digit=>[[14,y,-24],[34,y+2,-17],[34,y+3,9-i*2]]),
  ],
}
const lighter:Pose = {
  wrist:[-44,-43,24],
  digits:[
    [[-23,3,16],[-19,30,6],[-2,31,1]],
    ...[12,1,-10,-20].map((y,i):Digit=>[[9,y,21],[19,y,10],[18,y+1,-6+i]]),
  ],
}
const pinch:Pose = {
  wrist:[105,19,24],
  digits:[
    [[40,13,15],[23,-3,12],[2.8,0,1]],
    [[40,38,-5],[10,31,-4],[-2.8,1,-1]],
    [[43,32,-14],[25,17,-20],[41,11,-13]],
    [[52,26,-17],[35,11,-21],[49,8,-12]],
    [[60,21,-16],[46,9,-18],[58,6,-10]],
  ],
}
// The two extended fingers straddle the filter. Keep the wrist outside and
// forward of the cheek while the thumb and the last two fingers stay curled.
const puff:Pose={
  wrist:[106,-88,-91],
  digits:[
    pinch.digits[0],
    [[40,-10,-32],[16,9,-23],[1,4,0]],
    [[43,-25,-38],[19,-10,-26],[1,-4,0]],
    pinch.digits[3],
    [[46,-45,-48],[35,-54,-43],[45,-53,-36]],
  ],
}
const poses={box,lighter,pinch,puff}
const digits=['thumb','index','middle','ring','pinky']
function basis(along:T.Vector3,across:T.Vector3){
  const x=along.normalize(),z=new T.Vector3().crossVectors(x,across).normalize()
  return new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(x,new T.Vector3().crossVectors(z,x),z))
}
export function smokingHand(figure:T.Object3D,side:'l'|'r'){
  const bone=(name:string)=>figure.getObjectByName(name+'_'+side)
  const wrist=bone('hand'),elbow=bone('lowerarm'),shoulder=bone('upperarm')
  if(!wrist||!elbow||!shoulder)return
  const fingers=digits.map(id=>['01','02','03','04_leaf'].map(n=>bone(id+'_'+n)))
  if(!fingers.every(chain=>chain.every(Boolean)))return
  const chains=fingers as T.Object3D[][]
  const arm=[shoulder,elbow,wrist]
  const joints=[...arm,...chains.flatMap(chain=>chain.slice(0,3))]
  const base=joints.map(()=>new T.Quaternion())
  let applied=false
  const curl=fingerPose(figure,side,side==='l'?-1:1)
  const a=new T.Vector3(),b=new T.Vector3(),pivot=new T.Vector3(),goal=new T.Vector3()
  const rotation=new T.Quaternion(),parent=new T.Quaternion(),inverse=new T.Quaternion()
  const knuckles=chains.map(chain=>wrist.worldToLocal(chain[0].getWorldPosition(new T.Vector3())))
  const middleLocal=knuckles[2]
  const localBasis=basis(middleLocal.clone(),knuckles[1].clone().sub(knuckles[4])).invert()
  const attachment=new T.Group()
  attachment.name='smoke-grip-'+side
  wrist.add(attachment)
  function aim(joint:T.Object3D,end:T.Object3D,destination:T.Vector3){
    joint.getWorldPosition(pivot)
    a.subVectors(end.getWorldPosition(a),pivot)
    b.subVectors(destination,pivot)
    if(a.lengthSq()<1e-12||b.lengthSq()<1e-12)return
    a.normalize();b.normalize()
    rotation.setFromUnitVectors(a,b)
    joint.parent!.getWorldQuaternion(parent)
    joint.quaternion.premultiply(rotation.premultiply(inverse.copy(parent).invert()).multiply(parent))
  }
  const start=new T.Vector3(),axis=new T.Vector3(),bend=new T.Vector3(),jointTarget=new T.Vector3()
  // Bend towards the authored hinge while preserving segment lengths and the
  // native finger plane. The last two phalanges share the remaining curl.
  function aimHinge(joint:T.Object3D,child:T.Object3D,tip:T.Vector3,pole:T.Vector3,remaining:number){
    joint.getWorldPosition(start)
    const proximal=start.distanceTo(child.getWorldPosition(a))
    if(proximal<1e-6)return
    axis.subVectors(tip,start)
    if(axis.lengthSq()<1e-12)return
    const distance=T.MathUtils.clamp(axis.length(),Math.abs(proximal-remaining)+1e-6,proximal+remaining-1e-6)
    axis.normalize()
    bend.subVectors(pole,start).addScaledVector(axis,-bend.dot(axis))
    if(bend.lengthSq()<1e-9)bend.subVectors(a,start).addScaledVector(axis,-bend.dot(axis))
    if(bend.lengthSq()<1e-12)return
    const along=(distance*distance+proximal*proximal-remaining*remaining)/(2*distance)
    jointTarget.copy(start).addScaledVector(axis,along).addScaledVector(bend.normalize(),Math.sqrt(Math.max(0,proximal*proximal-along*along)))
    aim(joint,child,jointTarget)
  }
  function reset(){
    if(applied)joints.forEach((j,i)=>j.quaternion.copy(base[i]))
    applied=false
  }
  function apply(name:keyof typeof poses,frame:T.Object3D,blend=1){
    const weight=T.MathUtils.clamp(blend,0,1)
    if(weight<=0){reset();return}
    if(applied)reset()
    joints.forEach((j,i)=>base[i].copy(j.quaternion))
    applied=true
    const pose=poses[name],point=(p:Point)=>frame.localToWorld(new T.Vector3(...p).multiplyScalar(.001))
    const middle=point(pose.digits[2][0])
    const wanted=basis(middle.clone().sub(point(pose.wrist)),point(pose.digits[1][0]).sub(point(pose.digits[4][0]))).multiply(localBasis)
    goal.copy(middle).sub(middleLocal.clone().multiply(wrist!.getWorldScale(a)).applyQuaternion(wanted))
    const forearm=elbow!.getWorldPosition(a).distanceTo(wrist!.getWorldPosition(b))
    const pole=shoulder!.getWorldPosition(new T.Vector3())
    pole.y-=.45
    aimHinge(shoulder!,elbow!,goal,pole,forearm)
    aim(elbow!,wrist!,goal)
    wrist!.quaternion.copy(wrist!.parent!.getWorldQuaternion(parent).invert().multiply(wanted))
    for(const {joint,rotation} of curl)joint.quaternion.copy(rotation)
    chains.forEach((chain,i)=>{
      if(name==='pinch'&&i>1 || name==='puff'&&i!==1&&i!==2)return
      const [,hinge,pad]=pose.digits[i],end=chain[3]
      const pole=point(hinge),tip=point(pad)
      const distal=chain[2].getWorldPosition(a).distanceTo(end.getWorldPosition(b))
      const medial=chain[1].getWorldPosition(a).distanceTo(chain[2].getWorldPosition(b))
      aimHinge(chain[0],chain[1],tip,pole,(medial+distal)*.95)
      aimHinge(chain[1],chain[2],tip,pole,distal)
      aim(chain[2],end,tip)
    })
    if(weight<1)joints.forEach((j,i)=>j.quaternion.slerp(base[i],1-weight))
  }
  return {apply,reset,attachment,dispose(){reset();attachment.removeFromParent()}}
}
