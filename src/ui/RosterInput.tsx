import { useMemo } from 'preact/hooks'
import { parseRoster, removeParsedMember } from '../lib/parse'
import type { DraftMember, SavedRoster } from '../lib/types'
import { rosterToText } from '../lib/parse'
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
            範例只在空的時候出現。第一次來的人面對的是一個空白框，說明再短也還是
            要先讀完才知道能貼什麼——按一下把範例填進去，下面的解析結果立刻自己
            說明了一切。有字之後它就只剩一個會蓋掉整份名單的按鈕，所以那時候不給。
          */}
          {!text.trim() && (
            <button class="btn btn-sm" onClick={() => onText(t('pasteExampleText'))}>
              {t('pasteExample')}
            </button>
          )}
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
