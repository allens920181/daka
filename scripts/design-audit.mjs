// 設計規範的自動檢查。對應 docs/design-system.md §12。
//
// 在真實瀏覽器裡走過主要畫面，淺色與深色各驗一次。有任何違反就 exit 1。
//
//   npm run build && npx vite preview --port 4173 --host 127.0.0.1
//   node scripts/design-audit.mjs
//
// 可傳入自訂網址：node scripts/design-audit.mjs http://127.0.0.1:4173/daka/

import { existsSync } from 'node:fs'
import { chromium } from 'playwright'

const URL = process.argv[2] ?? 'http://127.0.0.1:4173/daka/'
// 本機沙盒有預先安裝的 Chromium；CI 用 playwright 自己下載的。
const BROWSER = process.env.CHROMIUM_PATH
  ?? (existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome')
    ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
    : undefined)

/** docs/design/03-tokens.md §4 的八階字級。 */
const FONT_SCALE = [11, 13, 15, 17, 20, 26, 34, 44]
/** §6：一般可互動元素 48px；Toast 動作是暫時性表面，放寬到 44px。 */
const TAP_MIN = 48
const TAP_EXCEPTIONS = { 'toast-action': 44 }

function collect() {
  const parse = (c) => {
    const m = c.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/)
    return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null
  }
  const lum = ({ r, g, b }) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }
  const ratio = (a, b) => {
    const [hi, lo] = [lum(a), lum(b)].sort((p, q) => q - p)
    return (hi + 0.05) / (lo + 0.05)
  }
  const bgOf = (el) => {
    let n = el
    while (n && n !== document.documentElement) {
      const c = parse(getComputedStyle(n).backgroundColor)
      if (c && c.a > 0.5) return c
      n = n.parentElement
    }
    return parse(getComputedStyle(document.body).backgroundColor) ?? { r: 255, g: 255, b: 255, a: 1 }
  }
  const label = (el) =>
    `${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).trim().split(/\s+/).join('.') : ''}`

  /**
   * 祖先鏈上所有 opacity 的乘積。
   *
   * getComputedStyle(el).color 讀到的是「宣告的顏色」，不含祖先 opacity 的影響。
   * 於是像 `.member.is-excused { opacity: .62 }` 這種寫法，會把裡面 13px 的說明
   * 文字實際壓到 2.5:1，而這份檢查完全驗不到——螢幕上看得見的問題，工具說通過。
   */
  const effOpacity = (el) => {
    let n = el, o = 1
    while (n && n !== document.documentElement) {
      const v = parseFloat(getComputedStyle(n).opacity)
      if (!Number.isNaN(v)) o *= v
      n = n.parentElement
    }
    return o
  }
  /** 把前景色按有效不透明度混進背景，得到眼睛真正看到的顏色。 */
  const blend = (fg, bg, a) => ({
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
    a: 1,
  })

  const out = { contrast: [], tap: [], font: [], name: [], nonText: [], primary: 0 }

  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue
    // inert 子樹（面板開啟時的背景）不屬於當前畫面，整段跳過。
    if (el.closest('[inert]')) continue
    const rect = el.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) continue

    if (el.classList?.contains('btn-primary')) out.primary++

    const ownText = [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .join('')
    if (ownText) {
      const fs = Math.round(parseFloat(cs.fontSize) * 100) / 100
      out.font.push({ fs, el: label(el), text: ownText.slice(0, 20) })

      const bg = bgOf(el)
      const declared = parse(cs.color)
      // 顏色自己的 alpha 與祖先 opacity 一起算進去，再跟背景比。
      const a = declared ? declared.a * effOpacity(el) : 0
      const fg = declared && bg ? blend(declared, bg, a) : null
      // WCAG 1.4.3 明確豁免停用中的控制項（inactive user interface component）。
      // 不豁免的話 --op-disabled 會讓每一顆停用按鈕都變成永久噪音，真正的問題
      // 反而被淹沒。
      const inactive = Boolean(el.closest('[disabled], [aria-disabled="true"]'))
      if (fg && bg && a > 0.06 && !inactive) {
        const r = ratio(fg, bg)
        const bold = parseInt(cs.fontWeight, 10) >= 700
        const large = fs >= 24 || (fs >= 18.66 && bold)
        const need = large ? 3 : 4.5
        if (r + 0.005 < need) {
          out.contrast.push({ ratio: +r.toFixed(2), need, fs, el: label(el), text: ownText.slice(0, 20) })
        }
      }
    }

    /*
     * 非文字的狀態指示。WCAG 1.4.11 要求 3:1。
     *
     * 「未到」是一個空心圓——它是名單上唯一表示「這個人還沒上車」的形狀，
     * 而它沒有自己的文字節點，所以上面那段以文字為單位的檢查看不到它。
     * 這裡明確點名幾個「形狀就是資訊」的元素。
     */
    const NON_TEXT = ['check', 'sync-dot', 'chip-count', 'chip-tell']
    if ([...(el.classList ?? [])].some((c) => NON_TEXT.includes(c))) {
      const bg = bgOf(el.parentElement ?? el)
      const a = effOpacity(el)
      let best = 0
      // 邊框與填色只要有一個達標就算過：實心圓不需要外框也看得見，
      // 空心圓則完全靠那條線。
      for (const [prop, widthProp] of [['borderTopColor', 'borderTopWidth'], ['backgroundColor', null]]) {
        if (widthProp && parseFloat(cs[widthProp]) < 0.5) continue
        const c = parse(cs[prop])
        if (!c || c.a * a <= 0.06) continue
        best = Math.max(best, ratio(blend(c, bg, c.a * a), bg))
      }
      if (best > 0 && best + 0.005 < 3) {
        out.nonText.push({ el: label(el), ratio: +best.toFixed(2), need: 3 })
      }
    }

    if (el.matches('button, a[href], input, textarea, select, [role=button]')) {
      const cls = [...(el.classList ?? [])]
      const min = cls.reduce((m, c) => Math.min(m, EXC[c] ?? Infinity), Infinity)
      const need = Number.isFinite(min) ? min : MIN
      if (rect.width + 0.5 < need || rect.height + 0.5 < need) {
        out.tap.push({ el: label(el), w: +rect.width.toFixed(1), h: +rect.height.toFixed(1), need, text: (el.textContent || '').trim().slice(0, 16) })
      }
      const name = el.getAttribute('aria-label') || el.getAttribute('title') ||
        (el.textContent || '').trim() ||
        (el.labels?.length ? [...el.labels].map((l) => l.textContent).join(' ').trim() : '') ||
        el.getAttribute('placeholder')
      if (!name) out.name.push({ el: label(el) })
    }
  }
  return out
}

