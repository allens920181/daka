# 元件 · 回饋

### 空狀態 `.empty`

**用途** — 名單為空或篩選後沒有結果時，說明為什麼、以及可以做什麼。

**規則** — 虛線邊框、置中、`--sp-7` 上下留白。**不放插圖**（見 [02 品牌](../02-brand.md)：不搶戲）。

**內容規則** — 空狀態要分辨「沒有資料」和「任務完成」：

| 情況 | 文案 |
| --- | --- |
| 「未到」篩選下沒有人 | **「太好了，全部都到了」** — 這是成功，不是空 |
| 搜尋沒有結果 | 「這裡沒有人」 |
| 還沒有房間 | 「還沒有房間。開一間，或用房號加入別人的。」 |

**實作** — `src/ui/Room.tsx`、`src/ui/Home.tsx`

---

### 載入骨架 `.skeleton-row`

**用途** — 進入房間時顯示即將出現的形狀。

**不要用在** — 少於 300ms 的等待（閃一下比等待更擾人），或不確定會出現什麼的情況。

**規則** — 五列，高度等於 `--tap-row`，依序延遲 90ms 呼吸（`--dur-ambient`）。reduced-motion 下不動但仍顯示。

**無障礙契約** — 容器 `role="status"` + `aria-busy="true"` + `aria-label`；骨架本身 `aria-hidden="true"`。

**實作** — `src/ui/Room.tsx`（`RoomSkeleton`）

---

### 提示框 `.note` / 橫幅 `.banner`

**用途** — 就地說明狀況。`.note` 貼在相關控制項旁；`.banner` 說明整個畫面的狀態。

**變體**

| 類別 | 底 / 字 | 用途 |
| --- | --- | --- |
| `.note` | `--surface-2` / `--ink-2` | 中性說明 |
| `.note-warn` `.banner-warn` | `--fb-warn-soft` / `--fb-warn` | 需要注意：離線、房間已關閉、換名單會清除紀錄 |
| `.note-error` | `--fb-error-soft` / `--fb-error` | 操作失敗 |
| `.banner-muted` | `--surface-2` / `--ink-2` | 資訊：單機模式 |

**內容規則** — 錯誤一定要含「怎麼辦」。詳見 [06 內容](../06-content.md)。

**實作** — `src/styles.css`

---

### 進度條 `.progress`

**用途** — 已到人頭佔總人頭的比例。

**不要用在** — 不確定長度的等待（那用骨架）。

**規則** — 高 6px、`--r-full`、填色 `--st-arrived`、寬度變化 `--dur-2`。0% 時只顯示軌道。

**無障礙契約** — `role="progressbar"`、`aria-valuenow/min/max`，`aria-label` 帶**實際人數**而不只是百分比。

**實作** — `src/ui/Room.tsx`
