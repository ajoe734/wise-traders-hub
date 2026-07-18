// Weekly journal export — 每週五 23:30 Asia/Taipei 自動執行
// 抓當週 (Mon 00:00 ~ next Mon 00:00) 所有 mentor 已發布週記 → CSV
// → 上傳到 storage bucket "journal-exports" → 為所有 company_admin 建立站內通知（附下載連結）
// → 清理超過 30 天的舊檔
//
// 觸發：pg_cron（詳見同批 SQL）。也可帶 body { weekStart: "YYYY-MM-DD" } 手動補跑。

import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MS_DAY = 86_400_000;
const TZ_OFFSET_MS = 8 * 60 * 60 * 1000;

function taipeiMondayOf(d: Date): string {
  const shifted = new Date(d.getTime() + TZ_OFFSET_MS);
  const day = shifted.getUTCDay();
  const diff = (day + 6) % 7;
  const monday = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate() - diff));
  return monday.toISOString().slice(0, 10);
}
function weekRangeUtc(weekStart: string) {
  const start = new Date(`${weekStart}T00:00:00+08:00`);
  const end = new Date(start.getTime() + 7 * MS_DAY);
  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    startLabel: weekStart,
    endLabel: new Date(end.getTime() - MS_DAY).toISOString().slice(0, 10),
  };
}
function fmtTaipei(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const s = new Date(d.getTime() + TZ_OFFSET_MS);
  return `${s.getUTCFullYear()}/${String(s.getUTCMonth() + 1).padStart(2, "0")}/${String(s.getUTCDate()).padStart(2, "0")} ${String(s.getUTCHours()).padStart(2, "0")}:${String(s.getUTCMinutes()).padStart(2, "0")}`;
}
function csvEscape(v: unknown): string {
  const s = v == null ? "" : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
function buildCsv(header: string[], rows: unknown[][]): string {
  const body = [header, ...rows].map((r) => r.map(csvEscape).join(",")).join("\n");
  return "\ufeff" + body;
}
const ASSET_LABEL: Record<string, string> = {
  tw_stock: "台股",
  us_stock: "美股",
  crypto: "加密",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    // 允許 body 覆寫 weekStart（手動補跑用）
    let weekStart: string | null = null;
    try {
      if (req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        if (body?.weekStart && /^\d{4}-\d{2}-\d{2}$/.test(body.weekStart)) {
          weekStart = taipeiMondayOf(new Date(`${body.weekStart}T12:00:00+08:00`));
        }
      }
    } catch {
      // ignore
    }
    if (!weekStart) weekStart = taipeiMondayOf(new Date());
    const range = weekRangeUtc(weekStart);

    console.log(`[weekly-journal-export] week=${weekStart} (${range.startIso} ~ ${range.endIso})`);

    // 1. 查詢週記
    const { data: rows, error: qErr } = await supabase
      .from("expert_signals")
      .select(
        "id, status, instrument, action, price_hint, reason_summary, reason_detail, risk_notes, learning_points, published_at, created_at, expert_id, experts!inner(name, slug, role, asset_class, currency)",
      )
      .eq("status", "published")
      .eq("experts.role", "mentor")
      .gte("published_at", range.startIso)
      .lt("published_at", range.endIso)
      .order("expert_id", { ascending: true })
      .order("published_at", { ascending: true });

    if (qErr) throw new Error(`query expert_signals failed: ${qErr.message}`);
    const list = (rows ?? []) as any[];

    // 統計老師數
    const mentorSet = new Set<string>();
    for (const r of list) mentorSet.add(r.expert_id);

    console.log(`[weekly-journal-export] found ${list.length} rows, ${mentorSet.size} mentors`);

    // 2. 組 CSV
    const header = [
      "老師名稱", "老師 Slug", "資產類別", "幣別",
      "週別起始", "週別結束",
      "狀態", "發布時間 (台北)", "建立時間 (台北)",
      "標的", "動作", "參考價",
      "重點摘要", "詳細分析", "風險提醒", "學習重點",
      "訊號 ID",
    ];
    const body: unknown[][] = list.map((r) => [
      r.experts?.name ?? "",
      r.experts?.slug ?? "",
      ASSET_LABEL[r.experts?.asset_class ?? ""] ?? (r.experts?.asset_class ?? ""),
      r.experts?.currency ?? "",
      range.startLabel,
      range.endLabel,
      r.status ?? "",
      fmtTaipei(r.published_at),
      fmtTaipei(r.created_at),
      r.instrument ?? "",
      r.action ?? "",
      r.price_hint ?? "",
      r.reason_summary ?? "",
      r.reason_detail ?? "",
      r.risk_notes ?? "",
      r.learning_points ?? "",
      r.id,
    ]);
    const csv = buildCsv(header, body);

    // 3. 上傳到 storage
    const filename = `legendflow-journals-${range.startLabel}_to_${range.endLabel}_published.csv`;
    const path = `${range.startLabel}/${filename}`;
    const { error: upErr } = await supabase.storage
      .from("journal-exports")
      .upload(path, new Blob([csv], { type: "text/csv;charset=utf-8" }), {
        contentType: "text/csv;charset=utf-8",
        upsert: true,
      });
    if (upErr) throw new Error(`upload failed: ${upErr.message}`);

    // 4. 產生 30 天有效簽章連結
    const { data: signed, error: signErr } = await supabase.storage
      .from("journal-exports")
      .createSignedUrl(path, 30 * 24 * 60 * 60);
    if (signErr || !signed?.signedUrl) throw new Error(`sign url failed: ${signErr?.message}`);
    const signedUrl = signed.signedUrl;

    // 5. 站內通知所有 company_admin
    const { data: admins, error: adminErr } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "company_admin");
    if (adminErr) throw new Error(`fetch admins failed: ${adminErr.message}`);

    const adminIds = (admins ?? []).map((a: any) => a.user_id);
    const title = list.length > 0
      ? `週記匯出完成：${range.startLabel} 週共 ${list.length} 則 / ${mentorSet.size} 位老師`
      : `週記匯出：${range.startLabel} 週目前無任何已發布週記`;
    const bodyText = list.length > 0
      ? `檔案已產生，30 天內可下載。點擊開啟或前往「週記匯出」頁面歷史紀錄。`
      : `本週尚無 mentor 發布週記，未產生 CSV 檔。`;

    if (adminIds.length > 0 && list.length > 0) {
      // link 一律存內部相對路徑；signed_url 分離到 download_url，避免前端誤把外部 URL 丟給 react-router
      const notifRows = adminIds.map((uid: string) => ({
        user_id: uid,
        title,
        body: bodyText,
        type: "journal_export",
        link: "/company/journals-export",
        download_url: signedUrl,
      }));
      const { error: notifErr } = await supabase.from("notifications").insert(notifRows);
      if (notifErr) console.error(`insert notifications failed: ${notifErr.message}`);
    } else if (adminIds.length > 0) {
      // 空匯出也通知，用 info 型別
      const notifRows = adminIds.map((uid: string) => ({
        user_id: uid,
        title,
        body: bodyText,
        type: "journal_export",
        link: "/company/journals-export",
      }));
      await supabase.from("notifications").insert(notifRows);
    }

    // 6. 清理超過 30 天的舊檔
    let deletedCount = 0;
    try {
      const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
      // 列出所有週資料夾
      const { data: folders } = await supabase.storage.from("journal-exports").list("", { limit: 1000 });
      const toDelete: string[] = [];
      for (const folder of folders ?? []) {
        if (!folder.name) continue;
        // folder.name 是週一日期 YYYY-MM-DD；若早於 cutoff 就刪除該資料夾內所有檔
        const folderDate = new Date(`${folder.name}T00:00:00+08:00`).getTime();
        if (Number.isFinite(folderDate) && folderDate < cutoff) {
          const { data: files } = await supabase.storage.from("journal-exports").list(folder.name, { limit: 100 });
          for (const f of files ?? []) toDelete.push(`${folder.name}/${f.name}`);
        }
      }
      if (toDelete.length > 0) {
        const { error: delErr } = await supabase.storage.from("journal-exports").remove(toDelete);
        if (delErr) console.error(`cleanup delete failed: ${delErr.message}`);
        else deletedCount = toDelete.length;
      }
    } catch (e) {
      console.error(`cleanup failed:`, e);
    }

    const result = {
      ok: true,
      weekStart: range.startLabel,
      weekEnd: range.endLabel,
      journals: list.length,
      mentors: mentorSet.size,
      admins_notified: list.length > 0 ? adminIds.length : adminIds.length,
      file_path: path,
      signed_url: signedUrl,
      cleaned_up: deletedCount,
    };
    console.log(`[weekly-journal-export] done`, result);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error(`[weekly-journal-export] error:`, e);
    return new Response(JSON.stringify({ ok: false, error: e?.message ?? String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
