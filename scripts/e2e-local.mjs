// 單機模式的端對端測試（不需要 Supabase）。
// 需要先 npm run build && npx vite preview --port 4173 --host 127.0.0.1
//
//   node scripts/e2e-local.mjs
//
import { chromium } from 'playwright'
const URL = 'http://127.0.0.1:4173/daka/'
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
const p = await ctx.newPage()
const errs = []
p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message))
p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()) })

const ok = (label, cond) => { console.log((cond ? '  PASS  ' : '  FAIL  ') + label); if (!cond) process.exitCode = 1 }
// 計分區（44px 大字＋「N / M 人」＋進度條）已經整塊拿掉：攜伴不再解析之後，
// 它和「未到 N」說的是同一件事。畫面上的那個數字現在長在頂欄的分段控制裡。
const missing = async () => ((await p.getByRole('button', { name: /^未到/ }).textContent()) || '').replace(/\D/g, '')
/** 開空間第一步（貼名單）走到第二步（看解析結果）。「建立」只長在第二步。 */
const generateList = async () => {
  await p.getByRole('button', { name: /產生名單/ }).click()
  await p.waitForTimeout(500)
}
const segCount = async (name) => ((await p.getByRole('button', { name }).first().textContent()) || '').replace(/\D/g, '')
/** 搜尋 2026-09 收成篩選列右邊的一顆放大鏡，要先點開才有輸入框。 */
const openSearch = async () => {
  if ((await p.locator('input[type=search]').count()) > 0) return
  await p.locator('.filterbar .search-toggle').click()
  await p.waitForTimeout(350)
}

await p.goto(URL); await p.waitForTimeout(1200)
ok('首頁載入', await p.locator('.home-title').isVisible())
ok('顯示單機模式提示', (await p.locator('.banner-muted').count()) > 0)


// 開空間
await p.getByRole('button', { name: /創建空間/ }).first().click()
await p.waitForTimeout(400)
await p.locator('#room-name').fill('秋季旅遊 · 出發')
await p.locator('#roster-text').fill(`秋季旅遊報名
1.王小明 0912345678
2. 李美花 +1
3、陳大同（請假）
４．張三
- 李四
王五 帶2人
陳怡君
陳怡君`)
await p.waitForTimeout(400)
// 開空間 2026-09 拆成兩步：貼名單 →「產生名單」→ 看解析結果 →「建立」。解析
// 結果不再跟輸入框擠同一屏，所以預覽與「建立」都要先走到第二步才碰得到。
await generateList()
const previewRows = await p.locator('.preview-row').count()
ok(`解析預覽 ${previewRows} 列（標題行也算一人，共 9）`, previewRows === 9)

// #4 解析器刻意不猜「秋季旅遊報名」是不是人名，但預覽以前只給看不給改——猜錯
// 的那幾列會一路留到現場，變成永遠不會被打勾的幽靈成員，於是「還有 N
// 位沒到」永遠歸不了零。每一列現在都拿得掉，而且文字才是唯一的真相。
ok('第一列是被誤判成人的標題行',
   (await p.locator('.preview-row').first().textContent())?.includes('秋季旅遊報名'))
await p.locator('.preview-row').first().locator('.preview-remove').click()
await p.waitForTimeout(400)
ok('移除之後預覽剩 8 列', (await p.locator('.preview-row').count()) === 8)
// 文字才是唯一的真相——回第一步看那個 textarea，被移掉的那一列真的從文字裡消失了。
await p.getByRole('button', { name: /調整清單/ }).click(); await p.waitForTimeout(400)
ok('移除是去改文字，不是只改預覽',
   !((await p.locator('#roster-text').inputValue()).includes('秋季旅遊報名')))
ok('其他人一個都沒少',
   (await p.locator('#roster-text').inputValue()).includes('王小明')
   && (await p.locator('#roster-text').inputValue()).includes('陳怡君'))
// 復原：把它加回去，讓後面的斷言仍然跑在 9 個人的名單上。
await p.locator('#roster-text').fill('秋季旅遊報名\n' + await p.locator('#roster-text').inputValue())
await p.waitForTimeout(400)
await generateList()
ok('補回去之後又是 9 列', (await p.locator('.preview-row').count()) === 9)
ok('同名警告出現', await p.locator('.note-warn').first().isVisible())


await p.getByRole('button', { name: /建立/ }).click()
await p.waitForTimeout(1200)
ok('進入空間', await p.locator('.topbar-name').isVisible())
// 搜尋 2026-09 收成篩選列右邊的一顆放大鏡：一進房間畫面上沒有輸入框，也就
// 不會有人被自己跳出來的鍵盤蓋掉半個畫面。
ok('一進房間只有放大鏡，沒有輸入框',
   (await p.locator('.topbar .filterbar .search-toggle').count()) === 1
   && (await p.locator('input[type=search]').count()) === 0)
// 代碼 2026-09 不在頂欄了（副標那一行整條拿掉）：空間裡要看它得去
// 「更多 › 邀請點名 › 代碼」，退出去則是首頁每一列都印著。這裡從首頁讀。
ok('頂欄沒有副標那一行了', (await p.locator('.topbar-sub').count()) === 0)
ok('同步狀態縮成名字後面一顆圓點', (await p.locator('.topbar-heading .sync .sync-dot').count()) === 1
   && ((await p.locator('.topbar-heading .sync').textContent()) || '').trim() === ''
   && Boolean(await p.locator('.topbar-heading .sync').getAttribute('aria-label')))
await p.goto(URL); await p.waitForTimeout(800)
const code = (await p.locator('.recent-meta .mono').first().textContent())?.trim()
ok(`取得 6 碼代碼: ${code}`, /^[2-9A-HJ-KM-NP-Z]{6}$/.test(code || ''))
await p.locator('.recent-main').first().click(); await p.waitForTimeout(1200)
// 請假 2026-09 拿掉了：「（請假）」現在只是一則備註，陳大同照樣是未到。
ok('未到 9（寫著請假的人也還是未到）', (await missing()) === '9')
ok('分段只剩三段', (await p.locator('.topbar .segment').count()) === 3)
ok('沒有請假那一段', (await p.getByRole('button', { name: /^請假/ }).count()) === 0)
// 44px 的數字旁邊只補單位，不把同一個數字再寫一次。
ok('分段的數字加得起來', Number(await missing()) + Number(await segCount(/^已到/))
   === Number(await segCount(/^全部/)))


// 點名
await p.locator('.member-main').nth(1).click()
await p.waitForTimeout(500)
ok('點名後未到 = 8', (await missing()) === '8')
// 「誰在幾點標記的」印在列的右邊，不是名字底下多一行——點一個人不該讓那一列
// 長高一行（有備註的列實測 67px → 87px，整份名單會被自己推長）。
ok('已到的時間印在列的右邊', await p.evaluate(() => {
  const row = document.querySelector('.member.is-arrived')
  const when = row?.querySelector('.member-when')
  if (!when) return false
  const body = row.querySelector('.member-body').getBoundingClientRect()
  const w = when.getBoundingClientRect()
  return /\d{1,2}:\d{2}/.test(when.textContent || '') && w.left >= body.right - 1
}))
ok('未到的列上沒有那一格', (await p.locator('.member:not(.is-arrived) .member-when').count()) === 0)
ok('該列變成已到', (await p.locator('.member').nth(1).getAttribute('class'))?.includes('is-arrived'))
ok('出現復原提示', await p.locator('.toast').isVisible())


// 復原
await p.locator('.toast-action').click()
await p.waitForTimeout(500)
ok('復原後未到回到 9', (await missing()) === '9')

// 篩選
await p.locator('.member-main').nth(0).click(); await p.waitForTimeout(300)
await p.locator('.member-main').nth(2).click(); await p.waitForTimeout(300)
await p.getByRole('button', { name: /^已到/ }).click(); await p.waitForTimeout(300)
ok('已到篩選顯示 2 人', (await p.locator('.member').count()) === 2)
await p.getByRole('button', { name: /^未到/ }).click(); await p.waitForTimeout(300)
ok('未到篩選顯示 7 人', (await p.locator('.member').count()) === 7)
await p.getByRole('button', { name: /^全部/ }).click(); await p.waitForTimeout(300)

// 搜尋。點篩選列右邊那顆放大鏡，輸入框從那個位置往左長出來，蓋住三段篩選
// ——一列裡塞不下三段篩選加一條堪用的輸入框。
await p.locator('.filterbar .search-toggle').click(); await p.waitForTimeout(400)
ok('展開就聚焦（跳鍵盤是剛按下那顆鍵的直接結果）',
   await p.evaluate(() => document.activeElement?.getAttribute('type') === 'search'))
ok('展開後蓋住分段控制', await p.evaluate(() => {
  const seg = document.querySelector('.filterbar .segmented').getBoundingClientRect()
  const box = document.querySelector('.search-wrap').getBoundingClientRect()
  return box.left <= seg.left + 1 && box.right >= seg.right - 1
}))
ok('搜尋框空的時候沒有高亮', (await p.locator('.search-wrap .input.is-on').count()) === 0)
await p.locator('input[type=search]').fill('陳怡君'); await p.waitForTimeout(300)
ok('搜尋同名找到 2 人', (await p.locator('.member').count()) === 2)
ok('搜尋框有字時高亮，讓人知道名單被過濾了', (await p.locator('.search-wrap .input.is-on').count()) === 1)
// 焦點圈只在打字當下看得到；拿掉焦點（不點名單列，避免動到點名狀態）之後
// 高亮要繼續留著——這才是「名單現在是過濾過的」唯一的持續提示。
await p.locator('input[type=search]').evaluate((el) => el.blur()); await p.waitForTimeout(300)
ok('拿掉焦點之後高亮還在', (await p.locator('.search-wrap .input.is-on').count()) === 1)
// 有字的時候絕不自己收起來：收起來會把字清掉，而使用者只是把手指移開了。
ok('有字時失焦也不收回成圖示', (await p.locator('input[type=search]').count()) === 1)
await p.locator('input[type=search]').fill('0912'); await p.waitForTimeout(300)
// 電話已經不是解析出來的欄位（號碼原文躺在備註裡），搜尋要照樣找得到人。
ok('可用電話搜尋（號碼現在在備註裡）', (await p.locator('.member').count()) === 1)

