// deno-lint-ignore-file
import { serviceClient, type SupabaseClient } from './supabaseClients.ts';
/**
 * Shared Google News RSS cache.
 * Used by checkup-calendar and checkup-predict-events to avoid duplicate
 * external RSS fetches for the same stock code within a short window.
 *
 * Storage: checkup_storage table, system UID, key `news-cache-{code}`.
 * TTL: default 5 minutes.
 */


export type NewsItem = {
  title: string;
  source: string;
  pubDate: string;
};

const SYSTEM_UID = '00000000-0000-0000-0000-000000000000';
const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_FETCH_TIMEOUT_MS = 3000;
const MAX_ITEMS_PER_CODE = 5;

function decodeHtml(value: string) {
  return String(value || '')
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function pickTag(block: string, tag: string) {
  const match = block.match(new RegExp(`<${tag}(?:[^>]*)>([\\s\\S]*?)<\/${tag}>`, 'i'));
  return decodeHtml(match?.[1] || '');
}

function parseRssItems(xml: string): NewsItem[] {
  return Array.from(String(xml || '').matchAll(/<item\b[\s\S]*?<\/item>/gi))
    .map(m => m[0])
    .map(block => ({
      title: pickTag(block, 'title'),
      source: pickTag(block, 'source'),
      pubDate: pickTag(block, 'pubDate'),
    }))
    .filter(it => it.title);
}

let _admin: SupabaseClient | null = null;
function getAdmin() {
  if (_admin) return _admin;
  _admin = serviceClient();
  return _admin;
}

async function readCache(code: string, ttlMs: number): Promise<NewsItem[] | null> {
  try {
    const supabase = getAdmin();
    const { data } = await supabase
      .from('checkup_storage')
      .select('data, updated_at')
      .eq('user_id', SYSTEM_UID)
      .eq('key', `news-cache-${code}`)
      .maybeSingle();
    if (!data?.updated_at) return null;
    const updated = new Date(data.updated_at as string).getTime();
    if (!Number.isFinite(updated)) return null;
    if (Date.now() - updated > ttlMs) return null;
    const items = (data as any).data?.items;
    if (Array.isArray(items)) return items as NewsItem[];
    return null;
  } catch {
    return null;
  }
}

async function writeCache(code: string, items: NewsItem[]) {
  try {
    const supabase = getAdmin();
    await supabase
      .from('checkup_storage')
      .upsert(
        {
          user_id: SYSTEM_UID,
          key: `news-cache-${code}`,
          data: { items },
        },
        { onConflict: 'user_id,key' },
      );
  } catch (err) {
    console.warn(`[newsCache] write failed for ${code}:`, err);
  }
}

async function fetchRss(query: string, timeoutMs: number): Promise<NewsItem[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`;
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'portfolio-dashboard/1.0',
        'Accept': 'application/rss+xml, text/xml;q=0.9',
      },
    });
    if (!res.ok) return [];
    const xml = await res.text();
    return parseRssItems(xml).slice(0, MAX_ITEMS_PER_CODE);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export type FetchOpts = {
  ttlMs?: number;
  timeoutMs?: number;
  /** Optional extra query terms appended to the code, e.g. "台股 法說 財報". */
  queryHint?: string;
};

/**
 * Fetch news items for a single stock code with shared cache.
 * Always returns an array (empty on failure).
 */
export async function fetchNewsForCode(code: string, opts: FetchOpts = {}): Promise<NewsItem[]> {
  const c = String(code || '').trim();
  if (!c) return [];
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;

  const cached = await readCache(c, ttlMs);
  if (cached) {
    console.log(`[newsCache] hit ${c} (${cached.length} items)`);
    return cached;
  }

  const query = opts.queryHint ? `${c} ${opts.queryHint}` : `${c} 台股`;
  const items = await fetchRss(query, timeoutMs);
  console.log(`[newsCache] miss ${c} -> fetched ${items.length} items`);
  if (items.length > 0) {
    // fire-and-forget write; we don't await to keep latency low
    writeCache(c, items);
  }
  return items;
}

/** Fetch news for multiple codes in parallel, returns map: code -> items. */
export async function fetchNewsForCodes(
  codes: string[],
  opts: FetchOpts = {},
): Promise<Map<string, NewsItem[]>> {
  const result = new Map<string, NewsItem[]>();
  const uniq = [...new Set((codes || []).map(c => String(c || '').trim()).filter(Boolean))];
  await Promise.all(uniq.map(async (c) => {
    result.set(c, await fetchNewsForCode(c, opts));
  }));
  return result;
}
