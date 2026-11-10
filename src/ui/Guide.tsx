import type { RefObject } from 'preact'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { isSupabaseConfigured } from '../lib/supabase'
import { useHistoryLayers } from './history'
import { IconChevronRight, IconClose } from './icons'
import { DEMO_NAMES, useDemo } from './guideDemo'
import type { Demo, DemoText } from './guideDemo'
import { Stage } from './GuideStages'
import { chaptersFor, stepsFor } from './guideSteps'
import type { Step } from './guideSteps'
import { useModal } from './useModal'
import { useT } from './t'

/**
 * 聚焦導覽（2026-11）：**框住真實的介面元件，一次一步，資料全是模擬的**——整個 app 的每一個
 * 功能都介紹到。
 *
 * 步驟表在 `guideSteps.ts`（九章、約三十步：開空間 → 加入 → 點名 → 邀請與協助者 → 編輯 →
 * 結束與帶走 → 管理空間 → 設定 → 最後），每一步框一個真的按鈕或區塊；舞台（首頁、開空間、
 * 空間、各種面板與對話框）在 `GuideStages.tsx`，用真的零件拼出來。
 *
 * **舞台不是截圖、也不是另畫的示意圖**：跟真的畫面是同一批元件與同一批 class（細節見
 * `GuideStages.tsx`）。**資料全部住在這個元件的記憶體裡**：三個人、兩個示範空間，不碰 `members`、
 * 不碰佇列、不碰網路、不碰 IndexedDB。這也是為什麼舞台是自己拼的、而不是直接把真的 `Home`／
 * `Room` 掛上來：真的 `Room` 一掛上去就會 `enterRoom`（連線、同步、寫本機），而「示範用的資料」
 * 一旦經過那條路，就有可能變成一份真的空間。
 *
 * 為什麼是蓋一層全螢幕的舞台，而不是框住使用者**現在看的那個畫面**：導覽要框「空間裡的名單」，
 * 而使用者可能正在首頁（還沒有任何空間）；從空間裡按「?」時，要框的又是首頁的按鈕。框住底下
 * 真實畫面的話，總有幾步找不到東西可框。
 */

/** 聚焦框比目標大一圈，不貼著邊；說明卡片離框的距離、離螢幕邊緣的距離。 */
const PAD = 8
/** 聚焦框離螢幕邊緣至少這麼遠，描邊才看得到。 */
const INSET = 4
const GAP = 12
const EDGE = 16
/**
 * 說明卡片再矮也不低於這個高度：低於它就讓它蓋住一點目標，不要縮成捲不動的一條。
 * 160 ＝ 黏在下緣的按鈕列（約 72）加上一截看得到的內文。極矮的螢幕（320×568）上，框住一整份
 * 設定清單（360px）與說明卡片本來就放不下兩個——這時候**卡片永遠留在螢幕裡**，代價是蓋住框的
 * 一部分，而不是跑出螢幕外面讓人看不到「下一步」。
 */
const MIN_CARD = 160

interface Box { x: number; y: number; w: number; h: number }

/**
 * 「點名」那一步說明卡片裡的回饋格：**提示與 Toast 住同一格**，點完只是換掉裡面的東西，
 * 不會把卡片頂高。
 *
 * 這顆 Toast 是真的那個樣式，但不是真的那個東西：不在 `.toast-wrap`（固定定位在畫面下緣）裡、
 * 沒有五秒計時、不被設定裡的「點名提示」開關管——導覽示範的是預設的樣子。它在說明卡片裡而不是
 * 舞台下緣，是因為舞台下緣那一帶就是卡片所在的地方。
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
 * 目錄：九章，點哪一章就從那一章第一步開始。**導覽有三十步，不能只有「從頭走到尾」這一條路**
 * ——想知道怎麼掃 QR 碼的人不該先按十七次「下一步」。手動打開（按導航列的「?」）時先看到它；
 * 第一次自己跳出來時直接從第一步開始，想跳章再按卡片上的章節名。
 */
