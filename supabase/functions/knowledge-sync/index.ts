// deno-lint-ignore-file
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// 內嵌的本地知識庫快照（2025-2026）。如未來 JSON 更新，請同步更新此處或改用 storage。
// 注意：edge function 沒辦法讀 src/，所以把資料放在這裡。
const LOCAL_KB: Record<string, { items: any[] }> = {
  industry_trends: {
    items: [
      {
        id: "ind-01",
        title: "AI ASIC 與先進封裝產能週期(2025-2026)",
        fact: "2025 年起 CoWoS 產能持續吃緊，台積電 CoWoS 月產能從 2024 年底約 3.5 萬片擴至 2025 年底 7.5 萬片仍供不應求，相關 ABF 載板、矽中介層供應鏈營收年增普遍 > 40%",
        interpretation: "AI 算力需求超越預期，產能擴張仍跟不上 NVIDIA、博通、Google TPU 的下單速度，瓶頸供應商享有定價權",
        action: "追蹤 CoWoS / SoIC 產能擴張進度與 ABF 載板報價，年增 > 30% 維持積極；若 2026H2 報價鬆動則需轉守",
        confidence: 0.85,
        tags: ["AI", "CoWoS", "先進封裝", "2026"],
      },
      {
        id: "ind-02",
        title: "HBM 競賽與記憶體報價循環",
        fact: "2025 年 HBM3e 進入量產主流，HBM4 於 2026 年放量，三星、SK 海力士、美光三強競爭下，HBM 佔 DRAM 營收比重從 2024 年 ~20% 升至 2026 年預估 ~40%",
        interpretation: "HBM 是 AI 伺服器關鍵瓶頸，產能綁定大客戶；傳統 DDR 因產能排擠反而供需轉緊，記憶體股本益比重估",
        action: "HBM 認證進度+大客戶綁定是核心；DDR 現貨報價連 2 月上漲時加碼記憶體模組廠",
        confidence: 0.80,
        tags: ["HBM", "記憶體", "AI", "2026"],
      },
      {
        id: "ind-03",
        title: "電動車滲透率放緩與 Hybrid 回潮",
        fact: "2025 年全球純電動車(BEV)滲透率成長從 2023 年高峰回落，年增僅 ~15%；油電混合(HEV/PHEV)反而年增 > 30%，豐田、現代供應鏈受惠",
        interpretation: "純電動車補貼退場+充電基礎建設不足，消費者轉向混合動力；純電供應鏈估值需下修，Hybrid 與車用 MCU 重新獲青睞",
        action: "降低純電 BEV 零組件權重；加碼車用功率半導體與 Hybrid 動力系統供應鏈",
        confidence: 0.78,
        tags: ["電動車", "Hybrid", "車用半導體", "2026"],
      },
      {
        id: "ind-04",
        title: "AI PC 與邊緣運算換機潮",
        fact: "2026 年 Windows 10 終止支援+AI PC NPU 標準成熟，全球 PC 換機潮啟動，2026 年 PC 出貨年增預估 8-12%，高於 2024-2025 持平水準",
        interpretation: "企業 IT 預算重啟+AI 應用驅動換機，NB ODM、CPU/GPU、SSD 控制晶片同步受惠",
        action: "追蹤 NB 月出貨年增轉正且連 2 月成長 → 加碼 NB 供應鏈；AI PC 滲透率突破 20% 為估值重估點",
        confidence: 0.76,
        tags: ["AI PC", "換機潮", "NB", "2026"],
      },
      {
        id: "ind-05",
        title: "矽光子與 800G/1.6T 光通訊放量",
        fact: "2025-2026 AI 資料中心互連從 400G 升級至 800G，2026H2 開始導入 1.6T，矽光子(CPO)技術 2026 年起小量導入，光收發模組廠營收年增 > 60%",
        interpretation: "AI 叢集規模化推升網路頻寬需求，光通訊是僅次於 GPU 的關鍵瓶頸，CPO 將重塑供應鏈",
        action: "追蹤大廠 CPO 採用時程；光模組廠毛利率連 2 季提升 + 800G 占比 > 50% → 積極布局",
        confidence: 0.79,
        tags: ["矽光子", "CPO", "光通訊", "AI", "2026"],
      },
    ],
  },
};

// 標記為「過時」的條件：industry_trends 中 tags 含 2024 但不含 2025/2026
function isStale(category: string, row: any): boolean {
  if (category !== 'industry_trends') return false;
  const tags = (row.tags ?? []) as string[];
  const has2024 = tags.some(t => t.includes('2024'));
  const hasNew = tags.some(t => t.includes('2025') || t.includes('2026'));
  return has2024 && !hasNew;
}

