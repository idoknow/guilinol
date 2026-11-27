import {creatorStage} from '../ui/creator-stage'
import { readJson } from '../lib/json'

export async function updatePortrait(){
  const response=await fetch('/api/me/avatar')
  if(!response.ok)throw Error('暂时无法读取角色')
  const {avatar}=await readJson(response)
  if(!avatar)throw Error('请先创建角色')
  const host=document.createElement('div')
  host.style.cssText='position:fixed;left:-500px;top:0;width:192px;height:192px;pointer-events:none'
  document.body.append(host)
  let stage:ReturnType<typeof creatorStage>|undefined
  try{
    stage=creatorStage(host,true,true);await stage.apply(avatar);stage.frameHead(true,0.955);stage.angle(0.35)
    await new Promise(resolve=>setTimeout(resolve,900))
    const square=document.createElement('canvas');square.width=square.height=192
    square.getContext('2d')!.drawImage(host.querySelector('canvas')!,0,0,192,192)
    const photo=await new Promise<Blob|null>(resolve=>square.toBlob(resolve,'image/webp',0.88))
    if(photo?.type!=='image/webp'||photo.size>65536)throw Error('无法生成卡面头像')
    const upload=await fetch('/api/citizen/photo',{method:'POST',body:photo})
    if(!upload.ok)throw Error(upload.status===429?'更新太频繁，请稍后再试':'头像上传失败')
  }finally{stage?.dispose();host.remove()}
}
