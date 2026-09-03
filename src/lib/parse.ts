import type { DraftMember, MemberStatus } from './types'

/**
 * 一位成員在原始文字裡的來源位置。
 *
 * 用來支援預覽的「移除」：文字仍然是唯一的真相，移除是去改那段文字，而不是
 * 在解析結果上動手腳。一行可能因為行內編號（「1.王小明 2.李美花」）產生
 * 多位成員，所以要記到 part 這一層。
 */
export interface MemberSource {
  /** 在 text.split(/\r?\n/) 裡的索引。 */
  line: number
  /** 在 splitInlineNumbering(line) 裡的索引。 */
  part: number
}

export interface ParseResult {
  members: DraftMember[]
  /** 與 members 平行：每一位在原始文字裡的位置。 */
  sources: MemberSource[]
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

/** 備註：括號內的內容。`（請假）` `[遲到]` */
const NOTE_PAREN = /[([]([^()[\]]{0,60})[)\]]/

/**
 * 名字與備註的切點：第一個「空白＋數字」。
 *
 * 這裡刻意**不判斷那串數字是什麼**。舊版會在一行裡到處找「看起來像台灣電話」
 * 的片段，於是「匯款 700-1234567」被抽成 `001234567`、名字變成「李美花 匯款 7」，
 * 而畫面上沒有一個字說得出為什麼——撥出去是空號，現場只會以為對方關機。
 * 猜錯的代價完全不對稱：漏抓只是號碼留在備註裡（看得見、還撥得到，見成員面板），
 * 亂抓卻是存下一個假號碼（看不見）。所以這裡只回答一個沒有歧義的問題：
 * 「名字到哪裡結束？」——答案是第一次出現「空白後面接數字」的地方。
 *
 * 切在空白而不是第一個數字，是為了英文名字：「Alice Chen 0912345678」要切在
 * 號碼前面，不是切在 Chen 前面（中文名字沒有空格，英文有）。也因此
 * 「陳大同 A123456789」不會被切——空白後面是 A 不是數字。
 */
const NAME_TAIL = /\s+(?=[(+]?\d)/

/**
 * 行內編號的切點。回傳的是索引而不是字串，因為 removeParsedMember 要拿這些
 * 索引去切**使用者原本打的那一行**，而切點是在正規化過的文字上算出來的。
 * （normalizeWidth 全部是一對一的字元替換，長度與位置都不變，所以索引通用。）
 */
function inlineBoundaries(line: string): number[] {
  const starts: number[] = []
  INLINE_MARKER.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = INLINE_MARKER.exec(line)) !== null) {
    // 比對可能以空白開頭，把起點推到數字上。
    starts.push(m.index + (/^\s/.test(m[0]) ? 1 : 0))
    INLINE_MARKER.lastIndex = m.index + m[0].length
  }
  // 至少要兩個編號才敢切，避免把「房2號」之類的名字切壞。
  if (starts.length < 2) return []

  const cuts: number[] = []
  const first = starts[0] ?? 0
  if (first > 0) cuts.push(0)
  for (const st of starts) cuts.push(st)
  return cuts
}

function sliceAt(line: string, cuts: readonly number[]): string[] {
  if (cuts.length === 0) return [line]
  return cuts.map((c, i) => line.slice(c, cuts[i + 1] ?? line.length))
}

function splitInlineNumbering(line: string): string[] {
  return sliceAt(line, inlineBoundaries(line))
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

  // 括號備註先抽，而且與行尾那段分開存著：「請假」的判定只看括號裡的字
  // （`李美花 0912345678（請假）` 的狀態仍要是請假，不能被前面那串數字沖淡）。
  let paren: string | null = null
  const parenMatch = s.match(NOTE_PAREN)
  const inner = (parenMatch?.[1] ?? '').trim()
  // 括號裡全是數字的不是備註，是市話的區碼：`(02)2345-6789` 若在這裡被拆走，
  // 剩下的「2345-6789」就再也撥不出去了。備註是寫給人看的字。
  if (parenMatch && !/^\d+$/.test(inner)) {
    if (inner) paren = inner
    s = s.replace(NOTE_PAREN, ' ')
  }

  // 名字到第一個「空白＋數字」為止，後面整段都是備註。電話、匯款帳號、身分證、
  // 座位號——一律原文照抄，不分類。要撥號的話，成員面板會把備註裡撥得出去的
  // 數字做成撥號鍵（`dialableFrom`）。
  const cut = s.search(NAME_TAIL)
  const tail = cut === -1 ? '' : s.slice(cut).replace(/\s+/g, ' ').trim()
  const head = cut === -1 ? s : s.slice(0, cut)

  const name = head
    .replace(/^@+/, '')
    .replace(/[,:：;；]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()

  // 只剩符號或數字的行不算名字（例如貼進來的空編號、分隔線）。
  if (!name || !/[\p{L}\p{N}]/u.test(name) || /^[\d\s.\-_=~]+$/.test(name)) return null

  // 兩段備註接起來，行尾那段在前——原文裡它通常就排在括號前面。
  const merged = [tail, paren].filter(Boolean).join(' ')
  const trimmedNote = merged ? merged.slice(0, 200) : null
  const status = statusFromNote(paren)

  return {
    name: name.slice(0, 60),
    note: trimmedNote,
    phone: null,
    // 攜伴不再從文字裡認。`+1`、`帶2人` 就跟號碼一樣留在備註裡給人看——
    // 這個欄位只剩舊名單的資料會有值（`rosterToText` 仍然寫得出來）。
    companions: 0,
    group_label: null,
    ...(status ? { status } : {}),
  }
}

/**
 * 把貼上的文字解析成名單。
 * 刻意寬容：LINE 接龍的編號、全形標點、括號備註都吃得下來，
 * 但不做「猜測式」的修正 —— UI 會先顯示解析結果讓主揪確認再載入。
 */
export function parseRoster(input: string): ParseResult {
  const text = normalizeWidth(input ?? '')
  const members: DraftMember[] = []
  const sources: MemberSource[] = []
  let skipped = 0
  let group: string | null = null

  const lines = text.split(/\r?\n/)
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li] ?? ''
    if (!line.trim()) continue

    const header = groupHeader(line)
    if (header !== null) {
      group = GROUP_NONE.test(header) ? null : header.slice(0, 20)
      continue
    }

    const parts = splitInlineNumbering(line)
    for (let pi = 0; pi < parts.length; pi++) {
      const part = parts[pi] ?? ''
      if (!part.trim()) continue
      const entry = parseEntry(part)
      if (entry) {
        members.push(group ? { ...entry, group_label: group } : entry)
        sources.push({ line: li, part: pi })
      } else skipped++
    }
  }

  const counts = new Map<string, number>()
  for (const m of members) counts.set(m.name, (counts.get(m.name) ?? 0) + 1)
  const duplicateNames = [...counts.entries()].filter(([, n]) => n > 1).map(([n]) => n)

  return { members, sources, groups: groupsOf(members), duplicateNames, skipped }
}

