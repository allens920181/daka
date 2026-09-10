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
  // 登入鍵搬進設定頁的 .sheet-item（2026-09），連著一句說明一起算進無障礙名稱，
  // 所以只認開頭，不整串精確比對。同年設定改成子畫面，它又往裡搬了一層：
  // 設定 → 帳戶 → 登入。
  await d.page.getByRole('button', { name: /^帳戶/ }).click(); await d.page.waitForTimeout(500)
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
  // 設定 2026-09 改成子畫面：登入住在「帳戶」裡面。
  await d.page.getByRole('button', { name: /^帳戶/ }).click(); await d.page.waitForTimeout(500)
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
await A.page.getByRole('button', { name: /創建空間/ }).first().click(); await A.page.waitForTimeout(300)
await A.page.locator('#room-name').fill('秋季旅遊 · 出發')
await A.page.locator('#roster-text').fill('王小明\n李美花 +1\n陳大同')
await A.page.waitForTimeout(300)
// 開空間 2026-09 拆成兩步：貼名單 →「產生名單」→ 看解析結果 →「建立」。
await A.page.getByRole('button', { name: /產生名單/ }).click(); await A.page.waitForTimeout(500)
await A.page.getByRole('button', { name: /建立/ }).click(); await A.page.waitForTimeout(1400)
// 代碼從路由讀：頂欄的副標那一行（代碼＋同步狀態）2026-09 整條拿掉了。
const code = (A.page.url().match(/#\/r\/([2-9A-HJ-KM-NP-Z]{6})/) || [])[1]
ok(`[舊手機] 未登入就開好空間 ${code}`, /^[2-9A-HJ-KM-NP-Z]{6}$/.test(code ?? ''))
await A.page.locator('.member-main').nth(0).click(); await A.page.waitForTimeout(1200)

await A.page.goto(URL); await A.page.waitForTimeout(1000)
// 這裡原本也是看「我的活動」在不在，而那個標題已經不存在了——恆為 0 的檢查
// 驗不到任何東西。未登入的證據改看設定裡的帳戶那一列。
await A.page.locator('button[aria-label="設定"]').click(); await A.page.waitForTimeout(600)
ok('[舊手機] 未登入時帳戶那一列寫著「未登入」',
   (await A.page.locator('.sheet .sheet-item').allTextContents()).includes('帳戶未登入'))
await A.page.keyboard.press('Escape'); await A.page.waitForTimeout(400)

// --- 新手機：沒登入，用代碼進得去（協助點名），但管不動 ---
await B.page.goto(`${URL}#/r/${code}`); await B.page.waitForTimeout(1800)
ok('[新手機] 用代碼進得去（協助點名不需要帳號）', await B.page.locator('.topbar-name').isVisible())
await B.page.locator('.topbar button[aria-label="更多"]').click(); await B.page.waitForTimeout(500)
/*
 * 「編輯」對協助者也開放，這是刻意的（見 Sheets.tsx 那一段：他進得去，只是
 * 看不到叉叉與標題輸入框）。所以它不能當擁有者功能的探針——這裡改用真正鎖在
 * owner 後面的「存成常用」，並且順便驗那句對協助者說明「你少了什麼」的話。
 */
ok('[新手機] 未登入時看不到擁有者功能（存成常用）',
   (await B.page.getByRole('button', { name: /^存成常用$/ }).count()) === 0)
ok('[新手機] 而且有一句話說清楚協助者少了什麼',
   (await B.page.locator('.sheet .hint').count()) >= 1)
await B.page.keyboard.press('Escape'); await B.page.waitForTimeout(300)

// 「建立副本」刻意對所有人開放（見 schema.sql 的 copy_room），所以不能拿它
// 當擁有者功能的探針——上面改用真正只有擁有者做得到的「編輯」。它 2026-09
// 搬到首頁每個空間右邊那顆「更多」裡，跟重新命名、刪除空間排在一起。
await B.page.goto(URL); await B.page.waitForTimeout(900)
await B.page.getByRole('button', { name: /^更多：/ }).first().click(); await B.page.waitForTimeout(500)
ok('[新手機] 但複製回程空間對所有人開放', (await B.page.getByRole('button', { name: /建立副本/ }).count()) === 1)
/*
 * 驗的是「按不按得下去」，不是「看不看得到那五個字」：「刪除空間」那一列現在對
 * 所有人都印，它是**入口**，進去才分岔——「從清單移除」只影響這支手機（那是他
 * 自己的清單，誰都可以），真正把所有人紀錄一起刪掉的那一顆鎖在 owner 後面。
 */
ok('[新手機] 不是主揪就沒有重新命名',
   (await B.page.getByRole('button', { name: /^重新命名$/ }).count()) === 0)
// 那一列的無障礙名稱含副標（「10/10 自動刪除」），所以不能用 ^…$ 錨定。
await B.page.getByRole('button', { name: /刪除空間/ }).first().click(); await B.page.waitForTimeout(500)
ok('[新手機] 進去只有「從清單移除」，沒有真的刪掉所有人紀錄的那一顆',
   (await B.page.getByRole('button', { name: /^從清單移除$/ }).count()) === 1
   && (await B.page.locator('.sheet .sheet-item.danger').count()) === 0)
await B.page.keyboard.press('Escape'); await B.page.waitForTimeout(300)

// --- 登入面板：Google 是主要路徑，Email 是備援 ---
await A.page.goto(URL); await A.page.waitForTimeout(900)
await A.page.locator('button[aria-label="設定"]').click(); await A.page.waitForTimeout(500)
// 設定 2026-09 改成子畫面（收掉「就地展開」那個互動），登入住在「帳戶」裡面。
await A.page.getByRole('button', { name: /^帳戶/ }).click(); await A.page.waitForTimeout(500)
await A.page.getByRole('button', { name: /^登入/ }).click(); await A.page.waitForTimeout(400)
ok('登入面板第一顆是 Google',
  (await A.page.locator('.sheet .btn').first().textContent())?.includes('Google'))
/*
 * 選擇方式這一步也有返回鍵（2026-09）。在它之前這一步只有 Esc／點遮罩兩條路
 * 出去，而加到主畫面的 PWA 沒有瀏覽器返回鍵——那時候它等於沒有退路。
 * 說明同時拿掉了：「為什麼要登入」在上一頁（帳戶）講過，按了「登入」才走到這裡
 * 的人已經被說服了。
 */
ok('選擇方式那一步有返回鍵',
  (await A.page.locator('.sheet-bar button[aria-label="返回"]').count()) === 1)
ok('而且不再擋一段說明在兩顆按鈕前面',
  (await A.page.locator('.sheet .hint').count()) === 0)
// Google 的按鈕照他們自己的規範走（白底、四色 G），不是這個系統的 .btn-primary
// ——四色的 G 放在品牌 teal 上既違反 Google 規範，藍綠兩色的對比也不夠。
ok('Google 按鈕用的是 Google 自己的樣式', (await A.page.locator('.sheet .btn-google').count()) === 1)
ok('登入面板沒有系統的主要按鈕', (await A.page.locator('.sheet .btn-primary').count()) === 0)
ok('Email 備援看得到（不是死路）', (await A.page.getByRole('button', { name: /改用 Email/ }).count()) === 1)
await A.page.getByRole('button', { name: /改用 Email/ }).click(); await A.page.waitForTimeout(300)
ok('切到 Email 之後看得到輸入框', (await A.page.locator('#signin-email').count()) === 1)
// Email 那一步原本自己有一顆滿版的「返回」，跟返回鍵重複了，2026-09 拿掉——
// 所以這裡驗的是「內容裡沒有第二顆」，回上一層交給返回鍵。
ok('Email 這一步內容裡沒有多一顆返回',
  (await A.page.locator('.sheet .btn').filter({ hasText: /^返回$/ }).count()) === 0)
ok('返回鍵回的是選擇方式，不是關掉整張面板', await (async () => {
  await A.page.locator('.sheet-bar button[aria-label="返回"]').click(); await A.page.waitForTimeout(400)
  return (await A.page.getByRole('button', { name: /用 Google 登入/ }).count()) === 1
})())
await A.page.keyboard.press('Escape'); await A.page.waitForTimeout(400)

// --- 舊手機登入 → 認領 ---
await signInWithGoogle(A)
// 回呼的 code 一定要從網址上清掉：留著的話使用者重新整理就會拿一個用過的 code
// 再換一次，然後看到一個沒頭沒尾的錯誤。
ok(`登入後網址上沒有殘留的 code：${A.page.url()}`, !/[?&]code=/.test(A.page.url()))
const toast = await A.page.locator('.toast-text').textContent().catch(() => '')
ok(`[舊手機] 登入後接管本機資產：「${toast}」`, /1 個空間/.test(toast ?? ''))
await A.page.waitForTimeout(400)
/*
 * 首頁的清單 2026-09 從「我的活動／最近的空間」兩個區塊合併成一份，那個標題
 * 因此不存在了（切子集合改用全部／我的／他人的三顆分段鍵，而且只有一間空間時
 * 不印那一列）。認領成功現在看的是**那一列自己說它是我的**：主揪的身分記號。
 */
const mine = await A.page.locator('.recent-item .recent-name').first().textContent()
ok(`[舊手機] 認領後首頁列出「${mine}」`, mine === '秋季旅遊 · 出發')
ok('[舊手機] 而且那一列標著主揪',
   (await A.page.locator('.recent-item .role-badge').first().getAttribute('aria-label')) === '主揪')
// 三個人，點掉一個 →「1 / 3 人」。
ok('[舊手機] 附帶已到人頭統計', (await A.page.locator('.recent-meta').first().textContent())?.includes('/ 3'))

// --- 新手機登入同一個帳號 → 拿得回空間 ---
await signInWithGoogle(B)
await B.page.waitForTimeout(600)
ok('[新手機] 登入後看得到同一場活動', await B.page.getByText('秋季旅遊 · 出發').first().isVisible())
await B.page.getByText('秋季旅遊 · 出發').first().click(); await B.page.waitForTimeout(1800)
await B.page.locator('.topbar button[aria-label="更多"]').click(); await B.page.waitForTimeout(600)
// 用「存成常用」當探針，不用「編輯」——後者對協助者也開放（見上）。
ok('[新手機] 現在看得到擁有者功能了', await B.page.getByRole('button', { name: /^存成常用$/ }).isVisible())

/*
 * 真的改得動（這是「換手機拿得回空間」的實證）。
 *
 * 改名字 2026-09 不再是選單裡的一列了：進編輯模式，頂欄的標題**自己變成輸入框**
 * ——改的是眼前那個標題，不是另開一頁改它的複本。而且那個輸入框主揪限定
 * （協助者進編輯模式只是為了那顆「＋」），所以它同時也是擁有權的實證。
 */
await B.page.getByRole('button', { name: /^編輯$/ }).click(); await B.page.waitForTimeout(700)
ok('[新手機] 編輯模式下標題變成輸入框（主揪限定）',
   (await B.page.locator('.topbar-name-input').count()) === 1)
await B.page.locator('.topbar-name-input').fill('從新手機改的名字')
await B.page.locator('.topbar-name-input').press('Enter'); await B.page.waitForTimeout(1500)
await B.page.getByRole('button', { name: /^完成$/ }).click(); await B.page.waitForTimeout(800)
ok('[新手機] 改得動空間名稱', (await B.page.locator('.topbar-name').textContent()) === '從新手機改的名字')

// --- 舊手機對帳後看得到新手機的改動 ---
await A.page.goto(`${URL}#/r/${code}`); await A.page.waitForTimeout(2000)
ok('[舊手機] 看得到新手機改的名字', (await A.page.locator('.topbar-name').textContent()) === '從新手機改的名字')

// --- 登出：本機開的空間仍然管得動（owner_key 還在）---
await A.page.goto(URL); await A.page.waitForTimeout(900)
await A.page.locator('button[aria-label="設定"]').click(); await A.page.waitForTimeout(500)
ok('[舊手機] 設定顯示已登入的 Email', (await A.page.getByText(EMAIL).count()) > 0)
// 登出跟登入一樣住在「帳戶」子畫面裡（2026-09 設定改成子畫面）。
await A.page.getByRole('button', { name: /^帳戶/ }).click(); await A.page.waitForTimeout(500)
await A.page.getByRole('button', { name: /^登出$/ }).click(); await A.page.waitForTimeout(1200)
await A.page.keyboard.press('Escape'); await A.page.waitForTimeout(500)
// 「我的活動」那個標題 2026-09 隨著清單合併一起沒了，所以不能再拿它當登出的
// 證據（它現在恆為 0，那條檢查等於什麼都沒驗）。改看設定裡的帳戶那一列。
await A.page.locator('button[aria-label="設定"]').click(); await A.page.waitForTimeout(600)
ok('[舊手機] 登出後帳戶那一列回到「未登入」',
   (await A.page.locator('.sheet .sheet-item').allTextContents()).includes('帳戶未登入'))
await A.page.keyboard.press('Escape'); await A.page.waitForTimeout(400)
await A.page.goto(`${URL}#/r/${code}`); await A.page.waitForTimeout(1800)
await A.page.locator('.topbar button[aria-label="更多"]').click(); await A.page.waitForTimeout(600)
// 用「存成常用」當探針：「編輯」對協助者也開放，證明不了擁有權。
ok('[舊手機] 登出後仍管得動自己開的空間（裝置金鑰還在）',
  await A.page.getByRole('button', { name: /^存成常用$/ }).isVisible())

// --- 備援路徑仍然通：Google 在內建瀏覽器裡會被擋，那時這條是唯一的路 ---
const C = await phone('備援手機')
const fallbackEmail = `fallback+${Date.now()}@example.com`
await signInWithEmail(C, fallbackEmail)
await C.page.waitForTimeout(600)
/*
 * 登進去了沒？原本看的是首頁有沒有「我的活動」，而那個標題 2026-09 隨著清單
 * 合併一起沒了——那條檢查因此恆為 0，等於什麼都沒驗。而且這支手機本來就一間
 * 空間都沒有，就算標題還在也不會出現。改看設定裡的帳戶那一列印不印得出他是誰。
 */
await C.page.locator('button[aria-label="設定"]').click(); await C.page.waitForTimeout(700)
ok('[備援手機] 用 Email 驗證碼一樣登得進去',
  (await C.page.locator('.sheet .sheet-item').allTextContents()).some((t) => t.includes(fallbackEmail)))

const errs = [...A.errs, ...B.errs, ...C.errs]
ok('無 JS 錯誤', errs.length === 0)
if (errs.length) console.log(errs.join('\n'))
await browser.close()
