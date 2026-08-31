import { computed, signal } from '@preact/signals'
import type { RealtimeChannel } from '@supabase/realtime-js'
import type {
  ConnectionState, DraftMember, Identity, Member, MemberStatus,
  OwnedRoom, PendingOp, Room, SavedRoster,
} from './types'
import { AppError, api, isSupabaseConfigured, realtimeChannel } from './supabase'
import { AuthError, currentSession, requestCode, restoreSession, signOut as authSignOut, verifyCode, type Session } from './auth'
import { generateId, generateRoomCode, normalizeRoomCode } from './code'
import { applyRemoteMember, applyStatusLocally, detectOverrides, mergeMembers, summarize } from './merge'
import { groupsOf } from './parse'
import { translate } from './i18n'
import { countForRoom, dequeue, enqueue, flushOrder, pendingAddIds } from './outbox'
import {
  DEFAULT_PREFS, type Prefs, type RecentRoom,
  dropRecentRoom, forgetRoom, loadIdentity, loadOutbox, loadPrefs, loadRecentRooms,
  loadRoom, rememberRoom, saveIdentity, saveOutbox, savePrefs, saveRoom,
} from './storage'

// ---------------------------------------------------------------------------
// 狀態
// ---------------------------------------------------------------------------

export const booted = signal(false)
export const prefs = signal<Prefs>(DEFAULT_PREFS)
export const identity = signal<Identity>({ ownerKey: '', checkerName: '' })
export const recentRooms = signal<RecentRoom[]>([])
export const savedRosters = signal<SavedRoster[]>([])
/** 主揪帳號。null = 沒登入（協助點名的人永遠是這個狀態）。 */
export const session = signal<Session | null>(null)
/** 我開過的活動，跨裝置。只有登入後才有內容。 */
export const myRooms = signal<OwnedRoom[]>([])

export const room = signal<Room | null>(null)
export const members = signal<Member[]>([])
export const outbox = signal<PendingOp[]>([])
export const connection = signal<ConnectionState>(isSupabaseConfigured ? 'offline' : 'local-only')
export const busy = signal(false)

export interface ToastState {
  text: string
  action?: { label: string; run: () => void }
}
export const toast = signal<ToastState | null>(null)

export const summary = computed(() => summarize(members.value))
/** 名單裡出現過的分組（分車），依第一次出現的順序。 */
export const groups = computed(() => groupsOf(members.value))
export const pendingUploads = computed(() =>
  room.value ? countForRoom(outbox.value, room.value.code) : 0,
)
/**
 * 剛複製出來的房號。房間畫面進來看到自己就會自動打開分享面板，然後清掉。
 *
 * 複製回程房會換一組新房號，而五支協助的手機還開著舊房——他們的畫面完全沒有
 * 變化，會繼續在舊房打勾。這是整條動線裡最貴的失敗，而且是靜默的。
 */
export const shareOnEnter = signal<string | null>(null)

export const isOwner = computed(() => {
  const code = room.value?.code
  if (!code) return false
  // 本機開的，或帳號名下的——換手機登入後也要管得動。
  return recentRooms.value.some((r) => r.code === code && r.isOwner)
    || myRooms.value.some((r) => r.code === code)
})

let currentCode: string | null = null
let channel: RealtimeChannel | null = null
let reconcileTimer: ReturnType<typeof setInterval> | undefined
let persistTimer: ReturnType<typeof setTimeout> | undefined
let toastTimer: ReturnType<typeof setTimeout> | undefined
let flushing = false

/**
 * 這台裝置近期改過的成員，用來判斷「我改的被別人蓋掉了」。
 * 只保留 90 秒：更久以前的變更被覆蓋，不再算是需要當場提醒的衝突。
 */
const OVERRIDE_WINDOW_MS = 90_000
const recentlyChanged = new Map<string, number>()

function rememberChange(memberId: string): void {
  recentlyChanged.set(memberId, Date.now())
}

function myRecentChanges(): Set<string> {
  const cutoff = Date.now() - OVERRIDE_WINDOW_MS
  for (const [id, at] of recentlyChanged) if (at < cutoff) recentlyChanged.delete(id)
  return new Set(recentlyChanged.keys())
}

