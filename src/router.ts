import { useEffect, useState } from 'preact/hooks'

/**
 * Hash 路由。GitHub Pages 對未知路徑會回 404，沒有 SPA fallback，
 * 所以分享連結必須走 hash——這樣 `#/j/K7F2QM` 一定打得開。
 */
function currentPath(): string {
  const h = window.location.hash.replace(/^#/, '')
  return h.startsWith('/') ? h : '/'
}

export function useRoute(): string {
  const [path, setPath] = useState(currentPath())
  useEffect(() => {
    const onChange = () => setPath(currentPath())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return path
}

/** 目前的路由。OAuth 導走之前要記下來，回來才知道該把人放回哪裡。 */
export function currentRoute(): string {
  return currentPath()
}

export function navigate(to: string, opts?: { replace?: boolean }): void {
  if (opts?.replace) window.location.replace(`#${to}`)
  else window.location.hash = to
}

/** 給協助者掃 / 點的加入連結。 */
export function joinUrl(code: string): string {
  const base = import.meta.env.BASE_URL || '/'
  return `${window.location.origin}${base}#/j/${code}`
}
