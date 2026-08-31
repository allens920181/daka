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

  const out = { contrast: [], tap: [], font: [], name: [], primary: 0 }

  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue
    // inert 子樹（面板開啟時的背景）不屬於當前畫面，整段跳過。
    if (el.closest('[inert]')) continue
    // 看板模式的觀看距離是 3 公尺，字級另成一套（03-tokens.md §4.1 的具名例外）。
    // 對比與觸控尺寸仍然要驗，只有字級白名單放行。
    const inBoard = Boolean(el.closest('.board'))
    const rect = el.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) continue

    if (el.classList?.contains('btn-primary')) out.primary++

    const ownText = [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .join('')
    if (ownText) {
      const fs = Math.round(parseFloat(cs.fontSize) * 100) / 100
      if (!inBoard) out.font.push({ fs, el: label(el), text: ownText.slice(0, 20) })

      const fg = parse(cs.color)
      const bg = bgOf(el)
      if (fg && bg && fg.a > 0.5) {
        const r = ratio(fg, bg)
        const bold = parseInt(cs.fontWeight, 10) >= 700
        const large = fs >= 24 || (fs >= 18.66 && bold)
        const need = large ? 3 : 4.5
        if (r + 0.005 < need) {
          out.contrast.push({ ratio: +r.toFixed(2), need, fs, el: label(el), text: ownText.slice(0, 20) })
        }
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

  await page.getByRole('button', { name: /開啟房間|Open a room/ }).first().click()
  await page.waitForTimeout(300)
  await page.locator('#room-name').fill('秋季旅遊 · 出發')
  await page.locator('#roster-text').fill(
    '王小明 0912345678\n李美花 +1\n陳大同（請假）\n張三\n李四\n王五 帶2人')
  await page.waitForTimeout(400)
  await audit(page, scheme, '開啟房間')

  await page.getByRole('button', { name: /建立|Create/ }).click(); await page.waitForTimeout(1200)
  await page.locator('.member-main').nth(0).click(); await page.waitForTimeout(500)
  await audit(page, scheme, '房間（含 Toast）')

  await page.locator('.topbar button[aria-label="分享"]').click(); await page.waitForTimeout(1400)
  await audit(page, scheme, '分享面板')
  await page.keyboard.press('Escape'); await page.waitForTimeout(300)

  await page.locator('.topbar button[aria-label="管理"]').click(); await page.waitForTimeout(500)
  await audit(page, scheme, '管理面板')
  await page.keyboard.press('Escape'); await page.waitForTimeout(300)

  await page.locator('.member').nth(1).locator('.icon-btn').last().click(); await page.waitForTimeout(400)
  await audit(page, scheme, '成員面板')
  await page.keyboard.press('Escape'); await page.waitForTimeout(300)

  // --- 分組（分車）---
  await page.locator('.topbar button[aria-label="管理"]').click(); await page.waitForTimeout(400)
  await page.getByRole('button', { name: /編輯名單|Edit roster/ }).click(); await page.waitForTimeout(400)
  await page.locator('#roster-text').fill(
    '【第一車】\n王小明 0912345678\n李美花 +1\n【第二車】\n陳大同（請假）\n張三\n李四')
  await page.waitForTimeout(400)
  await page.locator('.sheet').getByRole('button', { name: /儲存|Save/ }).click(); await page.waitForTimeout(500)
  await page.getByRole('button', { name: /^刪除房間$|^Delete room$/ }).count().catch(() => 0)
  const confirmSave = page.locator('[role=alertdialog] .btn-danger')
  if (await confirmSave.count()) { await confirmSave.click(); await page.waitForTimeout(900) }
  await page.keyboard.press('Escape'); await page.waitForTimeout(400)
  await audit(page, scheme, '房間（含分組）')

  // --- 看板模式 ---
  const roomCode = await page.locator('.topbar-sub .mono').first().textContent().catch(() => null)
  if (roomCode) {
    await page.goto(`${URL}#/b/${roomCode.trim()}`); await page.waitForTimeout(1600)
    await audit(page, scheme, '看板模式')
  }

  await ctx.close()
}
await browser.close()

if (violations.length === 0) {
  console.log('設計規範檢查通過：對比、觸控尺寸、字級、無障礙名稱、橫向溢出、主要按鈕數量。')
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
