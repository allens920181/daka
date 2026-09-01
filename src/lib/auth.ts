import { REQUEST_TIMEOUT_MS, SUPABASE_ANON_KEY, SUPABASE_URL, isSupabaseConfigured } from './config'
import { loadSession, saveSession } from './storage'

/**
 * 主揪帳號。
 *
 * 只有主揪需要登入——協助點名的人永遠不用。掃 QR 就能點是這個產品的
 * 生命線，一旦要求五個同工在遊覽車門口註冊，整個東西就廢了。
 *
 * 主要路徑是 Google 登入，備援是 Email 六碼驗證碼。理由見下面 startGoogleSignIn
 * 與 requestCode 的註解。
 *
 * 這裡直接打 GoTrue 的 REST，沿用「不裝 supabase-js」的決定。
 */

export interface Session {
  accessToken: string
  refreshToken: string
  /** epoch 毫秒 */
  expiresAt: number
  userId: string
  email: string
}

export type AuthErrorKind =
  | 'not-configured'
  | 'offline'
  | 'bad-code'
  | 'rate-limited'
  /** OAuth 回來時對不上暫存的 verifier——多半是換了分頁或中途重開瀏覽器。 */
  | 'oauth-lost'
  /** 使用者在 Google 那一頭按了取消。不是錯誤，不該當錯誤講。 */
  | 'oauth-cancelled'
  | 'unknown'

export class AuthError extends Error {
  constructor(readonly kind: AuthErrorKind, message?: string) {
    super(message ?? kind)
    this.name = 'AuthError'
  }
}

let session: Session | null = null
let refreshing: Promise<Session | null> | null = null

/** 提前這麼久就更新 token，避免請求送到一半過期。 */
const REFRESH_MARGIN_MS = 60_000

async function post<T>(path: string, body: unknown, token?: string): Promise<T> {
  if (!isSupabaseConfigured) throw new AuthError('not-configured')
  let res: Response
  try {
    res = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token ?? SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (e) {
    const name = (e as Error)?.name
    if (name === 'TimeoutError' || name === 'AbortError') throw new AuthError('offline', 'timeout')
    throw new AuthError('offline', String((e as Error)?.message ?? e))
  }

  if (res.status === 429) throw new AuthError('rate-limited')
  if (res.status === 401 || res.status === 403) throw new AuthError('bad-code')
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { error_description?: string; msg?: string } | null
    const message = detail?.error_description ?? detail?.msg ?? `http ${res.status}`
    if (res.status >= 500) throw new AuthError('offline', message)
    throw new AuthError(/token|otp|expired|invalid/i.test(message) ? 'bad-code' : 'unknown', message)
  }
  return (res.status === 204 ? null : await res.json()) as T
}

interface GoTrueSession {
  access_token: string
  refresh_token: string
  expires_in?: number
  expires_at?: number
  user?: { id: string; email?: string }
}

function toSession(raw: GoTrueSession, email: string): Session {
  const expiresAt = raw.expires_at
    ? raw.expires_at * 1000
    : Date.now() + (raw.expires_in ?? 3600) * 1000
  return {
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token,
    expiresAt,
    userId: raw.user?.id ?? '',
    email: raw.user?.email ?? email,
  }
}

/** 啟動時把存下來的工作階段讀回來。 */
export async function restoreSession(): Promise<Session | null> {
  if (!isSupabaseConfigured) return null
  session = (await loadSession<Session>()) ?? null
  return session
}

export function currentSession(): Session | null {
  return session
}

/**
 * 寄出六碼驗證碼。沒有這個 Email 的話會順便建立帳號。
 *
 * 這是**備援**路徑，不是主要路徑。留著它有兩個具體理由：
 * 1. Google 在內建瀏覽器（LINE、FB、IG）裡會直接擋掉 OAuth
 *    （`disallowed_useragent`）——而主揪很可能就是從 LINE 群裡點自己的分享連結
 *    進來的。沒有備援的話那是一條死路。
 * 2. 不是每個人都有、或都想用 Google 帳號。
 *
 * 用六碼而不是魔術連結：連結在信件 App 的內建瀏覽器開啟時會落在另一個瀏覽器
 * 工作階段，是很常見的失敗模式。輸入六碼永遠在同一台裝置上完成。
 */
export async function requestCode(email: string): Promise<void> {
  await post('otp', { email: email.trim().toLowerCase(), create_user: true })
}

export async function verifyCode(email: string, code: string): Promise<Session> {
  const clean = email.trim().toLowerCase()
  const raw = await post<GoTrueSession>('verify', {
    email: clean,
    token: code.replace(/\D/g, ''),
    type: 'email',
  })
  session = toSession(raw, clean)
  await saveSession(session)
  return session
}

// ---------------------------------------------------------------------------
// Google 登入（PKCE）
// ---------------------------------------------------------------------------

