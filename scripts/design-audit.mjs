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

/**
 * docs/design/03-tokens.md §3.2 的七階字級（44px 那一階隨計分區一起拿掉了）。
 *
 * 這裡的數字是**基準 17px 之下**那七階的像素值。2026-09 之後 token 是
 * `calc(11 / 17 * 1rem)` 這種寫法，量到的像素會跟著使用者的字級設定放大，
 * 所以比對前要先用當下的根字級換算回來。
 */
const FONT_SCALE = [11, 13, 15, 17, 20, 26, 34]
/** §6：一般可互動元素 48px；Toast 動作是暫時性表面，放寬到 44px。 */
const TAP_MIN = 48
const TAP_EXCEPTIONS = { 'toast-action': 44 }

function collect() {
  const parse = (c) => {
    const m = c.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/)
    if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] }
    /*
     * `color-mix()` 算出來的顏色，Chromium 回的是 `color(srgb r g b / a)`，
     * 分量是 0–1 不是 0–255。
     *
     * 半透明材質（.topbar / .dock）就是這個格式。少了這一段，`parse()` 對它回
     * null，`bgOf()` 於是把那一層當成「根本沒有底色」直接跳過去——材質等於沒有
     * 被量到，而檢查照樣說通過。**這正是 iOS 評估 §2.1 警告過的那個失真**，
     * 只是原因不是門檻猜錯，是連字串都沒認得。
     */
    const s = c.match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/)
    if (s) return { r: +s[1] * 255, g: +s[2] * 255, b: +s[3] * 255, a: s[4] === undefined ? 1 : +s[4] }
    return null
  }
  const lum = ({ r, g, b }) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }
  const ratio = (a, b) => {
    const [hi, lo] = [lum(a), lum(b)].sort((p, q) => q - p)
    return (hi + 0.05) / (lo + 0.05)
  }
  /*
   * 眼睛在這個元素背後看到的顏色。
   *
   * 舊版是「往上找第一個 alpha > 0.5 的祖先」。那個 0.5 是個猜的門檻，而且它把
   * 半透明的底當成不透明的用——一層 72% 的紙疊在深色卡片上，量到的會是紙的
   * 顏色，不是眼睛看到的那個混合色。頂欄與底部動作列 2026-09 改成半透明材質之
   * 後，那個近似就直接失真了（見 iOS 評估 §2.1）。
   *
   * 現在是真的往下疊：一層層收集半透明的底，碰到不透明的那一層（或 body）就
   * 停，再由下往上合成回來。
   *
   * **量不到的一件事**：`backdrop-filter` 吃的是**畫面上**在它後面的東西，不是
   * DOM 裡的祖先。頂欄底下捲過去的名單卡片不在這條祖先鏈上，所以這裡算出來的
   * 是「沒有東西捲到底下時」的顏色。那是靜止狀態的正確答案，不是全部的答案。
   */
  const bgOf = (el) => {
    const layers = []
    let n = el
    let opaque = null
    while (n && n !== document.documentElement) {
      const c = parse(getComputedStyle(n).backgroundColor)
      if (c && c.a > 0) {
        if (c.a >= 0.999) { opaque = c; break }
        layers.push(c)
      }
      n = n.parentElement
    }
    let out = opaque
      ?? parse(getComputedStyle(document.body).backgroundColor)
      ?? { r: 255, g: 255, b: 255, a: 1 }
    // 由下往上疊回來。
    for (let i = layers.length - 1; i >= 0; i--) out = blend(layers[i], out, layers[i].a)
    return out
  }
  const label = (el) =>
    `${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).trim().split(/\s+/).join('.') : ''}`

  /**
   * 祖先鏈上所有 opacity 的乘積。
   *
   * getComputedStyle(el).color 讀到的是「宣告的顏色」，不含祖先 opacity 的影響。
   * 於是像 `.member.is-excused { opacity: .62 }` 這種寫法，會把裡面 13px 的說明
   * 文字實際壓到 2.5:1，而這份檢查完全驗不到——螢幕上看得見的問題，工具說通過。
   */
  const effOpacity = (el) => {
    let n = el, o = 1
    while (n && n !== document.documentElement) {
      const v = parseFloat(getComputedStyle(n).opacity)
      if (!Number.isNaN(v)) o *= v
      n = n.parentElement
    }
    return o
  }
  /** 把前景色按有效不透明度混進背景，得到眼睛真正看到的顏色。 */
  const blend = (fg, bg, a) => ({
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
    a: 1,
  })

  /*
   * 反算「第幾階」需要的兩個數（見下面 audit() 的七階檢查）：
   *   root  —— 系統那條路（Dynamic Type／瀏覽器預設字級）落在根字級上
   *   scale —— app 那顆字級鍵，乘在七階上（--fs-scale）
   * 兩條路是分開的，所以兩個都要除掉才回得到原本那七個數字。
   */
  const cs0 = getComputedStyle(document.documentElement)
  const root = parseFloat(cs0.fontSize)
  const scale = parseFloat(cs0.getPropertyValue('--fs-scale')) || 1
  const out = { root, scale, contrast: [], tap: [], font: [], name: [], nonText: [], clipped: [], primary: 0 }

  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue
    // inert 子樹（面板開啟時的背景）不屬於當前畫面，整段跳過。
    if (el.closest('[inert]')) continue
    const rect = el.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) continue

    if (el.classList?.contains('btn-primary')) out.primary++

    const ownText = [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .join('')
    if (ownText) {
      const fs = Math.round(parseFloat(cs.fontSize) * 100) / 100
      out.font.push({ fs, el: label(el), text: ownText.slice(0, 20) })

      const bg = bgOf(el)
      const declared = parse(cs.color)
      // 顏色自己的 alpha 與祖先 opacity 一起算進去，再跟背景比。
      const a = declared ? declared.a * effOpacity(el) : 0
      const fg = declared && bg ? blend(declared, bg, a) : null
      // WCAG 1.4.3 明確豁免停用中的控制項（inactive user interface component）。
      // 不豁免的話 --op-disabled 會讓每一顆停用按鈕都變成永久噪音，真正的問題
      // 反而被淹沒。
      const inactive = Boolean(el.closest('[disabled], [aria-disabled="true"]'))
      if (fg && bg && a > 0.06 && !inactive) {
        const r = ratio(fg, bg)
        const bold = parseInt(cs.fontWeight, 10) >= 700
        const large = fs >= 24 || (fs >= 18.66 && bold)
        const need = large ? 3 : 4.5
        if (r + 0.005 < need) {
          out.contrast.push({ ratio: +r.toFixed(2), need, fs, el: label(el), text: ownText.slice(0, 20) })
        }
      }
    }

    /*
     * 文字被自己的框夾住（2026-09）。
     *
     * 字級改成 rem 之後，**任何寫死高度的容器都是一顆定時炸彈**：使用者把字
     * 調大，字長高、框不會，字就被切掉。而上面每一項檢查都看不到這件事——
     * 對比照樣達標、觸控尺寸照樣夠大、字級照樣落在七階內、頁面也沒有橫向
     * 溢出。這個檢查就是為了那個死角。
     *
     * 只看真的會裁切的框（overflow-y 是 hidden／clip）：overflow 是 visible
     * 的話字會溢出去，難看但讀得到，那是另一個問題。刻意的截斷（`.member-note`
     * 的兩行封頂）用 -webkit-line-clamp 表示，跳過。
     *
     * input 的內容不算在 scrollHeight 裡（它自己在裡面捲），所以改看行高
     * 裝不裝得下——`.code-row` 那組固定高度就是這樣被抓出來的。
     *
     * **這一段刻意放在 `if (ownText)` 外面。** input 的值不是文字節點，所以它
     * 進不了那個分支——而寫死高度的框十之八九就是輸入框。第一版寫在裡面，
     * 對著已知的 bug 跑出來是「通過」。
     */
    const inputLike = el.matches('input, textarea, select')
    const clipsY = /hidden|clip/.test(cs.overflowY)
    const clamped = cs.webkitLineClamp && cs.webkitLineClamp !== 'none'
    // 只看**自己裝著那段字**的元素。裁切的容器不一定有問題：`.room-flow-stage`
    // 是兩步並排、只露一步的滑軌，`body` 在面板開著時會鎖捲動——兩個都是刻意
    // 把比自己高的東西關起來，跟「字被夾住」是兩回事。
    if (clipsY && !clamped && el.clientHeight > 0 && (ownText || inputLike)) {
      const needed = inputLike ? parseFloat(cs.lineHeight) : el.scrollHeight
      if (Number.isFinite(needed) && needed > el.clientHeight + 1) {
        out.clipped.push({
          el: label(el), need: +needed.toFixed(1), have: el.clientHeight,
          text: (ownText || el.value || el.placeholder || '').slice(0, 20),
        })
      }
    }

    /*
     * 非文字的狀態指示。WCAG 1.4.11 要求 3:1。
     *
     * 「未到」是一個空心圓——它是名單上唯一表示「這個人還沒上車」的形狀，
     * 而它沒有自己的文字節點，所以上面那段以文字為單位的檢查看不到它。
     * 這裡明確點名幾個「形狀就是資訊」的元素。
     */
    /*
     * 這裡只列「形狀本身就是資訊」的元素。
     *
     * chip-count 與 chip-tell 2026-09 移出這份清單：它們的意思**寫在裡面的字上**
     * （「＋2」「第二車」），走的是文字對比規則（4.5:1），底色與邊框是裝飾。
     * WCAG 1.4.11 管的是沒有文字可以依靠的圖形——那顆空心圈與那顆同步圓點。
     * 把有字的元件也塞進來，只會逼出「為了通過檢查而描的邊」，而那正是 2026-09
     * 這一輪要拆掉的東西。
     */
    const NON_TEXT = ['check', 'sync-dot']
    if ([...(el.classList ?? [])].some((c) => NON_TEXT.includes(c))) {
      const bg = bgOf(el.parentElement ?? el)
      const a = effOpacity(el)
      let best = 0
      // 邊框與填色只要有一個達標就算過：實心圓不需要外框也看得見，
      // 空心圓則完全靠那條線。
      for (const [prop, widthProp] of [['borderTopColor', 'borderTopWidth'], ['backgroundColor', null]]) {
        if (widthProp && parseFloat(cs[widthProp]) < 0.5) continue
        const c = parse(cs[prop])
        if (!c || c.a * a <= 0.06) continue
        best = Math.max(best, ratio(blend(c, bg, c.a * a), bg))
      }
      if (best > 0 && best + 0.005 < 3) {
        out.nonText.push({ el: label(el), ratio: +best.toFixed(2), need: 3 })
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
    /*
     * 字級 2026-09 改成 rem，同年又多了 app 自己那顆字級鍵，所以量到的像素是
     *
     *     那一階 ÷ 17 × 根字級 × 倍率
     *
     * 兩個都除掉才回得到原本那七個數字。**只除根字級是不夠的**——第一版就是
     * 這樣，於是 app 字級那一輪把每一顆按鈕都報成「不在七階內」，而真正的原因
     * 是檢查自己少算了一個乘數。
     */
    const step = Math.round((f.fs / r.root / r.scale) * 17)
    if (!FONT_SCALE.includes(step)) {
      note(scheme, screen, '字級不在七階內',
        `${f.fs}px（根 ${r.root}px × 倍率 ${r.scale} ⇒ 第 ${step} 階）${f.el} 「${f.text}」`)
    }
  }
  for (const n of r.nonText) {
    note(scheme, screen, '非文字元件對比不足',
      `${n.el} ${n.ratio}:1（狀態靠形狀表達時線條要 ${n.need}:1）`)
  }
  for (const c of r.clipped) {
    note(scheme, screen, '文字被框夾住', `需要 ${c.need}px、框只有 ${c.have}px ${c.el} 「${c.text}」`)
  }
  for (const n of r.name) note(scheme, screen, '缺無障礙名稱', n.el)
  if (r.primary > 1) note(scheme, screen, '主要按鈕過多', `找到 ${r.primary} 個 .btn-primary，規範是至多一個`)

  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth)
  if (overflow > 1) note(scheme, screen, '頁面橫向溢出', `${overflow}px`)
}

