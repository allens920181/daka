import { useEffect, useState } from 'preact/hooks'
import { booted } from './lib/store'
import { navigate, useRoute } from './router'
import { Board } from './ui/Board'
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

  // 分享連結是 #/j/CODE。進來後換成 #/r/CODE，
  // 這樣重新整理或按上一頁不會又跑一次「加入」流程。
  const joining = path.match(/^\/j\/([^/]+)/)
  useEffect(() => {
    if (joining?.[1]) navigate(`/r/${joining[1].toUpperCase()}`, { replace: true })
  }, [joining?.[1]])

  if (!booted.value) return <p class="center-note">{t('loading')}</p>
  if (joining) return <p class="center-note">{t('loading')}</p>

  const inRoom = path.match(/^\/r\/([^/]+)/)
  const onBoard = path.match(/^\/b\/([^/]+)/)

  return (
    <>
      {onBoard?.[1]
        ? <Board code={onBoard[1].toUpperCase()} />
        : inRoom?.[1]
          ? <Room code={inRoom[1].toUpperCase()} />
          : path === '/new'
            ? <NewRoom />
            : <Home onSettings={() => setSettings(true)} />}

      {settings && <SettingsSheet onClose={() => setSettings(false)} />}
      {/* 看板是唯讀的，沒人該去點它——一個「復原」按鈕在那裡只會令人困惑。 */}
      {!onBoard && <Toast />}
    </>
  )
}
