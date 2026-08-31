import { useEffect, useMemo, useState } from 'preact/hooks'
import { connection, dismissToast, enterRoom, groups, leaveRoom, members, room } from '../lib/store'
import { summarize } from '../lib/merge'
import { navigate } from '../router'
import { errorMessage } from './NewRoom'
import { useT } from './t'

/**
 * 看板模式：平板放在門邊給大家看。
 *
 * 觀看距離從 30 公分變成 3 公尺，所以字級另成一套（見 docs/design/03-tokens.md §4.1）。
 * 不可點名——看板是唯讀的，避免路過的人靠上去就改了狀態。
 */
export function Board({ code }: { code: string }) {
  const t = useT()
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [group, setGroup] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    // 進看板前把殘留的提示收掉，否則上一個畫面的「復原」會跟著出現。
    dismissToast()
    enterRoom(code)
      .then(() => { if (alive) setStatus('ready') })
      .catch((e: unknown) => {
        if (!alive) return
        setError(errorMessage(e, t, 'join'))
        setStatus('error')
      })
    return () => { alive = false; leaveRoom() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code])

  useWakeLock()

  const current = room.value
  const all = members.value
  const groupList = groups.value

  const scoped = useMemo(
    () => (group === null ? all : all.filter((m) => m.group_label === group)),
    [all, group],
  )
  const s = useMemo(() => summarize(scoped), [scoped])
  const missing = useMemo(() => scoped.filter((m) => m.status === 'pending'), [scoped])
  const allHere = s.people > 0 && s.pending === 0

  if (status === 'error' || (status === 'loading' && !current)) {
    return (
      <div class="board">
        <div class="board-center">
          <p class="board-label">{status === 'error' ? error : t('loading')}</p>
          {status === 'error' && (
            <button class="btn btn-lg" onClick={() => navigate(`/r/${code}`)}>{t('back')}</button>
          )}
        </div>
      </div>
    )
  }
  if (!current) return null

  return (
    <div class="board">
      <div class="board-head">
        <span class="board-title">{current.name}</span>
        {group && <span class="board-scope">{group}</span>}
        <span
          class={`board-sync sync-${connection.value === 'local-only' ? 'local' : connection.value}`}
          role="status"
        >
          <span class="sync-dot" />
          <span class="board-sync-text">{syncLabel(connection.value, t)}</span>
        </span>
      </div>

      {/*
        看板最大的字要是「現在還缺誰」，不是「已經到了幾個」。車長站在門口看
        看板，他要做的決定是「能不能開車」——已到的數字回答不了那個問題，未到
        的人名才可以。全部到齊之後才換成那句話當主角。
      */}
      <div class="board-center" role="status" aria-live="polite">
        {allHere ? (
          <>
            <p class="board-hero done">{t('allHere')}</p>
            <p class="board-sub">{t('headcount', { arrived: s.arrivedHeadcount, total: s.expectedHeadcount })}</p>
          </>
        ) : (
          <>
            {/* 數字自己一個字級，標籤跟在後面——把整句「還有 24 位沒到」都放大到
                主角字級的話，一行就吃掉整個看板的寬度。 */}
            <p class="board-hero">
              {s.pending}
              <span class="board-hero-unit">{t('missingUnit')}</span>
            </p>
            <ul class={`board-names${missing.length > 12 ? ' dense' : ''}`}>
              {missing.map((m) => (
                <li key={m.id}>
                  {m.name}
                  {m.companions > 0 && <span class="board-plus">＋{m.companions}</span>}
                </li>
              ))}
            </ul>
            <p class="board-sub">{t('headcount', { arrived: s.arrivedHeadcount, total: s.expectedHeadcount })}</p>
          </>
        )}
      </div>

      <div class="board-foot">
        {groupList.length > 0 && (
          <div class="groups" role="group" aria-label={t('group')}>
            <button class="group-chip" aria-pressed={group === null} onClick={() => setGroup(null)}>
              {t('allGroups')}
            </button>
            {groupList.map((g) => (
              <button key={g} class="group-chip" aria-pressed={group === g} onClick={() => setGroup(g)}>
                {g}
              </button>
            ))}
          </div>
        )}
        <div class="spacer" />
        <button class="btn" onClick={() => navigate(`/r/${code}`)}>{t('exitBoard')}</button>
      </div>
    </div>
  )
}

/**
 * 讓螢幕不要自動關掉。平板放在門邊十分鐘沒人碰，預設就會睡著。
 * 切到背景時系統會自動釋放，所以回到前景要重新取得。
 */
/** 看板上的同步狀態要有文字，不能只有一顆圓點——3 公尺外看不出顏色差別。 */
function syncLabel(state: string, t: ReturnType<typeof useT>): string {
  if (state === 'online') return t('syncOnline')
  if (state === 'offline') return t('syncOffline')
  if (state === 'syncing') return t('syncSyncing')
  return t('syncLocalOnly')
}

function useWakeLock(): void {
  useEffect(() => {
    let lock: WakeLockSentinel | null = null
    let cancelled = false

    const acquire = async () => {
      if (cancelled || document.hidden) return
      try {
        lock = (await navigator.wakeLock?.request('screen')) ?? null
      } catch {
        /* 不支援、電量過低或被使用者停用——看板仍可用，只是螢幕會睡著。 */
      }
    }
    const onVisible = () => { if (!document.hidden) void acquire() }

    void acquire()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      void lock?.release().catch(() => {})
    }
  }, [])
}
