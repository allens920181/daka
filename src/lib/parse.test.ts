import { describe, expect, it } from 'vitest'
import { messages } from './i18n'
import { dialableFrom, parseRoster, removeParsedMember, rosterToText, telHref } from './parse'

const names = (s: string) => parseRoster(s).members.map((m) => m.name)

describe('parseRoster', () => {
  it('每行一個名字', () => {
    expect(names('王小明\n李美花\n陳大同')).toEqual(['王小明', '李美花', '陳大同'])
  })

  it('去掉各種開頭編號', () => {
    expect(names('1.王小明\n2、李美花\n3) 陳大同\n4：張三\n10 李四')).toEqual([
      '王小明', '李美花', '陳大同', '張三', '李四',
    ])
  })

  it('去掉項目符號', () => {
    expect(names('- 王小明\n• 李美花\n* 陳大同\n· 張三')).toEqual([
      '王小明', '李美花', '陳大同', '張三',
    ])
  })

  it('處理全形數字與標點', () => {
    expect(names('１．王小明\n２、李美花\n３．陳大同')).toEqual(['王小明', '李美花', '陳大同'])
  })

  it('全形空白不會留在名字裡', () => {
    expect(names('　王小明　')).toEqual(['王小明'])
  })

  it('解析 +N 攜伴', () => {
    const r = parseRoster('王小明\n李美花 +1\n陳大同+2\n張三 ＋ 3')
    expect(r.members.map((m) => [m.name, m.companions])).toEqual([
      ['王小明', 0], ['李美花', 1], ['陳大同', 2], ['張三', 3],
    ])
  })

  it('解析「帶N人」攜伴', () => {
    const r = parseRoster('王媽媽帶2人\n李伯伯 帶 1 位\n陳姐帶3')
    expect(r.members.map((m) => [m.name, m.companions])).toEqual([
      ['王媽媽', 2], ['李伯伯', 1], ['陳姐', 3],
    ])
  })

  it('括號內容變成備註，不留在名字裡', () => {
    const r = parseRoster('王小明（請假）\n李美花[遲到]\n陳大同【素食】')
    expect(r.members.map((m) => [m.name, m.note])).toEqual([
      ['王小明', '請假'], ['李美花', '遲到'], ['陳大同', '素食'],
    ])
  })

  it('編號＋攜伴＋備註同時出現', () => {
    const r = parseRoster('2. 李美花 +1（素食）')
    expect(r.members[0]).toMatchObject({ name: '李美花', companions: 1, note: '素食' })
  })

  it('一行被貼成多筆時會切開', () => {
    expect(names('1.王小明 2.李美花 3.陳大同')).toEqual(['王小明', '李美花', '陳大同'])
  })

  it('只有一個編號時不切，避免破壞含數字的名字', () => {
    expect(names('房2號 王小明')).toEqual(['房2號 王小明'])
  })

  it('跳過空行與純符號行', () => {
    const r = parseRoster('王小明\n\n---\n===\n   \n李美花')
    expect(r.members.map((m) => m.name)).toEqual(['王小明', '李美花'])
    expect(r.skipped).toBe(2)
  })

  it('保留同名的人，但回報重複', () => {
    const r = parseRoster('陳怡君\n王小明\n陳怡君')
    expect(r.members).toHaveLength(3)
    expect(r.duplicateNames).toEqual(['陳怡君'])
  })

  it('去掉 LINE 提及的 @ 前綴', () => {
    expect(names('@王小明')).toEqual(['王小明'])
  })

  it('空輸入回傳空名單', () => {
    expect(parseRoster('')).toEqual({ members: [], sources: [], groups: [], duplicateNames: [], skipped: 0 })
    expect(parseRoster('   \n  \n')).toMatchObject({ members: [] })
  })

  it('名字長度上限 60', () => {
    const long = '王'.repeat(100)
    expect(parseRoster(long).members[0]?.name).toHaveLength(60)
  })

  it('攜伴數上限 99', () => {
    expect(parseRoster('王小明 +99').members[0]?.companions).toBe(99)
  })

  it('真實的 LINE 接龍', () => {
    const r = parseRoster(`秋季旅遊報名
1.王小明
2. 李美花 +1
3、陳大同（請假）
４．張三
- 李四
王五 帶2人`)
    expect(r.members.map((m) => m.name)).toEqual([
      '秋季旅遊報名', '王小明', '李美花', '陳大同', '張三', '李四', '王五',
    ])
    expect(r.members[2]).toMatchObject({ companions: 1 })
    expect(r.members[3]).toMatchObject({ note: '請假' })
    expect(r.members[6]).toMatchObject({ companions: 2 })
  })
})

