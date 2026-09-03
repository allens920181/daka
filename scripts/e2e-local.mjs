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
const segCount = async (name) => ((await p.getByRole('button', { name }).first().textContent()) || '').replace(/\D/g, '')

await p.goto(URL); await p.waitForTimeout(1200)
ok('首頁載入', await p.locator('.home-title').isVisible())
ok('顯示單機模式提示', (await p.locator('.banner-muted').count()) > 0)


// 開空間
await p.getByRole('button', { name: /開啟空間/ }).first().click()
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
const previewRows = await p.locator('.preview-row').count()
ok(`解析預覽 ${previewRows} 列（標題行也算一人，共 9）`, previewRows === 9)

// #4 解析器刻意不猜「秋季旅遊報名」是不是人名，但預覽以前只給看不給改——猜錯
// 的那幾列會一路留到現場與紙本，變成永遠不會被打勾的幽靈成員，於是「還有 N
// 位沒到」永遠歸不了零。每一列現在都拿得掉，而且文字才是唯一的真相。
ok('第一列是被誤判成人的標題行',
   (await p.locator('.preview-row').first().textContent())?.includes('秋季旅遊報名'))
await p.locator('.preview-row').first().locator('.preview-remove').click()
await p.waitForTimeout(400)
ok('移除之後預覽剩 8 列', (await p.locator('.preview-row').count()) === 8)
ok('移除是去改文字，不是只改預覽',
   !((await p.locator('#roster-text').inputValue()).includes('秋季旅遊報名')))
ok('其他人一個都沒少',
   (await p.locator('#roster-text').inputValue()).includes('王小明')
   && (await p.locator('#roster-text').inputValue()).includes('陳怡君'))
// 復原：把它加回去，讓後面的斷言仍然跑在 9 個人的名單上。
await p.locator('#roster-text').fill('秋季旅遊報名\n' + await p.locator('#roster-text').inputValue())
await p.waitForTimeout(400)
ok('補回去之後又是 9 列', (await p.locator('.preview-row').count()) === 9)
ok('同名警告出現', await p.locator('.note-warn').first().isVisible())


await p.getByRole('button', { name: /建立/ }).click()
await p.waitForTimeout(1200)
ok('進入空間', await p.locator('.topbar-name').isVisible())
// 搜尋框一直開在頂欄裡，但一進房間不該自動搶走焦點跳出鍵盤——那不是使用者
// 剛做出的明確動作。
ok('搜尋框在，但沒有自動聚焦', (await p.locator('.topbar .search-wrap input[type=search]').count()) === 1
   && await p.evaluate(() => document.activeElement?.getAttribute('type') !== 'search'))
const code = (await p.locator('.topbar-sub .mono').first().textContent())?.trim()
ok(`取得 6 碼代碼: ${code}`, /^[2-9A-HJ-KM-NP-Z]{6}$/.test(code || ''))
// 9 列（標題行上面補了回去）扣掉請假的陳大同 → 8 個沒到。分段控制的三個數字
// 必須自己加得起來：未到 8 ＋ 已到 0 ＋ 請假 1 ＝ 全部 9。
ok('未到 8（9 列，陳大同請假不算）', (await missing()) === '8')
// 44px 的數字旁邊只補單位，不把同一個數字再寫一次。
ok('分段的數字加得起來', Number(await missing()) + Number(await segCount(/^已到/)) + Number(await segCount(/^請假/))
   === Number(await segCount(/^全部/)))
ok('請假的人自己一段，不混在未到裡', (await segCount(/^請假/)) === '1')


// 點名
await p.locator('.member-main').nth(1).click()
await p.waitForTimeout(500)
ok('點名後未到 = 7', (await missing()) === '7')
ok('該列變成已到', (await p.locator('.member').nth(1).getAttribute('class'))?.includes('is-arrived'))
ok('出現復原提示', await p.locator('.toast').isVisible())


// 復原
await p.locator('.toast-action').click()
await p.waitForTimeout(500)
ok('復原後未到回到 8', (await missing()) === '8')

