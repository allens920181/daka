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
ok('顯示單機模式提示', (await p.locator('.page-note').count()) > 0)


// 開空間
await p.getByRole('button', { name: /創建空間/ }).first().click()
await p.waitForTimeout(400)
// 空間名稱的 return 鍵寫著「下一個」，所以它得真的跳到下一欄（名單）。
ok('空間名稱的 return 鍵寫著「下一個」', await p.getAttribute('#room-name', 'enterkeyhint') === 'next')
await p.locator('#room-name').fill('秋季旅遊 · 出發')
await p.locator('#room-name').press('Enter'); await p.waitForTimeout(200)
ok('按下去焦點就在名單欄，名稱原封不動',
   await p.evaluate(() => document.activeElement?.id) === 'roster-text'
   && await p.inputValue('#room-name') === '秋季旅遊 · 出發')
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

/*
 * 「復原」是誤觸後唯一的機會，所以它有兩條不能鬆的線（2026-09 把邊拿掉時
 * 一起釘住）：**手指按得到**（44px）、**眼睛讀得到**（4.5:1）。
 *
 * 拿掉的只有那條邊——它本來是 `border: 1px solid currentColor`，一個框裡再放
 * 一個框。字色與字重沒有動。
 *
 * 按壓底色也在這裡驗：它疊在深色 Toast 上會把底提亮、吃掉 teal 的對比。第一版
 * 寫 14% 就掉到 3.89:1，被稽核抓出來（面板一開，Toast 移到上緣正好落在滑鼠下，
 * hover 就生效了）。
 */
const undo = await p.evaluate(() => {
  const el = document.querySelector('.toast-action')
  const parse = (c) => { const m = c.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)|color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/)
    if (!m) return null
    return m[1] !== undefined
      ? { r:+m[1], g:+m[2], b:+m[3], a: m[4]===undefined?1:+m[4] }
      : { r:+m[5]*255, g:+m[6]*255, b:+m[7]*255, a: m[8]===undefined?1:+m[8] }
  }
  const lum = ({ r, g, b }) => { const f = (v) => { v/=255; return v<=0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4) }
    return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b) }
  // Toast 的底是半透明的，要跟它後面的頁面合成才是眼睛看到的顏色。
  const page = parse(getComputedStyle(document.body).backgroundColor)
  const slab = parse(getComputedStyle(document.querySelector('.toast')).backgroundColor)
  const bg = { r: slab.r*slab.a + page.r*(1-slab.a),
               g: slab.g*slab.a + page.g*(1-slab.a),
               b: slab.b*slab.a + page.b*(1-slab.a) }
  const fg = parse(getComputedStyle(el).color)
  const [hi, lo] = [lum(fg), lum(bg)].sort((a, z) => z - a)
  return {
    邊: getComputedStyle(el).borderTopWidth,
    高: Math.round(el.getBoundingClientRect().height),
    對比: +((hi + 0.05) / (lo + 0.05)).toFixed(2),
  }
})
ok(`「復原」不描邊了（一個框裡不再放第二個框）`, parseFloat(undo.邊) === 0)
ok(`但手指按得到：${undo.高}px`, undo.高 >= 44)
ok(`眼睛也讀得到：${undo.對比}:1`, undo.對比 >= 4.5)


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
ok('Esc 關掉對話框，空間沒有被結束', (await p.locator('.result-card').count()) === 0)
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
await p.locator('.sheet-bar .icon-btn').first().click(); await p.waitForTimeout(300)
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
// 面板沒有標題列（2026-09 起一張都沒有），但螢幕閱讀器聽得到的不能跟著少。
ok('沒有標題文字，但無障礙名稱還在',
   (await p.locator('.sheet-title').count()) === 0
   && (await p.locator('.sheet').getAttribute('aria-label')) === '加入空間')
// 面板貼合內容（不留空白），所以切頁時高度會變——但要變得夠小，而且**內容永遠
// 從面板頂端同一條線開始**（`.sheet-bar` 是固定 48px 的）。
const sheetH = async () => Math.round((await p.locator('.sheet').boundingBox()).height)
const bodyOffset = async () => {
  const s = await p.locator('.sheet').boundingBox()
  const b = await p.locator('.sheet-body').boundingBox()
  return Math.round(b.y - s.y)
}
const codeH = await sheetH()
const codeOffset = await bodyOffset()
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
// 並排的元件要對齊：輸入框的高度不能是字級的副產品。高度是 `--tap-lg`，但寫成
// `min-height`（2026-09 字級改 rem 之後）——寫死的話字放大時框不會跟著長，字就
// 被夾住。**兩個孩子都用 `align-self: stretch`，不用 `height: 100%`**：外框變成
// 不定高之後百分比對不上它，那顆「加入」會掉回自己的 48px。

