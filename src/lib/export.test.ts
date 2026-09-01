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

  it('請假的人不算進分母，貼回 LINE 的數字不會自相矛盾', () => {
    // 3 人報名、1 人請假、其餘全到 → 「已到 2 / 2 人」＋「全部到齊」。
    // 用名單總人頭當分母的話這裡會寫成「已到 2 / 3 人」配「全部到齊」。
    const text = toShareText(room, [
      member('王小明', { status: 'arrived' }),
      member('李美花', { status: 'arrived' }),
      member('陳大同', { status: 'excused' }),
    ])
    expect(text).toContain('已到 2 / 2 人')
    expect(text).toContain('全部到齊')
    expect(text).toContain('請假 1 位：陳大同')
  })

  /*
   * 這一段文字是整個產品唯一會被「沒裝這個 App 的人」讀到的東西，而它一度用列數
   * 報未到：「已到 2 / 11 人」（人頭）下面接「未到 6 位」（列數），少報了 3 個人。
   * 底下四條把單位釘死——原本的測試只斷言「已到 x / y 人」那一行，所以攔不到。
   */
  it('未到人數是人頭不是列數', () => {
    const text = toShareText(room, [
      member('李美花', { companions: 1 }),
      member('李四', { companions: 2 }),
      member('張三'),
    ])
    expect(text).toContain('未到 6 位：')
    expect(text).not.toContain('未到 3 位')
  })

  it('名字後面補上攜伴數，讀的人自己加得回來', () => {
    const text = toShareText(room, [member('李美花', { companions: 1 }), member('張三')])
    expect(text).toContain('未到 3 位：李美花＋1、張三')
  })

  it('分組括號裡也是人頭', () => {
    const text = toShareText(room, [
      member('李美花', { group_label: '第一車', companions: 1 }),
      member('王小明', { group_label: '第一車' }),
      member('李四', { group_label: '第二車', companions: 2 }),
    ])
    expect(text).toContain('　第一車（3）：李美花＋1、王小明')
    expect(text).toContain('　第二車（3）：李四＋2')
  })

  it('請假人數也是人頭', () => {
    const text = toShareText(room, [
      member('王小明', { status: 'arrived' }),
      member('陳大同', { status: 'excused', companions: 3 }),
    ])
    expect(text).toContain('請假 4 位：陳大同＋3')
  })

  it('已到人頭 + 未到人頭 = 分母（這就是列數版本做不到的事）', () => {
    const text = toShareText(room, [
      member('王小明', { status: 'arrived', companions: 1 }),
      member('李美花', { companions: 1 }),
      member('李四', { companions: 2 }),
      member('陳大同', { status: 'excused' }),
    ])
    const arrived = Number(/已到 (\d+) \//.exec(text)?.[1])
    const total = Number(/已到 \d+ \/ (\d+) 人/.exec(text)?.[1])
    const missing = Number(/未到 (\d+) 位/.exec(text)?.[1])
    expect(arrived).toBe(2)
    expect(missing).toBe(5)
    expect(arrived + missing).toBe(total)
  })

  it('請假者的攜伴也一起扣掉', () => {
    const text = toShareText(room, [
      member('王小明', { status: 'arrived' }),
      member('陳大同', { status: 'excused', companions: 3 }),
    ])
    expect(text).toContain('已到 1 / 1 人')
  })

  it('附上時間：貼進 LINE 群之後辦公室要知道這是幾點的狀態', () => {
    const text = toShareText(room, [member('王小明', { status: 'arrived' })],
      null, new Date(2026, 9, 1, 8, 5))
    expect(text).toContain('08:05 · 已到 1 / 1 人')
  })

  it('沒選分組時，未到名單按車分行', () => {
    const text = toShareText(room, [
      member('甲', { group_label: '第一車' }),
      member('乙', { group_label: '第二車' }),
      member('丙', { group_label: '第一車' }),
    ])
    expect(text).toContain('未到 3 位：')
    expect(text).toContain('　第一車（2）：甲、丙')
    expect(text).toContain('　第二車（1）：乙')
  })

  it('沒有分組的人排在最後一行', () => {
    const text = toShareText(room, [
      member('甲'),
      member('乙', { group_label: '第一車' }),
    ])
    const lines = text.split('\n')
    expect(lines[lines.length - 1]).toContain('未分組')
  })

  it('只有一車時不做多餘的分行', () => {
    const text = toShareText(room, [
      member('甲', { group_label: '第一車' }),
      member('乙', { group_label: '第一車' }),
    ])
    expect(text).toContain('未到 2 位：甲、乙')
  })

  it('已經限定某一車時，名單就是那一車，標題帶著車名', () => {
    const text = toShareText(room, [member('甲', { group_label: '第二車' })], '第二車')
    expect(text).toContain('秋季旅遊 · 出發 · 第二車')
    expect(text).toContain('未到 1 位：甲')
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