const browser = await chromium.launch(BROWSER ? { executablePath: BROWSER } : {})

/**
 * 三輪（2026-09，iOS 評估 §1.1）。
 *
 * 前兩輪是淺色與深色。第三輪把**瀏覽器的預設字級調到 24px**——字級 token 改成
 * rem 之後，這會把內文從 17px 推到 25.5px（1.5 倍），大約落在 iOS Dynamic Type
 * 的 xxxLarge 與 AX1 之間。這一輪要驗的不是「字有沒有變大」（那是 CSS 的事），
 * 是**變大之後版面還成不成立**：橫向溢出、對比、觸控尺寸、七階字級。
 *
 * 只跑一輪放大 × 淺色，不跑放大 × 深色：字級與配色是兩件互不影響的事，
 * 兩兩相乘只是把腳本跑成兩倍長。
 *
 * `standard` 是 Chromium 的「預設字型大小」設定，跟使用者在設定頁調的是同一個
 * 值；根字級寫成 `calc(17 / 16 * 1rem)` 就是為了接這個值（見 styles.css :root）。
 *
 * **第四輪跑的是 app 自己那顆字級鍵**（設定 › 文字大小 › 特大，2026-09）。
 * 它跟第三輪是**兩條不同的路**：系統那條走根字級，app 這條走 `--fs-scale`
 * 乘在七階上。所以兩輪各自只動一個變數——哪一條壞了，看是哪一輪紅的就知道。
 * （兩條同時開的極端組合不在這裡跑：那會讓失敗訊息說不清是誰的問題。）
 */