ok('代碼框與「加入」等高，而且填滿那個框', await p.evaluate(() => {
  const row = document.querySelector('.sheet .code-row').getBoundingClientRect()
  const input = document.querySelector('.sheet .code-row .code-input').getBoundingClientRect()
  const join = document.querySelector('.sheet .code-row .btn').getBoundingClientRect()
  return Math.abs(input.height - join.height) <= 1 && row.height - input.height <= 3
}))
/*
 * return 鍵上寫的字（2026-09，iOS 評估 §2.3）。
 *
 * iOS 會依 `enterkeyhint` 換掉 return 鍵的字。**所以按下去必須真的發生那件事**
 * ——鍵上寫「前往」卻什麼都沒發生，比一顆普通的 return 鍵更糟：它承諾過。
 * 這裡驗的是那個承諾，不只是屬性有沒有寫上去。
 */
ok('代碼框的 return 鍵寫著「前往」', await p.getAttribute('.sheet .code-input', 'enterkeyhint') === 'go')

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
/*
  切到掃碼那一頁。**這一頁刻意比較高**：取景器該有多大由「好不好瞄」決定，
  「打一組代碼」與「拿相機對著一個東西」本來就不是同一種份量的事。所以這裡驗的
  不是「高度一樣」，是那三件真正的不變量——內容從同一條線開始、返回鍵不移動、
  而且再高也不會超過面板自己的 88vh 上限。
*/
await p.getByRole('button', { name: /QR/ }).click(); await p.waitForTimeout(900)
const scanH = await sheetH()
ok(`掃碼那一頁比較高，但沒有超過 88vh（${codeH} → ${scanH}）`,
   scanH > codeH && scanH <= Math.round(844 * 0.88))
ok('取景框是滿版寬的 4:3（裁掉的最少，看到的最接近真正被解碼的那一張）',
   await p.evaluate(() => {
     const f = document.querySelector('.scan-frame').getBoundingClientRect()
     return Math.abs(f.width / f.height - 4 / 3) < 0.02 && f.width > 340
   }))
ok('內容仍然從面板頂端同一條線開始（.sheet-bar 是固定高的）',
   (await bodyOffset()) === codeOffset)
ok('子頁有返回鍵（第一頁沒有，但那一列的高度一樣）',
   (await p.locator('.sheet-bar .icon-btn').count()) === 1)
ok('返回鍵沒有把那一列撐高',
   Math.round((await p.locator('.sheet-bar').boundingBox()).height) === 48)
await p.locator('.sheet-bar .icon-btn').click(); await p.waitForTimeout(400)
ok(`返回之後回到原來的高度（${await sheetH()}）`, Math.abs(await sheetH() - codeH) <= 1)

// 收起來的路：Esc（點面板外面與從握把往下滑是同一套，Sheet 已經在別處驗過）。
await p.keyboard.press('Escape'); await p.waitForTimeout(400)
ok('Esc 關得掉，背景也還回來了',
   (await p.locator('.sheet').count()) === 0
   && await p.evaluate(() => document.querySelector('.shell')?.hasAttribute('inert') === false))
ok('首頁清單每一列右邊都有一顆「更多」',
   (await p.getByRole('button', { name: /^更多：/ }).count()) === (await p.locator('.recent-item').count()))
ok('無障礙名稱說得出是哪一個空間',
   (await p.getByRole('button', { name: /^更多：秋季旅遊 · 出發$/ }).count()) === 1)
