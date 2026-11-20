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

export function database(pool) {
  async function batch(statements) {
    const client = await pool.connect()
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
