import pg from 'pg'

pg.types.setTypeParser(20, Number)

function compile(sql, changes) {
  let index = 0
  return sql.replaceAll('?', () => `$${++index}`)
    .replaceAll('changes()', String(changes))
    .replaceAll('instr(lower(', 'strpos(lower(')
    .replace('max(admin_read_id,', 'greatest(admin_read_id,')
    .replace('substr($1||char(10)||summary,-200)', 'right($1||chr(10)||summary,200)')
    .replace('u.id user FROM', 'u.id AS "user" FROM')
}

export function measuredConnections(pool,metrics) {
  async function connect() {
    const before=performance.now()
    const client=await pool.connect()
    metrics.wait(performance.now()-before)
    return {
      async query(sql,args) {
        const start=performance.now()
        try{return await client.query(sql,args)}finally{metrics.query(performance.now()-start)}
      },
      release:()=>client.release()
    }
  }
  return {connect,async query(sql,args){
    const client=await connect()
    try{return await client.query(sql,args)}finally{client.release()}
  }}
}

export function isReadOnlySql(sql) {
  const head = sql.trimStart()
  if (!/^(?:SELECT|WITH)\b/i.test(head)) return false
  // 去掉单引号字符串再检查是否含 DML/DDL、行锁或序列写，防止 WITH ... UPDATE/DELETE/INSERT 或 FOR UPDATE 被误判只读
  const stripped = head.replace(/'(?:''|[^'])*'/g, "''")
  if (/\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|TRUNCATE|MERGE)\b/i.test(stripped)) return false
  if (/\bFOR\s+(?:NO\s+KEY\s+UPDATE|UPDATE|KEY\s+SHARE|SHARE)\b/i.test(stripped)) return false
  if (/\b(?:nextval|setval)\s*\(/i.test(stripped)) return false
  return true
}

export function database(pool) {
  async function runSingleRead({sql, args}) {
    const result = await pool.query(compile(sql, 0), args)
    for (const row of result.rows) delete row.rowid
    return {results: result.rows, meta: {changes: result.rowCount}}
  }
  async function batch(statements) {
    // 纯只读语句绝不抢全局排他锁 907071，也不必额外发 BEGIN/COMMIT 往返；
    // 含任何写语句的批次继续走串行事务锁，保持与 D1 原子批次完全一致的语义。
    if (statements.length && statements.every(stmt => isReadOnlySql(stmt.sql))) {
      if (statements.length === 1) return [await runSingleRead(statements[0])]
      return Promise.all(statements.map(runSingleRead))
    }
    const client=await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock(907071)')
      let changes = 0
      const results = []
      for (const {sql, args} of statements) {
        const result = await client.query(compile(sql, changes), args)
        if (result.command !== 'SELECT') changes = result.rowCount
        for (const row of result.rows) delete row.rowid
        results.push({results: result.rows, meta: {changes: result.rowCount}})
      }
      await client.query('COMMIT')
      return results
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {client.release()}
  }
  function prepare(sql, args = []) {
    return {sql, args, bind: (...values) => prepare(sql, values),
      async run() {return (await batch([this]))[0]},
      async all() {return this.run()},
      async first(column) {const row = (await this.run()).results[0]; return (column ? row?.[column] : row) ?? null}}
  }
  return {prepare, batch}
}
