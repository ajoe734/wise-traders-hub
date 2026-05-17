/**
 * Narrow `catch (e: unknown)` to a user-facing string.
 * Replaces the legacy `catch (e: any)` + `e?.message ?? e` pattern across
 * admin/company pages so we get real type safety in error paths.
 */
export function errorMessage(e: unknown, fallback = '操作失敗'): string {
  if (e instanceof Error) return e.message || fallback;
  if (typeof e === 'string') return e || fallback;
  if (e && typeof e === 'object' && 'message' in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === 'string' && m) return m;
  }
  try {
    return String(e) || fallback;
  } catch {
    return fallback;
  }
}
