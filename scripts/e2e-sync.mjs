// 兩台裝置同步的端對端測試。
//
// 這不需要真的 Supabase 專案：scripts/fake-supabase.mjs 會把 RPC 轉發到
// 本機 PostgreSQL，所以驗的是「真的 SQL + 真的瀏覽器」。Realtime 廣播沒有
// 被涵蓋（本機沒有 realtime 伺服器），驗的是定期對帳這條保底路徑——那本來
// 就是正確性的依據，廣播只是讓它更快。
//
// 執行方式見 README「開發」一節。
import { chromium } from 'playwright'
const URL = 'http://127.0.0.1:4180/'
const ok = (l, c) => { console.log((c ? '  PASS  ' : '  FAIL  ') + l); if (!c) process.exitCode = 1 }
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })

// 兩個獨立的瀏覽器 context = 兩台不同的手機（各自的 IndexedDB）
const mk = async (name) => {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } })
  const p = await ctx.newPage()
  const errs = []
  p.on('pageerror', e => errs.push(`${name}: ${e.message}`))
  return { ctx, p, errs, name }
}
const A = await mk('主揪')
const B = await mk('同工')

const reconcile = async (d) => {
  await d.p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await d.p.waitForTimeout(900)
}

// --- 主揪開房 ---
await A.p.goto(URL); await A.p.waitForTimeout(1000)
ok('[主揪] 連上雲端（不是單機模式）', (await A.p.locator('.banner-muted').count()) === 0)
await A.p.getByRole('button', { name: /開啟房間/ }).first().click(); await A.p.waitForTimeout(300)
await A.p.locator('#room-name').fill('秋季旅遊 · 出發')
await A.p.locator('#roster-text').fill('王小明 0912345678\n李美花 +1\n陳大同（請假）\n張三\n李四')
await A.p.waitForTimeout(300)
await A.p.getByRole('button', { name: /建立/ }).click(); await A.p.waitForTimeout(1600)
const code = (await A.p.locator('.topbar-sub .mono').first().textContent())?.trim()
ok(`[主揪] 房間建立於伺服器，房號 ${code}`, /^[2-9A-HJ-KM-NP-Z]{6}$/.test(code || ''))
ok('[主揪] 未到 4（請假的不算）', (await A.p.locator('.score-number').textContent()) === '4')

// --- 同工用連結加入 ---
await B.p.goto(`${URL}#/j/${code}`); await B.p.waitForTimeout(2000)
ok('[同工] 用分享連結進到同一間房', (await B.p.locator('.topbar-name').textContent()) === '秋季旅遊 · 出發')
ok('[同工] 看到同一份名單（5 人）', (await B.p.locator('.member').count()) === 5)
ok('[同工] 未到也是 4', (await B.p.locator('.score-number').textContent()) === '4')
ok('[同工] 標示為協助點名而非房主', (await B.p.locator('.topbar button[aria-label="管理"]').count()) === 1)

// --- 主揪點名 → 同工對帳後看到 ---
await A.p.locator('.member-main').nth(0).click(); await A.p.waitForTimeout(1200)
ok('[主揪] 點名後未到 3', (await A.p.locator('.score-number').textContent()) === '3')
await reconcile(B)
ok('[同工] 對帳後也看到未到 3', (await B.p.locator('.score-number').textContent()) === '3')
ok('[同工] 王小明那列變成已到', (await B.p.locator('.member').nth(0).getAttribute('class'))?.includes('is-arrived'))

// --- 同工點名 → 主揪看到（反向）---
await B.p.locator('.member-main').nth(3).click(); await B.p.waitForTimeout(1200)
await reconcile(A)
ok('[主揪] 看到同工點的那一筆，未到 2', (await A.p.locator('.score-number').textContent()) === '2')

// --- 兩人同時點同一個人（冪等，不重複計算）---
await Promise.all([
  A.p.locator('.member-main').nth(4).click(),
  B.p.locator('.member-main').nth(4).click(),
])
await A.p.waitForTimeout(1500); await reconcile(A); await reconcile(B)
const a1 = await A.p.locator('.score-number').textContent()
const b1 = await B.p.locator('.score-number').textContent()
ok(`[雙方] 同時點同一人不會重複計算（A=${a1} B=${b1}）`, a1 === '1' && b1 === '1')

