import { readFileSync } from 'node:fs';
import pg from 'pg';
const { Client } = pg;

const FILE_TO_CATEGORY = {
  'chip-analysis.json': 'chip_analysis',
  'technical-analysis.json': 'technical_analysis',
  'industry-trends.json': 'industry_trends',
  'strategy-cases.json': 'strategy_cases',
  'news-correlation.json': 'news_correlation',
};

const KB_DIR = '/dev-server/src/checkup/lib/knowledge-base';
const items = [];
for (const [file, category] of Object.entries(FILE_TO_CATEGORY)) {
  const json = JSON.parse(readFileSync(`${KB_DIR}/${file}`, 'utf8'));
  for (const item of json.items ?? []) {
    items.push({ category, ...item });
  }
}
console.log(`Loaded ${items.length} local items`);

const client = new Client();
await client.connect();

let inserted = 0, updated = 0, unchanged = 0;
for (const it of items) {
  const isStrategy = it.category === 'strategy_cases';
  const cur = await client.query(
    'SELECT title, fact, interpretation, action, confidence, tags, lessons, return_pct, outcome FROM checkup_knowledge_items WHERE category=$1 AND item_id=$2',
    [it.category, it.id]
  );
  const payload = {
    category: it.category,
    item_id: it.id,
    title: it.title,
    fact: it.fact,
    interpretation: it.interpretation ?? null,
    action: it.action ?? null,
    confidence: typeof it.confidence === 'number' ? it.confidence : 0.75,
    tags: it.tags ?? [],
    is_active: true,
    lessons: isStrategy ? (it.lessons ?? null) : null,
    return_pct: isStrategy && typeof it.return === 'number' ? it.return : null,
    outcome: isStrategy ? (it.outcome ?? 'success') : null,
  };

  if (cur.rowCount === 0) {
    await client.query(
      `INSERT INTO checkup_knowledge_items
       (category,item_id,title,fact,interpretation,action,confidence,tags,is_active,lessons,return_pct,outcome,source_type)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'editorial')`,
      [payload.category, payload.item_id, payload.title, payload.fact, payload.interpretation,
       payload.action, payload.confidence, payload.tags, payload.is_active,
       payload.lessons, payload.return_pct, payload.outcome]
    );
    inserted++;
  } else {
    const c = cur.rows[0];
    const changed =
      c.title !== payload.title || c.fact !== payload.fact ||
      (c.interpretation ?? '') !== (payload.interpretation ?? '') ||
      (c.action ?? '') !== (payload.action ?? '') ||
      Number(c.confidence) !== Number(payload.confidence) ||
      JSON.stringify(c.tags ?? []) !== JSON.stringify(payload.tags ?? []) ||
      (isStrategy && (
        (c.lessons ?? '') !== (payload.lessons ?? '') ||
        Number(c.return_pct ?? 0) !== Number(payload.return_pct ?? 0) ||
        (c.outcome ?? '') !== (payload.outcome ?? '')
      ));
    if (changed) {
      await client.query(
        `UPDATE checkup_knowledge_items SET title=$3,fact=$4,interpretation=$5,action=$6,confidence=$7,tags=$8,is_active=$9,lessons=$10,return_pct=$11,outcome=$12,version=version+1,updated_at=now()
         WHERE category=$1 AND item_id=$2`,
        [payload.category, payload.item_id, payload.title, payload.fact, payload.interpretation,
         payload.action, payload.confidence, payload.tags, payload.is_active,
         payload.lessons, payload.return_pct, payload.outcome]
      );
      updated++;
    } else {
      unchanged++;
    }
  }
}
console.log(`Done: inserted=${inserted}, updated=${updated}, unchanged=${unchanged}`);
await client.end();