// 篩選
await p.locator('.member-main').nth(0).click(); await p.waitForTimeout(300)
await p.locator('.member-main').nth(2).click(); await p.waitForTimeout(300)
await p.getByRole('button', { name: /^已到/ }).click(); await p.waitForTimeout(300)
ok('已到篩選顯示 2 人', (await p.locator('.member').count()) === 2)
await p.getByRole('button', { name: /^未到/ }).click(); await p.waitForTimeout(300)
ok('未到篩選顯示 6 人', (await p.locator('.member').count()) === 6)
await p.getByRole('button', { name: /^全部/ }).click(); await p.waitForTimeout(300)

// 搜尋。搜尋框住在頂欄（sticky），一直顯示，不必先點才展開。
await p.locator('input[type=search]').fill('陳怡君'); await p.waitForTimeout(300)
ok('搜尋同名找到 2 人', (await p.locator('.member').count()) === 2)
await p.locator('input[type=search]').fill('0912'); await p.waitForTimeout(300)
// 電話已經不是解析出來的欄位（號碼原文躺在備註裡），搜尋要照樣找得到人。
ok('可用電話搜尋（號碼現在在備註裡）', (await p.locator('.member').count()) === 1)

// 收尾時單手打錯字：切「未到」再搜一個不存在的名字。這裡絕對不能回答
// 「太好了，全部都到了」——那句話在車門口等於「可以關門了」。
await p.getByRole('button', { name: /^未到/ }).click(); await p.waitForTimeout(200)
await p.locator('input[type=search]').fill('王大明'); await p.waitForTimeout(300)
const typoEmpty = (await p.locator('.empty-big').textContent())?.trim()
ok(`搜尋打錯字時說「沒找到」而不是「全部都到了」：${typoEmpty}`, typoEmpty === '這裡沒有人')
ok('並附上「換個字再找找」的下一步', ((await p.locator('.empty .hint').textContent()) || '').includes('換個字'))
await p.locator('input[type=search]').fill(''); await p.waitForTimeout(300)
ok('清掉搜尋後「未到」篩選才回到成功文案',
   (await p.locator('.empty-big').count()) === 0 || (await p.locator('.empty-big').textContent())?.includes('全部都到了'))
await p.getByRole('button', { name: /^全部/ }).first().click(); await p.waitForTimeout(300)

// 撥號。解析器不再判斷任何一串數字是什麼——「匯款 700-1234567」曾經被抽成
// 一支撥出去是空號的假電話，而畫面上沒有一個字說得出為什麼。號碼現在原文留在
// 備註裡，撥號鍵長在成員面板（顯示層猜錯是可逆、可見的；資料層猜錯不是）。
ok('名單列上沒有撥號鍵了', (await p.locator('.member a[href^="tel:"]').count()) === 0)

await p.locator('.member').filter({ hasText: '王小明' }).first()
  .getByRole('button', { name: /管理|manage/ }).click()
await p.waitForTimeout(400)
const telHref = await p.locator('a[href^="tel:"]').first().getAttribute('href')
ok(`成員面板把備註裡的號碼做成撥號鍵 ${telHref}`, telHref === 'tel:0912345678')
ok('並標明它是備註裡的號碼',
   ((await p.locator('a[href^="tel:"] .sub').first().textContent()) ?? '').includes('備註'))
await p.keyboard.press('Escape'); await p.waitForTimeout(400)

// 分享（單機模式）——這裡是關鍵：這個建置沒有雲端，代碼、QR、連結對任何人
// 都沒有用。發出去只會讓五個同工站在車門口看到「找不到這個代碼」，然後以為
// 是自己打錯而重打三次。分享面板必須當場說出來，不能照樣印 QR。
await p.locator('.topbar button[aria-label="分享"]').click(); await p.waitForTimeout(1500)
ok('單機模式：面板標題改成「這個空間只有你看得到」',
   (await p.locator('.sheet-title').textContent())?.includes('只有你看得到'))
ok('單機模式：不發代碼', (await p.locator('.code-display').count()) === 0)
ok('單機模式：不產 QR', (await p.locator('.qr-card img').count()) === 0)
ok('單機模式：不給「複製連結」', (await p.getByRole('button', { name: /傳給別人|複製連結/ }).count()) === 0)
ok('單機模式：講清楚別人會看到什麼',
   ((await p.locator('.note-warn').textContent()) || '').includes('找不到這個代碼'))

