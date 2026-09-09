import type { ComponentChildren } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { connection, myRooms, prefs, recentRooms, session } from '../lib/store'
import { formatDate } from '../lib/format'
import { extractRoomCode, findConfusables, isValidRoomCode, CODE_LENGTH } from '../lib/code'
import { canScanQr } from '../lib/config'
import { navigate } from '../router'
import { IconCamera, IconMore, IconPlus, IconSettings } from './icons'
import { ScanView } from './Scan'
import { RoleBadge } from './RoleBadge'
import { Sheet } from './Sheet'
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
  const [joinOpen, setJoinOpen] = useState(false)
  const [filter, setFilter] = useState<RoomFilter>('all')

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
  /*
    篩選那一列只在有兩個以上的空間時才出現（見底下的註解），所以套用的一律是
    `active`：清單被刪到剩一個時那一列會收起來，而使用者上一次選的「他人的」
    不能就這樣留在畫面外面繼續生效——那會變成一個看不見的篩選在藏東西。
  */
  const filterVisible = rows.length > 1
  const active: RoomFilter = filterVisible ? filter : 'all'
  const visibleRows = active === 'all' ? rows : rows.filter((r) => (active === 'mine' ? r.isOwner : !r.isOwner))
  const emptyText = active === 'mine' ? t('myRoomsEmpty') : active === 'others' ? t('noOtherRooms') : t('noRecentRooms')

  // 「創建空間」屬於「我的」——它生出來的空間就是主揪自己的；「加入空間」屬於
  // 「他人的」——會加進來的本來就是別人開的空間。「所有」是兩邊的聯集，兩顆
  // 都置頂。並排時各自 flex:1，單獨出現時滿版寬度跟底下的列對齊。
  const showCreate = active !== 'others'
  const showJoin = active !== 'mine'

  const createButton = (block: boolean) => (
    <button
      class={block ? 'btn btn-primary btn-lg btn-block' : 'btn btn-primary btn-lg'}
      style={block ? undefined : 'flex:1'}
      onClick={() => navigate('/new')}
    >
      <IconPlus /> {t('openRoom')}
    </button>
  )
  /*
    「加入空間」開的是一張從下緣長上來的面板（2026-09），不再是就地展開的一段
    內容。理由是**這個 app 只有一種「再給我一層」的形狀**：設定、更多、邀請、
    掃碼、空間的事⋯⋯全部都是底部面板，只有這裡是自己一套就地展開。

    連帶三件事跟著對齊：
    - **它現在有標題列**（「加入空間」），而就地展開時那個標題只能靠上面那顆
      按鈕的字兼任。
    - **關掉的路變成三條**（點面板外面、Esc、從握把往下滑），而不是只有「再按
      一次那顆鍵」。
    - **背景真的變成 inert**：就地展開的時候，底下那份空間清單仍然按得到、
      螢幕閱讀器也仍然讀得到。

    箭頭跟著拿掉：`⌄` 說的是「在這裡展開」，而它現在不在這裡展開。
    `aria-haspopup="dialog"` 才是「按下去會開一層」的正確說法（面板是
    `role="dialog" aria-modal`）。
  */
  const joinButton = (block: boolean) => (
    <button
      class={block ? 'btn btn-lg btn-block' : 'btn btn-lg'}
      style={block ? undefined : 'flex:1'}
      aria-haspopup="dialog"
      onClick={() => setJoinOpen(true)}
    >
      {t('joinRoom')}
    </button>
  )

  return (
    <>
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
          {/*
            篩選只在真的有東西可以篩的時候才出現（2026-09）。

            它本來永遠都在，於是**第一次打開這個 app 的人，看到的第一個東西是一組
            三段的篩選器**——為一份空清單準備的。那條 56px 的控制項比它下面那顆
            「創建空間」還早被讀到，而它在那個當下一件事都做不到。只有一個空間時
            也一樣：三選一之後還是那一列。

            門檻放在「兩個以上」，不是「一個以上」：一個空間不需要篩選，而
            `rows.length` 是篩選前的總數，所以這一列不會因為自己篩掉了東西而消失。
            它收起來的時候 filter 一定停在 all（沒有人改得動它），所以底下那兩顆
            按鈕會同時在——這正是空手起步時該有的畫面。
          */}
          {filterVisible && (
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
          )}

          {showCreate && showJoin ? (
            <div class="row" style="gap:8px">
              {joinButton(false)}
              {createButton(false)}
            </div>
          ) : showCreate ? createButton(true) : joinButton(true)}

          {/*
            空狀態是一句話，不是一個灰框（2026-09）：它旁邊已經有兩個框了
            （分段控制、加入空間），再加一個只是讓這一頁更像一疊盒子。
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
      </div>

      {/*
        面板掛在 `.shell` 外面，不是裡面。`useModal` 是靠「遮罩層的祖父」去找該加
        inert 的兄弟節點的（見 useModal.ts）——掛在 `.shell` 裡面的話它只 inert 得到
        那一層裡的東西，標題列與清單仍然按得到、螢幕閱讀器也仍然讀得到。App 那一層
        的 `SettingsSheet` 與空間畫面的每一張面板都是這樣掛的。
      */}
      {joinOpen && <JoinSheet onClose={() => setJoinOpen(false)} />}
    </>
  )
}