const STATUS_KEY = { arrived: 'arrived', pending: 'missing', excused: 'excused' } as const

/**
 * 告訴使用者他剛才的點名被別人改掉了。
 *
 * LWW 讓合併有明確勝負，但靜默覆蓋很危險：我把王小明標成已到、
 * 別人同時標成未到而且贏了，如果我完全不知道，就會以為他已經上車。
 */
function announceOverrides(before: readonly Member[], after: readonly Member[]): void {
  const overrides = detectOverrides(before, after, myRecentChanges())
  if (overrides.length === 0) return

  const lang = prefs.value.lang
  const first = overrides[0] as { member: Member }
  const m = first.member
  const status = translate(lang, STATUS_KEY[m.status])

  // 被蓋掉的人已經不是「我改的」了，別再重複提醒同一筆。
  for (const o of overrides) recentlyChanged.delete(o.member.id)

  showToast(
    overrides.length > 1
      ? translate(lang, 'overriddenMany', { n: overrides.length })
      : m.status_by
        ? translate(lang, 'overridden', { name: m.name, who: m.status_by, status })
        : translate(lang, 'overriddenAnon', { name: m.name, status }),
    undefined,
    7000,
  )
}

// ---------------------------------------------------------------------------
// 啟動
// ---------------------------------------------------------------------------

export async function boot(): Promise<void> {
  identity.value = await loadIdentity()
  session.value = await restoreSession()
  prefs.value = await loadPrefs()
  recentRooms.value = await loadRecentRooms()
  outbox.value = await loadOutbox()
  applyTheme()
  applyLang()
  window.addEventListener('online', handleOnline)
  window.addEventListener('offline', handleOffline)
  document.addEventListener('visibilitychange', handleVisibility)
  booted.value = true
  void flushOutbox()
  void refreshRosters()
  void refreshMyRooms()
}

// ---------------------------------------------------------------------------
// 主揪帳號
// ---------------------------------------------------------------------------

export { AuthError, requestCode }

/**
 * 驗證六碼並登入。
 *
 * 登入後立刻認領這台裝置本來就擁有的房間與常用名單——否則使用者會登入完
 * 卻發現「我的活動」是空的，然後以為壞掉了。
 */
export async function signIn(email: string, code: string): Promise<{ rooms: number; rosters: number }> {
  const s = await verifyCode(email, code)
  session.value = s
  let claimed = { rooms: 0, rosters: 0 }
  try {
    claimed = await api.claimMine(identity.value.ownerKey)
  } catch {
    /* 認領失敗不該讓登入失敗；下次啟動還會再試。 */
  }
  await refreshMyRooms()
  await refreshRosters()
  return claimed
}

export async function signOut(): Promise<void> {
  await authSignOut()
  session.value = null
  myRooms.value = []
  // 常用名單在未登入時是看裝置的，重新拉一次才會正確。
  await refreshRosters()
}

export async function refreshMyRooms(): Promise<void> {
  if (!isSupabaseConfigured || !currentSession()) {
    myRooms.value = []
    return
  }
  try {
    myRooms.value = await api.myRooms()
  } catch {
    /* 拿不到我的活動不影響點名，靜默失敗。 */
  }
}

function handleOnline(): void {
  void flushOutbox().then(() => reconcile().catch(() => {}))
  // 身分也要跟著恢復。refreshMyRooms 只在啟動與登入時跑過，訊號差時它靜默
  // 失敗，於是換過手機的主揪會被降級成「協助點名」——管理功能整片消失，
  // 畫面還當著他的面把他標成協助者，而且連上網也不會自己好。
  void refreshMyRooms()
}

function handleOffline(): void {
  if (isSupabaseConfigured) connection.value = 'offline'
}

function handleVisibility(): void {
  // 回到前景時立刻對帳一次：廣播是盡力而為，這裡才是正確性的保底。
  if (!document.hidden) void reconcile().catch(() => {})
}

// ---------------------------------------------------------------------------
// 偏好設定
// ---------------------------------------------------------------------------

/**
 * 讓 <html lang> 跟著 App 的語言走。
 *
 * index.html 寫死 zh-TW，切成英文之後螢幕閱讀器仍然會用中文語音去唸英文介面。
 */
