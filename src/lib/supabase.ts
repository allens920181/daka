import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { DraftMember, Member, MemberStatus, RoomSnapshot, SavedRoster } from './types'

const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()

/**
 * 沒設定 Supabase 時整個應用仍然可用，只是退回單機模式。
 * 這很重要：第一次部署、或使用者還沒開專案時，不該看到一個壞掉的網站。
 */
export const isSupabaseConfigured = Boolean(url && anonKey)

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url as string, anonKey as string, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { params: { eventsPerSecond: 20 } },
    })
  : null

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
  if (!supabase) throw new AppError('not-configured')
  try {
    const { data, error } = await supabase.rpc(fn, args)
    if (error) throw classify(error)
    return data as T
  } catch (e) {
    if (e instanceof AppError) throw e
    throw classify(e as { message?: string })
  }
}

const draftPayload = (members: readonly DraftMember[]) =>
  members.map((m) => ({
    name: m.name,
    note: m.note,
    phone: m.phone,
    companions: m.companions,
    group_label: m.group_label,
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

  deleteRoster: (ownerKey: string, rosterId: string) =>
    rpc<boolean>('delete_roster', { p_owner_key: ownerKey, p_roster_id: rosterId }),
}
