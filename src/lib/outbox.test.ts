import { describe, expect, it } from 'vitest'
import { countForRoom, dequeue, enqueue, flushOrder, pendingAddIds } from './outbox'
import type { PendingOp } from './types'

const status = (memberId: string, rev: number, key = `s-${memberId}-${rev}`): PendingOp => ({
  kind: 'status', key, code: 'AAAAAA', memberId, status: 'arrived', rev, by: null, queuedAt: rev,
})

const add = (memberId: string, key = `a-${memberId}`): PendingOp => ({
  kind: 'add', key, code: 'AAAAAA', memberId, name: memberId,
  note: null, phone: null, companions: 0, groupLabel: null, queuedAt: 1,
})

describe('enqueue', () => {
  it('同一個成員只保留最新的狀態變更', () => {
    let q: PendingOp[] = []
    q = enqueue(q, status('m1', 100))
    q = enqueue(q, status('m1', 200))
    q = enqueue(q, status('m1', 300))
    expect(q).toHaveLength(1)
    expect(q[0]).toMatchObject({ rev: 300 })
  })

  it('不同成員各自保留', () => {
    let q: PendingOp[] = []
    q = enqueue(q, status('m1', 100))
    q = enqueue(q, status('m2', 100))
    expect(q).toHaveLength(2)
  })

  it('同一個 memberId 的新增只留一筆', () => {
    let q: PendingOp[] = []
    q = enqueue(q, add('m1'))
    q = enqueue(q, add('m1', 'a-m1-again'))
    expect(q).toHaveLength(1)
  })

  it('新增與狀態互不影響', () => {
    let q: PendingOp[] = []
    q = enqueue(q, add('m1'))
    q = enqueue(q, status('m1', 100))
    expect(q).toHaveLength(2)
  })
})

describe('flushOrder', () => {
  it('新增永遠排在狀態前面', () => {
    const q = [status('m1', 100), add('m2'), status('m2', 200), add('m3')]
    expect(flushOrder(q).map((o) => o.kind)).toEqual(['add', 'add', 'status', 'status'])
  })

  it('同類型維持入列先後', () => {
    const q = [status('m1', 100), status('m2', 200), status('m3', 300)]
    expect(flushOrder(q).map((o) => o.kind === 'status' && o.memberId)).toEqual(['m1', 'm2', 'm3'])
  })

  it('空佇列', () => {
    expect(flushOrder([])).toEqual([])
  })
})

describe('dequeue', () => {
  it('依 key 移除送出成功的那一筆', () => {
    const q = [status('m1', 100, 'k1'), status('m2', 200, 'k2')]
    expect(dequeue(q, 'k1').map((o) => o.key)).toEqual(['k2'])
  })

  it('移除不存在的 key 不會出錯', () => {
    const q = [status('m1', 100, 'k1')]
    expect(dequeue(q, 'nope')).toHaveLength(1)
  })
})

describe('pendingAddIds', () => {
  it('只收集新增的 memberId', () => {
    const q = [add('m1'), status('m2', 100), add('m3')]
    expect(pendingAddIds(q)).toEqual(new Set(['m1', 'm3']))
  })
})

describe('countForRoom', () => {
  it('只算這個空間的', () => {
    const other: PendingOp = { ...status('m9', 1), code: 'BBBBBB' }
    expect(countForRoom([status('m1', 1), status('m2', 2), other], 'AAAAAA')).toBe(2)
  })
})
