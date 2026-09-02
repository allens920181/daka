import { render } from 'preact'
import { App } from './app'
import { secureOrigin } from './lib/config'
import { boot } from './lib/store'
import './styles.css'

// 從區網位址（http://192.168.x.x:5173）開時，瀏覽器不把這個來源當 secure
// context——網址列會標「不安全」，service worker 不會註冊，Google 登入也走不通。
// App 本身有退路，但這會讓人以為是自己改壞了什麼，所以開發時直接講。
if (import.meta.env.DEV && !secureOrigin()) {
  console.warn(
    '[RollRoom] 這個來源不是 secure context（網址列的「不安全」）。\n' +
    '影響：service worker／PWA 不會註冊、navigator.clipboard 與 crypto.subtle 不存在\n' +
    '（所以 Google 登入不能用，Email 驗證碼可以）。\n' +
    '要完整測試請用 HTTPS——見 vite.config.ts 的 devHttps() 說明。',
  )
}

const root = document.getElementById('app')
if (root) {
  render(<App />, root)
  void boot()
}