await p.keyboard.press('Escape'); await p.waitForTimeout(400)
ok('Esc 關閉面板', (await p.locator('.sheet').count()) === 0)

// ---- 現場操作：同名辨識、未分組、臨時加人、刪除確認 ----
await p.goto(URL); await p.waitForTimeout(900)
await p.getByRole('button',{name:/開啟空間/}).first().click(); await p.waitForTimeout(300)
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

// 「陳大同（請假）」：備註和狀態都是「請假」，畫面上只能出現一次。
const excusedRow = p.locator('.member.is-excused').first()
const excusedText = (await excusedRow.locator('.member-meta').textContent()) ?? ''
ok(`請假不重複印：「${excusedText.trim()}」`, (excusedText.match(/請假/g) || []).length === 1)

// 更多面板的狀態切換鍵不重複名單列已經做得到的事。「標記已到」在任何狀態下
// 都跟點名單列一樣（Room.tsx 的 toggle()），所以完全不留；「改回未到」只有
// 從請假出發時才是唯一入口（點名單列只會跳去已到），這個狀態才留。
const pendingRow = p.locator('.member').filter({ hasText: '王小明' })
await pendingRow.getByRole('button', { name: /管理|manage/ }).click(); await p.waitForTimeout(400)
ok('未到狀態的更多面板沒有「標記已到」',
   (await p.getByRole('button', { name: /^標記已到$/ }).count()) === 0)
ok('未到狀態的更多面板沒有「改回未到」（本來就是未到）',
   (await p.getByRole('button', { name: /改回未到/ }).count()) === 0)
ok('未到狀態的更多面板有「標記請假」', await p.getByRole('button', { name: /標記請假/ }).isVisible())
await p.keyboard.press('Escape'); await p.waitForTimeout(400)

await excusedRow.getByRole('button', { name: /管理|manage/ }).click(); await p.waitForTimeout(400)
ok('請假狀態的更多面板沒有「標記已到」',
   (await p.getByRole('button', { name: /^標記已到$/ }).count()) === 0)
ok('請假狀態的更多面板有「改回未到」（點名單列只會跳去已到，這是唯一入口）',
   await p.getByRole('button', { name: /改回未到/ }).isVisible())
const missingBeforeRevert = await missing()
await p.getByRole('button', { name: /改回未到/ }).click(); await p.waitForTimeout(500)
ok(`「改回未到」真的讓人變回未到（${missingBeforeRevert} → ${await missing()}）`,
   Number(await missing()) === Number(missingBeforeRevert) + 1)

// 備註搬進「更多」面板：名單列上的 .chip-note 用 CSS 關掉（DOM 裡還在，紙本
// 要用），螢幕上看不到；點開「陳怡君」（備註是解析器抓到的電話號碼）的更多
// 面板才看得到原文。
const notedRow = dupRows.first()
ok('備註不再顯示在名單列上',
   !(await notedRow.locator('.chip-note').first().isVisible().catch(() => false)))
await notedRow.getByRole('button', { name: /管理|manage/ }).click()
await p.waitForTimeout(400)
ok('更多面板看得到備註原文（0912345678）',
   ((await p.locator('.sheet').textContent()) ?? '').includes('0912345678'))
await p.keyboard.press('Escape'); await p.waitForTimeout(400)

// 紙本是例外：手機沒電時拿著這張紙的人沒有「更多」可以點，.chip-note 要在
// @media print 裡換回來。
await p.emulateMedia({ media: 'print' }); await p.waitForTimeout(200)
ok('列印時備註換回來了', await notedRow.locator('.chip-note').first().isVisible())
ok('列印的備註是原文（0912345678）',
   ((await notedRow.locator('.chip-note').first().textContent()) ?? '').includes('0912345678'))
await p.emulateMedia({ media: 'screen' }); await p.waitForTimeout(200)

// #10 臨時加人：站在你面前的人不該被算成「未到」，而且要說一聲。
const beforeMissing = await missing()
await p.locator('.topbar button[aria-label="管理"]').click(); await p.waitForTimeout(500)
await p.getByRole('button',{name:/臨時加人/}).click(); await p.waitForTimeout(500)
await p.locator('#roster-text').fill('路上遇到的人'); await p.waitForTimeout(400)
await p.getByRole('button',{name:/加入名單/}).click(); await p.waitForTimeout(1200)
ok(`臨時加人不會讓未到數變多（${beforeMissing} → ${await missing()}）`, (await missing()) === beforeMissing)
const walkToast = (await p.locator('.toast-text').textContent().catch(() => '')) ?? ''
ok(`加完有說一聲：「${walkToast}」`, walkToast.includes('路上遇到的人') && walkToast.includes('已到'))

