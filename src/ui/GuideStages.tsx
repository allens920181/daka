import { Fragment } from 'preact'
import type { ComponentChildren } from 'preact'
import { toShareText } from '../lib/export'
import { formatDate } from '../lib/format'
import { parseRoster } from '../lib/parse'
import { prefs } from '../lib/store'
import { AppBar } from './AppBar'
import { DEMO_CODE, DEMO_CODE_2, demoMembers, demoRoom } from './guideDemo'
import type { Demo, DemoText } from './guideDemo'
import type { StageId } from './guideSteps'
import {
  IconArchive, IconBack, IconBookmark, IconCamera, IconCheck, IconChevronRight, IconDuplicate,
  IconEdit, IconHash, IconHelp, IconLink, IconMore, IconPlus, IconQr, IconSearch, IconShare,
  IconTrash,
} from './icons'
import { RoleBadge } from './RoleBadge'
import { MemberRow, ResultActions, Segment } from './Room'
import { RosterPreview } from './RosterInput'
import { useT } from './t'

/**
 * 聚焦導覽的**舞台**（2026-11）：用真的零件、真的 class 拼出 app 的每一個畫面，資料是模擬的。
 *
 * **舞台不是截圖，也不是另畫的示意圖**：`AppBar`、`RoleBadge`、`Segment`、`MemberRow`、
 * `RosterPreview`、`ResultActions`、`.dock`、`.btn`、`.sheet`、`.dialog`、`.sheet-item`、
 * `.result-card`……跟真的畫面是同一批元件與同一批 class。使用者在這裡看到的「未到」那顆圈、
 * 已到那一列沉回頁面的樣子、右邊印的時間、選單每一列的圖示，到真的畫面上是同一個東西。
 * 真的畫面改了長相，這裡跟著改——不必有人記得回來更新一張圖。
 *
 * **怎麼拼是這裡的事。** 真的畫面多了一顆鍵，舞台不會自己長出來（見 overlays.md 的〈代價〉）。
 * 所以每個舞台只拼那一步要講的東西，而且儘量讓步驟框住**有 class 名字的真東西**
 * （`.topbar-heading`、`.filterbar`、`.groups`、`.result-card`……），而不是舞台自己加的記號——
 * 真的 class 改名時，`e2e-local.mjs` 的走查會因為找不到目標而紅。
 *
 * 面板與對話框（`.sheet`、`.dialog`）在舞台上是**靜態的複本**：不用真的 `Sheet`／`ConfirmDialog`
 * 元件（它們各自 `useModal`、`useHistoryLayers`，疊兩層疊層會互相搶焦點與返回手勢），只拼它們的
 * 外觀。真的面板長出來是靠 `rise` 動畫——舞台上要關掉（`animation: none`），不然動畫開頭的位移
 * 會被聚焦框量進去，框就偏了一截。
 */

interface Ctx {
  /** 連上雲端的版本。單機版少一些東西（常用名單、帳戶、存成常用……），舞台也跟著少。 */
  cloud: boolean
  demo: Demo
  /** 只有「點名」那一步，名單才碰得到。 */
  interactive: boolean
  text: DemoText
}

const noop = () => {}

/**
 * 舞台上有電話鍵（`<a href="tel:…">`）——在名單可以點的那一步，按到它會**真的撥出電話**。
 * 教學裡不該有任何一個按鍵會離開教學，所以這裡一律擋掉連結的預設動作（捕獲階段，比
 * `MemberRow` 自己的 `stopPropagation` 早）。
 */
const blockLinks = (e: Event) => {
  if ((e.target as Element | null)?.closest('a')) e.preventDefault()
}

/**
 * 舞台上不可操作的那一塊。`display: contents`：它只負責 `inert`，不參與版面。
 *
 * 整個舞台都是「看的」，只有「點名」那一步的名單是「點的」——其餘每一塊都 `inert`，所以點到暗掉
 * 的部分什麼事都不會發生（沒有東西會開、會跳走），Tab 也跑不進去，螢幕閱讀器讀到的只有說明卡片。
 */
