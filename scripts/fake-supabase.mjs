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

/**
 * 假的 Google OAuth。
 *
 * 目的是讓端對端測試跑到**真的 PKCE 形狀**：導向 authorize → 帶著 ?code= 回來
 * → 拿 code 換 token。真正的 Google 同意畫面當然不在這裡，所以 authorize 直接
 * 302 回去。測試要指定用哪個帳號時，用 OAuth 本來就有的 `login_hint`。
 *
 * 這不是安全的實作，是測試替身：code 就是 email 的 base64，verifier 不驗。
 */
const pkceCodes = new Map()

/**
 * 下一次 authorize 要當成誰登入。
 *
 * 真的 Google 是使用者在同意畫面上選的，測試沒有那一步，所以用一個明顯只給
 * 測試用的控制端點來指定。刻意**不**讓前端傳 login_hint——那會讓正式程式碼
 * 為了測試而多一個它其實不知道答案的參數。
 */
let nextGoogleUser = 'google-user@example.com'

async function handleAuthorize(req, res, url) {
  const redirect = url.searchParams.get('redirect_to')
  if (!redirect) return json(res, 400, { msg: 'redirect_to required' })
  if (!url.searchParams.get('code_challenge')) {
    // 真的 GoTrue 在沒有 challenge 時會走 implicit flow；我們刻意不支援，
    // 這樣前端要是哪天改回 implicit，測試會馬上紅。
    return json(res, 400, { msg: 'this fake only implements PKCE' })
  }
  const email = (url.searchParams.get('login_hint') ?? nextGoogleUser).toLowerCase()
  const code = 'authcode_' + Math.random().toString(36).slice(2)
  pkceCodes.set(code, email)

  const back = new URL(redirect)
  back.searchParams.set('code', code)
  res.writeHead(302, { ...CORS, Location: back.toString() })
  return res.end()
}

async function handleAuth(req, res, path) {
  const body = await readBody(req)

  if (path.startsWith('token') && String(body.auth_code ?? '')) {
    // grant_type=pkce
    if (!body.code_verifier) return json(res, 400, { msg: 'code_verifier required' })
    const email = pkceCodes.get(body.auth_code)
    // code 只能用一次——真的 GoTrue 也是這樣，前端不清網址就會踩到。
    pkceCodes.delete(body.auth_code)
    if (!email) return json(res, 403, { msg: 'invalid or already used auth code' })
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
    const url = new URL(req.url ?? '/', 'http://127.0.0.1:54321')
    // 測試專用：指定下一次 Google 登入是誰。正式的 GoTrue 沒有這個端點。
    if (url.pathname === '/__test/google-user') {
      nextGoogleUser = String((await readBody(req)).email ?? nextGoogleUser).toLowerCase()
      return json(res, 200, { email: nextGoogleUser })
    }
    if (url.pathname === '/auth/v1/authorize') return await handleAuthorize(req, res, url)
    const auth = req.url?.match(/^\/auth\/v1\/(.+)$/)
    if (auth) return await handleAuth(req, res, auth[1])
    const rpc = req.url?.match(/^\/rest\/v1\/rpc\/(\w+)$/)
    if (rpc) return await handleRpc(req, res, rpc[1])
    return json(res, 404, {})
  } catch (e) {
    return json(res, 500, { message: String(e?.message ?? e) })
  }
}).listen(54321, '127.0.0.1', () => {
  console.log('fake Supabase (REST + Auth + 假 Google OAuth) on :54321 · 驗證碼固定為', FIXED_CODE)
})