ok('列上那顆垃圾桶不見了（那件事搬進選單了）',
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
const homeRows = await p.locator('.sheet .sheet-item strong').allTextContents()
ok(`首頁那份是空間本身的事：${homeRows.join('、')}`,
   JSON.stringify(homeRows) === JSON.stringify(['建立副本', '封存', '刪除空間']))
ok('名單的事不在這裡（編輯、存成常用都不列）',
   (await p.locator('.sheet').getByRole('button', { name: /^編輯$|^存成常用$/ }).count()) === 0)
// 這一份的名字只在無障礙名稱裡（2026-09 標題列整套拿掉）：從一列七個長得差不多
// 的空間裡點開，聽得出「我剛剛按的是哪一間」。空間裡那一份相反（名字就在正上方的頂欄裡）。
ok('面板的無障礙名稱說得出是哪一個空間',
   (await p.locator('.sheet').getAttribute('aria-label')) === '秋季旅遊 · 出發')
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
  const rows = [...document.querySelectorAll('.sheet .sheet-item')]
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

// return 鍵（iOS 上寫著「完成」）唯一要做的事是把鍵盤收掉：結果是邊打邊出來的，
// 沒有第二件事可做。不接的話，收鍵盤的唯一辦法是點別的地方，而這個畫面上「別的
// 地方」就是名單列——點下去會直接把人標成已到。
await p.locator('input[type=search]').fill('陳'); await p.waitForTimeout(200)
ok('搜尋框的 return 鍵寫著「完成」',
   await p.getAttribute('input[type=search]', 'enterkeyhint') === 'done')
await p.locator('input[type=search]').press('Enter'); await p.waitForTimeout(250)
ok('按 Enter 收鍵盤，但字跟框都留著', await p.evaluate(() =>
     document.activeElement?.getAttribute('type') !== 'search')
   && await p.locator('input[type=search]').inputValue() === '陳'
   && (await p.locator('input[type=search]').count()) === 1)

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
const manageRows = await p.locator('.sheet .sheet-item strong').allTextContents()
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
ok('「更多」沒有標題列', (await p.locator('.sheet-title').count()) === 0)
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

await swipe('.sheet-bar', 30)
ok('往下滑一點點不會收起來（手指抖一下不該關掉面板）', (await p.locator('.sheet').count()) === 1)
await swipe('.sheet-bar', 130)
ok('從握把往下滑收得起來', (await p.locator('.sheet').count()) === 0)

// 那一條是整列的手勢區，不只中間那 38px 的線——面板靠它收起來，而 38px 對一根
// 手指來說太窄。從最左邊往下拖也要收得起來。
await reopen()
const gripBox = await p.locator('.sheet-bar').boundingBox()
ok(`那一列整條都吃得到手勢（寬 ${Math.round(gripBox.width)}px、高 ${Math.round(gripBox.height)}px）`,
   gripBox.width > 300 && gripBox.height >= 48)
await p.mouse.move(gripBox.x + 24, gripBox.y + gripBox.height / 2); await p.mouse.down()
for (let i = 1; i <= 6; i++) {
  await p.mouse.move(gripBox.x + 24, gripBox.y + gripBox.height / 2 + (130 * i) / 6)
  await p.waitForTimeout(20)
}
await p.mouse.up(); await p.waitForTimeout(500)
ok('從握把最左邊往下滑也收得起來', (await p.locator('.sheet').count()) === 0)

// 先動到橫向的就不是「把面板推回去」，手勢要把這一次讓出去。
await reopen()
await swipe('.sheet-bar', 0, 120)
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
   await p.locator('.sheet .sheet-item').last().isVisible())
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
// 主題／語言各是一張子畫面（2026-09 從就地展開改過來）：點那一列進去、
// 選了選項自己返回，所以切回中文前要用英文的「Language」字樣重新進去。
await p.getByRole('button',{name:/語言/}).click(); await p.waitForTimeout(300)
await p.getByRole('button',{name:/English/}).click(); await p.waitForTimeout(600)
ok('切成英文後 lang=en', (await p.evaluate(() => document.documentElement.lang)) === 'en')
await p.getByRole('button',{name:/Language/}).click(); await p.waitForTimeout(300)
await p.getByRole('button',{name:/中文/}).click(); await p.waitForTimeout(600)
ok('切回中文後 lang=zh-TW', (await p.evaluate(() => document.documentElement.lang)) === 'zh-TW')
ok('選了選項後自己返回那份清單', (await p.locator('.sheet .segmented').count()) === 0
   && (await p.locator('.sheet .sheet-item').count()) > 0)
await p.keyboard.press('Escape'); await p.waitForTimeout(400)

// 掃描端：單機模式下用代碼加入別人的空間，錯的不是代碼，是這個站台沒有雲端。
// 講「找不到這個代碼。請確認有沒有打錯」會讓人重打三次，而主揪正在數人頭。
await p.evaluate(() => { window.location.hash = '#/j/ZZZZZZ' }); await p.waitForTimeout(1500)
// 失敗訊息掛 .note-error（2026-09 配色重構）：加不進去是「做不到」，不是「先跟你說一聲」。
const joinMsg = ((await p.locator('.note-error').textContent().catch(() => '')) ?? '').trim()
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
/*
 * 「從清單移除」2026-09 底換成「封存」，而且**搬出「刪除空間」**。
 *
 * 它們本來並排在同一張子畫面上，理由是「按下去的當下想的是同一件事」。那不
 * 成立：封存什麼都沒動、隨時拿得回來，刪除是所有人的紀錄一起沒。把可逆的東西
 * 擺在不可逆的旁邊，只會讓人在按之前多猶豫一次。
 *
 * 所以選單上是三列，而「刪除空間」直接跳確認對話框，不再多一層子畫面。
 */
const roomMenu = await p.locator('.sheet .sheet-item strong').allTextContents()
ok(`空間選單三列：${roomMenu.join('、')}`,
   JSON.stringify(roomMenu) === JSON.stringify(['建立副本', '封存', '刪除空間']))

