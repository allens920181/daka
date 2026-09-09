import type { ComponentChildren } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { connection, myRooms, prefs, recentRooms, session } from '../lib/store'
import { formatDate } from '../lib/format'
import { extractRoomCode, findConfusables, isValidRoomCode, CODE_LENGTH } from '../lib/code'
import { canScanQr } from '../lib/config'
import { isSupabaseConfigured } from '../lib/supabase'
import { navigate } from '../router'
import { IconCamera, IconChevronDown, IconMore, IconPlus, IconSettings } from './icons'
import { ScanSheet } from './Scan'
import { RoleBadge } from './RoleBadge'
import { RoomActionsSheet } from './Sheets'
import { useT } from './t'

type RoomFilter = 'all' | 'mine' | 'others'

interface RoomRow {
  code: string
  name: string
  isOwner: boolean
  removable: boolean
  meta: ComponentChildren
}

export function Home({ onSettings }: { onSettings: () => void }) {
  const t = useT()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [joinOpen, setJoinOpen] = useState(false)
  const [scanOpen, setScanOpen] = useState(false)
  const [filter, setFilter] = useState<RoomFilter>('all')
  const codeInputRef = useRef<HTMLInputElement>(null)

  // 按「加入空間」展開輸入框時把焦點直接放進去：不必再點第二下。
  useEffect(() => {
    if (joinOpen) codeInputRef.current?.focus()
  }, [joinOpen])

  function join() {
    const normalized = extractRoomCode(code)
    const confusables = findConfusables(normalized)
    if (confusables.length > 0) {
      setError(t('errConfusable', { chars: confusables.join('、') }))
      return
    }
    if (!isValidRoomCode(normalized)) {
      setError(t('errBadCode'))
      return
    }
    setError(null)
    navigate(`/j/${normalized}`)
  }

  const lang = prefs.value.lang

  // 登入之後「我的活動」與「最近的空間」是兩份各自維護的清單，主揪自己開的空間
  // 兩邊都有——不去重的話首頁會上下相鄰地把同一個空間印兩次。以「我的活動」為準。
  const ownedCodes = new Set(session.value ? myRooms.value.map((r) => r.code) : [])
  const localRooms = recentRooms.value.filter((r) => !ownedCodes.has(r.code))

  const rows: RoomRow[] = [
    ...myRooms.value.map((r) => ({
      code: r.code,
      name: r.name,
      isOwner: true,
      removable: false,
      meta: (
        <>
          <span class="mono">{r.code}</span>
          <span>{formatDate(r.created_at, lang)}</span>
          <span>{t('roomStat', { arrived: r.arrivedHeadcount, total: r.expectedHeadcount })}</span>
        </>
      ),
    })),
    ...localRooms.map((r) => ({
      code: r.code,
      name: r.name,
      isOwner: r.isOwner,
      removable: true,
      meta: (
        <>
          <span class="mono">{r.code}</span>
          <span>{formatDate(r.lastSeen, lang)}</span>
        </>
      ),
    })),
  ]
  const visibleRows = filter === 'all' ? rows : rows.filter((r) => (filter === 'mine' ? r.isOwner : !r.isOwner))
  const emptyText = filter === 'mine' ? t('myRoomsEmpty') : filter === 'others' ? t('noOtherRooms') : t('noRecentRooms')

  // 「創建空間」屬於「我的」——它生出來的空間就是主揪自己的；「加入空間」屬於
  // 「他人的」——會加進來的本來就是別人開的空間。「所有」是兩邊的聯集，兩顆
  // 都置頂。並排時各自 flex:1，單獨出現時滿版寬度跟底下的列對齊。
  const showCreate = filter !== 'others'
  const showJoin = filter !== 'mine'

  const createButton = (block: boolean) => (
    <button
      class={block ? 'btn btn-primary btn-lg btn-block' : 'btn btn-primary btn-lg'}
      style={block ? undefined : 'flex:1'}
      onClick={() => navigate('/new')}
    >
      <IconPlus /> {t('openRoom')}
    </button>
  )
  const joinButton = (block: boolean) => (
    <button
      class={block ? 'btn btn-lg btn-block' : 'btn btn-lg'}
      style={block ? undefined : 'flex:1'}
      aria-expanded={joinOpen}
      aria-controls="join-panel"
      onClick={() => setJoinOpen((v) => !v)}
    >
      {t('joinRoom')} <IconChevronDown class={`select-row-chevron${joinOpen ? ' is-open' : ''}`} />
    </button>
  )

  return (
    <div class="shell">
      <div class="home-head row">
        <div style="flex:1; min-width:0">
          <h1 class="home-title">{t('appName')}</h1>
          <p class="home-tagline">{t('tagline')}</p>
        </div>
        <button class="icon-btn" onClick={onSettings} aria-label={t('settings')}>
          <IconSettings />
        </button>
      </div>

      {connection.value === 'local-only' && (
        <p class="banner banner-muted">{t('localOnlyHint')}</p>
      )}

      <div class="stack">
        <div class="stack">
          <div class="segmented" role="group" aria-label={t('filter')}>
            <button class="segment" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
              {t('roomFilterAll')}
            </button>
            <button class="segment" aria-pressed={filter === 'mine'} onClick={() => setFilter('mine')}>
              {t('roomFilterMine')}
            </button>
            <button class="segment" aria-pressed={filter === 'others'} onClick={() => setFilter('others')}>
              {t('roomFilterOthers')}
            </button>
          </div>

          {showCreate && showJoin ? (
            <div class="row" style="gap:8px">
              {joinButton(false)}
              {createButton(false)}
            </div>
          ) : showCreate ? createButton(true) : joinButton(true)}

          {/*
            展開之後就是「打代碼」跟「掃碼」兩條路，沒有外框（2026-09）。

            這裡本來是一張 `.card` 包著代碼輸入框與兩顆滿版按鈕——**框中框中框**：
            上面那顆「加入空間」已經在宣告這一組東西了，再畫一個框只是把同一件事
            說第二次，而框裡每個元件又各自有自己的框。現在展開的內容直接接在那顆
            鍵底下，靠間距分組。
          */}
          {showJoin && joinOpen && (
            <div class="stack" id="join-panel">
                <input
                  ref={codeInputRef}
                  class="input code-input"
                  value={code}
                  // 沒有 maxLength：貼上的常常是整條連結，得讓 extractRoomCode 先從裡面
                  // 抓出代碼，原生的長度限制會在那之前就把後半段截斷。裁到固定長度
                  // 改成抓完代碼之後才做，抓出來的碼本來就只有 6 碼。
                  inputMode="text"
                  autocapitalize="characters"
                  autocomplete="off"
                  spellcheck={false}
                  aria-label={t('codePlaceholder')}
                  placeholder="——————"
                  onInput={(e) => {
                    const raw = (e.currentTarget as HTMLInputElement).value
                    setCode(extractRoomCode(raw).slice(0, CODE_LENGTH + 2))
                    setError(null)
                  }}
                  onKeyDown={(e) => { if (e.key === 'Enter') join() }}
                />
                {error && <p class="note note-warn">{error}</p>}
                {/*
                  兩條路並排，等寬：打代碼跟掃碼是同一件事的兩種做法，不是主要與
                  次要。它們本來各佔一列（而且掃碼那顆是 .btn-ghost，看起來像次要
                  的），合成一列省下一整列的高度。
                */}
                <div class="row">
                  <button
                    class="btn btn-block"
                    disabled={extractRoomCode(code).length < CODE_LENGTH}
                    onClick={join}
                  >
                    {t('join')}
                  </button>
                  {canScanQr() && (
                    <button class="btn btn-block" onClick={() => setScanOpen(true)}>
                      <IconCamera /> {t('scanQr')}
                    </button>
                  )}
                </div>
            </div>
          )}

          {scanOpen && <ScanSheet onClose={() => setScanOpen(false)} />}

          {/*
            空狀態是一句話，不是一個灰框（2026-09）：它旁邊已經有三個框了
            （分段控制、加入空間、展開的內容），再加一個只是讓這一頁更像一疊盒子。
          */}
          {visibleRows.length === 0 ? (
            <p class="hint">{emptyText}</p>
          ) : (
            <div class="stack" style="gap:8px">
              {visibleRows.map((r) => (
                <div class="recent-item" key={r.code}>
                  <button class="recent-main" onClick={() => navigate(`/r/${r.code}`)}>
                    {/* 身分排在名字前面（2026-09 從那一列最右邊的文字標籤換過來）：
                        它講的是「我」，比後面那個名字更早被讀到；而那一列最右邊
                        現在是「更多」的位置。 */}
                    <RoleBadge owner={r.isOwner} />
                    <div style="flex:1; min-width:0">
                      <div class="recent-name">{r.name}</div>
                      <div class="recent-meta">{r.meta}</div>
                    </div>
                  </button>
                  {/*
                    這裡原本是一顆垃圾桶（從清單移除），而且只長在移得掉的那幾列上。
                    它現在是每一列都有的「更多」，從清單移除搬進那份選單裡跟刪除空間
                    排在一起：兩顆看起來一樣的垃圾桶做的是兩件不同的事（一個只是不看
                    了，一個是真的刪掉），圖示分不出來，寫成兩列文字才分得出來。
                  */}
                  <MoreButton name={r.name} code={r.code} isOwner={r.isOwner} />
                </div>
              ))}
            </div>
          )}
        </div>

        {!isSupabaseConfigured && (
          <p class="hint" style="padding-bottom:40px">{t('errNotConfigured')}</p>
        )}
      </div>

    </div>
  )
}

/**
 * 清單每一列右邊那顆「更多」：**空間本身的事**（建立副本、刪除空間）。
 *
 * 它就在首頁打開（`RoomActionsSheet`），不進空間。這兩件事動的都是空間這個容器，
 * 不是裡面那份名單，所以不必先載入名單——它 2026-09 稍早曾經先把人帶進空間再打開
 * 空間自己那份清單，結果是按一顆「刪除空間」要先等整份名單同步完，再從一份大半
 * 用不到的清單裡找到最後一列。名單的事在空間裡那顆「更多」（`ManageSheet`）。
 *
 * 無障礙名稱要帶空間名字：一屏上有七顆一模一樣的「更多」時，只唸得出「更多」的
 * 那一顆是哪一個空間的完全聽不出來。
 */
function MoreButton({ name, code, isOwner }: { name: string; code: string; isOwner: boolean }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        class="icon-btn"
        aria-label={`${t('manage')}：${name}`}
        onClick={() => setOpen(true)}
      >
        <IconMore />
      </button>
      {open && (
        <RoomActionsSheet code={code} name={name} owner={isOwner} onClose={() => setOpen(false)} />
      )}
    </>
  )
}
