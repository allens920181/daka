import type { JSX } from 'preact'

// 圖示只有三種尺寸：16 內嵌於文字、20 一般按鈕、24 頂欄。
// 見 docs/design-system.md §5。
type P = { size?: 16 | 20 | 24 } & JSX.SVGAttributes<SVGSVGElement>

const base = (size: number) => ({
  width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: 2,
  strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
  'aria-hidden': true,
})

// 「已到」的勾。渲染尺寸只有 16px，用系統預設的 strokeWidth 2 換算下來只有
// 1.3px——比它旁邊那個 2px 的空心圓還細，是全系統最弱的一筆，偏偏它是名單上
// 唯一表示「這個人上車了」的記號。線寬隨尺寸補回來。
export const IconCheck = ({ size = 16, ...r }: P) => (
  <svg {...base(size)} strokeWidth={3} {...r}><polyline points="20 6 9 17 4 12" /></svg>
)
export const IconBack = ({ size = 24, ...r }: P) => (
  <svg {...base(size)} {...r}><path d="M19 12H5" /><polyline points="12 19 5 12 12 5" /></svg>
)
export const IconShare = ({ size = 20, ...r }: P) => (
  <svg {...base(size)} {...r}>
    <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
    <line x1="8.6" y1="10.5" x2="15.4" y2="6.5" /><line x1="15.4" y1="17.5" x2="8.6" y2="13.5" />
  </svg>
)
export const IconMore = ({ size = 20, ...r }: P) => (
  <svg {...base(size)} {...r}>
    <circle cx="12" cy="12" r="1.6" fill="currentColor" /><circle cx="12" cy="5" r="1.6" fill="currentColor" />
    <circle cx="12" cy="19" r="1.6" fill="currentColor" />
  </svg>
)
export const IconPhone = ({ size = 20, ...r }: P) => (
  <svg {...base(size)} {...r}>
    <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z" />
  </svg>
)
export const IconPlus = ({ size = 20, ...r }: P) => (
  <svg {...base(size)} {...r}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
)
export const IconCopy = ({ size = 16, ...r }: P) => (
  <svg {...base(size)} {...r}>
    <rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
)
export const IconDownload = ({ size = 20, ...r }: P) => (
  <svg {...base(size)} {...r}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
)
export const IconSettings = ({ size = 24, ...r }: P) => (
  <svg {...base(size)} {...r}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </svg>
)
// 管理面板的每一列都要有自己的圖示：五個項目共用 IconList 的話，圖示欄
// 就失去「一眼掃過去分辨」的功能，只剩裝飾。
export const IconLeave = ({ size = 20, ...r }: P) => (
  <svg {...base(size)} {...r}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
  </svg>
)
export const IconEdit = ({ size = 20, ...r }: P) => (
  <svg {...base(size)} {...r}>
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z" />
  </svg>
)
export const IconTag = ({ size = 20, ...r }: P) => (
  <svg {...base(size)} {...r}>
    <path d="M20.6 13.4 12 22l-9-9V3h10l7.6 7.6a2 2 0 0 1 0 2.8z" />
    <line x1="7" y1="7" x2="7.01" y2="7" />
  </svg>
)
export const IconBookmark = ({ size = 20, ...r }: P) => (
  <svg {...base(size)} {...r}><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>
)
export const IconPrinter = ({ size = 20, ...r }: P) => (
  <svg {...base(size)} {...r}>
    <polyline points="6 9 6 2 18 2 18 9" />
    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
    <rect x="6" y="14" width="12" height="8" />
  </svg>
)

export const IconTrash = ({ size = 20, ...r }: P) => (
  <svg {...base(size)} {...r}>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
)
export const IconClose = ({ size = 24, ...r }: P) => (
  <svg {...base(size)} {...r}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
)
export const IconDuplicate = ({ size = 20, ...r }: P) => (
  <svg {...base(size)} {...r}>
    <rect x="3" y="3" width="12" height="12" rx="2" />
    <path d="M9 21h10a2 2 0 0 0 2-2V9" />
  </svg>
)
export const IconList = ({ size = 20, ...r }: P) => (
  <svg {...base(size)} {...r}>
    <line x1="9" y1="6" x2="20" y2="6" /><line x1="9" y1="12" x2="20" y2="12" /><line x1="9" y1="18" x2="20" y2="18" />
    <circle cx="4.5" cy="6" r="1.2" fill="currentColor" /><circle cx="4.5" cy="12" r="1.2" fill="currentColor" />
    <circle cx="4.5" cy="18" r="1.2" fill="currentColor" />
  </svg>
)
export const IconLock = ({ size = 20, ...r }: P) => (
  <svg {...base(size)} {...r}>
    <rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
)