/*
 * 封存（2026-09，取代「從清單移除」）。
 *
 * 使用者的原話是「刪掉後變得只有別人看得到，自己看不到很怪」。舊那顆會把**本機
 * 快照一起刪掉**，所以那間空間要回來得重新有代碼——對協助者來說就是按一下就
 * 拿不回來了。
 *
 * 所以這裡驗的三件事，每一件都是舊做法沒有的：
 *   1. 封存之後那間空間**還打得開**，名單與已到狀態都在（什麼都沒刪）。
 *   2. 首頁找得到它（第四顆分段只在有封存時出現）。
 *   3. 走進去就自動取消封存——人都在裡面點名了，「不想看到它」就不成立了。
 */
await p.keyboard.press('Escape'); await p.waitForTimeout(400)
await p.getByRole('button', { name: /^更多：確認對話框測試$/ }).click(); await p.waitForTimeout(600)
await p.getByRole('button', { name: /^封存$/ }).click(); await p.waitForTimeout(800)
ok('封存之後它離開首頁清單',
   !(await p.locator('.recent-name').allTextContents()).includes('確認對話框測試'))
ok('而且不需要確認對話框（它可逆，什麼都沒動）',
   (await p.locator('[role=alertdialog]').count()) === 0)
const segs = await p.locator('.segmented button').allTextContents()
ok(`篩選列長出第四顆：${segs.join('、')}`, segs.includes('封存'))
await p.getByRole('button', { name: /^封存$/ }).click(); await p.waitForTimeout(600)
ok('封存那一頁找得到它',
   (await p.locator('.recent-name').allTextContents()).includes('確認對話框測試'))

// 打得開，而且資料都在——舊的「從清單移除」會把本機快照刪掉。
await p.getByText('確認對話框測試').first().click(); await p.waitForTimeout(1600)
ok('封存之後那間空間照樣打得開（快照沒有被刪）',
   (await p.locator('.topbar-name').textContent()) === '確認對話框測試'
   && (await p.locator('.member').count()) > 0)
await p.goto(URL); await p.waitForTimeout(900)
ok('走進去就自動取消封存，回首頁看得到它',
   (await p.locator('.recent-name').allTextContents()).includes('確認對話框測試')
   && !(await p.locator('.segmented button').allTextContents()).includes('封存'))

// 回到選單，底下那幾條驗的是刪除的確認對話框。
await p.getByRole('button', { name: /^更多：確認對話框測試$/ }).click(); await p.waitForTimeout(600)
await p.locator('.sheet').getByRole('button',{name:/^刪除空間/}).click(); await p.waitForTimeout(500)
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
const closedResult = (await p.locator('.result-card-text').textContent()) ?? ''
ok(`結束後印的是定格結果卡片：「${closedResult}」`,
   closedResult.includes('已結束') && closedResult.includes('1 / 3'))
// 結束之後那三顆要留著：真正需要那份 CSV 的人（教會辦公室、隔天的行政）是在
// 事情結束之後才想起來的，而「匯出名單」那條路已經不在了。
const resultActions = (await p.locator('.result-card .btn').allTextContents()).map((x) => x.trim())
ok(`結束後兩種格式都還在：${resultActions.join('、')}`,
   JSON.stringify(resultActions) === JSON.stringify(['複製', 'CSV']))
ok('結束後戳名字沒有作用', await p.locator('.member-main').first().isDisabled())
ok('頂欄說得出已關閉', (await p.locator('.topbar-count.closed').count()) === 1)

// --- 系統返回手勢（2026-09）---
// 面板與它的子畫面各是一格歷史紀錄。iOS 的邊緣右滑、Android 的實體返回鍵都走
// popstate，而在加到主畫面的 PWA 裡右滑是**唯一**的返回操作——沒有接上的話，
// 在面板上右滑會直接退出空間。
await p.goto(URL); await p.waitForTimeout(800)
await p.locator('.recent-item').first().click(); await p.waitForTimeout(1300)
const inRoom = await p.evaluate(() => location.hash)
await p.locator('.topbar button[aria-label="更多"]').click(); await p.waitForTimeout(500)
await p.goBack(); await p.waitForTimeout(400)
ok('面板上返回＝關掉面板，不是離開空間',
   (await p.locator('.sheet').count()) === 0 && (await p.evaluate(() => location.hash)) === inRoom)

await p.locator('.topbar button[aria-label="更多"]').click(); await p.waitForTimeout(400)
await p.getByRole('button', { name: /^邀請點名$/ }).click(); await p.waitForTimeout(500)
await p.goBack(); await p.waitForTimeout(400)
ok('子畫面上返回＝回上一頁，面板還在',
   (await p.locator('.sheet').count()) === 1
   && (await p.locator('.sheet-bar button[aria-label="返回"]').count()) === 0)