export function applyLang(): void {
  if (typeof document === 'undefined') return
  document.documentElement.lang = prefs.value.lang === 'en' ? 'en' : 'zh-TW'
}

export function applyTheme(): void {
  const theme = prefs.value.theme
  const root = document.documentElement
  if (theme === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
}

export async function setPrefs(patch: Partial<Prefs>): Promise<void> {
  prefs.value = { ...prefs.value, ...patch }
  applyTheme()
  applyLang()
  await savePrefs(prefs.value)
}

export async function setCheckerName(name: string): Promise<void> {
  identity.value = { ...identity.value, checkerName: name.trim().slice(0, 40) }
  await saveIdentity(identity.value)
}

// ---------------------------------------------------------------------------
// 觸覺回饋
// ---------------------------------------------------------------------------

/**
 * 點名成功時的短震動。
 *
 * 這不是裝飾：逆光下看不清螢幕、或視線正盯著排隊的人而不是手機時，
 * 震動是「這一下有記到」的第二個確認管道。
 * iOS Safari 不支援 navigator.vibrate，所以這是 Android 才有的加分項。
 */
/**
 * 震動回饋。逆光下看不清畫面時，手感是第二個確認管道——所以「記上車」和
 * 「從車上拿掉」不能震得一模一樣：一下短震是「收到了」，兩下是「拿掉了」。
 */
function haptic(pattern: number | number[] = 12): void {
  if (!prefs.value.haptics) return
  try {
    navigator.vibrate?.(pattern)
  } catch {
    /* 不支援或被使用者停用，忽略。 */
  }
}

const HAPTIC_ADD = 12
const HAPTIC_REMOVE = [10, 60, 10]

// ---------------------------------------------------------------------------
// 提示訊息
// ---------------------------------------------------------------------------

export function showToast(text: string, action?: ToastState['action'], ms = 5000): void {
  clearTimeout(toastTimer)
  toast.value = action ? { text, action } : { text }
  toastTimer = setTimeout(() => { toast.value = null }, ms)
}

export function dismissToast(): void {
  clearTimeout(toastTimer)
  toast.value = null
}

// ---------------------------------------------------------------------------
// 本地持久化
// ---------------------------------------------------------------------------

function persistSoon(): void {
  clearTimeout(persistTimer)
  persistTimer = setTimeout(() => { void persistNow() }, 200)
}

async function persistNow(): Promise<void> {
  const r = room.value
  if (r) await saveRoom(r, members.value)
}

async function persistOutbox(): Promise<void> {
  await saveOutbox(outbox.value)
}

// ---------------------------------------------------------------------------
// 連線狀態
// ---------------------------------------------------------------------------

function refreshConnection(): void {
  if (!isSupabaseConfigured) { connection.value = 'local-only'; return }
  if (typeof navigator !== 'undefined' && !navigator.onLine) { connection.value = 'offline'; return }
  connection.value = pendingUploads.value > 0 ? 'syncing' : 'online'
}

// ---------------------------------------------------------------------------
// 房間工作階段
// ---------------------------------------------------------------------------

function subscribe(code: string): void {
  channel = realtimeChannel(`room:${code}`)
  if (!channel) return
  channel.on('broadcast', { event: 'member' }, ({ payload }) => {
    const incoming = payload as Member | undefined
    if (!incoming?.id) return
    const before = members.value
    members.value = applyRemoteMember(before, incoming)
    announceOverrides(before, members.value)
    persistSoon()
  })
  // 名單被房主換掉、有人被刪除：這些改的是整份名單，直接重新拉快照。
  channel.on('broadcast', { event: 'roster' }, () => { void reconcile().catch(() => {}) })
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') refreshConnection()
  })
}

function broadcast(event: 'member' | 'roster', payload: unknown): void {
  channel?.send({ type: 'broadcast', event, payload }).catch(() => {
    /* 廣播失敗不影響正確性：其他裝置最慢在下一次對帳時會拿到。 */
  })
}

function startTimers(): void {
  stopTimers()
  // 定期對帳：廣播可能漏掉，這裡保證最多 15 秒內收斂。
  reconcileTimer = setInterval(() => {
    void flushOutbox().then(() => reconcile().catch(() => {}))
  }, 15_000)
}

