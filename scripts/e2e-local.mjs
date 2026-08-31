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

await p.goto(URL); await p.waitForTimeout(1200)
ok('首頁載入', await p.locator('.home-title').isVisible())
ok('顯示單機模式提示', (await p.locator('.banner-muted').count()) > 0)


// 開房
await p.getByRole('button', { name: /開啟房間/ }).first().click()
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
ok('同名警告出現', await p.locator('.note-warn').first().isVisible())


await p.getByRole('button', { name: /建立/ }).click()
await p.waitForTimeout(1200)
ok('進入房間', await p.locator('.topbar-name').isVisible())
const code = (await p.locator('.topbar-sub .mono').first().textContent())?.trim()
ok(`取得 6 碼房號: ${code}`, /^[2-9A-HJ-KM-NP-Z]{6}$/.test(code || ''))
ok('未到 8（9 人中「陳大同（請假）」自動判定為請假）', (await p.locator('.score-number').textContent()) === '8')
// 44px 的數字旁邊只補單位，不把同一個數字再寫一次。
ok('計分標籤只寫單位不重複數字', (await p.locator('.score-label').textContent())?.trim() === '位沒到')
// 名單共 12 個人頭（9 列 + 李美花＋1 + 王五＋2），陳大同請假 → 今天該到 11。
// 分母用 12 的話，全部到齊時畫面會寫「11 / 12」配一條填不滿的進度條。
ok('分母扣掉請假者 = 0 / 11', (await p.locator('.score-heads').textContent())?.includes('/ 11'))


// 點名
await p.locator('.member-main').nth(1).click()
await p.waitForTimeout(500)
ok('點名後未到 = 7', (await p.locator('.score-number').textContent()) === '7')
ok('該列變成已到', (await p.locator('.member').nth(1).getAttribute('class'))?.includes('is-arrived'))
ok('出現復原提示', await p.locator('.toast').isVisible())


// 復原
await p.locator('.toast-action').click()
await p.waitForTimeout(500)
ok('復原後未到回到 8', (await p.locator('.score-number').textContent()) === '8')

// 篩選
await p.locator('.member-main').nth(0).click(); await p.waitForTimeout(300)
await p.locator('.member-main').nth(2).click(); await p.waitForTimeout(300)
await p.getByRole('button', { name: /^已到/ }).click(); await p.waitForTimeout(300)
ok('已到篩選顯示 2 人', (await p.locator('.member').count()) === 2)
await p.getByRole('button', { name: /^未到/ }).click(); await p.waitForTimeout(300)
ok('未到篩選顯示 6 人', (await p.locator('.member').count()) === 6)
await p.getByRole('button', { name: /^全部/ }).click(); await p.waitForTimeout(300)

// 搜尋
await p.locator('input[type=search]').fill('陳怡君'); await p.waitForTimeout(300)
ok('搜尋同名找到 2 人', (await p.locator('.member').count()) === 2)
await p.locator('input[type=search]').fill('0912'); await p.waitForTimeout(300)
ok('可用電話搜尋', (await p.locator('.member').count()) === 1)

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

// 電話按鈕
const telHref = await p.locator('a[href^="tel:"]').first().getAttribute('href')
ok(`未到者顯示撥號連結 ${telHref}`, telHref === 'tel:0912345678')

// 分享（單機模式）——這裡是關鍵：這個建置沒有雲端，房號、QR、連結對任何人
// 都沒有用。發出去只會讓五個同工站在車門口看到「找不到這個房號」，然後以為
// 是自己打錯而重打三次。分享面板必須當場說出來，不能照樣印 QR。
await p.locator('.topbar button[aria-label="分享"]').click(); await p.waitForTimeout(1500)
ok('單機模式：面板標題改成「這間房只有你看得到」',
   (await p.locator('.sheet-title').textContent())?.includes('只有你看得到'))
ok('單機模式：不發房號', (await p.locator('.code-display').count()) === 0)
ok('單機模式：不產 QR', (await p.locator('.qr-card img').count()) === 0)
ok('單機模式：不給「複製連結」', (await p.getByRole('button', { name: /傳給別人|複製連結/ }).count()) === 0)
ok('單機模式：講清楚別人會看到什麼',
   ((await p.locator('.note-warn').textContent()) || '').includes('找不到這個房號'))

await p.keyboard.press('Escape'); await p.waitForTimeout(400)
ok('Esc 關閉面板', (await p.locator('.sheet').count()) === 0)

