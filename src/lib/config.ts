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

/**
 * 瀏覽器把這個來源當成「安全」嗎？
 *
 * HTTPS 與 localhost 是；區網的 `http://192.168.x.x:5173` 不是——網址列上那個
 * 「不安全」講的就是這件事。它不只是一個標籤，瀏覽器會連帶收掉一整組 API：
 * `crypto.subtle`（Google 登入的 PKCE）、`navigator.clipboard`、
 * `navigator.share`、`wakeLock`、以及 service worker（PWA 與離線）。
 *
 * 這個 App 對其中大部分都準備了退路（見 lib/code.ts、lib/clipboard.ts），
 * 剩下真的走不通的，用這個判斷式先跟使用者說清楚。
 */
export function secureOrigin(): boolean {
  return typeof window === 'undefined' || window.isSecureContext !== false
}

/**
 * 這個環境有沒有機會用相機掃 QR 碼加入空間。
 *
 * `getUserMedia` 跟 Google 登入的 PKCE 一樣只在安全來源開放，區網的
 * `http://192.168.x.x` 沒有。支援與否要先問清楚再決定顯不顯示按鈕——
 * 按了才發現整支 API 是 undefined，看到的會是一個沒有任何說明的空白錯誤。
 */
export function canScanQr(): boolean {
  return secureOrigin() && typeof navigator !== 'undefined'
    && typeof navigator.mediaDevices?.getUserMedia === 'function'
}

/**
 * 這台裝置的本機名單有沒有被系統清掉的風險（2026-09，iOS 評估 §3.2）。
 *
 * **iOS Safari 的 ITP 會在七天沒有互動之後，清掉整個來源的 script-writable
 * storage**——這個 app 的名單、待送佇列、常用名單全部存在 IndexedDB 裡，
 * 一次都不留。而 `navigator.storage.persist()` 在 iOS Safari **不支援**，
 * 所以程式沒有辦法主動要求豁免。
 *
 * 產品情境正好踩中：方向書把「回程用複製空間」列為核心情境，而一場活動與
 * 回程之間可能隔兩週。單機模式的使用者兩週後打開，名單不見了。
 *
 * **加到主畫面之後就不受這條限制**（standalone 有自己的儲存區），所以這個
 * 判斷式只在「iOS Safari ＋ 還沒加到主畫面」時為真——那正是唯一該講這件事、
 * 而且講了有用的情況。
 *
 * **這是猜的**（跟 inAppBrowser 一樣靠 UA），猜錯的代價只是多一句提示。
 * iPadOS 13 之後的 Safari 會報成 Mac，所以要補一個「有觸控的 Mac」的判斷。
 */
export function atRiskOfStorageEviction(): boolean {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false
  const ua = navigator.userAgent
  const iOSLike = /iPad|iPhone|iPod/.test(ua)
    || (/Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1)
  if (!iOSLike) return false
  // 只有真的 WebKit（不是 iOS 上的 Chrome/Firefox 外殼——它們一樣是 WebKit，
  // 所以其實也適用；這裡不細分，判斷 iOS 就夠）。
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches
    || (navigator as { standalone?: boolean }).standalone === true
  return !standalone
}
