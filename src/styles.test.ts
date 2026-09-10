import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Token 靜態檢查：確保沒有人繞過設計系統直接寫死數值。
 *
 * 這跟 scripts/design-audit.mjs 互補——那個驗「渲染出來的結果」，
 * 這個驗「原始碼有沒有守規矩」。兩者抓到的問題不一樣：
 * 硬寫一個剛好合格的顏色，執行期檢查看不出來，但它會在下次改 token 時脫隊。
 */
const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')

/** 只看 :root 以外的區塊——token 定義本身當然是字面值。 */
const body = css.slice(css.lastIndexOf("color-scheme: dark;"))

/**
 * 移除 @keyframes 區塊。裡面的數值是動畫的中間端點（例如 50% 時 opacity: .3），
 * 那是動態曲線的一部分，不是設計 token。
 */
function stripKeyframes(input: string): string {
  let out = ''
  let i = 0
  for (;;) {
    const at = input.indexOf('@keyframes', i)
    if (at === -1) return out + input.slice(i)
    out += input.slice(i, at)
    let depth = 0
    let j = input.indexOf('{', at)
    if (j === -1) return out
    for (; j < input.length; j++) {
      if (input[j] === '{') depth++
      else if (input[j] === '}' && --depth === 0) break
    }
    i = j + 1
  }
}

/** 允許的字面值：邊框寬度、透明度、百分比、0、以及列印用的 pt。 */
const ALLOWED_PX = new Set(['0px', '1px', '2px', '3px', '4px', '6px', '7px', '30px', '38px', '44px', '240px', '260px', '200px', '22px', '120px', '560px', '640px', '420px', '88px', '160px'])

