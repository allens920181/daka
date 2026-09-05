import type { Member, MemberStatus } from './types'

/**
 * rev 是每筆狀態變更的版本號，合併時「rev 大的勝」。
 *
 * 產生方式取 `max(已見過的最大 rev + 1, 現在時間毫秒)`：
 * - 用時間讓不同裝置的變更大致依真實先後排序
 * - 用 +1 保證同一台裝置嚴格遞增，就算系統時鐘倒退或多次操作落在同一毫秒
 * - 收到別人的 rev 後也會被納入 max，所以「我看過你的值之後再改」一定贏
 *
 * 這是簡化版的混合邏輯時鐘。這個場景不需要 CRDT：人上了車就不會下車，
 * 狀態只是一個列舉值，衝突罕見且無害。
 */
export function nextRev(maxSeenRev: number, now: number = Date.now()): number {
  return Math.max(maxSeenRev + 1, now)
}

export function maxRev(members: readonly Member[]): number {
  let max = 0
  for (const m of members) if (m.rev > max) max = m.rev
  return max
}

/**
 * 同一個成員的兩個版本取勝者。
 * 名單欄位（姓名、備註、攜伴、分組）一律以遠端為準——那是擁有者改的；
 * 只有狀態欄位參與 rev 比大小。平手時採用遠端，確保每台裝置得到相同結果。
 */
export function pickWinner(local: Member, remote: Member): Member {
  if (local.rev > remote.rev) {
    return {
      ...remote,
      status: local.status,
      status_at: local.status_at,
      status_by: local.status_by,
      rev: local.rev,
    }
  }
  return remote
}

/**
 * 把遠端快照合併進本地狀態。
 *
 * 成員的增刪一律以遠端為準，唯一的例外是「還在待送佇列裡的臨時加人」——
 * 那些人遠端還沒有，但不能因此從畫面上消失。`pendingAddIds` 就是用來
 * 區分「還沒送出的新增」與「擁有者刪掉的人」。
 */
export function mergeMembers(
  local: readonly Member[],
  remote: readonly Member[],
  pendingAddIds: ReadonlySet<string> = new Set(),
): Member[] {
  const localById = new Map(local.map((m) => [m.id, m]))
  const remoteIds = new Set(remote.map((m) => m.id))

  const merged = remote.map((r) => {
    const l = localById.get(r.id)
    return l ? pickWinner(l, r) : r
  })

  for (const m of local) {
    if (!remoteIds.has(m.id) && pendingAddIds.has(m.id)) merged.push(m)
  }

  return merged
}

/**
 * 套用「單一成員」的遠端更新（Realtime 廣播收到的那一筆）。
 *
 * 這跟 mergeMembers 不同，別搞混：mergeMembers 的 remote 是「整份快照」，
 * 名單上沒有的人會被移除；這裡的 incoming 只是一個人，其他人不受影響。
 */
export function applyRemoteMember(local: readonly Member[], incoming: Member): Member[] {
  const idx = local.findIndex((m) => m.id === incoming.id)
  if (idx === -1) return [...local, incoming]
  const next = [...local]
  next[idx] = pickWinner(local[idx] as Member, incoming)
  return next
}

/** 在本地立即套用狀態變更（畫面不等網路）。 */
export function applyStatusLocally(
  members: readonly Member[],
  memberId: string,
  status: MemberStatus,
  by: string | null,
  now: number = Date.now(),
): { members: Member[]; rev: number } {
  const rev = nextRev(maxRev(members), now)
  const next = members.map((m) =>
    m.id === memberId
      ? { ...m, status, status_at: new Date(now).toISOString(), status_by: by, rev }
      : m,
  )
  return { members: next, rev }
}

export interface Override {
  member: Member
  previousStatus: MemberStatus
}

/**
 * 找出「我剛改過、但被別人的較新變更蓋掉」的成員。
 *
 * LWW 讓合併有明確的勝負，但靜默覆蓋很危險：A 剛把王小明標成已到，
 * B 同時標成未到，B 的 rev 較大就贏了——如果 A 完全不知道，
 * 他會以為王小明已經上車。所以輸掉的那一邊必須被告知。
 *
 * `mine` 是這台裝置近期改過的成員 id。只看這些人，才不會把
 * 「別人改別人的」也當成衝突報出來。
 */
export function detectOverrides(
  before: readonly Member[],
  after: readonly Member[],
  mine: ReadonlySet<string>,
): Override[] {
  if (mine.size === 0) return []
  const afterById = new Map(after.map((m) => [m.id, m]))
  const out: Override[] = []
  for (const prev of before) {
    if (!mine.has(prev.id)) continue
    const next = afterById.get(prev.id)
    if (!next) continue
    if (next.rev > prev.rev && next.status !== prev.status) {
      out.push({ member: next, previousStatus: prev.status })
    }
  }
  return out
}

export interface RosterSummary {
  /** 名單列數。 */
  people: number
  /** 名單上的總人頭，含攜伴。 */
  headcount: number
  arrived: number
  arrivedHeadcount: number
  /** 還沒到。這是主畫面要突顯的數字。 */
  pending: number
  pendingHeadcount: number
  /**
   * 今天該上車的人頭。請假 2026-09 拿掉之後它就等於 headcount，但欄位留著：
   * 進度條、「x / y 人」、結束橫幅用的都是它，而「該到幾個」與「名單上有幾個」
   * 是兩個不同的問題——哪天再長出「不算今天」的狀態，要改的只有這一行。
   */
  expectedHeadcount: number
}

export function summarize(members: readonly Member[]): RosterSummary {
  const s: RosterSummary = {
    people: members.length, headcount: 0,
    arrived: 0, arrivedHeadcount: 0,
    pending: 0, pendingHeadcount: 0,
    expectedHeadcount: 0,
  }
  for (const m of members) {
    const heads = 1 + m.companions
    s.headcount += heads
    if (m.status === 'arrived') {
      s.arrived++
      s.arrivedHeadcount += heads
    } else {
      s.pending++
      s.pendingHeadcount += heads
    }
  }
  s.expectedHeadcount = s.headcount
  return s
}
