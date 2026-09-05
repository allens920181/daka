import { useEffect, useMemo, useState } from 'preact/hooks'
import { createRoom, savedRosters } from '../lib/store'
import { clearDraft, loadDraft, saveDraft } from '../lib/storage'
import { isExampleName, isExampleRoster } from '../lib/i18n'
import { parseRoster, rosterToText } from '../lib/parse'
import { AppError, isSupabaseConfigured } from '../lib/supabase'
import { navigate } from '../router'
import { RosterEditorField, RosterPreview } from './RosterInput'
import { Sheet } from './Sheet'
import { IconBack, IconBookmark, IconChevronDown, IconChevronUp, IconMore, IconTrash } from './icons'
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
  const [moreOpen, setMoreOpen] = useState(false)
  // 「更多」有東西可看才給按鈕：草稿跟常用名單都沒有的話，開了也是空面板。
  const showMore = restored || isSupabaseConfigured

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
    setMoreOpen(false)
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
            {step === 'input' && showMore && (
              <>
                <div class="spacer" />
                <button class="icon-btn" onClick={() => setMoreOpen(true)} aria-label={t('manage')}>
                  <IconMore />
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
            {error && <p class="note note-warn">{error}</p>}
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
              {t('generateList')} <IconChevronDown />
            </button>
          ) : (
            <>
              <button class="btn btn-lg" disabled={working} onClick={() => setStep('input')}>
                <IconChevronUp /> {t('adjustList')}
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

      {moreOpen && (
        <Sheet title={t('manage')} onClose={() => setMoreOpen(false)}>
          <div class="stack">
            {restored && (
              <button class="menu-item" onClick={discardDraft}>
                <IconTrash />
                <span>
                  <strong>{t('draftLabel')}</strong>
                  <span class="sub">{t('draftDiscard')}</span>
                </span>
              </button>
            )}

            {isSupabaseConfigured && (
              <div class="field">
                <span class="label">{t('savedRosters')}</span>
                {savedRosters.value.length > 0 ? (
                  <div class="menu">
                    {savedRosters.value.map((r) => (
                      <button
                        key={r.id}
                        class="menu-item"
                        onClick={() => { setText(rosterToText(r.members)); setMoreOpen(false) }}
                      >
                        <IconBookmark />
                        <span>
                          <strong>{r.name}</strong>
                          <span class="sub">{t('parsedCount', { n: r.members.length })}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p class="note">{t('noSavedRosters')}</p>
                )}
              </div>
            )}
          </div>
        </Sheet>
      )}
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
