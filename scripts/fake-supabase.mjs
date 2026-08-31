// 測試用的假 Supabase：把 PostgREST 的 RPC 與 GoTrue 的登入端點轉發到本機
// PostgreSQL。目的是用「真的 SQL」驗證同步與帳號的擁有權邏輯，不需要開一個
// 真的 Supabase 專案。
//
// 這不是安全的實作，只是測試替身：驗證碼固定、token 就是使用者 id。
// 絕對不要拿去對外服務。
//
// 準備：
//   createdb daka
//   psql -d daka -c "create role anon nologin; create role authenticated nologin;
//                    grant usage on schema public to anon, authenticated;"
//   psql -d daka -f supabase/schema.local-auth.sql
//   psql -d daka -f supabase/schema.sql
//
//   node scripts/fake-supabase.mjs      # 監聽 :54321

import http from 'node:http'
import pg from 'pg'

const pool = new pg.Pool({ host: '/var/tmp', port: 55432, user: 'postgres', database: 'daka' })

/** 所有 Email 的驗證碼都是這個。測試替身，不是安全設計。 */
const FIXED_CODE = '123456'
const TOKEN_PREFIX = 'usr_'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'apikey, authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (res, status, body) => {
  res.writeHead(status, { ...CORS, 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

async function readBody(req) {
  let raw = ''
  for await (const chunk of req) raw += chunk
  return raw ? JSON.parse(raw) : {}
}

/** Bearer 是 usr_<uuid> 就代表已登入；其他（anon key）視為未登入。 */
function userIdFrom(req) {
  const auth = req.headers.authorization ?? ''
  const token = auth.replace(/^Bearer\s+/i, '')
  return token.startsWith(TOKEN_PREFIX) ? token.slice(TOKEN_PREFIX.length) : null
}

/**
 * 借一條連線，用完把角色與 GUC 還原。
 *
 * pg.Pool 會重用連線，而 SET ROLE 是連線層級的——不還原的話，
 * 服務過 anon 的那條連線會帶著 anon 身分去跑下一個請求。
 */
async function withClient(role, uid, run) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`SET LOCAL ROLE ${role}`)
    // PostgREST 會把 JWT claims 放進這個 GUC，auth.uid() 從這裡讀。
    // 第三個參數 true = 只在這個交易內有效，所以一定要在交易裡設。
    await client.query('select set_config($1, $2, true)', [
      'request.jwt.claims',
      uid ? JSON.stringify({ sub: uid, role: 'authenticated' }) : '',
    ])
    const out = await run(client)
    await client.query('COMMIT')
    return out
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

async function handleAuth(req, res, path) {
  const body = await readBody(req)

  if (path === 'otp') {
    if (!body.email) return json(res, 400, { msg: 'email required' })
    return json(res, 200, {})
  }

  if (path === 'verify') {
    if (String(body.token) !== FIXED_CODE) return json(res, 403, { msg: 'invalid otp token' })
    const email = String(body.email ?? '').toLowerCase()
    const id = await withClient('postgres', null, async (client) => {
      const found = await client.query('select id from auth.users where email = $1', [email])
      return found.rows[0]?.id
        ?? (await client.query('insert into auth.users (email) values ($1) returning id', [email])).rows[0].id
    })
    return json(res, 200, {
      access_token: TOKEN_PREFIX + id,
      refresh_token: 'refresh_' + id,
      expires_in: 3600,
      user: { id, email },
    })
  }

  if (path.startsWith('token')) {
    const id = String(body.refresh_token ?? '').replace(/^refresh_/, '')
    if (!id) return json(res, 401, { msg: 'bad refresh token' })
    const user = await withClient('postgres', null, async (client) => {
      const found = await client.query('select id, email from auth.users where id = $1', [id])
      return found.rows[0] ?? null
    })
    if (!user) return json(res, 401, { msg: 'unknown user' })
    return json(res, 200, {
      access_token: TOKEN_PREFIX + id,
      refresh_token: 'refresh_' + id,
      expires_in: 3600,
      user,
    })
  }

  if (path === 'logout') {
    res.writeHead(204, CORS)
    return res.end()
  }

  return json(res, 404, {})
}

async function handleRpc(req, res, fn) {
  const args = await readBody(req)
  const keys = Object.keys(args)
  const params = keys.map((k, i) => `${k} := $${i + 1}`).join(', ')
  const values = keys.map((k) => {
    const v = args[k]
    return v !== null && typeof v === 'object' ? JSON.stringify(v) : v
  })

  const uid = userIdFrom(req)
  try {
    const out = await withClient(uid ? 'authenticated' : 'anon', uid, async (client) => {
      const r = await client.query(`SELECT public.${fn}(${params}) AS out`, values)
      return r.rows[0]?.out ?? null
    })
    return json(res, 200, out)
  } catch (e) {
    return json(res, 400, { message: String(e.message), code: e.code })
  }
}

http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end() }
  try {
    const auth = req.url?.match(/^\/auth\/v1\/(.+)$/)
    if (auth) return await handleAuth(req, res, auth[1])
    const rpc = req.url?.match(/^\/rest\/v1\/rpc\/(\w+)$/)
    if (rpc) return await handleRpc(req, res, rpc[1])
    return json(res, 404, {})
  } catch (e) {
    return json(res, 500, { message: String(e?.message ?? e) })
  }
}).listen(54321, '127.0.0.1', () => {
  console.log('fake Supabase (REST + Auth) on :54321 · 驗證碼固定為', FIXED_CODE)
})
