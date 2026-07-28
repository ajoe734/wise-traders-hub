// AUTH: user  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
// deno-lint-ignore-file
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { codedErrorResponse } from '../_shared/errorCodes.ts';
import { corsHeaders } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabaseClients.ts";
import { withLogging } from "../_shared/edgeLogger.ts";

function esc(s: string) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

const handler = withLogging('checkup-report', async (req, log) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'GET') {
    return codedErrorResponse('METHOD_NOT_ALLOWED', '不支援的 HTTP 方法');
  }

  const supabase = serviceClient();

  // Extract user_id from JWT
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.replace('Bearer ', '');
  let userId: string | null = null;
  try {
    const { data: { user } } = await supabase.auth.getUser(token);
    userId = user?.id || null;
  } catch {}
  if (!userId) {
    return new Response('未認證', { status: 401, headers: corsHeaders });
  }

  try {
    const keys = ['strategy-brain', 'analysis-history', 'events', 'pf-holdings-v2'];
    const { data: rows } = await supabase
      .from('checkup_storage')
      .select('key, data')
      .eq('user_id', userId)
      .in('key', keys);

    const map: Record<string, any> = {};
    (rows || []).forEach(r => { map[r.key] = r.data; });

    const brain = map['strategy-brain'];
    const history = Array.isArray(map['analysis-history']) ? map['analysis-history'] : [];
    const events = Array.isArray(map['events']) ? map['events'] : [];
    const holdings = Array.isArray(map['pf-holdings-v2']) ? map['pf-holdings-v2'] : [];

    const today = new Date().toLocaleDateString('zh-TW');
    let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>持倉看板週報素材</title></head><body>`;
    html += `<h1>持倉看板週報素材</h1><p>生成日期：${today}</p>`;

    if (holdings.length > 0) {
      const totalCost = holdings.reduce((s: number, h: any) => s + ((h.cost || 0) * (h.qty || 0)), 0);
      const totalVal = holdings.reduce((s: number, h: any) => s + (h.value || 0), 0);
      const totalPnl = totalVal - totalCost;
      html += `<h2>投資組合總覽</h2>`;
      html += `<p>持股數：${holdings.length} 檔 | 總成本：${Math.round(totalCost).toLocaleString()} | 總市值：${totalVal.toLocaleString()}</p>`;
      html += `<h2>持倉明細</h2><table><tr><th>名稱</th><th>數量</th><th>成本</th><th>現價</th><th>報酬率</th></tr>`;
      holdings.forEach((h: any) => {
        html += `<tr><td>${esc(h.name || '')}(${esc(h.code || '')})</td><td>${h.qty || 0}</td><td>${h.cost || 0}</td><td>${h.price || 0}</td><td>${(h.pct || 0) >= 0 ? '+' : ''}${h.pct || 0}%</td></tr>`;
      });
      html += `</table>`;
    }

    if (brain) {
      html += `<h2>策略大腦</h2>`;
      if (brain.rules?.length > 0) {
        html += `<h3>核心規則</h3><ol>`;
        brain.rules.forEach((r: any) => { html += `<li>${esc(typeof r === 'string' ? r : r.text || '')}</li>`; });
        html += `</ol>`;
      }
    }

    if (history.length > 0) {
      html += `<h2>近期分析</h2>`;
      history.slice(0, 7).forEach((r: any) => {
        html += `<h3>${esc(r.date || '')} ${esc(r.time || '')}</h3>`;
        if (r.aiInsight) html += `<p>${esc(r.aiInsight)}</p>`;
        html += `<hr>`;
      });
    }

    html += `</body></html>`;
    return new Response(html, {
      headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    const msg = (err as Error).message;
    log.error('handler_error', { msg });
    return new Response(`錯誤: ${msg}`, {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'text/plain' },
    });
  }
});

Deno.serve(handler);