// #17 Toast 固定在下緣 88px（讓開底部動作列），但面板也是從下緣長上來的：
// Toast 於是落在選單列之間，實測蓋住「結束這一輪」49px，而且 .toast 是
// pointer-events: auto，那五秒內那一列按不下去。面板開著時要移到上緣的遮罩區。
await p.locator('.member-main').first().click(); await p.waitForTimeout(300)
await p.locator('.topbar button[aria-label="管理"]').click(); await p.waitForTimeout(500)
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

// #16 點名畫面沒有底部動作列，也沒有浮動搜尋鍵。兩個底部動作列槽位裝的是
// 「只看未到」（篩選搬進 sticky 頂欄之後變成重複的按鈕）與「複製結果」
// （一場活動按一次，搬進管理面板）；後來連接手它們的浮動搜尋鍵也拿掉了，
// 搜尋框直接一直開在頂欄裡，不必先點才展開。
ok('點名畫面沒有底部動作列', (await p.locator('.dock').count()) === 0)
ok('也沒有浮動搜尋鍵', (await p.locator('.fab').count()) === 0)
ok('搜尋框一直開在頂欄裡，不必點開',
   (await p.locator('.topbar .search-wrap input[type=search]').count()) === 1)
ok('分享仍在頂欄那顆圖示鍵', (await p.locator('.topbar button[aria-label="分享"]').count()) === 1)
ok('頂欄不再有放大鏡（搜尋只有一個入口）',
   (await p.locator('.topbar button[aria-label*="搜尋"]').count()) === 0)

// 高度與邊框要跟上下相鄰的控制項對齊——不是借來的通用 .input 樣式。
const searchInputBox = await p.locator('.search-wrap input[type=search]').boundingBox()
const iconBtnBox = await p.locator('.topbar button[aria-label="分享"]').boundingBox()
const segmentBox = await p.getByRole('button', { name: /^全部/ }).first().boundingBox()
ok(`搜尋框高度（${Math.round(searchInputBox.height)}px）跟圖示鍵（${Math.round(iconBtnBox.height)}px）／分段控制（${Math.round(segmentBox.height)}px）一致`,
   Math.abs(searchInputBox.height - iconBtnBox.height) <= 1 && Math.abs(searchInputBox.height - segmentBox.height) <= 1)

// Esc 現在只清掉搜尋字、把鍵盤收起，不是「關掉」——搜尋框本來就不會被關掉。
await p.locator('input[type=search]').fill('陳'); await p.waitForTimeout(200)
await p.locator('input[type=search]').press('Escape'); await p.waitForTimeout(200)
ok('Esc 清空搜尋字但搜尋框還在', await p.locator('input[type=search]').inputValue() === ''
   && (await p.locator('input[type=search]').count()) === 1)

// 複製結果搬進管理面板，排第一項。
await p.locator('.topbar button[aria-label="管理"]').click(); await p.waitForTimeout(500)
const firstItem = await p.locator('.menu .menu-item').first().textContent()
ok(`管理面板第一項是複製結果：「${(firstItem || '').trim().split('\n')[0]}」`,
   (firstItem || '').includes('複製結果'))
await p.keyboard.press('Escape'); await p.waitForTimeout(400)

// #36 刪除是唯一不可復原的動作，不能一按就沒。
await p.locator('.member').filter({ hasText: '王小明' }).locator('.icon-btn').last().click()
await p.waitForTimeout(500)
await p.getByRole('button',{name:/從名單移除/}).click(); await p.waitForTimeout(500)
ok('刪除前有確認對話框', (await p.locator('.dialog').count()) === 1)
ok('對話框指出更好的替代做法（標記請假）',
   ((await p.locator('.dialog').textContent()) || '').includes('標記請假'))