function IndexCard({ chapters, current, onPick, onClose, exitLabel }: {
  chapters: ReturnType<typeof chaptersFor>
  current: string
  onPick: (first: number) => void
  onClose: () => void
  exitLabel: string
}) {
  const t = useT()
  return (
    <div class="stack guide">
      <div class="guide-step-head">
        <h2 class="guide-step-title">{t('guideIndexHint')}</h2>
        <button class="icon-btn" onClick={onClose} aria-label={exitLabel}><IconClose /></button>
      </div>
      <div class="sheet-items">
        {chapters.map((c) => (
          <button
            class="sheet-item" key={c.id} onClick={() => onPick(c.first)}
            aria-current={c.id === current ? 'true' : undefined}
          >
            <span class="sheet-item-main"><strong>{t(c.title)}</strong></span>
            <span class="sheet-item-value">{t(c.count === 1 ? 'guideStepsOne' : 'guideStepsCount', { n: c.count })}</span>
            <IconChevronRight class="go" />
          </button>
        ))}
      </div>
      {/*
        「從頭看」：不想挑章的人有一顆大的、永遠在同一個位置的路（黏在卡片下緣，跟步驟卡的
        按鈕列是同一格）。它跟點第一章走到同一處，但說的是意圖：「帶我全部走一遍」，不必先
        讀完九章的名字再決定。目錄裡只有這一顆 `.btn-primary`。
      */}
      <div class="guide-actions">
        <button class="btn btn-primary btn-lg btn-block" onClick={() => onPick(0)}>{t('guideFromStart')}</button>
      </div>
    </div>
  )
}

