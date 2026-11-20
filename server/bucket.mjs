import {S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand} from '@aws-sdk/client-s3'

export function bucket(endpoint, Bucket = 'glol-feedback') {
  const client = new S3Client({endpoint, region:'us-east-1', forcePathStyle:true})
  return {
    async get(Key) {
      try {const object = await client.send(new GetObjectCommand({Bucket, Key})); return {body: object.Body.transformToWebStream()}}
      catch (error) {if (error.$metadata?.httpStatusCode === 404) return null; throw error}
    },
    async put(Key, data) {
      const Body = data instanceof ReadableStream ? new Uint8Array(await new Response(data).arrayBuffer()) : new Uint8Array(data)
      await client.send(new PutObjectCommand({Bucket, Key, Body}))
    },
    async delete(keys) {for (const Key of [].concat(keys)) await client.send(new DeleteObjectCommand({Bucket, Key}))}
  }
}
