import { describe, it, expect } from 'vitest'
import {
  partitionUploadFiles,
  summarizeRejections,
  MAX_UPLOAD_BYTES,
  MAX_QUEUED_UPLOADS,
} from '../tradeUploadGuards.js'

function mkFile({ name = 'a.jpg', type = 'image/jpeg', size = 1024 } = {}) {
  return { name, type, size }
}

describe('partitionUploadFiles', () => {
  it('accepts normal JPG/PNG within limits', () => {
    const out = partitionUploadFiles([
      mkFile({ name: 'a.jpg', type: 'image/jpeg', size: 100_000 }),
      mkFile({ name: 'b.png', type: 'image/png', size: 200_000 }),
    ])
    expect(out.accepted).toHaveLength(2)
    expect(out.rejected).toHaveLength(0)
    expect(out.overflow).toBe(0)
  })

  it('accepts HEIC at partition stage (conversion handled later)', () => {
    const out = partitionUploadFiles([mkFile({ type: 'image/heic' })])
    // HEIC 現在會進到 preprocessForUpload 才嘗試轉檔；partition 不再直接拒
    expect(out.accepted).toHaveLength(1)
  })

  it('rejects oversize files with reason=too-large', () => {
    const out = partitionUploadFiles([mkFile({ size: MAX_UPLOAD_BYTES + 1 })])
    expect(out.rejected[0].reason).toBe('too-large')
  })

  it('rejects non-image with reason=not-image', () => {
    const out = partitionUploadFiles([mkFile({ type: 'application/pdf' })])
    expect(out.rejected[0].reason).toBe('not-image')
  })

  it('caps queue at MAX_QUEUED_UPLOADS minus existing', () => {
    const files = Array.from({ length: 12 }, (_, i) =>
      mkFile({ name: `${i}.jpg`, size: 1000 })
    )
    const out = partitionUploadFiles(files, { existingCount: 3 })
    // room = 10 - 3 = 7
    expect(out.accepted).toHaveLength(7)
    expect(out.overflow).toBe(5)
  })

  it('handles null / empty input', () => {
    expect(partitionUploadFiles(null).accepted).toEqual([])
    expect(partitionUploadFiles([]).accepted).toEqual([])
  })
})

describe('summarizeRejections', () => {
  it('returns null when nothing rejected', () => {
    expect(summarizeRejections({ rejected: [], overflow: 0 })).toBeNull()
  })

  it('summarizes mixed reasons in Chinese (heic via heicFailed)', () => {
    const msg = summarizeRejections({
      rejected: [
        { reason: 'too-large' },
        { reason: 'too-large' },
        { reason: 'not-image' },
      ],
      overflow: 2,
      heicFailed: 1,
    })
    expect(msg).toContain('2 張超過')
    expect(msg).toContain('1 張非圖片')
    expect(msg).toContain(`2 張超過 ${MAX_QUEUED_UPLOADS} 張上限`)
  })
})