describe('removeParsedMember', () => {
  /** 從解析結果裡找出叫這個名字的那一位，回傳移除之後的文字。 */
  const drop = (text: string, name: string) => {
    const r = parseRoster(text)
    const i = r.members.findIndex((m) => m.name === name)
    expect(i).toBeGreaterThanOrEqual(0)
    return removeParsedMember(text, r.sources[i]!)
  }

  it('拿掉獨佔一行的人，整行消失', () => {
    expect(drop('王小明\n李美花\n張三', '李美花')).toBe('王小明\n張三')
  })

  it('接龍的標題行被當成人時也刪得掉', () => {
    // 解析器刻意不自動猜「秋季旅遊報名」是不是人名，決定權交回使用者。
    const text = '秋季旅遊報名\n1.王小明\n2.李美花'
    expect(drop(text, '秋季旅遊報名')).toBe('1.王小明\n2.李美花')
  })

  it('一行有多人時只拿掉那一個，其他人與格式都留著', () => {
    expect(drop('1.王小明 2.李美花 3.張三', '李美花')).toBe('1.王小明 3.張三')
  })

  it('一行多人時刪到剩最後一個，那一行還在', () => {
    const once = drop('1.王小明 2.李美花', '王小明')
    expect(once.trim()).toBe('2.李美花')
  })

  it('一行多人時全部刪光，整行才消失', () => {
    let text = '甲\n1.王小明 2.李美花\n乙'
    text = drop(text, '王小明')
    text = drop(text, '李美花')
    expect(text).toBe('甲\n乙')
  })

  it('全形編號也切得對（不會把整行連坐刪掉）', () => {
    // 切點是在正規化後的文字上算的，但要切的是使用者原本打的字。
    const text = '１．王小明　２．李美花'
    const after = drop(text, '李美花')
    expect(after).toContain('王小明')
    expect(after).not.toContain('李美花')
  })

  it('刪掉分組裡的人不會動到分組標題', () => {
    const text = '【第一車】\n王小明\n李美花'
    expect(drop(text, '王小明')).toBe('【第一車】\n李美花')
  })

  it('刪完之後重新解析，剩下的人位置仍然正確', () => {
    let text = '甲\n乙\n丙\n丁'
    text = drop(text, '乙')
    text = drop(text, '丁')
    expect(parseRoster(text).members.map((m) => m.name)).toEqual(['甲', '丙'])
  })

  it('保留 CRLF 換行', () => {
    expect(drop('甲\r\n乙\r\n丙', '乙')).toBe('甲\r\n丙')
  })

  it('越界的來源位置不會壞掉', () => {
    expect(removeParsedMember('甲\n乙', { line: 99, part: 0 })).toBe('甲\n乙')
  })
})

describe('rosterToText', () => {
  it('可以往返', () => {
    const original = '王小明\n李美花 +1\n陳大同（請假）'
    const round = rosterToText(parseRoster(original).members)
    expect(parseRoster(round).members).toEqual(parseRoster(original).members)
  })
})

