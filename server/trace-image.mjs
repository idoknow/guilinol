import sharp from 'sharp'
import {decodeGray,decodePeriodic} from './trace-qim.mjs'

export async function decodeImage(data,width,height,key){
  const direct=decodeGray(data,width,height,key)
  if(direct)return direct
  const quiet=decodePeriodic(data,width,height,key,true)??decodePeriodic(data,width,height,key,false,true);if(quiet)return quiet
  if(width>=256&&height>=256){
    for(const [left,top] of [[0,0],[width-256,0],[0,height-256],[width-256,height-256]]){
      const region=Buffer.alloc(256*256)
      for(let row=0;row<256;row++)region.set(data.subarray((top+row)*width+left,(top+row)*width+left+256),row*256)
      const result=decodePeriodic(region,256,256,key);if(result)return result
    }
  }
  for(const scale of [1,.75,.5,2,4]){
    const cropWidth=Math.min(width,Math.floor(1024*scale)),cropHeight=Math.min(height,Math.floor(768*scale))
    if(cropWidth<128*scale||cropHeight<32*scale)continue
    if(scale<1){
      const cols=Math.floor(cropWidth/scale),rows=Math.floor(cropHeight/scale),upsampled=new Float32Array(rows*cols)
      for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
        const sx=Math.max(0,(col+.5)*scale-.5),sy=Math.max(0,(row+.5)*scale-.5),left=Math.floor(sx),top=Math.floor(sy),right=Math.min(left+1,width-1),bottom=Math.min(top+1,height-1),dx=sx-left,dy=sy-top
        upsampled[row*cols+col]=(1-dy)*((1-dx)*data[top*width+left]+dx*data[top*width+right])+dy*((1-dx)*data[bottom*width+left]+dx*data[bottom*width+right])
      }
      const result=decodePeriodic(upsampled,cols,rows,key)??decodePeriodic(upsampled,cols,rows,key,false,true)??decodePeriodic(upsampled,cols,rows,key,true);if(result)return result
    }
    const image=await sharp(data,{raw:{width,height,channels:1}}).extract({left:0,top:0,width:cropWidth,height:cropHeight}).resize(Math.round(cropWidth/scale),Math.round(cropHeight/scale),{fit:'fill',kernel:'nearest'}).greyscale().raw().toBuffer({resolveWithObject:true})
    const result=decodePeriodic(image.data,image.info.width,image.info.height,key)??decodePeriodic(image.data,image.info.width,image.info.height,key,false,true)??decodePeriodic(image.data,image.info.width,image.info.height,key,true)
    if(result)return result
  }
  return null
}