function stopTimers(): void {
  if (reconcileTimer) clearInterval(reconcileTimer)
  reconcileTimer = undefined
}

export function leaveRoom(): void {
  recentlyChanged.clear()
  void persistNow()
  stopTimers()
  channel?.unsubscribe()
  channel = null
  currentCode = null
  room.value = null
  members.value = []
}

/**
 * 進入房間。先用本地快取立刻顯示，再向伺服器對帳。
 * 沒有快取又連不上時才會丟錯——這是唯一真的無法進入的情況。
 */
export async function enterRoom(code: string): Promise<void> {
  const c = normalizeRoomCode(code)
  leaveRoom()
  currentCode = c

  const cached = await loadRoom(c)
  if (cached) {
    room.value = cached.room
    members.value = cached.members
  }

  if (isSupabaseConfigured) {
    subscribe(c)
    startTimers()
    try {
      await reconcile()
    } catch (e) {
      if (!cached) { currentCode = null; throw e }
      // 有快取就繼續用，離線照常點名。
      if (e instanceof AppError && e.kind === 'offline') connection.value = 'offline'
    }
    // reconcile() 把 offline 吞下去自己處理了（它是背景對帳，不該讓畫面爆掉），
    // 所以這裡要自己檢查：第一次進房又拿不到快照時 room 仍是 null，畫面會停在
    // 骨架上一個字都沒有。掃 QR 的協助者站在車門口，看到的就是永遠的空白。
    if (!room.value) {
      currentCode = null
      throw new AppError(connection.value === 'offline' ? 'offline' : 'room-not-found')
    }
  } else if (!cached) {
    // 單機模式下別人的房號本來就進不來。丟 room-not-found 會讓掃 QR 的人看到
    // 「請確認有沒有打錯」，於是重打三次——錯的不是房號，是這個站台沒有雲端。
    currentCode = null
    throw new AppError('not-configured')
  }

  const r = room.value
  if (r) {
    // 帳號那一邊也算數：離線時 myRooms 可能是空的，但只要本機記得自己是主揪
    // 就不能因為這一次進房把標記洗掉。
    const wasOwner = (recentRooms.value.find((x) => x.code === c)?.isOwner ?? false) ||
      myRooms.value.some((x) => x.code === c)
    recentRooms.value = await rememberRoom({ code: c, name: r.name, isOwner: wasOwner, lastSeen: Date.now() })
  }
  refreshConnection()
}

/** 向伺服器拉取快照並合併。先把待送佇列推上去，再拉，避免拿到舊值。 */
export async function reconcile(): Promise<void> {
  const code = currentCode
  if (!code || !isSupabaseConfigured) { refreshConnection(); return }

  await flushOutbox()
  try {
    const snap = await api.getRoom(code)
    if (!snap) throw new AppError('room-not-found')
    room.value = snap.room
    const before = members.value
    members.value = mergeMembers(before, snap.members, pendingAddIds(outbox.value))
    announceOverrides(before, members.value)
    await persistNow()
    refreshConnection()
  } catch (e) {
    if (e instanceof AppError && e.kind === 'offline') { connection.value = 'offline'; return }
    throw e
  }
}

/** 這些錯誤重試多少次都不會成功，留在佇列只會擋住後面的操作。 */
const PERMANENT: ReadonlySet<string> = new Set(['room-not-found', 'room-closed', 'not-owner', 'too-many-members'])