await p.getByRole('button',{name:/^取消$/}).click(); await p.waitForTimeout(400)
ok('取消之後人還在', (await p.locator('.member').filter({ hasText: '王小明' }).count()) === 1)
// 取消會退回成員面板（而不是整個關掉），這是對的——使用者本來就在那裡。
ok('取消後退回成員面板而不是全部關掉', (await p.locator('.sheet').count()) === 1)
await p.keyboard.press('Escape'); await p.waitForTimeout(400)

// #13 協助者要有地方寫上自己的名字，否則「誰點的」永遠是匿名。
await p.locator('.topbar button[aria-label="管理"]').click(); await p.waitForTimeout(600)
ok('管理面板有身分列', (await p.locator('.role-line').count()) === 1)
await p.locator('.role-name').click(); await p.waitForTimeout(500)
ok('點名字可以進到設定', (await p.locator('#checker-name').count()) === 1)
await p.keyboard.press('Escape'); await p.waitForTimeout(400)

// #15 捲進名單深處之後回得到頂端；#43 名單要是 list、<html lang> 要跟著語言走。
await p.goto(URL); await p.waitForTimeout(800)
await p.getByRole('button',{name:/開啟空間/}).first().click(); await p.waitForTimeout(300)
await p.locator('#room-name').fill('長名單測試')
await p.locator('#roster-text').fill(Array.from({length: 40}, (_, i) => `同工${String(i+1).padStart(2,'0')}`).join('\n'))
await p.waitForTimeout(400)
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
await p.locator('input[type=search]').fill('同工'); await p.waitForTimeout(300)
ok('自訂清除鍵有 48px 觸控目標與無障礙名稱', await p.evaluate(() => {
  const b = document.querySelector('.search-clear')
  const r = b?.getBoundingClientRect()
  return Boolean(b?.getAttribute('aria-label')) && r && r.width >= 48 && r.height >= 48
}))
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
// <html lang> 要跟著 App 語言，否則螢幕閱讀器會用中文語音唸英文介面。
ok('預設 lang=zh-TW', (await p.evaluate(() => document.documentElement.lang)) === 'zh-TW')
await p.locator('.topbar button[aria-label="管理"]').click(); await p.waitForTimeout(500)
await p.getByRole('button',{name:/^設定$/}).click(); await p.waitForTimeout(500)
await p.getByRole('button',{name:/English/}).click(); await p.waitForTimeout(600)
ok('切成英文後 lang=en', (await p.evaluate(() => document.documentElement.lang)) === 'en')
await p.getByRole('button',{name:/中文/}).click(); await p.waitForTimeout(600)
ok('切回中文後 lang=zh-TW', (await p.evaluate(() => document.documentElement.lang)) === 'zh-TW')
await p.keyboard.press('Escape'); await p.waitForTimeout(400)

// 掃描端：單機模式下用代碼加入別人的空間，錯的不是代碼，是這個站台沒有雲端。
// 講「找不到這個代碼。請確認有沒有打錯」會讓人重打三次，而主揪正在數人頭。
await p.evaluate(() => { window.location.hash = '#/j/ZZZZZZ' }); await p.waitForTimeout(1500)
const joinMsg = ((await p.locator('.note-warn').textContent().catch(() => '')) ?? '').trim()
ok(`單機模式加入空間的說法：「${joinMsg}」`, joinMsg.includes('沒有連上雲端'))
ok('不會叫人去檢查代碼有沒有打錯', !joinMsg.includes('打錯'))

// ---- 確認對話框、設定、列印樣式 ----
await p.goto(URL); await p.waitForTimeout(900)

await p.getByRole('button',{name:/開啟空間/}).first().click(); await p.waitForTimeout(300)
await p.locator('#room-name').fill('確認對話框測試')
await p.locator('#roster-text').fill('王小明\n李美花\n陳大同')
await p.waitForTimeout(300)
await p.getByRole('button',{name:/建立/}).click(); await p.waitForTimeout(1200)

// --- 確認對話框 ---
await p.locator('.topbar button[aria-label="管理"]').click(); await p.waitForTimeout(500)
await p.getByRole('button',{name:/刪除空間/}).click(); await p.waitForTimeout(500)
ok('刪除空間跳出 alertdialog（不是 window.confirm）', await p.locator('[role=alertdialog]').isVisible())
ok('對話框有標題與說明', (await p.locator('#dialog-title').textContent())==='刪除空間'
   && (await p.locator('#dialog-body').textContent())?.includes('無法復原'))
