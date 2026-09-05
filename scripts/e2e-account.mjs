// 主揪帳號的端對端測試：換手機之後還管不管得動自己的空間。
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

/**
 * 走完整條 Google 登入：按下按鈕 → 分頁被導去 authorize → 帶著 ?code= 回來 →
 * App 重新啟動、發現網址上有 code、換成 token。
 *
 * 真的 Google 同意畫面不在這裡（假後端直接 302 回來），但 PKCE 的形狀是真的：
 * 前端真的產 verifier、真的算 challenge、真的拿 code 去換。
 */
async function signInWithGoogle(d) {
  await d.page.goto(URL); await d.page.waitForTimeout(900)
  await d.page.locator('button[aria-label="設定"]').click(); await d.page.waitForTimeout(500)
  // 登入鍵搬進設定頁的 .menu-item（2026-09），連著一句說明一起算進無障礙名稱，
  // 所以只認開頭，不整串精確比對。
  await d.page.getByRole('button', { name: /^登入/ }).click(); await d.page.waitForTimeout(400)
  await d.page.getByRole('button', { name: /用 Google 登入/ }).click()
  // 導走 → 回來 → 重新啟動 → 換 token → 認領資產
  await d.page.waitForURL((u) => !u.searchParams.has('code'), { timeout: 15000 }).catch(() => {})
  await d.page.waitForTimeout(2200)
}

/** 備援路徑：Email 六碼驗證碼。 */
async function signInWithEmail(d, email) {
  await d.page.goto(URL); await d.page.waitForTimeout(900)
  await d.page.locator('button[aria-label="設定"]').click(); await d.page.waitForTimeout(500)
  await d.page.getByRole('button', { name: /^登入/ }).click(); await d.page.waitForTimeout(400)
  await d.page.getByRole('button', { name: /改用 Email/ }).click(); await d.page.waitForTimeout(300)
  await d.page.locator('#signin-email').fill(email)
  await d.page.getByRole('button', { name: /寄驗證碼/ }).click(); await d.page.waitForTimeout(900)
  await d.page.locator('#signin-code').fill('123456')
  await d.page.locator('.sheet').getByRole('button', { name: /^登入$/ }).click()
  await d.page.waitForTimeout(1800)
}

/** 告訴假後端下一次 Google 登入是誰（真的 Google 是在同意畫面上選的）。 */
async function useGoogleAccount(email) {
  const res = await fetch('http://127.0.0.1:54321/__test/google-user', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  })
  if (!res.ok) throw new Error('fake backend did not accept the test account')
}

const A = await phone('舊手機')
const B = await phone('新手機')

// 每次執行用不同的帳號，跑幾次都不會互相影響。
await useGoogleAccount(EMAIL)

// --- 舊手機：沒登入就開空間，行為與從前完全相同 ---
await A.page.goto(URL); await A.page.waitForTimeout(900)
await A.page.getByRole('button', { name: /開啟空間/ }).first().click(); await A.page.waitForTimeout(300)
await A.page.locator('#room-name').fill('秋季旅遊 · 出發')
await A.page.locator('#roster-text').fill('王小明\n李美花 +1\n陳大同')
await A.page.waitForTimeout(300)
// 開空間 2026-09 拆成兩步：貼名單 →「產生名單」→ 看解析結果 →「建立」。
await A.page.getByRole('button', { name: /產生名單/ }).click(); await A.page.waitForTimeout(500)
await A.page.getByRole('button', { name: /建立/ }).click(); await A.page.waitForTimeout(1400)
const code = (await A.page.locator('.topbar-sub .mono').first().textContent())?.trim()
ok(`[舊手機] 未登入就開好空間 ${code}`, /^[2-9A-HJ-KM-NP-Z]{6}$/.test(code ?? ''))
await A.page.locator('.member-main').nth(0).click(); await A.page.waitForTimeout(1200)

await A.page.goto(URL); await A.page.waitForTimeout(1000)
ok('[舊手機] 未登入時首頁沒有「我的活動」', (await A.page.getByText('我的活動').count()) === 0)

// --- 新手機：沒登入，用代碼進得去（協助點名），但管不動 ---
await B.page.goto(`${URL}#/r/${code}`); await B.page.waitForTimeout(1800)
ok('[新手機] 用代碼進得去（協助點名不需要帳號）', await B.page.locator('.topbar-name').isVisible())
await B.page.locator('.topbar button[aria-label="更多"]').click(); await B.page.waitForTimeout(500)
ok('[新手機] 未登入時看不到擁有者功能', (await B.page.getByRole('button', { name: /^編輯$/ }).count()) === 0)
await B.page.keyboard.press('Escape'); await B.page.waitForTimeout(300)

// 「建立副本」刻意對所有人開放（見 schema.sql 的 copy_room），所以不能拿它
// 當擁有者功能的探針——上面改用真正只有擁有者做得到的「編輯」。它 2026-09
// 搬到首頁每個空間右邊那顆「更多」裡，跟重新命名、刪除空間排在一起。
await B.page.goto(URL); await B.page.waitForTimeout(900)
await B.page.getByRole('button', { name: /^更多：/ }).first().click(); await B.page.waitForTimeout(500)
ok('[新手機] 但複製回程空間對所有人開放', (await B.page.getByRole('button', { name: /建立副本/ }).count()) === 1)
ok('[新手機] 不是主揪就沒有重新命名與刪除空間',
   (await B.page.getByRole('button', { name: /重新命名|刪除空間/ }).count()) === 0)
await B.page.keyboard.press('Escape'); await B.page.waitForTimeout(300)

