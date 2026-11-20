import {createHash} from 'node:crypto'
import {readFile,realpath} from 'node:fs/promises'
import {resolve,sep} from 'node:path'
import {S3Client,ListObjectsV2Command,GetObjectCommand,PutObjectCommand,HeadBucketCommand,CreateBucketCommand} from '@aws-sdk/client-s3'

const Bucket='glol-feedback', base=resolve(process.argv[2],'r2'),root=await realpath(resolve(base,'objects'))
const manifest=JSON.parse(await readFile(resolve(base,'manifest.json'),'utf8'))
const objects=new Map(manifest.objects.map(item=>[item.key,item]))
const bytes=[...objects.values()].reduce((sum,item)=>sum+item.size,0)
if(manifest.bucket!==Bucket || objects.size!==manifest.objects.length || objects.size!==manifest.count || bytes!==manifest.bytes) throw Error('Invalid snapshot inventory')
const digest=data=>createHash('sha256').update(data).digest('hex')
async function load(item){
  const path=await realpath(resolve(root,item.key))
  if(!path.startsWith(root+sep)) throw Error('Object outside export')
  const data=await readFile(path)
  if(data.length!==item.size || digest(data)!==item.sha256) throw Error('Source digest mismatch')
  return data
}
for(const item of objects.values()) await load(item)
if(process.argv.includes('--check-only')){ console.log({objects:objects.size,bytes}); process.exit(0) }
if(!process.env.S3_ENDPOINT || !['127.0.0.1','localhost'].includes(new URL(process.env.S3_ENDPOINT).hostname)) throw Error('Expected loopback tunnel to glol-minio')
const client=new S3Client({region:'us-east-1',endpoint:process.env.S3_ENDPOINT,forcePathStyle:true})
try{await client.send(new HeadBucketCommand({Bucket}))}catch(error){if(error.$metadata?.httpStatusCode!==404)throw error;await client.send(new CreateBucketCommand({Bucket}))}
async function inventory(){
  const result=new Map(); let ContinuationToken
  do{
    const page=await client.send(new ListObjectsV2Command({Bucket,ContinuationToken}))
    for(const item of page.Contents||[])result.set(item.Key,item.Size)
    ContinuationToken=page.NextContinuationToken
  }while(ContinuationToken)
  return result
}
async function matches(Key,item){
  const response=await client.send(new GetObjectCommand({Bucket,Key}))
  return digest(await response.Body.transformToByteArray())===item.sha256 && response.ContentType===item.contentType
}
const before=await inventory(); let copied=0
for(const key of before.keys())if(!objects.has(key))throw Error('Extra target object; no objects removed')
for(const [Key,item] of objects){
  if(before.get(Key)===item.size && await matches(Key,item))continue
  await client.send(new PutObjectCommand({Bucket,Key,Body:await load(item),ContentType:item.contentType}));copied++
  if(!await matches(Key,item))throw Error('Target readback mismatch')
}
const after=await inventory()
if(after.size!==objects.size || [...objects].some(([key,item])=>after.get(key)!==item.size))throw Error('Target inventory mismatch')
console.log({objects:after.size,bytes,copied})