// 展開的搜尋框蓋著分段控制，所以要先收起來才切得到篩選（這是併成一列的直接
// 後果，順序是「先決定看哪一群，再搜」）。清空＋Esc＝收回成圖示。
await p.locator('input[type=search]').fill(''); await p.waitForTimeout(200)
await p.locator('input[type=search]').press('Escape'); await p.waitForTimeout(300)
ok('搜尋收起來之後又切得到篩選了',
   await p.getByRole('button', { name: /^未到/ }).first().isVisible())

// 搜尋展開的那一刻把範圍拉回「全部」：問「這個人在不在名單上」的當下，沒有人
// 記得自己畫面上還套著哪一層篩選，而假的「查無此人」在車門口等於把人丟下。
await p.getByRole('button', { name: /^未到/ }).click(); await p.waitForTimeout(250)
ok('先切到「未到」', (await p.getByRole('button', { name: /^未到/ }).getAttribute('aria-pressed')) === 'true')
await openSearch()
ok('展開搜尋就自己切回「全部」',
   (await p.evaluate(() => document.querySelector('.segmented .segment')?.getAttribute('aria-pressed'))) === 'true')
ok('已到的人也搜得到了（不再被「未到」擋住）', await (async () => {
  await p.locator('input[type=search]').fill('陳怡君'); await p.waitForTimeout(300)
  return (await p.locator('.member').count()) === 2
})())

// 收尾時單手打錯字：搜一個不存在的名字。這裡絕對不能回答「太好了，全部都到了」
// ——那句話在車門口等於「可以關門了」。
await p.locator('input[type=search]').fill('王大明'); await p.waitForTimeout(300)
const typoEmpty = (await p.locator('.empty-big').textContent())?.trim()
ok(`搜尋打錯字時說「沒找到」而不是「全部都到了」：${typoEmpty}`, typoEmpty === '這裡沒有人')
ok('並附上「換個字再找找」的下一步', ((await p.locator('.empty .hint').textContent()) || '').includes('換個字'))
await p.locator('input[type=search]').fill(''); await p.waitForTimeout(300)
ok('清掉搜尋字之後高亮跟著消失', (await p.locator('.search-wrap .input.is-on').count()) === 0)
ok('清掉搜尋字之後名單整份回來（範圍是全部）', (await p.locator('.member').count()) === 9)
// 空的時候滑走就收回成圖示，那一列人名還回去；而「收起來」永遠等於「沒有在過濾」。
await p.locator('input[type=search]').evaluate((el) => el.blur()); await p.waitForTimeout(350)
ok('空的時候失焦就收回成圖示',
   (await p.locator('input[type=search]').count()) === 0
   && (await p.locator('.filterbar .search-toggle').count()) === 1)

// 取消鍵。**空的時候也要在**——沒有字時原本只剩「滑去別的地方」一條路可以收起來，
// 而這個畫面上「別的地方」就是名單列，點下去會直接把人標成已到。
await openSearch()
ok('剛展開、還沒打字就看得到取消鍵', (await p.locator('.search-clear').count()) === 1)
await p.locator('.search-clear').click(); await p.waitForTimeout(350)
ok('按取消就收回成圖示', (await p.locator('input[type=search]').count()) === 0
   && await p.getByRole('button', { name: /^全部/ }).first().isVisible())
// 有字的時候按下去一樣是「收起來」：收起來本來就會清掉字（收起來＝沒有在過濾），
// 兩種狀態下的結果一樣，不必分兩段。
await openSearch()
await p.locator('input[type=search]').fill('陳怡君'); await p.waitForTimeout(300)
ok('有字時名單被過濾', (await p.locator('.member').count()) === 2)
await p.locator('.search-clear').click(); await p.waitForTimeout(350)
ok('有字時按取消：收起來，名單整份回來',
   (await p.locator('input[type=search]').count()) === 0 && (await p.locator('.member').count()) === 9)
await p.getByRole('button', { name: /^全部/ }).first().click(); await p.waitForTimeout(300)

// 撥號。解析器不再判斷任何一串數字是什麼——「匯款 700-1234567」曾經被抽成
// 一支撥出去是空號的假電話，而畫面上沒有一個字說得出為什麼。號碼現在原文留在
// 備註裡，這顆鍵是顯示層的判斷（猜錯是可逆、可見的；資料層猜錯不是）。
// 它 2026-09 從成員面板搬回列上：那張面板整個拿掉了，而「看到未到 → 打電話」
// 是收尾時唯一的下一步。
const telHref = await p.locator('.member').filter({ hasText: '王小明' }).first()
  .locator('a[href^="tel:"]').first().getAttribute('href')
ok(`備註裡的號碼在列上就撥得出去 ${telHref}`, telHref === 'tel:0912345678')
// 它長在備註那一行的號碼後面（2026-09），所以不分狀態都印：那一行是備註本身。
ok('撥號鍵貼在備註那一行裡', await p.evaluate(() =>
  Boolean(document.querySelector('.member-note > a.note-call[href^="tel:"]'))))

// 匯出（單機模式）。複製與 CSV 都不經過任何伺服器，自己一個人點完照樣要交得出
// 名單——2026-09 起那兩顆不在「更多」裡，而在「結束點名」的確認鍵前面。
await p.locator('.topbar button[aria-label="更多"]').click(); await p.waitForTimeout(600)
ok('選單上沒有「匯出名單」了（它併進了結束點名）',
   (await p.locator('.sheet').getByRole('button', { name: /^匯出名單$/ }).count()) === 0)
await p.keyboard.press('Escape'); await p.waitForTimeout(400)
await p.locator('.dock').getByRole('button', { name: /^結束點名$/ }).click(); await p.waitForTimeout(500)
// 畫面上印短的（三顆並排在一列裡才排得下），無障礙名稱印完整的。
const exportRows = (await p.locator('.result-actions .btn').allTextContents()).map((x) => x.trim())
ok(`確認鍵前面就是兩種格式：${exportRows.join('、')}`,
   JSON.stringify(exportRows) === JSON.stringify(['複製', 'CSV']))
ok('單機模式照樣匯得出去（這兩顆都不需要連線）', exportRows.length === 2)
ok('唸出去的是完整的說法（短標籤是它的子字串）', await p.evaluate(() => {
  const names = [...document.querySelectorAll('.result-actions .btn')]
    .map((b) => [b.getAttribute('aria-label'), b.textContent.trim()])
  return names.length === 2 && names.every(([full, short]) => full && full.includes(short))
    && names[0][0] === '複製結果' && names[1][0] === '下載 CSV'
}))
// 兩顆等寬：同一種東西的兩個選項，寬度不齊會看起來有主次之分。
ok('兩顆並排在同一列，而且等寬', await p.evaluate(() => {
  const r = [...document.querySelectorAll('.result-actions .btn')].map((b) => b.getBoundingClientRect())
  return r.length === 2 && r.every((x) => Math.abs(x.top - r[0].top) <= 1)
    && Math.max(...r.map((x) => x.width)) - Math.min(...r.map((x) => x.width)) <= 1
}))
const finishBody = (await p.locator('#dialog-body').textContent()) || ''
// 兩顆都不需要註腳就講得清楚，所以那一行也沒了：一顆需要註腳才說得清楚的按鈕，
// 通常是那顆按鈕的問題。
ok(`說明只剩一句：「${finishBody}」`, finishBody.length <= 20 && !finishBody.includes('列印'))
ok('不再需要任何補充說明', (await p.locator('.result-hint').count()) === 0)
await p.keyboard.press('Escape'); await p.waitForTimeout(400)
ok('Esc 關掉對話框，空間沒有被結束', (await p.locator('.banner-result').count()) === 0)
await p.locator('.topbar button[aria-label="更多"]').click(); await p.waitForTimeout(500)
// 臨時加人（編輯模式的「＋」）與結束點名（動作列）不在選單裡；邀請點名在，
// 它 2026-09 從頂欄的分享圖示收回來——一個空間只該有一顆「更多」。
ok('選單上沒有臨時加人、結束點名',
   (await p.locator('.sheet').getByRole('button', { name: /^臨時加人$|^結束點名$/ }).count()) === 0)
ok('面板底下不再另外印一句到期日',
   (await p.locator('.sheet > .hint').count()) === 0)

// 邀請點名（單機模式）——這裡是關鍵：這個建置沒有雲端，代碼、連結、二維碼對任何
// 人都沒有用。發出去只會讓五個同工站在車門口看到「找不到這個代碼」，然後以為
// 是自己打錯而重打三次。邀請頁必須當場說出來，不能照樣列出那三種方式。
// 邀請點名是選單的第一列（2026-09 從頂欄收回來）。面板此刻還開著。
await p.locator('.sheet').getByRole('button', { name: /^邀請點名$/ }).click(); await p.waitForTimeout(900)
ok('單機模式：邀請頁說「這個空間只有你看得到」',
   ((await p.locator('.note-warn').textContent()) || '').includes('只有你看得到'))