// ---- 現場操作：同名辨識、未分組、臨時加人、刪除確認 ----
await p.goto(URL); await p.waitForTimeout(900)
await p.getByRole('button',{name:/開啟房間/}).first().click(); await p.waitForTimeout(300)
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
ok('計分區說得出是「未分組」', (await p.locator('.score-scope').textContent())?.trim() === '未分組')
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

// #10 臨時加人：站在你面前的人不該被算成「未到」，而且要說一聲。
const beforeMissing = await p.locator('.score-number').textContent()
await p.getByRole('button',{name:/臨時/}).click(); await p.waitForTimeout(500)
await p.locator('#roster-text').fill('路上遇到的人'); await p.waitForTimeout(400)
await p.getByRole('button',{name:/加入名單/}).click(); await p.waitForTimeout(1200)
ok(`臨時加人不會讓未到數變多（${beforeMissing} → ${await p.locator('.score-number').textContent()}）`,
   (await p.locator('.score-number').textContent()) === beforeMissing)
const walkToast = (await p.locator('.toast-text').textContent().catch(() => '')) ?? ''
ok(`加完有說一聲：「${walkToast}」`, walkToast.includes('路上遇到的人') && walkToast.includes('已到'))

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

// 掃描端：單機模式下用房號加入別人的房，錯的不是房號，是這個站台沒有雲端。
// 講「找不到這個房號。請確認有沒有打錯」會讓人重打三次，而主揪正在數人頭。
await p.evaluate(() => { window.location.hash = '#/j/ZZZZZZ' }); await p.waitForTimeout(1500)
const joinMsg = ((await p.locator('.note-warn').textContent().catch(() => '')) ?? '').trim()
ok(`單機模式加入房間的說法：「${joinMsg}」`, joinMsg.includes('沒有連上雲端'))
ok('不會叫人去檢查房號有沒有打錯', !joinMsg.includes('打錯'))

// ---- 確認對話框、設定、列印樣式 ----
await p.goto(URL); await p.waitForTimeout(900)

await p.getByRole('button',{name:/開啟房間/}).first().click(); await p.waitForTimeout(300)
await p.locator('#room-name').fill('確認對話框測試')
await p.locator('#roster-text').fill('王小明\n李美花\n陳大同')
await p.waitForTimeout(300)
await p.getByRole('button',{name:/建立/}).click(); await p.waitForTimeout(1200)

// --- 確認對話框 ---
await p.locator('.topbar button[aria-label="管理"]').click(); await p.waitForTimeout(500)
await p.getByRole('button',{name:/刪除房間/}).click(); await p.waitForTimeout(500)
ok('刪除房間跳出 alertdialog（不是 window.confirm）', await p.locator('[role=alertdialog]').isVisible())
ok('對話框有標題與說明', (await p.locator('#dialog-title').textContent())==='刪除房間'
   && (await p.locator('#dialog-body').textContent())?.includes('無法復原'))
const focused = await p.evaluate(()=>document.activeElement?.textContent?.trim())
ok(`初始焦點在「取消」而非破壞性按鈕（實際：${focused}）`, focused==='取消')

await p.keyboard.press('Escape'); await p.waitForTimeout(400)
ok('Esc 關閉對話框，房間仍在', (await p.locator('[role=alertdialog]').count())===0
   && (await p.locator('.member').count())===3)

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
  return { dock:hidden('.dock'), topbar:hidden('.topbar'), seg:hidden('.segmented'), search:hidden('.search-wrap'),
    scoreboard: hidden('.scoreboard'),
    rows: document.querySelectorAll('.member').length,
    checkBg: check ? getComputedStyle(check).backgroundColor : null,
    title: txt('.print-title'), meta: txt('.print-meta'), blanks: txt('.print-blanks'),
    columns: getComputedStyle(document.querySelector('.list')).columnCount }
})
ok('列印時隱藏頂欄／動作列／篩選／搜尋', printState.dock&&printState.topbar&&printState.seg&&printState.search)
ok(`列印仍保留名單 ${printState.rows} 列`, printState.rows===3)
ok('列印的勾選格是空白的（給筆勾）', printState.checkBg==='rgb(255, 255, 255)')
// 紙本備援是「手機沒電」時唯一剩下的東西。抬頭必須寫得出這是哪一場、房號多少。
// 以前這裡印的是借來的計分區文字（「還有 12 位沒到」）——一個離開印表機就過期
// 的數字，而活動名稱與房號反而被 display:none 掉了。
ok(`列印抬頭是活動名稱：「${printState.title}」`, printState.title === '確認對話框測試')
ok(`列印抬頭有房號與人數：「${printState.meta}」`,
   /[2-9A-HJ-KM-NP-Z]{6}/.test(printState.meta || '') && (printState.meta || '').includes('共 3 人'))
