# 點名房間

團體現場多人同步點名。開一間房，把 QR 給協助的人掃，大家一起點同一份名單，隨時知道誰還沒到。

為「教會上遊覽車出遊、團體入場、集合點名」這種**單次、現場、多人、講求速度**的場景而做——不是差勤系統。

- **五個人點同一份名單。** 每支手機看到的是同一份即時狀態，不會重複點也不會漏。
- **掃 QR 就能用。** 不用註冊、不用登入、不用安裝。
- **離線照樣點。** 停車場收訊差也能繼續，恢復連線自動補上。
- **「誰還沒到」是主畫面。** 未到的人直接一鍵撥號，結果一鍵複製貼回 LINE。
- **回程用複製房間。** 同一份名單、已到歸零、請假的維持請假。
- **分車分組。** 名單貼上「【第一車】」就自動分段；選了某一車之後所有數字只算那一車。
- **看板模式。** 平板放門邊大字顯示，螢幕不會自動關掉。
- **不會被默默蓋掉。** 你剛點的被別人改了，會明講「已由陳姐改為未到」。
- **換手機不會弄丟。** 主揪可以登入，房間與常用名單跟著帳號走。**協助點名的人永遠不用登入。**

- [`docs/product-direction.md`](docs/product-direction.md) — 產品方向與架構決策
- [`docs/design/`](docs/design/) — 設計規範：[基礎](docs/design/01-foundations.md)、[品牌](docs/design/02-brand.md)、[Token](docs/design/03-tokens.md)、[元件](docs/design/04-components/)、[模式](docs/design/05-patterns.md)、[內容](docs/design/06-content.md)、[品質](docs/design/07-quality.md)、[貢獻](docs/design/08-contributing.md)；另有[視覺對照頁](https://claude.ai/code/artifact/9df0f69b-dc39-4fc6-928f-e62be58ef97f)
- [`docs/design-review-2026-08.md`](docs/design-review-2026-08.md) — 設計評估報告：找到的 63 條問題、修了哪些、還有 8 條在等你決定方向

---

## 使用方式

1. **開啟房間** — 貼上名單（LINE 接龍直接貼就行），取個名字，建立。
2. **分享** — 把 6 碼房號、QR 或連結給協助點名的人。
3. **點名** — 點一下名字就是已到。點錯了有「復原」。
4. **收尾** — 切到「未到」，直接撥號；或按「複製結果」貼回群組。
5. **回程** — 管理 → 複製這間房，名單原封不動、狀態歸零。

### 貼上名單能吃什麼

LINE 接龍長什麼樣就貼什麼樣，不用先整理：

```
1.王小明 0912345678
2. 李美花 +1
3、陳大同（請假）
４．張三
- 李四
王五 帶2人
```

會自動辨識**編號與項目符號**、**全形數字與標點**、**`+1` / `帶2人` 攜伴**、**括號備註**、**台灣手機與市話**（含 `(02)` 區碼括號）、以及 **`【第一車】` 這種分組標題行**。
備註寫「請假 / 不去 / 取消」的人會**直接標成請假**，不會混進未到清單被打電話。

解析結果在載入前會完整列出來讓你確認——解析器再寬容也會有猜錯的時候（例如把「秋季旅遊報名」這種標題當成人名），與其猜得更聰明，不如讓你一眼看到、直接改掉。

---

## 設定

### 不設定也能用

沒有連 Supabase 時，應用會自動退回**單機模式**：所有功能都在，只是名單只存在這支手機、其他人看不到。適合先試用，或一個人點名。

### 開啟多人同步

1. 到 [supabase.com](https://supabase.com) 開一個免費專案。
2. Dashboard → **SQL Editor** → 把 [`supabase/schema.sql`](supabase/schema.sql) 整份貼上執行。可重複執行，之後要升級再貼一次就好。
   （`supabase/schema.local-auth.sql` **不要**貼——那是本機測試用的替身，正式專案已內建 `auth`。）
3. Dashboard → **Settings → API**，複製 `Project URL` 與 `anon public` key。
4. GitHub repo → **Settings → Secrets and variables → Actions**，新增：
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
5. GitHub repo → **Settings → Pages → Source** 選 **GitHub Actions**。
6. 推到 `main`，Actions 會自動建置並部署。

本機開發的話，複製 `.env.example` 成 `.env.local` 填同樣兩個值。

### 讓登入信寄出六碼驗證碼

**這一步不做的話，主揪登入時會收到一條連結而不是驗證碼，然後卡住。**

Supabase 預設的 Magic Link 信件模板只有連結。到 Dashboard → **Authentication → Email Templates → Magic Link**，把內容改成含 `{{ .Token }}`：

```html
<h2>點名房間登入驗證碼</h2>
<p>你的驗證碼是：</p>
<p style="font-size:28px;font-weight:700;letter-spacing:6px">{{ .Token }}</p>
<p>這組碼一小時內有效。如果不是你要登入，忽略這封信就好。</p>
```

用驗證碼而不是魔術連結是刻意的：連結在信件 App 的內建瀏覽器開啟時會落在另一個瀏覽器工作階段，是很常見的失敗模式；輸入六碼永遠在同一台裝置上完成。

另外注意 Supabase 內建的寄信服務**額度很低**（免費方案每小時只有個位數封）。主揪一年登入幾次沒問題，但不要拿它當一般的通知管道。要更穩的話在 Authentication → SMTP Settings 接自己的寄信服務。

### 免費方案會被暫停

Supabase 免費專案閒置一段時間會自動暫停，而「一個月出遊一次」正好會踩到。
[`.github/workflows/keep-supabase-awake.yml`](.github/workflows/keep-supabase-awake.yml) 每週一會打一次極輕量的 `ping()` 把它叫醒，順手清掉過期房間。設好上面的 secrets 就會自動生效。

**出遊前一天請自己開一次房、掃一次 QR 確認能用。** 這個工具的使用時機極度集中且不能重來。

---

## 安全與隱私

這一節請完整讀過再拿去用在真實名單上。

- **房號就是密碼。** 拿到 6 碼房號的人就能看名單、能點名。這是「掃 QR 就能用、不用註冊」的代價，也是刻意的取捨。
- **房號有 6 碼、31 個字元**（排除易混淆的 `0 O 1 I L`），約 8.9 億組合。對「幾十人的教會活動、30 天後刪除」是合理的，但**它不是高強度機密，別放敏感資料**。
- **anon key 是公開的。** 它會被打包進 JS，任何人都看得到。真正保護資料的是 RLS——三張資料表都開啟 RLS 且**不建立任何 policy**，所以拿著 anon key 也無法直接讀寫任何一列；所有存取都必須經過要求房號的 RPC 函式。
- **破壞性操作需要「擁有權」**（改名單、複製、關閉、刪除），而擁有權有兩條路：
  - `owner_key` —— 開房那台裝置的隨機字串，存在它自己的 IndexedDB
  - `owner_id` —— 主揪登入後的帳號
  任一相符即可。所以**從來不登入的人完全不受影響**，登入的人換手機也拿得回房間。
- **登入只給主揪。** 協助點名的人永遠不需要帳號——掃 QR 就能點是這個產品的生命線。
- **函式授權是真的。** PostgreSQL 預設把 EXECUTE 授予 PUBLIC，schema 先全部收回再逐一授予，所以「只有清單上的函式對外開放」是被強制的，不是紙上規定。
- **房間 30 天後自動刪除**，連同名單與點名紀錄。這是刻意的：名單是個資，不該無限期留著。
- **單機模式的資料只在瀏覽器裡。** 清快取、換手機、無痕模式都會讓它消失。活動結束記得匯出。

---

## 開發

```bash
npm install
npm run dev           # 開發伺服器
npm test              # 單元測試
npm run build         # 型別檢查 + 產出 dist/
npm run preview       # 預覽 dist/

# 以下需要先 build + preview（見下方說明）
npm run audit:design  # 設計規範自動檢查
npm run e2e           # 單機模式端對端
```

設計規範與端對端要跑在建置產物上：

```bash
npm run build
npx vite preview --port 4173 --host 127.0.0.1 &
npm run audit:design
npm run e2e
```

驗證資料庫（需要本機 PostgreSQL）：

```bash
psql -d your_db -f supabase/schema.sql
psql -d your_db -f supabase/schema.test.sql
```

### 專案結構

```
src/
  lib/
    types.ts      資料型別
    code.ts       房號產生與驗證
    parse.ts      名單貼上解析          ← 有測試
    merge.ts      LWW 合併與統計         ← 有測試
    outbox.ts     待送佇列               ← 有測試
    export.ts     CSV 與結果文字         ← 有測試
    storage.ts    IndexedDB
    supabase.ts   RPC + Realtime
    store.ts      狀態與同步協調
    i18n.ts       中英文字串
  ui/             畫面元件
  router.ts       hash 路由
docs/design/         設計規範（模組化，見上）
scripts/
  design-audit.mjs   設計規範的執行期檢查
  e2e-local.mjs      單機模式端對端
  fake-supabase.mjs 同步測試用的假後端
  e2e-sync.mjs       兩台裝置同步測試
supabase/
  schema.sql      要貼到 Supabase 的那份
  schema.test.sql schema 的功能測試
docs/
  product-direction.md      產品方向與架構決策
  design-review-2026-08.md  設計評估報告與待決事項
```

### 設計規範是可執行的

[`docs/design/`](docs/design/) 不是風格建議，是規範。三層檢查各自抓不同的問題：

| 檢查 | 指令 | 驗什麼 |
| --- | --- | --- |
| Token 靜態檢查 | `npm test` | 原始碼有沒有繞過 token（硬寫色值、字級、z-index、動畫時間、rgba、opacity） |
| 規範一致性 | `npm test` | 規範裡提到的 token、class、檔案、元件是否真的存在——防止文件與程式漂移 |
| 執行期檢查 | `npm run audit:design` | 六個畫面、淺色深色各一次：對比（含祖先 `opacity`）、非文字元件對比、觸控尺寸、字級、無障礙名稱、橫向溢出 |

這套檢查建立時就抓到 16 處對比不足與 6 處過小的觸控目標，其中最嚴重的是**深色模式下「復原」按鈕只有 1.45:1** —— 誤觸的安全網幾乎看不見。現在全部歸零。

**檢查工具本身也會有盲點，發現一個就補一個。** 2026-08 的設計評估找到兩個：祖先的 `opacity` 讀不到（請假列的說明文字實際只有 2.5:1，工具說通過），以及沒有自己文字節點的元素整個被跳過（「未到」的空心圈只有 1.86:1，從來沒被驗過）。補上之後它立刻抓到第三個。細節見 [`docs/design-review-2026-08.md`](docs/design-review-2026-08.md) §2.4。

### 幾個實作上的取捨

- **不載入網路字型。** 字型檔會擋住爛網路上的首次渲染，而這個工具正好都在訊號差的地方用。
- **不用 `@supabase/supabase-js`，直接 `fetch` 打 PostgREST。** 一來完整 client 會把用不到的 auth/storage/functions 打包進來（主 bundle 從 315KB 降到 132KB），二來——更重要——`supabase-js` 沒有預設逾時，收訊差時一個請求可以把整條待送佇列吊死。自己發 fetch 才能掛 `AbortSignal.timeout`。
- **用 last-write-wins，不用 CRDT。** 這個領域的操作幾乎單調（人上了車就不會下車），狀態只是一個列舉值。`rev = max(已見過的 rev + 1, epoch ms)` 就夠了，而且出事時看資料就知道為什麼。
- **即時同步靠 Realtime 廣播，正確性靠定期對帳。** 廣播是盡力而為；每 15 秒與回到前景時各拉一次快照，保證收斂。
- **hash 路由。** GitHub Pages 對未知路徑回 404、沒有 SPA fallback，分享連結必須是 `#/j/房號` 才一定打得開。

### 常用名單

存在 Supabase、綁在該裝置的 `owner_key` 上，不跨裝置共用，也需要連線才能用。單機模式看不到這個功能。

---

## 已知限制

- 出席統計與月報還沒做（Phase 3 剩下的部分）。
- 登入信件靠 Supabase 內建寄信服務，額度低且可能進垃圾郵件；正式使用建議接自己的 SMTP。
- 沒有「把房間轉讓給別的主揪」的功能。
- 舊版的單檔 `index.html` 還在 git 歷史裡（commit `63eeaf1`）。

### 驗證多人同步（選用）

不需要真的 Supabase 專案也能測「兩台裝置看到同一份名單」——用本機 PostgreSQL 加一個 PostgREST 與 GoTrue 的轉發器：

```bash
# 1. 準備本機資料庫
createdb daka
psql -d daka -c "create role anon nologin; create role authenticated nologin;
                 grant usage on schema public to anon, authenticated;"
psql -d daka -f supabase/schema.local-auth.sql   # auth 替身，只有本機需要
psql -d daka -f supabase/schema.sql

# 2. 起轉發器
node scripts/fake-supabase.mjs   # 監聽 :54321

# 3. 用它建置並預覽
VITE_BASE=/ VITE_SUPABASE_URL=http://127.0.0.1:54321 \
  VITE_SUPABASE_ANON_KEY=test npx vite build --outDir dist-sync
VITE_BASE=/ npx vite preview --outDir dist-sync --port 4180 --host 127.0.0.1

# 4. 跑測試
node scripts/e2e-sync.mjs
```

```bash
# 帳號流程（換手機還管不管得動）
node scripts/e2e-account.mjs
```

涵蓋：分享連結加入同一間房、雙向即時反映、兩人同時點同一人不重複計算、離線點名後恢復連線自動補上、複製房間保留請假並重置已到、我改的被別人蓋掉時會被告知、以及登入後換一台裝置仍然管得動自己的房間。

`scripts/fake-supabase.mjs` 同時模擬 PostgREST 與 GoTrue，驗證碼固定 `123456`。它是測試替身，**不要拿去對外服務**。

（Realtime 廣播沒被涵蓋，本機沒有 realtime 伺服器。測的是每 15 秒的定期對帳——那本來就是正確性的依據，廣播只是讓它更快。）
