/**
 * Single source for "is this a dev / Lovable preview environment?".
 *
 * R1-P: any runtime global that a test can use to seed application state must
 * be unreachable on the production origin, otherwise it is a backdoor into the
 * public economic contract (e.g. seeding the projection-status query cache to
 * force `ready` and render numbers for a scope under review).
 */
export function isPreviewEnv(): boolean {
  try {
    if (typeof import.meta !== 'undefined' && (import.meta as { env?: { DEV?: boolean } }).env?.DEV) {
      return true;
    }
    const h = typeof window !== 'undefined' ? window.location.hostname : '';
    return (
      h === 'localhost' ||
      h === '127.0.0.1' ||
      h.endsWith('.lovableproject.com') ||
      (h.startsWith('id-preview--') && h.endsWith('.lovable.app'))
    );
  } catch {
    return false;
  }
}
