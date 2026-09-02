import { describe, expect, it } from 'vitest'
import {
  CODE_ALPHABET, CODE_LENGTH, findConfusables, generateId, generateOwnerKey,
  generateRoomCode, isValidRoomCode, normalizeRoomCode, uuidV4,
} from './code'

describe('代碼', () => {
  it('產生的代碼永遠只用字母表裡的字元', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateRoomCode()
      expect(code).toHaveLength(CODE_LENGTH)
      for (const ch of code) expect(CODE_ALPHABET).toContain(ch)
    }
  })

  it('正規化：去分隔符號、轉大寫、全形轉半形', () => {
    expect(normalizeRoomCode(' ab-cd ef ')).toBe('ABCDEF')
    expect(normalizeRoomCode('ＡＢ２３４５')).toBe('AB2345')
  })

  it('易混淆字元不是有效代碼，而且找得出是哪幾個', () => {
    expect(isValidRoomCode('A2B3C4')).toBe(true)
    expect(isValidRoomCode('A0B1CD')).toBe(false)
    expect(findConfusables('A0B1CD').sort()).toEqual(['0', '1'])
  })
})

describe('uuidV4', () => {
  const shape = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

  it('格式與版本／變體位都正確', () => {
    for (let i = 0; i < 200; i++) expect(uuidV4()).toMatch(shape)
  })

  it('不重複', () => {
    const seen = new Set(Array.from({ length: 1000 }, () => uuidV4()))
    expect(seen.size).toBe(1000)
  })

  /**
   * 這是這次修正的重點：不安全來源（區網的 http:// 位址）沒有
   * `crypto.randomUUID`，而 generateId 每點一個名字就會被呼叫一次。
   */
  it('沒有 crypto.randomUUID 時 generateId 仍然可用', () => {
    // randomUUID 在 Crypto.prototype 上，delete 拿不掉它——蓋一個 undefined 的
    // 自有屬性遮住原型，測完再把自有屬性刪掉讓原型露回來。
    Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined, configurable: true })
    try {
      expect(typeof crypto.randomUUID).toBe('undefined')
      expect(generateId()).toMatch(shape)
    } finally {
      // @ts-expect-error 只刪自有屬性，原型上的那個會重新生效。
      delete globalThis.crypto.randomUUID
    }
    expect(typeof crypto.randomUUID).toBe('function')
  })
})

describe('generateOwnerKey', () => {
  it('是 48 個十六進位字元，而且不重複', () => {
    const keys = Array.from({ length: 100 }, () => generateOwnerKey())
    for (const k of keys) expect(k).toMatch(/^[0-9a-f]{48}$/)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