type JoinMode = 'code' | 'scan'

/**
 * 加入別人的空間：**打代碼**或**掃碼**，兩條路一張面板。
 *
 * 掃碼是這張面板的第二頁，不是疊上去的另一張面板（左上角一顆返回鍵，跟
 * 「更多 › 邀請點名 › 二維碼」同一套）。面板疊面板是這個 app 沒有過的形狀，
 * 兩層遮罩也重；而相機的開關綁在 `ScanView` 的生命週期上，返回就是卸載，
 * 串流跟著關掉。
 *
 * **代碼在關掉面板時清空**（狀態住在這裡，不在 `Home`）。就地展開的那一版會把
 * 打到一半的字留著，而面板的心智模型是「這件事我做完了／不做了」——留著一個看不見
 * 的半成品，下次打開會看到自己不記得打過的四個字。六碼重打的成本很低。
 */
function JoinSheet({ onClose }: { onClose: () => void }) {
  const t = useT()
  const [mode, setMode] = useState<JoinMode>('code')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const codeInputRef = useRef<HTMLInputElement>(null)

  /*
    開起來就聚焦到代碼框——按下「加入空間」的下一個動作就是打那六碼，跳出鍵盤是
    那顆按鍵的直接結果（跟空間裡那顆放大鏡同一條理由）。

    `useModal` 會先把焦點放到面板裡第一個可聚焦的東西（那顆關閉鍵），這個 effect
    在它之後跑（子元件的 effect 先於父元件），所以最後停在輸入框上。回到第一頁時
    也要再聚焦一次，不然從掃碼頁按返回會落在返回鍵上。
  */
  useEffect(() => { if (mode === 'code') codeInputRef.current?.focus() }, [mode])

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

  if (mode === 'scan') {
    return (
      <Sheet title={t('scanQr')} onClose={onClose} onBack={() => setMode('code')}>
        <ScanView />
      </Sheet>
    )
  }

  return (
    <Sheet title={t('joinRoom')} onClose={onClose}>
      <div class="stack">
        {/*
          兩條路各一列（2026-09）：**打代碼＋加入**是同一件事的兩半，擺在同一列
          才看得出「打進去、按這裡」；**掃碼**是另一條路，自己一列。
        */}
        <div class="row">
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
          {/*
            「加入」不縮：它是兩個字，縮到剩一個字就沒有意義了。讓步的是輸入框
            ——六碼在 320px 上仍有 200px 可用，那個字級照樣讀得出來。
          */}
          <button
            class="btn btn-lg"
            style="flex:none"
            disabled={extractRoomCode(code).length < CODE_LENGTH}
            onClick={join}
          >
            {t('join')}
          </button>
        </div>
        {error && <p class="note note-warn">{error}</p>}
        {canScanQr() && (
          <button class="btn btn-block" onClick={() => setMode('scan')}>
            <IconCamera /> {t('scanQr')}
          </button>
        )}
      </div>
    </Sheet>
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
