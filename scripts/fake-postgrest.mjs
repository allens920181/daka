// 最小的 PostgREST 相容端點，直接把 RPC 轉成本機 Postgres 的函式呼叫。
// 目的：用真的 SQL 驗證「兩台裝置看到同一份名單」這條路徑。
import http from 'node:http'
import pg from 'pg'

const pool = new pg.Pool({ host: '/var/tmp', port: 55432, user: 'postgres', database: 'daka' })
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'apikey, authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end() }
  const m = req.url?.match(/^\/rest\/v1\/rpc\/(\w+)$/)
  if (!m) { res.writeHead(404, CORS); return res.end('{}') }

  let body = ''
  for await (const c of req) body += c
  const args = body ? JSON.parse(body) : {}
  const keys = Object.keys(args)
  const params = keys.map((k, i) => `${k} := $${i + 1}`).join(', ')
  const values = keys.map((k) => {
    const v = args[k]
    return v !== null && typeof v === 'object' ? JSON.stringify(v) : v
  })

  const client = await pool.connect()
  try {
    await client.query('SET ROLE anon')
    const r = await client.query(`SELECT public.${m[1]}(${params}) AS out`, values)
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' })
    res.end(JSON.stringify(r.rows[0]?.out ?? null))
  } catch (e) {
    res.writeHead(400, { ...CORS, 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ message: String(e.message), code: e.code }))
  } finally {
    client.release()
  }
}).listen(54321, '127.0.0.1', () => console.log('fake PostgREST on :54321'))
