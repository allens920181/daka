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
