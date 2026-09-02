import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages 服務於 https://<user>.github.io/<repo>/，所以需要 base。
// 自訂網域或改 repo 名稱時，用 VITE_BASE 覆寫（例如 VITE_BASE=/ ）。
const base = process.env.VITE_BASE ?? '/daka/'

/**
 * 用區網位址開發時的 HTTPS。
 *
 * `http://192.168.x.x:5173` 不是 secure context：網址列會標「不安全」，而且
 * 瀏覽器會收掉 service worker、`navigator.clipboard` 與 `crypto.subtle`。
 * 要在手機上測真正的 PWA 行為，就得給這個位址一張憑證：
 *
 *   mkcert -install
 *   mkcert 192.168.x.x localhost 127.0.0.1
 *   VITE_HTTPS_KEY=./192.168.x.x-key.pem VITE_HTTPS_CERT=./192.168.x.x.pem npm run dev
 *
 * mkcert 會把自己的根憑證裝進系統信任清單，手機要另外裝一次（把 rootCA.pem
 * 傳過去安裝並信任），裝完那台手機才會認。沒設這兩個環境變數就照常跑 http，
 * 不強迫任何人為了改一行 CSS 去弄憑證。
 */
function devHttps(): { key: Buffer; cert: Buffer } | undefined {
  const key = process.env.VITE_HTTPS_KEY
  const cert = process.env.VITE_HTTPS_CERT
  if (!key || !cert) return undefined
  return { key: readFileSync(key), cert: readFileSync(cert) }
}

export default defineConfig({
  base,
  plugins: [
    preact(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'RollRoom',
        short_name: 'RollRoom',
        description: '團體現場多人同步點名：大家一起點同一份名單。',
        lang: 'zh-TW',
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f6f7f8',
        theme_color: '#0e5e63',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          // maskable 要用另一張圖：作業系統會自己套形狀遮罩，所以圖示本身
          // 不能先圓角（icon-512 是 rx=112 的圓角徽章，四角透明）。那會變成
          // 「圓角再被圓角切一次」，或在彩色底上露出透明的四個角。
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // 點名資料一律走 RPC，不快取 API 回應——寧可顯示離線，
        // 也不要拿舊快照騙使用者說已經同步。
        navigateFallback: `${base}index.html`,
        runtimeCaching: [],
      },
    }),
  ],
  // 綁 0.0.0.0 而不是只綁 localhost：這個產品要在現場用五支手機同時點同一份
  // 名單，開發時本來就得從別台裝置連進來。CLI 的 --host 仍然可以覆寫。
  server: { host: true, https: devHttps() },
  preview: { host: true, https: devHttps() },
  build: {
    target: 'es2020',
    sourcemap: false,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
