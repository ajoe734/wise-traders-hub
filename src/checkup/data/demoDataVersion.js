// Standalone version constant — kept in its own tiny module so that
// callers can read the demo data version without pulling the full
// 15KB `demoData.js` into their bundle. `demoData.js` re-exports this
// symbol so existing `import { DEMO_DATA_VERSION } from './demoData'`
// call sites stay valid.
export const DEMO_DATA_VERSION = '2026-05';
