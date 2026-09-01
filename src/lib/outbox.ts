import type { PendingOp } from './types'

/**
 * 待送佇列。
 *
 * 兩條規則讓重送永遠安全：
 * 1. 同一個成員只保留最新的一筆狀態變更。因為合併規則是「rev 大的勝」，
 *    中間過程送不送出去都不影響最終結果，只送最後一筆最省。
 * 2. 送出時「新增」永遠排在「狀態」前面。臨時加人還沒送出時，
 *    他的點名紀錄不能先送——伺服器上還沒有這個人。
 */

export function enqueue(queue: readonly PendingOp[], op: PendingOp): PendingOp[] {
  if (op.kind === 'status') {
    const rest = queue.filter((q) => !(q.kind === 'status' && q.memberId === op.memberId))
    return [...rest, op]
  }
  // 同一個 memberId 的新增只留一筆（member id 由前端產生，重送是冪等的）。
  const rest = queue.filter((q) => !(q.kind === 'add' && q.memberId === op.memberId))
  return [...rest, op]
}

export function dequeue(queue: readonly PendingOp[], key: string): PendingOp[] {
  return queue.filter((q) => q.key !== key)
}

/** 送出順序：先新增、後狀態，各自維持入列先後。 */
export function flushOrder(queue: readonly PendingOp[]): PendingOp[] {
  const adds = queue.filter((q) => q.kind === 'add')
  const statuses = queue.filter((q) => q.kind === 'status')
  return [...adds, ...statuses]
}

export function pendingAddIds(queue: readonly PendingOp[]): Set<string> {
  return new Set(queue.filter((q) => q.kind === 'add').map((q) => q.memberId))
}

/** 佇列裡屬於這個空間的筆數，用來顯示「離線中，N 筆待上傳」。 */
export function countForRoom(queue: readonly PendingOp[], code: string): number {
  return queue.filter((q) => q.code === code).length
}