ok('單機模式：不列代碼', (await p.getByRole('button', { name: /^代碼/ }).count()) === 0)
ok('單機模式：不列連結', (await p.getByRole('button', { name: /^連結/ }).count()) === 0)
ok('單機模式：不列二維碼', (await p.getByRole('button', { name: /^二維碼/ }).count()) === 0)
ok('單機模式：不發代碼', (await p.locator('.code-display').count()) === 0)
ok('單機模式：不產 QR', (await p.locator('.qr-card img').count()) === 0)
ok('單機模式：不給「複製連結」', (await p.getByRole('button', { name: /傳給別人|複製連結/ }).count()) === 0)
ok('單機模式：連那個框都沒有', (await p.locator('.copy-row').count()) === 0)
ok('單機模式：講清楚別人會看到什麼',
   ((await p.locator('.note-warn').textContent()) || '').includes('找不到這個代碼'))
// 邀請頁 2026-09 瘦到只剩三列：底下那句「不用註冊、不用安裝」與「現在在這個空間
// 裡」整區都拿掉了（單機模式下本來就沒有那三列，這裡驗的是那兩塊真的不在）。
ok('單機模式：沒有那句「不用註冊、不用安裝」',
   (await p.getByText('不用註冊').count()) === 0)
ok('單機模式：沒有「現在在這個空間裡」',
   (await p.getByText('現在在這個空間裡').count()) === 0)
await p.locator('.sheet-head .icon-btn').first().click(); await p.waitForTimeout(300)
ok('返回之後回到選單', (await p.getByRole('button', { name: /^編輯$/ }).count()) === 1)

// 編輯不是面板裡的一頁：按下去面板收掉，整個點名畫面切進編輯模式（2026-09）。
// 那一段的細節在下面「現場操作測試」那一間量。
await p.keyboard.press('Escape'); await p.waitForTimeout(400)
ok('Esc 關閉面板', (await p.locator('.sheet').count()) === 0)

// 首頁：每個空間右邊的「更多」——**空間本身的事**（2026-09 拆開）。建立副本與
// 刪除空間動的都是空間這個容器，不必先進去、也不必等名單同步。名單的事在空間
// 裡那顆「更多」。
await p.goto(URL); await p.waitForTimeout(900)
// 「加入空間」開的是一張從下緣長上來的面板（2026-09），不再是就地展開的一段內容
// ——這個 app 只有一種「再給我一層」的形狀，其餘全部都是底部面板。
await p.getByRole('button', { name: /^加入空間$/ }).click(); await p.waitForTimeout(500)
ok('開的是一張面板，不是就地展開',
   (await p.locator('.overlay-bottom .sheet').count()) === 1
   && (await p.locator('#join-panel').count()) === 0)
// 就地展開時底下那份清單仍然按得到、螢幕閱讀器也仍然讀得到。面板要掛在 .shell
// 外面，useModal 才 inert 得到整頁（見 Home.tsx 的註解）。
ok('背景整頁 inert 了', await p.evaluate(() =>
  document.querySelector('.shell')?.hasAttribute('inert') === true))
// 標題列不畫（「加入空間」四個字沒有比底下那個代碼框與那兩顆按鈕多說一件事），
// 但螢幕閱讀器聽得到的不能跟著少。
ok('沒有標題列，但無障礙名稱還在',
   (await p.locator('.sheet .sheet-head').count()) === 0
   && (await p.locator('.sheet').getAttribute('aria-label')) === '加入空間')
// 按下那顆鍵的下一個動作就是打那六碼，跳出鍵盤是它的直接結果。
ok('開起來焦點就在代碼框',
   await p.evaluate(() => document.activeElement?.classList.contains('code-input') === true))
// 打代碼＋加入是同一件事的兩半，所以是**同一個框**（2026-09 從兩個並排的框
// 合起來）：框畫在外層，裡面的輸入框與按鈕都不再各自有框。
ok('代碼輸入與「加入」在同一列', await p.evaluate(() => {
  const input = document.querySelector('.sheet .code-input').getBoundingClientRect()
  const join = document.querySelector('.sheet .code-row .btn').getBoundingClientRect()
  return Math.abs((input.top + input.height / 2) - (join.top + join.height / 2)) <= 2
    && join.left >= input.right - 1
}))
ok('而且是同一個框：框在外層，裡面兩個都沒有自己的邊', await p.evaluate(() => {
  const row = document.querySelector('.sheet .code-row')
  const input = document.querySelector('.sheet .code-row .code-input')
  const join = document.querySelector('.sheet .code-row .btn')
  if (!row || !input || !join) return false
  const w = (el) => parseFloat(getComputedStyle(el).borderTopWidth)
  return w(row) >= 1 && w(input) === 0 && w(join) === 0
}))
// 並排的元件要對齊：輸入框的高度不能是字級的副產品（2026-09 寫死 --tap-lg）。
ok('代碼框與「加入」等高，而且填滿那個框', await p.evaluate(() => {
  const row = document.querySelector('.sheet .code-row').getBoundingClientRect()
  const input = document.querySelector('.sheet .code-row .code-input').getBoundingClientRect()
  const join = document.querySelector('.sheet .code-row .btn').getBoundingClientRect()
  return Math.abs(input.height - join.height) <= 1 && row.height - input.height <= 3
}))
// 對焦圈搬到外框：裡面的輸入框沒有邊可以亮了。
ok('對焦時亮的是整個框', await p.evaluate(() => {
  document.querySelector('.sheet .code-row .code-input').focus()
  const row = getComputedStyle(document.querySelector('.sheet .code-row'))
  const input = getComputedStyle(document.querySelector('.sheet .code-row .code-input'))
  return row.boxShadow !== 'none' && input.boxShadow === 'none'
}))
ok('掃碼自己一列（在那一列底下）', await p.evaluate(() => {
  const row = document.querySelector('.sheet .code-row').getBoundingClientRect()
  const scan = [...document.querySelectorAll('.sheet .stack > .btn')]
    .find((b) => /QR/.test(b.textContent || ''))
  return Boolean(scan) && scan.getBoundingClientRect().top >= row.bottom - 1
}))
// 320px 上輸入框仍要放得下六碼（它是這一列唯一該讓步的東西，但有下限）。
ok('窄螢幕上輸入框沒有被擠爛', await p.evaluate(() =>
  document.querySelector('.sheet .code-input').getBoundingClientRect().width >= 200))
// 收起來的路：Esc（點面板外面與從握把往下滑是同一套，Sheet 已經在別處驗過）。
await p.keyboard.press('Escape'); await p.waitForTimeout(400)
ok('Esc 關得掉，背景也還回來了',
   (await p.locator('.sheet').count()) === 0
   && await p.evaluate(() => document.querySelector('.shell')?.hasAttribute('inert') === false))
ok('首頁清單每一列右邊都有一顆「更多」',
   (await p.getByRole('button', { name: /^更多：/ }).count()) === (await p.locator('.recent-item').count()))
ok('無障礙名稱說得出是哪一個空間',
   (await p.getByRole('button', { name: /^更多：秋季旅遊 · 出發$/ }).count()) === 1)
ok('列上那顆垃圾桶不見了（從清單移除搬進選單，跟刪除空間排在一起才分得出差別）',
   (await p.getByRole('button', { name: /^從清單移除：/ }).count()) === 0)
// 框圈住整列，「更多」在框裡面（2026-09）：它本來浮在框外面，七列並排時看不出
// 它是上面那一列的還是下面那一列的。
ok('「更多」在那一列的框裡面', await p.evaluate(() => {
  const card = document.querySelector('.recent-item')
  const more = card?.querySelector(':scope > button.icon-btn')
  if (!card || !more) return false
  const c = card.getBoundingClientRect(); const m = more.getBoundingClientRect()
  return m.right <= c.right + 1 && m.left >= c.left - 1 && m.top >= c.top - 1 && m.bottom <= c.bottom + 1
}))
ok('那顆更多還是 48px 的觸控目標（內距掛在主按鈕上，不在外框）', await p.evaluate(() => {
  const r = document.querySelector('.recent-item > button.icon-btn')?.getBoundingClientRect()
  return Boolean(r) && r.width >= 48 && r.height >= 48
}))
// 身分 2026-09 從那一列最右邊的文字標籤換成名字前面的圖示：右邊要留給「更多」，
// 而它講的是「我」，比後面那個名字更早被讀到。
ok('身分是那一列名字前面的圖示', await p.evaluate(() => {
  const main = document.querySelector('.recent-main')
  const kids = [...(main?.children ?? [])]
  const badge = kids.findIndex((e) => e.classList.contains('role-badge'))
  return badge === 0 && kids.length === 2 && Boolean(main?.querySelector('.recent-name'))
}))
ok('圖示唸得出身分',
   /^(主揪|協助者)$/.test((await p.locator('.recent-main .role-badge').first().getAttribute('aria-label')) ?? ''))
await p.getByRole('button', { name: /^更多：秋季旅遊 · 出發$/ }).click(); await p.waitForTimeout(600)
ok('就在首頁打開，不進空間', (await p.locator('.home-title').count()) === 1
   && (await p.locator('.topbar-name').count()) === 0)
const homeRows = await p.locator('.sheet .menu-item strong').allTextContents()
ok(`首頁那份是空間本身的事：${homeRows.join('、')}`,
   JSON.stringify(homeRows) === JSON.stringify(['建立副本', '刪除空間']))
ok('名單的事不在這裡（編輯、存成常用都不列）',
   (await p.locator('.sheet').getByRole('button', { name: /^編輯$|^存成常用$/ }).count()) === 0)
// 這一份要有標題列：從一列七個長得差不多的空間裡點開，不印名字就沒有東西說得出
// 「我剛剛按的是哪一間」。空間裡那一份相反（名字就在正上方的頂欄裡）。
ok('面板印著是哪一個空間', (await p.locator('.sheet .sheet-title').textContent()) === '秋季旅遊 · 出發')
await p.keyboard.press('Escape'); await p.waitForTimeout(400)
ok('Esc 關閉空間選單，人還在首頁',
   (await p.locator('.sheet').count()) === 0 && (await p.locator('.home-title').count()) === 1)

