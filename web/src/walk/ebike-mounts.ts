import * as T from 'three'
import type {StaticBikeVisualOptions} from './vehicle-model'

export const cowlLamp = {y:1.106,z:-.448}
export const steeringZ = -.43

export function accessories(cfg: StaticBikeVisualOptions, paint:number, emit:(joint:'front'|'body'|'glow',geometry:T.BufferGeometry,color:number,alpha:number)=>void){
  type Mount = Parameters<typeof emit>[0]
  function box(joint:Mount,color:number,w:number,h:number,d:number,x:number,y:number,z:number,tilt=0,alpha=1){
    emit(joint,new T.BoxGeometry(w,h,d).rotateX(tilt).translate(x,y,z),color,alpha)
  }
  const dark=0x2b2e32, metal=0xb6bec4
  if(cfg.headlightTier){
    box('front',dark,cfg.headlightTier===2?.20:.16,.07,.028,0,cowlLamp.y,cowlLamp.z)
    for(const side of [-1,1])box('front',0xfff3d4,.052,.042,.018,side*.053,cowlLamp.y,cowlLamp.z-.022)
  }
  if(cfg.angelEye)emit('front',new T.TorusGeometry(.057,.009,6,16).translate(0,cowlLamp.y,cowlLamp.z-.019),cfg.angelEyeColor??0x6ce8ff,1)
  if(cfg.windshield && cfg.windshield!=='none'){
    const clear=cfg.windshield==='clear',height=clear?.34:.25
    for(const side of [-1,1])box('front',dark,.018,.13,.02,side*.091,1.18,-.345,-.15)
    box('front',clear?0xc2e0ec:0x16202a,.34,height,.024,0,1.20+height*.43,-.347,-.22,clear?.48:.78)
  }
  if(cfg.topbox && cfg.topbox!=='none'){
    const delivery=cfg.topbox==='delivery',height=delivery?.39:.26,width=delivery?.42:.36
    box('body',dark,width,.038,.32,0,.712,.75)
    box('body',delivery?0xd99b2a:dark,width,height,.34,0,.727+height/2,.75)
    box('body',delivery?dark:paint,width+.012,.026,.35,0,.727+height,.75)
  }
  if(cfg.tailWing){
    for(const side of [-1,1])box('body',paint,.026,.10,.06,side*.108,.704,.817,-.32)
    box('body',cfg.angelEyeColor??paint,.46,.028,.10,0,.752,.894,-.15)
  }
  if(cfg.goldShock)for(const side of [-1,1])emit('body',new T.CylinderGeometry(.027,.026,.18,8).rotateX(-.563).translate(side*.118,.394,.482),0xe3b23c,1)
  if(cfg.exhaust){
    box('body',dark,.09,.028,.10,.135,.294,.48)
    emit('body',new T.CylinderGeometry(.042,.035,.40,10).rotateX(Math.PI/2-.12).translate(.175,.292,.51),metal,1)
    emit('body',new T.CylinderGeometry(.039,.042,.045,10).rotateX(Math.PI/2-.12).translate(.175,.318,.722),dark,1)
  }
  if(cfg.underglow)for(const side of [-1,1])box('glow',cfg.underglowColor??0x20d6c1,.020,.017,.46,side*.144,.164,-.025)
}
