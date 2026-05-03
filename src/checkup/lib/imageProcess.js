/**
 * Browser-side image preprocessing for trade screenshot uploads.
 *
 *  - convertHeicIfNeeded: HEIC/HEIF → JPEG via heic2any (dynamic import)
 *  - compressImage: re-encode to JPEG ≤ MAX_DIM long edge, quality 0.85
 *
 * Goals: cut Edge Function payload (8MB original → ~400KB-1MB), avoid
 * iPhone HEIC dead-end without forcing the user to convert manually.
 */

export const MAX_DIM = 1600
export const COMPRESS_QUALITY = 0.85
const HEIC_MIME = new Set(['image/heic', 'image/heif'])

function isHeic(file) {
  const type = String(file?.type || '').toLowerCase()
  if (HEIC_MIME.has(type)) return true
  const name = String(file?.name || '').toLowerCase()
  return /\.(heic|heif)$/.test(name)
}

export async function convertHeicIfNeeded(file) {
  if (!file || !isHeic(file)) return file
  try {
    const mod = await import('heic2any')
    const heic2any = mod.default || mod
    const out = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 })
    const blob = Array.isArray(out) ? out[0] : out
    return new File([blob], (file.name || 'image').replace(/\.(heic|heif)$/i, '.jpg'), {
      type: 'image/jpeg',
      lastModified: Date.now(),
    })
  } catch (err) {
    const e = new Error(`HEIC 轉檔失敗：${err?.message || '請改用 JPG/PNG'}`)
    e.code = 'HEIC_CONVERT_FAILED'
    throw e
  }
}

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('圖片無法解碼'))
    }
    img.src = url
  })
}

export async function compressImage(file, { maxDim = MAX_DIM, quality = COMPRESS_QUALITY } = {}) {
  if (!file) return file
  const type = String(file.type || '').toLowerCase()
  if (!type.startsWith('image/')) return file
  if (file.size < 200 * 1024) return file

  try {
    const img = await loadImage(file)
    const longEdge = Math.max(img.naturalWidth, img.naturalHeight)
    const scale = longEdge > maxDim ? maxDim / longEdge : 1
    const w = Math.round(img.naturalWidth * scale)
    const h = Math.round(img.naturalHeight * scale)

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(img, 0, 0, w, h)

    const blob = await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', quality)
    )
    if (!blob || blob.size >= file.size) return file
    return new File([blob], (file.name || 'image').replace(/\.(png|webp)$/i, '.jpg'), {
      type: 'image/jpeg',
      lastModified: Date.now(),
    })
  } catch {
    return file
  }
}

export async function preprocessForUpload(file) {
  const a = await convertHeicIfNeeded(file)
  return await compressImage(a)
}
