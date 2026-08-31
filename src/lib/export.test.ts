import { describe, expect, it } from 'vitest'
import { csvFilename, toCsv, toShareText } from './export'
import type { Member, Room } from './types'

const room: Room = {
  id: 'r1', code: 'K7F2QM', name: '秋季旅遊 · 出發', note: null,
  created_at: '2026-10-01T00:00:00Z', expires_at: '2026-10-31T00:00:00Z',
  closed_at: null, copied_from: null,
}

function member(name: string, over: Partial<Member> = {}): Member {
  return {
    id: name, room_id: 'r1', name, note: null, phone: null, companions: 0, group_label: null,
    sort_order: 0, status: 'pending', status_at: null, status_by: null,
    rev: 0, created_at: '2026-10-01T00:00:00Z', ...over,
  }
}

describe('toCsv', () => {
  it('開頭有 BOM，Excel 開中文才不會亂碼', () => {
    expect(toCsv([])).toMatch(/^﻿/)
  })

  it('標題列與資料列', () => {
    const csv = toCsv([member('王小明', { status: 'arrived', status_by: '陳姐', companions: 2 })])
    const lines = csv.replace(/^﻿/, '').trim().split('\r\n')
    expect(lines[0]).toBe('姓名,狀態,時間,點名者,電話,攜伴,分組,備註')
    expect(lines[1]).toContain('王小明,已到')
    expect(lines[1]).toContain('陳姐')
    expect(lines[1]).toContain(',2,')
  })

  it('逗號、引號、換行都要被跳脫', () => {
    const csv = toCsv([member('王,小明', { note: '他說「好」的 "引號"\n第二行' })])
    expect(csv).toContain('"王,小明"')
    expect(csv).toContain('""引號""')
  })

  it('電話會被匯出', () => {
    expect(toCsv([member('王小明', { phone: '0912345678' })])).toContain('0912345678')
  })

  it('三種狀態都有中文標籤', () => {
    const csv = toCsv([
      member('a', { status: 'arrived' }), member('b', { status: 'pending' }), member('c', { status: 'excused' }),
    ])
    expect(csv).toContain('a,已到')
    expect(csv).toContain('b,未到')
    expect(csv).toContain('c,請假')
  })

  it('無效時間戳不會噴出 Invalid Date', () => {
    const csv = toCsv([member('a', { status_at: 'not-a-date' })])
    expect(csv).not.toContain('Invalid')
  })
})

describe('csvFilename', () => {
  it('去掉檔名不能用的字元', () => {
    const name = csvFilename({ ...room, name: 'a/b\\c:d*e?f"g<h>i|j' })
    expect(name).not.toMatch(/[\\/:*?"<>|]/)
    expect(name).toMatch(/\.csv$/)
  })
})

describe('toShareText', () => {
  it('未到名單放最前面，方便貼回 LINE', () => {
    const text = toShareText(room, [
      member('王小明', { status: 'arrived' }),
      member('李美花', { status: 'pending' }),
      member('陳大同', { status: 'pending' }),
    ])
    expect(text).toContain('秋季旅遊 · 出發')
    expect(text).toContain('已到 1 / 3 人')
    expect(text).toContain('未到 2 位：李美花、陳大同')
  })

  it('全到齊時明講', () => {
    const text = toShareText(room, [member('王小明', { status: 'arrived' })])
    expect(text).toContain('全部到齊')
    expect(text).not.toContain('未到')
  })

  it('人頭數含攜伴', () => {
    const text = toShareText(room, [
      member('王媽媽', { status: 'arrived', companions: 2 }),
      member('李伯伯', { status: 'pending' }),
    ])
    expect(text).toContain('已到 3 / 4 人')
  })

  it('請假另外列一行，不混進未到', () => {
    const text = toShareText(room, [
      member('王小明', { status: 'excused' }),
      member('李美花', { status: 'pending' }),
    ])
    expect(text).toContain('未到 1 位：李美花')
    expect(text).toContain('請假 1 位：王小明')
  })
})
