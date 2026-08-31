import { describe, expect, it } from 'vitest'
import { parseRoster, rosterToText } from './parse'

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
    expect(parseRoster('')).toEqual({ members: [], groups: [], duplicateNames: [], skipped: 0 })
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

describe('rosterToText', () => {
  it('可以往返', () => {
    const original = '王小明\n李美花 +1\n陳大同（請假）'
    const round = rosterToText(parseRoster(original).members)
    expect(parseRoster(round).members).toEqual(parseRoster(original).members)
  })
})

describe('parseRoster 電話', () => {
  const phones = (s: string) => parseRoster(s).members.map((m) => [m.name, m.phone])

  it('抽出手機號碼，名字裡不留', () => {
    expect(phones('王小明 0912345678')).toEqual([['王小明', '0912345678']])
  })

  it('接受連字號與空格', () => {
    expect(phones('李美花 0912-345-678\n陳大同 0912 345 678')).toEqual([
      ['李美花', '0912345678'], ['陳大同', '0912345678'],
    ])
  })

  it('接受 +886 格式並正規化成 0 開頭', () => {
    expect(phones('王五 +886912345678')).toEqual([['王五', '0912345678']])
  })

  it('市話含括號區碼不會被當成備註', () => {
    const m = parseRoster('陳伯伯 (02)2345-6789').members[0]
    expect(m).toMatchObject({ name: '陳伯伯', phone: '0223456789', note: null })
  })

  it('沒有電話時是 null', () => {
    expect(parseRoster('王小明').members[0]?.phone).toBeNull()
  })

  it('長度不對的數字串不會被誤判成電話', () => {
    expect(parseRoster('王小明 123').members[0]).toMatchObject({ name: '王小明 123', phone: null })
    expect(parseRoster('李美花 0912').members[0]).toMatchObject({ phone: null })
  })

  it('電話、攜伴、備註、編號可以同時出現', () => {
    const m = parseRoster('3. 王媽媽 0912345678 +2（素食）').members[0]
    expect(m).toMatchObject({ name: '王媽媽', phone: '0912345678', companions: 2, note: '素食' })
  })

  it('往返後電話仍保留', () => {
    const original = '王小明 0912345678 +1（素食）'
    const round = rosterToText(parseRoster(original).members)
    expect(parseRoster(round).members).toEqual(parseRoster(original).members)
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
