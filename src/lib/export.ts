import type { Member, Room } from './types'
import { summarize } from './merge'
import { formatTime } from './format'

const STATUS_LABEL: Record<Member['status'], string> = {
  arrived: '已到',
  pending: '未到',
  excused: '請假',
}

function csvCell(value: string | number | null): string {
  const s = value === null ? '' : String(value)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function localTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** CSV。開頭加 BOM，Excel 開啟中文才不會變亂碼。活動名稱放在檔名，不佔資料列。 */
export function toCsv(members: readonly Member[]): string {
  const rows = [
    ['姓名', '狀態', '時間', '點名者', '電話', '攜伴', '分組', '備註'],
    ...members.map((m) => [
      m.name,
      STATUS_LABEL[m.status],
      localTime(m.status_at),
      m.status_by ?? '',
      m.phone ?? '',
      m.companions,
      m.group_label ?? '',
      m.note ?? '',
    ]),
  ]
  const body = rows.map((r) => r.map(csvCell).join(',')).join('\r\n')
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
  groupLabel?: string | null,
  now: Date = new Date(),
): string {
  const s = summarize(scoped)
  const missing = scoped.filter((m) => m.status === 'pending')
  const excused = scoped.filter((m) => m.status === 'excused')

  const lines = [
    groupLabel ? `${room.name} · ${groupLabel}` : room.name,
    // 時間是這段文字唯一會過期的東西，所以要寫出來：貼進 LINE 群之後，
    // 辦公室看到的必須知道這是幾點的狀態，而不是一份不知何時的名單。
    `${formatTime(now)} · 已到 ${s.arrivedHeadcount} / ${s.expectedHeadcount} 人`,
  ]
  if (missing.length > 0) {
    // 沒分車就一行列完；有分車就按車分行——20 個名字擠成一句，現場沒有人
    // 唸得出來是哪一車的誰。
    const byGroup = groupLabel ? [] : splitByGroup(missing)
    if (byGroup.length > 1) {
      lines.push(`未到 ${heads(missing)} 位：`)
      for (const [name, list] of byGroup) {
        lines.push(`　${name}（${heads(list)}）：${names(list)}`)
      }
    } else {
      lines.push(`未到 ${heads(missing)} 位：${names(missing)}`)
    }
  } else {
    lines.push('全部到齊')
  }
  if (excused.length > 0) {
    lines.push(`請假 ${heads(excused)} 位：${names(excused)}`)
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

function names(list: readonly Member[]): string {
  return list.map((m) => (m.companions > 0 ? `${m.name}＋${m.companions}` : m.name)).join('、')
}

/** 依分組切開，保留第一次出現的順序；沒有分組的人排在最後。 */
function splitByGroup(members: readonly Member[]): [string, Member[]][] {
  const out = new Map<string, Member[]>()
  for (const m of members) {
    const key = m.group_label ?? UNGROUPED_LABEL
    const list = out.get(key)
    if (list) list.push(m)
    else out.set(key, [m])
  }
  const entries = [...out.entries()]
  return entries.sort((a, b) =>
    a[0] === UNGROUPED_LABEL ? 1 : b[0] === UNGROUPED_LABEL ? -1 : 0)
}

const UNGROUPED_LABEL = '未分組'

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