// ---- 現場操作：同名辨識、未分組、臨時加人、刪除確認 ----
await p.goto(URL); await p.waitForTimeout(900)
await p.getByRole('button',{name:/創建空間/}).first().click(); await p.waitForTimeout(300)
await p.locator('#room-name').fill('現場操作測試')
await p.locator('#roster-text').fill(`沒填車次的甲
沒填車次的乙
【第一車】
陳怡君 0912345678
王小明
【第二車】
陳怡君 0955666777
陳大同（請假）`)
await p.waitForTimeout(400)
await generateList()
await p.getByRole('button',{name:/建立/}).click(); await p.waitForTimeout(1200)

// #28 沒有分車的人也要有自己的晶片與標題，否則兩個顧車的志工會同時漏掉他們。
const chips2 = await p.locator('.group-chip').allTextContents()
ok(`分組晶片含「未分組」：${chips2.join(' | ')}`, chips2.some(c => c.includes('未分組')))
const dividers = await p.locator('.group-divider').allTextContents()
ok(`第一段也有標題：${dividers.join(' | ')}`, dividers[0]?.trim() === '未分組')
await p.getByRole('button',{name:/未分組/}).click(); await p.waitForTimeout(400)
ok('選「未分組」只看到那 2 個人', (await p.locator('.member').count()) === 2)
ok('選了「未分組」之後名單只剩那一組', (await p.locator('.member').count()) === 2)
await p.locator('.groups button').first().click(); await p.waitForTimeout(400)

// #11 同名的人要看得出誰是誰。
const dupRows = p.locator('.member').filter({ hasText: '陳怡君' })
ok('兩位陳怡君都帶辨識晶片', (await dupRows.locator('.chip-tell').count()) === 2)
const tells = await dupRows.locator('.chip-tell').allTextContents()
ok(`辨識用的是分車：${tells.join(' / ')}`, tells.includes('第一車') && tells.includes('第二車'))
ok('沒有同名的人不會多印晶片',
   (await p.locator('.member').filter({ hasText: '王小明' }).locator('.chip-tell').count()) === 0)

// 名字右邊那顆「更多」與它打開的成員面板 2026-09 整個拿掉了。
ok('名字右邊沒有「更多」了',
   (await p.locator('.member').getByRole('button', { name: /更多|more/ }).count()) === 0)
// 撥號鍵搬回列上：收尾時「看到未到 → 打電話」是唯一的下一步，不能跟著面板消失。
// 號碼是從備註裡認出來的（解析階段刻意不判斷任何一串數字是什麼）。
const telHrefAttr = await p.locator('.member').filter({ hasText: '陳怡君' }).first()
  .locator('a[href^="tel:"]').first().getAttribute('href')
ok(`備註裡的號碼在列上就撥得出去 ${telHrefAttr}`, telHrefAttr === 'tel:0912345678')
// 備註 2026-09 當副標題印在名字底下：那正是它被寫下來的原因。
const notedRow = p.locator('.member').filter({ hasText: '陳怡君' }).first()
ok('備註印在名字底下', await notedRow.locator('.member-note').first().isVisible())
ok('印的是原文（0912345678）',
   ((await notedRow.locator('.member-note').first().textContent()) ?? '').includes('0912345678'))


// ---- 編輯模式（2026-09）----
// 編輯標題、臨時加人、從名單移除是同一件事的三個方向，所以是同一個模式。
await p.locator('.topbar button[aria-label="更多"]').click(); await p.waitForTimeout(500)
await p.getByRole('button', { name: /^編輯$/ }).click(); await p.waitForTimeout(500)
ok('編輯不開子畫面，面板直接關掉', (await p.locator('.sheet').count()) === 0)
ok('標題變成可以打字的輸入框', await p.locator('.topbar-name-input').isVisible())
ok('輸入框帶著現在的名字',
   (await p.locator('.topbar-name-input').inputValue()) === '現場操作測試')
ok('每一列右邊長出叉叉',
   (await p.getByRole('button', { name: /^從名單移除：/ }).count()) === (await p.locator('.member').count()))
const editDock = await p.locator('.dock .btn').allTextContents()
ok(`底部只剩一顆「＋」（${editDock.length} 顆按鈕）`, editDock.length === 1)
ok('那顆的無障礙名稱說得出它做什麼',
   (await p.locator('.dock .btn').first().getAttribute('aria-label')) === '臨時加人')
ok('右上角變成打勾（無障礙名稱仍然是「完成」）',
   (await p.getByRole('button', { name: /^完成$/ }).locator('svg').count()) === 1)
// 這個模式裡改不到誰到了沒——三條路都要斷。
// 手指在一排叉叉旁邊移動，誤觸的代價是有人被標成已到而沒有人發現。
// 戳名字現在改成「編輯這一個人」，所以不能再用 disabled 驗——驗的是狀態沒動。
const beforeArrived = await segCount(/^已到/)
await p.locator('.member-main').first().click(); await p.waitForTimeout(400)
ok(`編輯時戳名字不會改狀態（已到 ${beforeArrived} → ${await segCount(/^已到/)}）`,
   (await segCount(/^已到/)) === beforeArrived)
// 戳下去打開的是那一列自己的兩個輸入框：名字與備註。
ok('戳名字會打開那一列的輸入框', (await p.locator('.member-name-input').count()) === 1)
ok('備註也一起改得動', (await p.locator('.member-note-input').count()) === 1)
ok('一次只開一列', (await p.locator('.member-name-input').count()) === 1)
const editedName = `${await p.locator('.member-name-input').inputValue()}（改過）`
await p.locator('.member-name-input').fill(editedName)
await p.locator('.member-note-input').fill('臨時換人')
await p.locator('.member-note-input').blur(); await p.waitForTimeout(700)
ok(`改完就存：「${await p.locator('.member').first().locator('.member-name').textContent()}」`,
   (await p.locator('.member').first().locator('.member-name').textContent()) === editedName)
ok('備註也存下來了，而且就印在名字底下',
   ((await p.locator('.member').first().locator('.member-note').textContent()) ?? '').includes('臨時換人'))
// 「復原」也是點名操作，所以進編輯模式時 Toast 要當場收掉。
ok('進編輯模式時 Toast 收掉了（不留一顆浮著的「復原」）',
   (await p.locator('.toast').count()) === 0)
// 身分與同步狀態回答的是點名當下的問題，編輯時畫面上只該剩名單。
ok('編輯時不印身分與同步狀態', (await p.locator('.role-badge').count()) === 0
   && (await p.locator('.topbar .sync').count()) === 0)
// 那條界線是為了隔開「點名」與「打電話」；編輯時點名區是停用的，沒有東西要隔。
ok('叉叉左邊沒有那條界線', await p.evaluate(() =>
  getComputedStyle(document.querySelector('.member.is-editing .member-side')).borderLeftStyle === 'none'))

// 改標題：離開輸入框就存。
await p.locator('.topbar-name-input').fill('現場操作測試 · 改過')
await p.locator('.topbar-name-input').blur(); await p.waitForTimeout(900)
await p.getByRole('button', { name: /^完成$/ }).click(); await p.waitForTimeout(400)
ok('完成之後回到點名畫面', (await p.locator('.topbar-name-input').count()) === 0)
ok(`標題真的改掉了：「${await p.locator('.topbar-name').textContent()}」`,
   (await p.locator('.topbar-name').textContent()) === '現場操作測試 · 改過')

// 從名單移除：不可復原、而且會同步到所有裝置，就算已經在編輯模式也要問一次。
const beforeRemove = await p.locator('.member').count()
await p.locator('.topbar button[aria-label="更多"]').click(); await p.waitForTimeout(500)
await p.getByRole('button', { name: /^編輯$/ }).click(); await p.waitForTimeout(500)
await p.getByRole('button', { name: /^從名單移除：沒填車次的乙$/ }).click(); await p.waitForTimeout(500)
ok('刪除前有確認對話框', (await p.locator('.dialog').count()) === 1)
await p.getByRole('button', { name: /^取消$/ }).click(); await p.waitForTimeout(400)
ok('取消之後人還在', (await p.locator('.member').count()) === beforeRemove)
await p.getByRole('button', { name: /^從名單移除：沒填車次的乙$/ }).click(); await p.waitForTimeout(400)
await p.locator('.dialog').getByRole('button', { name: /^移除$/ }).click(); await p.waitForTimeout(900)
ok(`確認之後真的少一個人（${beforeRemove} → ${await p.locator('.member').count()}）`,
   (await p.locator('.member').count()) === beforeRemove - 1)
await p.getByRole('button', { name: /^完成$/ }).click(); await p.waitForTimeout(400)

// #10 臨時加人：站在你面前的人不該被算成「未到」，而且要說一聲。
const beforeMissing = await missing()
await p.locator('.topbar button[aria-label="更多"]').click(); await p.waitForTimeout(500)
await p.getByRole('button', { name: /^編輯$/ }).click(); await p.waitForTimeout(500)
await p.locator('.dock .btn').first().click(); await p.waitForTimeout(500)
await p.locator('#roster-text').fill('路上遇到的人'); await p.waitForTimeout(400)
await p.getByRole('button',{name:/加入名單/}).click(); await p.waitForTimeout(1200)
ok(`臨時加人不會讓未到數變多（${beforeMissing} → ${await missing()}）`, (await missing()) === beforeMissing)
const walkToast = (await p.locator('.toast-text').textContent().catch(() => '')) ?? ''
ok(`加完有說一聲：「${walkToast}」`, walkToast.includes('路上遇到的人') && walkToast.includes('已到'))
await p.getByRole('button', { name: /^完成$/ }).click(); await p.waitForTimeout(400)

