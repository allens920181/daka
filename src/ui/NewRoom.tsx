import { useEffect, useState } from 'preact/hooks'
import { createRoom, savedRosters } from '../lib/store'
import { clearDraft, loadDraft, saveDraft } from '../lib/storage'
import { isExampleName, isExampleRoster } from '../lib/i18n'
import { AppError, isSupabaseConfigured } from '../lib/supabase'
import { navigate } from '../router'
import { RosterInput, draftsFrom } from './RosterInput'
import { IconBack } from './icons'
import { useT } from './t'

export function NewRoom() {
  const t = useT()
  const [name, setName] = useState('')
  const [text, setText] = useState('')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [restored, setRestored] = useState(false)

  const drafts = draftsFrom(text)

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
      <div class="topbar">
        <div class="shell topbar-inner">
          <button class="icon-btn" onClick={() => navigate('/')} aria-label={t('back')}>
            <IconBack />
          </button>
          <h1 class="topbar-name">{t('openRoom')}</h1>
        </div>
      </div>

      <div class="shell stack" style="padding-top:16px; padding-bottom:120px">
        {restored && (
          <p class="banner banner-muted">
            {t('draftRestored')}
            <button
              class="btn btn-sm"
              onClick={() => { setName(''); setText(''); setRestored(false); void clearDraft() }}
            >
              {t('draftDiscard')}
            </button>
          </p>
        )}

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

        <RosterInput
          text={text}
          onText={setText}
          rosters={isSupabaseConfigured ? savedRosters.value : undefined}
        />

        {error && <p class="note note-warn">{error}</p>}
      </div>

      <div class="dock">
        <div class="dock-inner">
          <button
            class="btn btn-primary btn-lg btn-block"
            disabled={working || drafts.length === 0}
            onClick={() => { void submit() }}
          >
            {working ? t('loading') : drafts.length ? `${t('create')} ${drafts.length}` : t('create')}
          </button>
        </div>
      </div>
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
