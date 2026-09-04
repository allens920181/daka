import { useEffect, useRef, useState } from 'preact/hooks'
import { extractRoomCode, isValidRoomCode } from '../lib/code'
import { canScanQr } from '../lib/config'
import { navigate } from '../router'
import { Sheet } from './Sheet'
import { useT } from './t'

type ScanStatus = 'loading' | 'scanning' | 'error'

/**
 * 用相機掃 QR 碼加入——分享有代碼、連結、QR 碼三種方式，首頁原本只接得住代碼
 * （連結貼進代碼框由 extractRoomCode 接住），這是補上的第三條路。
 *
 * 相機與解碼函式庫（jsqr）都是動態載入：多數人首頁只是打代碼，不該讓
 * 每個人都背著這幾十 KB 的重量。
 */
export function ScanSheet({ onClose }: { onClose: () => void }) {
  const t = useT()
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState<ScanStatus>('loading')
  const [errorText, setErrorText] = useState('')

  useEffect(() => {
    if (!canScanQr()) {
      setStatus('error')
      setErrorText(t('errNoCamera'))
      return
    }

    let stream: MediaStream | null = null
    let raf = 0
    let cancelled = false

    async function start() {
      // 兩件慢事一起動：jsqr 不需要等權限，跟相機請求同時發，掃描前才 await。
      const decodeLoaded = import('jsqr')
      let media: MediaStream
      try {
        media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      } catch {
        if (!cancelled) { setStatus('error'); setErrorText(t('errCameraDenied')) }
        return
      }
      if (cancelled) { media.getTracks().forEach((tr) => tr.stop()); return }
      stream = media

      const video = videoRef.current
      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')
      if (!video || !canvas || !ctx) return
      video.srcObject = media
      await video.play().catch(() => {})
      if (cancelled) return
      setStatus('scanning')

      const decode = (await decodeLoaded).default
      if (cancelled) return

      const tick = () => {
        if (cancelled) return
        if (video.readyState >= video.HAVE_CURRENT_DATA && video.videoWidth > 0) {
          canvas.width = video.videoWidth
          canvas.height = video.videoHeight
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
          const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
          const found = decode(image.data, image.width, image.height)
          const code = found ? extractRoomCode(found.data) : null
          if (code && isValidRoomCode(code)) {
            cancelled = true
            navigate(`/j/${code}`)
            return
          }
        }
        raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    }

    void start()

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((tr) => tr.stop())
    }
  }, [])

  return (
    <Sheet title={t('scanQr')} onClose={onClose}>
      <div class="stack">
        <div class="scan-frame">
          <video ref={videoRef} class="scan-video" muted playsInline aria-hidden="true" />
          <canvas ref={canvasRef} hidden />
        </div>
        {status === 'scanning' && <p class="hint">{t('scanQrHint')}</p>}
        {status === 'loading' && <p class="hint">{t('loading')}</p>}
        {status === 'error' && <p class="note note-warn">{errorText}</p>}
      </div>
    </Sheet>
  )
}