// #17 Toast 固定在下緣 88px（讓開底部動作列），但面板也是從下緣長上來的：
// Toast 於是落在選單列之間，實測蓋住「結束這一輪」49px，而且 .toast 是
// pointer-events: auto，那五秒內那一列按不下去。面板開著時要移到上緣的遮罩區。
await p.locator('.member-main').first().click(); await p.waitForTimeout(300)
await p.locator('.topbar button[aria-label="更多"]').click(); await p.waitForTimeout(500)
const toastVsMenu = await p.evaluate(() => {
  const toast = document.querySelector('.toast')
  if (!toast) return { noToast: true }
  const tr = toast.getBoundingClientRect()
  const rows = [...document.querySelectorAll('.sheet .menu-item')]
  const covered = rows.filter((el) => {
    const b = el.getBoundingClientRect()
    return Math.min(b.bottom, tr.bottom) - Math.max(b.top, tr.top) > 0
  })
  // 被蓋住的那一列，中心點實際上點得到誰？
  const stolen = covered.filter((el) => {
    const b = el.getBoundingClientRect()
    return !el.contains(document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2))
  })
  return { top: Math.round(tr.top), covered: covered.map((e) => e.innerText.split('\n')[0]), stolen: stolen.length }
})
ok(`面板開著時 Toast 在上緣（top=${toastVsMenu.top}）`, !toastVsMenu.noToast && toastVsMenu.top < 120)
ok(`Toast 沒有蓋住任何選單列（${toastVsMenu.covered.join('、') || '無'}）`, toastVsMenu.covered.length === 0)
ok('也沒有攔截任何一列的點擊', toastVsMenu.stolen === 0)
// 面板關掉之後要回到下緣，否則會擋住頂欄
await p.keyboard.press('Escape'); await p.waitForTimeout(500)
await p.locator('.member-main').nth(1).click(); await p.waitForTimeout(400)
const toastBack = await p.evaluate(() => {
  const t = document.querySelector('.toast')
  return t ? Math.round(t.getBoundingClientRect().top) : -1
})
ok(`面板關掉後 Toast 回到下緣（top=${toastBack}）`, toastBack > 400)
await p.locator('.toast-action').click().catch(() => {}); await p.waitForTimeout(400)

// #16 底部動作列 2026-09 回來了，但裝的東西換了兩次：先是一場活動的三個時刻，
// 接著臨時加人併進編輯模式的「＋」、邀請點名搬走，於是只剩收尾那一顆。
// 判準沒變（反覆要按、而且在別處按不到），變的是有幾顆通得過。
const dockLabels = await p.locator('.dock .btn').allTextContents()
ok(`底部動作列只剩一顆：${dockLabels.join('、')}`,
   JSON.stringify(dockLabels.map((x) => x.trim())) === JSON.stringify(['結束點名']))
ok('動作列上沒有主要按鈕（這個畫面的主要動作是戳名字）',
   (await p.locator('.dock .btn-primary').count()) === 0)
ok('也沒有浮動搜尋鍵', (await p.locator('.fab').count()) === 0)
// 搜尋跟篩選同一列（2026-09）：一顆放大鏡排在「全部／未到／已到」右邊。
// 頂欄剩兩列：名字那一列、篩選＋搜尋那一列。搜尋自己那一列（76px）沒了。
ok('搜尋是篩選列右邊那一顆，不另外佔一列',
   (await p.locator('.topbar .filterbar .search-toggle').count()) === 1
   && (await p.locator('.topbar > .shell').count()) === 2)
// 分享在頂欄待過一陣子，2026-09 收回「更多」：一個空間只該有一顆「更多」，
// 不然同一張面板有兩個入口通往它的不同頁。頂欄因此只剩返回與更多。
ok('頂欄只剩返回與更多兩顆',
   (await p.locator('.topbar-inner > button.icon-btn').count()) === 2
   && (await p.locator('.topbar button[aria-label="更多"]').count()) === 1
   && (await p.locator('.topbar button[aria-label="邀請點名"]').count()) === 0)
ok('搜尋在畫面上只有一個入口',
   (await p.locator('button[aria-label*="搜尋"]').count()) === 1)

// 那顆鍵跟旁邊的分段控制、跟頂欄的圖示鍵都要對得起來（48px 的手指高度）。
const toggleBox = await p.locator('.filterbar .search-toggle').boundingBox()
const iconBtnBox = await p.locator('.topbar button[aria-label="更多"]').boundingBox()
ok(`放大鏡是 ${Math.round(toggleBox.width)}×${Math.round(toggleBox.height)}，跟頂欄圖示鍵同尺寸`,
   Math.abs(toggleBox.height - iconBtnBox.height) <= 1 && toggleBox.width >= 48)

// 展開之後那條輸入框要正好蓋住分段控制——不是借來的通用 .input 樣式，高度是
// 那一列（48px 的按鈕＋凹槽 4px 的內距）決定的。
await openSearch()
const searchInputBox = await p.locator('.search-wrap input[type=search]').boundingBox()
const segmentedBox = await p.locator('.filterbar .segmented').boundingBox()
ok(`搜尋框高度（${Math.round(searchInputBox.height)}px）跟分段控制那一列（${Math.round(segmentedBox.height)}px）一致`,
   Math.abs(searchInputBox.height - segmentedBox.height) <= 1)

// Esc 分兩段：先清字（名單立刻回來），再按一次才收回成圖示。一次做完兩件事
// 的話，只是想取消過濾的人會連那顆鍵的位置一起失去。
await p.locator('input[type=search]').fill('陳'); await p.waitForTimeout(200)
await p.locator('input[type=search]').press('Escape'); await p.waitForTimeout(250)
ok('第一次 Esc 清空搜尋字，框還在', await p.locator('input[type=search]').inputValue() === ''
   && (await p.locator('input[type=search]').count()) === 1)
await p.locator('input[type=search]').press('Escape'); await p.waitForTimeout(300)
ok('第二次 Esc 才收回成圖示，分段控制回來',
   (await p.locator('input[type=search]').count()) === 0
   && await p.getByRole('button', { name: /^全部/ }).first().isVisible())

// 「更多」不再分頁（2026-09）：空間那一組搬到首頁之後只剩幾列，一眼看得完，
// 再切一層分類只是多一次點擊。排列照一場活動的時間軸：出發前 → 現場 → 車開了。
await p.locator('.topbar button[aria-label="更多"]').click(); await p.waitForTimeout(500)
ok('面板不再有分頁鍵', (await p.locator('.sheet .segmented').count()) === 0)
const manageRows = await p.locator('.sheet .menu-item strong').allTextContents()
// 空間裡這一份只剩「這份名單」的事（2026-09 拆開）：編輯它、把它存成常用。
// 空間本身的事（建立副本、刪除空間）在首頁那顆「更多」。這一間是單機模式，
// 所以「存成常用」也不列（要雲端），只剩「編輯」。
ok(`空間裡那份是空間內部的事：${manageRows.join('、')}`,
   JSON.stringify(manageRows) === JSON.stringify(['邀請點名', '編輯']))
ok('空間本身的事不在這裡（建立副本、刪除空間都不列）',
   (await p.locator('.sheet').getByRole('button', { name: /^建立副本$|^刪除空間$/ }).count()) === 0)
// 匯出 2026-09 整條併進「結束點名」：把結果交出去是收尾的一部分，不是一個要
// 自己想起來去選單裡找的獨立功能。
ok('選單上不列匯出、CSV、複製結果',
   (await p.getByRole('button', { name: /^匯出名單$|^下載 CSV$|^複製結果$/ }).count()) === 0)
// 編輯名單與重新命名合併成「編輯」，選單上不再各佔一列。
ok('選單上沒有「編輯名單」也沒有「重新命名」',
   (await p.getByRole('button', { name: /^編輯名單$|^重新命名$/ }).count()) === 0)

// #36 刪除是唯一不可復原的動作，不能一按就沒。它 2026-09 搬進編輯模式，
// 但「進編輯模式」的意思是「我要改這份名單」，不是「我要刪掉這個人」——
// 所以那一步照樣要問。
await p.getByRole('button', { name: /^編輯$/ }).click(); await p.waitForTimeout(500)
await p.getByRole('button', { name: /^從名單移除：/ }).first().click(); await p.waitForTimeout(500)
ok('刪除前有確認對話框', (await p.locator('.dialog').count()) === 1)
ok('對話框說清楚後果（所有裝置、不能復原）',
   ((await p.locator('.dialog').textContent()) || '').includes('所有裝置'))
await p.getByRole('button',{name:/^取消$/}).click(); await p.waitForTimeout(400)
ok('取消之後人還在', (await p.locator('.member').filter({ hasText: '王小明' }).count()) === 1)
await p.getByRole('button', { name: /^完成$/ }).click(); await p.waitForTimeout(400)

// 身分列整列拿掉（2026-09）：標籤搬到頂欄，名字與設定只剩首頁那顆齒輪進得去。
await p.locator('.topbar button[aria-label="更多"]').click(); await p.waitForTimeout(600)
ok('「更多」面板沒有身分列了', (await p.locator('.sheet .role-line').count()) === 0)
ok('「更多」面板沒有設定入口了', (await p.locator('.sheet button[aria-label="設定"]').count()) === 0)

// 標題列整條拿掉（2026-09）：它一路瘦下來——「更多」兩個字說不出任何一件這裡做
// 得到的事 → 換成三顆分頁鍵 → 分頁拿掉之後改印空間名字 → 而那個名字就在面板正
// 上方的頂欄裡，同一個字在同一屏印兩次，第二次只是佔掉一列。
ok('「更多」沒有標題列', (await p.locator('.sheet .sheet-head').count()) === 0)
// 名字在上面的編輯模式測試裡改過了，這裡順便驗它一路傳到面板的無障礙名稱。
ok('無障礙名稱仍然是這個空間', (await p.locator('.sheet').getAttribute('aria-label')) === '現場操作測試 · 改過')
ok('「更多」也沒有關閉鍵', (await p.locator('.sheet .icon-btn').count()) === 0)

