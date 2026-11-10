import type { RefObject } from 'preact'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { toShareText } from '../lib/export'
import { formatDate } from '../lib/format'
import type { MessageKey } from '../lib/i18n'
import { connection, prefs } from '../lib/store'
import type { Member, Room } from '../lib/types'
import { AppBar } from './AppBar'
import { useHistoryLayers } from './history'
import { IconBack, IconMore, IconPlus, IconSearch } from './icons'
import { RoleBadge } from './RoleBadge'
import { MemberRow, Segment } from './Room'
import { useModal } from './useModal'
import { useT } from './t'

/**
 * 聚焦導覽（2026-11）：**框住真實的介面元件，一次一步，資料全是模擬的**。
 *
 * 四步，每一步框一個真的按鈕或區塊：
 *
 *   1. 首頁的「創建空間」          2. 空間右上角的「更多」（邀請點名在裡面）
 *   3. 名單（可以真的點）          4. 底部動作列的「結束點名」
 *
 * **舞台是用真的零件拼的，不是截圖、也不是另畫的示意圖**：`AppBar`、`RoleBadge`、
 * `Segment`、`MemberRow`、`.dock`、`.btn`，跟真的畫面是同一批元件與同一批 class。
 * 使用者在這裡看到的「未到」那顆圈、已到那一列沉回頁面的樣子、右邊印的時間，到真的
 * 畫面上是同一個東西。真的畫面改了長相，這裡跟著改——不必有人記得回來更新一張圖。
 *
 * **資料全部住在這個元件的記憶體裡**：三個人、一個示範空間，不碰 `members`、
 * 不碰佇列、不碰網路、不碰 IndexedDB。這也是為什麼舞台是自己拼的、而不是直接把真的
 * `Room` 掛上來：真的 `Room` 一掛上去就會 `enterRoom`（連線、同步、寫本機），而
 * 「示範用的資料」一旦經過那條路，就有可能變成一份真的空間。
 *
 * 為什麼是蓋一層全螢幕的舞台，而不是框住使用者**現在看的那個畫面**：教學要框「空間裡的
 * 名單」，而使用者可能正在首頁（還沒有任何空間）；從空間裡按「?」打開時，要框的又是首頁
 * 的按鈕。框住底下真實畫面的話，第二到第四步在首頁根本找不到東西可框。
 */

const STEPS = 4

/** 每一步框的是舞台上哪一塊（`data-tour`）。 */
const TARGETS = ['create', 'more', 'list', 'finish'] as const

/** 演練名單的三個人。 */
const DEMO_NAMES: readonly MessageKey[] = ['guideDemoName1', 'guideDemoName2', 'guideDemoName3']

/** 示範空間的代碼。合法的 6 碼（見 code.ts 的字母表），但這個空間不存在。 */
const DEMO_CODE = 'K7F2QM'

/** 聚焦框比目標大一圈，不貼著邊；說明卡片離框的距離、離螢幕邊緣的距離。 */
const PAD = 8
const GAP = 12
const EDGE = 16
/** 說明卡片再矮也不低於這個高度：低於它就讓它蓋住一點目標，不要縮成捲不動的一條。 */
const MIN_CARD = 200

const noop = () => {}

interface Box { x: number; y: number; w: number; h: number }

/**
 * 演練：**三個人的名單，點得動，行為跟真的點名畫面一模一樣**。
 *
 * 點完也跟真的一樣跳一個 Toast（「某某 · 已到」＋「復原」），而且復原做的事也一樣：
 * 把**剛剛那一個人**退回去。再點同一個人也退得回來。
 *
 * `at` 是每個人被點到的時間（`null` ＝ 還沒到），不是一個布林：真的名單列在右邊印著
 * 「幾點」，演練也印，不然那一格在第一次看到真的畫面時是個沒人解釋過的東西。
 * 第四步的結果文字與舞台上篩選列的數字吃的都是同一份 `at`。
 *
 * 狀態住在 `GuideTour`，不在哪一步的元件裡：走回上一步再回來，點過的人還是已到。
 */
function useDemo() {
  const [at, setAt] = useState<(number | null)[]>(() => DEMO_NAMES.map(() => null))
  const [last, setLast] = useState<{ index: number; before: number | null } | null>(null)

  const toggle = (index: number) => {
    setLast({ index, before: at[index] ?? null })
    setAt(at.map((v, i) => (i === index ? (v === null ? Date.now() : null) : v)))
  }
  const undo = () => {
    if (!last) return
    setAt(at.map((v, i) => (i === last.index ? last.before : v)))
    setLast(null)
  }
  return { at, last, toggle, undo }
}
type Demo = ReturnType<typeof useDemo>

