/**
 * stock-industry-classify —— 全市場細分產業／題材分類（STOCK_INDUSTRY_MAP_V1）
 *
 * 來源：public.tw_industry_peers（官方大類＋市場別）＋ public.stock_names（名稱）
 * 分類：Lovable AI Gateway（chat completions + 嚴格 json_schema，enum 限定字典值）
 * 落地：public.stock_industry_map（symbol PK upsert）
 *
 * modes：
 *   - missing（預設）：只分類尚未有紀錄的個股
 *   - all：全市場重分類（reviewed=true 的手動確認列不覆蓋）
 *   - symbols：指定代號
 *
 * 僅接受排程金鑰（X-Cron-Key）。
 */
// AUTH: cron-key
import { serviceClient } from '../_shared/supabaseClients.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { requireCronKey, AuthError } from '../_shared/authGuard.ts';
import {
  INDUSTRIES,
  INDUSTRY_GROUPS,
  THEMES,
  isNonEquity,
  sanitizeIndustries,
  sanitizeThemes,
} from '../_shared/industryTaxonomy.ts';

const GATEWAY = 'https://ai.gateway.lovable.dev/v1/chat/completions';
const MODEL = 'google/gemini-3.8-flash';
const BATCH_SIZE = 20;
const DEFAULT_MAX_BATCHES = 20;
const CONCURRENCY = 4;

type Candidate = {
  symbol: string;
  name: string | null;
  market: string | null;
  official: string | null;
};

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['results'],
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['symbol', 'industries', 'revenueMix', 'themes', 'confidence'],
        properties: {
          symbol: { type: 'string' },
          industries: {
            type: 'array',
            minItems: 1,
            maxItems: 3,
            items: { type: 'string', enum: INDUSTRIES },
          },
          revenueMix: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['industry', 'pct'],
              properties: {
                industry: { type: 'string', enum: INDUSTRIES },
                pct: { type: 'number' },
              },
            },
          },
          themes: { type: 'array', items: { type: 'string', enum: THEMES } },
          confidence: { type: 'number' },
        },
      },
    },
  },
} as const;

function systemPrompt(): string {
  const dict = Object.entries(INDUSTRY_GROUPS)
    .map(([g, list]) => `${g}：${list.join('、')}`)
    .join('\n');
  return [
    '你是台股產業分類專家。針對每一檔個股，依主要營收來源指定 1-3 個「細分產業」與 0-5 個「題材」。',
    '規則：',
    '1. 細分產業與題材只能從下列字典逐字挑選，不得自創、不得改字。',
    '2. industries 依營收比重由高到低排列；revenueMix 為對應比重（總和 100），無法判斷比重時回傳空陣列。',
    '3. 只有一個主業時就只給 1 個細分產業，不要硬湊。',
    '4. confidence 0-1：熟悉且確定 0.8 以上；只能靠官方大類推測給 0.4 以下。',
    '5. 官方大類僅供參考，請以公司實際業務為準（例：3443 創意是 ASIC 設計服務，不是泛半導體）。',
    '',
    '【細分產業字典】',
    dict,
    '',
    '【題材字典】',
    THEMES.join('、'),
  ].join('\n');
}

