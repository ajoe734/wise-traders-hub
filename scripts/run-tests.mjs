#!/usr/bin/env node
/**
 * Canonical test runner (npm run test:run).
 *
 * 為什麼要兩階段：`src/test/unit/freecheckup-tab-perf.test.tsx` 內含 wall-clock
 * 斷言（dynamic import 解析時間預算）。vitest 預設把 230 個檔案丟進多 worker
 * 並行，perf 檔量到的是「自身 transform + 其他 worker 搶 CPU」的總和，因此
 * 在滿載機器上會非決定性地紅（實測：隔離 2.2–3.5s；96-way CPU 飽和 10.0s；
 * 完整並行跑 13.5s > 12000ms 預算）。產品 import graph 沒有退化。
 *
 * 修法不是放寬 timeout / 刪測試 / skip，而是把「wall-clock 敏感」的測試檔隔離
 * 成獨立、序列化的第二階段執行。所有測試仍然全部會跑，兩階段 counts 分別列出，
 * 任何一階段失敗或 perf 階段沒真的執行到，都會 fail-loud（exit 1）。
 */
import { spawn } from 'node:child_process';

const WALL_CLOCK_FILES = ['src/test/unit/freecheckup-tab-perf.test.tsx'];

function run(args, label) {
  return new Promise((resolve) => {
    const start = new Date().toISOString();
    const child = spawn('npx', ['vitest', 'run', ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
    let out = '';
    const tee = (chunk) => {
      out += chunk;
      process.stdout.write(chunk);
    };
    child.stdout.on('data', (c) => tee(c.toString()));
    child.stderr.on('data', (c) => tee(c.toString()));
    child.on('close', (code) => {
      resolve({ label, code, out, start, end: new Date().toISOString() });
    });
  });
}

const strip = (s) => s.replace(/\u001b\[[0-9;]*m/g, '');

function counts(out) {
  const clean = strip(out);
  const pick = (re) => {
    const m = clean.match(re);
    return m ? m[1] : null;
  };
  return {
    files: pick(/Test Files\s+(.+)/),
    tests: pick(/\n\s+Tests\s+(.+)/),
    filesTotal: Number(pick(/Test Files\s+.*?\((\d+)\)/) ?? 0),
    testsTotal: Number(pick(/\n\s+Tests\s+.*?\((\d+)\)/) ?? 0),
    failed: /Tests\s+\d+ failed/.test(clean) || /Test Files\s+\d+ failed/.test(clean),
  };
}

const excludeArgs = WALL_CLOCK_FILES.flatMap((f) => ['--exclude', f]);

const phaseA = await run(
  [...excludeArgs, '--exclude', 'node_modules', '--exclude', 'dist', '--exclude', 'e2e/**'],
  'phase-A (parallel, all tests except wall-clock-sensitive)'
);
const phaseB = await run(
  [...WALL_CLOCK_FILES, '--pool=forks', '--no-file-parallelism', '--maxWorkers=1'],
  'phase-B (isolated, sequential, wall-clock-sensitive)'
);

const a = counts(phaseA.out);
const b = counts(phaseB.out);

const problems = [];
if (phaseA.code !== 0 || a.failed) problems.push(`phase-A exit=${phaseA.code} failures present`);
if (phaseB.code !== 0 || b.failed) problems.push(`phase-B exit=${phaseB.code} failures present`);
// fail-loud：phase-B 必須真的執行到 perf 檔（避免 exclude/路徑漂移造成靜默跳過）
if (b.filesTotal !== WALL_CLOCK_FILES.length)
  problems.push(`phase-B ran ${b.filesTotal} files, expected ${WALL_CLOCK_FILES.length}`);
if (b.testsTotal < 1) problems.push('phase-B ran 0 tests');
// fail-loud：phase-A 必須真的把 perf 檔排除（否則兩階段重複計數）
if (strip(phaseA.out).includes('freecheckup-tab-perf'))
  problems.push('phase-A did not exclude the wall-clock-sensitive file');

console.log('\n================ canonical test:run summary ================');
for (const [p, c] of [
  [phaseA, a],
  [phaseB, b],
]) {
  console.log(`${p.label}\n  start=${p.start} end=${p.end} exit=${p.code}`);
  console.log(`  Test Files ${c.files}\n  Tests ${c.tests}`);
}
console.log(`TOTAL files=${a.filesTotal + b.filesTotal} tests=${a.testsTotal + b.testsTotal}`);
console.log(problems.length ? `RESULT FAIL\n - ${problems.join('\n - ')}` : 'RESULT PASS');
console.log('============================================================');

process.exit(problems.length ? 1 : 0);