function Region({ inert, children }: { inert: boolean; children: ComponentChildren }) {
  return <div class="tour-region" inert={inert} onClickCapture={blockLinks}>{children}</div>
}

/** 靜態的面板：外觀是真的 `.sheet`（握把、圓角、陰影），貼在舞台下緣。 */
function StageSheet({ children }: { children: ComponentChildren }) {
  return (
    <Region inert>
      <div class="sheet tour-sheet">
        <div class="sheet-bar" />
        <div class="sheet-body">{children}</div>
      </div>
    </Region>
  )
}

/** 面板裡的一列（`.sheet-item`）。 */
function Item({ icon, label, value, go, sub, danger, tour }: {
  icon?: ComponentChildren
  label: string
  value?: string
  go?: boolean
  sub?: string
  danger?: boolean
  tour?: string
}) {
  return (
    <button class={danger ? 'sheet-item danger' : 'sheet-item'} tabIndex={-1} data-tour={tour}>
      {icon}
      <span class="sheet-item-main">
        <strong>{label}</strong>
        {sub && <span class="sub">{sub}</span>}
      </span>
      {value !== undefined && <span class="sheet-item-value">{value}</span>}
      {go && <IconChevronRight class="go" />}
    </button>
  )
}

// ---------------------------------------------------------------------------
// 首頁
// ---------------------------------------------------------------------------

/** 首頁的一個空間（`.recent-item`）。 */
function RoomRow({ owner, name, code, stat }: { owner: boolean; name: string; code: string; stat?: string }) {
  const lang = prefs.value.lang
  return (
    <div class="recent-item">
      <button class="recent-main" tabIndex={-1}>
        <RoleBadge owner={owner} />
        <div style="flex:1; min-width:0">
          <div class="recent-name">{name}</div>
          <div class="recent-meta">
            <span class="mono">{code}</span>
            <span>{formatDate(Date.now(), lang)}</span>
            {stat && <span>{stat}</span>}
          </div>
        </div>
      </button>
      <button class="icon-btn" tabIndex={-1} aria-hidden="true"><IconMore /></button>
    </div>
  )
}

/**
 * 首頁。`rooms` ＝ 0 是**第一次打開看到的樣子**（只有那句「還沒有開過空間」）；＝ 2 是用過一陣子
 * 之後的樣子——兩個以上的空間，篩選列才會出現（見 Home.tsx 的 `filterVisible`）。
 */
function HomeBase({ rooms, cloud }: { rooms: 0 | 2; cloud: boolean }) {
  const t = useT()
  return (
    <Region inert>
      <AppBar onSettings={noop} onGuide={noop} />
      {rooms === 2 && (
        <div class="topbar home-filterbar">
          <div class="shell filterbar">
            <div class="segmented" role="group" aria-label={t('filter')}>
              <button class="segment" aria-pressed tabIndex={-1}>{t('roomFilterAll')}</button>
              <button class="segment" aria-pressed={false} tabIndex={-1}>{t('roomFilterMine')}</button>
              <button class="segment" aria-pressed={false} tabIndex={-1}>{t('roomFilterOthers')}</button>
            </div>
            <button class="icon-btn search-toggle" tabIndex={-1} aria-hidden="true"><IconSearch /></button>
          </div>
        </div>
      )}
      <div class="shell">
        <div class="stack">
          <div class="row" style="gap:8px">
            <button class="btn btn-lg" style="flex:1" tabIndex={-1} data-tour="join">{t('joinRoom')}</button>
            <button class="btn btn-primary btn-lg" style="flex:1" tabIndex={-1} data-tour="create">
              <IconPlus /> {t('openRoom')}
            </button>
          </div>
          {rooms === 0 ? (
            <p class="hint">{t('noRecentRooms')}</p>
          ) : (
            <div class="stack" style="gap:8px">
              {/* 「我的活動」那份帶著「已到／總人數」，只有登入／雲端版才有；本機那份只有日期。 */}
              <RoomRow
                owner name={t('exampleName')} code={DEMO_CODE}
                stat={cloud ? t('roomStat', { arrived: 4, total: 6 }) : undefined}
              />
              <RoomRow owner={false} name={t('guideDemoRoom2')} code={DEMO_CODE_2} />
            </div>
          )}
        </div>
      </div>
    </Region>
  )
}

