import { useEffect, useState } from 'preact/hooks'
import { booted } from './lib/store'
import { navigate, useRoute } from './router'
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

  return (
    <>
      {inRoom?.[1]
        ? <Room code={inRoom[1].toUpperCase()} />
        : path === '/new'
          ? <NewRoom />
          : <Home onSettings={() => setSettings(true)} />}

      {settings && <SettingsSheet onClose={() => setSettings(false)} />}
      <Toast />
    </>
  )
}
