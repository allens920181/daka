# 點名房間

團體現場多人同步點名。開一間房，把 QR 給協助的人掃，大家一起點同一份名單，隨時知道誰還沒到。

為「教會上遊覽車出遊、團體入場、集合點名」這種**單次、現場、多人、講求速度**的場景而做——不是差勤系統。

- **五個人點同一份名單。** 每支手機看到的是同一份即時狀態，不會重複點也不會漏。
- **掃 QR 就能用。** 不用註冊、不用登入、不用安裝。
- **離線照樣點。** 停車場收訊差也能繼續，恢復連線自動補上。
- **「誰還沒到」是主畫面。** 未到的人直接一鍵撥號，結果一鍵複製貼回 LINE。
- **回程用複製房間。** 同一份名單、已到歸零、請假的維持請假。

產品方向與架構決策的完整說明在 [`docs/product-direction.md`](docs/product-direction.md)。

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

會自動辨識**編號與項目符號**、**全形數字與標點**、**`+1` / `帶2人` 攜伴**、**括號備註**、**台灣手機與市話**（含 `(02)` 區碼括號）。
備註寫「請假 / 不去 / 取消」的人會**直接標成請假**，不會混進未到清單被打電話。

解析結果在載入前會完整列出來讓你確認——解析器再寬容也會有猜錯的時候（例如把「秋季旅遊報名」這種標題當成人名），與其猜得更聰明，不如讓你一眼看到、直接改掉。

---

## 設定

### 不設定也能用

沒有連 Supabase 時，應用會自動退回**單機模式**：所有功能都在，只是名單只存在這支手機、其他人看不到。適合先試用，或一個人點名。

### 開啟多人同步

1. 到 [supabase.com](https://supabase.com) 開一個免費專案。
2. Dashboard → **SQL Editor** → 把 [`supabase/schema.sql`](supabase/schema.sql) 整份貼上執行。可重複執行，之後要升級再貼一次就好。
3. Dashboard → **Settings → API**，複製 `Project URL` 與 `anon public` key。
4. GitHub repo → **Settings → Secrets and variables → Actions**，新增：
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
5. GitHub repo → **Settings → Pages → Source** 選 **GitHub Actions**。
6. 推到 `main`，Actions 會自動建置並部署。

本機開發的話，複製 `.env.example` 成 `.env.local` 填同樣兩個值。

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
- **破壞性操作需要 `owner_key`**（改名單、複製、關閉、刪除），只有開房的那台裝置有。它存在該裝置的 IndexedDB 裡，換手機就沒了。
- **房間 30 天後自動刪除**，連同名單與點名紀錄。這是刻意的：名單是個資，不該無限期留著。
- **單機模式的資料只在瀏覽器裡。** 清快取、換手機、無痕模式都會讓它消失。活動結束記得匯出。

---

## 開發

```bash
npm install
npm run dev      # 開發伺服器
npm test         # 單元測試
npm run build    # 型別檢查 + 產出 dist/
npm run preview  # 預覽 dist/
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
supabase/
  schema.sql      要貼到 Supabase 的那份
  schema.test.sql schema 的功能測試
docs/
  product-direction.md   產品方向與架構決策
```

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

- 分車／分組、看板模式還沒做（資料庫已經有 `group_label` 欄位）。
- 常用名單不跨裝置。
- 沒有帳號系統，所以換手機就拿不回房主權限。
- 舊版的單檔 `index.html` 還在 git 歷史裡（commit `63eeaf1`）。

### 驗證多人同步（選用）

不需要真的 Supabase 專案也能測「兩台裝置看到同一份名單」——用本機 PostgreSQL 加一個 PostgREST 相容的轉發器：

```bash
npm i -D pg playwright            # 只有跑這個測試才需要

# 1. 準備本機資料庫
createdb daka
psql -d daka -c "create role anon nologin; grant usage on schema public to anon;"
psql -d daka -f supabase/schema.sql

# 2. 起轉發器
node scripts/fake-postgrest.mjs   # 監聽 :54321

# 3. 用它建置並預覽
VITE_BASE=/ VITE_SUPABASE_URL=http://127.0.0.1:54321 \
  VITE_SUPABASE_ANON_KEY=test npx vite build --outDir dist-sync
VITE_BASE=/ npx vite preview --outDir dist-sync --port 4180 --host 127.0.0.1

# 4. 跑測試
node scripts/e2e-sync.mjs
```

涵蓋：分享連結加入同一間房、雙向即時反映、兩人同時點同一人不重複計算、離線點名後恢復連線自動補上、複製房間保留請假並重置已到。

（Realtime 廣播沒被涵蓋，本機沒有 realtime 伺服器。測的是每 15 秒的定期對帳——那本來就是正確性的依據，廣播只是讓它更快。）
