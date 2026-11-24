import {gzipSync,gunzipSync} from 'node:zlib'

export function withFixtureBays(data,bays){
  const result={...data}
  for(const key of ['mask','motorMask']){
    const [left,top,width,,step]=key==='mask'?data.grid:data.motorGrid
    const source=Buffer.from(data[key],'base64')
    const bits=data.maskEncoding==='gzip'?gunzipSync(source):source
    for(const [east,,south] of bays){
      const index=Math.round((south-top)/step)*width+Math.round((east-left)/step),bit=128>>(index&7)
      if(key==='mask')bits[index>>3]|=bit;else bits[index>>3]&=~bit
    }
    result[key]=(data.maskEncoding==='gzip'?gzipSync(bits):bits).toString('base64')
  }
  return result
}