function JoinSheet() {
  const t = useT()
  return (
    <StageSheet>
      <div class="stack" data-tour="sheetbody">
        <div class="code-row">
          <input class="input code-input" tabIndex={-1} readOnly aria-hidden="true" placeholder="——————" />
          <button class="btn" tabIndex={-1} disabled>{t('join')}</button>
        </div>
        <button class="btn btn-block" tabIndex={-1}><IconCamera /> {t('scanQr')}</button>
      </div>
    </StageSheet>
  )
}

/** 首頁每一列右邊那顆「更多」：**空間本身的事**（見 Sheets.tsx 的 `RoomActionsSheet`）。 */
function RowMenuSheet() {
  const t = useT()
  const expires = formatDate(Date.now() + 30 * 24 * 60 * 60 * 1000, prefs.value.lang)
  return (
    <StageSheet>
      <div class="sheet-items" data-tour="sheetbody">
        <Item icon={<IconDuplicate />} label={t('copyRoom')} go />
        <Item icon={<IconArchive />} label={t('archiveRoom')} />
        <Item icon={<IconTrash />} label={t('deleteRoom')} sub={t('expiresOn', { date: expires })} danger />
      </div>
    </StageSheet>
  )
}

function SettingsSheet({ cloud }: { cloud: boolean }) {
  const t = useT()
  const p = prefs.value
  return (
    <StageSheet>
      <div class="sheet-items" data-tour="sheetbody">
        <Item label={t('yourName')} value={t('notSet')} go />
        {/* 沒設定雲端的建置沒有帳戶這回事，整列不出現（見 Sheets.tsx 的 `SettingsSheet`）。 */}
        {cloud && <Item label={t('account')} value={t('notSignedIn')} go tour="account" />}
        <Item label={t('theme')} value={t('themeSystem')} go />
        <Item label={t('fontSize')} value={t('fontBase')} go />
        <Item label={t('rollCallToast')} value={t('rollCallToastOn')} go />
        <Item label={t('language')} value={p.lang === 'zh' ? '中文' : 'English'} go />
      </div>
    </StageSheet>
  )
}

// ---------------------------------------------------------------------------
// 開空間
// ---------------------------------------------------------------------------

/** 開空間的頂欄：返回、標題、「?」（名單怎麼寫）、（雲端版）常用名單。 */
function NewTopbar({ cloud, withSaved }: { cloud: boolean; withSaved: boolean }) {
  const t = useT()
  return (
    <div class="topbar">
      <div class="shell topbar-inner">
        <button class="icon-btn" tabIndex={-1} aria-hidden="true"><IconBack /></button>
        <h1 class="topbar-name">{t('openRoom')}</h1>
        <button class="icon-btn fmt-help-btn" tabIndex={-1} aria-hidden="true"><IconHelp /></button>
        {withSaved && cloud && (
          <>
            <div class="spacer" />
            <button class="icon-btn" tabIndex={-1} aria-hidden="true" data-tour="saved"><IconBookmark /></button>
          </>
        )}
      </div>
    </div>
  )
}

