import { describe, expect, it } from 'vitest'
import { applyRemoteMember, applyStatusLocally, maxRev, mergeMembers, nextRev, pickWinner, summarize } from './merge'
import type { Member, MemberStatus } from './types'

function member(id: string, over: Partial<Member> = {}): Member {
  return {
    id, room_id: 'r1', name: id, note: null, phone: null, companions: 0, group_label: null,
    sort_order: 0, status: 'pending', status_at: null, status_by: null,
    rev: 0, created_at: '2026-01-01T00:00:00Z', ...over,
  }
}

describe('nextRev', () => {
  it('用時間當基準', () => {
    expect(nextRev(0, 1_700_000_000_000)).toBe(1_700_000_000_000)
  })

  it('已見過更大的 rev 時嚴格遞增，不會退回', () => {
    const seen = 1_800_000_000_000
    expect(nextRev(seen, 1_700_000_000_000)).toBe(seen + 1)
  })

  it('同一毫秒內連續操作仍嚴格遞增', () => {
    const now = 1_700_000_000_000
    const a = nextRev(0, now)
    const b = nextRev(a, now)
    const c = nextRev(b, now)
    expect(a < b && b < c).toBe(true)
  })

  it('系統時鐘倒退也不會產生較小的 rev', () => {
    const seen = nextRev(0, 1_700_000_000_000)
    expect(nextRev(seen, 1_600_000_000_000)).toBeGreaterThan(seen)
  })
})

describe('pickWinner', () => {
  it('rev 大的狀態勝出', () => {
    const local = member('a', { status: 'arrived', rev: 200, status_by: '陳姐' })
    const remote = member('a', { status: 'pending', rev: 100, status_by: '王哥' })
    expect(pickWinner(local, remote)).toMatchObject({ status: 'arrived', rev: 200, status_by: '陳姐' })
  })

  it('rev 小的輸掉，採用遠端', () => {
    const local = member('a', { status: 'arrived', rev: 100 })
    const remote = member('a', { status: 'pending', rev: 200 })
    expect(pickWinner(local, remote).status).toBe('pending')
  })

  it('平手時採用遠端，讓所有裝置得到相同結果', () => {
    const local = member('a', { status: 'arrived', rev: 100, status_by: '甲' })
    const remote = member('a', { status: 'excused', rev: 100, status_by: '乙' })
    expect(pickWinner(local, remote)).toBe(remote)
    expect(pickWinner(remote, local)).toBe(local)
  })

  it('名單欄位一律以遠端為準，即使本地 rev 較大', () => {
    const local = member('a', { name: '舊名字', note: '舊備註', companions: 0, status: 'arrived', rev: 300 })
    const remote = member('a', { name: '新名字', note: '新備註', companions: 2, rev: 100 })
    const w = pickWinner(local, remote)
    expect(w).toMatchObject({ name: '新名字', note: '新備註', companions: 2, status: 'arrived', rev: 300 })
  })
})

describe('mergeMembers', () => {
  it('成員增刪以遠端為準', () => {
    const local = [member('a'), member('b')]
    const remote = [member('a'), member('c')]
    expect(mergeMembers(local, remote).map((m) => m.id)).toEqual(['a', 'c'])
  })

  it('保留待送佇列中還沒同步的臨時加人', () => {
    const local = [member('a'), member('walkin')]
    const remote = [member('a')]
    const merged = mergeMembers(local, remote, new Set(['walkin']))
    expect(merged.map((m) => m.id)).toEqual(['a', 'walkin'])
  })

  it('房主刪掉的人不會被復活', () => {
    const local = [member('a'), member('removed')]
    const remote = [member('a')]
    expect(mergeMembers(local, remote, new Set(['other'])).map((m) => m.id)).toEqual(['a'])
  })

  it('本地未送出的點名不會被遠端舊快照蓋掉', () => {
    const local = [member('a', { status: 'arrived', rev: 999 })]
    const remote = [member('a', { status: 'pending', rev: 1 })]
    expect(mergeMembers(local, remote)[0]?.status).toBe('arrived')
  })

  it('遠端較新的點名會蓋掉本地舊值', () => {
    const local = [member('a', { status: 'pending', rev: 1 })]
    const remote = [member('a', { status: 'arrived', rev: 999 })]
    expect(mergeMembers(local, remote)[0]?.status).toBe('arrived')
  })

  it('五台裝置以任意順序合併，結果一致（收斂性）', () => {
    const base = member('a')
    const versions: Member[] = [
      { ...base, status: 'arrived', rev: 500, status_by: '甲' },
      { ...base, status: 'pending', rev: 300, status_by: '乙' },
      { ...base, status: 'excused', rev: 800, status_by: '丙' },
      { ...base, status: 'arrived', rev: 200, status_by: '丁' },
      { ...base, status: 'pending', rev: 700, status_by: '戊' },
    ]
    // 依序把每個版本當成「收到的遠端快照」合併進來。
    const fold = (order: readonly Member[]) =>
      order.reduce<Member[]>((acc, incoming) => mergeMembers(acc, [incoming]), [])

    const forward = fold(versions)
    const backward = fold([...versions].reverse())
    const shuffled = fold([versions[2]!, versions[0]!, versions[4]!, versions[1]!, versions[3]!])

    // rev 最大的（丙，800）勝出，且與合併順序無關。
    expect(forward[0]).toMatchObject({ rev: 800, status: 'excused', status_by: '丙' })
    expect(backward[0]).toEqual(forward[0])
    expect(shuffled[0]).toEqual(forward[0])
  })
})

