import sharp from 'sharp'
import {encodeTile} from '../server/trace-qim.mjs'
import {decodeImage} from '../server/trace-image.mjs'

const width=1280,height=776,key='synthetic-fixtures',seconds=1800000000
const results=new Map()
for(let sample=0;sample<5;sample++){
  const uid=60000+sample,tile=encodeTile(uid,seconds,key)
  for(const mode of ['tile','scene4','light4','unmarked']){
    const data=Buffer.alloc(width*height)
    for(let row=0;row<height;row++)for(let col=0;col<width;col++){
      const mark=tile[(row%512)*512+col%512]
      const scene=mode==='light4'?245:128+42*Math.sin(col*.061+sample)+39*Math.cos(row*.029)+25*Math.sin(row*.171+col*.092)
      data[row*width+col]=Math.round(mode==='tile'?mark:mode==='unmarked'?scene:.96*scene+.04*mark)
    }
    const make=()=>sharp(data,{raw:{width,height,channels:1}})
    for(const [name,pipeline] of Object.entries({clean:make(),jpeg70:make().jpeg({quality:70}),scale75:make().resize(960,582),scale50:make().resize(640,388),crop:make().extract({left:37,top:19,width:850,height:512}),bright:make().linear(1,12),block16:make().resize(2560,1552),block32:make().extract({left:0,top:0,width:320,height:194}).resize(1280,776)})){
      const encoded=await (name==='jpeg70'?pipeline:pipeline.png()).toBuffer()
      const {data:gray,info}=await sharp(encoded).greyscale().raw().toBuffer({resolveWithObject:true})
      const result=await decodeImage(gray,info.width,info.height,key),row=mode+'/'+name
      results.set(row,(results.get(row)||0)+Number(mode==='unmarked'?!result:result?.uid===uid&&result.from===seconds))
    }
  }
}
console.table(Object.fromEntries([...results].map(([key,value])=>[key,`${value}/5`])))