/** 第一步：貼名單。還沒貼，所以「填入範例」在、「產生名單」是灰的。 */
function NewStage({ cloud }: { cloud: boolean }) {
  const t = useT()
  return (
    <>
      <Region inert>
        <NewTopbar cloud={cloud} withSaved />
        <div class="shell">
          <div class="stack" style="padding-top:12px">
            <div class="field">
              <div class="row">
                <label class="label">{t('roomNameLabel')}</label>
                <div class="spacer" />
                <button class="btn btn-sm" tabIndex={-1} data-tour="example">{t('exampleFill')}</button>
              </div>
              <input class="input" tabIndex={-1} readOnly aria-hidden="true" placeholder={t('roomNamePlaceholder')} />
            </div>
            <div class="field" data-tour="roster">
              <label class="label">{t('pasteRoster')}</label>
              <textarea class="textarea" tabIndex={-1} readOnly aria-hidden="true" placeholder={t('pastePlaceholder')} />
            </div>
          </div>
        </div>
      </Region>
      <Region inert>
        <div class="dock">
          <div class="dock-inner">
            <button class="btn btn-primary btn-lg btn-block" tabIndex={-1} disabled>
              {t('generateList')} <IconChevronRight size={16} />
            </button>
          </div>
        </div>
      </Region>
    </>
  )
}

/**
 * 第二步：看解析結果。**用真的解析器去解析真的範例名單**（取前六行：兩個分組標題、四個人），
 * 餵給真的 `RosterPreview`——預覽長什麼樣、哪一列有備註、分組標題怎麼排，都不是這裡畫的。
 */
function NewListStage({ cloud }: { cloud: boolean }) {
  const t = useT()
  const text = t('exampleRoster').split('\n').slice(0, 6).join('\n')
  const result = parseRoster(text)
  return (
    <>
      <Region inert>
        <NewTopbar cloud={cloud} withSaved={false} />
        <div class="shell">
          <div class="stack" style="padding-top:12px">
            <h2 class="room-flow-title">{t('exampleName')}</h2>
            <div data-tour="preview"><RosterPreview text={text} onText={noop} result={result} /></div>
          </div>
        </div>
      </Region>
      <Region inert>
        <div class="dock">
          <div class="dock-inner">
            <button class="btn btn-lg" tabIndex={-1}><IconBack size={16} /> {t('adjustList')}</button>
            <button class="btn btn-primary btn-lg btn-block" tabIndex={-1} data-tour="confirm">
              {t('confirmCreate')} {result.members.length}
            </button>
          </div>
        </div>
      </Region>
    </>
  )
}

// ---------------------------------------------------------------------------
// 空間
// ---------------------------------------------------------------------------

type RoomVariant = 'base' | 'groups' | 'sync' | 'edit' | 'closed'

/**
 * 空間（主揪的視角）。**省略了最上面那條 `AppBar`**：它不是這些步驟要講的任何一件事，卻佔
 * 76px——在 667px 高的手機上，名單底下剩給說明卡片的高度因此從 255px 變成 331px。
 * 其餘頂欄、篩選列、分組標籤、名單列、結果卡片、底部動作列都是真的。
 */