describe('applyRemoteMember', () => {
  it('只更新目標成員，其他人原封不動', () => {
    const local = [member('a'), member('b'), member('c')]
    const next = applyRemoteMember(local, member('b', { status: 'arrived', rev: 100 }))
    expect(next).toHaveLength(3)
    expect(next[1]).toMatchObject({ id: 'b', status: 'arrived' })
    expect(next[0]).toBe(local[0])
    expect(next[2]).toBe(local[2])
  })

  it('沒見過的人會被加進來（別人臨時加的）', () => {
    const next = applyRemoteMember([member('a')], member('walkin'))
    expect(next.map((m) => m.id)).toEqual(['a', 'walkin'])
  })

  it('本地 rev 較大時不被廣播蓋掉', () => {
    const local = [member('a', { status: 'arrived', rev: 999 })]
    expect(applyRemoteMember(local, member('a', { status: 'pending', rev: 1 }))[0]?.status).toBe('arrived')
  })

  it('不會像整份快照那樣刪掉名單上的其他人', () => {
    const local = [member('a'), member('b')]
    expect(applyRemoteMember(local, member('a', { rev: 5 }))).toHaveLength(2)
  })
})

describe('applyStatusLocally', () => {
  it('立即更新目標成員並產生新的 rev', () => {
    const members = [member('a'), member('b', { rev: 5_000 })]
    const { members: next, rev } = applyStatusLocally(members, 'a', 'arrived', '陳姐', 1_700_000_000_000)
    expect(rev).toBe(1_700_000_000_000)
    expect(next[0]).toMatchObject({ status: 'arrived', status_by: '陳姐', rev })
    expect(next[0]?.status_at).toBe('2023-11-14T22:13:20.000Z')
    expect(next[1]).toEqual(members[1])
  })

  it('新 rev 一定大於名單中所有現有的 rev', () => {
    const members = [member('a'), member('b', { rev: 9_999_999_999_999 })]
    const { rev } = applyStatusLocally(members, 'a', 'arrived', null, 1_700_000_000_000)
    expect(rev).toBeGreaterThan(maxRev(members))
  })
})

describe('summarize', () => {
  it('人頭數含攜伴', () => {
    const members = [
      member('a', { status: 'arrived', companions: 2 }),
      member('b', { status: 'arrived' }),
      member('c', { status: 'pending', companions: 1 }),
      member('d', { status: 'excused', companions: 5 }),
    ]
    expect(summarize(members)).toEqual({
      people: 4, headcount: 12,
      arrived: 2, arrivedHeadcount: 4,
      pending: 1, pendingHeadcount: 2,
      excused: 1,
    })
  })

  it('請假不算未到', () => {
    const s = summarize([member('a', { status: 'excused' }), member('b', { status: 'pending' })])
    expect(s.pending).toBe(1)
    expect(s.excused).toBe(1)
  })

  it('空名單', () => {
    expect(summarize([])).toMatchObject({ people: 0, headcount: 0, pending: 0 })
  })

  it('未知狀態當作未到處理', () => {
    const odd = member('x', { status: 'weird' as unknown as MemberStatus })
    expect(summarize([odd]).pending).toBe(1)
  })
})
