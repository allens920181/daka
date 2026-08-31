import { REQUEST_TIMEOUT_MS, SUPABASE_ANON_KEY, SUPABASE_URL, isSupabaseConfigured } from './config'
import { loadSession, saveSession } from './storage'

/**
 * 主揪帳號。
 *
 * 只有主揪需要登入——協助點名的人永遠不用。掃 QR 就能點是這個產品的
 * 生命線，一旦要求五個同工在遊覽車門口註冊，整個東西就廢了。
 *
 * 用 Email 六碼驗證碼而不是魔術連結：魔術連結在信件 App 的內建瀏覽器
 * 開啟時會落在另一個瀏覽器工作階段，是很常見的失敗模式。輸入六碼永遠
 * 在同一台裝置上完成，而且跟房號輸入的操作模式一致。
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

export type AuthErrorKind = 'not-configured' | 'offline' | 'bad-code' | 'rate-limited' | 'unknown'

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

/** 寄出六碼驗證碼。沒有這個 Email 的話會順便建立帳號。 */
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