function RoomBase({ variant, ctx }: { variant: RoomVariant; ctx: Ctx }) {
  const t = useT()
  const { cloud, demo, interactive, text } = ctx
  const edit = variant === 'edit'
  const closed = variant === 'closed'
  const groups = variant === 'groups'
  const members = demoMembers(text, demo.at, groups)
  const missing = members.filter((m) => m.status !== 'arrived').length
  const groupNames = groups ? text.groups : []

  return (
    <>
      <Region inert>
        <div class="topbar room-chrome">
          <div class="shell topbar-inner">
            <button class="icon-btn" tabIndex={-1} aria-hidden="true"><IconBack /></button>
            {edit ? (
              <div class="topbar-title">
                <input class="topbar-name-input" tabIndex={-1} readOnly value={text.roomName} aria-hidden="true" />
              </div>
            ) : (
              <div class="topbar-title">
                <div class="topbar-heading">
                  <RoleBadge owner />
                  <h1 class="topbar-name">{text.roomName}</h1>
                  {closed && <span class="topbar-count closed">{t('roomClosedShort')}</span>}
                  {/* 同步狀態：一切正常時整個不畫（單機版畫一顆灰點，那是「這個空間只有你看得到」）；
                      「離線」那一步畫成離線、兩筆待上傳。 */}
                  {variant === 'sync' ? (
                    <span class="sync sync-offline" role="status" aria-label={t('syncOffline')}>
                      <span class="sync-dot" /><span class="sync-n">2</span>
                    </span>
                  ) : !cloud ? (
                    <span class="sync sync-local" role="status" aria-label={t('syncLocalOnly')}>
                      <span class="sync-dot" />
                    </span>
                  ) : null}
                </div>
              </div>
            )}
            {edit ? (
              <button class="icon-btn" tabIndex={-1} aria-hidden="true"><IconCheck size={24} /></button>
            ) : (
              <button class="icon-btn" tabIndex={-1} aria-hidden="true" data-tour="more"><IconMore /></button>
            )}
          </div>
          <div class="shell filterbar">
            <div class="segmented" role="group" aria-label={t('filter')}>
              <Segment active label={t('all')} count={members.length} onClick={noop} />
              <Segment
                active={false} label={t('missing')} count={missing} onClick={noop}
                tone={missing === 0 ? 'done' : 'pending'}
              />
              <Segment active={false} label={t('arrived')} count={members.length - missing} onClick={noop} />
            </div>
            <button class="icon-btn search-toggle" tabIndex={-1} aria-hidden="true"><IconSearch /></button>
          </div>
        </div>
      </Region>

      <Region inert={!interactive}>
        <div class="shell">
          {closed && (
            <div class="result-card" style="margin-top:12px">
              <span class="result-card-text">
                {t('closedResult', {
                  summary: `${missing === 0 ? t('allHere') : t('missingCount', { n: missing })} · ${t('headcount', { arrived: members.length - missing, total: members.length })}`,
                })}
              </span>
              <ResultActions onCopy={noop} onCsv={noop} />
            </div>
          )}
          {groups && (
            <div class="groups" role="group" aria-label={t('group')}>
              <button class="group-chip" aria-pressed tabIndex={-1}>
                {t('allGroups')}<span class="group-n">{missing}</span>
              </button>
              {groupNames.map((g) => (
                <button class="group-chip" aria-pressed={false} tabIndex={-1} key={g}>
                  {g}<span class="group-n">{members.filter((m) => m.group_label === g && m.status !== 'arrived').length}</span>
                </button>
              ))}
            </div>
          )}
          <div class="list" role="list" aria-label={t('roster')} data-tour="list">
            {members.map((m, i) => {
              const prev = i > 0 ? members[i - 1] : undefined
              const divider = groups && (i === 0 || m.group_label !== prev?.group_label)
              return (
                <Fragment key={m.id}>
                  {divider && <div class="group-divider">{m.group_label}</div>}
                  <MemberRow
                    member={m} closed={closed} showGroup={false} editing={edit} editingThis={false}
                    onToggle={() => demo.toggle(i)} onEdit={noop} onSave={noop} onRemove={noop}
                  />
                </Fragment>
              )
            })}
          </div>
        </div>
      </Region>

      <Region inert>
        <div class="dock dock-roll">
          <div class="dock-inner">
            {edit ? (
              <button class="btn btn-block" tabIndex={-1} aria-label={t('addWalkIn')} data-tour="walkin">
                <IconPlus />
              </button>
            ) : (
              <button class="btn btn-block" tabIndex={-1} data-tour="finish">
                {closed ? t('reopenRoom') : t('finishRound')}
              </button>
            )}
          </div>
        </div>
      </Region>
    </>
  )
}

/** 空間的「更多」：這份名單的事（見 Sheets.tsx 的 `ManageSheet`）。 */
function MenuSheet({ cloud }: { cloud: boolean }) {
  const t = useT()
  return (
    <StageSheet>
      <div class="sheet-items" data-tour="sheetbody">
        <Item icon={<IconShare />} label={t('invite')} go />
        <Item icon={<IconEdit />} label={t('edit')} />
        {/* 存成常用要雲端（`owner && isSupabaseConfigured`），單機版整列不出現。 */}
        {cloud && <Item icon={<IconBookmark />} label={t('saveAsRoster')} go />}
      </div>
    </StageSheet>
  )
}