function diff(local: any, cloud: any): string[] {
  const fields = ['title', 'fact', 'interpretation', 'action', 'confidence', 'tags'];
  const out: string[] = [];
  for (const f of fields) {
    const a = local[f]; const b = cloud[f];
    if (Array.isArray(a) || Array.isArray(b)) {
      if (JSON.stringify(a ?? []) !== JSON.stringify(b ?? [])) out.push(f);
    } else if (typeof a === 'number' || typeof b === 'number') {
      if (Number(a ?? 0) !== Number(b ?? 0)) out.push(f);
    } else {
      if ((a ?? '') !== (b ?? '')) out.push(f);
    }
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    const body = await req.json().catch(() => ({}));
    const dryRun = body.dryRun !== false; // 預設 dryRun
    const trigger = body.trigger ?? (dryRun ? 'manual_preview' : 'manual_apply');
    const actorId = body.actorId ?? null;

    // 取得本地與雲端條目
    const cloudByCat: Record<string, any[]> = {};
    for (const category of Object.keys(LOCAL_KB)) {
      const { data, error } = await supabase
        .from('checkup_knowledge_items')
        .select('id,item_id,category,title,fact,interpretation,action,confidence,tags,is_active,version')
        .eq('category', category);
      if (error) throw error;
      cloudByCat[category] = data ?? [];
    }

    const toInsert: any[] = [];
    const toUpdate: { row: any; changes: string[]; cloudId: string; oldVersion: number }[] = [];
    const toDeactivate: any[] = [];
    const unchanged: any[] = [];

    for (const [category, kb] of Object.entries(LOCAL_KB)) {
      const cloudRows = cloudByCat[category] ?? [];
      const cloudMap = new Map(cloudRows.map((r: any) => [r.item_id, r]));
      const localIds = new Set(kb.items.map((it: any) => it.id));

      for (const item of kb.items) {
        const row = {
          category,
          item_id: item.id,
          title: item.title,
          fact: item.fact,
          interpretation: item.interpretation ?? null,
          action: item.action ?? null,
          confidence: item.confidence ?? 0.75,
          tags: item.tags ?? [],
          is_active: true,
        };
        const cloud = cloudMap.get(item.id);
        if (!cloud) {
          toInsert.push(row);
        } else {
          const changes = diff(row, cloud);
          if (changes.length > 0) {
            toUpdate.push({ row, changes, cloudId: cloud.id, oldVersion: cloud.version ?? 1 });
          } else {
            unchanged.push(row);
          }
        }
      }

      // 過時條目（2024 only）需要停用
      for (const cloud of cloudRows) {
        if (cloud.is_active && !localIds.has(cloud.item_id) && isStale(category, cloud)) {
          toDeactivate.push(cloud);
        }
      }
    }

    const summary = {
      dryRun,
      trigger,
      counts: {
        insert: toInsert.length,
        update: toUpdate.length,
        deactivate_stale: toDeactivate.length,
        unchanged: unchanged.length,
      },
      preview: {
        insert: toInsert.map(r => ({ category: r.category, item_id: r.item_id, title: r.title, confidence: r.confidence, tags: r.tags })),
        update: toUpdate.map(u => ({
          category: u.row.category, item_id: u.row.item_id, title: u.row.title,
          changes: u.changes, version: `v${u.oldVersion} → v${u.oldVersion + 1}`,
          confidence: u.row.confidence, tags: u.row.tags,
        })),
        deactivate_stale: toDeactivate.map(r => ({ category: r.category, item_id: r.item_id, title: r.title, tags: r.tags })),
      },
    };

    if (dryRun) {
      return new Response(JSON.stringify({ success: true, ...summary }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 真寫入
    let okCount = 0;
    const errors: string[] = [];

    for (const row of toInsert) {
      const { error } = await supabase.from('checkup_knowledge_items')
        .upsert(row, { onConflict: 'category,item_id' });
      if (error) errors.push(`insert ${row.item_id}: ${error.message}`); else okCount++;
    }
    for (const u of toUpdate) {
      const { error } = await supabase.from('checkup_knowledge_items')
        .upsert(u.row, { onConflict: 'category,item_id' });
      if (error) errors.push(`update ${u.row.item_id}: ${error.message}`); else okCount++;
    }
    for (const r of toDeactivate) {
      const { error } = await supabase.from('checkup_knowledge_items')
        .update({ is_active: false, archived_at: new Date().toISOString(), archived_reason: 'stale_2024_replaced_by_sync', lifecycle_status: 'archived' })
        .eq('id', r.id);
      if (error) errors.push(`deactivate ${r.item_id}: ${error.message}`); else okCount++;
    }

    const ok = errors.length === 0;

    // 寫 audit
    if (actorId) {
      await supabase.from('audit_logs').insert({
        actor_id: actorId,
        action: ok ? 'knowledge.sync_apply' : 'knowledge.sync_apply_failed',
        target_type: 'checkup_knowledge_items',
        detail: { trigger, summary: summary.counts, errors, applied_at: new Date().toISOString() },
      });
    }

    // 失敗時通知所有 admin
    if (!ok) {
      const { data: admins } = await supabase.from('user_roles').select('user_id').eq('role', 'company_admin');
      const rows = (admins ?? []).map((a: any) => ({
        user_id: a.user_id,
        type: 'system',
        title: '知識庫同步失敗',
        body: `觸發來源：${trigger}；錯誤：${errors.slice(0, 3).join('; ')}${errors.length > 3 ? `…共 ${errors.length} 個` : ''}`,
        is_read: false,
      }));
      if (rows.length) await supabase.from('notifications').insert(rows);
    }

    return new Response(JSON.stringify({ success: ok, ...summary, applied: okCount, errors }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: ok ? 200 : 500,
    });
  } catch (err) {
    console.error('knowledge-sync error', err);
    // 全域失敗也寫一條 audit
    try {
      const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
      await supabase.from('audit_logs').insert({
        action: 'knowledge.sync_apply_failed',
        target_type: 'checkup_knowledge_items',
        actor_id: null,
        detail: { error: (err as Error).message },
      });
    } catch {/* ignore */}
    return new Response(JSON.stringify({ success: false, error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