async function classifyBatch(
  apiKey: string,
  batch: Candidate[],
): Promise<Array<Record<string, unknown>>> {
  const userLines = batch
    .map((c) => `${c.symbol}\t${c.name ?? ''}\t官方大類:${c.official ?? '未知'}\t市場:${c.market ?? '未知'}`)
    .join('\n');

  let attempt = 0;
  // 只有 429 / 5xx 可重試（AI Gateway 錯誤語意）
  while (attempt < 4) {
    const res = await fetch(GATEWAY, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Lovable-API-Key': apiKey,
        'X-Lovable-AIG-SDK': 'fetch',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt() },
          { role: 'user', content: `請分類以下台股（代號\t名稱\t官方大類\t市場）：\n${userLines}` },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'stock_industry_classification', strict: true, schema: SCHEMA },
        },
      }),
    });

    if (res.ok) {
      const json = await res.json();
      const content = json?.choices?.[0]?.message?.content ?? '{}';
      const parsed = typeof content === 'string' ? JSON.parse(content) : content;
      const results = Array.isArray(parsed?.results) ? parsed.results : [];
      return results as Array<Record<string, unknown>>;
    }

    const body = await res.text();
    if (res.status === 429 || res.status >= 500) {
      attempt += 1;
      const wait = Math.min(30000, 1500 * 2 ** attempt) + Math.floor(Math.random() * 500);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    throw new Error(`AI_GATEWAY_${res.status}: ${body.slice(0, 300)}`);
  }
  throw new Error('AI_GATEWAY_RETRY_EXHAUSTED');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    requireCronKey(req);
  } catch (err) {
    const status = err instanceof AuthError ? err.status : 401;
    return new Response(JSON.stringify({ error: 'UNAUTHENTICATED' }), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const apiKey = Deno.env.get('LOVABLE_API_KEY');
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'MISSING_LOVABLE_API_KEY' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = serviceClient();

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const mode = String(body.mode ?? 'missing');
  const maxBatches = Number(body.maxBatches ?? DEFAULT_MAX_BATCHES);
  const wantedSymbols = Array.isArray(body.symbols) ? body.symbols.map(String) : [];

  // 1. 取母體
  const universe: Candidate[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('tw_industry_peers')
      .select('symbol, industry, market')
      .order('symbol')
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`peers_read_failed: ${error.message}`);
    for (const row of data ?? []) {
      universe.push({
        symbol: row.symbol as string,
        name: null,
        market: (row.market as string) ?? null,
        official: (row.industry as string) ?? null,
      });
    }
    if (!data || data.length < pageSize) break;
  }

  // 名稱
  const names = new Map<string, string>();
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('stock_names')
      .select('symbol, name')
      .order('symbol')
      .range(from, from + pageSize - 1);
    if (error) break;
    for (const row of data ?? []) names.set(row.symbol as string, row.name as string);
    if (!data || data.length < pageSize) break;
  }
  for (const c of universe) c.name = names.get(c.symbol) ?? null;

  // 已存在紀錄
  const existing = new Map<string, boolean>();
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('stock_industry_map')
      .select('symbol, reviewed')
      .order('symbol')
      .range(from, from + pageSize - 1);
    if (error) break;
    for (const row of data ?? []) existing.set(row.symbol as string, row.reviewed as boolean);
    if (!data || data.length < pageSize) break;
  }

  // 2. 篩選待分類
  let pending = universe.filter((c) => !isNonEquity({ symbol: c.symbol, officialIndustry: c.official, name: c.name }));
  if (mode === 'symbols') {
    const set = new Set(wantedSymbols);
    pending = pending.filter((c) => set.has(c.symbol));
  } else if (mode === 'all') {
    pending = pending.filter((c) => existing.get(c.symbol) !== true);
  } else {
    pending = pending.filter((c) => !existing.has(c.symbol));
  }

  const batches: Candidate[][] = [];
  for (let i = 0; i < pending.length; i += BATCH_SIZE) batches.push(pending.slice(i, i + BATCH_SIZE));
  const runBatches = batches.slice(0, Math.max(0, maxBatches));

  const stats = { pending: pending.length, batches: runBatches.length, classified: 0, skipped: 0, failed: 0 };
  const failures: Array<{ batch: number; error: string }> = [];

  let cursor = 0;
  async function worker() {
    while (cursor < runBatches.length) {
      const idx = cursor++;
      const batch = runBatches[idx];
      try {
        const results = await classifyBatch(apiKey!, batch);
        const bySymbol = new Map(results.map((r) => [String(r.symbol ?? ''), r]));
        const rows = [];
        for (const c of batch) {
          const r = bySymbol.get(c.symbol);
          if (!r) {
            stats.skipped += 1;
            continue;
          }
          const { industries, revenueMix } = sanitizeIndustries(r.industries, r.revenueMix);
          if (industries.length === 0) {
            stats.skipped += 1;
            continue;
          }
          rows.push({
            symbol: c.symbol,
            name: c.name,
            market: c.market,
            official_industry: c.official,
            industries,
            revenue_mix: revenueMix,
            themes: sanitizeThemes(r.themes),
            confidence: Number.isFinite(Number(r.confidence)) ? Number(r.confidence) : null,
            model: MODEL,
            source: 'ai',
            updated_at: new Date().toISOString(),
          });
        }
        if (rows.length) {
          const { error } = await supabase
            .from('stock_industry_map')
            .upsert(rows, { onConflict: 'symbol' });
          if (error) throw new Error(`upsert_failed: ${error.message}`);
          stats.classified += rows.length;
        }
      } catch (e) {
        stats.failed += batch.length;
        failures.push({ batch: idx, error: String((e as Error).message ?? e).slice(0, 300) });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, runBatches.length) }, () => worker()));

  return new Response(
    JSON.stringify({ ok: true, mode, stats, remaining: Math.max(0, pending.length - stats.classified - stats.skipped - stats.failed), failures: failures.slice(0, 10) }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