/**
 * 「邀請點名」那一頁：代碼、連結、二維碼三列。單機版這個空間真的只存在這支手機裡，發出去的
 * 東西對任何人都沒有用，所以那三列不列，改成講清楚會發生什麼（跟真的一樣，見 `ManageSheet`）。
 */
function InviteSheet({ cloud }: { cloud: boolean }) {
  const t = useT()
  return (
    <StageSheet>
      {cloud ? (
        <div class="sheet-items" data-tour="sheetbody">
          <Item icon={<IconHash />} label={t('roomCode')} go />
          <Item icon={<IconLink />} label={t('roomLink')} go />
          <Item icon={<IconQr />} label={t('roomQr')} go />
        </div>
      ) : (
        <div class="stack" data-tour="sheetbody">
          <p class="note note-warn">
            <strong>{t('shareLocalTitle')}</strong><br />{t('shareLocalBody')}
          </p>
          <p class="hint">{t('shareLocalHow')}</p>
        </div>
      )}
    </StageSheet>
  )
}

/**
 * 「結束點名」的確認對話框。**結果預覽是真的 `toShareText`**，餵給它的是使用者在「點名」那一步
 * 點出來的名單——預覽跟實際貼進 LINE 的東西只要有一個字不一樣，它就是在說謊。
 */
function FinishDialog({ ctx }: { ctx: Ctx }) {
  const t = useT()
  const members = demoMembers(ctx.text, ctx.demo.at, false)
  return (
    <Region inert>
      <div class="tour-dialog-wrap">
        <div class="dialog">
          <h2 class="dialog-title">{t('finishRound')}</h2>
          <p class="dialog-body">{ctx.cloud ? t('finishRoundBody') : t('finishRoundBodyLocal')}</p>
          <pre class="result-preview">{toShareText(demoRoom(ctx.text.roomName), members, prefs.value.lang)}</pre>
          <ResultActions onCopy={noop} onCsv={noop} />
          <div class="dialog-actions">
            <button class="btn btn-block" tabIndex={-1}>{t('cancel')}</button>
            <button class="btn btn-primary btn-block" tabIndex={-1}>{t('finishRound')}</button>
          </div>
        </div>
      </div>
    </Region>
  )
}

// ---------------------------------------------------------------------------

/** 這一步的舞台。 */
export function Stage({ id, ctx }: { id: StageId; ctx: Ctx }) {
  switch (id) {
    case 'home': return <HomeBase rooms={0} cloud={ctx.cloud} />
    case 'homeJoin': return <><HomeBase rooms={0} cloud={ctx.cloud} /><JoinSheet /></>
    case 'homeRooms': return <HomeBase rooms={2} cloud={ctx.cloud} />
    case 'homeRowMenu': return <><HomeBase rooms={2} cloud={ctx.cloud} /><RowMenuSheet /></>
    case 'homeSettings': return <><HomeBase rooms={0} cloud={ctx.cloud} /><SettingsSheet cloud={ctx.cloud} /></>
    case 'new': return <NewStage cloud={ctx.cloud} />
    case 'newList': return <NewListStage cloud={ctx.cloud} />
    case 'room': return <RoomBase variant="base" ctx={ctx} />
    case 'roomGroups': return <RoomBase variant="groups" ctx={ctx} />
    case 'roomSync': return <RoomBase variant="sync" ctx={ctx} />
    case 'roomMenu': return <><RoomBase variant="base" ctx={ctx} /><MenuSheet cloud={ctx.cloud} /></>
    case 'roomInvite': return <><RoomBase variant="base" ctx={ctx} /><InviteSheet cloud={ctx.cloud} /></>
    case 'roomEdit': return <RoomBase variant="edit" ctx={ctx} />
    case 'roomFinish': return <><RoomBase variant="base" ctx={ctx} /><FinishDialog ctx={ctx} /></>
    case 'roomClosed': return <RoomBase variant="closed" ctx={ctx} />
  }
}

export type { Ctx as StageCtx }