export async function flushOutbox(): Promise<void> {
  if (flushing || !isSupabaseConfigured) return
  if (typeof navigator !== 'undefined' && !navigator.onLine) { refreshConnection(); return }
  if (outbox.value.length === 0) { refreshConnection(); return }

  flushing = true
  connection.value = 'syncing'
  const dropped: { kind: string; op: PendingOp }[] = []
  try {
    for (const op of flushOrder(outbox.value)) {
      try {
        const saved = op.kind === 'add'
          ? await api.addMember(op.code, {
              name: op.name, note: op.note, phone: op.phone,
              companions: op.companions, group_label: op.groupLabel,
            }, op.memberId)
          : await api.setStatus(op.code, op.memberId, op.status, op.rev, op.by)

        if (op.code === currentCode) {
          const before = members.value
          members.value = applyRemoteMember(before, saved)
          announceOverrides(before, members.value)
          persistSoon()
        }
        broadcast('member', saved)
        outbox.value = dequeue(outbox.value, op.key)
        await persistOutbox()
      } catch (e) {
        const kind = e instanceof AppError ? e.kind : 'unknown'
        if (kind === 'offline') break
        if (PERMANENT.has(kind)) {
          // 這一筆重試多少次都不會成功，留著只會擋住後面的操作——但也不能
          // 無聲丟掉。使用者已經看到自己把人點成「已到」了（本地先套用），
          // 靜靜刪掉佇列的話同步指示接著會翻成綠色的「已同步」，然後下一次
          // 對帳時那一列自己彈回「未到」，沒有任何人知道發生過什麼事。
          outbox.value = dequeue(outbox.value, op.key)
          await persistOutbox()
          dropped.push({ kind, op })
          continue
        }
        break
      }
    }
  } finally {
    flushing = false
    refreshConnection()
    if (dropped.length > 0) await announceDropped(dropped)
  }
}

/**
 * 伺服器永久拒絕的操作要當面說。訊息裡一定要有人名——「有一筆沒存到」在
 * 現場等於沒說，志工得知道是誰要重點一次。同時重新對帳，讓畫面回到伺服器
 * 的真相，而不是留著一個永遠不會上傳的假「已到」。
 */
async function announceDropped(dropped: { kind: string; op: PendingOp }[]): Promise<void> {
  const lang = prefs.value.lang
  const first = dropped[0]
  if (first) {
    const name = memberName(first.op) ?? translate(lang, 'someone')
    const key = first.kind === 'room-closed' ? 'dropClosed'
      : first.kind === 'not-owner' ? 'dropNotOwner'
      : first.kind === 'too-many-members' ? 'dropTooMany'
      : 'dropGone'
    const more = dropped.length - 1
    const text = translate(lang, key, { name })
    showToast(more > 0 ? `${text}（${translate(lang, 'dropMore', { n: more })}）` : text, undefined, 8000)
  }
  // 畫面上那一列還停在使用者以為成功的狀態，拉一次快照把它扳回真相。
  await reconcile().catch(() => {})
}

function memberName(op: PendingOp): string | null {
  if (op.kind === 'add') return op.name
  return members.value.find((m) => m.id === op.memberId)?.name ?? null
}

async function queue(op: PendingOp): Promise<void> {
  outbox.value = enqueue(outbox.value, op)
  await persistOutbox()
  void flushOutbox()
}

// ---------------------------------------------------------------------------
// 點名動作
// ---------------------------------------------------------------------------

export async function setStatus(memberId: string, status: MemberStatus): Promise<void> {
  const r = room.value
  if (!r || r.closed_at) return

  const previous = members.value.find((m) => m.id === memberId)
  if (!previous || previous.status === status) return

  const by = identity.value.checkerName || null
  const { members: next, rev } = applyStatusLocally(members.value, memberId, status, by)
  members.value = next
  rememberChange(memberId)
  haptic(status === 'arrived' ? HAPTIC_ADD : HAPTIC_REMOVE)
  persistSoon()

  await queue({
    kind: 'status', key: generateId(), code: r.code,
    memberId, status, rev, by, queuedAt: Date.now(),
  })
}

/** 誤觸的代價是有人被留在原地，所以每次變更都給一次無條件復原。 */
export async function setStatusWithUndo(
  memberId: string,
  status: MemberStatus,
  describe: (m: Member) => string,
  undoLabel: string,
): Promise<void> {
  const previous = members.value.find((m) => m.id === memberId)
  if (!previous || previous.status === status) return
  const prevStatus = previous.status
  await setStatus(memberId, status)
  showToast(describe(previous), {
    label: undoLabel,
    run: () => { void setStatus(memberId, prevStatus) },
  })
}

/**
 * 臨時加人。
 *
 * `fallbackGroup` 是使用者目前正在看的那一車：站在第一車門口按「臨時加人」，
 * 加進來的人本來就屬於第一車，再叫他去成員面板改一次分組是白繞一圈。
 *
 * 預設是「已到」而不是「未到」：這個功能的定義就是「沒報名但到場的人」，
 * 他正站在你面前。標成未到的話，計分區會為了一個看得見的人說「還有 1 位
 * 沒到」——那正是這個產品最不能出的錯。
 */
