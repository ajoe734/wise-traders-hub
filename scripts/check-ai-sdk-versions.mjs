#!/usr/bin/env node
// AI SDK 版本相容性檢查。
//
// 目的：避免 `ai` 與 `@ai-sdk/*`（含 edge function 內的 `npm:...@x` 硬 pin）版本錯位，
// 這種錯位會造成 UIMessage 格式不相容、streamText / convertToModelMessages 執行時炸掉，
// 而 typecheck 不一定攔得到（Deno 只在部署時檢查）。
//
// 使用：node scripts/check-ai-sdk-versions.mjs
// 退出碼 0 = 通過；1 = 有版本錯位；2 = 檢查腳本本身錯誤。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 相容矩陣：ai major → 各 @ai-sdk/* 允許的 major
// 依 AI SDK 官方 release notes（ai v5 對應 @ai-sdk/react v2、@ai-sdk/openai-compatible v1、@ai-sdk/openai v2 等）。
const COMPAT = {
  5: {
    '@ai-sdk/react': [2],
    '@ai-sdk/vue': [2],
    '@ai-sdk/svelte': [3],
    '@ai-sdk/openai': [2],
    '@ai-sdk/openai-compatible': [1],
    '@ai-sdk/anthropic': [2],
    '@ai-sdk/google': [2],
    '@ai-sdk/google-vertex': [3],
    '@ai-sdk/mistral': [2],
    '@ai-sdk/groq': [2],
    '@ai-sdk/xai': [2],
    '@ai-sdk/cohere': [2],
    '@ai-sdk/deepseek': [1],
    '@ai-sdk/togetherai': [1],
    '@ai-sdk/perplexity': [2],
    '@ai-sdk/fireworks': [1],
    '@ai-sdk/cerebras': [1],
    '@ai-sdk/replicate': [1],
    '@ai-sdk/luma': [1],
    '@ai-sdk/fal': [1],
    '@ai-sdk/elevenlabs': [1],
    '@ai-sdk/lmnt': [1],
    '@ai-sdk/deepinfra': [1],
    '@ai-sdk/gateway': [1],
    '@ai-sdk/provider': [2],
    '@ai-sdk/provider-utils': [3],
  },
  4: {
    '@ai-sdk/react': [1],
    '@ai-sdk/openai': [1],
    '@ai-sdk/openai-compatible': [0],
    '@ai-sdk/anthropic': [1],
    '@ai-sdk/google': [1],
    '@ai-sdk/provider': [1],
    '@ai-sdk/provider-utils': [2],
  },
};

const errors = [];
const notes = [];

/** 從 semver 範圍字串抽出主版本；範例：`^5.0.0` → 5, `~2.1` → 2, `1.2.3` → 1 */
function parseMajor(range) {
  if (!range || typeof range !== 'string') return null;
  const m = range.match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

// ---- 1. package.json ----
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

const aiRange = allDeps['ai'];
const aiMajor = parseMajor(aiRange);
if (!aiMajor) {
  errors.push(`package.json 未宣告 "ai" 或版本無法解析：${aiRange}`);
} else if (!COMPAT[aiMajor]) {
  errors.push(`未知的 ai major：${aiMajor}（請更新 scripts/check-ai-sdk-versions.mjs 的相容矩陣）`);
} else {
  notes.push(`package.json ai = ${aiRange} (major ${aiMajor})`);
  const matrix = COMPAT[aiMajor];
  for (const [name, range] of Object.entries(allDeps)) {
    if (!name.startsWith('@ai-sdk/')) continue;
    const major = parseMajor(range);
    const allowed = matrix[name];
    if (!allowed) {
      notes.push(`  · ${name}@${range}（未在相容矩陣中，跳過；如是新套件請補進 COMPAT）`);
      continue;
    }
    if (major == null) {
      errors.push(`${name} 版本無法解析：${range}`);
      continue;
    }
    if (!allowed.includes(major)) {
      errors.push(
        `${name}@${range}（major ${major}）與 ai@${aiRange}（major ${aiMajor}）不相容，` +
        `允許 major：${allowed.join(', ')}`,
      );
    } else {
      notes.push(`  · ${name}@${range} ✓`);
    }
  }
}

// ---- 2. Supabase Edge Functions 的 npm: pin ----
const EDGE_ROOT = path.join(ROOT, 'supabase', 'functions');
const edgePins = [];
if (fs.existsSync(EDGE_ROOT)) {
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.(ts|tsx|js|mjs)$/.test(entry.name)) {
        const src = fs.readFileSync(p, 'utf8');
        // 抓 `npm:ai@x.y.z` 與 `npm:@ai-sdk/xxx@x.y.z`（含 ^ ~ 前綴）
        const re = /npm:(@ai-sdk\/[a-z0-9-]+|ai)@([~^]?\d+[^'"\s]*)/g;
        let m;
        while ((m = re.exec(src))) {
          edgePins.push({ file: path.relative(ROOT, p), pkg: m[1], range: m[2] });
        }
      }
    }
  };
  walk(EDGE_ROOT);
}

if (edgePins.length === 0) {
  notes.push('Edge functions 未發現 npm:ai / npm:@ai-sdk/* pin（若有應改為 pin）');
} else {
  notes.push(`Edge function pins（${edgePins.length} 筆）：`);
  for (const { file, pkg: name, range } of edgePins) {
    const major = parseMajor(range);
    notes.push(`  · ${file}: ${name}@${range}`);
    if (major == null) {
      errors.push(`${file}: ${name}@${range} 版本無法解析`);
      continue;
    }
    if (name === 'ai') {
      if (aiMajor && major !== aiMajor) {
        errors.push(
          `${file}: 'npm:ai@${range}'（major ${major}）與 package.json ai@${aiRange}（major ${aiMajor}）不一致`,
        );
      }
    } else if (aiMajor && COMPAT[aiMajor]) {
      const allowed = COMPAT[aiMajor][name];
      if (allowed && !allowed.includes(major)) {
        errors.push(
          `${file}: '${name}@${range}'（major ${major}）與 ai@${aiRange}（major ${aiMajor}）不相容，` +
          `允許 major：${allowed.join(', ')}`,
        );
      }
      // 同套件在前端也宣告時，major 必須一致
      const frontRange = allDeps[name];
      const frontMajor = parseMajor(frontRange);
      if (frontMajor != null && frontMajor !== major) {
        errors.push(
          `${file}: '${name}@${range}'（major ${major}）與 package.json ${name}@${frontRange}（major ${frontMajor}）不一致`,
        );
      }
    }
  }
}

// ---- 輸出 ----
console.log('=== AI SDK 版本相容性檢查 ===');
for (const n of notes) console.log(n);

if (errors.length) {
  console.error('\n✗ 發現版本錯位：');
  for (const e of errors) console.error('  - ' + e);
  console.error(
    '\n修正方式：對齊 package.json 與 supabase/functions/**/*.ts 內的 npm: pin，' +
    '\n讓 ai 與 @ai-sdk/* 使用相同 AI SDK 世代（見 COMPAT 矩陣）。',
  );
  process.exit(1);
}

console.log('\n✓ 所有 ai / @ai-sdk/* 版本一致且相容。');
