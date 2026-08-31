import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 防止規範與實作漂移。
 *
 * docs/design/08-contributing.md §8.5 說「規格與實作分開放，一定會漂移」。
 * 這個測試讓那句話有牙齒：規範裡提到的每個 token、class 與檔案路徑
 * 都必須真的存在。
 */

const ROOT = new URL('..', import.meta.url).pathname
const DESIGN = join(ROOT, 'docs/design')
const css = readFileSync(join(ROOT, 'src/styles.css'), 'utf8')

function markdownFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? markdownFiles(join(dir, e.name)) : e.name.endsWith('.md') ? [join(dir, e.name)] : [],
  )
}

const docs = markdownFiles(DESIGN).map((path) => ({ path, text: readFileSync(path, 'utf8') }))
const rel = (p: string) => p.slice(ROOT.length)

/** 圍欄程式碼區塊是範例與模板，不是對實作的引用。 */
function stripFences(text: string): string {
  return text.replace(/```[\s\S]*?```/g, '')
}

/** 只看行內程式碼標記裡的內容，避免把散文裡的字誤判成識別字。 */
function inlineCode(text: string): string[] {
  return [...stripFences(text).matchAll(/`([^`\n]+)`/g)].map((m) => m[1] ?? '')
}

/** `.tsx`、`.md` 這種是副檔名，不是 CSS class。 */
const FILE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'mjs', 'cjs', 'css', 'md', 'html', 'json', 'sql',
  'png', 'svg', 'jpg', 'webp', 'yml', 'yaml', 'csv', 'pdf', 'webmanifest',
])

describe('設計規範與實作的一致性', () => {
  it('至少有九個章節檔', () => {
    expect(docs.length).toBeGreaterThanOrEqual(9)
  })

  it('規範提到的每個 design token 都存在於 styles.css', () => {
    const defined = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]))
    const missing: string[] = []
    for (const { path, text } of docs) {
      for (const code of inlineCode(text)) {
        for (const tok of code.match(/--[a-z0-9-]+/g) ?? []) {
          if (!defined.has(tok)) missing.push(`${rel(path)} → ${tok}`)
        }
      }
    }
    expect(missing).toEqual([])
  })

  it('規範提到的每個 CSS class 都存在於 styles.css', () => {
    const defined = new Set([...css.matchAll(/\.([a-z][a-z0-9-]*)/g)].map((m) => m[1]))
    const missing: string[] = []
    for (const { path, text } of docs) {
      for (const code of inlineCode(text)) {
        // 只認單獨出現的 class 選擇器，例如 `.member-name`；跳過檔名與程式片段
        const m = code.match(/^\.([a-z][a-z0-9-]*)$/)
        if (!m?.[1] || FILE_EXTENSIONS.has(m[1])) continue
        if (!defined.has(m[1])) missing.push(`${rel(path)} → .${m[1]}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('規範「實作」欄位指到的檔案都存在，且真的含有指名的元件', () => {
    const missing: string[] = []
    for (const { path, text } of docs) {
      for (const m of text.matchAll(/\*\*實作\*\*\s*—\s*(.+)/g)) {
        const codes = inlineCode(m[1] ?? '')
        // 「實作 — `src/ui/Room.tsx`（`MemberRow`）」：含 / 的是檔案，其餘是該檔裡的符號
        let lastFile: string | null = null
        for (const code of codes) {
          if (code.includes('/')) {
            if (!existsSync(join(ROOT, code))) {
              missing.push(`${rel(path)} → 檔案不存在 ${code}`)
              lastFile = null
            } else {
              lastFile = code
            }
            continue
          }
          if (!lastFile) continue
          const source = readFileSync(join(ROOT, lastFile), 'utf8')
          if (!source.includes(code)) missing.push(`${rel(path)} → ${lastFile} 裡找不到 ${code}`)
        }
      }
    }
    expect(missing).toEqual([])
  })

  it('規範裡的相對連結都指得到東西', () => {
    const missing: string[] = []
    for (const { path, text } of docs) {
      const dir = path.slice(0, path.lastIndexOf('/'))
      for (const m of text.matchAll(/\]\((?!https?:)([^)#]+)(?:#[^)]*)?\)/g)) {
        const target = join(dir, m[1] ?? '')
        if (!existsSync(target)) missing.push(`${rel(path)} → ${m[1]}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('每個元件家族都用了規格模板的必要欄位', () => {
    const families = markdownFiles(join(DESIGN, '04-components')).filter((p) => !p.endsWith('README.md'))
    const incomplete: string[] = []
    for (const path of families) {
      const text = readFileSync(path, 'utf8')
      const headings = (text.match(/^### /gm) ?? []).length
      for (const field of ['**用途**', '**實作**']) {
        const count = (text.split(field).length - 1)
        if (count < headings) incomplete.push(`${rel(path)}：${headings} 個元件但只有 ${count} 個 ${field}`)
      }
    }
    expect(incomplete).toEqual([])
  })
})