export async function addWalkIn(
  draft: DraftMember,
  fallbackGroup: string | null = null,
): Promise<Member | null> {
  const r = room.value
  if (!r || r.closed_at) return null

  const memberId = generateId()
  const groupLabel = draft.group_label ?? fallbackGroup
  const local: Member = {
    id: memberId, room_id: r.id, name: draft.name, note: draft.note, phone: draft.phone,
    companions: draft.companions, group_label: groupLabel,
    sort_order: Number.MAX_SAFE_INTEGER, status: 'pending',
    status_at: null, status_by: null, rev: 0, created_at: new Date().toISOString(),
  }
  members.value = [...members.value, local]
  persistSoon()

  if (isSupabaseConfigured) {
    await queue({
      kind: 'add', key: generateId(), code: r.code, memberId,
      name: draft.name, note: draft.note, phone: draft.phone, companions: draft.companions,
      groupLabel, queuedAt: Date.now(),
    })
  } else {
    await persistNow()
  }

  // 加完立刻標成已到。flushOrder() 保證同一批佇列裡 add 一定排在 status 前面，
  // 所以離線時這兩筆的順序也是對的。
  await setStatus(memberId, 'arrived')
  return members.value.find((m) => m.id === memberId) ?? null
}

// ---------------------------------------------------------------------------
// 開房 / 複製 / 管理
// ---------------------------------------------------------------------------

function localRoom(code: string, name: string): Room {
  const now = new Date()
  return {
    id: generateId(), code, name, note: null,
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 30 * 86_400_000).toISOString(),
    closed_at: null, copied_from: null,
  }
}

function toMembers(roomId: string, drafts: readonly DraftMember[]): Member[] {
  const now = new Date().toISOString()
  return drafts.map((d, i) => ({
    id: generateId(), room_id: roomId, name: d.name, note: d.note, phone: d.phone,
    companions: d.companions, group_label: d.group_label, sort_order: i + 1,
    status: d.status ?? 'pending', status_at: null, status_by: null, rev: 0, created_at: now,
  }))
}

/** 開房。房號撞號時自動換一組重試。 */
export async function createRoom(name: string, drafts: readonly DraftMember[]): Promise<string> {
  const title = name.trim() || '點名'

  if (!isSupabaseConfigured) {
    const code = generateRoomCode()
    const r = localRoom(code, title)
    await saveRoom(r, toMembers(r.id, drafts))
    recentRooms.value = await rememberRoom({ code, name: title, isOwner: true, lastSeen: Date.now() })
    return code
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateRoomCode()
    try {
      const snap = await api.createRoom(code, title, identity.value.ownerKey, drafts)
      await saveRoom(snap.room, snap.members)
      recentRooms.value = await rememberRoom({ code, name: title, isOwner: true, lastSeen: Date.now() })
      void refreshMyRooms()
      return code
    } catch (e) {
      if (e instanceof AppError && e.kind === 'code-taken') continue
      throw e
    }
  }
  throw new AppError('unknown', 'could not allocate a room code')
}

/** 複製房間：同一份名單、狀態歸零。這是回程點名的做法。 */
export async function copyCurrentRoom(newName: string): Promise<string> {
  const r = room.value
  if (!r) throw new AppError('room-not-found')
  const title = newName.trim() || `${r.name}（複製）`

  if (!isSupabaseConfigured) {
    const code = generateRoomCode()
    const copy: Room = { ...localRoom(code, title), copied_from: r.id }
    // 請假的人在回程一樣不會出現，保留狀態；已到的才歸零。
    const drafts = members.value.map<DraftMember>((m) => ({
      name: m.name, note: m.note, phone: m.phone,
      companions: m.companions, group_label: m.group_label,
      ...(m.status === 'excused' ? { status: 'excused' as const } : {}),
    }))
    await saveRoom(copy, toMembers(copy.id, drafts))
    recentRooms.value = await rememberRoom({ code, name: title, isOwner: true, lastSeen: Date.now() })
    return code
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateRoomCode()
    try {
      const snap = await api.copyRoom(r.code, identity.value.ownerKey, code, title)
      await saveRoom(snap.room, snap.members)
      recentRooms.value = await rememberRoom({ code, name: title, isOwner: true, lastSeen: Date.now() })
      void refreshMyRooms()
      return code
    } catch (e) {
      if (e instanceof AppError && e.kind === 'code-taken') continue
      throw e
    }
  }
  throw new AppError('unknown', 'could not allocate a room code')
}

