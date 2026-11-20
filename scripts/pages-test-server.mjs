import {join,resolve} from 'node:path'
import {Miniflare} from 'miniflare'
import {preview} from 'vite'
import {unstable_readConfig,unstable_splitSqlQuery} from 'wrangler'

const [state, directory, port] = process.argv.slice(2)
const config = unstable_readConfig({config:'wrangler.toml'})
const assets = await preview({configFile:false,build:{outDir:resolve(directory)},preview:{host:'127.0.0.1',port:0}})
const worker = new Miniflare({
  modules:true, modulesRoot:state, scriptPath:join(state,'pages/index.js'), host:'127.0.0.1', port:Number(port),
  compatibilityDate:config.compatibility_date,
  d1Databases:Object.fromEntries(config.d1_databases.map(db=>[db.binding,db.database_id])),
  d1Persist:join(state,'v3/d1'), r2Buckets:config.r2_buckets.map(bucket=>bucket.binding),
  bindings:{BRIDGE_TOKEN:'local-test',EMAIL_DEV_LOG:'1'},
  serviceBindings:{ASSETS:request=>{
    const url=new URL(request.url);url.host=`127.0.0.1:${assets.httpServer.address().port}`
    return fetch(url,{method:request.method,headers:request.headers})
  }},
})
await worker.ready
const db=await worker.getD1Database('DB')
process.on('message',async command=>{
  try{process.send({rows:await db.batch(unstable_splitSqlQuery(command).map(stmt=>db.prepare(stmt)))})}
  catch(error){process.send({error:error.message})}
})