await p.goBack(); await p.waitForTimeout(400)
ok('再返回才關掉面板，空間還在',
   (await p.locator('.sheet').count()) === 0 && (await p.evaluate(() => location.hash)) === inRoom)

// 程式自己關掉（Esc）要把那一格吃回來，否則歷史裡會留一格按了沒反應的空白。
await p.locator('.topbar button[aria-label="更多"]').click(); await p.waitForTimeout(400)
await p.keyboard.press('Escape'); await p.waitForTimeout(400)
await p.goBack(); await p.waitForTimeout(500)
ok('Esc 關掉面板不會在歷史留空格（返回直接離開空間）',
   (await p.evaluate(() => location.hash)) !== inRoom)

// --- 設定 ---
await p.keyboard.press('Escape'); await p.waitForTimeout(300)
await p.goto(URL); await p.waitForTimeout(800)
await p.locator('button[aria-label="設定"]').click(); await p.waitForTimeout(500)
// 標題列整條不要（2026-09）：「設定」兩個字說不出這裡做得到的任何一件事，
// 而底下四列自己就說得完。無障礙名稱還是「設定」。
ok('設定面板沒有標題列', (await p.locator('.sheet-title').count()) === 0)
ok('但無障礙名稱還是「設定」', (await p.locator('.sheet').getAttribute('aria-label')) === '設定')
ok('沒有震動回饋這個設定了', (await p.getByText('震動回饋').count()) === 0)

// 設定頁是四列長得一樣的面板列：暱稱、帳戶、主題、語言（2026-09）。單機模式
// 沒有雲端，帳戶那一列整列不出現——不給一個按了只會說「還沒設定雲端」的入口。
const rows = await p.locator('.sheet .sheet-item strong').allTextContents()
ok(`設定頁的每一列：${rows.join('、')}`,
   JSON.stringify(rows) === JSON.stringify(['暱稱', '主題', '文字大小', '點名提示', '語言']))
ok('單機模式沒有帳戶那一列', (await p.getByText('帳戶').count()) === 0)

// 收合時右邊印著目前的值，不展開也看得到自己設了什麼。
const shown = await p.locator('.sheet .sheet-item-value').allTextContents()
ok(`每一列都印著目前的值：${shown.join('、')}`,
   shown[0] === '未填寫' && shown[1] === '跟隨系統' && shown[2] === '標準'
   && shown[3] === '顯示' && shown[4] === '中文')

// 暱稱是一張子畫面（2026-09）：清單上只有值，進去才有輸入框，回來就看得到。
ok('清單上沒有輸入框', (await p.locator('#checker-name').count()) === 0)
await p.getByRole('button', { name: /^暱稱/ }).click(); await p.waitForTimeout(400)
ok('進到子畫面才有輸入框', await p.locator('#checker-name').isVisible())
ok('子畫面上那份清單不在了', (await p.locator('.sheet .sheet-item').count()) === 0)
ok('子畫面有返回鍵', (await p.locator('.sheet-bar button[aria-label="返回"]').count()) === 1)

/*
 * 輸入框是**凹槽**，不是描邊的框（2026-09）。
 *
 * 規範自己寫著「凹槽不描邊——填色已經定義形狀了，再描一條只是把同一件事說第二
 * 次」。所以驗兩件事：平常沒有看得見的邊（底色自己說話），對焦時那條邊染成
 * accent 並長出光暈——**而且不位移**，因為邊一直都在，只是透明的。
 */
const groove = await p.evaluate(() => {
  const el = document.querySelector('#checker-name')
  // 這一頁開起來焦點就在輸入框上（面板會把焦點送給第一個可聚焦的東西），
  // 所以要先讓它失焦，量到的才是「平常」的樣子。
  el.blur()
  /* `getComputedStyle` 回的是**活的**物件：對焦之後同一個參照會跟著變。
     所以要先把值抄下來，不能留著參照等一下再讀。 */
  const snap = () => { const cs = getComputedStyle(el)
    return { bg: cs.backgroundColor, border: cs.borderTopColor, shadow: cs.boxShadow } }
  const idle = snap()
  const before = el.getBoundingClientRect().height
  el.focus()
  const on = snap()
  return {
    底是凹槽: idle.bg !== getComputedStyle(document.querySelector('.sheet')).backgroundColor,
    平常沒有邊: /rgba\(0, 0, 0, 0\)|transparent/.test(idle.border),
    對焦有邊: !/rgba\(0, 0, 0, 0\)|transparent/.test(on.border),
    對焦有光暈: on.shadow !== 'none',
    高度沒變: Math.abs(el.getBoundingClientRect().height - before) < 0.5,
  }
})
ok('輸入框是凹槽：平常沒有看得見的邊', groove.平常沒有邊 && groove.底是凹槽)

