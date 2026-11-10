import { describe, expect, it } from 'vitest'
import { isExampleName, isExampleRoster, messages, translate } from './i18n'
import { CHAPTERS, STEPS, chaptersFor, stepsFor } from '../ui/guideSteps'

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
 * 聚焦導覽的文案（2026-11）。導覽有三十步、框住的都是畫面上真的按鈕，所以文案最容易出的事
 * 是**畫面改了、說明沒跟著改**——這一段是那個漂移的守衛。
 */
describe('聚焦導覽：步驟表', () => {
  it('步驟編號不重複，章節都用得到，每一步的舞台與目標有寫', () => {
    const ids = STEPS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    const used = new Set(STEPS.map((s) => s.chapter))
    expect(CHAPTERS.filter((c) => !used.has(c.id))).toEqual([])
    // target 是 null 只允許「最後的小提醒」：那一步講的事（加到主畫面）畫面上沒有東西可框。
    expect(STEPS.filter((s) => s.target === null).map((s) => s.id)).toEqual(['tips'])
  })

  it('每一步、每個語言都有標題與說明；宣告了單機版說法的，兩種語言都有', () => {
    for (const lang of ['zh', 'en'] as const) {
      const m = messages[lang]
      for (const st of STEPS) {
        expect(m[st.title].trim().length, `${lang} ${st.id} 標題`).toBeGreaterThan(0)
        expect(m[st.body].trim().length, `${lang} ${st.id} 說明`).toBeGreaterThan(0)
        if (st.bodyLocal) expect(m[st.bodyLocal].trim().length, `${lang} ${st.id} 單機版`).toBeGreaterThan(0)
      }
    }
  })

  it('單機版不介紹做不到的事：雲端才有的步驟整個不出現，空了的章節跟著不出現', () => {
    const local = stepsFor(false)
    expect(local.some((st) => st.cloud)).toBe(false)
    const cloud = stepsFor(true)
    expect(cloud.length).toBeGreaterThan(local.length)
    // 「加入別人的空間」整章都是雲端才有的功能。
    expect(chaptersFor(local).some((c) => c.id === 'join')).toBe(false)
    expect(chaptersFor(cloud).some((c) => c.id === 'join')).toBe(true)
    // 章節的 first／count 對得起步驟本身。
    for (const c of chaptersFor(cloud)) {
      expect(cloud[c.first]?.chapter).toBe(c.id)
      expect(cloud.filter((st) => st.chapter === c.id)).toHaveLength(c.count)
    }
  })

  it('每一步框的目標都有名字（class 或 data-tour），不是靠位置', () => {
    // 真的畫面多一列，靠位置找的目標就跑掉。（`.member:first-child` 是唯一例外：
    // 「名單的第一個人」本來就是它的意思。）
    for (const st of STEPS) {
      if (st.target === null) continue
      expect(st.target, st.id).toMatch(/^(\.[\w-]+|\[data-tour="[\w-]+"\])/)
    }
  })
})

/**
 * **說明裡「」括起來的字，都得是畫面上真的字。** 使用者是拿這段話去畫面上找字的，而聚焦框框住
 * 的就是那顆按鈕——所以比對的是 `messages` 裡那顆按鈕**現在**的名稱，不是寫死在測試裡的字：按鈕改了
 * 名而說明沒跟著改，這裡才會紅。（e2e 那條斷言寫死了字，擋不住這種漂移。）
 *
 * 不是畫面標籤的、說明裡又合理地用了引號的（舉例用的備註、`#` 分組的寫法、圖示記號），要明列在
 * `EXAMPLES`——這份清單是**刻意的例外**，加一個字就要想一下「它真的是例子嗎，還是我在引用一個
 * 沒有人看得到的標籤」。
 */