const focused = await p.evaluate(()=>document.activeElement?.textContent?.trim())
ok(`初始焦點在「取消」而非破壞性按鈕（實際：${focused}）`, focused==='取消')

await p.keyboard.press('Escape'); await p.waitForTimeout(400)
ok('Esc 關閉對話框，空間仍在', (await p.locator('[role=alertdialog]').count())===0
   && (await p.locator('.member').count())===3)

// --- #20 結束這一輪：把結果攤在確認鍵前面 ---
// 以前收尾被拆成三個彼此無關的按鈕（複製結果在計分區、下載 CSV 在面板第一項、
// 關閉空間在第九項），結果多數空間從未被關閉也從未被匯出，30 天後靜靜消失。
await p.locator('.member-main').first().click(); await p.waitForTimeout(600)
await p.locator('.topbar button[aria-label="管理"]').click(); await p.waitForTimeout(500)
ok('「關閉空間」改叫「結束這一輪」', (await p.getByRole('button',{name:/結束這一輪/}).count()) > 0)
await p.getByRole('button',{name:/結束這一輪/}).click(); await p.waitForTimeout(600)
const finishPreview = (await p.locator('.result-preview').textContent()) ?? ''
ok(`確認鍵前面就看得到結果：「${finishPreview.split('\n')[1]}」`,
   finishPreview.includes('確認對話框測試') && /已到 1 \/ 3 人/.test(finishPreview))
ok('對話框裡就能複製結果', (await p.getByRole('button',{name:/複製結果/}).count()) > 0)
ok('對話框裡就能下載 CSV', (await p.getByRole('button',{name:/下載 CSV/}).count()) > 0)
await p.getByRole('button',{name:/^結束這一輪$/}).last().click(); await p.waitForTimeout(1200)
await p.keyboard.press('Escape'); await p.waitForTimeout(500)
// 結束之後要回答的問題已經不是「還能不能點」，而是「這一場最後是幾個人」。
const closedBanner = (await p.locator('.banner-result-text').textContent()) ?? ''
ok(`結束後橫幅印的是定格結果：「${closedBanner}」`,
   closedBanner.includes('已結束') && closedBanner.includes('1 / 3'))
ok('結束後仍然複製得到結果', (await p.locator('.banner-result .btn').count()) === 1)
ok('結束後戳名字沒有作用', await p.locator('.member-main').first().isDisabled())
ok('頂欄說得出已關閉', (await p.locator('.topbar-count.closed').count()) === 1)

// --- 設定：震動開關 ---
await p.keyboard.press('Escape'); await p.waitForTimeout(300)
await p.goto(URL); await p.waitForTimeout(800)
await p.locator('button[aria-label="設定"]').click(); await p.waitForTimeout(500)
ok('設定面板標題是「設定」不是「主題」', (await p.locator('.sheet-title').textContent())==='設定')
ok('有震動回饋開關', await p.getByText('震動回饋').isVisible())

await p.keyboard.press('Escape'); await p.waitForTimeout(300)

// --- 列印樣式 ---
await p.goBack(); await p.waitForTimeout(1500)
await p.emulateMedia({media:'print'}); await p.waitForTimeout(500)
const printState = await p.evaluate(()=>{
  const hidden = (sel)=>{const e=document.querySelector(sel); return !e || getComputedStyle(e).display==='none'}
  const txt = (sel)=>document.querySelector(sel)?.textContent?.trim() ?? null
  const check = document.querySelector('.check')
  return { topbar:hidden('.topbar'), seg:hidden('.segmented'), search:hidden('.search-wrap'),
    rows: document.querySelectorAll('.member').length,
    checkBg: check ? getComputedStyle(check).backgroundColor : null,
    title: txt('.print-title'), meta: txt('.print-meta'), blanks: txt('.print-blanks'),
    columns: getComputedStyle(document.querySelector('.list')).columnCount }
})
ok('列印時隱藏頂欄／篩選／搜尋', printState.topbar&&printState.seg&&printState.search)
ok(`列印仍保留名單 ${printState.rows} 列`, printState.rows===3)
ok('列印的勾選格是空白的（給筆勾）', printState.checkBg==='rgb(255, 255, 255)')
// 紙本備援是「手機沒電」時唯一剩下的東西。抬頭必須寫得出這是哪一場、代碼多少。
// 以前這裡印的是借來的計分區文字（「還有 12 位沒到」）——一個離開印表機就過期
// 的數字，而活動名稱與代碼反而被 display:none 掉了。
ok(`列印抬頭是活動名稱：「${printState.title}」`, printState.title === '確認對話框測試')
ok(`列印抬頭有代碼與人數：「${printState.meta}」`,
   /[2-9A-HJ-KM-NP-Z]{6}/.test(printState.meta || '') && (printState.meta || '').includes('共 3 人'))
