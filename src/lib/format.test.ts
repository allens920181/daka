import { describe, expect, it } from 'vitest'
import { formatDate, formatDateTime, formatTime } from './format'

const AT = new Date(2026, 8, 30, 15, 12, 0) // 2026-09-30 15:12 本地時間
const NOW = new Date(2026, 8, 30, 9, 0, 0)

describe('formatTime', () => {
  it('一律 24 小時制、補零，不跟著瀏覽器語系跑', () => {
    expect(formatTime(AT)).toBe('15:12')
    expect(formatTime(new Date(2026, 0, 1, 7, 5, 0))).toBe('07:05')
  })

  it('午夜是 00:00 不是 24:00', () => {
    expect(formatTime(new Date(2026, 0, 1, 0, 0, 0))).toBe('00:00')
  })

  it('壞掉的輸入回空字串，不會讓畫面印出 Invalid Date', () => {
    expect(formatTime('不是時間')).toBe('')
  })
})

describe('formatDate', () => {
  it('中文用 9/30', () => {
    expect(formatDate(AT, 'zh', NOW)).toBe('9/30')
  })

  it('英文用 Sep 30', () => {
    expect(formatDate(AT, 'en', NOW)).toBe('Sep 30')
  })

  it('跨年時補上年份，才不會把去年的房間看成今天的', () => {
    expect(formatDate(new Date(2025, 8, 30), 'zh', NOW)).toBe('2025/9/30')
    expect(formatDate(new Date(2025, 8, 30), 'en', NOW)).toBe('Sep 30, 2025')
  })

  it('壞掉的輸入回空字串', () => {
    expect(formatDate(Number.NaN, 'zh', NOW)).toBe('')
  })
})

describe('formatDateTime', () => {
  it('日期加時間', () => {
    expect(formatDateTime(AT, 'zh', NOW)).toBe('9/30 15:12')
  })
})
