const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()

/**
 * 沒設定 Supabase 時整個應用仍然可用，只是退回單機模式。
 * 這很重要：第一次部署、或使用者還沒開專案時，不該看到一個壞掉的網站。
 */
export const isSupabaseConfigured = Boolean(url && anonKey)

export const SUPABASE_URL = (url ?? '') as string
export const SUPABASE_ANON_KEY = (anonKey ?? '') as string

/** 網路請求的逾時。收訊差時沒有逾時會把待送佇列吊死。 */
export const REQUEST_TIMEOUT_MS = 12_000

/**
 * 看起來像是在 App 的內建瀏覽器裡嗎？
 *
 * Google 會在內嵌 webview 裡直接擋掉 OAuth（`disallowed_useragent`），而這個
 * 產品的主揪很可能就是從 LINE 群裡點自己的分享連結進來的——那正好落在這個
 * 陷阱裡。
 *
 * **這是猜的，會猜錯。** 所以呼叫端只能拿它來「先說一聲」，不能拿來停用按鈕：
 * 有些內建瀏覽器其實過得了，而 UA 字串也隨時可能改。猜錯時最壞的結果是多顯示
 * 一句提示，而不是把一條可行的路擋起來。
 */
export function inAppBrowser(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  return /\bLine\b|\bFBAN\b|\bFBAV\b|Instagram|MicroMessenger|KAKAOTALK/i.test(ua)
}
