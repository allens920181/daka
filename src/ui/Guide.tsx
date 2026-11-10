import { connection } from '../lib/store'
import { Sheet } from './Sheet'
import { useT } from './t'

/**
 * 使用說明的內容：**一場活動從頭到尾的四步**（2026-11）。
 *
 * 兩個地方用同一份：第一次打開 app 的彈窗（`GuideSheet`），與「設定 › 使用說明」
 * 那張子畫面（`SettingsSheet`）。內容只有一份，兩處才不會各自漂移。
 *
 * **編號靠 CSS counter，不靠 `<ol>` 自己的記號**：`.guide-step::before` 要把數字畫進
 * 一顆圓裡，而 `list-style: none` 在 Safari 會讓 VoiceOver 不再把它當成清單——所以
 * 明寫 `role="list"`，數字則由生成內容唸出來。
 *
 * 第二步在單機模式下換一句話：那時候「把代碼給協助的人」是不會發生的事
 * （見 `shareLocalBody`）。單機模式是建置期常數，不是暫時斷線，所以不會在使用中途跳來跳去。
 */
export function GuideSteps({ heading = true }: { heading?: boolean }) {
  const t = useT()
  const localOnly = connection.value === 'local-only'
  const steps: [string, string][] = [
    [t('guideStep1Title'), t('guideStep1Body')],
    [t('guideStep2Title'), localOnly ? t('guideStep2BodyLocal') : t('guideStep2Body')],
    [t('guideStep3Title'), t('guideStep3Body')],
    [t('guideStep4Title'), t('guideStep4Body')],
  ]
  return (
    <>
      {/*
        標題說的是「這一頁是四步」，比設定裡那一列（「使用說明」）多說了一件事，
        所以這裡不適用面板「不印標題」的判準（見 overlays.md）：第一次打開的人不是
        點了某一列進來的，面板是自己跳出來的，他需要先知道這是什麼、要讀多少。
      */}
      {heading && <h2 class="guide-heading">{t('guideHeading')}</h2>}
      <ol class="guide-steps" role="list">
        {steps.map(([title, body]) => (
          <li class="guide-step" key={title}>
            <strong class="guide-step-title">{title}</strong>
            <p class="guide-step-body">{body}</p>
          </li>
        ))}
      </ol>
    </>
  )
}

/**
 * 第一次打開 app 時的彈窗。
 *
 * 用底部面板（`Sheet`），不是確認對話框：它是一段要讀的內容，不是一個「是或否」
 * 的決定；而且這個 app 只有一種「再給我一層」的形狀（見 `Sheet` 的說明）。
 *
 * **面板本身沒有關閉鍵，所以這一頁自己帶一顆「開始使用」**——它是這個畫面唯一的
 * 主要按鈕，也是使用者唯一看得見、讀得懂的出口。點面板外面、Esc、往下滑一樣關得掉，
 * 而且**任何一種關法都算看過**（由呼叫端在 `onClose` 裡記下來）。
 *
 * 初始焦點因此落在那顆按鈕上（`useModal` 取第一個可聚焦元素）：Enter 就是「知道了」。
 */
export function GuideSheet({ onClose }: { onClose: () => void }) {
  const t = useT()
  return (
    <Sheet title={t('guideTitle')} onClose={onClose}>
      <div class="stack guide">
        <GuideSteps />
        {/* 關掉之後它就不會再自己出現，所以要說一次去哪裡拿回來。 */}
        <p class="hint">{t('guideLater')}</p>
        <button class="btn btn-primary btn-lg btn-block" onClick={onClose}>
          {t('guideStart')}
        </button>
      </div>
    </Sheet>
  )
}
