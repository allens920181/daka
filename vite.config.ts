import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages 服務於 https://<user>.github.io/<repo>/，所以需要 base。
// 自訂網域或改 repo 名稱時，用 VITE_BASE 覆寫（例如 VITE_BASE=/ ）。
const base = process.env.VITE_BASE ?? '/daka/'

export default defineConfig({
  base,
  plugins: [
    preact(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: '誰沒到',
        short_name: '誰沒到',
        description: '團體現場多人同步點名：開一間房，大家一起點同一份名單。',
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
  build: {
    target: 'es2020',
    sourcemap: false,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
