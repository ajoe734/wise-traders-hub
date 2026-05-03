/**
 * Trade upload pre-flight guards.
 *
 * Used by useTradeCaptureRuntime to validate files BEFORE reading them as
 * base64 and shipping to checkup-analyze. Keeps demo-mode protection +
 * file size / format / batch limits in one testable surface.
 *
 * See:
 *  - mem://qa/checkup/demo-mode-behavior — guests must not call AI edges.
 *  - mem://logic/trading/ui-to-system-action-mapping — buy/sell only.
 */

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024 // 8MB raw → ~11MB base64
export const MAX_QUEUED_UPLOADS = 10
export const HEIC_MIME_TYPES = new Set(['image/heic', 'image/heif'])

/**
 * Filter incoming FileList / File[] into accepted + rejected groups.
 * Pure — does NOT touch the DOM, ObjectURL, or FileReader.
 *
 * @param {File[] | FileList} input
 * @param {{ existingCount?: number }} [opts]
 * @returns {{ accepted: File[], rejected: Array<{ file: File, reason: string }>, overflow: number }}
 */
export function partitionUploadFiles(input, opts = {}) {
  const existingCount = Math.max(0, Number(opts.existingCount) || 0)
  const files = Array.from(input || [])
  const accepted = []
  const rejected = []

  for (const file of files) {
    if (!file || typeof file !== 'object') continue
    const type = String(file.type || '').toLowerCase()

    if (!type.startsWith('image/')) {
      rejected.push({ file, reason: 'not-image' })
      continue
    }
    // HEIC/HEIF: 接受 — 由 imageProcess.convertHeicIfNeeded 在前端轉成 JPEG
    if (Number(file.size) > MAX_UPLOAD_BYTES) {
      rejected.push({ file, reason: 'too-large' })
      continue
    }
    accepted.push(file)
  }

  const room = Math.max(0, MAX_QUEUED_UPLOADS - existingCount)
  const overflowFiles = accepted.slice(room)
  const finalAccepted = accepted.slice(0, room)

  return {
    accepted: finalAccepted,
    rejected,
    overflow: overflowFiles.length,
  }
}

/**
 * Build a single human-readable rejection toast from partitionUploadFiles.
 * Returns null when nothing was rejected.
 */
export function summarizeRejections({ rejected = [], overflow = 0 } = {}) {
  const parts = []
  const heic = rejected.filter((r) => r.reason === 'heic').length
  const big = rejected.filter((r) => r.reason === 'too-large').length
  const notImg = rejected.filter((r) => r.reason === 'not-image').length

  if (heic > 0) parts.push(`${heic} 張 HEIC（請轉成 JPG/PNG）`)
  if (big > 0) parts.push(`${big} 張超過 ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB`)
  if (notImg > 0) parts.push(`${notImg} 張非圖片`)
  if (overflow > 0) parts.push(`${overflow} 張超過 ${MAX_QUEUED_UPLOADS} 張上限`)

  if (parts.length === 0) return null
  return `⚠️ 已忽略：${parts.join('、')}`
}
