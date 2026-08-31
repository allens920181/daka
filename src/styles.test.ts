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
const ALLOWED_PX = new Set(['0px', '1px', '2px', '3px', '4px', '6px', '7px', '30px', '38px', '44px', '240px', '260px', '200px', '22px', '120px', '560px', '640px', '420px', '88px'])

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