/*
 * 標籤收進輸入框裡（2026-09）。三件事要一起成立，少一件這個做法就不該留：
 *
 * 1. 畫面上不再重複印一次「暱稱」（你是點那一列進來的）。
 * 2. **但欄位仍然有可靠的無障礙名稱** —— `<label>` 還在，只是 `.sr-only`。
 *    規範擋的是「沒有名稱」，放行的只是看得見的那一份。
 * 3. placeholder 讀得出來：它現在扛的是「這一格是什麼」，所以要過內文的 4.5:1。
 *    （以前沒有設定過 ::placeholder，用瀏覽器預設灰，深色只有 3.27:1。）
 */
const nameField = await p.evaluate(() => {
  const el = document.querySelector('#checker-name')
  const lab = document.querySelector('label[for="checker-name"]')
  const parse = (c) => { const m = c.match(/rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?\)/)
    return m ? { r:+m[1], g:+m[2], b:+m[3], a: m[4]===undefined?1:+m[4] } : null }
  const lum = ({ r, g, b }) => { const f = (v) => { v/=255; return v<=0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4) }
    return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b) }
  const ph = getComputedStyle(el, '::placeholder')
  const bg = parse(getComputedStyle(el).backgroundColor)
  const fg0 = parse(ph.color)
  const fg = { r: fg0.r*fg0.a+bg.r*(1-fg0.a), g: fg0.g*fg0.a+bg.g*(1-fg0.a), b: fg0.b*fg0.a+bg.b*(1-fg0.a) }
  const [hi, lo] = [lum(fg), lum(bg)].sort((a, z) => z - a)
  return {
    看不見的標籤還在: Boolean(lab) && lab.getBoundingClientRect().width <= 1,
    // 用「有沒有一顆看得見的 .label」來判，不用比對文字：`.sr-only` 是**裁切**
    // 不是 display:none，它的字仍然在 innerText 裡——那是刻意留給螢幕閱讀器的。
    畫面上沒有重複的標題: document.querySelectorAll('.sheet .label').length === 0,
    placeholder: el.placeholder,
    對比: +((hi + 0.05) / (lo + 0.05)).toFixed(2),
  }
})
ok(`空的時候由 placeholder 說「${nameField.placeholder}」，畫面不再重複印標題`,
   /暱稱/.test(nameField.placeholder) && nameField.畫面上沒有重複的標題)
ok('但 <label> 還在（只是看不見），欄位仍然有無障礙名稱', nameField.看不見的標籤還在)
ok(`placeholder 讀得出來：${nameField.對比}:1（內文門檻 4.5）`, nameField.對比 >= 4.5)
ok('對焦時邊染成 accent、長出光暈，而且高度不變',
   groove.對焦有邊 && groove.對焦有光暈 && groove.高度沒變)

await p.locator('#checker-name').fill('陳姐')
await p.locator('#checker-name').blur(); await p.waitForTimeout(300)
await p.locator('.sheet-bar button[aria-label="返回"]').click(); await p.waitForTimeout(400)
ok('回到清單就看得到剛填的暱稱',
   (await p.locator('.sheet .sheet-item-value').first().textContent()) === '陳姐')

// 每一列都是子畫面，所以不再有「一次只開一列」這回事——進去只會看到那一件事。
await p.getByRole('button', { name: /^主題/ }).click(); await p.waitForTimeout(400)
ok('主題子畫面只有那一組選項', (await p.locator('#checker-name').count()) === 0
   && (await p.locator('.sheet .segmented').count()) === 1
   && (await p.locator('.sheet .sheet-item').count()) === 0)
await p.locator('.sheet-bar button[aria-label="返回"]').click(); await p.waitForTimeout(400)

/*
 * 文字大小（2026-09）。
 *
 * **它是倍率，不是字級。** 驗的是三件事，而第二件是整個功能的成立條件：
 *
 * 1. 選了字真的變大（--fs-scale 乘進七階）。
 * 2. **根字級一格都沒有動。** 根字級是系統設定（Dynamic Type／瀏覽器預設字級）
 *    的落點；這顆鍵一旦改到它，就等於把系統設定吃掉——那正是 iOS 評估 §1.1
 *    花一整輪修掉的東西。所以「有沒有變大」不夠，還要驗「變大的不是它」。
 * 3. 關掉再打開還記得。
 */