/**
 * 名字到哪裡結束，備註從哪裡開始。
 *
 * 解析器刻意不再判斷任何一串數字是什麼——舊版會在一行裡到處找「看起來像台灣
 * 電話」的片段，於是「匯款 700-1234567」被抽成 `001234567`、名字變成
 * 「李美花 匯款 7」，撥出去是空號而畫面上沒有一個字說得出為什麼。現在只回答
 * 一個沒有歧義的問題：名字到第一個「空白＋數字」為止，後面整段原文照抄。
 */
describe('parseRoster 名字與備註的切分', () => {
  const split = (s: string) => {
    const m = parseRoster(s).members[0]
    return [m?.name, m?.note]
  }

  it('數字前面切開，名字裡不留號碼', () => {
    expect(split('王小明 0912345678')).toEqual(['王小明', '0912345678'])
  })

  it('切在空白而不是第一個數字，英文名字才不會被切斷', () => {
    expect(split('Alice Chen 0912345678')).toEqual(['Alice Chen', '0912345678'])
  })

  it('空白後面不是數字就不切', () => {
    expect(split('陳大同 A123456789')).toEqual(['陳大同 A123456789', null])
    expect(split('王小明 素食')).toEqual(['王小明 素食', null])
    expect(split('S1 王小明')).toEqual(['S1 王小明', null])
  })

  it('號碼後面的字一起進備註', () => {
    expect(split('林小姐 0912345678 已匯款')).toEqual(['林小姐', '0912345678 已匯款'])
  })

  it('括號備註與行尾那段會合併，行尾的排前面', () => {
    expect(split('王媽媽 0912-345-678（素食）')).toEqual(['王媽媽', '0912-345-678 素食'])
  })

  it('括號裡全是數字的不是備註，是市話區碼', () => {
    expect(split('陳伯伯 (02)2345-6789')).toEqual(['陳伯伯', '(02)2345-6789'])
  })

  it('請假仍然只看括號裡的字，不會被前面那串號碼沖淡', () => {
    expect(parseRoster('李美花 0912345678（請假）').members[0]).toMatchObject({
      name: '李美花', note: '0912345678 請假', status: 'excused',
    })
  })

  it('攜伴先抽走，不會跑進備註', () => {
    expect(parseRoster('王媽媽 0912345678 +2（素食）').members[0]).toMatchObject({
      name: '王媽媽', note: '0912345678 素食', companions: 2,
    })
    expect(parseRoster('王五 帶2人').members[0]).toMatchObject({ name: '王五', note: null, companions: 2 })
  })

  it('解析不再產生 phone 欄位', () => {
    expect(parseRoster('王小明 0912345678').members[0]?.phone).toBeNull()
  })

  /**
   * `+65` 被當成「攜伴 65 人」會直接灌爆人頭數，而人頭數是這個 App 最不能錯
   * 的量。但 `+1 0912345678` 仍然是攜伴 1 加一支台灣號碼——接龍裡這樣寫的人
   * 比寫美國號碼的多得多，判準是後面那串數字有沒有以 0 開頭。
   */
  it('國碼不是攜伴', () => {
    expect(parseRoster('Tan +65 9123 4567').members[0]).toMatchObject({
      name: 'Tan', note: '+65 9123 4567', companions: 0,
    })
    expect(parseRoster('王五 +886 912 345 678').members[0]).toMatchObject({ companions: 0 })
  })

  it('攜伴加台灣號碼仍然算攜伴', () => {
    expect(parseRoster('李美花 +1 0912345678').members[0]).toMatchObject({
      name: '李美花', note: '0912345678', companions: 1,
    })
  })

  it('往返後名字與備註都不變', () => {
    const original = '王小明 0912345678 +1（素食）'
    const round = rosterToText(parseRoster(original).members)
    expect(parseRoster(round).members).toEqual(parseRoster(original).members)
  })
})

/**
 * 撥號鍵長在顯示層。這裡猜錯只是多一顆鍵、備註原文一字未動；存進資料庫的
 * 假號碼才是看不見的那種錯。所以判準只有「0 或 + 開頭、8～15 碼」。
 */
