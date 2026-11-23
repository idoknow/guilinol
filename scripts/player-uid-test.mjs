import assert from 'node:assert/strict'
import {readFile,readdir} from 'node:fs/promises'
import {DatabaseSync} from 'node:sqlite'
import pg from 'pg'

export async function testPlayerUid(databaseUrl){
  const insert="INSERT INTO users(id,email,nickname,salt,digest,created_at) VALUES ('z','z','z','','',1),('a','a','a','','',2),('b','b','b','','',1)"
  const next="INSERT INTO users(id,email,nickname,salt,digest) VALUES ('new','new','new','','')"
  const inspect='SELECT id,uid FROM users ORDER BY uid'
  const expected=[['b',100000],['z',100001],['a',100002],['new',100003]]
  const sqlite=new DatabaseSync(':memory:')
  try{
    for(const file of (await readdir('migrations')).filter(file=>file.endsWith('.sql')).sort()){
      if(file.startsWith('0014_'))sqlite.exec(insert)
      sqlite.exec(await readFile('migrations/'+file,'utf8'))
    }
    sqlite.exec(next)
    assert.deepEqual(sqlite.prepare(inspect).all().map(row=>[row.id,row.uid]),expected)
  }finally{sqlite.close()}
  const client=new pg.Client({connectionString:databaseUrl});await client.connect()
  try{
    await client.query('CREATE TEMP TABLE users(id text PRIMARY KEY,email text,nickname text,salt text,digest text,created_at integer DEFAULT 0)');await client.query(insert)
    const migration=await readFile('deploy/postgres/011-player-uid.sql','utf8')
    await client.query(migration);await client.query(migration);await client.query(next)
    assert.deepEqual((await client.query(inspect)).rows.map(row=>[row.id,Number(row.uid)]),expected)
  }finally{await client.end()}
  console.log('Player UID: SQLite and PostgreSQL backfilled every old row in (created_at,id) order; next registration 100003')
}
