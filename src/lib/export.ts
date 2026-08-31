import type { Member, Room } from './types'
import { summarize } from './merge'

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
export function toShareText(room: Room, members: readonly Member[], group?: string | null): string {
  const scoped = group ? members.filter((m) => m.group_label === group) : members
  const s = summarize(scoped)
  const missing = scoped.filter((m) => m.status === 'pending')
  const excused = scoped.filter((m) => m.status === 'excused')

  const lines = [
    group ? `${room.name} · ${group}` : room.name,
    `已到 ${s.arrivedHeadcount} / ${s.headcount} 人`,
  ]
  if (missing.length > 0) {
    lines.push(`未到 ${missing.length} 位：${missing.map((m) => m.name).join('、')}`)
  } else {
    lines.push('全部到齊')
  }
  if (excused.length > 0) {
    lines.push(`請假 ${excused.length} 位：${excused.map((m) => m.name).join('、')}`)
  }
  return lines.join('\n')
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