/** 演練名單 → 真的 `Member`。餵給真的 `MemberRow` 與真的 `toShareText`。 */
function demoMembers(names: string[], at: (number | null)[]): Member[] {
  return names.map((name, i) => {
    const time = at[i] ?? null
    return {
      id: `demo-${i}`, room_id: 'demo', name, note: null, phone: null, companions: 0,
      group_label: null, sort_order: i, status: time === null ? 'pending' : 'arrived',
      status_at: time === null ? null : new Date(time).toISOString(),
      status_by: null, rev: 0, created_at: '',
    }
  })
}

/**
 * 舞台上不可操作的那一塊。`display: contents`：它只負責 `inert`，不參與版面。
 *
 * 整個舞台都是「看的」，只有第三步的名單是「點的」——其餘每一塊都 `inert`，所以
 * 點到暗掉的部分什麼事都不會發生（沒有東西會開、會跳走），Tab 也跑不進去，螢幕
 * 閱讀器讀到的只有說明卡片。
 */
function Region({ inert, children }: { inert: boolean; children: preact.ComponentChildren }) {
  return <div class="tour-region" inert={inert}>{children}</div>
}

/** 第一步的舞台：首頁，有一個示範空間。 */
function HomeStage() {
  const t = useT()
  return (
    <Region inert>
      <AppBar onSettings={noop} onGuide={noop} />
      <div class="shell">
        <div class="stack">
          <div class="row" style="gap:8px">
            <button class="btn btn-lg" style="flex:1" tabIndex={-1}>{t('joinRoom')}</button>
            <button class="btn btn-primary btn-lg" style="flex:1" tabIndex={-1} data-tour="create">
              <IconPlus /> {t('openRoom')}
            </button>
          </div>
          <div class="stack" style="gap:8px">
            <div class="recent-item">
              <button class="recent-main" tabIndex={-1}>
                <RoleBadge owner />
                <div style="flex:1; min-width:0">
                  <div class="recent-name">{t('exampleName')}</div>
                  <div class="recent-meta">
                    <span class="mono">{DEMO_CODE}</span>
                    <span>{formatDate(Date.now(), prefs.value.lang)}</span>
                  </div>
                </div>
              </button>
              <button class="icon-btn" tabIndex={-1} aria-hidden="true"><IconMore /></button>
            </div>
          </div>
        </div>
      </div>
    </Region>
  )
}

/**
 * 第二～四步的舞台：空間（主揪的視角）。
 *
 * **省略了最上面那條 `AppBar`**：它不是這三步要講的任何一件事，卻佔 76px——在 667px
 * 高的手機上，名單底下剩給說明卡片的高度因此從 255px 變成 331px，差一個「卡片放不放得進
 * 名單與螢幕下緣之間」。其餘頂欄、篩選列、名單列、底部動作列都是真的。
 */
function RoomStage({ names, demo, interactive }: { names: string[]; demo: Demo; interactive: boolean }) {
  const t = useT()
  const { at, toggle } = demo
  const members = demoMembers(names, at)
  const missing = at.filter((v) => v === null).length
  return (
    <>
      <Region inert>
        <div class="topbar room-chrome">
          <div class="shell topbar-inner">
            <button class="icon-btn" tabIndex={-1} aria-hidden="true"><IconBack /></button>
            <div class="topbar-title">
              <div class="topbar-heading">
                <RoleBadge owner />
                <h1 class="topbar-name">{t('exampleName')}</h1>
              </div>
            </div>
            <button class="icon-btn" tabIndex={-1} aria-hidden="true" data-tour="more"><IconMore /></button>
          </div>
          <div class="shell filterbar">
            <div class="segmented" role="group" aria-label={t('filter')}>
              <Segment active label={t('all')} count={names.length} onClick={noop} />
              <Segment
                active={false} label={t('missing')} count={missing} onClick={noop}
                tone={missing === 0 ? 'done' : 'pending'}
              />
              <Segment active={false} label={t('arrived')} count={names.length - missing} onClick={noop} />
            </div>
            <button class="icon-btn search-toggle" tabIndex={-1} aria-hidden="true"><IconSearch /></button>
          </div>
        </div>
      </Region>

      {/* 第三步唯一可以點的一塊。`.list` 自己帶 160px 的底部內距（給底部動作列讓位），
          舞台上的動作列是 fixed 的、不佔位置，所以在 `.tour-stage .list` 裡收掉。 */}
      <Region inert={!interactive}>
        <div class="shell">
          <div class="list" role="list" aria-label={t('roster')} data-tour="list">
            {members.map((m, i) => (
              <MemberRow
                key={m.id} member={m} closed={false} showGroup={false} editing={false}
                editingThis={false} onToggle={() => toggle(i)} onEdit={noop}
                onSave={noop} onRemove={noop}
              />
            ))}
          </div>
        </div>
      </Region>

      <Region inert>
        <div class="dock dock-roll">
          <div class="dock-inner">
            <button class="btn btn-block" tabIndex={-1} data-tour="finish">{t('finishRound')}</button>
          </div>
        </div>
      </Region>
    </>
  )
}