async function ownerAction(run: () => Promise<{ room: Room; members: Member[] }>): Promise<void> {
  busy.value = true
  try {
    const snap = await run()
    room.value = snap.room
    members.value = snap.members
    await persistNow()
    broadcast('roster', { at: Date.now() })
  } finally {
    busy.value = false
  }
}

export async function replaceRoster(drafts: readonly DraftMember[]): Promise<void> {
  const r = room.value
  if (!r) return
  if (!isSupabaseConfigured) {
    const next = toMembers(r.id, drafts)
    members.value = next
    await persistNow()
    return
  }
  await ownerAction(() => api.replaceRoster(r.code, identity.value.ownerKey, drafts))
}

export async function setMemberGroup(memberId: string, groupLabel: string | null): Promise<void> {
  const r = room.value
  if (!r) return
  const label = groupLabel?.trim().slice(0, 20) || null
  if (!isSupabaseConfigured) {
    members.value = members.value.map((m) => (m.id === memberId ? { ...m, group_label: label } : m))
    await persistNow()
    return
  }
  await ownerAction(() => api.setMemberGroup(r.code, identity.value.ownerKey, memberId, label))
}

export async function removeMember(memberId: string): Promise<void> {
  const r = room.value
  if (!r) return
  if (!isSupabaseConfigured) {
    members.value = members.value.filter((m) => m.id !== memberId)
    await persistNow()
    return
  }
  await ownerAction(() => api.removeMember(r.code, identity.value.ownerKey, memberId))
}

export async function renameRoom(name: string): Promise<void> {
  const r = room.value
  if (!r) return
  const title = name.trim().slice(0, 80)
  if (!title) return
  if (!isSupabaseConfigured) {
    room.value = { ...r, name: title }
    await persistNow()
  } else {
    await ownerAction(() => api.renameRoom(r.code, identity.value.ownerKey, title))
  }
  recentRooms.value = await rememberRoom({
    code: r.code, name: title, isOwner: true, lastSeen: Date.now(),
  })
}

export async function setRoomClosed(closed: boolean): Promise<void> {
  const r = room.value
  if (!r) return
  if (!isSupabaseConfigured) {
    room.value = { ...r, closed_at: closed ? new Date().toISOString() : null }
    await persistNow()
    return
  }
  await ownerAction(() => api.setClosed(r.code, identity.value.ownerKey, closed))
}

export async function deleteCurrentRoom(): Promise<void> {
  const r = room.value
  if (!r) return
  if (isSupabaseConfigured) {
    await api.deleteRoom(r.code, identity.value.ownerKey)
    void refreshMyRooms()
  }
  await forgetRoom(r.code)
  recentRooms.value = await dropRecentRoom(r.code)
  leaveRoom()
}

export async function forgetRecentRoom(code: string): Promise<void> {
  await forgetRoom(code)
  recentRooms.value = await dropRecentRoom(code)
}

// ---------------------------------------------------------------------------
// 常用名單
// ---------------------------------------------------------------------------

export async function refreshRosters(): Promise<void> {
  if (!isSupabaseConfigured) return
  try {
    savedRosters.value = await api.listRosters(identity.value.ownerKey)
  } catch {
    /* 常用名單拿不到不影響點名，靜默失敗。 */
  }
}

export async function saveRosterAs(name: string, drafts: readonly DraftMember[]): Promise<void> {
  if (!isSupabaseConfigured) throw new AppError('not-configured')
  await api.saveRoster(identity.value.ownerKey, name, drafts)
  await refreshRosters()
}

export async function deleteSavedRoster(rosterId: string): Promise<void> {
  if (!isSupabaseConfigured) return
  await api.deleteRoster(identity.value.ownerKey, rosterId)
  await refreshRosters()
}