const violations = []
const note = (scheme, screen, rule, detail) => violations.push({ scheme, screen, rule, detail })

async function audit(page, scheme, screen) {
  const r = await page.evaluate(
    ({ fn, MIN, EXC }) => new Function('MIN', 'EXC', `return (${fn})()`)(MIN, EXC),
    { fn: collect.toString(), MIN: TAP_MIN, EXC: TAP_EXCEPTIONS },
  )

  for (const c of r.contrast) {
    note(scheme, screen, '對比', `${c.ratio}:1（需 ${c.need}） ${c.fs}px ${c.el} 「${c.text}」`)
  }
  for (const t of r.tap) {
    note(scheme, screen, '觸控尺寸', `${t.w}×${t.h}（需 ${t.need}） ${t.el} 「${t.text}」`)
  }
  for (const f of r.font) {
    if (!FONT_SCALE.includes(Math.round(f.fs))) {
      note(scheme, screen, '字級不在八階內', `${f.fs}px ${f.el} 「${f.text}」`)
    }
  }
  for (const n of r.nonText) {
    note(scheme, screen, '非文字元件對比不足',
      `${n.el} ${n.ratio}:1（狀態靠形狀表達時線條要 ${n.need}:1）`)
  }
  for (const n of r.name) note(scheme, screen, '缺無障礙名稱', n.el)
  if (r.primary > 1) note(scheme, screen, '主要按鈕過多', `找到 ${r.primary} 個 .btn-primary，規範是至多一個`)

  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth)
  if (overflow > 1) note(scheme, screen, '頁面橫向溢出', `${overflow}px`)
}

const browser = await chromium.launch(BROWSER ? { executablePath: BROWSER } : {})

