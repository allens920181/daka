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

// 分享
await p.locator('.topbar button[aria-label="分享"]').click(); await p.waitForTimeout(1500)
ok('分享面板顯示房號', (await p.locator('.code-display').textContent())?.trim() === code)
ok('QR 產生成功', await p.locator('.qr-card img').isVisible())

await p.keyboard.press('Escape'); await p.waitForTimeout(400)
ok('Esc 關閉面板', (await p.locator('.sheet').count()) === 0)

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
  const check = document.querySelector('.check')
  return { dock:hidden('.dock'), topbar:hidden('.topbar'), seg:hidden('.segmented'), search:hidden('.search-wrap'),
    rows: document.querySelectorAll('.member').length,
    checkBg: check ? getComputedStyle(check).backgroundColor : null,
    label: document.querySelector('.score-label') ? getComputedStyle(document.querySelector('.score-label'),'::after').content : null }
})
ok('列印時隱藏頂欄／動作列／篩選／搜尋', printState.dock&&printState.topbar&&printState.seg&&printState.search)
ok(`列印仍保留名單 ${printState.rows} 列`, printState.rows===3)
ok('列印的勾選格是空白的（給筆勾）', printState.checkBg==='rgb(255, 255, 255)')
ok('列印標題附日期與點名者欄位', String(printState.label).includes('日期'))

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
ok('看板顯示已到人頭', (await p.locator('.board-num').textContent())==='1')
ok('看板顯示未到人數', (await p.locator('.board-missing').textContent())?.includes('4'))
const names=await p.locator('.board-names li').allTextContents()
ok(`看板列出未到者：${names.map(n=>n.trim()).join('、')}`, names.length===4)
const numSize=await p.evaluate(()=>parseFloat(getComputedStyle(document.querySelector('.board-num')).fontSize))
ok(`看板數字 ${numSize}px（遠距可讀，超出八階是具名例外）`, numSize>=52)

await p.getByRole('button',{name:/第一車/}).click(); await p.waitForTimeout(400)
ok('看板可切分組：第一車已到 1', (await p.locator('.board-num').textContent())==='1')
await p.getByRole('button',{name:/離開看板/}).click(); await p.waitForTimeout(1200)
ok('離開看板回到房間', await p.locator('.topbar-name').isVisible() && (await p.locator('.topbar-sub .mono').first().textContent())?.trim()===groupRoomCode)




ok('沒有 JS 錯誤', errs.length === 0)
if (errs.length) console.log(errs.join('\n'))
await b.close()