await p.getByRole('button', { name: /^文字大小/ }).click(); await p.waitForTimeout(400)
const fontAt = () => p.evaluate(() => ({
  scale: getComputedStyle(document.documentElement).getPropertyValue('--fs-scale').trim(),
  root: getComputedStyle(document.documentElement).fontSize,
  // 量分段控制上的字（那一頁的說明 2026-09 拿掉了）。它走 --fs-3，
  // 跟其他字級一樣吃得到倍率。
  sample: getComputedStyle(document.querySelector('.sheet .segment')).fontSize,
}))
const fontBase = await fontAt()
ok(`預設是標準（倍率 ${fontBase.scale}，根字級 ${fontBase.root}）`,
   fontBase.scale === '1' && (await p.evaluate(() => document.documentElement.hasAttribute('data-font'))) === false)

await p.getByRole('button', { name: /^特大$/ }).click(); await p.waitForTimeout(500)
const fontXl = await fontAt()
ok(`選「特大」字就變大：${fontBase.sample} → ${fontXl.sample}`,
   parseFloat(fontXl.sample) > parseFloat(fontBase.sample) * 1.2)
ok(`但根字級一格都沒動（${fontBase.root} → ${fontXl.root}）——系統設定沒有被吃掉`,
   fontXl.root === fontBase.root)
ok('選了不會自己返回（放大字級要看著結果調）',
   (await p.locator('.sheet .segmented').count()) === 1)

await p.reload(); await p.waitForTimeout(900)
ok('關掉重開還記得',
   (await p.evaluate(() => document.documentElement.getAttribute('data-font'))) === 'xl')

// 調回標準，免得後面的檢查都在放大的版面上跑。
await p.locator('button[aria-label="設定"]').click(); await p.waitForTimeout(500)
await p.getByRole('button', { name: /^文字大小/ }).click(); await p.waitForTimeout(400)
await p.getByRole('button', { name: /^標準$/ }).click(); await p.waitForTimeout(500)
ok('調回標準就把屬性拿掉（預設狀態下 DOM 上一個字都不多）',
   (await p.evaluate(() => document.documentElement.hasAttribute('data-font'))) === false)

/*
 * 點名提示可以關掉（2026-09）。
 *
 * **這一顆的重點在「範圍」。** 它擋的只有點名那一個 Toast（`setStatusWithUndo`）
 * ——那是每點一個人跳一次、40 個人就 40 次的那個。錯誤訊息、同步衝突、複製結果
 * 那幾種**不能跟著關掉**：它們一場活動出現一兩次，而且是使用者需要知道的事。
 * 一個總開關會把錯誤訊息一起關掉，那是這條檢查在守的東西。
 *
 * 關掉之後仍然改得回來（再點一次那個人），失去的是「知道剛剛動到的是誰」。
 */
await p.locator('.sheet-bar button[aria-label="返回"]').click(); await p.waitForTimeout(400)
await p.getByRole('button', { name: /^點名提示/ }).click(); await p.waitForTimeout(400)
await p.getByRole('button', { name: /^不顯示$/ }).click(); await p.waitForTimeout(500)
await p.keyboard.press('Escape'); await p.waitForTimeout(400)

// 自己開一間：這一段前面那些空間有的已經結束點名了，名單列會是停用的。
await p.goto(URL); await p.waitForTimeout(700)
await p.getByRole('button', { name: /創建空間/ }).first().click(); await p.waitForTimeout(400)
await p.locator('#room-name').fill('點名提示測試')
await p.locator('#roster-text').fill('王小明\n李美花\n張三')
await p.waitForTimeout(300)
await p.getByRole('button', { name: /產生名單/ }).click(); await p.waitForTimeout(600)
await p.getByRole('button', { name: /建立/ }).click(); await p.waitForTimeout(1500)
const beforeTap = await p.locator('.member').first().getAttribute('class')
await p.locator('.member-main').first().click(); await p.waitForTimeout(900)
ok('關掉之後點名不跳提示', (await p.locator('.toast').count()) === 0)
ok('但那個人確實被標記了（關的是提示，不是功能）',
   (await p.locator('.member').first().getAttribute('class')) !== beforeTap)
await p.locator('.member-main').first().click(); await p.waitForTimeout(900)
ok('再點一次仍然改得回來（復原這條路沒有斷）',
   (await p.locator('.member').first().getAttribute('class')) === beforeTap)

// 別的 Toast 不受影響——這是這個設定能成立的前提。
await p.locator('.topbar button[aria-label="更多"]').click(); await p.waitForTimeout(500)
await p.getByRole('button', { name: /^編輯$/ }).click(); await p.waitForTimeout(600)
await p.locator('.dock').getByRole('button').first().click(); await p.waitForTimeout(600)
await p.locator('.sheet textarea, .sheet input.input').first().fill('臨時來的人')
await p.waitForTimeout(300)
await p.locator('.sheet .btn-primary').first().click(); await p.waitForTimeout(1000)
ok('但錯誤訊息那一類的 Toast 沒有跟著關掉（臨時加人的確認照樣跳）',
   (await p.locator('.toast').count()) === 1)