/** 從 sel 的中心往下（或往旁邊）滑，模擬手勢。 */
async function swipe(sel, dy, dx = 0) {
  const box = await p.locator(sel).boundingBox()
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await p.mouse.move(x, y); await p.mouse.down()
  for (let i = 1; i <= 6; i++) { await p.mouse.move(x + (dx * i) / 6, y + (dy * i) / 6); await p.waitForTimeout(20) }
  await p.mouse.up(); await p.waitForTimeout(500)
}
const reopen = async () => {
  await p.locator('.topbar button[aria-label="更多"]').click(); await p.waitForTimeout(500)
}

await swipe('.sheet-grip', 30)
ok('往下滑一點點不會收起來（手指抖一下不該關掉面板）', (await p.locator('.sheet').count()) === 1)
await swipe('.sheet-grip', 130)
ok('從握把往下滑收得起來', (await p.locator('.sheet').count()) === 0)

// 握把是整條的，不只中間那 38px 的線——沒有標題列的面板靠它收起來，而 38px
// 對一根手指來說太窄。從最左邊往下拖也要收得起來。
await reopen()
const gripBox = await p.locator('.sheet-grip').boundingBox()
ok(`握把整條都吃得到手勢（寬 ${Math.round(gripBox.width)}px）`, gripBox.width > 300)
await p.mouse.move(gripBox.x + 24, gripBox.y + gripBox.height / 2); await p.mouse.down()
for (let i = 1; i <= 6; i++) {
  await p.mouse.move(gripBox.x + 24, gripBox.y + gripBox.height / 2 + (130 * i) / 6)
  await p.waitForTimeout(20)
}
await p.mouse.up(); await p.waitForTimeout(500)
ok('從握把最左邊往下滑也收得起來', (await p.locator('.sheet').count()) === 0)

// 先動到橫向的就不是「把面板推回去」，手勢要把這一次讓出去。
await reopen()
await swipe('.sheet-grip', 0, 120)
ok('橫向滑握把不會收起面板', (await p.locator('.sheet').count()) === 1)

// 另外兩條路也要在。
await p.mouse.click(195, 120); await p.waitForTimeout(400)
ok('點面板外面關得掉', (await p.locator('.sheet').count()) === 0)
await reopen()
await p.keyboard.press('Escape'); await p.waitForTimeout(400)
ok('Esc 關得掉', (await p.locator('.sheet').count()) === 0)
await reopen()

// 面板長過螢幕時捲的是整張 .sheet（分頁那個固定高度的框 2026-09 一起拿掉了：
// 項目一批批搬走之後，這一份選單只剩名單的事，面板自己就裝得下）。矮螢幕上的
// 契約沒有變：不超過 88vh、裝不下就捲得動、而且捲得到最後一項。
await p.setViewportSize({ width: 390, height: 380 }); await p.waitForTimeout(400)
const sheetFit = await p.locator('.sheet').evaluate((el) => {
  el.scrollTop = el.scrollHeight
  return {
    h: Math.round(el.getBoundingClientRect().height),
    max: Math.round(innerHeight * 0.88),
    // 裝得下就不必捲；裝不下就一定要捲得動。兩者只能成立一個。
    scrollable: el.scrollHeight > el.clientHeight,
    scrolled: el.scrollTop,
  }
})
await p.waitForTimeout(300)
ok(`矮螢幕上面板不超過 88vh（${sheetFit.h} ≤ ${sheetFit.max}）`, sheetFit.h <= sheetFit.max + 1)
ok('裝不下的時候捲得動，裝得下就不必捲',
   sheetFit.scrollable ? sheetFit.scrolled > 0 : sheetFit.scrolled === 0)
ok('不管捲不捲，最後一項都看得到',
   await p.locator('.sheet .menu-item').last().isVisible())
await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(300)

await p.keyboard.press('Escape'); await p.waitForTimeout(400)
// 身分 2026-09 從一顆寫著字的藥丸換成圖示，並且挪到空間名前面：它講的是「我」，
// 比後面那個名字更早被讀到。字沒了，意思只剩 aria-label／title 說得出來。
ok('身分是空間名前面那顆圖示',
   (await p.locator('.topbar-heading .role-badge.is-owner').count()) === 1)
ok('圖示唸得出「主揪」',
   (await p.locator('.topbar-heading .role-badge').getAttribute('aria-label')) === '主揪'
   && (await p.locator('.topbar-heading .role-badge').getAttribute('role')) === 'img')
ok('排在名字前面', await p.evaluate(() => {
  const kids = [...document.querySelectorAll('.topbar-heading > *')]
  return kids.findIndex((e) => e.classList.contains('role-badge'))
       < kids.findIndex((e) => e.classList.contains('topbar-name'))
}))
// 副標那一行（代碼＋同步狀態）2026-09 整條拿掉，頂欄從 121px 降到 113px：
// 這一列現在裝的是一行 24px 的標題與兩顆 48px 的圖示鍵，高度就等於最高的內容。
// 分段控制的計數也用等寬字，所以只驗代碼那一格本身不在（.topbar-sub 沒了）。
ok('頂欄只剩一行，代碼不在上面了', (await p.locator('.topbar-sub').count()) === 0
   && (await p.locator('.topbar-heading .mono').count()) === 0)
ok('那一列的高度等於它最高的內容（48px）', await p.evaluate(() => {
  const inner = document.querySelector('.topbar-inner').getBoundingClientRect().height
  return Math.round(inner) === 48
}))

// 備註不是「純電話號碼」的話（號碼前後還有別的字），備註欄位跟撥號鍵要
// 備註裡的號碼前後還有別的字時，撥出去的只能是那串數字。獨立開一間空間測，
// 不然跟「現場操作測試」混在一起的話，後面一長串斷言都假設還在那個房間裡。
await p.goto(URL); await p.waitForTimeout(600)
await p.getByRole('button', { name: /創建空間/ }).first().click(); await p.waitForTimeout(300)
await p.locator('#room-name').fill('備註加號碼測試')
await p.locator('#roster-text').fill('陳大同 0955666777 帶輪椅')
await p.waitForTimeout(300)
await generateList()
await p.getByRole('button', { name: /建立/ }).click(); await p.waitForTimeout(1000)
ok('備註帶額外文字時，撥號鍵只撥那串數字',
   (await p.locator('.member a[href^="tel:"]').first().getAttribute('href')) === 'tel:0955666777')
ok('備註印的是原文（號碼前後那些字都留著）',
   ((await p.locator('.member .member-note').first().textContent()) ?? '').includes('0955666777 帶輪椅'))

// #15 捲進名單深處之後回得到頂端；#43 名單要是 list、<html lang> 要跟著語言走。
await p.goto(URL); await p.waitForTimeout(800)
await p.getByRole('button',{name:/創建空間/}).first().click(); await p.waitForTimeout(300)
await p.locator('#room-name').fill('長名單測試')
await p.locator('#roster-text').fill(Array.from({length: 40}, (_, i) => `同工${String(i+1).padStart(2,'0')}`).join('\n'))
await p.waitForTimeout(400)
await generateList()
await p.getByRole('button',{name:/建立/}).click(); await p.waitForTimeout(1300)
ok('名單是 list 地標', (await p.locator('.list[role=list]').count()) === 1)
ok('每一列是 listitem', (await p.locator('.member[role=listitem]').count()) === 40)
ok('空間名是 h1', (await p.locator('h1.topbar-name').count()) === 1)
await p.mouse.wheel(0, 3000); await p.waitForTimeout(700)
ok('捲得下去', (await p.evaluate(() => window.scrollY)) > 500)
await p.locator('.topbar-title').click(); await p.waitForTimeout(900)
ok('點頂欄回到名單頂端', (await p.evaluate(() => window.scrollY)) < 10)
// 搜尋框只留一顆清除鍵：原生那顆沒有 48px 觸控目標也沒有無障礙名稱。
// Chrome 的 getComputedStyle 對這個 pseudo-element 會回傳宿主元素的值，驗不到，
// 所以直接確認規則還在樣式表裡（防的是「有人把它刪掉」）。
await openSearch()
await p.locator('input[type=search]').fill('同工'); await p.waitForTimeout(300)
ok('自訂清除鍵有 48px 觸控目標與無障礙名稱', await p.evaluate(() => {
  const b = document.querySelector('.search-clear')
  const r = b?.getBoundingClientRect()
  return Boolean(b?.getAttribute('aria-label')) && r && r.width >= 48 && r.height >= 48
}))
// 清除鍵量的是它自己跟 .input 的中心差。這顆鍵偏過兩次，兩次都是因為某個
// 「剛好成立」的前提悄悄不成立了：先是 .search-wrap 拆出獨立的左右內距（right
// 量到了螢幕邊緣），後來又是它搬進比自己高的篩選列（對齊頂端就偏上 4px）。
const clearAlign = await p.evaluate(() => {
  const input = document.querySelector('.search-wrap .input')
  const clear = document.querySelector('.search-clear')
  const i = input.getBoundingClientRect(); const c = clear.getBoundingClientRect()
  return {
    vGap: Math.round((i.top + i.height / 2) - (c.top + c.height / 2)),
    rGap: Math.round(i.right - c.right),
  }
})
ok(`清除鍵跟輸入框垂直置中（誤差 ${clearAlign.vGap}px）`, Math.abs(clearAlign.vGap) <= 1)
ok(`清除鍵在輸入框邊界之內、留合理間距（${clearAlign.rGap}px）`, clearAlign.rGap >= 2 && clearAlign.rGap <= 8)
ok('原生清除鍵被關掉（只剩自訂的那顆）', await p.evaluate(() => {
  for (const sheet of document.styleSheets) {
    let rules; try { rules = sheet.cssRules } catch { continue }
    for (const r of rules) {
      if (r.selectorText?.includes('search-cancel-button') &&
          /appearance:\s*none/.test(r.style.cssText)) return true
    }
  }
  return false
}))
await p.locator('input[type=search]').fill(''); await p.waitForTimeout(200)
await p.locator('input[type=search]').press('Escape'); await p.waitForTimeout(300)
// <html lang> 要跟著 App 語言，否則螢幕閱讀器會用中文語音唸英文介面。
ok('預設 lang=zh-TW', (await p.evaluate(() => document.documentElement.lang)) === 'zh-TW')
// 設定只剩首頁那顆齒輪進得去（2026-09 管理面板拿掉設定入口）。
await p.goto(URL); await p.waitForTimeout(800)
await p.locator('button[aria-label="設定"]').click(); await p.waitForTimeout(500)
// 主題／語言改成摺疊列（2026-09），要先點開才看得到選項；選了選項後
// 摺疊列自己收回去，所以切回中文前要用英文的「Language」字樣重新展開。
await p.getByRole('button',{name:/語言/}).click(); await p.waitForTimeout(300)
await p.getByRole('button',{name:/English/}).click(); await p.waitForTimeout(600)
ok('切成英文後 lang=en', (await p.evaluate(() => document.documentElement.lang)) === 'en')
await p.getByRole('button',{name:/Language/}).click(); await p.waitForTimeout(300)
await p.getByRole('button',{name:/中文/}).click(); await p.waitForTimeout(600)
ok('切回中文後 lang=zh-TW', (await p.evaluate(() => document.documentElement.lang)) === 'zh-TW')
ok('選了選項後摺疊列自己收回去', (await p.locator('.sheet .segmented').count()) === 0)
await p.keyboard.press('Escape'); await p.waitForTimeout(400)