ok('列印抬頭有日期與點名者欄位', (printState.blanks || '').includes('日期') && (printState.blanks || '').includes('點名者'))
ok(`列印排成兩欄（${printState.columns}）省紙`, printState.columns === '2')

await p.emulateMedia({media:'screen'})



// ---- 分組（分車）、看板模式 ----
await p.goto(URL); await p.waitForTimeout(900)

await p.getByRole('button',{name:/開啟空間/}).first().click(); await p.waitForTimeout(300)
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
await p.getByRole('button',{name:/建立/}).click(); await p.waitForTimeout(1300)

// --- 分組 UI ---
ok('出現分組選擇器', await p.locator('.groups').isVisible())
const chips = await p.locator('.group-chip').allTextContents()
ok(`分組晶片：${chips.join(' | ')}`, chips.length===3 && chips[1].includes('第一車') && chips[2].includes('第二車'))
// 6 列，陳大同請假 → 該到 5，一個都還沒到。
ok('全部：未到 5（陳大同請假不算）', (await missing())==='5')
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
// 第二車：陳大同請假、李四、王五 → 2 個沒到。
ok('第二車未到 2（陳大同請假不算）', (await missing())==='2')


// 分組晶片上的未到人頭。「全部」也帶一個數字，各車相加要等於它——加不起來的話
// 志工會以為自己算錯，開始找那個不存在的差額。晶片是人頭、分段控制是列數
// （見 roll-call.md）；攜伴不再解析之後兩者在新名單上相等。
await p.locator('.groups .group-chip').first().click(); await p.waitForTimeout(400)
const gn = await p.locator('.group-chip .group-n').allTextContents()
ok(`晶片數字（全部｜各車）：${gn.join(' / ')}`, gn.length===3 && gn[1]==='2' && gn[2]==='2')
ok('各車未到相加等於「全部」', Number(gn[1]) + Number(gn[2]) === Number(gn[0]))
ok('而且等於分段控制的未到數', (await missing()) === gn[0])

// --- 複製結果應限定在選取的分組 ---
await ctx.grantPermissions(['clipboard-read','clipboard-write'])
await p.getByRole('button',{name:/第二車/}).click(); await p.waitForTimeout(300)
await p.locator('.topbar button[aria-label="管理"]').click(); await p.waitForTimeout(500)
await p.getByRole('button',{name:/複製結果/}).click(); await p.waitForTimeout(700)
const clip = await p.evaluate(()=>navigator.clipboard.readText())
ok(`複製結果限定第二車：「${clip.split('\n')[0]}」`, clip.includes('第二車') && clip.includes('李四') && !clip.includes('王小明'))

// --- 看板模式 ---
await p.locator('.groups .group-chip').first().click(); await p.waitForTimeout(300)
const groupRoomCode=(await p.locator('.topbar-sub .mono').first().textContent())?.trim()
await p.locator('.topbar button[aria-label="管理"]').click(); await p.waitForTimeout(500)
await p.getByRole('button',{name:/看板模式/}).click(); await p.waitForTimeout(1600)
ok('進入看板模式', await p.locator('.board').isVisible())
// 看板最大的字要回答車長真正的問題——「還缺誰」，不是「已經到幾個」。
const heroNum = async () => ((await p.locator('.board-hero').textContent()) || '').replace('位沒到','').trim()
ok('看板主角是未到人數（4）', (await heroNum())==='4')
// 6 列，陳大同請假 → 今天該到 5，王小明已到。
ok('已到退成副行且分母扣掉請假', (await p.locator('.board-sub').textContent())?.includes('1 / 5'))
const names=await p.locator('.board-names li').allTextContents()
ok(`看板列出未到者：${names.map(n=>n.trim()).join('、')}`, names.length===4)
const numSize=await p.evaluate(()=>parseFloat(getComputedStyle(document.querySelector('.board-hero')).fontSize))
ok(`看板數字 ${numSize}px（遠距可讀，超出八階是具名例外）`, numSize>=52)
// 未到的名字不得被切掉：最需要看板的那一刻正是名字最多的時候，而三公尺外
// 沒有人能捲動。
ok('未到名單沒有被切掉', await p.evaluate(()=>{
  const ul=document.querySelector('.board-names'); return !ul || ul.scrollHeight <= ul.clientHeight + 2 }))