await p.keyboard.press('Escape'); await p.waitForTimeout(400)

// 調回「顯示」，後面的檢查都靠那個 Toast。
await p.goto(URL); await p.waitForTimeout(800)
await p.locator('button[aria-label="設定"]').click(); await p.waitForTimeout(500)
await p.getByRole('button', { name: /^點名提示/ }).click(); await p.waitForTimeout(400)
await p.getByRole('button', { name: /^顯示$/ }).click(); await p.waitForTimeout(500)

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

/*
 * 名單容器：連續的未到收成一張卡片（2026-09，iOS 評估 §1.3 的 C 方向）。
 *
 * 兩件事要一起成立，少一件這個方向就不該留下：
 *
 * 1. **每個人固定佔 66px，點誰都不會動到別人的位置。** 第一版只收未到與未到
 *    之間的縫，於是每點掉一個人就多開一道 8px——由上往下點六個，名單最底下的
 *    人往下跑 48px。**點名這個動作把還沒點到的人一直往下推**，而「位置不能
 *    跳動」是這個專案的第一條現場前提。所以間距改成不分狀態一律收掉。
 * 2. 卡片的邊界＝狀態的邊界：一段連續的未到是一張卡片，已到的列退出卡片。
 */
const pitch = await p.evaluate(() => {
  const r = [...document.querySelectorAll('.member')].slice(0, 4).map((e) => e.getBoundingClientRect())
  return [r[1].top - r[0].top, r[2].top - r[1].top, r[3].top - r[2].top]
})
ok(`每個人固定佔 ${pitch[0]}px（原本 74px：66 的列高＋8 的縫）`,
   pitch.every((d) => Math.abs(d - pitch[0]) <= 0.5 && d < 70))

const anchorBefore = await p.evaluate(() =>
  document.querySelectorAll('.member')[9].getBoundingClientRect().top)
for (let i = 0; i < 4; i++) {
  await p.locator('.member-main').nth(i).click(); await p.waitForTimeout(350)
}
const anchorAfter = await p.evaluate(() =>
  document.querySelectorAll('.member')[9].getBoundingClientRect().top)
ok(`點掉 4 個人之後，第 10 個人一格都沒有動（漂移 ${Math.round(anchorAfter - anchorBefore)}px）`,
   Math.abs(anchorAfter - anchorBefore) <= 1)

const grouping = await p.evaluate(() => {
  const rows = [...document.querySelectorAll('.member')]
  const arrived = rows.filter((e) => e.classList.contains('is-arrived'))
  // 已到退出卡片：底透出頁面、邊透明。
  const out = arrived.every((e) => {
    const cs = getComputedStyle(e)
    return /rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor)
      && /rgba\(0, 0, 0, 0\)|transparent/.test(cs.borderTopColor)
  })
  // 一段連續的未到裡，中間那幾列的上角是平的（併進上一列），而且有髮絲線。
  const pend = rows.filter((e) => !e.classList.contains('is-arrived'))
  const mid = pend.find((e) => {
    const prev = e.previousElementSibling
    return prev?.classList.contains('member') && !prev.classList.contains('is-arrived')
  })
  if (!mid) return { out, run: false, single: false }
  const cs = getComputedStyle(mid)
  const line = getComputedStyle(mid, '::before')
  /*
   * **一個接縫只能有一條線。**
   *
   * 上一列的 `border-bottom` 與這一列的髮絲線會落在同一個位置——兩條都留的話
   * 疊出 2px 的雙線，而且上面那條滿版、下面那條從 48px 才開始，寬度還不一樣。
   * 那正是「名單上莫名有兩條線」的成因。所以整段裡不是最後一列的那幾列，
   * 下緣不畫，接縫交給下一列那條縮排的髮絲線。
   */
  const above = getComputedStyle(mid.previousElementSibling)
  return {
    out,
    run: parseFloat(cs.borderTopLeftRadius) === 0
      && parseFloat(line.borderTopWidth) >= 1
      // 髮絲線從文字起點開始，不整條貫穿（讓開前面那顆圈圈）。
      && parseFloat(line.left) >= 40,
    // 這一列的上緣與上一列的下緣都不畫，接縫上就只剩那條髮絲線。
    single: /rgba\(0, 0, 0, 0\)|transparent/.test(above.borderBottomColor)
      && /rgba\(0, 0, 0, 0\)|transparent/.test(cs.borderTopColor),
  }
})
ok('已到的列退出卡片，直接坐在頁面上', grouping.out)
ok('連續的未到收成一張卡片：中間的角是平的，接縫是一條讓開圈圈的髮絲線', grouping.run)
ok('而且一個接縫只有那一條線（上一列的下緣不重複畫）', grouping.single)
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
