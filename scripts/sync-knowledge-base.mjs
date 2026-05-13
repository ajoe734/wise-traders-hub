#!/usr/bin/env node
/**
 * 持倉看板知識庫同步腳本
 *
 * 名詞：
 *   - 種子 JSON：src/checkup/lib/knowledge-base/*.json（5 檔 / 25 條），跟著 build 走，純前端 fallback
 *   - 知識庫資料表：DB checkup_knowledge_items（線上實際使用，含 AI 起草 + 編輯內容，目前 ~488 條）
 *
 * 用途：把「種子 JSON」upsert 到「知識庫資料表」
 * - 以 (category, item_id) 為唯一鍵
 * - 已存在的條目會更新（DB 觸發器自動 bump version + updated_at）
 * - 不存在的條目會新增
 * - 知識庫資料表中「種子 JSON 沒有」的條目「不會被刪除」（保留管理員/AI 起草的內容）
 *
 * 使用：
 *   node scripts/sync-knowledge-base.mjs                # dry-run，只列出差異
 *   node scripts/sync-knowledge-base.mjs --apply        # 實際寫入知識庫資料表
 *
 * 需要環境變數：
 *   VITE_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY  （繞過 RLS）
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KB_DIR = resolve(__dirname, '../src/checkup/lib/knowledge-base');

const FILE_TO_CATEGORY = {
  'chip-analysis.json': 'chip_analysis',
  'technical-analysis.json': 'technical_analysis',
  'industry-trends.json': 'industry_trends',
  'strategy-cases.json': 'strategy_cases',
  'news-correlation.json': 'news_correlation',
};

const APPLY = process.argv.includes('--apply');

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ 請設定環境變數 VITE_SUPABASE_URL 與 SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

function loadLocalItems() {
  const all = [];
  for (const [file, category] of Object.entries(FILE_TO_CATEGORY)) {
    const path = resolve(KB_DIR, file);
    const json = JSON.parse(readFileSync(path, 'utf8'));
    for (const item of json.items ?? []) {
      const row = {
        category,
        item_id: item.id,
        title: item.title,
        fact: item.fact,
        interpretation: item.interpretation ?? null,
        action: item.action ?? null,
        confidence: typeof item.confidence === 'number' ? item.confidence : 0.75,
        tags: Array.isArray(item.tags) ? item.tags : [],
        is_active: true,
      };
      // strategy_cases 額外欄位
      if (category === 'strategy_cases') {
        row.lessons = item.lessons ?? null;
        row.return_pct = typeof item.return === 'number' ? item.return : null;
        row.outcome = item.outcome ?? 'success';
      }
      all.push(row);
    }
  }
  return all;
}

async function fetchCloudItems() {
  const { data, error } = await supabase
    .from('checkup_knowledge_items')
    .select('category,item_id,title,fact,interpretation,action,lessons,return_pct,outcome,confidence,tags,is_active,version,updated_at');
  if (error) throw error;
  return data ?? [];
}

function diff(localRow, cloudRow) {
  const fields = ['title', 'fact', 'interpretation', 'action', 'confidence', 'tags', 'is_active'];
  if (localRow.category === 'strategy_cases') {
    fields.push('lessons', 'return_pct', 'outcome');
  }
  const changes = [];
  for (const f of fields) {
    const a = localRow[f];
    const b = cloudRow[f];
    if (Array.isArray(a) || Array.isArray(b)) {
      if (JSON.stringify(a ?? []) !== JSON.stringify(b ?? [])) changes.push(f);
    } else if (typeof a === 'number' || typeof b === 'number') {
      if (Number(a ?? 0) !== Number(b ?? 0)) changes.push(f);
    } else {
      if ((a ?? '') !== (b ?? '')) changes.push(f);
    }
  }
  return changes;
}

async function main() {
  console.log(`🔄 知識庫同步腳本 ${APPLY ? '【實際寫入模式】' : '【DRY RUN】'}`);
  console.log('─'.repeat(60));

  const localItems = loadLocalItems();
  const cloudItems = await fetchCloudItems();
  console.log(`📁 種子 JSON：${localItems.length} 條`);
  console.log(`🗄️  知識庫資料表：${cloudItems.length} 條`);

  const cloudMap = new Map(cloudItems.map(r => [`${r.category}::${r.item_id}`, r]));

  const toInsert = [];
  const toUpdate = [];
  const unchanged = [];

  for (const local of localItems) {
    const key = `${local.category}::${local.item_id}`;
    const cloud = cloudMap.get(key);
    if (!cloud) {
      toInsert.push(local);
    } else {
      const changes = diff(local, cloud);
      if (changes.length > 0) {
        toUpdate.push({ row: local, changes, currentVersion: cloud.version });
      } else {
        unchanged.push(local);
      }
    }
  }

  // 知識庫資料表中「種子 JSON 沒有」的條目（保留，不刪）
  const localKeys = new Set(localItems.map(r => `${r.category}::${r.item_id}`));
  const onlyInCloud = cloudItems.filter(r => !localKeys.has(`${r.category}::${r.item_id}`));

  console.log('');
  console.log(`✅ 一致：${unchanged.length} 條`);
  console.log(`➕ 新增：${toInsert.length} 條`);
  console.log(`✏️  更新：${toUpdate.length} 條`);
  console.log(`🗄️  資料表獨有（保留不動）：${onlyInCloud.length} 條`);
  console.log('');

  for (const r of toInsert) {
    console.log(`  ➕ [${r.category}] ${r.item_id} — ${r.title}`);
  }
  for (const { row, changes, currentVersion } of toUpdate) {
    console.log(`  ✏️  [${row.category}] ${row.item_id} v${currentVersion}→v${currentVersion + 1} (${changes.join(', ')})`);
  }
  for (const r of onlyInCloud) {
    console.log(`  🗄️  [${r.category}] ${r.item_id} v${r.version} — ${r.title}（資料表獨有，不動）`);
  }

  if (!APPLY) {
    console.log('');
    console.log('💡 這是 DRY RUN。要實際寫入請加上 --apply 參數。');
    return;
  }

  console.log('');
  console.log('🚀 開始寫入知識庫資料表…');

  let okCount = 0;
  let errCount = 0;

  // 用 upsert（按 category+item_id）
  for (const row of [...toInsert, ...toUpdate.map(u => u.row)]) {
    const { error } = await supabase
      .from('checkup_knowledge_items')
      .upsert(row, { onConflict: 'category,item_id' });
    if (error) {
      errCount++;
      console.error(`  ❌ [${row.category}] ${row.item_id}: ${error.message}`);
    } else {
      okCount++;
    }
  }

  console.log('');
  console.log(`✅ 完成：成功 ${okCount}，失敗 ${errCount}`);
}

main().catch((err) => {
  console.error('💥 腳本失敗：', err);
  process.exit(1);
});
