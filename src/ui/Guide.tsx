import type { RefObject } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { toShareText } from '../lib/export'
import { formatTime } from '../lib/format'
import type { MessageKey } from '../lib/i18n'
import { connection, prefs } from '../lib/store'
import type { Member, Room } from '../lib/types'
import { IconCheck } from './icons'
import { Sheet } from './Sheet'
import { useT } from './t'

/** 四步：創建空間 → 邀請點名 → 點名 → 結束點名。標題（「四步」）與 e2e 的斷言一起改。 */
const STEPS = 4

/** 演練名單的三個人。 */
const DEMO_NAMES: readonly MessageKey[] = ['guideDemoName1', 'guideDemoName2', 'guideDemoName3']

/**
 * 第三步的演練：**三個人的名單，點得動，行為跟真的點名畫面一模一樣**（2026-11）。
 *
 * 名單列是同一個 `.member`、同一顆 `.check`——使用者在這裡學到的「點一下就是已到」，
 * 到真的畫面上看到的是同一個東西，不是一張示意圖。點完也跟真的一樣跳一個 Toast
 * （「某某 · 已到」＋「復原」），而且復原做的事也一樣：把**剛剛那一個人**退回去。
 *
 * **全部住在這個元件的記憶體裡**：不碰 `members`、不碰佇列、不碰網路。關掉就沒了，
 * 也不會有哪一份真的名單多出三個「王小明」。
 *
 * `at` 是每個人被點到的時間（`null` ＝ 還沒到），不是一個布林：真的名單列在右邊印著
 * 「幾點」，演練也印，不然那一格在第一次看到真的畫面時是個沒人解釋過的東西。
 * 第四步的結果文字也吃同一份 `at`——它是**使用者剛剛點出來的**，不是寫死的範例。
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

function DemoRoster({ names, demo }: { names: string[]; demo: ReturnType<typeof useDemo> }) {
  const t = useT()
  const { at, last, toggle, undo } = demo
  const missing = at.filter((v) => v === null).length
  return (
    /*
      底色是 `--paper`，不是面板的 `--surface`：真的名單是坐在頁面上的，未到的列
      「浮起」（--surface ＋ 陰影）、已到的列「沉回頁面」（透明）靠的就是它底下那一層
      比列低一階。直接放在面板的白底上，那兩個狀態會是白對白，差別只剩一個勾。
    */
    <div class="guide-demo">
      <p class="guide-demo-count">{missing === 0 ? t('allHere') : t('missingCount', { n: missing })}</p>
      <div class="guide-demo-list" role="list" aria-label={t('roster')}>
        {names.map((name, i) => {
          const time = at[i] ?? null
          const arrived = time !== null
          return (
            <div class={arrived ? 'member is-arrived' : 'member'} role="listitem" key={name}>
              <button
                class="member-main"
                aria-pressed={arrived}
                aria-label={`${name} · ${arrived ? t('markMissing') : t('markArrived')}`}
                onClick={() => toggle(i)}
              >
                <span class="check"><IconCheck /></span>
                <span class="member-body"><span class="member-name">{name}</span></span>
                {arrived && <span class="member-when">{t('at', { time: formatTime(time) })}</span>}
              </button>
            </div>
          )
        })}
      </div>
      {/*
        提示與 Toast 住在**同一格**，點完只是換掉裡面的東西，不會把名單往上頂。
        格子的高度由 Toast 決定（它比一行提示高）。

        這裡的 Toast 是真的那個樣式，但不是真的那個東西：它不在 `.toast-wrap`（固定定位
        在畫面下緣）裡，沒有五秒的計時，也不被設定裡的「點名提示」開關管——教學要示範的
        是預設的樣子。復原做的事跟真的一樣：退回剛剛那一個人，Toast 隨之收起。
      */}
      <div class="guide-demo-slot">
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
    id: 'demo', code: '', name: t('exampleName'), note: null,
    created_at: '', expires_at: '', closed_at: null, copied_from: null,
  }
  const members: Member[] = names.map((name, i) => {
    const time = at[i] ?? null
    return {
      id: `demo-${i}`, room_id: 'demo', name, note: null, phone: null, companions: 0,
      group_label: null, sort_order: i, status: time === null ? 'pending' : 'arrived',
      status_at: time === null ? null : new Date(time).toISOString(),
      status_by: null, rev: 0, created_at: '',
    }
  })
  return (
    <div class="guide-result">
      <p class="hint">{t('guideResultLead')}</p>
      {/* 跟「名單怎麼寫」的例子同一個凹槽（`.fmt-eg`）：它也是一段文字樣本。但不用
          等寬字體（`<code>`／`.mono`）：那是「照著打進輸入框的字」，而這一段是貼進
          LINE 的訊息，在 LINE 裡長什麼樣就該在這裡長什麼樣。 */}
      <p class="fmt-eg">{toShareText(room, members, prefs.value.lang)}</p>
    </div>
  )
}

/**
 * 使用說明：**一次一步的互動式教學**（2026-11）。
 *
 * 一份教學，兩種打開方式：第一次打開 app 時自己跳出來，與使用者按導航列的「?」。
 * 兩者都是 `GuideSheet`，差別只有出口——見 `firstRun`。
 *
 * 一次只給一步，是因為四步裡真正需要**動手**的只有第三步（點名），而把四步同時攤開
 * 的話，那份演練名單會被夾在兩段文字中間、跟另外三步一樣大聲。分步之後每一步都只有
 * 一件事，第三步自己有一塊足夠大的地方讓人真的去點。
 *
 * **位置穩定。** 面板是從下緣長上來的，按鈕列在最底下，所以內容高度因步而異時，
 * 變的是面板的上緣，「下一步」始終在同一個位置——連按三次不必找鍵。左邊那顆在第一步
 * 是「略過」、之後是「上一步」，右邊永遠是往前（最後一步是出口）。
 *
 * **第二步在單機模式下換一句話**：那時候「把代碼給協助的人」是不會發生的事
 * （見 `shareLocalBody`）。單機模式是建置期常數，不是暫時斷線，不會在使用中途跳來跳去。
 *
 * 換步時**不搬焦點**（留在「下一步」上，鍵盤使用者可以連按 Enter），改用一行
 * `sr-only` 的 `role="status"` 報「第 2 步，共 4 步：邀請點名」。
 */