// 三公尺外分不出圓點的顏色差別，同步狀態一定要有字。
ok('看板同步狀態有文字', ((await p.locator('.board-sync-text').textContent())||'').trim().length > 0)

await p.getByRole('button',{name:/第一車/}).click(); await p.waitForTimeout(400)
ok('看板可切分組：第一車未到 2 人', (await heroNum())==='2')
await p.getByRole('button',{name:/離開看板/}).click(); await p.waitForTimeout(1200)
ok('離開看板回到空間', await p.locator('.topbar-name').isVisible() && (await p.locator('.topbar-sub .mono').first().textContent())?.trim()===groupRoomCode)




// ---- 80 人名單的首屏產出 ----
// roll-call.md 寫著「首屏本來就有 45–50% 的高度被控制項吃掉——80 人的名單一屏
// 只看得到 4 個人；省下的每一格都直接變成人名」。這一段把那句話變成可量的東西。
// 搜尋框改成一直開著之後（不必先點才展開）首屏會少掉一列人名的高度，這是
// 換掉「先點開才能用」那一步的代價，門檻跟著往下調一格，不是量錯了。
await p.goto(URL); await p.waitForTimeout(600)
await p.getByRole('button',{name:/開啟空間/}).first().click(); await p.waitForTimeout(400)
await p.locator('#room-name').fill('員工旅遊 · 出發')
await p.locator('#roster-text').fill(
  ['【第一車】', ...Array.from({length:40},(_,i)=>`第一車學員${String(i+1).padStart(2,'0')}`),
   '【第二車】', ...Array.from({length:40},(_,i)=>`第二車學員${String(i+1).padStart(2,'0')}`)].join('\n'))
await p.waitForTimeout(800)
await p.getByRole('button',{name:/建立/}).click(); await p.waitForTimeout(2200)
const fold = await p.evaluate(() => {
  const rows = [...document.querySelectorAll('.member')]
  return {
    firstNameTop: Math.round(rows[0].getBoundingClientRect().top),
    visible: rows.filter((e) => e.getBoundingClientRect().bottom <= innerHeight).length,
    searchInFlow: !!document.querySelector('.shell .search-wrap'),
    hasDock: !!document.querySelector('.dock'),
  }
})
ok(`80 人首屏看得到 ${fold.visible} 個人名（第一個人名在 y=${fold.firstNameTop}）`, fold.visible >= 7)
ok('沒有底部動作列吃掉高度', !fold.hasDock)
ok('搜尋框不在名單流裡（它佔的 76px 等於一列人名）', !fold.searchInFlow)
// 捲到名單深處，搜尋框必須還按得到——它住在 sticky 頂欄裡，永遠在畫面上，
// 不必先捲回頂端。
await p.mouse.wheel(0, 3000); await p.waitForTimeout(500)
ok('捲過 3000px 之後搜尋框仍在畫面上（頂欄 sticky）', await p.locator('input[type=search]').isVisible())
await p.locator('input[type=search]').fill('第二車學員37'); await p.waitForTimeout(500)
ok('深處也搜得到人', (await p.locator('.member').count()) === 1)
await p.locator('input[type=search]').press('Escape'); await p.waitForTimeout(400)
ok('Esc 清空搜尋字、還原名單，搜尋框還在原地',
   (await p.locator('input[type=search]').count()) === 1
   && (await p.locator('input[type=search]').inputValue()) === ''
   && (await p.locator('.member').count()) === 80)

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
