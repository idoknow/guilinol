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
      for(let index=0;index<64;index++) block[index]+=140*basis[freq][index]
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
  return verifyVotes(votes,key)
}

function verifyVotes(votes,key) {
  const record=Buffer.alloc(32)
  for(let bit=0;bit<256;bit++) if(votes[bit]>0) record[bit>>3]|=1<<(7-bit%8)
  const payload=record.subarray(0,13), result=unpackTrace(payload)
  return result && timingSafeEqual(signature(payload,key),record.subarray(13)) ? result : null
}

export function decodePeriodic(gray,width,height,key){
  const periodX=128,periodY=32
  if(width<periodX||height<periodY)return null
  const folded=new Float64Array(periodX*periodY), counts=new Uint32Array(folded.length)
  for(let row=0;row<height;row++)for(let col=0;col<width;col++){
    const index=(row%periodY)*periodX+col%periodX
    folded[index]+=gray[row*width+col];counts[index]++
  }
  for(let index=0;index<folded.length;index++)folded[index]/=counts[index]
  for(let phaseY=0;phaseY<8;phaseY++)for(let phaseX=0;phaseX<8;phaseX++){
    const coefficients=new Float64Array(256)
    for(let top=0;top<periodY;top+=8)for(let left=0;left<periodX;left+=8){
      for(let freq=0;freq<4;freq++){
        let sum=0
        for(let index=0;index<64;index++)sum+=basis[freq][index]*folded[((phaseY+top+(index>>3))%periodY)*periodX+(phaseX+left+index%8)%periodX]
        coefficients[slot(left,top,freq)]=sum
      }
    }
    const ordered=Array.from(coefficients,Math.abs).sort((first,second)=>first-second)
    const level=ordered[192];if(level<.25)continue
    for(let shiftY=0;shiftY<4;shiftY++)for(let shiftX=0;shiftX<16;shiftX++){
      const votes=new Float64Array(256)
      for(let bit=0;bit<256;bit++){
        const source=(((bit>>6)+shiftY)%4)*64+((((bit>>2)%16)+shiftX)%16)*4+bit%4
        votes[bit]=Math.abs(coefficients[source])-level*.5
        if(bit<24 && (votes[bit]>0)!==Boolean(bitAt(header,bit)))break
        if(bit===255){const result=verifyVotes(votes,key);if(result)return result}
      }
    }
  }
  return null
}
const header=Buffer.from([0x47,0x4c,8])
