#!/usr/bin/env node
/**
 * CI 守衛：Checkup 深模組邊界。
 * 用法：node scripts/check-module-boundaries.mjs
 * 契約：docs/adr/0001-checkup-five-deep-modules.md
 */
import { checkModuleBoundaries, formatViolations, CHECKUP_MODULES } from './moduleBoundaries.mjs';

const violations = checkModuleBoundaries();
console.log(`Checkup 深模組：${CHECKUP_MODULES.join(', ')}`);
console.log(formatViolations(violations));
if (violations.length > 0) {
  console.error(`\n共 ${violations.length} 筆邊界違規，請修正後再提交。`);
  process.exit(1);
}
