import {ll2xz} from '../../lib/projection'

type Point={x:number,z:number}
type Host={ready:()=>boolean,inside:(p:Point)=>boolean,land:(p:Point,yaw:number|undefined,signal:AbortSignal)=>Promise<boolean>,
  position:()=>Point,drive:(x:number,z:number)=>void,release:()=>void,face:(yaw:number)=>void}
export const geoUI=new EventTarget()
export let geoStatus='尚未请求定位权限', geoActive=false
export let requestGeo:(follow:boolean)=>void=()=>report('请先进入步行模式')
function report(message:string){geoStatus=message;geoUI.dispatchEvent(new Event('change'))}

export function installGeolocation(host:Host){
  let session:AbortController|undefined, watch:number|undefined, target:Point|undefined
  let landing=false, driving=false, lastTime=0
  function release(){target=undefined;if(driving){host.release();driving=false}}
  function stop(message:string){
    session?.abort();session=undefined
    if(watch!==undefined)navigator.geolocation.clearWatch(watch)
    watch=undefined;landing=false;geoActive=false;lastTime=0;release();report(message)
  }
  requestGeo=follow=>{
    if(session){stop('定位已停止');return}
    if(!host.ready())return report('请关闭其他模式，下车或离船后步行再定位')
    if(!window.isSecureContext)return report('请用 HTTPS 打开游戏后定位')
    if(!navigator.geolocation)return report('浏览器不支持定位，请换用系统浏览器')
    const controller=session=new AbortController(), {signal}=controller
    geoActive=true;report('正在定位，请允许浏览器访问位置…')
    document.addEventListener('visibilitychange',()=>{if(document.hidden)stop('已转入后台，定位已停止')},{signal})
    window.addEventListener('pagehide',()=>stop('定位已停止'),{signal})
    let previous:Point|undefined, offset:Point={x:0,z:0}
    function rejectFix(message:string){release();if(follow)report(message);else stop(message)}
    async function receive(position:GeolocationPosition){
      if(signal.aborted||landing)return
      if(!host.ready())return stop('模式已切换，定位已停止')
      const {latitude,longitude,accuracy,heading,speed}=position.coords, time=position.timestamp
      if(!Number.isFinite(time)||Date.now()-time>15000||time>Date.now()+1000)return rejectFix('定位过期，请重新定位')
      if(time<=lastTime||time-lastTime<800)return
      if(!Number.isFinite(accuracy)||accuracy<=0||accuracy>35)return rejectFix('精度不足，请到开阔处重试')
      const point=ll2xz(latitude,longitude)
      if(!Number.isFinite(point.x)||!Number.isFinite(point.z)||!host.inside(point))return stop('当前位置不在桂林游戏地图范围内')
      const yaw=heading!==null&&Number.isFinite(heading)&&heading>=0&&heading<360?-heading*Math.PI/180:undefined
      const distance=previous?Math.hypot(point.x-previous.x,point.z-previous.z):0
      if((speed!==null&&speed>5)||distance>Math.min(40,5*(time-lastTime)/1000+3))return rejectFix('定位跳点或速度异常，已忽略')
      if(!previous){
        landing=true
        try{
          const ok=await host.land(point,yaw,signal)
          if(signal.aborted)return
          if(!ok)return stop('未落地：已取消或附近没有可走地面')
          const actual=host.position();offset={x:actual.x-point.x,z:actual.z-point.z}
          const snap=`吸附 ${Math.hypot(offset.x,offset.z).toFixed(1)} 米`
          if(!follow)return stop(`定位成功，${snap}`)
          report(`跟随定位中，${snap}`)
        }catch{if(!signal.aborted)stop('落点加载失败，请重试');return}
        finally{if(!signal.aborted)landing=false}
      }else{
        if(distance<Math.max(1.5,accuracy*.35)){report('跟随定位中');return}
        target={x:point.x+offset.x,z:point.z+offset.z}
        host.face(yaw??Math.atan2(previous.x-point.x,previous.z-point.z));report('跟随定位中')
      }
      previous=point;lastTime=time
    }
    try{watch=navigator.geolocation.watchPosition(receive,error=>{
      if(!signal.aborted)stop(error.code===1?'定位权限被拒绝，请在网站权限中允许定位':error.code===3?'定位超时，请到开阔处重试':'设备位置不可用，请开启系统定位')
    },{enableHighAccuracy:true,timeout:12000,maximumAge:1000})}catch{stop('无法请求定位，请检查网站权限')}
  }
  return ()=>{
    if(!session||landing)return
    if(!host.ready())return stop('游戏已暂停或模式已切换，定位已停止')
    if(!target)return
    if(Date.now()-lastTime>15000){release();return report('等待新定位，已暂停移动')}
    const pos=host.position(), dx=target.x-pos.x,dz=target.z-pos.z,distance=Math.hypot(dx,dz)
    if(distance<.45)return release()
    const scale=1/Math.max(1.5,distance);host.drive(dx*scale,dz*scale);driving=true
  }
}
