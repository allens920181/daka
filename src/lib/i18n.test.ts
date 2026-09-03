import { describe, expect, it } from 'vitest'
import { isExampleRoster, messages, translate } from './i18n'

describe('isExampleRoster', () => {
  it('認得每一種語言的範例，不管畫面現在是哪一種', () => {
    // 填了中文範例再去設定裡切成英文，那段文字並不會跟著變。
    for (const lang of ['zh', 'en'] as const) {
      expect(isExampleRoster(messages[lang].pasteExampleText)).toBe(true)
    }
  })

  it('前後空白不算改動', () => {
    expect(isExampleRoster(`\n${messages.zh.pasteExampleText}\n`)).toBe(true)
  })

  /**
   * 這一條是「清除範例」的整個安全性所在：判準寬一格，那顆按鈕就會從「取消範例」
   * 變成「清空我剛貼好的名單」，而畫面上長得一模一樣。
   */
  it('動過一個字就不算範例了', () => {
    const edited = `${messages.zh.pasteExampleText}\n陳大明`
    expect(isExampleRoster(edited)).toBe(false)
    expect(isExampleRoster(messages.zh.pasteExampleText.replace('王小明', '王大明'))).toBe(false)
    expect(isExampleRoster(messages.zh.pasteExampleText.split('\n').slice(1).join('\n'))).toBe(false)
  })

  it('空字串不算範例（那時候該給的是「填入範例」）', () => {
    expect(isExampleRoster('')).toBe(false)
    expect(isExampleRoster('   \n  ')).toBe(false)
  })
})

describe('translate', () => {
  it('缺的語言退回 zh，不會印出 key', () => {
    expect(translate('en', 'pasteExampleClear')).toBe('Clear the example')
    expect(translate('zh', 'pasteExampleClear')).toBe('清除範例')
  })
})