export function GuideWalkthrough({
  onSkip, skipLabel, onFinish, finishLabel, showLater = false, primaryRef,
}: {
  /** 第一步左邊那顆鍵（略過／關閉）。面板沒有關閉鍵，所以這一頁自己帶一個出口。 */
  onSkip: () => void
  skipLabel: string
  /** 最後一步右邊那顆鍵。 */
  onFinish: () => void
  finishLabel: string
  /** 「之後想再看，按右上角的 ?」——只有自己會消失的那一份才需要說。 */
  showLater?: boolean
  /** 右邊那顆鍵。呼叫端用它把初始焦點放在「下一步」，而不是 DOM 裡的第一顆（「略過」）。 */
  primaryRef?: RefObject<HTMLButtonElement>
}) {
  const t = useT()
  const [step, setStep] = useState(0)
  const demo = useDemo()
  const localOnly = connection.value === 'local-only'
  const names = DEMO_NAMES.map((k) => t(k))

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
      {/*
        標題說的是「這一頁是四步」，比設定裡那一列（「使用說明」）多說了一件事，所以這裡
        不適用面板「不印標題」的判準（見 overlays.md）：第一次打開的人不是點了某一列進來的，
        面板是自己跳出來的，他需要先知道這是什麼、要讀多少。右邊的進度條回答後半句。
      */}
      <div class="guide-top">
        <h2 class="guide-heading">{t('guideHeading')}</h2>
        <span class="guide-bars" aria-hidden="true">
          {Array.from({ length: STEPS }, (_, i) => (
            <span class={i <= step ? 'guide-bar is-on' : 'guide-bar'} key={i} />
          ))}
        </span>
      </div>
      <p class="sr-only" role="status">
        {t('guideProgress', { n: step + 1, total: STEPS })}：{titles[step]}
      </p>

      <section class="guide-pane" key={step}>
        <div class="guide-step-head">
          <span class="guide-num" aria-hidden="true">{step + 1}</span>
          <h3 class="guide-step-title">{titles[step]}</h3>
        </div>
        <p class="guide-step-body">{bodies[step]}</p>
        {step === 2 && <DemoRoster names={names} demo={demo} />}
        {step === 3 && <ResultPreview names={names} at={demo.at} />}
      </section>

      <div class="guide-actions">
        {step > 0 ? (
          <button class="btn btn-lg btn-block" onClick={() => setStep(step - 1)}>
            {t('guidePrev')}
          </button>
        ) : (
          <button class="btn btn-lg btn-block" onClick={onSkip}>{skipLabel}</button>
        )}
        <button
          ref={primaryRef}
          class="btn btn-primary btn-lg btn-block"
          onClick={last ? onFinish : () => setStep(step + 1)}
        >
          {last ? finishLabel : t('guideNext')}
        </button>
      </div>

      {/* 關掉之後它就不會再自己出現，所以要說一次去哪裡拿回來——每一步都在，
          因為「略過」可以從第一步就按。說的是導航列右上角那顆「?」。 */}
      {showLater && <p class="hint">{t('guideLater')}</p>}
    </div>
  )
}

/**
 * 教學的面板。兩種打開方式，同一份內容（2026-11）：
 *
 * - **`firstRun`**：第一次打開 app、停在首頁時自己跳出來。左邊是「略過」、最後一步是
 *   「開始使用」，底下說一次去哪裡拿回來。
 * - **手動**：使用者按導航列的「?」。人已經在 app 裡了，所以左邊是「關閉」、最後一步是
 *   「完成」，也不必再說「去哪裡拿回來」——他剛剛才按過那顆鍵。
 *
 * 用底部面板（`Sheet`），不是確認對話框：它是一段要讀、要動手的內容，不是一個
 * 「是或否」的決定；而且這個 app 只有一種「再給我一層」的形狀（見 `Sheet` 的說明）。
 *
 * **面板本身沒有關閉鍵，所以這一頁自己帶出口**：第一步左邊那顆、最後一步右邊那顆。
 * 點面板外面、Esc、往下滑一樣關得掉，而且**任何一種關法都算看過**（由呼叫端在
 * `onClose` 裡記下來）。
 *
 * 初始焦點放在「下一步」：`useModal` 取的是 DOM 裡第一個可聚焦元素，那是左邊那顆，
 * 而 Enter 不該是跳過。這個 effect 在 `Sheet` 的**父層**，所以跑在 `useModal` 之後，
 * 後到的贏。
 */
export function GuideSheet({ onClose, firstRun }: { onClose: () => void; firstRun: boolean }) {
  const t = useT()
  const primary = useRef<HTMLButtonElement>(null)
  useEffect(() => { primary.current?.focus() }, [])
  return (
    <Sheet title={t('guideTitle')} onClose={onClose}>
      <GuideWalkthrough
        onSkip={onClose}
        skipLabel={firstRun ? t('guideSkip') : t('close')}
        onFinish={onClose}
        finishLabel={firstRun ? t('guideStart') : t('done')}
        showLater={firstRun}
        primaryRef={primary}
      />
    </Sheet>
  )
}
