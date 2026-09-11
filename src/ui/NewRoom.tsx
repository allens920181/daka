import { useEffect, useMemo, useState } from 'preact/hooks'
import { createRoom } from '../lib/store'
import { clearDraft, loadDraft, saveDraft } from '../lib/storage'
import { isExampleName, isExampleRoster } from '../lib/i18n'
import { parseRoster, rosterToText } from '../lib/parse'
import { AppError, isSupabaseConfigured } from '../lib/supabase'
import { navigate } from '../router'
import { RosterEditorField, RosterPreview } from './RosterInput'
import { ConfirmDialog } from './Sheet'
import { FormatHelpSheet, SavedRostersSheet } from './Sheets'
import { IconBack, IconBookmark, IconChevronRight, IconHelp } from './icons'
import { useT } from './t'

export function NewRoom() {
  const t = useT()
  const [name, setName] = useState('')
  const [text, setText] = useState('')
  /* 兩步驟：input 貼名單、list 看解析結果再確認。純畫面狀態，不影響 name/text
     本身——滑回 input 改字，滑去 list 一樣看得到最新結果。 */
  const [step, setStep] = useState<'input' | 'list'>('input')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [restored, setRestored] = useState(false)
  const [savedRostersOpen, setSavedRostersOpen] = useState(false)
  const [formatHelpOpen, setFormatHelpOpen] = useState(false)

  const result = useMemo(() => parseRoster(text), [text])
  const drafts = result.members

  // 開空間失敗（訊號差時很常見）之後只要切去 LINE 再切回來，PWA 就可能已經
  // 重載。那份剛貼好的 200 人名單不能就這樣沒了。
  useEffect(() => {
    let alive = true
    void loadDraft().then((d) => {
      if (!alive || !d) return
      setName(d.name)
      setText(d.text)
      setRestored(true)
    })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (!name.trim() && !text.trim()) return
    const id = setTimeout(() => { void saveDraft(name, text) }, 500)
    return () => clearTimeout(id)
  }, [name, text])

  /*
   * 範例填的是整張表：活動名稱一格、名單一份，按一下就看得到一個完整的空間長
   * 什麼樣——而不是只有下面那個框裡多了六行字。所以按鈕放在表單最上面這一列，
   * 兩格都歸它管。
   *
   * 兩個方向都守同一條線：**不碰使用者自己打的字**。填的時候只填空的那格（先
   * 打了活動名稱再想看範例的人很常見，那個名字不該被蓋掉）；清的時候只清還跟
   * 範例逐字相同的那格。差這一格，這顆按鈕就會從「取消範例」悄悄變成「清空我
   * 剛貼好的 200 人名單」，而畫面上長得一模一樣。
   */
  function fillExample() {
    if (!name.trim()) setName(t('exampleName'))
    setText(t('exampleRoster'))
  }

  function clearExample() {
    if (isExampleName(name)) setName('')
    setText('')
  }

  function discardDraft() {
    setName('')
    setText('')
    setRestored(false)
    void clearDraft()
  }

  function reviewList() {
    if (drafts.length === 0) return
    // 收鍵盤再滑：清單畫面滑上來時鍵盤還開著，會把剛露出來的名單再擠掉一截。
    const active = document.activeElement
    if (active instanceof HTMLElement) active.blur()
    setError(null)
    setStep('list')
  }

  async function submit() {
    if (drafts.length === 0) { setError(t('emptyRoster')); return }
    setWorking(true)
    setError(null)
    try {
      const code = await createRoom(name, drafts)
      void clearDraft()
      navigate(`/r/${code}`, { replace: true })
    } catch (e) {
      // 存一份再報錯：錯誤訊息會告訴使用者名單還留著，那句話必須是真的。
      await saveDraft(name, text)
      setError(errorMessage(e, t, 'create'))
      setWorking(false)
    }
  }

  return (
    <>
      <div class={step === 'list' ? 'room-flow is-list' : 'room-flow'}>
        <div class="topbar">
          <div class="shell topbar-inner">
            <button
              class="icon-btn"
              onClick={() => (step === 'list' ? setStep('input') : navigate('/'))}
              aria-label={t('back')}
            >
              <IconBack />
            </button>
            <h1 class="topbar-name">{t('openRoom')}</h1>
            {/*
              「名單怎麼寫」貼著標題，不在最右邊那一排。右邊住的是**動作**
              （常用名單），而這顆不做事——它解釋這一頁。放在標題旁邊，它讀起來
              就是「創建空間？這是什麼」，位置自己說出了它的作用。

              兩個步驟都給：貼名單的時候問的是「該怎麼寫」，看解析結果的時候問的
              是「為什麼變成這樣」——同一頁答得了兩種問題，而後者才是人真的會伸手
              去找說明的時刻。
            */}
            <button
              class="icon-btn fmt-help-btn"
              onClick={() => setFormatHelpOpen(true)}
              aria-label={t('formatHelp')}
            >
              <IconHelp />
            </button>
            {step === 'input' && isSupabaseConfigured && (
              <>
                <div class="spacer" />
                <button class="icon-btn" onClick={() => setSavedRostersOpen(true)} aria-label={t('savedRosters')}>
                  <IconBookmark />
                </button>
              </>
            )}
          </div>
        </div>

        <div class="room-flow-stage">
          {/* 步驟一：貼名單。刻意不放解析預覽——框要多大有多大，貼 200 人的名單
              時不必看著它被下面的預覽擠成一截。 */}
          <div
            class="room-flow-panel room-flow-panel-input"
            aria-hidden={step !== 'input'}
            inert={step !== 'input'}
          >
            <div class="field">
              <div class="row">
                <label class="label" for="room-name">{t('roomNameLabel')}</label>
                <div class="spacer" />
                {/* 名單還空著就給「填入範例」，範例原封不動就給「清除範例」，
                    使用者一動手改就兩顆都不給——那時候框裡的是他自己的東西。 */}
                {!text.trim() ? (
                  <button class="btn btn-sm" onClick={fillExample}>{t('exampleFill')}</button>
                ) : isExampleRoster(text) ? (
                  <button class="btn btn-sm" onClick={clearExample}>{t('exampleClear')}</button>
                ) : null}
              </div>
              <input
                id="room-name"
                class="input"
                value={name}
                maxLength={80}
                placeholder={t('roomNamePlaceholder')}
                // iOS 的 return 鍵會變成「下一個」。**所以 Enter 真的要跳到下一欄**
                // ——鍵上寫什麼，按下去就得發生什麼，不然那顆鍵是在說謊。
                // 下一欄是名單，它住在 RosterEditorField 裡面，用 id 取（label 的
                // `for` 本來就綁著這個 id，多一個 ref 只是把同一件事再說一次）。
                enterkeyhint="next"
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return
                  e.preventDefault()
                  document.getElementById('roster-text')?.focus()
                }}
                onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
              />
            </div>

            <RosterEditorField text={text} onText={setText} />
          </div>

          {/* 步驟二：看解析結果。從螢幕下緣滑上來蓋住步驟一，「抬頭」跟著名單
              一起露出來，所以再貼一次名字當標題，不用滑回上面才看得到活動叫什麼。 */}
          <div
            class="room-flow-panel room-flow-panel-list"
            aria-hidden={step !== 'list'}
            inert={step !== 'list'}
          >
            <h2 class="room-flow-title">{name.trim() || t('roomNameLabel')}</h2>
            <RosterPreview text={text} onText={setText} result={result} />
            {error && <p class="note note-error">{error}</p>}
          </div>
        </div>
      </div>

      <div class="dock">
        <div class="dock-inner">
          {step === 'input' ? (
            <button
              class="btn btn-primary btn-lg btn-block"
              disabled={drafts.length === 0}
              onClick={reviewList}
            >
              {/*
                **箭頭指的是你會往哪裡去。** 這兩顆 2026-09 從 `⌄`／`⌃` 換成 `›`／`‹`：
                它們是在兩個步驟之間移動（貼名單 ↔ 看名單），不是在原地把東西打開。
                `⌄` 在這個 app 裡只有一個意思——**就地展開**（設定列那四顆）——
                而這裡借用它，等於同一個記號給了兩種承諾。

                面板實際上是從下緣滑上來的，但那是進場動畫，不是心智模型：使用者
                想的是「下一步／回上一步」，而這個 app 的「回上一步」已經有一個
                長得就是 `‹` 的記號（`IconBack`，頂欄與面板返回都是它）。
              */}
              {t('generateList')} <IconChevronRight size={16} />
            </button>
          ) : (
            <>
              <button class="btn btn-lg" disabled={working} onClick={() => setStep('input')}>
                <IconBack size={16} /> {t('adjustList')}
              </button>
              <button
                class="btn btn-primary btn-lg btn-block"
                disabled={working || drafts.length === 0}
                onClick={() => { void submit() }}
              >
                {working ? t('loading') : drafts.length ? `${t('confirmCreate')} ${drafts.length}` : t('confirmCreate')}
              </button>
            </>
          )}
        </div>
      </div>

      {/* 草稿一偵測到就當場問，不是放著等人自己找到「常用」旁邊的入口才決定。
          取消鍵（安全、Esc／點背景都會落在這一邊）留給「繼續使用」；
          「清掉重來」要按下那顆鍵才會發生，見 Sheet.tsx 的 `cancelLabel`。 */}
      {restored && (
        <ConfirmDialog
          title={t('draftPromptTitle')}
          body={t('draftPromptBody')}
          confirmLabel={t('draftDiscard')}
          cancelLabel={t('draftKeep')}
          onClose={() => setRestored(false)}
          onConfirm={discardDraft}
        />
      )}

      {savedRostersOpen && (
        <SavedRostersSheet
          onApply={(r) => { setText(rosterToText(r.members, t('ungrouped'))); setSavedRostersOpen(false) }}
          onClose={() => setSavedRostersOpen(false)}
        />
      )}
      {formatHelpOpen && <FormatHelpSheet onClose={() => setFormatHelpOpen(false)} />}
    </>
  )
}

/**
 * 錯誤訊息。`where` 決定同一種錯誤要怎麼講——「連不上網路」在開空間、進空間、
 * 改名單三個地方的後果完全不同，共用一句話一定會有兩個地方在說謊。
 */
export function errorMessage(
  e: unknown,
  t: ReturnType<typeof useT>,
  where: 'create' | 'join' | 'generic' = 'generic',
): string {
  if (!(e instanceof AppError)) return t('errUnknown')
  switch (e.kind) {
    case 'offline':
      return where === 'create' ? t('errOfflineCreate')
        : where === 'join' ? t('errJoinOffline')
        : t('errOffline')
    case 'room-not-found': return t('errRoomNotFound')
    case 'room-closed': return t('errRoomClosed')
    case 'not-owner': return t('errNotOwner')
    // 單機模式下輸入別人的代碼：問題不在代碼，在這個站台沒有雲端。
    case 'not-configured': return where === 'join' ? t('errJoinLocalOnly') : t('errNotConfigured')
    case 'too-many-members': return t('errTooMany')
    default: return t('errUnknown')
  }
}
