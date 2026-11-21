import {execFileSync} from 'node:child_process'
import {randomUUID} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {setTimeout as delay} from 'node:timers/promises'
import pg from 'pg'
import {S3Client,CreateBucketCommand} from '@aws-sdk/client-s3'

export async function fixture({postgresOnly=false}={}) {
  const ids = [], secret = randomUUID(), credentials = {accessKeyId:'gloltest',secretAccessKey:secret}
  const docker = args => execFileSync('docker',args,{encoding:'utf8'}).trim()
  function service(port,args) {
    const id = docker(['run','-d','--rm','-p',`127.0.0.1::${port}`,...args]); ids.push(id)
    return docker(['port',id,`${port}/tcp`]).split(':').at(-1)
  }
  let pool
  async function close() {await pool?.end(); for (const id of ids) docker(['stop','-t','1',id])}
  try {
    const port = service(5432,['-e',`POSTGRES_PASSWORD=${secret}`,'-e','POSTGRES_DB=glol','postgres:16-alpine'])
    const objectPort = postgresOnly ? 0 : service(9000,['-e','MINIO_ROOT_USER=gloltest','-e',`MINIO_ROOT_PASSWORD=${secret}`,process.env.TEST_MINIO_IMAGE || 'cgr.dev/chainguard/minio:latest','server','/tmp/glol'])
    const DATABASE_URL = `postgres://postgres:${secret}@127.0.0.1:${port}/glol`, S3_ENDPOINT=`http://127.0.0.1:${objectPort}`
    pool = new pg.Pool({connectionString:DATABASE_URL})
    for(let attempt=0;;attempt++) {try {await pool.query('SELECT 1'); if (postgresOnly || (await fetch(S3_ENDPOINT+'/minio/health/ready')).ok) break} catch {} if(attempt>=100) throw Error('Test services not ready'); await delay(300)}
    await pool.query(await readFile('deploy/postgres/001-schema.sql','utf8'))
    if(!postgresOnly) {
      const s3=new S3Client({endpoint:S3_ENDPOINT,region:'us-east-1',forcePathStyle:true,credentials})
      try {await s3.send(new CreateBucketCommand({Bucket:'glol-feedback'}))} finally {s3.destroy()}
    }
    return {env:{DATABASE_URL,S3_ENDPOINT,AWS_ACCESS_KEY_ID:credentials.accessKeyId,AWS_SECRET_ACCESS_KEY:secret},close,
      async sql(text) {return [].concat(await pool.query(text)).map(row=>({results:row.rows}))}}
  } catch(error) {await close(); throw error}
}
