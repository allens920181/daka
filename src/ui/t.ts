import { translate, type MessageKey } from '../lib/i18n'
import { prefs } from '../lib/store'

/** 讀 prefs signal，語言一換所有用到的元件自動重繪。 */
export function useT() {
  const lang = prefs.value.lang
  return (key: MessageKey, vars?: Record<string, string | number>) => translate(lang, key, vars)
}
