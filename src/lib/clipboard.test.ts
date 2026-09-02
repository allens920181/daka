// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { copyToClipboard } from './clipboard'

/**
 * 這支測試的存在理由：不安全來源（區網的 `http://192.168.x.x`）沒有
 * `navigator.clipboard`。少了退路，「複製連結」在現場永遠是失敗的。
 */

function setClipboard(value: unknown): void {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true })
}

let execCommand: ReturnType<typeof vi.fn>

beforeEach(() => {
  execCommand = vi.fn(() => true)
  Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true })
})

afterEach(() => {
  // @ts-expect-error 測試之間互不影響。
  delete navigator.clipboard
  document.body.innerHTML = ''
})

describe('copyToClipboard', () => {
  it('有 clipboard API 就用它，不碰過時的 execCommand', async () => {
    const writeText = vi.fn(async () => {})
    setClipboard({ writeText })

    expect(await copyToClipboard('ABC123')).toBe(true)
    expect(writeText).toHaveBeenCalledWith('ABC123')
    expect(execCommand).not.toHaveBeenCalled()
  })

  it('沒有 clipboard API（不安全來源）時退回 execCommand', async () => {
    setClipboard(undefined)

    expect(await copyToClipboard('ABC123')).toBe(true)
    expect(execCommand).toHaveBeenCalledWith('copy')
  })

  it('clipboard API 丟錯（沒有權限）時也退回 execCommand', async () => {
    setClipboard({ writeText: vi.fn(async () => { throw new DOMException('denied', 'NotAllowedError') }) })

    expect(await copyToClipboard('ABC123')).toBe(true)
    expect(execCommand).toHaveBeenCalledWith('copy')
  })

  it('兩條路都不通時回報失敗，而不是假裝成功', async () => {
    setClipboard(undefined)
    execCommand.mockReturnValue(false)

    expect(await copyToClipboard('ABC123')).toBe(false)
  })

  it('用完把暫存的 textarea 收乾淨——就算 execCommand 丟錯', async () => {
    setClipboard(undefined)
    execCommand.mockImplementation(() => { throw new Error('boom') })

    expect(await copyToClipboard('ABC123')).toBe(false)
    expect(document.querySelectorAll('textarea')).toHaveLength(0)
  })
})
