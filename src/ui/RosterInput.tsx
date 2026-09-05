import { useMemo } from 'preact/hooks'
import { parseRoster, removeParsedMember } from '../lib/parse'
import type { ParseResult } from '../lib/parse'
import type { DraftMember } from '../lib/types'
import { IconClose } from './icons'
import { useT } from './t'

/**
 * 名單輸入框：只有貼上欄位，不含解析預覽——開空間流程把預覽挪去另一步
 * （見 NewRoom），這裡只管「打字／貼上」這件事，好讓框本身可以長大。常用
 * 名單也不在這裡：那是「套用一份別人的名單」，跟「打字」是兩個不同的動作，
 * 搬進開空間的「更多」面板（見 NewRoom 的 `MoreSheet`）。
 */
export function RosterEditorField({
  text, onText,
}: {
  text: string
  onText: (v: string) => void
}) {
  const t = useT()
  return (
    <div class="stack roster-editor">
      {/* 範例鍵不在這裡：它一次填活動名稱與名單兩格，所以住在表單那一層
          （`NewRoom`），而不是掛在其中一個欄位的標籤上。 */}
      <div class="field roster-editor-field">
        <label class="label" for="roster-text">{t('pasteRoster')}</label>
        <textarea
          id="roster-text"
          class="textarea roster-editor-textarea"
          value={text}
          placeholder={t('pastePlaceholder')}
          onInput={(e) => onText((e.currentTarget as HTMLTextAreaElement).value)}
        />
      </div>
    </div>
  )
}

/**
 * 解析結果預覽。刻意把結果攤開來給人看——解析器再寬容也會有猜錯的時候
 * （例如把「秋季旅遊報名」這種標題當成人名），與其猜得更聰明，不如讓主揪
 * 一眼看到、直接改掉。
 */
export function RosterPreview({
  text, onText, result,
}: {
  text: string
  onText: (v: string) => void
  result: ParseResult
}) {
  const t = useT()
  return (
    <div class="stack">
      {result.members.length > 0 && (
        <div class="field">
          <div class="row">
            <span class="label">{t('parsePreview')}</span>
            <div class="spacer" />
            {/* 整句中文不套 .mono：等寬的空白會把句子撐出不自然的縫。
                等寬只給真正需要對齊的數字與代碼。 */}
            <span class="hint">{t('parsedCount', { n: result.members.length })}</span>
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

/**
 * 名單輸入的合併版：欄位與預覽疊在同一面板。用在空間比較小、不值得拆兩步的
 * 場合（例如「更多」面板裡改名單）——`NewRoom` 的開空間流程改用拆開的
 * `RosterEditorField` / `RosterPreview`，好讓輸入框跟預覽各自有整面螢幕可以用。
 */
export function RosterInput({
  text, onText,
}: {
  text: string
  onText: (v: string) => void
}) {
  const result = useMemo(() => parseRoster(text), [text])
  return (
    <div class="stack">
      <RosterEditorField text={text} onText={onText} />
      <RosterPreview text={text} onText={onText} result={result} />
    </div>
  )
}

export function draftsFrom(text: string): DraftMember[] {
  return parseRoster(text).members
}