describe('dialableFrom', () => {
  it('認得台灣手機、市話與 +886', () => {
    expect(dialableFrom('0912345678')).toEqual(['0912345678'])
    expect(dialableFrom('0912-345-678 素食')).toEqual(['0912-345-678'])
    expect(dialableFrom('(02)2345-6789')).toEqual(['(02)2345-6789'])
    expect(dialableFrom('+886 912 345 678')).toEqual(['+886 912 345 678'])
  })

  it('國際號碼也撥得出去——備註是原文，不需要解析器支援', () => {
    expect(dialableFrom('+65 9123 4567')).toEqual(['+65 9123 4567'])
    expect(telHref('+65 9123 4567')).toBe('tel:+6591234567')
  })

  it('不是 0 或 + 開頭的數字串不給撥號鍵', () => {
    expect(dialableFrom('700-1234567')).toEqual([])   // 郵局帳號
    expect(dialableFrom('A123456789')).toEqual([])    // 身分證
    expect(dialableFrom('統編 12345678')).toEqual([])
  })

  it('太短的不給', () => {
    expect(dialableFrom('0912')).toEqual([])          // 生日
    expect(dialableFrom('房號 0912-2')).toEqual([])
  })

  it('不從一串更長的數字中間切下來', () => {
    expect(dialableFrom('匯款 700-1234567')).toEqual([])
    expect(dialableFrom('0021234567')).toEqual(['0021234567'])
  })

  it('沒有備註就沒有撥號鍵', () => {
    expect(dialableFrom(null)).toEqual([])
    expect(dialableFrom('素食')).toEqual([])
  })

  it('telHref 去掉分隔符，只留數字與開頭的 +', () => {
    expect(telHref('(02)2345-6789')).toBe('tel:0223456789')
    expect(telHref('0912-345-678')).toBe('tel:0912345678')
  })
})

describe('parseRoster 請假狀態', () => {
  it('名單上寫請假的人直接是請假狀態，不會混進未到', () => {
    const m = parseRoster('陳大同（請假）').members[0]
    expect(m).toMatchObject({ name: '陳大同', note: '請假', status: 'excused' })
  })

  it('認得多種說法', () => {
    for (const word of ['請假', '不去', '不參加', '取消', '缺席', 'absent', 'Excused']) {
      expect(parseRoster(`王小明（${word}）`).members[0]?.status).toBe('excused')
    }
  })

  it('一般備註不會被誤判', () => {
    for (const word of ['素食', '坐前排', '晚點到', '會遲到']) {
      expect(parseRoster(`王小明（${word}）`).members[0]?.status).toBeUndefined()
    }
  })

  it('長句子不誤判：「請假單已交但還是會去」', () => {
    const m = parseRoster('王小明（請假單已交但還是會去）').members[0]
    expect(m?.status).toBeUndefined()
    expect(m?.note).toBe('請假單已交但還是會去')
  })

  it('沒有備註時沒有 status 欄位', () => {
    expect(parseRoster('王小明').members[0]?.status).toBeUndefined()
  })
})

