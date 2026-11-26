import {execFileSync} from 'node:child_process'
import {parseArgs} from 'node:util'
import {validCard,slugPattern} from '../lib/update-card.mjs'

const {values}=parseArgs({options:{...Object.fromEntries(['kind','title','summary','how','release','slug','deactivate'].map(name=>[name,{type:'string'}])),image:{type:'string',multiple:true},list:{type:'boolean'},'dry-run':{type:'boolean'}}})
const base=process.env.UPDATE_CARD_ORIGIN,token=process.env.UPDATE_CARD_TOKEN
async function api(method,suffix='',body){
  if(!base||!token)throw Error('Set UPDATE_CARD_ORIGIN and UPDATE_CARD_TOKEN')
  const url=new URL(`/api/admin/updates${suffix}`,base)
  if(url.protocol!=='https:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw Error('HTTPS required')
  const response=await fetch(url,{method,redirect:'error',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:body&&JSON.stringify(body)})
  if(!response.ok)throw Error(`HTTP ${response.status}: ${await response.text()}`)
  console.log(JSON.stringify(await response.json(),null,2))
}
function convert(path){
  return execFileSync('python3',['-c',`
from PIL import Image,ImageOps
import sys,io
with Image.open(sys.argv[1]) as source:
 im=ImageOps.exif_transpose(source).convert('RGBA')
 im.thumbnail((1280,2560),Image.Resampling.LANCZOS)
 while True:
  for quality in (84,70,54):
   out=io.BytesIO(); im.save(out,format='WEBP',quality=quality)
   if out.tell()<=307200:
    sys.stdout.buffer.write(out.getvalue()); sys.exit(0)
  im.thumbnail((max(1,im.width*3//4),max(1,im.height*3//4)),Image.Resampling.LANCZOS)
`,path])
}
if(values.list||values.deactivate){
  if(values.list&&values.deactivate||values['dry-run'])throw Error('Choose one operation')
  if(values.deactivate&&!slugPattern.test(values.deactivate))throw Error('Invalid slug')
  await api(values.list?'GET':'POST',values.list?'':`/${values.deactivate}/deactivate`)
}else{
  const card={slug:values.slug??`${values.kind}-${values.release}`,kind:values.kind,title:values.title,summary:values.summary,how_to:values.how,release_sha:values.release,images:values.image}
  if(!validCard(card))throw Error('Invalid card fields or image count; see docs/update-cards.md')
  const files=card.images.map(convert)
  if(values['dry-run'])console.log({...card,bytes:files.map(file=>file.length)})
  else await api('POST','',{...card,images:files.map(file=>file.toString('base64'))})
}
