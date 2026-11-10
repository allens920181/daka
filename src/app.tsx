import { useEffect, useState } from 'preact/hooks'
import { booted, prefs, setPrefs } from './lib/store'
import { navigate, useRoute } from './router'
import { GuideTour } from './ui/Guide'
import { Home } from './ui/Home'
import { NewRoom } from './ui/NewRoom'
import { Room } from './ui/Room'
import { SettingsSheet } from './ui/Sheets'
import { Toast } from './ui/Toast'
import { useT } from './ui/t'

export function App() {
  const t = useT()
  const path = useRoute()
  const [settings, setSettings] = useState(false)
  /** 使用者自己按導航列的「?」打開教學。第一次打開時自己跳出來的那一條不經過它（見 `autoGuide`）。 */
  const [guide, setGuide] = useState(false)

  // 分享連結是 #/j/CODE。進來後換成 #/r/CODE，
  // 這樣重新整理或按上一頁不會又跑一次「加入」流程。
  const joining = path.match(/^\/j\/([^/]+)/)
  useEffect(() => {
    if (joining?.[1]) navigate(`/r/${joining[1].toUpperCase()}`, { replace: true })
  }, [joining?.[1]])

  if (!booted.value) return <p class="center-note">{t('loading')}</p>
  if (joining) return <p class="center-note">{t('loading')}</p>

  const inRoom = path.match(/^\/r\/([^/]+)/)

  /*
    使用說明（2026-11）：第一次打開 app、停在首頁時跳出一次。

    **只在首頁。** 協助者是掃 QR 或點連結直接落進空間的（`/j/` → `/r/`），他們
    站在遊覽車門口、手上只有一件事要做——一張寫給主揪看的四步說明擋在名單前面，
    是在最不該的時刻多一層。他們第一次回到首頁時才會看到它。

    **任何一種關法都算看過**（按「開始使用」、點外面、Esc、往下滑）：這不是一份
    要簽收的東西。`setPrefs` 先改記憶體再寫 IndexedDB，所以儲存不可用（無痕模式）時
    至少這一次開啟內不會再跳第二次。設定開著時不疊上去——兩張面板同時要使用者的注意力。
  */
  const autoGuide = !inRoom && path !== '/new' && !settings && !prefs.value.guideSeen

  /*
    兩條路進同一份導覽：自己跳出來（`autoGuide`），或使用者按導航列的「?」（`guide`）。
    **不論從哪條路進來，關掉就算看過**——按了「?」看完的人，沒有理由下次再被自己跳出來
    的那一次打擾。手動打開的那一份出口不同（見 `GuideTour` 的 `firstRun`）。
  */
  const closeGuide = () => {
    setGuide(false)
    if (!prefs.value.guideSeen) void setPrefs({ guideSeen: true })
  }

  return (
    <>
      {inRoom?.[1]
        ? <Room code={inRoom[1].toUpperCase()} onSettings={() => setSettings(true)} onGuide={() => setGuide(true)} />
        : path === '/new'
          ? <NewRoom />
          : <Home onSettings={() => setSettings(true)} onGuide={() => setGuide(true)} />}

      {settings && <SettingsSheet onClose={() => setSettings(false)} />}
      {(autoGuide || guide) && !settings && <GuideTour firstRun={autoGuide} onClose={closeGuide} />}
      <Toast />
    </>
  )
}
