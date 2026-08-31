/** 成員狀態。pending = 還沒到，arrived = 已到，excused = 請假／不去。 */
export type MemberStatus = 'pending' | 'arrived' | 'excused'

export interface Member {
  id: string
  room_id: string
  name: string
  note: string | null
  phone: string | null
  companions: number
  group_label: string | null
  sort_order: number
  status: MemberStatus
  status_at: string | null
  status_by: string | null
  /** 單調遞增的版本號，合併時比大小決定勝負。見 merge.ts。 */
  rev: number
  created_at: string
}

export interface Room {
  id: string
  code: string
  name: string
  note: string | null
  created_at: string
  expires_at: string
  closed_at: string | null
  copied_from: string | null
}

export interface RoomSnapshot {
  room: Room
  members: Member[]
}

/** 還沒寫進資料庫的名單項目（貼上解析、常用名單都產生這個）。 */
export interface DraftMember {
  name: string
  note: string | null
  phone: string | null
  companions: number
  group_label: string | null
  /** 名單上就註明請假的人，一開始就不該進「未到」清單。省略時為 pending。 */
  status?: MemberStatus
}

/** 「我的活動」清單的一列。由 my_rooms() 回傳，附帶統計避免前端逐一再查。 */
export interface OwnedRoom {
  code: string
  name: string
  created_at: string
  expires_at: string
  closed_at: string | null
  people: number
  arrived: number
  headcount: number
  arrivedHeadcount: number
}

export interface SavedRoster {
  id: string
  name: string
  updated_at: string
  members: DraftMember[]
}

/** 待送佇列裡的一筆操作。離線時堆著，連線後依序送出。 */
export type PendingOp =
  | {
      kind: 'status'
      /** 同一個成員只會有一筆待送狀態，用 memberId 當去重鍵。 */
      key: string
      code: string
      memberId: string
      status: MemberStatus
      rev: number
      by: string | null
      queuedAt: number
    }
  | {
      kind: 'add'
      key: string
      code: string
      memberId: string
      name: string
      note: string | null
      phone: string | null
      companions: number
      groupLabel: string | null
      queuedAt: number
    }

export type ConnectionState =
  | 'local-only'   // 沒設定 Supabase，純單機
  | 'offline'      // 有設定但目前連不上
  | 'syncing'      // 正在送待送佇列
  | 'online'       // 已同步

export interface Identity {
  /** 房主金鑰：開房的裝置才有，破壞性操作需要它。 */
  ownerKey: string
  /** 這台裝置的點名員名稱，選填。 */
  checkerName: string
}
