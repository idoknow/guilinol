import {S3Client,ListObjectsV2Command,HeadObjectCommand,GetObjectCommand,PutObjectCommand} from '@aws-sdk/client-s3'

const Bucket='glol-feedback'
const source=new S3Client({region:'auto',endpoint:`https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,credentials:{accessKeyId:process.env.R2_ACCESS_KEY_ID,secretAccessKey:process.env.R2_SECRET_ACCESS_KEY}})
const destination=new S3Client({region:'us-east-1',endpoint:process.env.S3_ENDPOINT,forcePathStyle:true})
if(!process.env.S3_ENDPOINT || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY || !/^[a-f0-9]{32}$/.test(process.env.CLOUDFLARE_ACCOUNT_ID)) throw Error('Missing scoped R2 source or MinIO target')
async function inventory(client) {
  const objects=new Map(); let ContinuationToken
  do {
    const page=await client.send(new ListObjectsV2Command({Bucket,ContinuationToken}))
    for(const item of page.Contents||[]) objects.set(item.Key,item)
    ContinuationToken=page.NextContinuationToken
  } while(ContinuationToken)
  return objects
}
const objects=await inventory(source),existing=await inventory(destination)
for(const key of existing.keys()) if(!objects.has(key)) throw Error('Target has extra objects; reconcile before retrying. No objects deleted.')
let copied=0
for(const [Key,item] of objects) {
  if(existing.get(Key)?.Size===item.Size) {
    const head=await destination.send(new HeadObjectCommand({Bucket,Key}))
    if(head.Metadata?.['source-etag']===item.ETag.replaceAll('"',''))continue
  }
  const data=await source.send(new GetObjectCommand({Bucket,Key,IfMatch:item.ETag}))
  await destination.send(new PutObjectCommand({Bucket,Key,Body:data.Body,ContentLength:item.Size,ContentType:data.ContentType,Metadata:{...data.Metadata,'source-etag':item.ETag.replaceAll('"','')}}));copied++
}
const check=await inventory(destination),fresh=await inventory(source)
const bytes=map=>[...map.values()].reduce((sum,item)=>sum+item.Size,0)
if(check.size!==fresh.size || [...fresh].some(([key,item])=>objects.get(key)?.ETag!==item.ETag || check.get(key)?.Size!==item.Size)) throw Error('Source changed or target inventory differs; repeat before cutover')
console.log({copied,source:{objects:fresh.size,bytes:bytes(fresh)},target:{objects:check.size,bytes:bytes(check)}})
