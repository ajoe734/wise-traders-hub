export function normalizeWatchlist(value) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const code = String(item.code || '').trim()
      const name = String(item.name || '').trim()
      if (!code || !name) return null
      const price = Number(item.price)
      const target = Number(item.target)
      return {
        code,
        name,
        price: Number.isFinite(price) && price > 0 ? price : 0,
        target: Number.isFinite(target) && target > 0 ? target : 0,
        status: typeof item.status === 'string' ? item.status.trim() : '',
        catalyst: typeof item.catalyst === 'string' ? item.catalyst.trim() : '',
        scKey: typeof item.scKey === 'string' ? item.scKey : 'blue',
        note: typeof item.note === 'string' ? item.note.trim() : '',
      }
    })
    .filter(Boolean)
}