/**
 * 第三步說明卡片裡的回饋格：**提示與 Toast 住同一格**，點完只是換掉裡面的東西，
 * 不會把卡片頂高。
 *
 * 這顆 Toast 是真的那個樣式，但不是真的那個東西：不在 `.toast-wrap`（固定定位在畫面
 * 下緣）裡、沒有五秒計時、不被設定裡的「點名提示」開關管——教學示範的是預設的樣子。
 * 它在說明卡片裡而不是舞台下緣，是因為舞台下緣那一帶就是卡片所在的地方。
 */
function DemoFeedback({ names, demo }: { names: string[]; demo: Demo }) {
  const t = useT()
  const { at, last, undo } = demo
  const slot = useRef<HTMLDivElement>(null)
  /* 矮的手機上卡片是內部在捲的（見 `.tour-callout`），這一格可能在卡片可見範圍之外：
     點完那一下要讓使用者看得到「某某 · 已到」與「復原」，不然這一步示範的東西根本沒出現。 */
  useEffect(() => { if (last) slot.current?.scrollIntoView({ block: 'nearest' }) }, [last])
  return (
    <div class="guide-demo-slot" ref={slot}>
      {last ? (
        <div class="toast" role="status" aria-live="polite">
          <span class="toast-text">
            {names[last.index]} · {at[last.index] !== null ? t('arrived') : t('missing')}
          </span>
          <button class="toast-action" onClick={undo}>{t('undo')}</button>
        </div>
      ) : (
        <p class="hint">{t('guideTry')}</p>
      )}
    </div>
  )
}

/**
 * 第四步的結果預覽：**就是「結束點名」會交出去的那段文字**。
 *
 * 呼叫的是真的 `toShareText`，不是在這裡另外拼一份——預覽跟實際貼進 LINE 的東西
 * 只要有一個字不一樣，這個預覽就是在說謊。餵給它的是第三步點出來的演練名單，所以
 * 使用者剛剛點了誰、沒點誰，這裡就長出對應的「已到 2 / 3 人」與「未到 1 位：…」。
 */
function ResultPreview({ names, at }: { names: string[]; at: (number | null)[] }) {
  const t = useT()
  const room: Room = {
    id: 'demo', code: DEMO_CODE, name: t('exampleName'), note: null,
    created_at: '', expires_at: '', closed_at: null, copied_from: null,
  }
  return (
    <div class="guide-result">
      <p class="hint">{t('guideResultLead')}</p>
      {/* 跟「名單怎麼寫」的例子同一個凹槽（`.fmt-eg`）：它也是一段文字樣本。但不用
          等寬字體（`<code>`／`.mono`）：那是「照著打進輸入框的字」，而這一段是貼進
          LINE 的訊息，在 LINE 裡長什麼樣就該在這裡長什麼樣。 */}
      <p class="fmt-eg">{toShareText(room, demoMembers(names, at), prefs.value.lang)}</p>
    </div>
  )
}