// --- 離線點名 → 恢復連線後上傳 ---
await B.ctx.setOffline(true)
await B.p.waitForTimeout(500)
await B.p.locator('.member-main').nth(1).click(); await B.p.waitForTimeout(800)
ok('[同工] 離線仍可點名，本地立刻更新', (await B.p.locator('.score-number').textContent()) === '0')
const badge = await B.p.locator('.sync').textContent()
ok(`[同工] 顯示離線與待上傳筆數：「${badge?.trim()}」`, /離線|待上傳/.test(badge || ''))
await reconcile(A)
ok('[主揪] 此時還看不到（同工尚未上傳）', (await A.p.locator('.score-number').textContent()) === '1')

await B.ctx.setOffline(false)
await B.p.evaluate(() => window.dispatchEvent(new Event('online')))
await B.p.waitForTimeout(2000)
await reconcile(A)
ok('[主揪] 恢復連線後自動補上，全部到齊', (await A.p.locator('.score-number').textContent()) === '0')
ok('[同工] 同步狀態回到已同步', /已同步/.test((await B.p.locator('.sync').textContent()) || ''))

// --- 複製房間（回程）---
await A.p.locator('.topbar button[aria-label="管理"]').click(); await A.p.waitForTimeout(600)
await A.p.getByRole('button', { name: /複製這間房/ }).click(); await A.p.waitForTimeout(400)
const prefill = await A.p.locator('#copy-name').inputValue()
ok(`[主揪] 新房名預帶「回程」：${prefill}`, prefill.includes('回程'))
await A.p.getByRole('button', { name: '確定' }).click(); await A.p.waitForTimeout(2200)
ok('[主揪] 進入新房間', (await A.p.locator('.topbar-name').textContent())?.includes('回程'))
ok('[主揪] 回程名單一樣是 5 人', (await A.p.locator('.member').count()) === 5)
ok('[主揪] 已到全部歸零、請假保留 → 未到 4', (await A.p.locator('.score-number').textContent()) === '4')
const newCode = (await A.p.locator('.topbar-sub .mono').first().textContent())?.trim()
ok(`[主揪] 回程是新的房號 ${newCode}`, newCode !== code)

// --- 衝突提示：我改的被別人蓋掉時，要看得見 ---
// 先給同工一個名字，這樣提示才會說「已由 陳姐 改為…」而不是「已被其他人」。
await B.p.goto(URL); await B.p.waitForTimeout(900)
await B.p.locator('button[aria-label="設定"]').click(); await B.p.waitForTimeout(500)
await B.p.locator('#checker-name').fill('陳姐')
await B.p.locator('#checker-name').blur(); await B.p.waitForTimeout(400)
await B.p.keyboard.press('Escape'); await B.p.waitForTimeout(300)
await B.p.goto(`${URL}#/r/${newCode}`); await B.p.waitForTimeout(1800)

// 主揪先把第一個人標成已到
await A.p.locator('.member-main').nth(0).click(); await A.p.waitForTimeout(1400)
ok('[主揪] 標記已到', (await A.p.locator('.member').nth(0).getAttribute('class'))?.includes('is-arrived'))

// 同工把同一個人改回未到（rev 較大，會贏）
await reconcile(B)
await B.p.locator('.member-main').nth(0).click(); await B.p.waitForTimeout(1400)
ok('[同工] 改回未到', !(await B.p.locator('.member').nth(0).getAttribute('class'))?.includes('is-arrived'))

// 主揪對帳後應該被告知自己那筆被蓋掉了
await reconcile(A); await A.p.waitForTimeout(600)
const notice = await A.p.locator('.toast-text').textContent().catch(() => '')
ok(`[主揪] 收到衝突提示：「${notice}」`, /已由\s*陳姐\s*改為未到/.test(notice ?? ''))
ok('[主揪] 該列確實變回未到', !(await A.p.locator('.member').nth(0).getAttribute('class'))?.includes('is-arrived'))

// 別人改別人的不該打擾我
await A.p.waitForTimeout(7200)
await B.p.locator('.member-main').nth(2).click(); await B.p.waitForTimeout(1200)
await reconcile(A); await A.p.waitForTimeout(600)
ok('[主揪] 別人改我沒碰過的人，不跳提示', (await A.p.locator('.toast').count()) === 0)

console.log('\n--- page errors ---')
const all = [...A.errs, ...B.errs]
console.log(all.length ? all.join('\n') : '(none)')
await b.close()
