import { computed, signal } from '@preact/signals'
import type { RealtimeChannel } from '@supabase/realtime-js'
import type {
  ConnectionState, DraftMember, Identity, Member, MemberStatus,
  PendingOp, Room, SavedRoster,
} from './types'
import { AppError, api, isSupabaseConfigured, realtimeChannel } from './supabase'
import { generateId, generateRoomCode, normalizeRoomCode } from './code'
import { applyRemoteMember, applyStatusLocally, mergeMembers, summarize } from './merge'
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
export const pendingUploads = computed(() =>
  room.value ? countForRoom(outbox.value, room.value.code) : 0,
)
export const isOwner = computed(() => {
  const code = room.value?.code
  return code ? recentRooms.value.some((r) => r.code === code && r.isOwner) : false
})

let currentCode: string | null = null
let channel: RealtimeChannel | null = null
let reconcileTimer: ReturnType<typeof setInterval> | undefined
let persistTimer: ReturnType<typeof setTimeout> | undefined
let toastTimer: ReturnType<typeof setTimeout> | undefined
let flushing = false

// ---------------------------------------------------------------------------
// 啟動
// ---------------------------------------------------------------------------

export async function boot(): Promise<void> {
  identity.value = await loadIdentity()
  prefs.value = await loadPrefs()
  recentRooms.value = await loadRecentRooms()
  outbox.value = await loadOutbox()
  applyTheme()
  window.addEventListener('online', handleOnline)
  window.addEventListener('offline', handleOffline)
  document.addEventListener('visibilitychange', handleVisibility)
  booted.value = true
  void flushOutbox()
  void refreshRosters()
}

function handleOnline(): void {
  void flushOutbox().then(() => reconcile().catch(() => {}))
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

export function applyTheme(): void {
  const theme = prefs.value.theme
  const root = document.documentElement
  if (theme === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
}

export async function setPrefs(patch: Partial<Prefs>): Promise<void> {
  prefs.value = { ...prefs.value, ...patch }
  applyTheme()
  await savePrefs(prefs.value)
}

export async function setCheckerName(name: string): Promise<void> {
  identity.value = { ...identity.value, checkerName: name.trim().slice(0, 40) }
  await saveIdentity(identity.value)
}

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
    members.value = applyRemoteMember(members.value, incoming)
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
  } else if (!cached) {
    currentCode = null
    throw new AppError('room-not-found')
  }

  const r = room.value
  if (r) {
    const wasOwner = recentRooms.value.find((x) => x.code === c)?.isOwner ?? false
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
    members.value = mergeMembers(members.value, snap.members, pendingAddIds(outbox.value))
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
          members.value = applyRemoteMember(members.value, saved)
          persistSoon()
        }
        broadcast('member', saved)
        outbox.value = dequeue(outbox.value, op.key)
        await persistOutbox()
      } catch (e) {
        const kind = e instanceof AppError ? e.kind : 'unknown'
        if (kind === 'offline') break
        if (PERMANENT.has(kind)) {
          // 丟掉這一筆，繼續處理其他的。
          outbox.value = dequeue(outbox.value, op.key)
          await persistOutbox()
          continue
        }
        break
      }
    }
  } finally {
    flushing = false
    refreshConnection()
  }
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

export async function addWalkIn(draft: DraftMember): Promise<void> {
  const r = room.value
  if (!r || r.closed_at) return

  const memberId = generateId()
  const local: Member = {
    id: memberId, room_id: r.id, name: draft.name, note: draft.note, phone: draft.phone,
    companions: draft.companions, group_label: draft.group_label,
    sort_order: Number.MAX_SAFE_INTEGER, status: 'pending',
    status_at: null, status_by: null, rev: 0, created_at: new Date().toISOString(),
  }
  members.value = [...members.value, local]
  persistSoon()

  if (isSupabaseConfigured) {
    await queue({
      kind: 'add', key: generateId(), code: r.code, memberId,
      name: draft.name, note: draft.note, phone: draft.phone, companions: draft.companions,
      groupLabel: draft.group_label, queuedAt: Date.now(),
    })
  } else {
    await persistNow()
  }
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
  if (isSupabaseConfigured) await api.deleteRoom(r.code, identity.value.ownerKey)
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
