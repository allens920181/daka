import type { Lang } from './i18n'

/**
 * 時間與日期的格式化。
 *
 * 刻意不用 `toLocaleString(undefined, …)`：那會跟著瀏覽器語系跑，於是同一份
 * 名單在五支手機上長相不同——一支寫「03:12 PM」、一支寫「15:12」。現場是靠
 * 口頭對照的（「你那邊陳姐幾點打的？」），格式必須跟著 App 的語言走，五支
 * 手機才會講同一種話。
 */

/** 24 小時制，兩位數補零。中英文都用同一種：現場唸數字最不會聽錯。 */
export function formatTime(input: string | number | Date): string {
  const d = toDate(input)
  if (!d) return ''
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 短日期。中文 `9/30`、英文 `Sep 30`；跨年時補上年份。 */
export function formatDate(input: string | number | Date, lang: Lang, now: Date = new Date()): string {
  const d = toDate(input)
  if (!d) return ''
  const sameYear = d.getFullYear() === now.getFullYear()
  if (lang === 'en') {
    const m = EN_MONTHS[d.getMonth()] ?? ''
    return sameYear ? `${m} ${d.getDate()}` : `${m} ${d.getDate()}, ${d.getFullYear()}`
  }
  const md = `${d.getMonth() + 1}/${d.getDate()}`
  return sameYear ? md : `${d.getFullYear()}/${md}`
}

/** 日期 + 時間，用於房間清單這種「哪一間是哪一天」的場合。 */
export function formatDateTime(input: string | number | Date, lang: Lang, now: Date = new Date()): string {
  const d = toDate(input)
  if (!d) return ''
  return `${formatDate(d, lang, now)} ${formatTime(d)}`
}

const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

function toDate(input: string | number | Date): Date | null {
  const d = input instanceof Date ? input : new Date(input)
  return Number.isNaN(d.getTime()) ? null : d
}
