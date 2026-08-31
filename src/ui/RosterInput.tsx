import { useMemo } from 'preact/hooks'
import { parseRoster } from '../lib/parse'
import type { DraftMember, SavedRoster } from '../lib/types'
import { rosterToText } from '../lib/parse'
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
        <label class="label" for="roster-text">{t('pasteRoster')}</label>
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
            <span class="hint mono">
              {t('parsedCount', { n: result.members.length })}
              {heads !== result.members.length && ` · ${t('parsedHeads', { n: heads })}`}
            </span>
          </div>

          <div class="preview">
            {result.members.map((m, i) => (
              <div class="preview-row" key={`${m.name}-${i}`}>
                <span class="preview-index mono">{i + 1}</span>
                <span style="flex:1; min-width:0">{m.name}</span>
                {m.phone && <span class="chip chip-data">{m.phone}</span>}
                {m.companions > 0 && <span class="chip chip-count">+{m.companions}</span>}
                {m.note && <span class="chip chip-note">{m.note}</span>}
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