/** 說明卡片的內容：進度、這一步講什麼、這一步要做的事、出口。 */
function GuideCard({
  step, onStep, demo, names, onSkip, skipLabel, onFinish, finishLabel, showLater, primaryRef,
}: {
  step: number
  onStep: (n: number) => void
  demo: Demo
  names: string[]
  /** 第一步左邊那顆鍵（略過／關閉）。面板沒有關閉鍵，所以這一頁自己帶一個出口。 */
  onSkip: () => void
  skipLabel: string
  /** 最後一步右邊那顆鍵。 */
  onFinish: () => void
  finishLabel: string
  /** 「之後想再看，按右上角的 ? 鍵」——只有自己會消失的那一份才需要說。 */
  showLater: boolean
  /** 右邊那顆鍵。用它把初始焦點放在「下一步」，而不是 DOM 裡的第一顆（「略過」）。 */
  primaryRef: RefObject<HTMLButtonElement>
}) {
  const t = useT()
  const localOnly = connection.value === 'local-only'
  const titles = [
    t('guideStep1Title'), t('guideStep2Title'), t('guideStep3Title'), t('guideStep4Title'),
  ]
  const bodies = [
    t('guideStep1Body'),
    localOnly ? t('guideStep2BodyLocal') : t('guideStep2Body'),
    t('guideStep3Body'),
    t('guideStep4Body'),
  ]
  const last = step === STEPS - 1

  return (
    <div class="stack guide">
      {/* 報讀的是「第 2 步，共 4 步：邀請點名」。畫面上不再印「四步完成一場點名」那一行：
          聚焦框本身已經說明了「這是導覽」，而右邊的進度條說得出「還有幾步」——那一行標題
          只是把同一件事說第二遍，還佔卡片 40px（在 667px 高的手機上，那 40px 就是卡片
          放不放得進名單與螢幕下緣之間的差別）。 */}
      <p class="sr-only" role="status">
        {t('guideProgress', { n: step + 1, total: STEPS })}：{titles[step]}
      </p>

      <section class="guide-pane" key={step}>
        <div class="guide-step-head">
          <span class="guide-num" aria-hidden="true">{step + 1}</span>
          <h2 class="guide-step-title">{titles[step]}</h2>
          {/* 進度：走到哪就亮到哪。 */}
          <span class="guide-bars" aria-hidden="true">
            {Array.from({ length: STEPS }, (_, i) => (
              <span class={i <= step ? 'guide-bar is-on' : 'guide-bar'} key={i} />
            ))}
          </span>
        </div>
        <p class="guide-step-body">{bodies[step]}</p>
        {/* 說在第一步，因為「略過」就在第一步：按下去之前就該知道還拿得回來。放在
            按鈕列上面而不是底下，這樣按鈕列永遠是卡片的最後一格、位置不隨步驟動。 */}
        {step === 0 && showLater && <p class="hint">{t('guideLater')}</p>}
        {step === 2 && <DemoFeedback names={names} demo={demo} />}
        {step === 3 && <ResultPreview names={names} at={demo.at} />}
      </section>

      <div class="guide-actions">
        {step > 0 ? (
          <button class="btn btn-lg btn-block" onClick={() => onStep(step - 1)}>{t('guidePrev')}</button>
        ) : (
          <button class="btn btn-lg btn-block" onClick={onSkip}>{skipLabel}</button>
        )}
        <button
          ref={primaryRef}
          class="btn btn-primary btn-lg btn-block"
          onClick={last ? onFinish : () => onStep(step + 1)}
        >
          {last ? finishLabel : t('guideNext')}
        </button>
      </div>
    </div>
  )
}

/**
 * 教學。兩種打開方式，同一份內容：
 *
 * - **`firstRun`**：第一次打開 app、停在首頁時自己跳出來。左邊是「略過」、最後一步是
 *   「開始使用」，第一步說一次去哪裡拿回來。
 * - **手動**：使用者按導航列的「?」。人已經在 app 裡了，所以左邊是「關閉」、最後一步是
 *   「完成」，也不必再說「去哪裡拿回來」——他剛剛才按過那顆鍵。
 *
 * **聚焦框**（`.tour-focus`）是一個量出來的方框：目標元素的位置，往外放大一圈。它的
 * 暗部不是另外畫的遮罩，是它自己的 `box-shadow` 往外撒一整個螢幕那麼大——框在哪，
 * 亮的就在哪，其餘都暗；`--scrim` 是面板與對話框後面同一層遮罩，深淺兩個主題各自有
 * 自己的值。位置由 CSS 轉場帶過去（尊重「減少動態效果」）。
 *
 * **說明卡片的位置是規則，不是量出來的版面**：目標在上半屏，卡片就釘在下緣；目標在下半屏
 * （第四步的「結束點名」），卡片抬到它上方。這樣前三步的「下一步」在同一個位置，連按
 * 不必追著它跑；而卡片永遠在拇指碰得到的那一帶，不在目標旁邊飄。卡片放不下時內部捲動，
 * 不蓋住目標。
 *
 * 做成一個疊層：`useModal`（焦點、Esc、背景 `inert`、鎖捲動）與 `useHistoryLayers`
 * （系統返回手勢先關掉它，不是整個退出空間），跟 `Sheet` 同一套。
 *
 * 初始焦點放在「下一步」：`useModal` 取的是 DOM 裡第一個可聚焦元素，而 Enter 不該是
 * 跳過（見下面 `ready` 那個 effect：它要等卡片可見才聚焦得到）。換步時**不搬焦點**（留在「下一步」上，鍵盤使用者可以連按 Enter），改用一行
 * `sr-only` 的 `role="status"` 報「第 2 步，共 4 步」。
 */
