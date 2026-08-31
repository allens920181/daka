import { useState } from 'preact/hooks'
import { createRoom, savedRosters } from '../lib/store'
import { AppError, isSupabaseConfigured } from '../lib/supabase'
import { navigate } from '../router'
import { RosterInput, draftsFrom } from './RosterInput'
import { IconBack } from './icons'
import { useT } from './t'

export function NewRoom() {
  const t = useT()
  const [name, setName] = useState('')
  const [text, setText] = useState('')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const drafts = draftsFrom(text)

  async function submit() {
    if (drafts.length === 0) { setError(t('emptyRoster')); return }
    setWorking(true)
    setError(null)
    try {
      const code = await createRoom(name, drafts)
      navigate(`/r/${code}`, { replace: true })
    } catch (e) {
      setError(errorMessage(e, t))
      setWorking(false)
    }
  }

  return (
    <>
      <div class="topbar">
        <div class="shell topbar-inner">
          <button class="icon-btn" onClick={() => navigate('/')} aria-label={t('back')}>
            <IconBack />
          </button>
          <h1 class="topbar-name">{t('openRoom')}</h1>
        </div>
      </div>

      <div class="shell stack" style="padding-top:16px; padding-bottom:120px">
        <div class="field">
          <label class="label" for="room-name">{t('roomNamePlaceholder')}</label>
          <input
            id="room-name"
            class="input"
            value={name}
            maxLength={80}
            placeholder={t('roomNamePlaceholder')}
            onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
          />
        </div>

        <RosterInput
          text={text}
          onText={setText}
          rosters={isSupabaseConfigured ? savedRosters.value : undefined}
        />

        {error && <p class="note note-warn">{error}</p>}
      </div>

      <div class="dock">
        <div class="dock-inner">
          <button
            class="btn btn-primary btn-lg btn-block"
            disabled={working || drafts.length === 0}
            onClick={() => { void submit() }}
          >
            {working ? t('loading') : `${t('create')}（${drafts.length}）`}
          </button>
        </div>
      </div>
    </>
  )
}

export function errorMessage(e: unknown, t: ReturnType<typeof useT>): string {
  if (!(e instanceof AppError)) return t('errUnknown')
  switch (e.kind) {
    case 'offline': return t('errOffline')
    case 'room-not-found': return t('errRoomNotFound')
    case 'room-closed': return t('errRoomClosed')
    case 'not-owner': return t('errNotOwner')
    case 'not-configured': return t('errNotConfigured')
    case 'too-many-members': return t('errUnknown')
    default: return t('errUnknown')
  }
}