// 掃描端：單機模式下用代碼加入別人的空間，錯的不是代碼，是這個站台沒有雲端。
// 講「找不到這個代碼。請確認有沒有打錯」會讓人重打三次，而主揪正在數人頭。
await p.evaluate(() => { window.location.hash = '#/j/ZZZZZZ' }); await p.waitForTimeout(1500)
const joinMsg = ((await p.locator('.note-warn').textContent().catch(() => '')) ?? '').trim()
ok(`單機模式加入空間的說法：「${joinMsg}」`, joinMsg.includes('沒有連上雲端'))
ok('不會叫人去檢查代碼有沒有打錯', !joinMsg.includes('打錯'))

// ---- 確認對話框、設定 ----
await p.goto(URL); await p.waitForTimeout(900)

await p.getByRole('button',{name:/創建空間/}).first().click(); await p.waitForTimeout(300)
await p.locator('#room-name').fill('確認對話框測試')
await p.locator('#roster-text').fill('王小明\n李美花\n陳大同')
await p.waitForTimeout(300)
await generateList()
await p.getByRole('button',{name:/建立/}).click(); await p.waitForTimeout(1200)

// --- 確認對話框 ---
// 刪除空間 2026-09 只在首頁那顆「更多」裡（空間本身的事），就地打開，不進空間。
await p.goto(URL); await p.waitForTimeout(900)
await p.getByRole('button', { name: /^更多：確認對話框測試$/ }).click(); await p.waitForTimeout(600)
// 「從清單移除」2026-09 收進「刪除空間」裡：同一件事的兩種程度，並排看才分得出。
await p.getByRole('button',{name:/刪除空間/}).click(); await p.waitForTimeout(500)
const removeRows = await p.locator('.sheet .menu-item strong').allTextContents()
ok(`刪除那一頁兩列：${removeRows.join('、')}`,
   JSON.stringify(removeRows) === JSON.stringify(['從清單移除', '刪除空間']))
ok('而且先講清楚差在哪',
   ((await p.locator('.sheet .hint').first().textContent()) || '').includes('只影響這支手機'))
await p.locator('.sheet').getByRole('button',{name:/^刪除空間$/}).click(); await p.waitForTimeout(500)
ok('刪除空間跳出 alertdialog（不是 window.confirm）', await p.locator('[role=alertdialog]').isVisible())
ok('對話框有標題與說明', (await p.locator('#dialog-title').textContent())==='刪除空間'
   && (await p.locator('#dialog-body').textContent())?.includes('無法復原'))
const focused = await p.evaluate(()=>document.activeElement?.textContent?.trim())
ok(`初始焦點在「取消」而非破壞性按鈕（實際：${focused}）`, focused==='取消')

await p.keyboard.press('Escape'); await p.waitForTimeout(400)
ok('Esc 關閉對話框，什麼都沒刪掉', (await p.locator('[role=alertdialog]').count())===0
   && (await p.getByRole('button', { name: /^更多：確認對話框測試$/ }).count()) === 1)
await p.keyboard.press('Escape'); await p.waitForTimeout(300)
// 刪除的路在首頁，點名的路在空間裡——底下那一段要進去。
await p.getByText('確認對話框測試').first().click(); await p.waitForTimeout(1400)
ok('進得去那個空間', (await p.locator('.topbar-name').textContent()) === '確認對話框測試')

// --- #20 結束點名：把結果攤在確認鍵前面 ---
// 以前收尾被拆成三個彼此無關的按鈕（複製結果在計分區、下載 CSV 在面板第一項、
// 關閉空間在第九項），結果多數空間從未被關閉也從未被匯出，30 天後靜靜消失。
// 它 2026-09 從選單搬到底部動作列：收尾那一刻不該還要先開一層選單。
await p.locator('.member-main').first().click(); await p.waitForTimeout(600)
ok('「關閉空間」改叫「結束點名」',
   (await p.locator('.dock').getByRole('button',{name:/^結束點名$/}).count()) === 1)
await p.locator('.dock').getByRole('button',{name:/^結束點名$/}).click(); await p.waitForTimeout(600)
const finishPreview = (await p.locator('.result-preview').textContent()) ?? ''
ok(`確認鍵前面就看得到結果：「${finishPreview.split('\n')[1]}」`,
   finishPreview.includes('確認對話框測試') && /已到 1 \/ 3 人/.test(finishPreview))
ok('對話框裡就能複製結果', (await p.getByRole('button',{name:/複製結果/}).count()) > 0)
ok('對話框裡就能下載 CSV', (await p.getByRole('button',{name:/下載 CSV/}).count()) > 0)
// 「存成 PDF」2026-09 連同整套列印一起拿掉了：它不是檔案匯出，是叫出列印畫面
// 讓使用者自己存，帶走的東西比 CSV 少卻要多一行字解釋自己。
ok('對話框裡沒有 PDF 了', (await p.getByRole('button',{name:/PDF/}).count()) === 0)
await p.getByRole('button',{name:/^結束點名$/}).last().click(); await p.waitForTimeout(1200)
await p.keyboard.press('Escape'); await p.waitForTimeout(500)
// 結束之後要回答的問題已經不是「還能不能點」，而是「這一場最後是幾個人」。
const closedBanner = (await p.locator('.banner-result-text').textContent()) ?? ''
ok(`結束後橫幅印的是定格結果：「${closedBanner}」`,
   closedBanner.includes('已結束') && closedBanner.includes('1 / 3'))
// 結束之後那三顆要留著：真正需要那份 CSV 的人（教會辦公室、隔天的行政）是在
// 事情結束之後才想起來的，而「匯出名單」那條路已經不在了。
const bannerActions = (await p.locator('.banner-result .btn').allTextContents()).map((x) => x.trim())
ok(`結束後兩種格式都還在：${bannerActions.join('、')}`,
   JSON.stringify(bannerActions) === JSON.stringify(['複製', 'CSV']))
ok('結束後戳名字沒有作用', await p.locator('.member-main').first().isDisabled())
ok('頂欄說得出已關閉', (await p.locator('.topbar-count.closed').count()) === 1)

// --- 設定 ---
await p.keyboard.press('Escape'); await p.waitForTimeout(300)
await p.goto(URL); await p.waitForTimeout(800)
await p.locator('button[aria-label="設定"]').click(); await p.waitForTimeout(500)
// 標題列整條不要（2026-09）：「設定」兩個字說不出這裡做得到的任何一件事，
// 而底下四列自己就說得完。無障礙名稱還是「設定」。
ok('設定面板沒有標題列', (await p.locator('.sheet .sheet-head').count()) === 0)
ok('但無障礙名稱還是「設定」', (await p.locator('.sheet').getAttribute('aria-label')) === '設定')
ok('沒有震動回饋這個設定了', (await p.getByText('震動回饋').count()) === 0)

// 設定頁是四列長得一樣的摺疊列：暱稱、帳戶、主題、語言（2026-09）。單機模式
// 沒有雲端，帳戶那一列整列不出現——不給一個按了只會說「還沒設定雲端」的入口。
const rows = await p.locator('.sheet .select-row .label').allTextContents()
ok(`設定頁的四列：${rows.join('、')}`,
   JSON.stringify(rows) === JSON.stringify(['暱稱', '主題', '語言']))
ok('單機模式沒有帳戶那一列', (await p.getByText('帳戶').count()) === 0)

// 收合時右邊印著目前的值，不展開也看得到自己設了什麼。
const shown = await p.locator('.sheet .select-row-text').allTextContents()
ok(`每一列都印著目前的值：${shown.join('、')}`,
   shown[0] === '未填寫' && shown[1] === '跟隨系統' && shown[2] === '中文')

// 暱稱要點開才有輸入框；打字之後收合列上就看得到。
ok('暱稱沒展開時不佔輸入框的高度', (await p.locator('#checker-name').count()) === 0)
await p.getByRole('button', { name: /^暱稱/ }).click(); await p.waitForTimeout(300)
ok('點開之後輸入框在', await p.locator('#checker-name').isVisible())
await p.locator('#checker-name').fill('陳姐')
await p.locator('#checker-name').blur(); await p.waitForTimeout(400)
ok('收合列上就看得到剛填的暱稱',
   (await p.locator('.sheet .select-row-text').first().textContent()) === '陳姐')

