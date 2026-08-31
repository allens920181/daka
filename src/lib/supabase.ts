import { RealtimeClient, type RealtimeChannel } from '@supabase/realtime-js'
import type { DraftMember, Member, MemberStatus, OwnedRoom, RoomSnapshot, SavedRoster } from './types'

import { REQUEST_TIMEOUT_MS, SUPABASE_ANON_KEY, SUPABASE_URL, isSupabaseConfigured } from './config'
import { accessToken } from './auth'

export { isSupabaseConfigured }

/**
 * 這裡刻意不用 @supabase/supabase-js，直接打 PostgREST 的 RPC 端點：
 *
 * 1. 這個應用只用到 rpc() 與 realtime channel，完整 client 會把 auth、
 *    storage、functions 一起打包進來——首次載入是在訊號差的現場發生的。
 * 2. 更重要的是 supabase-js 沒有預設逾時。收訊爛的時候一個請求可以吊住
 *    很久，把整條待送佇列卡死。自己發 fetch 才能掛 AbortSignal.timeout。
 */
let realtime: RealtimeClient | null = null

export function realtimeChannel(topic: string): RealtimeChannel | null {
  if (!isSupabaseConfigured) return null
  realtime ??= new RealtimeClient(`${SUPABASE_URL.replace(/^http/, 'ws')}/realtime/v1`, {
    params: { apikey: SUPABASE_ANON_KEY },
  })
  return realtime.channel(topic, { config: { broadcast: { self: false } } })
}

export type AppErrorKind =
  | 'not-configured'
  | 'offline'
  | 'room-not-found'
  | 'room-closed'
  | 'not-owner'
  | 'code-taken'
  | 'too-many-members'
  | 'unknown'

export class AppError extends Error {
  constructor(readonly kind: AppErrorKind, message?: string) {
    super(message ?? kind)
    this.name = 'AppError'
  }
}

function classify(error: { message?: string; code?: string } | null): AppError {
  const msg = error?.message ?? ''
  const code = error?.code ?? ''
  if (msg.includes('room_not_found_or_not_owner')) return new AppError('not-owner', msg)
  if (msg.includes('room_not_found') || msg.includes('member_not_found')) return new AppError('room-not-found', msg)
  if (msg.includes('room_closed')) return new AppError('room-closed', msg)
  if (msg.includes('too_many_members')) return new AppError('too-many-members', msg)
  if (code === '23505' || msg.includes('rooms_code_key')) return new AppError('code-taken', msg)
  // supabase-js 在斷網時回傳 TypeError: Failed to fetch
  if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('fetch failed')) {
    return new AppError('offline', msg)
  }
  return new AppError('unknown', msg || 'unknown error')
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  if (!isSupabaseConfigured) throw new AppError('not-configured')

  // 登入後帶使用者的 JWT，資料庫端的 auth.uid() 才認得出是誰。
  // 沒登入就帶 anon key，行為與從前完全相同。
  const token = await accessToken()

  let res: Response
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token ?? SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (e) {
    // 逾時與斷線都當成離線：待送佇列會留著，恢復連線後重試。
    const name = (e as Error)?.name
    if (name === 'TimeoutError' || name === 'AbortError') throw new AppError('offline', 'timeout')
    throw classify(e as { message?: string })
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string; code?: string } | null
    if (res.status >= 500) throw new AppError('offline', `server ${res.status}`)
    throw classify(body ?? { message: `http ${res.status}` })
  }

  return (await res.json()) as T
}

const draftPayload = (members: readonly DraftMember[]) =>
  members.map((m) => ({
    name: m.name,
    note: m.note,
    phone: m.phone,
    companions: m.companions,
    group_label: m.group_label,
    status: m.status ?? 'pending',
  }))

export const api = {
  createRoom: (code: string, name: string, ownerKey: string, members: readonly DraftMember[]) =>
    rpc<RoomSnapshot>('create_room', {
      p_code: code, p_name: name, p_owner_key: ownerKey, p_members: draftPayload(members),
    }),

  getRoom: (code: string) => rpc<RoomSnapshot | null>('get_room', { p_code: code }),

  setStatus: (code: string, memberId: string, status: MemberStatus, rev: number, by: string | null) =>
    rpc<Member>('set_member_status', {
      p_code: code, p_member_id: memberId, p_status: status, p_rev: rev, p_by: by,
    }),

  addMember: (code: string, m: DraftMember, memberId: string) =>
    rpc<Member>('add_member', {
      p_code: code, p_name: m.name, p_note: m.note, p_phone: m.phone,
      p_companions: m.companions, p_group_label: m.group_label, p_member_id: memberId,
    }),

  removeMember: (code: string, ownerKey: string, memberId: string) =>
    rpc<RoomSnapshot>('remove_member', { p_code: code, p_owner_key: ownerKey, p_member_id: memberId }),

  setMemberGroup: (code: string, ownerKey: string, memberId: string, groupLabel: string | null) =>
    rpc<RoomSnapshot>('set_member_group', {
      p_code: code, p_owner_key: ownerKey, p_member_id: memberId, p_group_label: groupLabel,
    }),

  replaceRoster: (code: string, ownerKey: string, members: readonly DraftMember[]) =>
    rpc<RoomSnapshot>('replace_roster', { p_code: code, p_owner_key: ownerKey, p_members: draftPayload(members) }),

  copyRoom: (code: string, ownerKey: string, newCode: string, newName: string) =>
    rpc<RoomSnapshot>('copy_room', {
      p_code: code, p_owner_key: ownerKey, p_new_code: newCode, p_new_name: newName,
    }),

  renameRoom: (code: string, ownerKey: string, name: string) =>
    rpc<RoomSnapshot>('rename_room', { p_code: code, p_owner_key: ownerKey, p_name: name }),

  setClosed: (code: string, ownerKey: string, closed: boolean) =>
    rpc<RoomSnapshot>('set_room_closed', { p_code: code, p_owner_key: ownerKey, p_closed: closed }),

  deleteRoom: (code: string, ownerKey: string) =>
    rpc<boolean>('delete_room', { p_code: code, p_owner_key: ownerKey }),

  saveRoster: (ownerKey: string, name: string, members: readonly DraftMember[], rosterId?: string) =>
    rpc<{ roster: { id: string; name: string; updated_at: string }; members: DraftMember[] }>('save_roster', {
      p_owner_key: ownerKey, p_name: name, p_members: draftPayload(members), p_roster_id: rosterId ?? null,
    }),

  listRosters: (ownerKey: string) => rpc<SavedRoster[]>('list_rosters', { p_owner_key: ownerKey }),

  claimMine: (ownerKey: string) =>
    rpc<{ rooms: number; rosters: number }>('claim_mine', { p_owner_key: ownerKey }),

  myRooms: () => rpc<OwnedRoom[]>('my_rooms', { p_limit: 50 }),

  deleteRoster: (ownerKey: string, rosterId: string) =>
    rpc<boolean>('delete_roster', { p_owner_key: ownerKey, p_roster_id: rosterId }),
}
