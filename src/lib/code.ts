/**
 * 代碼：6 碼，31 個字元的字母表。
 * 刻意排除 0 / O / 1 / I / L —— 這幾個在手寫、口述、小螢幕上最容易搞錯。
 * 因為它們永遠不會出現在代碼裡，使用者一旦打出來就一定是打錯，可以明確告知。
 */
export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
export const CODE_LENGTH = 6

/** 被排除的易混淆字元 → 給使用者的提示用。 */
export const CONFUSABLE_CHARS = '01OIL'

/** 用 rejection sampling 取得無偏的隨機索引（避免 % 造成的分佈偏斜）。 */
function randomIndex(n: number): number {
  const limit = Math.floor(256 / n) * n
  const buf = new Uint8Array(1)
  for (;;) {
    crypto.getRandomValues(buf)
    const v = buf[0] ?? 0
    if (v < limit) return v % n
  }
}

export function generateRoomCode(length = CODE_LENGTH): string {
  let out = ''
  for (let i = 0; i < length; i++) {
    out += CODE_ALPHABET[randomIndex(CODE_ALPHABET.length)]
  }
  return out
}

/** 去掉空白與分隔符號、轉大寫。不做字元替換——見上面的註解。 */
export function normalizeRoomCode(input: string): string {
  return input
    .replace(/[\s\-_·・]/g, '')
    .toUpperCase()
    // 全形英數 → 半形
    .replace(/[Ａ-Ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
}

/**
 * 貼上的常常是整條分享連結，不是單獨的代碼——收到連結的人習慣先複製再貼進
 * 這個框，而不是直接點開它。連結長相是 `.../#/j/CODE` 或 `.../#/r/CODE`，
 * 抓出代碼再正規化；抓不到就當作使用者貼的就是代碼本身，交給後面的驗證判斷。
 */
export function extractRoomCode(input: string): string {
  const match = input.match(/#\/[jr]\/([^/?#]+)/i)
  return normalizeRoomCode(match?.[1] ?? input)
}

export function isValidRoomCode(input: string): boolean {
  const code = normalizeRoomCode(input)
  if (code.length !== CODE_LENGTH) return false
  for (const ch of code) if (!CODE_ALPHABET.includes(ch)) return false
  return true
}

/** 找出使用者輸入裡的易混淆字元，用來給出精準的錯誤訊息。 */
export function findConfusables(input: string): string[] {
  const seen = new Set<string>()
  for (const ch of normalizeRoomCode(input)) {
    if (CONFUSABLE_CHARS.includes(ch)) seen.add(ch)
  }
  return [...seen]
}

/** 擁有者金鑰：只存在開空間的那台裝置，用來授權破壞性操作。 */
export function generateOwnerKey(): string {
  const buf = new Uint8Array(24)
  crypto.getRandomValues(buf)
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * UUID v4，不依賴 `crypto.randomUUID`。
 *
 * `randomUUID` 只存在於 secure context（HTTPS 或 localhost）。用手機從區網開
 * `http://192.168.x.x:5173` 時它是 undefined——而這條路每點一個名字、每加一個
 * 人都會走到，少了退路，整個 App 在自己的子網底下等於不能用。
 * `getRandomValues` 沒有這個限制，用它自己組一顆強度相同的 v4。
 */
export function uuidV4(): string {
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40 // 版本位：4
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80 // 變體位：RFC 4122
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function generateId(): string {
  return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : uuidV4()
}