for (const scheme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => note(scheme, '—', 'JS 錯誤', e.message))

  await page.goto(URL); await page.waitForTimeout(900)
  await audit(page, scheme, '首頁')

  await page.getByRole('button', { name: /創建空間|Create a room/ }).first().click()
  await page.waitForTimeout(300)
  await page.locator('#room-name').fill('秋季旅遊 · 出發')
  await page.locator('#roster-text').fill(
    '王小明 0912345678\n李美花 +1\n陳大同（請假）\n張三\n李四\n王五 帶2人')
  await page.waitForTimeout(400)
  await audit(page, scheme, '創建空間')

  await page.getByRole('button', { name: /建立|Create/ }).click(); await page.waitForTimeout(1200)
  await page.locator('.member-main').nth(0).click(); await page.waitForTimeout(500)
  await audit(page, scheme, '空間（含 Toast）')

  await page.locator('.topbar button[aria-label="更多"]').click(); await page.waitForTimeout(500)
  await audit(page, scheme, '「更多」面板')
  await page.getByRole('button', { name: /^匯出結果$|^Export results$/ }).click(); await page.waitForTimeout(400)
  await audit(page, scheme, '「更多」· 匯出結果')
  await page.keyboard.press('Escape'); await page.waitForTimeout(300)

  await page.locator('.member').nth(1).locator('.icon-btn').last().click(); await page.waitForTimeout(400)
  await audit(page, scheme, '成員面板')
  await page.keyboard.press('Escape'); await page.waitForTimeout(300)

  // --- 分組（分車）---
  await page.locator('.topbar button[aria-label="更多"]').click(); await page.waitForTimeout(400)
  await page.getByRole('button', { name: /編輯名單|Edit roster/ }).click(); await page.waitForTimeout(400)
  await page.locator('#roster-text').fill(
    '【第一車】\n王小明 0912345678\n李美花 +1\n【第二車】\n陳大同（請假）\n張三\n李四')
  await page.waitForTimeout(400)
  await page.locator('.sheet').getByRole('button', { name: /儲存|Save/ }).click(); await page.waitForTimeout(500)
  await page.getByRole('button', { name: /^刪除空間$|^Delete room$/ }).count().catch(() => 0)
  const confirmSave = page.locator('[role=alertdialog] .btn-danger')
  if (await confirmSave.count()) { await confirmSave.click(); await page.waitForTimeout(900) }
  await page.keyboard.press('Escape'); await page.waitForTimeout(400)
  await audit(page, scheme, '空間（含分組）')

  // 首頁每個空間右邊那顆「更多」（2026-09）：邀請點名、重新命名、建立副本、
  // 刪除空間都住在這裡。單機模式（沒設定 Supabase 的建置，也就是這支腳本跑的
  // 那個）邀請頁只有一塊說明，三種方式一個都不列。
  await page.goto(URL); await page.waitForTimeout(900)
  await page.getByRole('button', { name: /^(更多|More)：/ }).first().click(); await page.waitForTimeout(500)
  await audit(page, scheme, '首頁 · 空間選單')
  await page.getByRole('button', { name: /^邀請點名$|^Invite$/ }).click(); await page.waitForTimeout(600)
  await audit(page, scheme, '首頁 · 邀請點名')
  await page.keyboard.press('Escape'); await page.waitForTimeout(300)

  await ctx.close()
}
await browser.close()

if (violations.length === 0) {
  console.log('設計規範檢查通過：對比（含祖先 opacity）、非文字元件對比、觸控尺寸、字級、無障礙名稱、橫向溢出、主要按鈕數量。')
  process.exit(0)
}

const byRule = new Map()
for (const v of violations) {
  const k = v.rule
  if (!byRule.has(k)) byRule.set(k, [])
  byRule.get(k).push(v)
}
console.log(`設計規範違反 ${violations.length} 項：\n`)
for (const [rule, list] of byRule) {
  console.log(`【${rule}】${list.length} 項`)
  const seen = new Set()
  for (const v of list) {
    const key = `${v.scheme}|${v.detail}`
    if (seen.has(key)) continue
    seen.add(key)
    console.log(`  [${v.scheme}/${v.screen}] ${v.detail}`)
  }
  console.log()
}
process.exit(1)