export function GuideTour({ onClose, firstRun }: { onClose: () => void; firstRun: boolean }) {
  const t = useT()
  const [step, setStep] = useState(0)
  const demo = useDemo()
  const layer = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const primary = useRef<HTMLButtonElement>(null)
  const [box, setBox] = useState<Box | null>(null)
  const [vh, setVh] = useState(0)
  const names = DEMO_NAMES.map((k) => t(k))

  useModal(layer, onClose)
  useHistoryLayers(1, onClose)

  /*
    每次 render 都量一次，結果沒變就不 setState（回傳同一個物件，Preact 不會再 render）。
    換步時舞台整個換掉（首頁 → 空間），目標元素是新的；使用者轉螢幕、改字級也會讓位置變。
    `useLayoutEffect`：在畫面第一次畫出來之前就把框放對，不會看到它從 (0, 0) 滑過來。
  */
  useLayoutEffect(() => {
    const measure = () => {
      const target = stage.current?.querySelector<HTMLElement>(`[data-tour="${TARGETS[step]}"]`)
      const host = layer.current
      if (!target || !host) return
      const r = target.getBoundingClientRect()
      const next = { x: r.left - PAD, y: r.top - PAD, w: r.width + 2 * PAD, h: r.height + 2 * PAD }
      setBox((p) => (p && p.x === next.x && p.y === next.y && p.w === next.w && p.h === next.h ? p : next))
      setVh(host.clientHeight)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  })

  let card: { bottom: number; maxHeight: number } | null = null
  if (box && vh > 0) {
    const lower = box.y + box.h / 2 > vh / 2
    card = lower
      ? { bottom: vh - box.y + GAP, maxHeight: Math.max(box.y - GAP - EDGE, MIN_CARD) }
      : { bottom: EDGE, maxHeight: Math.max(vh - (box.y + box.h) - GAP - EDGE, MIN_CARD) }
  }

  /*
    初始焦點。**要等卡片畫出來之後才聚焦**：量好聚焦框的位置之前，卡片是 `visibility:
    hidden` 的，對隱藏的元素 `focus()` 會靜默失敗——`useModal` 自己的初始聚焦也一樣，
    於是焦點留在 `<body>`，Enter 什麼事都沒有，Tab 也不在層裡。卡片可見的那一刻聚焦一次。
  */
  const ready = card !== null
  useEffect(() => { if (ready) primary.current?.focus() }, [ready])

  return (
    <div class="tour">
      <div class="tour-layer" ref={layer} role="dialog" aria-modal="true" aria-label={t('guideTitle')}>
        <div class="tour-stage" ref={stage}>
          {step === 0
            ? <HomeStage />
            : <RoomStage names={names} demo={demo} interactive={step === 2} />}
        </div>
        {box && (
          <div
            class="tour-focus" aria-hidden="true"
            style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
          />
        )}
        {/* 量好之前不畫：卡片的位置取決於框在哪，先畫出來再跳過去是閃一下。 */}
        <div class="dialog tour-callout" style={card ?? { visibility: 'hidden' }}>
          <GuideCard
            step={step}
            onStep={setStep}
            demo={demo}
            names={names}
            onSkip={onClose}
            skipLabel={firstRun ? t('guideSkip') : t('close')}
            onFinish={onClose}
            finishLabel={firstRun ? t('guideStart') : t('done')}
            showLater={firstRun}
            primaryRef={primary}
          />
        </div>
      </div>
    </div>
  )
}
