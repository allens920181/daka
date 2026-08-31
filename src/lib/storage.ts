import { del, get, set } from 'idb-keyval'
import type { Identity, Member, PendingOp, Room, RoomSnapshot } from './types'
import { generateOwnerKey } from './code'

/**
 * 本地儲存。畫面永遠只讀這裡，網路是另一條非同步的路。
 * 用 IndexedDB 而不是 localStorage：待送佇列與名單可能不小，
 * 而且 IndexedDB 的讀寫不會卡住主執行緒。
 */

const K_IDENTITY = 'identity'
const K_OUTBOX = 'outbox'
const K_RECENT = 'recentRooms'
const K_PREFS = 'prefs'
const roomKey = (code: string) => `room:${code.toUpperCase()}`

export interface Prefs {
  lang: 'zh' | 'en'
  theme: 'light' | 'dark' | 'system'
  /** 點名時的震動回饋。逆光下看不清畫面時，手感是第二個確認管道。 */
  haptics: boolean
}

export interface RecentRoom {
  code: string
  name: string
  isOwner: boolean
  lastSeen: number
}

export const DEFAULT_PREFS: Prefs = { lang: 'zh', theme: 'system', haptics: true }

/** IndexedDB 在無痕模式或停用儲存時會丟錯；一律降級成「沒有資料」而不是讓畫面掛掉。 */
async function safeGet<T>(key: string): Promise<T | undefined> {
  try {
    return await get<T>(key)
  } catch {
    return undefined
  }
}

async function safeSet(key: string, value: unknown): Promise<void> {
  try {
    await set(key, value)
  } catch {
    /* 儲存不可用時靜默略過：這一輪點名仍可在記憶體中完成。 */
  }
}

export async function loadIdentity(): Promise<Identity> {
  const existing = await safeGet<Identity>(K_IDENTITY)
  if (existing?.ownerKey) return existing
  const fresh: Identity = { ownerKey: generateOwnerKey(), checkerName: '' }
  await safeSet(K_IDENTITY, fresh)
  return fresh
}

export async function saveIdentity(identity: Identity): Promise<void> {
  await safeSet(K_IDENTITY, identity)
}

export async function loadPrefs(): Promise<Prefs> {
  return { ...DEFAULT_PREFS, ...(await safeGet<Partial<Prefs>>(K_PREFS)) }
}

export async function savePrefs(prefs: Prefs): Promise<void> {
  await safeSet(K_PREFS, prefs)
}

export async function loadRoom(code: string): Promise<RoomSnapshot | undefined> {
  return safeGet<RoomSnapshot>(roomKey(code))
}

export async function saveRoom(room: Room, members: Member[]): Promise<void> {
  await safeSet(roomKey(room.code), { room, members })
}

export async function forgetRoom(code: string): Promise<void> {
  try {
    await del(roomKey(code))
  } catch {
    /* 同上 */
  }
}

export async function loadOutbox(): Promise<PendingOp[]> {
  return (await safeGet<PendingOp[]>(K_OUTBOX)) ?? []
}

export async function saveOutbox(ops: PendingOp[]): Promise<void> {
  await safeSet(K_OUTBOX, ops)
}

export async function loadRecentRooms(): Promise<RecentRoom[]> {
  return (await safeGet<RecentRoom[]>(K_RECENT)) ?? []
}

export async function rememberRoom(entry: RecentRoom): Promise<RecentRoom[]> {
  const list = (await loadRecentRooms()).filter((r) => r.code !== entry.code)
  // 保留 isOwner：重新加入自己開的房間時不該把管理身分弄丟。
  const next = [entry, ...list].slice(0, 12)
  await safeSet(K_RECENT, next)
  return next
}

export async function dropRecentRoom(code: string): Promise<RecentRoom[]> {
  const next = (await loadRecentRooms()).filter((r) => r.code !== code)
  await safeSet(K_RECENT, next)
  return next
}