describe('設計 token 的靜態檢查', () => {
  it('沒有硬寫的 font-size', () => {
    const hits = [...css.matchAll(/font-size:\s*(\d[\d.]*px)/g)].map((m) => m[1])
    expect(hits).toEqual([])
  })

  it('沒有硬寫的十六進位色（token 定義區與列印區除外）', () => {
    const printAt = body.indexOf('@media print')
    const scanned = printAt === -1 ? body : body.slice(0, printAt)
    const hits = [...scanned.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0])
    // QR 卡片必須是純白底：掃描器要的是對比，不是配色。
    expect(hits.filter((h) => h.toLowerCase() !== '#fff')).toEqual([])
  })

  it('z-index 一律用 token', () => {
    const hits = [...css.matchAll(/z-index:\s*(-?\d+)/g)].map((m) => m[0])
    expect(hits).toEqual([])
  })

  it('動畫與轉場時間一律用 token', () => {
    // 前置的 \.? 很重要：少了它，`.01ms` 會被捕捉成 `01ms` 而過不了篩選。
    const hits = [...css.matchAll(/(?:animation|transition)(?:-duration)?:[^;]*?(\.?\d[\d.]*m?s)/g)]
      .map((m) => m[1])
      .filter((v) => v !== '.01ms') // reduced-motion 的關閉值
    expect(hits).toEqual([])
  })

  it('間距值都落在 4px 階上（少數結構性尺寸除外）', () => {
    const printAt = css.indexOf('@media print')
    const scanned = printAt === -1 ? css : css.slice(0, printAt)
    const hits = [...scanned.matchAll(/(?:padding|margin|gap)[a-z-]*:\s*([^;]+);/g)]
      .flatMap((m) => (m[1] ?? '').split(/\s+/))
      .filter((v) => /^\d+px$/.test(v))
      .filter((v) => !ALLOWED_PX.has(v))
    expect(hits).toEqual([])
  })

  it('沒有硬寫的 rgba（遮罩必須走 --scrim）', () => {
    const printAt = body.indexOf('@media print')
    const scanned = printAt === -1 ? body : body.slice(0, printAt)
    expect([...scanned.matchAll(/rgba?\([^)]*\)/g)].map((m) => m[0])).toEqual([])
  })

  it('沒有裸露的 opacity 字面值', () => {
    const printAt = body.indexOf('@media print')
    const scanned = stripKeyframes(printAt === -1 ? body : body.slice(0, printAt))
    expect([...scanned.matchAll(/opacity:\s*([\d.]+)/g)].map((m) => m[1])).toEqual([])
  })

  /**
   * 形狀與類型的四條規則（2026-09 形狀重整）。
   *
   * docs/design/04-components/README.md 訂了兩條軸：表面說種類、圓角說尺寸。
   * 那份規範以前不存在——2026-09 的整體性評估寫下「沒有一條規則說什麼東西該有
   * 框」之後就沒有人寫，於是 --r-2 長到全站 38 條形狀規則裡的 20 條。
   * 這四個檢查讓那份規範有牙齒。
   */
  const RULES = (() => {
    // 逐條規則拆成 [選擇器, 宣告]，先去掉註解（註解裡有反例與歷史紀錄）。
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')
    return [...stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .map((m) => [(m[1] ?? '').trim().replace(/\s+/g, ' '), m[2] ?? ''] as const)
      .filter(([sel]) => sel && !sel.startsWith('@'))
  })()

  it('--r-3 只給覆蓋層（面板、對話框）', () => {
    // 它是「浮在遮罩上的那一塊」的形狀，不是「比較大的卡片」。
    const allowed = new Set(['.sheet', '.dialog'])
    const hits = RULES
      .filter(([, d]) => /border-radius:[^;]*--r-3/.test(d))
      .map(([sel]) => sel)
      .filter((sel) => !allowed.has(sel))
    expect(hits).toEqual([])
  })

  it('--el-1 只給「整塊可以按」的東西', () => {
    // 陰影在這個 app 裡有指派好的意思：這一整塊按得下去。
    // 名單列未到時浮起、已到時沉回頁面，教的就是這件事。
    const allowed = new Set(['.recent-item', '.member', ".segment[aria-pressed='true']"])
    const hits = RULES
      .filter(([, d]) => /box-shadow:[^;]*--el-1/.test(d))
      .map(([sel]) => sel)
      .filter((sel) => !allowed.has(sel))
    expect(hits).toEqual([])
  })

  it('凹槽不描邊（--surface-2 底不得同時有 border）', () => {
    // 填色已經定義形狀了，再描一條只是把同一件事說第二次。
    const hits = RULES
      .filter(([, d]) => /background(?:-color)?:\s*var\(--surface-2\)/.test(d))
      .filter(([, d]) => /(?:^|;)\s*border(?:-(?:top|right|bottom|left))?:\s*(?!none)[^;]*--rule/.test(d))
      .map(([sel]) => sel)
    expect(hits).toEqual([])
  })

  it('狀態選擇器不得改元件自己的形狀', () => {
    // :focus-visible 裡的 border-radius 不是在畫對焦框的圓角，是在改元件自己的
    // 圓角——沒有自己圓角的元件會在被 Tab 到的瞬間變形狀。
    const hits = RULES
      .filter(([sel]) => /:(?:focus|focus-visible|hover|active)\b/.test(sel))
      .filter(([, d]) => /(?:^|;)\s*border-radius:/.test(d))
      .map(([sel]) => sel)
    expect(hits).toEqual([])
  })

  /**
   * 箭頭指的是你會往哪裡去（2026-09）。
   *
   * 這個 app 只有兩個去處：**進去一張子畫面**（`›`）與**回上一層**（`‹`）。
   * 所以方向記號也只有兩個。曾經有第三個方向——設定列的 `⌄`「就地展開」——
   * 而那個互動 2026-09 收掉了（四列改成子畫面），`IconChevronDown`、
   * `IconChevronUp`、`.chevron` 一起走。
   *
   * **沒有第三種箭頭，因為沒有第三種去處。**
   */
  it('方向記號只有兩個：› 進去、‹ 回來', () => {
    const icons = readFileSync(new URL('./ui/icons.tsx', import.meta.url), 'utf8')
    const exported = [...icons.matchAll(/export const (Icon\w+)/g)].map((m) => m[1] as string)
    const directional = exported.filter((n) => /Chevron|Arrow|Caret|Back/.test(n)).sort()
    expect(directional).toEqual(['IconBack', 'IconChevronRight'])
  })

  it('沒有「就地展開」這個互動（.chevron 已移除）', () => {
    const hits = RULES.map(([sel]) => sel).filter((sel) => /\.chevron\b/.test(sel))
    expect(hits).toEqual([])
  })

  it('每個色彩 token 在三種主題狀態都有定義', () => {
    const names = [...new Set([...css.matchAll(/--(?:paper|surface|ink|rule|accent|st|fb|toast|scrim)[a-z0-9-]*(?=:)/g)].map((m) => m[0]))]
    const light = css.slice(css.indexOf(':root {'), css.indexOf('@media (prefers-color-scheme: dark)'))
    const media = css.slice(css.indexOf('@media (prefers-color-scheme: dark)'), css.indexOf(":root[data-theme='dark']"))
    const stamped = css.slice(css.indexOf(":root[data-theme='dark']"), css.indexOf('/* === 基礎'))
    const missing: string[] = []
    for (const n of names) {
      if (!light.includes(`${n}:`)) missing.push(`${n} 缺淺色`)
      if (!media.includes(`${n}:`)) missing.push(`${n} 缺 prefers-color-scheme: dark`)
      if (!stamped.includes(`${n}:`)) missing.push(`${n} 缺 [data-theme="dark"]`)
    }
    expect(missing).toEqual([])
  })
})
