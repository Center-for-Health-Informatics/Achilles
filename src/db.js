import sql from 'mssql'

let pool

export async function connect (config) {
  pool = await sql.connect(config)
  return pool
}

export async function query (text) {
  return pool.request().query(text)
}

export async function batch (text) {
  return pool.request().batch(text)
}

export async function close () {
  await sql.close()
}
