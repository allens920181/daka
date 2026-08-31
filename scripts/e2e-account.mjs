// 主揪帳號的端對端測試：換手機之後還管不管得動自己的房間。
//
// 用 scripts/fake-supabase.mjs 當後端（REST + Auth 都轉發到本機 PostgreSQL），
// 不需要真的 Supabase 專案。驗證碼固定 123456。
//
// 執行方式見 README「驗證多人同步」一節，把網址換成這支腳本。

import { chromium } from 'playwright'
import { existsSync } from 'node:fs'

const URL = process.argv[2] ?? 'http://127.0.0.1:4180/'
const EMAIL = `organizer+${Date.now()}@example.com`
const BROWSER = process.env.CHROMIUM_PATH
  ?? (existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome')
    ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
    : undefined)

const ok = (l, c) => { console.log((c ? '  PASS  ' : '  FAIL  ') + l); if (!c) process.exitCode = 1 }
const browser = await chromium.launch(BROWSER ? { executablePath: BROWSER } : {})

/** 每個 context 是一台不同的手機：各自的 IndexedDB，也就是各自的 owner_key。 */
async function phone(name) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(`${name}: ${e.message}`))
  return { name, ctx, page, errs }
}

async function signIn(d) {
  await d.page.goto(URL); await d.page.waitForTimeout(900)
  await d.page.locator('button[aria-label="設定"]').click(); await d.page.waitForTimeout(500)
  await d.page.getByRole('button', { name: /^登入$/ }).click(); await d.page.waitForTimeout(400)
  await d.page.locator('#signin-email').fill(EMAIL)
  await d.page.getByRole('button', { name: /寄驗證碼/ }).click(); await d.page.waitForTimeout(900)
  await d.page.locator('#signin-code').fill('123456')
  await d.page.locator('.sheet').getByRole('button', { name: /^登入$/ }).click()
  await d.page.waitForTimeout(1800)
}

const A = await phone('舊手機')
const B = await phone('新手機')

// --- 舊手機：沒登入就開房，行為與從前完全相同 ---
await A.page.goto(URL); await A.page.waitForTimeout(900)
await A.page.getByRole('button', { name: /開啟房間/ }).first().click(); await A.page.waitForTimeout(300)
await A.page.locator('#room-name').fill('秋季旅遊 · 出發')
await A.page.locator('#roster-text').fill('王小明\n李美花 +1\n陳大同')
await A.page.waitForTimeout(300)
await A.page.getByRole('button', { name: /建立/ }).click(); await A.page.waitForTimeout(1400)
const code = (await A.page.locator('.topbar-sub .mono').first().textContent())?.trim()
ok(`[舊手機] 未登入就開好房間 ${code}`, /^[2-9A-HJ-KM-NP-Z]{6}$/.test(code ?? ''))
await A.page.locator('.member-main').nth(0).click(); await A.page.waitForTimeout(1200)

await A.page.goto(URL); await A.page.waitForTimeout(1000)
ok('[舊手機] 未登入時首頁沒有「我的活動」', (await A.page.getByText('我的活動').count()) === 0)

// --- 新手機：沒登入，用房號進得去（協助點名），但管不動 ---
await B.page.goto(`${URL}#/r/${code}`); await B.page.waitForTimeout(1800)
ok('[新手機] 用房號進得去（協助點名不需要帳號）', await B.page.locator('.topbar-name').isVisible())
await B.page.locator('.topbar button[aria-label="管理"]').click(); await B.page.waitForTimeout(500)
ok('[新手機] 未登入時看不到房主功能', (await B.page.getByRole('button', { name: /複製這間房/ }).count()) === 0)
await B.page.keyboard.press('Escape'); await B.page.waitForTimeout(300)

// --- 舊手機登入 → 認領 ---
await signIn(A)
const toast = await A.page.locator('.toast-text').textContent().catch(() => '')
ok(`[舊手機] 登入後接管本機資產：「${toast}」`, /1 個房間/.test(toast ?? ''))
await A.page.waitForTimeout(400)
ok('[舊手機] 首頁出現「我的活動」', await A.page.getByText('我的活動').isVisible())
const mine = await A.page.locator('.recent-item .recent-name').first().textContent()
ok(`[舊手機] 我的活動列出「${mine}」`, mine === '秋季旅遊 · 出發')
ok('[舊手機] 附帶已到人頭統計', (await A.page.locator('.recent-meta').first().textContent())?.includes('/ 4'))

// --- 新手機登入同一個帳號 → 拿得回房間 ---
await signIn(B)
await B.page.waitForTimeout(600)
ok('[新手機] 登入後看得到同一場活動', await B.page.getByText('秋季旅遊 · 出發').first().isVisible())
await B.page.getByText('秋季旅遊 · 出發').first().click(); await B.page.waitForTimeout(1800)
await B.page.locator('.topbar button[aria-label="管理"]').click(); await B.page.waitForTimeout(600)
ok('[新手機] 現在看得到房主功能了', await B.page.getByRole('button', { name: /複製這間房/ }).isVisible())

// 真的改得動（這是「換手機拿得回房間」的實證）
await B.page.getByRole('button', { name: /重新命名/ }).click(); await B.page.waitForTimeout(400)
await B.page.locator('.sheet input.input').fill('從新手機改的名字')
await B.page.locator('.sheet').getByRole('button', { name: /^儲存$/ }).click(); await B.page.waitForTimeout(1500)
await B.page.keyboard.press('Escape'); await B.page.waitForTimeout(400)
ok('[新手機] 改得動房間名稱', (await B.page.locator('.topbar-name').textContent()) === '從新手機改的名字')

// --- 舊手機對帳後看得到新手機的改動 ---
await A.page.goto(`${URL}#/r/${code}`); await A.page.waitForTimeout(2000)
ok('[舊手機] 看得到新手機改的名字', (await A.page.locator('.topbar-name').textContent()) === '從新手機改的名字')

// --- 登出：本機開的房間仍然管得動（owner_key 還在）---
await A.page.goto(URL); await A.page.waitForTimeout(900)
await A.page.locator('button[aria-label="設定"]').click(); await A.page.waitForTimeout(500)
ok('[舊手機] 設定顯示已登入的 Email', (await A.page.getByText(EMAIL).count()) > 0)
await A.page.getByRole('button', { name: /^登出$/ }).click(); await A.page.waitForTimeout(1200)
await A.page.keyboard.press('Escape'); await A.page.waitForTimeout(500)
ok('[舊手機] 登出後「我的活動」消失', (await A.page.getByText('我的活動').count()) === 0)
await A.page.goto(`${URL}#/r/${code}`); await A.page.waitForTimeout(1800)
await A.page.locator('.topbar button[aria-label="管理"]').click(); await A.page.waitForTimeout(600)
ok('[舊手機] 登出後仍管得動自己開的房間（裝置金鑰還在）',
  await A.page.getByRole('button', { name: /複製這間房/ }).isVisible())

const errs = [...A.errs, ...B.errs]
ok('無 JS 錯誤', errs.length === 0)
if (errs.length) console.log(errs.join('\n'))
await browser.close()
