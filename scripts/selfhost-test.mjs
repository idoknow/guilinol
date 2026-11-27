import {execFileSync,spawn} from 'node:child_process'
import {randomUUID} from 'node:crypto'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {once} from 'node:events'
import {createServer} from 'node:net'
import {setTimeout as delay} from 'node:timers/promises'
import pg from 'pg'
import {S3Client,CreateBucketCommand} from '@aws-sdk/client-s3'

async function localPort() {
  const server=createServer().listen(0,'127.0.0.1')
  await once(server,'listening')
  const {port}=server.address()
  await new Promise(resolve=>server.close(resolve))
  return port
}

export async function fixture({postgresOnly=false}={}) {
  const ids=[],secret=randomUUID(),credentials={accessKeyId:'gloltest',secretAccessKey:secret}
  const docker=args=>execFileSync('docker',args,{encoding:'utf8'}).trim()
  function service(port,args) {
    const id=docker(['run','-d','--rm','-p',`127.0.0.1::${port}`,...args])
    ids.push(id)
    return docker(['port',id,`${port}/tcp`]).split(':').at(-1)
  }
  let pool,admin,schema,minio,minioDir
  async function close() {
    await pool?.end()
    if(admin){
      try {if(schema)await admin.query('DROP SCHEMA '+schema+' CASCADE')}finally{await admin.end()}
    }
    if(minio?.pid && minio.exitCode===null && minio.signalCode===null){
      const stopped=once(minio,'exit')
      minio.kill()
      await stopped
    }
    if(minioDir)await rm(minioDir,{recursive:true,force:true})
    for(const id of ids)docker(['stop','-t','1',id])
  }
  try {
    let DATABASE_URL=process.env.DATABASE_URL
    if(DATABASE_URL){
      admin=new pg.Pool({connectionString:DATABASE_URL})
      const name='glol_test_'+randomUUID().replaceAll('-','')
      await admin.query('CREATE SCHEMA '+name)
      schema=name
      const url=new URL(DATABASE_URL)
      url.searchParams.set('options',(url.searchParams.get('options')??'')+' -c search_path='+name)
      DATABASE_URL=url.href
    }else{
      const port=service(5432,['--tmpfs','/var/lib/postgresql/data:rw,size=256m','-e',`POSTGRES_PASSWORD=${secret}`,'-e','POSTGRES_DB=glol','postgres:16-alpine'])
      DATABASE_URL=`postgres://postgres:${secret}@127.0.0.1:${port}/glol`
    }
    let S3_ENDPOINT
    if(!postgresOnly){
      let port
      if(process.env.DATABASE_URL){
        port=await localPort()
        minioDir=await mkdtemp(join(tmpdir(),'glol-minio-'))
        minio=spawn(process.env.MINIO_BIN??'minio',['server',minioDir,'--address','127.0.0.1:'+port,'--console-address','127.0.0.1:0'],{
          env:{...process.env,MINIO_ROOT_USER:credentials.accessKeyId,MINIO_ROOT_PASSWORD:secret,MINIO_UPDATE:'off'},stdio:'ignore'})
        await once(minio,'spawn')
      }else port=service(9000,['-e','MINIO_ROOT_USER=gloltest','-e',`MINIO_ROOT_PASSWORD=${secret}`,process.env.TEST_MINIO_IMAGE||'cgr.dev/chainguard/minio:latest','server','/tmp/glol'])
      S3_ENDPOINT='http://127.0.0.1:'+port
    }
    pool=new pg.Pool({connectionString:DATABASE_URL})
    for(let attempt=0;;attempt++){
      try{await pool.query('SELECT 1');if(postgresOnly||(await fetch(S3_ENDPOINT+'/minio/health/ready')).ok)break}catch{}
      if(attempt>=100||minio?.exitCode!=null)throw Error('Test services not ready')
      await delay(300)
    }
    const migrate=async name=>pool.query(await readFile('deploy/postgres/'+name+'.sql','utf8'))
    const replay=async()=>{
      for(const migration of ['002-telemetry','003-admin','003-player-saves','004-social','005-social-pending','006-social-register','007-social-only','008-social-states-register','009-feedback-credit','010-perf-admin-indexes','010-user-moderation','011-player-uid','012-citizen-photo','013-perf-hour','014-mp','015-chat','016-chat-lexicon','017-npc','019-update-cards','020-social-direct-revert','020-perf-event-ips','021-admin-perf-and-mp-activity','024-mp-anti-cheat','025-mp-reviews','026-mp-cheat-captures'])await migrate(migration)
      await migrate('027-security-search')
      await migrate('028-web-guard')
      await migrate('029-feedback-user-status-index')
    }
    await migrate('001-schema');await replay()
    if(!postgresOnly){
      const s3=new S3Client({endpoint:S3_ENDPOINT,region:'us-east-1',forcePathStyle:true,credentials})
      try{await s3.send(new CreateBucketCommand({Bucket:'glol-feedback'}))}finally{s3.destroy()}
    }
    return {env:{DATABASE_URL,S3_ENDPOINT:S3_ENDPOINT??'http://127.0.0.1:0',AWS_ACCESS_KEY_ID:credentials.accessKeyId,AWS_SECRET_ACCESS_KEY:secret},close,replay,
      async sql(text,args){return [].concat(await pool.query(text,args)).map(row=>({results:row.rows}))}}
  }catch(error){await close();throw error}
}
