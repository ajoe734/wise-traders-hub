// Standalone version constant — kept in its own tiny module so that
// `DemoBanner` (rendered on the FreeCheckup entry chunk for every demo
// visitor) does not pull the entire 15KB `demoData.js` into the first-paint
// chunk just to read a date string. `demoData.js` re-exports this symbol so
// existing `import { DEMO_DATA_VERSION } from './demoData'` call sites stay
// valid.
export const DEMO_DATA_VERSION = '2026-05';
