import {createHmac, timingSafeEqual} from 'node:crypto'
import {packTrace, unpackTrace} from './trace-payload.mjs'

const basis = [[1,1],[1,2],[2,1],[2,2]].map(([horizontal,vertical]) =>
  Float64Array.from({length:64}, (_,index) => .25*Math.cos(Math.PI*horizontal*((index%8)+.5)/8)*Math.cos(Math.PI*vertical*((index>>3)+.5)/8)))
const signature = (payload,key) => createHmac('sha256',key).update('GL-QIM-v1:').update(payload).digest().subarray(0,19)
const slot = (left,top,frequency) => ((((top>>3)%8)*16+(left>>3)%16)*4+frequency)%256
const bitAt = (bytes,bit) => (bytes[bit>>3]>>(7-bit%8))&1

export function encodeTile(uid,seconds,key) {
  const payload=packTrace(uid,seconds), record=Buffer.concat([payload,signature(payload,key)])
  const gray=Buffer.alloc(512*512,128)
  for(let top=0;top<512;top+=8) for(let left=0;left<512;left+=8) {
    const block=new Float64Array(64).fill(128)
    for(let freq=0;freq<4;freq++) if(bitAt(record,slot(left,top,freq))) {
      for(let index=0;index<64;index++) block[index]+=20*basis[freq][index]
    }
    if(block.some(value=>value<0||value>255)) continue
    for(let index=0;index<64;index++) gray[(top+(index>>3))*512+left+index%8]=Math.round(block[index])
  }
  return gray
}

export function decodeGray(gray,width,height,key) {
  const votes=new Float64Array(256)
  for(let top=0;top+8<=height;top+=8) for(let left=0;left+8<=width;left+=8) {
    for(let freq=0;freq<4;freq++) {
      let coefficient=0
      for(let index=0;index<64;index++) coefficient+=basis[freq][index]*gray[(top+(index>>3))*width+left+index%8]
      const value=coefficient/20, rounded=Math.round(value)
      votes[slot(left,top,freq)]+=(rounded&1?1:-1)*(1-2*Math.abs(value-rounded))
    }
  }
  const record=Buffer.alloc(32)
  for(let bit=0;bit<256;bit++) if(votes[bit]>0) record[bit>>3]|=1<<(7-bit%8)
  const payload=record.subarray(0,13), result=unpackTrace(payload)
  return result && timingSafeEqual(signature(payload,key),record.subarray(13)) ? result : null
}