/**
 * 從原始文字裡拿掉某一位成員，回傳新的文字。
 *
 * 解析器刻意不自動猜（「秋季旅遊報名」該不該算一個人，機器判斷不了），所以
 * 這裡的作法是把決定權交回去：預覽上看到不對的那一列，按一下就從文字裡消失。
 * 文字仍然是唯一的真相——改完重新解析，其他人的位置自然跟著更新。
 *
 * `splitInlineNumbering` 切出來的每一段都是原字串的連續切片，接回去會完全
 * 還原原本那一行，所以這裡不會弄壞使用者貼進來的格式。
 */
export function removeParsedMember(input: string, at: MemberSource): string {
  const raw = input ?? ''
  const nl = raw.includes('\r\n') ? '\r\n' : '\n'
  const lines = raw.split(/\r?\n/)
  const line = lines[at.line]
  if (line === undefined) return raw

  // 解析走的是正規化過的文字，但這裡要改的是使用者原本打的字。切點在正規化
  // 後的行上算（全形「１．」要正規化成「1.」才認得出是編號），再拿同一組索引
  // 去切原字串——normalizeWidth 是一對一的字元替換，位置不會跑掉。
  const cuts = inlineBoundaries(normalizeWidth(line))
  if (cuts.length === 0) {
    lines.splice(at.line, 1)
    return lines.join(nl)
  }

  const parts = sliceAt(line, cuts)
  const rest = parts.filter((_, i) => i !== at.part).join('')
  if (!rest.trim()) lines.splice(at.line, 1)
  else lines[at.line] = rest
  return lines.join(nl)
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
    // 純數字的備註不能寫進括號：解析時「括號裡全是數字」會被當成市話區碼而
    // 不是備註（`(02)2345-6789`），往返一趟就會變成名字的一部分。
    if (m.note) s += /^\d+$/.test(m.note) ? ` ${m.note}` : `（${m.note}）`
    lines.push(s)
  }
  return lines.join('\n')
}

/**
 * 備註裡撥得出去的號碼。
 *
 * 解析階段刻意不判斷任何一串數字是什麼（見 `NAME_TAIL`），所以「要撥給他」這
 * 件事改在顯示階段回答——而顯示階段猜錯是可逆、可見的：多出一顆撥號鍵而已，
 * 備註原文一個字都沒動，使用者自己看得到那串數字到底是什麼。存進資料庫的假
 * 號碼才是不可見的那種錯。
 *
 * 判準只有兩條：以 `0`（國內）或 `+`（國際）開頭，總長 8～15 碼。郵局帳號
 * 「700-1234567」、身分證、統編都不是 0 或 + 開頭，所以不會冒出撥號鍵；真的
 * 漏掉的號碼仍然原文躺在備註裡，複製得到。
 */
export function dialableFrom(note: string | null): string[] {
  if (!note) return []
  const out: string[] = []
  for (const m of note.matchAll(/\(?[+0][\d\s\-.()]{6,16}\d/g)) {
    // 起點前面若還是數字，這就是從一串更長的數字中間切下來的——「700-1234567」
    // 的第二個 0 起跳剛好湊得出 10 碼，而那是郵局帳號，不是電話。
    if (/\d/.test(note[m.index - 1] ?? '')) continue
    // 「+1 0912345678」的 +1 是攜伴（不再解析，所以整段留在備註裡），不是國碼——
    // 黏在一起會撥出 tel:+10912345678。判準跟現實一致：`+N` 後面那串以 0 開頭的
    // 就是台灣號碼，號碼從那個 0 開始。
    const raw = (m[0].trim().match(/^\+\s*\d{1,3}[\s\-.]+(0[\d\s\-.()]*\d)$/)?.[1] ?? m[0]).trim()
    const digits = raw.replace(/\D/g, '')
    if (digits.length < 8 || digits.length > 15) continue
    if (!out.includes(raw)) out.push(raw)
    if (out.length === 3) break
  }
  return out
}

/** `dialableFrom` 給的字串轉成 `tel:` 用的形式（保留國際碼的 +）。 */
export function telHref(raw: string): string {
  return `tel:${raw.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '')}`
}