// --- 登入面板：Google 是主要路徑，Email 是備援 ---
await A.page.goto(URL); await A.page.waitForTimeout(900)
await A.page.locator('button[aria-label="設定"]').click(); await A.page.waitForTimeout(500)
await A.page.getByRole('button', { name: /^登入/ }).click(); await A.page.waitForTimeout(400)
ok('登入面板第一顆是 Google',
  (await A.page.locator('.sheet .btn').first().textContent())?.includes('Google'))
// Google 的按鈕照他們自己的規範走（白底、四色 G），不是這個系統的 .btn-primary
// ——四色的 G 放在品牌 teal 上既違反 Google 規範，藍綠兩色的對比也不夠。
ok('Google 按鈕用的是 Google 自己的樣式', (await A.page.locator('.sheet .btn-google').count()) === 1)
ok('登入面板沒有系統的主要按鈕', (await A.page.locator('.sheet .btn-primary').count()) === 0)
ok('Email 備援看得到（不是死路）', (await A.page.getByRole('button', { name: /改用 Email/ }).count()) === 1)
await A.page.getByRole('button', { name: /改用 Email/ }).click(); await A.page.waitForTimeout(300)
ok('切到 Email 之後看得到輸入框', (await A.page.locator('#signin-email').count()) === 1)
ok('Email 這一步回得去', (await A.page.getByRole('button', { name: /^返回$/ }).count()) === 1)
await A.page.getByRole('button', { name: /^返回$/ }).click(); await A.page.waitForTimeout(300)
ok('回到選擇畫面', (await A.page.getByRole('button', { name: /用 Google 登入/ }).count()) === 1)
await A.page.keyboard.press('Escape'); await A.page.waitForTimeout(400)

// --- 舊手機登入 → 認領 ---
await signInWithGoogle(A)
// 回呼的 code 一定要從網址上清掉：留著的話使用者重新整理就會拿一個用過的 code
// 再換一次，然後看到一個沒頭沒尾的錯誤。
ok(`登入後網址上沒有殘留的 code：${A.page.url()}`, !/[?&]code=/.test(A.page.url()))
const toast = await A.page.locator('.toast-text').textContent().catch(() => '')
ok(`[舊手機] 登入後接管本機資產：「${toast}」`, /1 個空間/.test(toast ?? ''))
await A.page.waitForTimeout(400)
ok('[舊手機] 首頁出現「我的活動」', await A.page.getByText('我的活動').isVisible())
const mine = await A.page.locator('.recent-item .recent-name').first().textContent()
ok(`[舊手機] 我的活動列出「${mine}」`, mine === '秋季旅遊 · 出發')
ok('[舊手機] 附帶已到人頭統計', (await A.page.locator('.recent-meta').first().textContent())?.includes('/ 4'))

// --- 新手機登入同一個帳號 → 拿得回空間 ---
await signInWithGoogle(B)
await B.page.waitForTimeout(600)
ok('[新手機] 登入後看得到同一場活動', await B.page.getByText('秋季旅遊 · 出發').first().isVisible())
await B.page.getByText('秋季旅遊 · 出發').first().click(); await B.page.waitForTimeout(1800)
await B.page.locator('.topbar button[aria-label="更多"]').click(); await B.page.waitForTimeout(600)
ok('[新手機] 現在看得到擁有者功能了', await B.page.getByRole('button', { name: /^編輯$/ }).isVisible())

// 真的改得動（這是「換手機拿得回空間」的實證）
await B.page.getByRole('button', { name: /重新命名/ }).click(); await B.page.waitForTimeout(400)
await B.page.locator('.sheet input.input').fill('從新手機改的名字')
await B.page.locator('.sheet').getByRole('button', { name: /^儲存$/ }).click(); await B.page.waitForTimeout(1500)
await B.page.keyboard.press('Escape'); await B.page.waitForTimeout(400)
ok('[新手機] 改得動空間名稱', (await B.page.locator('.topbar-name').textContent()) === '從新手機改的名字')

// --- 舊手機對帳後看得到新手機的改動 ---
await A.page.goto(`${URL}#/r/${code}`); await A.page.waitForTimeout(2000)
ok('[舊手機] 看得到新手機改的名字', (await A.page.locator('.topbar-name').textContent()) === '從新手機改的名字')

// --- 登出：本機開的空間仍然管得動（owner_key 還在）---
await A.page.goto(URL); await A.page.waitForTimeout(900)
await A.page.locator('button[aria-label="設定"]').click(); await A.page.waitForTimeout(500)
ok('[舊手機] 設定顯示已登入的 Email', (await A.page.getByText(EMAIL).count()) > 0)
await A.page.getByRole('button', { name: /^登出$/ }).click(); await A.page.waitForTimeout(1200)
await A.page.keyboard.press('Escape'); await A.page.waitForTimeout(500)
ok('[舊手機] 登出後「我的活動」消失', (await A.page.getByText('我的活動').count()) === 0)
await A.page.goto(`${URL}#/r/${code}`); await A.page.waitForTimeout(1800)
await A.page.locator('.topbar button[aria-label="更多"]').click(); await A.page.waitForTimeout(600)
ok('[舊手機] 登出後仍管得動自己開的空間（裝置金鑰還在）',
  await A.page.getByRole('button', { name: /^編輯$/ }).isVisible())

// --- 備援路徑仍然通：Google 在內建瀏覽器裡會被擋，那時這條是唯一的路 ---
const C = await phone('備援手機')
await signInWithEmail(C, `fallback+${Date.now()}@example.com`)
await C.page.waitForTimeout(600)
ok('[備援手機] 用 Email 驗證碼一樣登得進去',
  (await C.page.getByText('我的活動').count()) > 0)

const errs = [...A.errs, ...B.errs, ...C.errs]
ok('無 JS 錯誤', errs.length === 0)
if (errs.length) console.log(errs.join('\n'))
await browser.close()
