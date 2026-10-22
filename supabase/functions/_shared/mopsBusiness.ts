/**
 * mopsBusiness — 公開資訊觀測站「公司基本資料」主要經營業務。
 * 分類依據唯一外部來源；呼叫一律經 fetchWithRetry。
 */
import { fetchWithRetry } from './retryFetch.ts';

/** 純函式：從 t05st03 HTML 取出「主要經營業務」文字，取不到回 null */
export function parseMainBusiness(html: string): string | null {
  const i = html.indexOf('主要經營業務');
  if (i < 0) return null;
  const tail = html.slice(i + '主要經營業務'.length, i + 4000);
  const td = tail.match(/<td[^>]*>([\s\S]*?)<\/td>/i);
  const raw = (td ? td[1] : tail)
    .replace(/<br\s*\/?>/gi, '；')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;?/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw) return null;
  // 同一品項常重複出現（例：電子級玻璃纖維 ×3），去重
  const out = raw.replace(/(\S+)(\s+\1)+/g, '$1').slice(0, 400);
  return out || null;
}

export async function fetchMainBusiness(symbol: string): Promise<string | null> {
  const body = new URLSearchParams({
    encodeURIComponent: '1', step: '1', firstin: '1', off: '1',
    queryName: 'co_id', inpuType: 'co_id', TYPEK: 'all', co_id: symbol,
  });
  const res = await fetchWithRetry(
    'https://mopsov.twse.com.tw/mops/web/ajax_t05st03',
    { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    { source: 'mops_t05st03', policy: { maxAttempts: 3 } },
  );
  if (!res.ok) return null;
  return parseMainBusiness(await res.text());
}