const PASSES = [
  { scheme: 'light', label: 'light', rootFont: 16, appFont: 'base' },
  { scheme: 'dark', label: 'dark', rootFont: 16, appFont: 'base' },
  { scheme: 'light', label: 'light·系統放大字級', rootFont: 24, appFont: 'base' },
  { scheme: 'light', label: 'light·app 字級特大', rootFont: 16, appFont: 'xl' },
]

for (const pass of PASSES) {
  const scheme = pass.label
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: pass.scheme })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => note(scheme, '—', 'JS 錯誤', e.message))
  if (pass.rootFont !== 16) {
    const cdp = await ctx.newCDPSession(page)
    await cdp.send('Page.setFontSizes', { fontSizes: { standard: pass.rootFont, fixed: pass.rootFont } })
  }


  await page.goto(URL); await page.waitForTimeout(900)

  /*
   * app 那顆字級鍵要**走一遍真的設定畫面**，不是直接蓋 DOM 屬性——
   * `applyFontScale()` 在每次啟動時都會照著存下來的偏好重設那個屬性，蓋上去的
   * 會被它拿掉（第一版就是這樣安靜地退化成「再跑一次淺色」，被下面那段對帳
   * 抓出來的）。選過一次就存進 IndexedDB，這個 context 後面每一次 goto 都還在。
   */
  if (pass.appFont !== 'base') {
    await page.locator('button[aria-label="設定"]').click(); await page.waitForTimeout(500)
    await page.getByRole('button', { name: /^文字大小|^Text size/ }).click(); await page.waitForTimeout(400)
    await page.getByRole('button', { name: /^特大$|^Extra large$/ }).click(); await page.waitForTimeout(500)
    await page.keyboard.press('Escape'); await page.waitForTimeout(400)
  }

  // 這一輪的字級情境真的生效了嗎？CDP 沒吃到設定的話，放大字級那輪會安靜地
  // 退化成「再跑一次淺色」——照樣通過，但什麼都沒驗到。所以先對一次根字級：
  // 它應該是「瀏覽器預設字級 × 17/16」（見 styles.css :root 的那兩行）。
  {
    const root = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize))
    const want = pass.rootFont * 17 / 16
    if (Math.abs(root - want) > 0.01) {
      note(scheme, '—', '字級情境沒生效', `根字級量到 ${root}px，預期 ${want}px`)
    }
    // app 那顆鍵同理：沒吃到就會安靜地退化成「再跑一次淺色」。
    const scale = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--fs-scale').trim())
    const wantScale = pass.appFont === 'base' ? '1' : '1.3'
    if (scale !== wantScale) {
      note(scheme, '—', '字級情境沒生效', `--fs-scale 量到 ${scale || '(空)'}，預期 ${wantScale}`)
    }
  }

  await audit(page, scheme, '首頁')

  // 「加入空間」2026-09 從就地展開改成一張底部面板：代碼框、「加入」、掃碼鍵
  // 換了一組鄰居（面板底色 --surface，不是頁面底色），對比與觸控尺寸要重驗。
  await page.getByRole('button', { name: /^加入空間$|^Join a room$/ }).first().click()
  await page.waitForTimeout(500)
  await audit(page, scheme, '首頁 · 加入空間')
  await page.keyboard.press('Escape'); await page.waitForTimeout(400)

  await page.getByRole('button', { name: /創建空間|Create a room/ }).first().click()
  await page.waitForTimeout(300)
  await page.locator('#room-name').fill('秋季旅遊 · 出發')
  await page.locator('#roster-text').fill(
    '王小明 0912345678\n李美花 +1\n陳大同（請假）\n張三\n李四\n王五 帶2人')
  await page.waitForTimeout(400)
  await audit(page, scheme, '創建空間')

  // 「名單怎麼寫」：整面都是字，而且是全 app 唯一一處把等寬例子擺在凹槽上的
  // 版面——對比與字級都換了一組鄰居，要單獨驗。
  await page.locator('.topbar .fmt-help-btn').click(); await page.waitForTimeout(600)
  await audit(page, scheme, '創建空間 · 名單怎麼寫')
  await page.keyboard.press('Escape'); await page.waitForTimeout(400)

  // 開空間 2026-09 拆成兩步（貼名單 →「產生名單」→ 看解析結果 →「建立」），
  // 解析結果與「建立」都住在第二步，要先把名單產出來。
  await page.getByRole('button', { name: /產生名單|Generate/ }).click(); await page.waitForTimeout(500)
  await audit(page, scheme, '創建空間 · 解析結果')

  await page.getByRole('button', { name: /建立|Create/ }).click(); await page.waitForTimeout(1200)
  await page.locator('.member-main').nth(0).click(); await page.waitForTimeout(500)
  await audit(page, scheme, '空間（含 Toast）')

  // 搜尋 2026-09 收成篩選列右邊的一顆放大鏡，點了才往左長出輸入框。展開的
  // 狀態要單獨驗：那條輸入框蓋在分段控制上，對比與觸控尺寸都換了一組鄰居。
  await page.locator('.filterbar .search-toggle').click(); await page.waitForTimeout(400)
  await page.locator('input[type=search]').fill('王'); await page.waitForTimeout(400)
  await audit(page, scheme, '空間 · 搜尋展開')
  await page.locator('input[type=search]').press('Escape'); await page.waitForTimeout(200)
  await page.locator('input[type=search]').press('Escape'); await page.waitForTimeout(300)

  await page.locator('.topbar button[aria-label="更多"]').click(); await page.waitForTimeout(500)
  await audit(page, scheme, '「更多」面板')
  await page.keyboard.press('Escape'); await page.waitForTimeout(300)

  // 匯出 2026-09 從「更多」搬進「結束點名」的確認對話框：結果攤在確認鍵前面，
  // 三顆帶得走的格式（複製、CSV、PDF）就排在它下面。按 Esc 走人，不真的結束。
  await page.locator('.dock').getByRole('button', { name: /^結束點名$|^Finish roll call$/ }).click()
  await page.waitForTimeout(400)
  await audit(page, scheme, '結束點名 · 結果與三種格式')
  await page.keyboard.press('Escape'); await page.waitForTimeout(300)

  // 編輯模式（2026-09）：標題變輸入框、每一列右邊長出叉叉、動作列剩一顆「＋」。
  // 成員面板同時拿掉了，所以這裡驗的是那個模式，不是那張面板。
  await page.locator('.topbar button[aria-label="更多"]').click(); await page.waitForTimeout(400)
  await page.getByRole('button', { name: /^編輯$|^Edit$/ }).click(); await page.waitForTimeout(500)
  await audit(page, scheme, '編輯模式')
  await page.getByRole('button', { name: /^完成$|^Done$/ }).click(); await page.waitForTimeout(400)

  // --- 分組（分車）---
  // 名單結構只在貼上的時候決定（整份重貼那條路 2026-09 拿掉了），所以分組要
  // 另外開一間空間，從第一步就帶著車次標記。
  await page.goto(URL); await page.waitForTimeout(700)
  await page.getByRole('button', { name: /創建空間|Create a room/ }).first().click()
  await page.waitForTimeout(300)
  await page.locator('#room-name').fill('秋季旅遊 · 分車')
  // `#` 是範例教的、也是 rosterToText 寫回來的那一種分組記號。
  await page.locator('#roster-text').fill(
    '#第一車\n王小明 0912345678\n李美花 +1\n#第二車\n陳大同（坐輪椅）\n張三\n李四')
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: /產生名單|Generate/ }).click(); await page.waitForTimeout(500)
  // 解析預覽有分組時多一列 `.group-divider`（淺底的帶子）——那是這一輪唯一
  // 只在「名單有分車」時才存在的東西，上面那一輪的預覽驗不到它。
  await audit(page, scheme, '創建空間 · 解析結果（含分組）')
  await page.getByRole('button', { name: /建立|Create/ }).click(); await page.waitForTimeout(1300)
  await audit(page, scheme, '空間（含分組）')

  // 首頁每個空間右邊那顆「更多」（2026-09 拆開）：**空間本身的事**（建立副本、
  // 刪除空間），就在首頁打開，不進空間。它跟空間裡那一份是兩份不同的清單，
  // 所以要單獨驗。
  await page.goto(URL); await page.waitForTimeout(900)
  await page.getByRole('button', { name: /^(更多|More)：/ }).first().click(); await page.waitForTimeout(600)
  await audit(page, scheme, '首頁 · 空間的「更多」')
  await page.keyboard.press('Escape'); await page.waitForTimeout(400)

  // 底下幾段是空間裡的東西，要先進去。
  await page.locator('.recent-item').first().click(); await page.waitForTimeout(1400)

  // 邀請點名是「更多」的第一列（2026-09 從頂欄的分享圖示收回來）。單機模式
  // （沒設定 Supabase 的建置，也就是這支腳本跑的那個）邀請頁只有一塊說明，
  // 三種方式一個都不列。
  await page.locator('.topbar button[aria-label="更多"]').click(); await page.waitForTimeout(400)
  await page.getByRole('button', { name: /^邀請點名$|^Invite$/ }).click()
  await page.waitForTimeout(700)
  await audit(page, scheme, '邀請點名')
  await page.keyboard.press('Escape'); await page.waitForTimeout(300)

  await ctx.close()
}
await browser.close()

if (violations.length === 0) {
  console.log('設計規範檢查通過（淺色、深色、系統放大字級、app 字級特大四輪）：對比（含祖先 opacity）、非文字元件對比、觸控尺寸、字級、文字未被框夾住、無障礙名稱、橫向溢出、主要按鈕數量。')
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