ok('列印抬頭有日期與點名者欄位', (printState.blanks || '').includes('日期') && (printState.blanks || '').includes('點名者'))
ok('列印不再借用計分區當標題', printState.scoreboard)
ok(`列印排成兩欄（${printState.columns}）省紙`, printState.columns === '2')

await p.emulateMedia({media:'screen'})



// ---- 分組（分車）、看板模式 ----
await p.goto(URL); await p.waitForTimeout(900)

await p.getByRole('button',{name:/開啟房間/}).first().click(); await p.waitForTimeout(300)
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
ok('全部：未到 5（陳大同請假不算）', (await p.locator('.score-number').textContent())==='5')
ok('看全部時有分組分隔', (await p.locator('.group-divider').count())===2)


// 選第一車 → 計數只算那一車
await p.getByRole('button',{name:/第一車/}).click(); await p.waitForTimeout(400)
ok('第一車：未到 3', (await p.locator('.score-number').textContent())==='3')
ok('第一車：人頭 0 / 4（李美花 +1）', (await p.locator('.score-heads').textContent())?.includes('/ 4'))
// 選了分組之後，計分區的數字必須自己說是哪一車，否則「還有 3 位沒到」
// 在全隊和第一車是同一句話。
ok('計分區標出目前分組', (await p.locator('.score-scope').textContent())?.trim() === '第一車')
ok('第一車只顯示 3 人', (await p.locator('.member').count())===3)
ok('選了分組後不再顯示分隔', (await p.locator('.group-divider').count())===0)

// 點名只影響那一車的計數
await p.locator('.member-main').nth(0).click(); await p.waitForTimeout(600)
ok('第一車點一人後未到 2', (await p.locator('.score-number').textContent())==='2')
await p.getByRole('button',{name:/第二車/}).click(); await p.waitForTimeout(400)
ok('第二車未到仍是 2（陳大同請假）', (await p.locator('.score-number').textContent())==='2')


// 分組晶片上的未到數
await p.getByRole('button',{name:/^全部$/}).click(); await p.waitForTimeout(400)
const gn = await p.locator('.group-chip .group-n').allTextContents()
ok(`晶片顯示各車未到數：${gn.join(' / ')}`, gn.length===2 && gn[0]==='2' && gn[1]==='2')

// --- 複製結果應限定在選取的分組 ---
await ctx.grantPermissions(['clipboard-read','clipboard-write'])
await p.getByRole('button',{name:/第二車/}).click(); await p.waitForTimeout(300)
await p.getByRole('button',{name:/複製結果/}).click(); await p.waitForTimeout(600)
const clip = await p.evaluate(()=>navigator.clipboard.readText())
ok(`複製結果限定第二車：「${clip.split('\n')[0]}」`, clip.includes('第二車') && clip.includes('李四') && !clip.includes('王小明'))

// --- 看板模式 ---
await p.getByRole('button',{name:/^全部$/}).click(); await p.waitForTimeout(300)
const groupRoomCode=(await p.locator('.topbar-sub .mono').first().textContent())?.trim()
await p.locator('.topbar button[aria-label="管理"]').click(); await p.waitForTimeout(500)
await p.getByRole('button',{name:/看板模式/}).click(); await p.waitForTimeout(1600)
ok('進入看板模式', await p.locator('.board').isVisible())
// 看板最大的字要回答車長真正的問題——「還缺誰」，不是「已經到幾個」。
ok('看板主角是未到人數', (await p.locator('.board-hero').textContent())?.includes('4'))
// 6 列 + 李美花＋1 + 王五＋2 = 9 人頭，陳大同請假 → 今天該到 8。
ok('已到人頭退成副行且分母扣掉請假', (await p.locator('.board-sub').textContent())?.includes('1 / 8'))
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
ok('看板可切分組：第一車未到 2', (await p.locator('.board-hero').textContent())?.includes('2'))
await p.getByRole('button',{name:/離開看板/}).click(); await p.waitForTimeout(1200)
ok('離開看板回到房間', await p.locator('.topbar-name').isVisible() && (await p.locator('.topbar-sub .mono').first().textContent())?.trim()===groupRoomCode)




ok('沒有 JS 錯誤', errs.length === 0)
if (errs.length) console.log(errs.join('\n'))
await b.close()
