import type { DraftMember } from './types'

export interface ParseResult {
  members: DraftMember[]
  /** 出現超過一次的名字。不會自動去重（同名的人是真實存在的），只提醒。 */
  duplicateNames: string[]
  /** 被判定為非姓名而略過的行數。 */
  skipped: number
}

/** 全形英數與常見標點轉半形，讓後面的比對只要處理一種寬度。 */
function normalizeWidth(input: string): string {
  return input
    .replace(/[０-９Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/　/g, ' ')
    .replace(/[．。]/g, '.')
    .replace(/＋/g, '+')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/[［【]/g, '[')
    .replace(/[］】]/g, ']')
}

/** 開頭的編號或項目符號：`1.` `2、` `3)` `10 ` `- ` `• ` */
const LEADING_MARKER = /^\s*(?:\d{1,3}\s*[.、):：,]\s*|\d{1,3}\s+|[-–—•·*✦▪◦]\s+)/

/** 行內編號（一行被貼成 `1.甲 2.乙 3.丙` 的情況）。 */
const INLINE_MARKER = /(?:^|\s)\d{1,3}\s*[.、)]\s*(?=\S)/g

/** 攜伴：`+1`、`＋ 2`、`帶2人`、`帶3位`。 */
const COMPANION_PLUS = /\+\s*(\d{1,2})(?!\d)/
const COMPANION_BRING = /帶\s*(\d{1,2})\s*[人位個名]?/

/** 備註：括號內的內容。`（請假）` `[遲到]` */
const NOTE_PAREN = /[([]([^()[\]]{0,60})[)\]]/

/**
 * 電話。台灣手機 09xxxxxxxx、市話 0x-xxxxxxx、+886 開頭都要吃得下，
 * 而且要在備註之前抽出來——`(02)2345-6789` 的區碼括號會被當成備註。
 */
const PHONE_CANDIDATE = /(?:\+?886[-\s.]?|\(?0\)?)[\d\-\s.()]{7,15}/g

function extractPhone(input: string): { phone: string | null; rest: string } {
  PHONE_CANDIDATE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = PHONE_CANDIDATE.exec(input)) !== null) {
    let digits = m[0].replace(/\D/g, '')
    if (digits.startsWith('886')) digits = `0${digits.slice(3)}`
    // 台灣號碼是 0 開頭的 9～10 碼。長度不對就不是電話，繼續往後找。
    if (/^0\d{8,9}$/.test(digits)) {
      return { phone: digits, rest: `${input.slice(0, m.index)} ${input.slice(m.index + m[0].length)}` }
    }
  }
  return { phone: null, rest: input }
}

function splitInlineNumbering(line: string): string[] {
  const starts: number[] = []
  INLINE_MARKER.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = INLINE_MARKER.exec(line)) !== null) {
    // 比對可能以空白開頭，把起點推到數字上。
    starts.push(m.index + (/^\s/.test(m[0]) ? 1 : 0))
    INLINE_MARKER.lastIndex = m.index + m[0].length
  }
  // 至少要兩個編號才敢切，避免把「房2號」之類的名字切壞。
  if (starts.length < 2) return [line]

  const parts: string[] = []
  const first = starts[0] ?? 0
  if (first > 0) parts.push(line.slice(0, first))
  for (let i = 0; i < starts.length; i++) {
    parts.push(line.slice(starts[i] ?? 0, starts[i + 1] ?? line.length))
  }
  return parts
}

function parseEntry(raw: string): DraftMember | null {
  let s = raw.replace(LEADING_MARKER, '').trim()
  if (!s) return null

  // 電話最先抽：它的括號與連字號會干擾後面的備註與攜伴比對。
  const withPhone = extractPhone(s)
  const phone = withPhone.phone
  s = withPhone.rest

  let companions = 0
  const plus = s.match(COMPANION_PLUS)
  if (plus?.[1]) {
    companions = Number(plus[1])
    s = s.replace(COMPANION_PLUS, ' ')
  } else {
    const bring = s.match(COMPANION_BRING)
    if (bring?.[1]) {
      companions = Number(bring[1])
      s = s.replace(COMPANION_BRING, ' ')
    }
  }

  let note: string | null = null
  const paren = s.match(NOTE_PAREN)
  if (paren) {
    const inner = (paren[1] ?? '').trim()
    if (inner) note = inner
    s = s.replace(NOTE_PAREN, ' ')
  }

  const name = s
    .replace(/^@+/, '')
    .replace(/[,:：;；]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()

  // 只剩符號或數字的行不算名字（例如貼進來的空編號、分隔線）。
  if (!name || !/[\p{L}\p{N}]/u.test(name) || /^[\d\s.\-_=~]+$/.test(name)) return null

  return {
    name: name.slice(0, 60),
    note: note ? note.slice(0, 200) : null,
    phone,
    companions: Math.min(Math.max(companions, 0), 99),
    group_label: null,
  }
}

/**
 * 把貼上的文字解析成名單。
 * 刻意寬容：LINE 接龍的編號、全形標點、`+1` 攜伴、括號備註都吃得下來，
 * 但不做「猜測式」的修正 —— UI 會先顯示解析結果讓主揪確認再載入。
 */
export function parseRoster(input: string): ParseResult {
  const text = normalizeWidth(input ?? '')
  const members: DraftMember[] = []
  let skipped = 0

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    for (const part of splitInlineNumbering(line)) {
      if (!part.trim()) continue
      const entry = parseEntry(part)
      if (entry) members.push(entry)
      else skipped++
    }
  }

  const counts = new Map<string, number>()
  for (const m of members) counts.set(m.name, (counts.get(m.name) ?? 0) + 1)
  const duplicateNames = [...counts.entries()].filter(([, n]) => n > 1).map(([n]) => n)

  return { members, duplicateNames, skipped }
}

/** 名單轉回可編輯的文字（用於「編輯名單」時把現有名單填回輸入框）。 */
export function rosterToText(members: DraftMember[]): string {
  return members
    .map((m) => {
      let s = m.name
      if (m.phone) s += ` ${m.phone}`
      if (m.companions > 0) s += ` +${m.companions}`
      if (m.note) s += `（${m.note}）`
      return s
    })
    .join('\n')
}