// 一次只開一列：點主題，暱稱要自己收起來。
await p.getByRole('button', { name: /^主題/ }).click(); await p.waitForTimeout(300)
ok('開了主題，暱稱就收起來', (await p.locator('#checker-name').count()) === 0
   && (await p.locator('.sheet .segmented').count()) === 1)

await p.keyboard.press('Escape'); await p.waitForTimeout(300)

// 換一間空間之前先回上一頁：底下幾段假設自己是從首頁開始的。
await p.goBack(); await p.waitForTimeout(1200)

// ---- 分組（分車）----
await p.goto(URL); await p.waitForTimeout(900)

await p.getByRole('button',{name:/創建空間/}).first().click(); await p.waitForTimeout(300)
await p.locator('#room-name').fill('秋季旅遊 · 出發')
await p.locator('#roster-text').fill(`【第一車】
1.王小明 0912345678
2. 李美花 +1
3.張三
【第二車】
4、陳大同（請假）
5.李四
6.王五 帶2人`)
await p.waitForTimeout(400)
const preview = await p.locator('.preview-row').count()
ok(`解析預覽 ${preview} 人（標題行不算人）`, preview===6)
await generateList()
await p.getByRole('button',{name:/建立/}).click(); await p.waitForTimeout(1300)

// --- 分組 UI ---
ok('出現分組選擇器', await p.locator('.groups').isVisible())
const chips = await p.locator('.group-chip').allTextContents()
ok(`分組晶片：${chips.join(' | ')}`, chips.length===3 && chips[1].includes('第一車') && chips[2].includes('第二車'))
// 6 列，一個都還沒到（「（請假）」現在只是備註）。
ok('全部：未到 6', (await missing())==='6')
ok('看全部時有分組分隔', (await p.locator('.group-divider').count())===2)


// 選第一車 → 計數只算那一車
await p.getByRole('button',{name:/第一車/}).click(); await p.waitForTimeout(400)
ok('第一車：未到 3', (await missing())==='3')
ok('第一車只顯示 3 人', (await p.locator('.member').count())===3)
ok('選了分組後不再顯示分隔', (await p.locator('.group-divider').count())===0)

// 點名只影響那一車的計數
await p.locator('.member-main').nth(0).click(); await p.waitForTimeout(600)
ok('第一車點一人後未到 2', (await missing())==='2')
await p.getByRole('button',{name:/第二車/}).click(); await p.waitForTimeout(400)
// 第二車：陳大同、李四、王五 → 3 個沒到。
ok('第二車未到 3', (await missing())==='3')


// 分組晶片上的未到人頭。「全部」也帶一個數字，各車相加要等於它——加不起來的話
// 志工會以為自己算錯，開始找那個不存在的差額。晶片是人頭、分段控制是列數
// （見 roll-call.md）；攜伴不再解析之後兩者在新名單上相等。
await p.locator('.groups .group-chip').first().click(); await p.waitForTimeout(400)
const gn = await p.locator('.group-chip .group-n').allTextContents()
ok(`晶片數字（全部｜各車）：${gn.join(' / ')}`, gn.length===3 && gn[1]==='2' && gn[2]==='3')
ok('各車未到相加等於「全部」', Number(gn[1]) + Number(gn[2]) === Number(gn[0]))
ok('而且等於分段控制的未到數', (await missing()) === gn[0])

// --- 複製結果應限定在選取的分組 ---
await ctx.grantPermissions(['clipboard-read','clipboard-write'])
await p.getByRole('button',{name:/第二車/}).click(); await p.waitForTimeout(300)
// 複製結果 2026-09 併進「結束點名」：三種格式都在確認鍵前面。這裡只借那顆鍵，
// 不真的結束——按 Esc 走人，空間照樣開著。
await p.locator('.dock').getByRole('button',{name:/^結束點名$/}).click(); await p.waitForTimeout(500)
await p.getByRole('button',{name:/複製結果/}).click(); await p.waitForTimeout(700)
const clip = await p.evaluate(()=>navigator.clipboard.readText())
ok(`複製結果限定第二車：「${clip.split('\n')[0]}」`, clip.includes('第二車') && clip.includes('李四') && !clip.includes('王小明'))
await p.keyboard.press('Escape'); await p.waitForTimeout(400)

// --- 搜尋要放掉選到的那一車 ---
// 顧第一車的志工選著「第一車」，有人在車門口報上名字，搜下去卻是「這裡沒有人」
// ——那個人明明在名單上，只是在第二車。這種假的查無此人最貴。
ok('現在還選著第二車',
   (await p.evaluate(() => document.querySelector('.groups .group-chip')?.getAttribute('aria-pressed'))) === 'false')
await openSearch()
ok('展開搜尋就放掉那一車，晶片回到「全部」',
   (await p.evaluate(() => document.querySelector('.groups .group-chip')?.getAttribute('aria-pressed'))) === 'true')
await p.locator('input[type=search]').fill('王小明'); await p.waitForTimeout(400)
ok('所以搜得到別車的人（王小明在第一車）', (await p.locator('.member').count()) === 1)
await p.locator('input[type=search]').press('Escape'); await p.waitForTimeout(250)
await p.locator('input[type=search]').press('Escape'); await p.waitForTimeout(300)


// ---- 80 人名單的首屏產出 ----
// roll-call.md 寫著「首屏本來就有 45–50% 的高度被控制項吃掉——80 人的名單一屏
// 只看得到 4 個人；省下的每一格都直接變成人名」。這一段把那句話變成可量的東西。
// 搜尋 2026-09 併進篩選列（收成右邊一顆放大鏡）之後，那 76px 還回來了，首屏
// 因此多看得到一個人名——代價是搜尋要先點一下。
await p.goto(URL); await p.waitForTimeout(600)
await p.getByRole('button',{name:/創建空間/}).first().click(); await p.waitForTimeout(400)
await p.locator('#room-name').fill('員工旅遊 · 出發')
await p.locator('#roster-text').fill(
  ['【第一車】', ...Array.from({length:40},(_,i)=>`第一車學員${String(i+1).padStart(2,'0')}`),
   '【第二車】', ...Array.from({length:40},(_,i)=>`第二車學員${String(i+1).padStart(2,'0')}`)].join('\n'))
await p.waitForTimeout(800)
await generateList()
await p.getByRole('button',{name:/建立/}).click(); await p.waitForTimeout(2200)
const fold = await p.evaluate(() => {
  const rows = [...document.querySelectorAll('.member')]
  return {
    firstNameTop: Math.round(rows[0].getBoundingClientRect().top),
    visible: rows.filter((e) => e.getBoundingClientRect().bottom <= innerHeight).length,
    // 搜尋跟篩選在同一列：兩者的上緣要一樣高（差 1px 是次像素）。
    searchRow: (() => {
      const bar = document.querySelector('.filterbar')?.getBoundingClientRect()
      const btn = document.querySelector('.filterbar .search-toggle')?.getBoundingClientRect()
      const seg = document.querySelector('.filterbar .segmented')?.getBoundingClientRect()
      return Boolean(bar && btn && seg) && Math.abs(btn.top - seg.top) <= 4 && btn.left > seg.right - 1
    })(),
    hasDock: !!document.querySelector('.dock'),
    dockH: Math.round(document.querySelector('.dock')?.getBoundingClientRect().height ?? 0),
  }
})
ok(`80 人首屏看得到 ${fold.visible} 個人名（第一個人名在 y=${fold.firstNameTop}）`, fold.visible >= 7)
// 動作列 2026-09 回來了，它吃掉的高度是有代價的——換到的是三個時刻不必先開選單。
ok(`底部動作列只吃掉 ${fold.dockH}px`, fold.hasDock && fold.dockH <= 72)
ok('搜尋跟篩選同一列，右邊那一顆（省下的 76px 等於一列人名）', fold.searchRow)
// 捲到名單深處，搜尋必須還按得到——那顆鍵住在 sticky 頂欄裡，永遠在畫面上，
// 不必先捲回頂端。
await p.mouse.wheel(0, 3000); await p.waitForTimeout(500)
ok('捲過 3000px 之後放大鏡仍在畫面上（頂欄 sticky）',
   await p.locator('.filterbar .search-toggle').isVisible())
await openSearch()
await p.locator('input[type=search]').fill('第二車學員37'); await p.waitForTimeout(500)
ok('深處也搜得到人', (await p.locator('.member').count()) === 1)
await p.locator('input[type=search]').press('Escape'); await p.waitForTimeout(400)
ok('Esc 清空搜尋字、還原名單，搜尋框還在原地',
   (await p.locator('input[type=search]').count()) === 1
   && (await p.locator('input[type=search]').inputValue()) === ''
   && (await p.locator('.member').count()) === 80)
await p.locator('input[type=search]').press('Escape'); await p.waitForTimeout(300)

// .list 的下方內距（見 styles.css）決定的是「捲到底之後最後一列還按得到嗎」，
// 不是首屏能看到幾個人——這裡直接量會蓋住它的東西：點名後彈出的 Toast。
await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await p.waitForTimeout(400)
await p.locator('.member-main').last().click(); await p.waitForTimeout(400)
const lastRowVsToast = await p.evaluate(() => {
  const rows = [...document.querySelectorAll('.member')]
  const last = rows[rows.length - 1]
  const toast = document.querySelector('.toast')
  if (!toast) return null
  const l = last.getBoundingClientRect(); const t = toast.getBoundingClientRect()
  return !(l.right < t.left || l.left > t.right || l.bottom < t.top || l.top > t.bottom)
})
ok('點了最後一人之後，Toast 不蓋住那一列', lastRowVsToast === false)
await p.locator('.toast-action').click().catch(() => {}); await p.waitForTimeout(400)

ok('沒有 JS 錯誤', errs.length === 0)
if (errs.length) console.log(errs.join('\n'))
await b.close()