/** 說明卡片的內容：我在哪、這一步講什麼、這一步要做的事、出口。 */
function StepCard({
  steps, index, onStep, onIndex, demo, names, onClose, exitLabel, onFinish, finishLabel,
  showLater, primaryRef,
}: {
  steps: readonly Step[]
  index: number
  onStep: (n: number) => void
  onIndex: () => void
  demo: Demo
  names: string[]
  onClose: () => void
  exitLabel: string
  onFinish: () => void
  finishLabel: string
  showLater: boolean
  primaryRef: RefObject<HTMLButtonElement>
}) {
  const t = useT()
  const step = steps[index] as Step
  const local = !isSupabaseConfigured
  const chapter = chaptersFor(steps).find((c) => c.id === step.chapter)
  const last = index === steps.length - 1
  const body = local && step.bodyLocal ? step.bodyLocal : step.body
  const where = `${chapter ? t(chapter.title) : ''} · ${t('guideCount', { n: index + 1, total: steps.length })}`

  return (
    <div class="stack guide">
      {/* 報讀的是「第 2 步，共 29 步：邀請點名」。 */}
      <p class="sr-only" role="status">
        {t('guideProgress', { n: index + 1, total: steps.length })}：{t(step.title)}
      </p>

      <section class="guide-pane" key={step.id}>
        <div class="guide-step-head">
          <span class="guide-num" aria-hidden="true">{index + 1}</span>
          <h2 class="guide-step-title">{t(step.title)}</h2>
          {/*
            **隨時退得出去**：導覽有三十步，第一次打開的人不該為了離開它按三十下。這顆在每一步
            的同一個位置。面板沒有關閉鍵，Esc 與返回手勢是看不見的出口，這是看得見的那一個。
          */}
          <button class="icon-btn" onClick={onClose} aria-label={exitLabel}><IconClose /></button>
        </div>
        {/* 我在哪一章、第幾步；點下去開目錄。 */}
        <div class="guide-where-wrap">
          <button class="guide-where" onClick={onIndex} aria-haspopup="dialog">
            {where}<IconChevronRight size={16} />
          </button>
          <div class="guide-track" aria-hidden="true">
            <span style={{ width: `${((index + 1) / steps.length) * 100}%` }} />
          </div>
        </div>
        <p class="guide-step-body">{t(body)}</p>
        {/* 說在第一步，因為「略過」就在第一步：按下去之前就該知道還拿得回來。放在按鈕列上面而不是
            底下，這樣按鈕列永遠是卡片的最後一格、位置不隨步驟動。 */}
        {index === 0 && showLater && <p class="hint">{t('guideLater')}</p>}
        {step.extra === 'feedback' && <DemoFeedback names={names} demo={demo} />}
      </section>

      <div class="guide-actions">
        {index > 0 ? (
          <button class="btn btn-lg btn-block" onClick={() => onStep(index - 1)}>{t('guidePrev')}</button>
        ) : (
          <button class="btn btn-lg btn-block" onClick={onIndex}>{t('guideIndex')}</button>
        )}
        <button
          ref={primaryRef}
          class="btn btn-primary btn-lg btn-block"
          onClick={last ? onFinish : () => onStep(index + 1)}
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
 * - **`firstRun`**：第一次打開 app、停在首頁時自己跳出來。從第一步開始，最後一步是「開始使用」，
 *   第一步說一次去哪裡拿回來。
 * - **手動**：使用者按導航列的「?」。人已經在 app 裡了，所以先看到目錄、最後一步是「完成」，
 *   也不必再說「去哪裡拿回來」——他剛剛才按過那顆鍵。
 *
 * **聚焦框**（`.tour-focus`）是一個量出來的方框：目標元素的位置，往外放大一圈。它的暗部不是
 * 另外畫的遮罩，是它自己的 `box-shadow` 往外撒一整個螢幕那麼大——框在哪，亮的就在哪，其餘都暗；
 * `--scrim` 是面板與對話框後面同一層遮罩，深淺兩個主題各自有自己的值。位置由 CSS 轉場帶過去
 * （尊重「減少動態效果」）。這一步沒有東西可框（`target: null`）或在看目錄時，框不畫。
 *
 * **說明卡片的位置是規則，不是量出來的版面**：目標在上半屏，卡片就釘在下緣；目標在下半屏
 * （面板裡的東西、底部動作列），卡片抬到它上方。這樣同一個畫面上連續幾步的「下一步」在同一個
 * 位置，連按不必追著它跑；而卡片永遠在拇指碰得到的那一帶，不在目標旁邊飄。卡片放不下時內部捲動，
 * 不蓋住目標，「上一步／下一步」黏在卡片下緣。
 *
 * 做成一個疊層：`useModal`（焦點、Esc、背景 `inert`、鎖捲動）與 `useHistoryLayers`
 * （系統返回手勢先關掉它，不是整個退出空間），跟 `Sheet` 同一套。
 *
 * 初始焦點放在「下一步」：`useModal` 取的是 DOM 裡第一個可聚焦元素，而 Enter 不該是跳過。
 * **要等卡片畫出來之後才聚焦**：量好聚焦框的位置之前卡片是 `visibility: hidden` 的，對隱藏的
 * 元素 `focus()` 會靜默失敗（`useModal` 自己的初始聚焦也一樣），焦點會留在 `<body>`。
 * 換步時**不搬焦點**（留在「下一步」上，鍵盤使用者可以連按 Enter），改用一行 `sr-only` 的
 * `role="status"` 報「第 2 步，共 29 步」。
 */
export function GuideTour({ onClose, firstRun }: { onClose: () => void; firstRun: boolean }) {
  const t = useT()
  const cloud = isSupabaseConfigured
  const steps = stepsFor(cloud)
  const chapters = chaptersFor(steps)
  const [index, setIndex] = useState(0)
  const [mode, setMode] = useState<'step' | 'index'>(firstRun ? 'step' : 'index')
  const demo = useDemo()
  const layer = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const primary = useRef<HTMLButtonElement>(null)
  const [box, setBox] = useState<Box | null>(null)
  const [vh, setVh] = useState(0)

  const names = DEMO_NAMES.map((k) => t(k))
  const text: DemoText = {
    names,
    note3: t('guideDemoNote3'),
    groups: [t('guideDemoGroup1'), t('guideDemoGroup2')],
    roomName: t('exampleName'),
  }
  const step = steps[index] as Step
  const selector = mode === 'step' ? step.target : null
  const stageId = mode === 'index' ? 'home' : step.stage

  useModal(layer, onClose)
  useHistoryLayers(1, onClose)

  /*
    每次 render 都量一次，結果沒變就不 setState（回傳同一個物件，Preact 不會再 render）。
    換步時舞台整個換掉，目標元素是新的；使用者轉螢幕、改字級也會讓位置變。
    `useLayoutEffect`：在畫面第一次畫出來之前就把框放對，不會看到它從 (0, 0) 滑過來。
  */
  useLayoutEffect(() => {
    const measure = () => {
      const host = layer.current
      if (host) setVh(host.clientHeight)
      const target = selector ? stage.current?.querySelector<HTMLElement>(selector) : null
      if (!target) { setBox((p) => (p === null ? p : null)); return }
      const r = target.getBoundingClientRect()
      /* 往外放大一圈，但不超出螢幕：全寬的東西（篩選列）放大之後會伸出左右緣，描邊就被切掉了，
         看起來像一條沒有邊的色帶。夾在離螢幕邊緣 `INSET` 的地方。 */
      const left = Math.max(r.left - PAD, INSET)
      const top = Math.max(r.top - PAD, INSET)
      const right = Math.min(r.right + PAD, (host?.clientWidth ?? Infinity) - INSET)
      const bottom = Math.min(r.bottom + PAD, (host?.clientHeight ?? Infinity) - INSET)
      const next = { x: left, y: top, w: right - left, h: bottom - top }
      setBox((p) => (p && p.x === next.x && p.y === next.y && p.w === next.w && p.h === next.h ? p : next))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  })

  let card: { bottom: number; maxHeight: number } | null = null
  if (vh > 0) {
    if (!box) {
      card = { bottom: EDGE, maxHeight: vh - 2 * EDGE }
    } else {
      const lower = box.y + box.h / 2 > vh / 2
      const space = lower ? box.y - GAP - EDGE : vh - (box.y + box.h) - GAP - EDGE
      const maxHeight = Math.min(Math.max(space, MIN_CARD), vh - 2 * EDGE)
      // 卡片的上緣不能高過螢幕上緣（`EDGE`）：放不下時把它往下壓，蓋住一點框，不要跑出螢幕。
      const bottom = lower ? vh - box.y + GAP : EDGE
      card = { bottom: Math.min(bottom, vh - EDGE - maxHeight), maxHeight }
    }
  }

  const ready = card !== null
  useEffect(() => {
    if (!ready) return
    if (mode === 'step') primary.current?.focus()
    else layer.current?.querySelector<HTMLElement>('.tour-callout .sheet-item')?.focus()
  }, [ready, mode])

  const exitLabel = firstRun ? t('guideSkip') : t('close')
  const toStep = (n: number) => { setIndex(n); setMode('step') }

  return (
    <div class="tour">
      <div class="tour-layer" ref={layer} role="dialog" aria-modal="true" aria-label={t('guideTitle')}>
        <div class="tour-stage" ref={stage}>
          <Stage id={stageId} ctx={{ cloud, demo, interactive: mode === 'step' && !!step.interactive, text }} />
        </div>
        {box && (
          <div
            class="tour-focus" aria-hidden="true" data-target={selector ?? undefined}
            style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
          />
        )}
        {/* 量好之前不畫：卡片的位置取決於框在哪，先畫出來再跳過去是閃一下。 */}
        <div
          class="dialog tour-callout" data-step={mode === 'step' ? step.id : 'index'}
          style={card ?? { visibility: 'hidden' }}
        >
          {mode === 'index' ? (
            <IndexCard
              chapters={chapters} current={step.chapter} onPick={toStep}
              onClose={onClose} exitLabel={exitLabel}
            />
          ) : (
            <StepCard
              steps={steps} index={index} onStep={toStep} onIndex={() => setMode('index')}
              demo={demo} names={names} onClose={onClose} exitLabel={exitLabel}
              onFinish={onClose} finishLabel={firstRun ? t('guideStart') : t('done')}
              showLater={firstRun} primaryRef={primary}
            />
          )}
        </div>
      </div>
    </div>
  )
}