/**
 * 為什麼是 PKCE 而不是預設的 implicit flow：
 *
 * implicit flow 會把 token 放在網址的 **hash** 裡回來（`#access_token=…`），
 * 而這個 App 用的就是 hash 路由——兩者會直接打架，路由器會把一串 token 當成
 * 路徑。PKCE 走的是 `?code=`（query），跟 hash 沒有交集；順帶好處是 token
 * 從來不會出現在網址列與瀏覽紀錄裡。
 */
const PKCE_VERIFIER_KEY = 'daka.pkce.verifier'
const PKCE_RETURN_KEY = 'daka.pkce.return'

/** sessionStorage 在無痕或停用儲存時會丟錯；一律降級成「這條路走不通」。 */
function stash(key: string, value: string): boolean {
  try { sessionStorage.setItem(key, value); return true } catch { return false }
}
function unstash(key: string): string | null {
  try {
    const v = sessionStorage.getItem(key)
    sessionStorage.removeItem(key)
    return v
  } catch { return null }
}

function base64url(bytes: ArrayBuffer): string {
  let s = ''
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64url(digest)
}

/** 回到這個網址——Supabase 後台的 Redirect URLs 要放行它。 */
export function oauthRedirectUrl(): string {
  const base = import.meta.env.BASE_URL || '/'
  return `${window.location.origin}${base}`
}

/**
 * 開始 Google 登入。這個函式會把整個分頁導走，正常情況下不會回傳。
 *
 * `returnTo` 是登入完成後要回到的 hash 路由。不把它塞進 redirect_to 是刻意的：
 * GoTrue 對帶 hash 的 redirect_to 處理方式不一，存在 sessionStorage 裡最穩，
 * 而且同一個分頁重導回來時它一定還在。
 */
export async function startGoogleSignIn(returnTo: string): Promise<void> {
  if (!isSupabaseConfigured) throw new AuthError('not-configured')

  const verifier = base64url(crypto.getRandomValues(new Uint8Array(64)).buffer)
  if (!stash(PKCE_VERIFIER_KEY, verifier)) throw new AuthError('oauth-lost', 'no session storage')
  stash(PKCE_RETURN_KEY, returnTo)

  const url = new URL(`${SUPABASE_URL}/auth/v1/authorize`)
  url.searchParams.set('provider', 'google')
  url.searchParams.set('redirect_to', oauthRedirectUrl())
  url.searchParams.set('code_challenge', await challengeFor(verifier))
  url.searchParams.set('code_challenge_method', 's256')
  window.location.assign(url.toString())
}

export interface OAuthCallback {
  code?: string
  /** 使用者按取消、或 Google 那一頭出錯。 */
  error?: string
}

/**
 * 網址上有沒有 OAuth 的回呼？有的話一併把它從網址清掉（含瀏覽紀錄）。
 *
 * 一定要清：留著的話使用者重新整理就會拿一個已經用掉的 code 再換一次，
 * 然後看到一個沒頭沒尾的錯誤。
 */
export function takeOAuthCallback(): OAuthCallback | null {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  const error = params.get('error') ?? params.get('error_description')
  if (!code && !error) return null

  params.delete('code'); params.delete('error'); params.delete('error_description')
  params.delete('state'); params.delete('provider')
  const query = params.toString()
  window.history.replaceState(
    null, '',
    `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`,
  )
  return code ? { code } : { error: error ?? 'unknown' }
}

/** 登入完成後要回到的路由，沒有就回首頁。 */
export function takeOAuthReturn(): string {
  return unstash(PKCE_RETURN_KEY) || '/'
}

export async function completeGoogleSignIn(authCode: string): Promise<Session> {
  const verifier = unstash(PKCE_VERIFIER_KEY)
  // 換過分頁、中途重開瀏覽器、或 sessionStorage 被清掉都會走到這裡。
  if (!verifier) throw new AuthError('oauth-lost')

  const raw = await post<GoTrueSession>('token?grant_type=pkce', {
    auth_code: authCode,
    code_verifier: verifier,
  })
  session = toSession(raw, '')
  await saveSession(session)
  return session
}

export async function signOut(): Promise<void> {
  const token = session?.accessToken
  session = null
  await saveSession(null)
  if (token) {
    // 伺服器端撤銷失敗不影響本機已經登出的事實。
    await post('logout', {}, token).catch(() => {})
  }
}

/** 需要時更新 token。回傳目前可用的存取權杖，沒登入就回 null。 */
export async function accessToken(): Promise<string | null> {
  if (!session) return null
  if (session.expiresAt - Date.now() > REFRESH_MARGIN_MS) return session.accessToken

  refreshing ??= (async () => {
    const current = session
    if (!current) return null
    try {
      const raw = await post<GoTrueSession>('token?grant_type=refresh_token', {
        refresh_token: current.refreshToken,
      })
      session = toSession(raw, current.email)
      await saveSession(session)
      return session
    } catch (e) {
      // 只有在伺服器明確拒絕時才登出。斷線時保留工作階段，等下次再試。
      if (e instanceof AuthError && (e.kind === 'bad-code' || e.kind === 'unknown')) {
        session = null
        await saveSession(null)
      }
      return session
    } finally {
      refreshing = null
    }
  })()

  const next = await refreshing
  return next?.accessToken ?? null
}