describe('parseRoster 分組', () => {
  const grouped = (s: string) => parseRoster(s).members.map((m) => [m.name, m.group_label])

  it('括號標題行把後續的人歸到該組', () => {
    expect(grouped('【第一車】\n王小明\n李美花\n【第二車】\n陳大同')).toEqual([
      ['王小明', '第一車'], ['李美花', '第一車'], ['陳大同', '第二車'],
    ])
  })

  it('沒有括號的「第二車」也算標題', () => {
    expect(grouped('第一車\n王小明\n第二車\n李美花')).toEqual([
      ['王小明', '第一車'], ['李美花', '第二車'],
    ])
  })

  it('A車 / B組 這種也認得', () => {
    expect(grouped('A車\n王小明\nB組\n李美花')).toEqual([
      ['王小明', 'A車'], ['李美花', 'B組'],
    ])
  })

  it('分隔線與冒號不影響判斷', () => {
    expect(grouped('--- 第一車 ---\n王小明\n【第二車】：\n李美花')).toEqual([
      ['王小明', '第一車'], ['李美花', '第二車'],
    ])
  })

  it('標題之前的人沒有分組', () => {
    expect(grouped('王小明\n【第一車】\n李美花')).toEqual([
      ['王小明', null], ['李美花', '第一車'],
    ])
  })

  it('「未分組」標題可以把分組清掉', () => {
    expect(grouped('【第一車】\n王小明\n【未分組】\n李美花')).toEqual([
      ['王小明', '第一車'], ['李美花', null],
    ])
  })

  it('人名不會被誤判成分組標題', () => {
    expect(grouped('王小明\n李美花\n陳大同')).toEqual([
      ['王小明', null], ['李美花', null], ['陳大同', null],
    ])
  })

  it('帶括號備註的人不會被當成標題', () => {
    const m = parseRoster('王小明（請假）').members[0]
    expect(m).toMatchObject({ name: '王小明', note: '請假', group_label: null })
  })

  it('回報出現過的分組，依順序', () => {
    expect(parseRoster('【B車】\n甲\n【A車】\n乙\n【B車】\n丙').groups).toEqual(['B車', 'A車'])
  })

  it('分組名長度上限 20', () => {
    const long = '車'.repeat(30)
    expect(parseRoster(`【${long}】\n甲`).members[0]?.group_label ?? '').toHaveLength(0)
  })

  it('分組往返不會把「未分組」的人吸進上一組', () => {
    const original = '【第一車】\n王小明 +1\n【未分組】\n李美花 0912345678'
    const round = rosterToText(parseRoster(original).members)
    expect(parseRoster(round).members).toEqual(parseRoster(original).members)
  })

  it('完整的分車接龍', () => {
    const r = parseRoster(`秋季旅遊
【第一車】
1.王小明 0912345678
2. 李美花 +1
【第二車】
3、陳大同（請假）
4.王媽媽 帶2人`)
    expect(r.groups).toEqual(['第一車', '第二車'])
    expect(r.members.map((m) => [m.name, m.group_label])).toEqual([
      ['秋季旅遊', null],
      ['王小明', '第一車'], ['李美花', '第一車'],
      ['陳大同', '第二車'], ['王媽媽', '第二車'],
    ])
    expect(r.members[3]).toMatchObject({ status: 'excused' })
    expect(r.members[4]).toMatchObject({ companions: 2 })
  })
})

/**
 * 「填入範例」按進去的那段文字。
 *
 * 範例是拿來示範解析器吃得下什麼的，所以它自己得先過得了解析器：少一行解析
 * 不出來，第一次用的人按下去就會看到一個「1 行看起來不是姓名，已略過」的
 * 警告，而那一行是我們自己寫的。示範的項目也一併釘住——改文案時很容易順手
 * 把電話或攜伴刪掉，那顆按鈕就變成只是在填字。
 */
describe('填入範例的文字', () => {
  for (const lang of ['zh', 'en'] as const) {
    it(`${lang}：每一行都解析得出一個人`, () => {
      const text = messages[lang].exampleRoster
      const r = parseRoster(text)
      expect(r.skipped).toBe(0)
      expect(r.members.length).toBe(text.split('\n').length)
    })

    it(`${lang}：電話、攜伴、請假三件事都示範到`, () => {
      const r = parseRoster(messages[lang].exampleRoster)
      // 電話不再是欄位，而是備註裡撥得出去的一段——範例仍要示範到這件事，
      // 否則第一次用的人不會知道號碼該寫在哪裡。
      expect(r.members.some((m) => dialableFrom(m.note).length > 0)).toBe(true)
      expect(r.members.some((m) => m.companions > 0)).toBe(true)
      expect(r.members.some((m) => m.status === 'excused')).toBe(true)
    })
  }
})
