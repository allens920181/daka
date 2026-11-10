import { describe, expect, it } from 'vitest'
import { isExampleName, isExampleRoster, messages, translate } from './i18n'

describe('isExampleRoster', () => {
  it('認得每一種語言的範例，不管畫面現在是哪一種', () => {
    // 填了中文範例再去設定裡切成英文，那段文字並不會跟著變。
    for (const lang of ['zh', 'en'] as const) {
      expect(isExampleRoster(messages[lang].exampleRoster)).toBe(true)
    }
  })

  it('前後空白不算改動', () => {
    expect(isExampleRoster(`\n${messages.zh.exampleRoster}\n`)).toBe(true)
  })

  /**
   * 這一條是「清除範例」的整個安全性所在：判準寬一格，那顆按鈕就會從「取消範例」
   * 變成「清空我剛貼好的名單」，而畫面上長得一模一樣。
   */
  it('動過一個字就不算範例了', () => {
    const edited = `${messages.zh.exampleRoster}\n陳大明`
    expect(isExampleRoster(edited)).toBe(false)
    expect(isExampleRoster(messages.zh.exampleRoster.replace('王小明', '王大明'))).toBe(false)
    expect(isExampleRoster(messages.zh.exampleRoster.split('\n').slice(1).join('\n'))).toBe(false)
  })

  it('空字串不算範例（那時候該給的是「填入範例」）', () => {
    expect(isExampleRoster('')).toBe(false)
    expect(isExampleRoster('   \n  ')).toBe(false)
  })
})

describe('isExampleName', () => {
  it('認得每一種語言的範例活動名稱', () => {
    for (const lang of ['zh', 'en'] as const) {
      expect(isExampleName(messages[lang].exampleName)).toBe(true)
    }
  })

  /**
   * 兩個欄位分開判。使用者把活動名稱改成自己的、名單還留著範例時，清除鍵仍要
   * 出現（它清得掉名單），但不准動那個名字——那是使用者自己打的。
   */
  it('改過的活動名稱不算範例', () => {
    expect(isExampleName('秋季旅遊 · 出發（第二車）')).toBe(false)
    expect(isExampleName('')).toBe(false)
    expect(isExampleName(messages.zh.exampleRoster)).toBe(false)
  })
})

/**
 * 使用說明是拿去畫面上找字的：說明裡引用的每個按鈕名稱，都得跟那顆按鈕**現在**的名稱
 * 一致。比對的是 `messages` 裡的原字，不是寫死在測試裡的字——按鈕改了名而說明沒跟著改，
 * 這裡才會紅。（e2e 那條斷言寫死了字，擋不住這種漂移，只擋得住說明自己被改壞。）
 */
describe('使用說明引用的按鈕名稱', () => {
  const quote = {
    zh: (s: string) => `「${s}」`,
    en: (s: string) => `“${s}”`,
  }
  for (const lang of ['zh', 'en'] as const) {
    const m = messages[lang]
    const q = quote[lang]

    it(`${lang}：四步的標題就是對應那顆按鈕的名稱`, () => {
      expect(m.guideStep1Title).toBe(m.openRoom)
      expect(m.guideStep2Title).toBe(m.invite)
      expect(m.guideStep4Title).toBe(m.finishRound)
    })

    it(`${lang}：說明裡用括號引起來的按鈕名稱都存在`, () => {
      expect(m.guideStep2Body).toContain(q(m.invite))
      expect(m.guideStep2Body).toContain(q(m.joinRoom))
      expect(m.guideStep3Body).toContain(q(m.undo))
      expect(m.guideStep4Body).toContain(q(m.missing))
      expect(m.guideStep4Body).toContain(q(m.finishRound))
    })

    // 入口是導航列右上角那顆 ? 鍵（2026-11 從設定最後一列搬出來）。這句話說的是那顆鍵
    // 的圖示；入口再搬家時，這條會逼你回來改這句話，而不是讓它指著一個不存在的地方。
    it(`${lang}：告訴使用者去哪裡拿回來的那句，說的是導航列那顆 ? 鍵`, () => {
      expect(m.guideLater).toContain('?')
      expect(m.guideLater).not.toContain(m.settings)
    })
  }
})

describe('互動式教學的文案', () => {
  for (const lang of ['zh', 'en'] as const) {
    const m = messages[lang]

    it(`${lang}：進度文字吃得到 {n} 與 {total}（少一個，螢幕閱讀器就聽不到走到哪了）`, () => {
      expect(m.guideProgress).toContain('{n}')
      expect(m.guideProgress).toContain('{total}')
      expect(translate(lang, 'guideProgress', { n: 2, total: 4 })).toMatch(/2.*4/)
    })

    // 演練名單用名字當 key，也靠名字讓使用者分辨「我點的是哪一個」：重複的話
    // 點一個會看起來像點到兩個。
    it(`${lang}：演練名單的三個名字不重複、不空白`, () => {
      const names = [m.guideDemoName1, m.guideDemoName2, m.guideDemoName3]
      expect(names.every((n) => n.trim().length > 0)).toBe(true)
      expect(new Set(names).size).toBe(3)
    })
  }

  it('演練名單的名字跟「填入範例」同一組：之後在真的畫面上會再看到它們', () => {
    expect(messages.zh.exampleRoster).toContain(messages.zh.guideDemoName1)
    expect(messages.zh.exampleRoster).toContain(messages.zh.guideDemoName2)
    expect(messages.zh.exampleRoster).toContain(messages.zh.guideDemoName3)
  })
})

describe('translate', () => {
  it('缺的語言退回 zh，不會印出 key', () => {
    expect(translate('en', 'exampleClear')).toBe('Clear the example')
    expect(translate('zh', 'exampleClear')).toBe('清除範例')
  })
})
