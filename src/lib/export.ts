import type { Member, Room } from './types'
import type { Lang, MessageKey } from './i18n'
import { translate } from './i18n'
import { summarize } from './merge'
import { formatTime } from './format'

const STATUS_KEY: Record<Member['status'], MessageKey> = {
  arrived: 'arrived',
  pending: 'missing',
  excused: 'excused',
}

function csvCell(value: string | number | null): string {
  const s = value === null ? '' : String(value)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * 強制讓試算表把這一格當成文字。
 *
 * 電話存的是純數字（06-content §6.5），CSV 又沒有型別，於是 Excel、Numbers、
 * Google 試算表都會把 `0912345678` 判成數字——開起來變成 912345678，開頭那個 0
 * 沒了。那是主揪唯一拿來打電話找人的欄位，等於匯出即損壞。
 *
 * 加引號沒有用：Excel 的 CSV 匯入不看引號就做型別推斷。`="…"` 是三家都認得、
 * 而且會原樣顯示成文字的寫法。代價是拿去餵程式的人會多讀到這層包裝，但這個
 * 檔案的收件人是試算表，不是程式。
 */
function csvText(value: string): string {
  return value === '' ? '' : `="${value.replace(/"/g, '""')}"`
}

function localTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** CSV。開頭加 BOM，Excel 開啟中文才不會變亂碼。活動名稱放在檔名，不佔資料列。 */
export function toCsv(members: readonly Member[], lang: Lang): string {
  const t = (key: MessageKey) => translate(lang, key)
  const header = (['csvName', 'csvStatus', 'csvTime', 'csvBy', 'csvPhone', 'csvCompanions', 'csvGroup', 'csvNote'] as const)
    .map((k) => csvCell(t(k)))
  const rows = members.map((m) => [
    csvCell(m.name),
    csvCell(t(STATUS_KEY[m.status])),
    csvCell(localTime(m.status_at)),
    csvCell(m.status_by ?? ''),
    // 電話這一格走 csvText：其餘欄位是文字沒錯，但只有它是「看起來像數字的文字」。
    csvText(m.phone ?? ''),
    csvCell(m.companions),
    csvCell(m.group_label ?? ''),
    csvCell(m.note ?? ''),
  ])
  const body = [header, ...rows].map((r) => r.join(',')).join('\r\n')
  return `﻿${body}\r\n`
}

export function csvFilename(room: Room): string {
  const safe = room.name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40)
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${safe}_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.csv`
}

/**
 * 給主揪貼回 LINE 的文字。這是點名結束時最常用的動作，
 * 所以未到名單放在最前面、而且只列人名，方便直接唸出來。
 */
export function toShareText(
  room: Room,
  scoped: readonly Member[],
  lang: Lang,
  groupLabel?: string | null,
  now: Date = new Date(),
): string {
  const t = (key: MessageKey, vars?: Record<string, string | number>) => translate(lang, key, vars)
  const s = summarize(scoped)
  const missing = scoped.filter((m) => m.status === 'pending')
  const excused = scoped.filter((m) => m.status === 'excused')
  const names = (list: readonly Member[]) =>
    list
      .map((m) => (m.companions > 0 ? `${m.name}${t('withCompanions', { n: m.companions })}` : m.name))
      .join(t('listSeparator'))

  const lines = [
    groupLabel ? `${room.name} · ${groupLabel}` : room.name,
    // 時間是這段文字唯一會過期的東西，所以要寫出來：貼進 LINE 群之後，
    // 辦公室看到的必須知道這是幾點的狀態，而不是一份不知何時的名單。
    `${formatTime(now)} · ${t('shareArrived', { arrived: s.arrivedHeadcount, total: s.expectedHeadcount })}`,
  ]
  if (missing.length > 0) {
    // 沒分車就一行列完；有分車就按車分行——20 個名字擠成一句，現場沒有人
    // 唸得出來是哪一車的誰。
    const byGroup = groupLabel ? [] : splitByGroup(missing, t('ungrouped'))
    if (byGroup.length > 1) {
      lines.push(t('shareMissingHeader', { n: heads(missing) }))
      for (const [name, list] of byGroup) {
        lines.push(t('shareGroupLine', { name, n: heads(list), names: names(list) }))
      }
    } else {
      lines.push(t('shareMissingLine', { n: heads(missing), names: names(missing) }))
    }
  } else {
    lines.push(t('allHere'))
  }
  if (excused.length > 0) {
    lines.push(t('shareExcusedLine', { n: heads(excused), names: names(excused) }))
  }
  return lines.join('\n')
}

/**
 * 這段文字裡的每個數字都是人頭，不是列數。
 *
 * 它一度寫成 missing.length：於是「已到 2 / 11 人」（人頭）下面接著「未到 6 位」
 * （列數），同一段六行文字裡兩種單位。李美花帶 1 位、李四帶 2 位，真正沒到的是
 * 9 個人——貼進 LINE 群的那段字把少報的 3 個人交了出去，而讀它的人沒有介面可以
 * 察覺。名字後面補上「＋N」，讓讀的人自己就能把數字加回來。
 */
function heads(list: readonly Member[]): number {
  return list.reduce((n, m) => n + 1 + m.companions, 0)
}


/** 依分組切開，保留第一次出現的順序；沒有分組的人排在最後。 */
function splitByGroup(members: readonly Member[], ungrouped: string): [string, Member[]][] {
  const out = new Map<string, Member[]>()
  for (const m of members) {
    const key = m.group_label ?? ungrouped
    const list = out.get(key)
    if (list) list.push(m)
    else out.set(key, [m])
  }
  const entries = [...out.entries()]
  return entries.sort((a, b) =>
    a[0] === ungrouped ? 1 : b[0] === ungrouped ? -1 : 0)
}

/** 觸發瀏覽器下載。 */
export function downloadFile(filename: string, content: string, mime = 'text/csv;charset=utf-8'): void {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // 立刻 revoke 在部分瀏覽器會讓下載失敗，延後釋放。
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
