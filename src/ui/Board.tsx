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
        setError(errorMessage(e, t))
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
        <span class="board-title">{current.name}{group ? ` · ${group}` : ''}</span>
        <span class={`board-sync sync-${connection.value === 'local-only' ? 'local' : connection.value}`}>
          <span class="sync-dot" />
        </span>
      </div>

      <div class="board-center">
        <div class="board-count" role="status" aria-live="polite">
          <span class="board-num">{s.arrivedHeadcount}</span>
          <span class="board-slash">/</span>
          <span class="board-total">{s.headcount}</span>
        </div>
        <p class="board-label">{t('arrived')}</p>

        <p class={s.pending === 0 ? 'board-missing done' : 'board-missing'}>
          {s.pending === 0 ? t('allHere') : t('missingCount', { n: s.pending })}
        </p>

        {missing.length > 0 && (
          <ul class="board-names">
            {missing.map((m) => (
              <li key={m.id}>
                {m.name}
                {m.companions > 0 && <span class="board-plus">＋{m.companions}</span>}
              </li>
            ))}
          </ul>
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
