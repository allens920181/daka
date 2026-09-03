import { useMemo } from 'preact/hooks'
import { parseRoster, removeParsedMember } from '../lib/parse'
import type { DraftMember, SavedRoster } from '../lib/types'
import { rosterToText } from '../lib/parse'
import { isExampleRoster } from '../lib/i18n'
import { IconClose } from './icons'
import { useT } from './t'

/**
 * 名單輸入。刻意在載入前就把解析結果攤開來給人看——
 * 解析器再寬容也會有猜錯的時候（例如把「秋季旅遊報名」這種標題當成人名），
 * 與其猜得更聰明，不如讓主揪一眼看到、直接改掉。
 */
export function RosterInput({
  text, onText, rosters,
}: {
  text: string
  onText: (v: string) => void
  rosters?: readonly SavedRoster[]
}) {
  const t = useT()
  const result = useMemo(() => parseRoster(text), [text])
  const heads = result.members.reduce((n, m) => n + 1 + m.companions, 0)

  return (
    <div class="stack">
      {rosters && rosters.length > 0 && (
        <div class="field">
          <span class="label">{t('savedRosters')}</span>
          <div class="row" style="flex-wrap: wrap; gap: 8px">
            {rosters.map((r) => (
              <button
                key={r.id}
                class="btn btn-sm"
                onClick={() => onText(rosterToText(r.members))}
              >
                {r.name}
                <span class="mono" style="color: var(--ink-3)"> {r.members.length}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div class="field">
        <div class="row">
          <label class="label" for="roster-text">{t('pasteRoster')}</label>
          <div class="spacer" />
          {/*
            同一個位置上的兩個狀態，都只在該給的時候給：

            空的時候給「填入範例」。第一次來的人面對的是一個空白框，說明再短也
            還是要先讀完才知道能貼什麼——按一下把範例填進去，下面的解析結果立刻
            自己說明了一切。

            範例還原封不動時給「清除範例」。看完就該能收乾淨，而不是自己去把六行
            字選起來刪掉。反過來說，只要使用者動手改過一個字，它就必須消失：那時
            候按下去清掉的已經是他自己的東西，而按鈕長得一模一樣。所以判準是逐字
            相同（`isExampleRoster`），不是「現在有沒有字」。
          */}
          {!text.trim() ? (
            <button class="btn btn-sm" onClick={() => onText(t('pasteExampleText'))}>
              {t('pasteExample')}
            </button>
          ) : isExampleRoster(text) ? (
            <button class="btn btn-sm" onClick={() => onText('')}>
              {t('pasteExampleClear')}
            </button>
          ) : null}
        </div>
        <textarea
          id="roster-text"
          class="textarea"
          value={text}
          placeholder={t('pastePlaceholder')}
          onInput={(e) => onText((e.currentTarget as HTMLTextAreaElement).value)}
        />
      </div>

      {result.members.length > 0 && (
        <div class="field">
          <div class="row">
            <span class="label">{t('parsePreview')}</span>
            <div class="spacer" />
            {/* 整句中文不套 .mono：等寬的空白會把句子撐出不自然的縫。
                等寬只給真正需要對齊的數字與代碼。 */}
            <span class="hint">
              {t('parsedCount', { n: result.members.length })}
              {heads !== result.members.length && ` · ${t('parsedHeads', { n: heads })}`}
            </span>
          </div>

          {/*
            每一列都可以拿掉。解析器刻意不自動猜（「秋季旅遊報名」該不該算一個
            人，機器判斷不了），但以前預覽只給看不給改——猜錯的那幾列會一路
            留到現場與紙本，變成永遠不會被打勾的幽靈成員，於是「還有 N 位沒到」
            永遠歸不了零。文字仍然是唯一的真相：移除是去改那段文字。
          */}
          <div class="preview">
            {result.members.map((m, i) => (
              <div class="preview-row" key={`${m.name}-${i}`}>
                <span class="preview-index mono">{i + 1}</span>
                <span style="flex:1; min-width:0">{m.name}</span>
                {m.phone && <span class="chip chip-data">{m.phone}</span>}
                {m.companions > 0 && <span class="chip chip-count">+{m.companions}</span>}
                {m.note && <span class="chip chip-note">{m.note}</span>}
                <button
                  class="icon-btn preview-remove"
                  aria-label={t('removeFromPreview', { name: m.name })}
                  onClick={() => {
                    const src = result.sources[i]
                    if (src) onText(removeParsedMember(text, src))
                  }}
                >
                  <IconClose size={20} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {result.duplicateNames.length > 0 && (
        <p class="note note-warn">
          {t('duplicateWarning', { names: result.duplicateNames.join('、') })}
        </p>
      )}
      {result.skipped > 0 && (
        <p class="note">{t('skippedLines', { n: result.skipped })}</p>
      )}
    </div>
  )
}

export function draftsFrom(text: string): DraftMember[] {
  return parseRoster(text).members
}
