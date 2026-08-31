import type { DraftMember, MemberStatus } from './types'

export interface ParseResult {
  members: DraftMember[]
  /** 解析到的分組名稱，依出現順序。 */
  groups: string[]
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

/**
 * 分組標題行。真實的 LINE 接龍分車長這樣：
 *
 *   【第一車】
 *   1.王小明
 *   2.李美花
 *   【第二車】
 *   3.陳大同
 *
 * 所以分組是「區段標題」而不是每個人的標籤。標題之後的人都屬於它，
 * 直到下一個標題為止。
 */
// normalizeWidth 已經把【】［］轉成 []，所以這裡要認的是半形方括號。
// 整行只有括號內容才算標題——`王小明[遲到]` 的括號是備註，不是分組。
const GROUP_BRACKETED = /^[\s\-–—=*]*[[〖《]\s*(.{1,20}?)\s*[\]〗》][\s\-–—=*:：]*$/
const GROUP_BARE = /^[\s\-–—=*]*(第?[一二三四五六七八九十百\d]{1,3}\s*[車組隊桌梯團班]|[A-Za-z]\s*[車組隊桌])[\s\-–—=*:：]*$/

/** 明確表示「這之後的人沒有分組」。rosterToText 會寫出這個標記。 */
const GROUP_NONE = /^(未分組|無分組|沒分組|—|-)$/

function groupHeader(line: string): string | null {
  const bracketed = line.match(GROUP_BRACKETED)
  if (bracketed?.[1]) return bracketed[1].trim()
  const bare = line.match(GROUP_BARE)
  if (bare?.[1]) return bare[1].replace(/\s+/g, '')
  return null
}

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

/**
 * 名單上寫「（請假）」的人，狀態就該直接是請假，而不是備註。
 * 否則他會混在未到清單裡被打電話——而他早就說過不去了。
 * 只認短備註，避免「請假單已交但還是會去」這種句子被誤判。
 */
const EXCUSED_WORDS = ['請假', '不去', '不參加', '不能去', '不出席', '取消', '缺席', '退出']
const EXCUSED_WORDS_EN = ['absent', 'excused', 'cancel', 'not going', 'no show']

/**
 * 這則備註本身就是「請假」的意思嗎？
 *
 * 名單上寫「陳大同（請假）」時，備註是「請假」而狀態也會被判成請假。畫面上
 * 兩個都印的話就會出現「請假 請假」——螢幕上與紙本上都是。狀態自己會說，
 * 備註就不必再說一次。（「請假 已請假單」這種有額外資訊的備註仍要印出來，
 * 所以比對的是整則備註，不是「有沒有包含請假兩個字」。）
 */
export function isExcusedNote(note: string | null): boolean {
  if (!note) return false
  const trimmed = note.trim()
  const lower = trimmed.toLowerCase()
  return EXCUSED_WORDS.includes(trimmed) || EXCUSED_WORDS_EN.includes(lower)
}

function statusFromNote(note: string | null): MemberStatus | undefined {
  if (!note) return undefined
  const trimmed = note.trim()
  if (trimmed.length > 8) return undefined
  const lower = trimmed.toLowerCase()
  const hit = EXCUSED_WORDS.some((w) => trimmed.includes(w)) ||
              EXCUSED_WORDS_EN.some((w) => lower.includes(w))
  return hit ? 'excused' : undefined
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

  const trimmedNote = note ? note.slice(0, 200) : null
  const status = statusFromNote(trimmedNote)

  return {
    name: name.slice(0, 60),
    note: trimmedNote,
    phone,
    companions: Math.min(Math.max(companions, 0), 99),
    group_label: null,
    ...(status ? { status } : {}),
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
  let group: string | null = null

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue

    const header = groupHeader(line)
    if (header !== null) {
      group = GROUP_NONE.test(header) ? null : header.slice(0, 20)
      continue
    }

    for (const part of splitInlineNumbering(line)) {
      if (!part.trim()) continue
      const entry = parseEntry(part)
      if (entry) members.push(group ? { ...entry, group_label: group } : entry)
      else skipped++
    }
  }

  const counts = new Map<string, number>()
  for (const m of members) counts.set(m.name, (counts.get(m.name) ?? 0) + 1)
  const duplicateNames = [...counts.entries()].filter(([, n]) => n > 1).map(([n]) => n)

  return { members, groups: groupsOf(members), duplicateNames, skipped }
}

/** 名單裡出現過的分組，依第一次出現的順序。 */
export function groupsOf(members: readonly { group_label: string | null }[]): string[] {
  const seen: string[] = []
  for (const m of members) {
    if (m.group_label && !seen.includes(m.group_label)) seen.push(m.group_label)
  }
  return seen
}

/**
 * 名單轉回可編輯的文字（用於「編輯名單」時把現有名單填回輸入框）。
 * 分組寫成標題行，並在分組結束時明確寫出「未分組」——
 * 否則往返之後那些人會被吸進上一個分組裡，是無聲的資料變更。
 */
export function rosterToText(members: readonly DraftMember[]): string {
  const lines: string[] = []
  let current: string | null = null
  let started = false

  for (const m of members) {
    const group = m.group_label ?? null
    if (group !== current) {
      if (group) lines.push(`【${group}】`)
      else if (started) lines.push('【未分組】')
      current = group
    }
    started = true

    let s = m.name
    if (m.phone) s += ` ${m.phone}`
    if (m.companions > 0) s += ` +${m.companions}`
    if (m.note) s += `（${m.note}）`
    lines.push(s)
  }
  return lines.join('\n')
}
