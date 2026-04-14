// deno-lint-ignore-file
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

function decodeHtml(value: string) {
  return String(value || '')
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pickTag(block: string, tag: string) {
  const match = block.match(new RegExp(`<${tag}(?:[^>]*)>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return decodeHtml(match?.[1] || '');
}

function parseRssItems(xml: string) {
  const items = Array.from(String(xml || '').matchAll(/<item\b[\s\S]*?<\/item>/gi)).map(match => match[0]);
  return items.map(item => ({
    title: pickTag(item, 'title'),
    link: pickTag(item, 'link'),
    pubDate: pickTag(item, 'pubDate'),
    description: pickTag(item, 'description'),
    source: pickTag(item, 'source'),
  }));
}

function buildItemHash(item: any): string {
  const str = [item.title, item.link, item.pubDate, item.source].join('|');
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + ch;
    hash |= 0;
  }
  return Math.abs(hash).toString(16).slice(0, 16);
}

function looksRelevant(item: any, code: string, name: string) {
  const haystack = `${item.title} ${item.description}`.toLowerCase();
  return haystack.includes(String(code || '').toLowerCase()) || haystack.includes(String(name || '').toLowerCase());
}

async function fetchTextWithTimeout(url: string, timeoutMs = 8000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'portfolio-dashboard/1.0',
        'Accept': 'application/rss+xml, application/xml, text/xml;q=0.9',
      },
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`RSS request failed (${response.status})`);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function extractInsights(apiKey: string, stock: any, items: any[]) {
  if (!items.length || !apiKey) return new Map();
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 900,
        temperature: 0.1,
        system: '你是台股公開報告索引整理器。從新聞標題與摘要中抽出結構化資訊。回傳純 JSON，不要 markdown。',
        messages: [{
          role: 'user',
          content: `回傳格式：{"items":[{"id":"原樣回傳","summary":"一句話摘要","target":數字或null,"firm":"券商或空","stance":"bullish/neutral/bearish/unknown","tags":["標籤"],"confidence":0到1}]}

股票：${stock.name}(${stock.code})
${items.map(i => `- [${i.id}] ${i.title}\n  來源：${i.source || '未知'} | 日期：${i.publishedAt || '未知'}\n  摘要：${i.snippet || '無'}`).join('\n\n')}`,
        }],
      }),
    });
    if (!response.ok) return new Map();
    const data = await response.json();
    const text = data.content?.map((b: any) => b.text || '').join('').trim() || '';
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    return new Map((parsed?.items || []).filter((i: any) => i?.id).map((i: any) => [i.id, i]));
  } catch { return new Map(); }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');

  try {
    const { code, name, knownHashes = [], maxItems = 6, maxExtract = 2 } = await req.json();
    if (!code || !name) {
      return new Response(JSON.stringify({ error: '缺少 code 或 name' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const query = `${code} ${name} 台股 目標價 投顧 研究報告 法說 財報 when:30d`;
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`;
    const xml = await fetchTextWithTimeout(url);
    const parsedItems = parseRssItems(xml)
      .filter(item => item.title && item.link)
      .filter(item => looksRelevant(item, code, name))
      .map(item => ({
        ...item,
        publishedAt: item.pubDate ? new Date(item.pubDate).toLocaleDateString('zh-TW') : null,
        snippet: item.description,
      }));

    const deduped: any[] = [];
    const seen = new Set<string>();
    for (const item of parsedItems) {
      const id = buildItemHash(item);
      if (seen.has(id)) continue;
      seen.add(id);
      deduped.push({
        id, hash: id,
        title: item.title, url: item.link, source: item.source || '',
        publishedAt: item.publishedAt, snippet: item.snippet || '',
      });
    }

    const known = new Set((knownHashes || []).filter(Boolean));
    const newItems = deduped.filter(item => !known.has(item.id)).slice(0, Math.max(1, Number(maxItems) || 6));
    const insights = apiKey ? await extractInsights(apiKey, { code, name }, newItems.slice(0, maxExtract)) : new Map();

    const items = newItems.map(item => {
      const insight: any = insights.get(item.id);
      return {
        ...item,
        summary: insight?.summary?.trim() || '',
        target: Number.isFinite(Number(insight?.target)) && Number(insight?.target) > 0 ? Number(insight.target) : null,
        firm: insight?.firm?.trim() || '',
        stance: ['bullish', 'neutral', 'bearish', 'unknown'].includes(insight?.stance) ? insight.stance : 'unknown',
        tags: Array.isArray(insight?.tags) ? insight.tags.filter(Boolean).slice(0, 4) : [],
        confidence: Number.isFinite(Number(insight?.confidence)) ? Number(insight.confidence) : null,
        extractedAt: new Date().toISOString(),
      };
    });

    return new Response(JSON.stringify({
      query, fetchedAt: new Date().toISOString(),
      totalFound: deduped.length, newCount: items.length, items,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Analyst reports error:', err);
    return new Response(JSON.stringify({ error: '公開報告索引抓取失敗', detail: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
