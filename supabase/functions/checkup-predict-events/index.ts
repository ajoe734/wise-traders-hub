// deno-lint-ignore-file
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const GATEWAY_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';
const GATEWAY_MODELS = ['google/gemini-2.5-flash', 'google/gemini-2.0-flash'];

/* ── AI caller ── */

async function callAI(system: string, user: string, maxTokens = 4096): Promise<string> {
  const lovableKey = Deno.env.get('LOVABLE_API_KEY');
  const geminiKey = Deno.env.get('GOOGLE_GEMINI_API_KEY');
  const messages = [
    ...(system ? [{ role: 'system', content: system }] : []),
    { role: 'user', content: user },
  ];

  if (lovableKey) {
    for (const model of GATEWAY_MODELS) {
      try {
        const response = await fetch(GATEWAY_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${lovableKey}` },
          body: JSON.stringify({ model, messages, temperature: 0.3, max_tokens: maxTokens }),
        });
        if (response.status === 429) { console.log(`Gateway ${model} rate limited`); continue; }
        if (!response.ok) { console.error(`Gateway ${model} failed (${response.status})`); continue; }
        const data = await response.json();
        const text = data.choices?.[0]?.message?.content?.trim();
        if (text) return text;
      } catch (err) { console.error(`Gateway ${model} error:`, err); }
    }
  }

  if (geminiKey) {
    for (const model of ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.0-flash-lite']) {
      try {
        const body: any = {
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: maxTokens },
        };
        if (system) body.systemInstruction = { parts: [{ text: system }] };
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
        );
        if (response.status === 429 || response.status === 503) continue;
        if (!response.ok) continue;
        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('').trim();
        if (text) return text;
      } catch {}
    }
  }

  return '';
}

/* ── helpers ── */

function extractJsonArrayStr(text: string): any[] {
  const cleaned = text.replace(/```(?:json)?\s*/g, '').replace(/```\s*/g, '');
  let depth = 0, start = -1;
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] === '[') { if (depth === 0) start = i; depth++; }
    else if (cleaned[i] === ']') { depth--; if (depth === 0 && start !== -1) return JSON.parse(cleaned.substring(start, i + 1)); }
  }
  throw new Error('No JSON array found');
}

function getSupabaseAdmin() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
}

/* ── Cache ── */

async function getCachedPrediction(supabase: any, eventId: string): Promise<any | null> {
  try {
    const SYSTEM_UID = '00000000-0000-0000-0000-000000000000';
    const { data } = await supabase.from('checkup_storage').select('data, updated_at')
      .eq('user_id', SYSTEM_UID).eq('key', `prediction-cache-${eventId}`).single();
    if (!data) return null;
    if (Date.now() - new Date(data.updated_at).getTime() < 24 * 60 * 60 * 1000) {
      console.log(`Cache hit for event ${eventId}`);
      return data.data;
    }
    return null;
  } catch { return null; }
}

async function setCachedPrediction(supabase: any, eventId: string, prediction: any) {
  try {
    const SYSTEM_UID = '00000000-0000-0000-0000-000000000000';
    await supabase.from('checkup_storage').upsert({
      user_id: SYSTEM_UID, key: `prediction-cache-${eventId}`,
      data: prediction, updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,key' });
  } catch (err) { console.error('Cache write error:', err); }
}

/* ── Knowledge Base ── */

async function fetchRelevantKnowledge(supabase: any, eventTags: string[]): Promise<string> {
  try {
    let tagItems: any[] = [];
    if (eventTags.length > 0) {
      const { data } = await supabase.from('checkup_knowledge_items')
        .select('title, fact, interpretation, action, lessons, outcome, return_pct, category')
        .eq('is_active', true).gte('confidence', 0.75).overlaps('tags', eventTags).limit(5);
      tagItems = data || [];
    }
    const { data: caseItems } = await supabase.from('checkup_knowledge_items')
      .select('title, fact, interpretation, action, lessons, outcome, return_pct')
      .eq('is_active', true).eq('category', 'strategy-cases').gte('confidence', 0.75)
      .order('return_pct', { ascending: false, nullsFirst: false }).limit(3);

    const allItems = [...tagItems, ...(caseItems || [])];
    if (allItems.length === 0) return '';
    const seen = new Set<string>();
    const unique = allItems.filter(item => { if (seen.has(item.title)) return false; seen.add(item.title); return true; });
    const lines = unique.map((item, i) =>
      `${i + 1}. 【${item.title}】${item.fact}${item.interpretation ? ` → ${item.interpretation}` : ''}${item.outcome ? ` (結果: ${item.outcome}${item.return_pct != null ? `, 報酬${item.return_pct}%` : ''})` : ''}${item.lessons ? ` [教訓: ${item.lessons}]` : ''}`
    ).join('\n');
    return `\n# 歷史參考知識\n${lines}\n`;
  } catch (err) { console.error('Knowledge fetch error:', err); return ''; }
}

/* ── Accuracy stats ── */

async function fetchAccuracyStats(supabase: any): Promise<string> {
  try {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase.from('checkup_prediction_accuracy')
      .select('event_type, was_correct').gte('reviewed_at', ninetyDaysAgo);
    if (!data || data.length < 3) return '';
    const stats: Record<string, { total: number; correct: number }> = {};
    let totalAll = 0, correctAll = 0;
    for (const row of data) {
      totalAll++; if (row.was_correct) correctAll++;
      const type = row.event_type || '其他';
      if (!stats[type]) stats[type] = { total: 0, correct: 0 };
      stats[type].total++; if (row.was_correct) stats[type].correct++;
    }
    const overallRate = Math.round((correctAll / totalAll) * 100);
    const typeLines = Object.entries(stats).filter(([, s]) => s.total >= 2)
      .map(([type, s]) => `${type}: ${Math.round((s.correct / s.total) * 100)}% (${s.correct}/${s.total})`).join('、');
    return `\n# 歷史預測表現（近90天）\n命中率: ${overallRate}% (${correctAll}/${totalAll})\n${typeLines || '樣本不足'}\n`;
  } catch { return ''; }
}

function extractEventTags(events: any[]): string[] {
  const tags = new Set<string>();
  for (const e of events) {
    const title = (e.title || '') + (e.detail || '');
    if (/法說/.test(title)) tags.add('法說會');
    if (/財報|季報|年報/.test(title)) tags.add('財報');
    if (/營收/.test(title)) tags.add('營收');
    if (/除[息權]/.test(title)) tags.add('除息');
    if (/股東會/.test(title)) tags.add('股東會');
    if (/權證/.test(title)) tags.add('權證');
    if (/總經|CPI|利率|Fed|央行/.test(title)) tags.add('總經');
    if (/技術|均線|突破|壓力|支撐/.test(title)) tags.add('技術分析');
    if (/籌碼|外資|投信|主力/.test(title)) tags.add('籌碼分析');
  }
  return [...tags];
}

/* ── RSS news fetcher ── */

function decodeHtml(value: string) {
  return String(value || '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
function pickTag(block: string, tag: string) {
  const match = block.match(new RegExp(`<${tag}(?:[^>]*)>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return decodeHtml(match?.[1] || '');
}

async function fetchNewsForStocks(codes: string[]): Promise<string> {
  // Limit to 5 codes and run in parallel with a hard 3s timeout each to avoid edge runtime CPU/time exhaustion
  const targets = codes.slice(0, 5);
  const tasks = targets.map(async (code) => {
    try {
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(code + ' 台股')}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'portfolio-dashboard/1.0' } });
      clearTimeout(timer);
      const xml = await res.text();
      const items = Array.from(xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)).map(m => m[0]).slice(0, 2);
      return items.map(item => `- ${pickTag(item, 'title')} (${pickTag(item, 'source')})`);
    } catch {
      return [];
    }
  });
  const results = await Promise.all(tasks);
  const allNews = results.flat();
  return allNews.length > 0 ? allNews.join('\n') : '（無即時新聞）';
}

/** Fetch real-time quotes from TWSE MIS API */
async function fetchRealtimeQuotes(codes: string[]): Promise<Map<string, any>> {
  const result = new Map<string, any>();
  if (!codes.length) return result;
  const unique = [...new Set(codes)];
  const exCh = unique.flatMap(c => [`tse_${c}.tw`, `otc_${c}.tw`]).join('|');
  try {
    const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(exCh)}&json=1&delay=0&_=${Date.now()}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const data = await res.json();
    for (const item of (data?.msgArray || [])) {
      if (!item.c || result.has(item.c)) continue;
      const z = parseFloat(item.z), y = parseFloat(item.y), v = parseInt(item.v, 10) || 0;
      const h = parseFloat(item.h), l = parseFloat(item.l), o = parseFloat(item.o);
      const price = !isNaN(z) && z > 0 ? z : (!isNaN(h) && h > 0 && v > 0 ? h : y);
      const changePercent = !isNaN(y) && y > 0 && !isNaN(price) ? ((price - y) / y * 100) : 0;
      result.set(item.c, { code: item.c, name: item.n || '', price: isNaN(price) ? null : price,
        yesterdayClose: isNaN(y) ? null : y, changePercent: Math.round(changePercent * 100) / 100,
        volume: v, high: isNaN(h) ? null : h, low: isNaN(l) ? null : l, open: isNaN(o) ? null : o });
    }
  } catch (err) { console.error('Fetch quotes error:', err); }
  return result;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!Deno.env.get('LOVABLE_API_KEY') && !Deno.env.get('GOOGLE_GEMINI_API_KEY')) {
    return new Response(JSON.stringify({ error: 'AI API key 未設定' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const { events, holdings } = await req.json();
    if (!events || !Array.isArray(events) || events.length === 0) {
      return new Response(JSON.stringify({ error: 'Missing events array' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = getSupabaseAdmin();

    // Cache check for single-event requests
    if (events.length === 1 && events[0].id) {
      const cached = await getCachedPrediction(supabase, events[0].id);
      if (cached) {
        return new Response(JSON.stringify({ predictions: [cached], cached: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Collect stock codes
    const allCodes = new Set<string>();
    for (const e of events) {
      const raw = e.stocks || '';
      const stocksList = Array.isArray(raw) ? raw : (typeof raw === 'string' ? raw.split(/[,、\s]+/).filter(Boolean) : []);
      for (const s of stocksList) {
        const code = typeof s === 'string' ? s.match(/^\d{4,6}/)?.[0] : (s.code || '').match(/^\d{4,6}/)?.[0];
        if (code) allCodes.add(code);
      }
    }
    for (const h of (holdings || [])) {
      const code = String(h.code || '').match(/^\d{4,6}/)?.[0];
      if (code) allCodes.add(code);
    }

    // Parallel: quotes + knowledge + accuracy + news
    const eventTags = extractEventTags(events);
    const [quotes, knowledgeContext, accuracyContext, newsContext] = await Promise.all([
      fetchRealtimeQuotes([...allCodes]),
      fetchRelevantKnowledge(supabase, eventTags),
      fetchAccuracyStats(supabase),
      fetchNewsForStocks([...allCodes]),
    ]);

    // Build enriched context
    const holdingsSummary = (holdings || []).map((h: any) => {
      const code = String(h.code || '').match(/^\d{4,6}/)?.[0] || h.code;
      const q = quotes.get(code);
      const qInfo = q ? `即時報價${q.price} 漲跌幅${q.changePercent}% 量${q.volume}張 昨收${q.yesterdayClose}` : '';
      return `${h.code} ${h.name} 成本${h.costPrice} 現價${h.marketPrice || h.costPrice} ${qInfo}`;
    }).join('\n');

    const eventsForPrompt = events.map((e: any, i: number) => {
      const rawStocks = e.stocks || '';
      const stocksArr = Array.isArray(rawStocks) ? rawStocks : (typeof rawStocks === 'string' ? rawStocks.split(/[,、\s]+/).filter(Boolean) : []);
      const stocksInfo = stocksArr.map((s: any) => {
        const code = typeof s === 'string' ? s.match(/^\d{4,6}/)?.[0] : (s.code || '').match(/^\d{4,6}/)?.[0];
        const name = typeof s === 'string' ? s : (s.name || '');
        const q = code ? quotes.get(code) : null;
        if (q) return `${code} ${name} [即時:${q.price} 漲跌${q.changePercent}% 量${q.volume}張]`;
        return `${code || ''} ${name}`;
      }).join(', ');
      return `${i + 1}. [${e.date}] ${e.title} — ${e.detail || '無細節'} (相關股票: ${stocksInfo})`;
    }).join('\n');

    const systemPrompt = '你是台股市場資深分析師，擅長根據事件和即時資訊預判對個股的漲跌影響。只輸出 JSON 陣列。';

    const userPrompt = `# 即時新聞（Google News RSS）
${newsContext}

# 持倉（含即時報價）
${holdingsSummary || '無持倉資訊'}
${knowledgeContext}${accuracyContext}
# 待預測事件（含即時報價）
${eventsForPrompt}

# 輸出格式
[{"index":1,"pred":"up/down/neutral","predReason":"一句話（30字內），引用具體數據"}]

# 預測規則
- pred 只能是 "up"、"down"、"neutral"
- predReason 必須具體，引用數據
- 只輸出 JSON 陣列`;

    const resultText = await callAI(systemPrompt, userPrompt, 4096);

    if (!resultText) {
      return new Response(JSON.stringify({ error: '預測失敗，所有模型均無法使用' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let predictions: any[] = [];
    try {
      predictions = extractJsonArrayStr(resultText);
    } catch (err) {
      console.error('Parse predictions failed:', err, resultText.slice(0, 500));
      return new Response(JSON.stringify({ error: '預測結果解析失敗' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Write cache
    for (let i = 0; i < predictions.length; i++) {
      const event = events[i];
      if (event?.id) setCachedPrediction(supabase, event.id, predictions[i]).catch(() => {});
    }

    return new Response(JSON.stringify({ predictions }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Predict events error:', err);
    return new Response(JSON.stringify({ error: '預測失敗', detail: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