describe('聚焦導覽：說明引用的字', () => {
  /** 這些 key 的值就是畫面上的標籤。 */
  const LABEL_KEYS = [
    'openRoom', 'joinRoom', 'pasteRoster', 'exampleFill', 'exampleClear', 'formatHelp',
    'savedRosters', 'generateList', 'adjustList', 'confirmCreate', 'scanQr',
    'all', 'missing', 'arrived', 'undo',
    'manage', 'invite', 'edit', 'saveAsRoster', 'addWalkIn', 'roomCode', 'roomLink', 'roomQr',
    'finishRound', 'copySummaryShort', 'exportCsvShort', 'reopenRoom',
    'roomFilterAll', 'roomFilterMine', 'roomFilterOthers', 'roomFilterArchived',
    'copyRoom', 'archiveRoom', 'deleteRoom',
    'yourName', 'account', 'theme', 'fontSize', 'rollCallToast', 'language',
  ] as const

  /** 說明裡的例子（不是標籤）。 */
  const EXAMPLES = {
    zh: ['#第一車', '坐輪椅', '＋', '?', '某某 · 已到'],
    en: ['#Bus 1', 'wheelchair', '+', '?', 'name · Here'],
  } as const

  const quoted = {
    zh: (text: string) => [...text.matchAll(/「([^」]+)」/g)].map((m) => m[1] as string),
    en: (text: string) => [...text.matchAll(/“([^”]+)”/g)].map((m) => m[1] as string),
  }

  for (const lang of ['zh', 'en'] as const) {
    const m = messages[lang]
    const allowed = new Set<string>([...LABEL_KEYS.map((k) => m[k]), ...EXAMPLES[lang]])
    it(`${lang}：每一步說明裡引號括起來的字都是畫面上真的標籤（或明列的例子）`, () => {
      const unknown: string[] = []
      for (const st of STEPS) {
        for (const key of [st.body, st.bodyLocal]) {
          if (!key) continue
          for (const token of quoted[lang](m[key])) {
            if (!allowed.has(token)) unknown.push(`${st.id}：${token}`)
          }
        }
      }
      expect(unknown).toEqual([])
    })
  }

  it('標題多半就是那顆按鈕的名稱：按鈕改名，標題要跟著改', () => {
    // 步驟 id → 它的標題該等於哪個 key 的值。沒列的標題是描述性的（「主揪與協助者」「備註與撥號」），
    // 不是任何一顆按鈕的名字。
    const SAME_AS = {
      create: 'openRoom', roster: 'pasteRoster', example: 'exampleFill', help: 'formatHelp',
      saved: 'savedRosters', preview: 'parsePreview', confirm: 'confirmCreate', join: 'joinRoom',
      more: 'manage', invite: 'invite', edit: 'edit', walkin: 'addWalkIn', finish: 'finishRound',
      settings: 'settings', account: 'account',
    } as const
    for (const lang of ['zh', 'en'] as const) {
      const m = messages[lang]
      for (const st of STEPS) {
        const key = SAME_AS[st.id as keyof typeof SAME_AS]
        if (key) expect(m[st.title], `${lang} ${st.id}`).toBe(m[key])
      }
    }
  })

  it('每一章都有標題', () => {
    for (const lang of ['zh', 'en'] as const) {
      for (const c of CHAPTERS) expect(messages[lang][c.title].trim().length, `${lang} ${c.id}`).toBeGreaterThan(0)
    }
  })

  it('單機版的選單說明不提「存成常用」（那一列單機版整列不出現）', () => {
    expect(messages.zh.guideMenuBodyLocal).not.toContain(messages.zh.saveAsRoster)
    expect(messages.en.guideMenuBodyLocal).not.toContain(messages.en.saveAsRoster)
  })
})

describe('聚焦導覽：其他文案', () => {
  for (const lang of ['zh', 'en'] as const) {
    const m = messages[lang]

    it(`${lang}：進度文字吃得到 {n} 與 {total}（少一個，螢幕閱讀器就聽不到走到哪了）`, () => {
      expect(m.guideProgress).toContain('{n}')
      expect(m.guideProgress).toContain('{total}')
      expect(m.guideCount).toContain('{n}')
      expect(m.guideCount).toContain('{total}')
      expect(m.guideStepsCount).toContain('{n}')
      expect(m.guideStepsOne).toContain('{n}')
      expect(translate(lang, 'guideProgress', { n: 2, total: 4 })).toMatch(/2.*4/)
    })

    // 入口是導航列右上角那顆 ? 鍵（2026-11 從設定最後一列搬出來）。這句話說的是那顆鍵的圖示；
    // 入口再搬家時，這條會逼你回來改這句話，而不是讓它指著一個不存在的地方。
    it(`${lang}：告訴使用者去哪裡拿回來的那句，說的是導航列那顆 ? 鍵`, () => {
      expect(m.guideLater).toContain('?')
      expect(m.guideLater).not.toContain(m.settings)
      expect(m.guideTipsBody).toContain('?')
    })

    // 演練名單用名字當 key，也靠名字讓使用者分辨「我點的是哪一個」：重複的話點一個會看起來像
    // 點到兩個。
    it(`${lang}：演練名單的三個名字不重複、不空白；兩個分車與備註都有`, () => {
      const names = [m.guideDemoName1, m.guideDemoName2, m.guideDemoName3]
      expect(names.every((n) => n.trim().length > 0)).toBe(true)
      expect(new Set(names).size).toBe(3)
      expect(m.guideDemoGroup1).not.toBe(m.guideDemoGroup2)
      expect(m.guideDemoNote3.trim().length).toBeGreaterThan(0)
    })
  }

  it('演練名單跟「填入範例」同一組：之後在真的畫面上會再看到它們', () => {
    for (const lang of ['zh', 'en'] as const) {
      const m = messages[lang]
      expect(m.exampleRoster).toContain(m.guideDemoName1)
      expect(m.exampleRoster).toContain(m.guideDemoName2)
      expect(m.exampleRoster).toContain(m.guideDemoName3)
      // 分車標題也是範例裡的那兩個，備註也是範例裡那一則。
      expect(m.exampleRoster).toContain(`#${m.guideDemoGroup1}`)
      expect(m.exampleRoster).toContain(`#${m.guideDemoGroup2}`)
      expect(m.exampleRoster).toContain(m.guideDemoNote3)
    }
  })
})

describe('translate', () => {
  it('缺的語言退回 zh，不會印出 key', () => {
    expect(translate('en', 'exampleClear')).toBe('Clear the example')
    expect(translate('zh', 'exampleClear')).toBe('清除範例')
  })
})
