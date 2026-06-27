/**
 * Global delegated click tracker.
 *
 * Any element with `data-cta="<name>"` (optionally `data-cta-section`) auto-fires
 * `home_cta_click` (or the value of `data-cta-event`) when clicked / activated.
 *
 * Lets us instrument long static pages (Index.tsx, marketing sections) without
 * threading onClick through dozens of <Link> / <Button asChild> wrappers.
 *
 * Mounted once from AttributionTracker.
 */
import { trackRaw } from '@/lib/analytics/events';

let installed = false;

export function installCtaClickListener() {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  const handler = (e: Event) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    const el = target.closest('[data-cta]') as HTMLElement | null;
    if (!el) return;
    const cta = el.getAttribute('data-cta');
    if (!cta) return;
    const section = el.getAttribute('data-cta-section') || undefined;
    const eventName = el.getAttribute('data-cta-event') || 'home_cta_click';
    const extra: Record<string, unknown> = { cta };
    if (section) extra.section = section;
    // copy all data-cta-* (except event/section/cta itself) as props
    for (const attr of Array.from(el.attributes)) {
      if (!attr.name.startsWith('data-cta-')) continue;
      const key = attr.name.replace(/^data-cta-/, '');
      if (key === 'event' || key === 'section') continue;
      extra[key] = attr.value;
    }
    try { trackRaw(eventName, extra); } catch { /* never block click */ }
  };

  // capture phase so we still catch clicks even if a child stops propagation
  window.addEventListener('click', handler, { capture: true });
  // keyboard activation (Enter / Space on focusable Link/Button)
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    handler(e);
  }, { capture: true });
}
