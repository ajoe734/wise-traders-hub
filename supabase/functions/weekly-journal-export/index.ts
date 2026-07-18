// Weekly journal export — 每週五 23:30 Asia/Taipei 自動執行
// 抓當週 (Mon 00:00 ~ next Mon 00:00) 所有 mentor 已發布週記
// → 每位老師產出獨立 Markdown 檔（<週別>/<slug>.md）
// → 上傳到 storage bucket "journal-exports"
// → 為所有 company_admin 建立站內通知（連到 /company/journals-export 歷史列表）
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
const ASSET_LABEL: Record<string, string> = {
  tw_stock: "台股",
  us_stock: "美股",
  crypto: "加密",
};

// ── Markdown helpers ─────────────────────────────────────
function stripHtml(html: string): string {
  // 保留段落換行，剝除標籤
  return html
    .replace(/<\s*(br|BR)\s*\/?>/g, "\n")
    .replace(/<\/?(p|div|li|h[1-6])[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
function mdSection(label: string, raw: string | null | undefined): string {
  const v = (raw ?? "").trim();
  if (!v) return "";
  const text = /<[a-z][\s\S]*>/i.test(v) ? stripHtml(v) : v;
  if (!text.trim()) return "";
  return `**${label}**\n\n${text.trim()}\n\n`;
}
function safeSlug(s: string, fallback: string): string {
  const cleaned = (s || "").normalize("NFKC").replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, "-").trim();
  return cleaned || fallback;
}
function buildMentorMarkdown(opts: {
  mentorName: string;
  slug: string;
  assetLabel: string;
  currency: string;
  weekStart: string;
  weekEnd: string;
  rows: any[];
}): string {
  const { mentorName, slug, assetLabel, currency, weekStart, weekEnd, rows } = opts;
  const lines: string[] = [];
  lines.push(`# ${mentorName} 週記`);
  lines.push("");
  lines.push(`- 週別：${weekStart} ~ ${weekEnd}`);
  lines.push(`- Slug：\`${slug}\``);
  lines.push(`- 資產類別：${assetLabel || "-"}`);
  lines.push(`- 幣別：${currency || "-"}`);
  lines.push(`- 則數：${rows.length}`);
  lines.push("");
  lines.push("---");
  lines.push("");

  rows.forEach((r, idx) => {
    const time = fmtTaipei(r.published_at || r.created_at);
    const title = r.reason_summary
      ? stripHtml(String(r.reason_summary)).slice(0, 80)
      : (r.instrument || "教學筆記");
    lines.push(`## ${idx + 1}. ${title}`);
    lines.push("");
    const meta: string[] = [];
    if (time) meta.push(`時間：${time}`);
    if (r.status) meta.push(`狀態：${r.status}`);
    if (r.instrument) meta.push(`標的：${r.instrument}`);
    if (r.action) meta.push(`動作：${r.action}`);
    if (r.price_hint !== null && r.price_hint !== undefined && r.price_hint !== "") {
      meta.push(`參考價：${r.price_hint}`);
    }
    if (r.quantity !== null && r.quantity !== undefined && r.quantity !== "" && Number(r.quantity) !== 0) {
      const unit = String(r.quantity_unit ?? "").trim() || "股";
      const verb = r.action === "sell" ? "賣出" : r.action === "buy" ? "買進" : "數量";
      meta.push(`${verb}股數：${r.quantity} ${unit}`);
    }
    if (meta.length) {
      lines.push(meta.map((m) => `- ${m}`).join("\n"));
      lines.push("");
    }
    lines.push(mdSection("重點摘要", r.reason_summary));
    lines.push(mdSection("詳細分析", r.reason_detail));
    lines.push(mdSection("風險提醒", r.risk_notes));
    lines.push(mdSection("學習重點", r.learning_points));
    lines.push(`> 訊號 ID：\`${r.id}\``);
    lines.push("");
    lines.push("---");
    lines.push("");
  });

  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    let weekStart: string | null = null;
    try {
      if (req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        if (body?.weekStart && /^\d{4}-\d{2}-\d{2}$/.test(body.weekStart)) {
          weekStart = taipeiMondayOf(new Date(`${body.weekStart}T12:00:00+08:00`));
        }
      }
    } catch { /* ignore */ }
    if (!weekStart) weekStart = taipeiMondayOf(new Date());
    const range = weekRangeUtc(weekStart);

    console.log(`[weekly-journal-export] week=${weekStart} (${range.startIso} ~ ${range.endIso})`);

    // 1. 查詢當週已發布週記
    const { data: rows, error: qErr } = await supabase
      .from("expert_signals")
      .select(
        "id, status, instrument, action, price_hint, quantity, quantity_unit, reason_summary, reason_detail, risk_notes, learning_points, published_at, created_at, expert_id, experts!inner(name, slug, role, asset_class, currency)",
      )
      .eq("status", "published")
      .eq("experts.role", "mentor")
      .gte("published_at", range.startIso)
      .lt("published_at", range.endIso)
      .order("expert_id", { ascending: true })
      .order("published_at", { ascending: true });

    if (qErr) throw new Error(`query expert_signals failed: ${qErr.message}`);
    const list = (rows ?? []) as any[];

    // 2. 依老師分組
    const byMentor = new Map<string, { name: string; slug: string; asset: string; currency: string; rows: any[] }>();
    for (const r of list) {
      const key = r.expert_id;
      const g = byMentor.get(key) ?? {
        name: r.experts?.name ?? "(未命名)",
        slug: r.experts?.slug ?? key,
        asset: ASSET_LABEL[r.experts?.asset_class ?? ""] ?? (r.experts?.asset_class ?? ""),
        currency: r.experts?.currency ?? "",
        rows: [],
      };
      g.rows.push(r);
      byMentor.set(key, g);
    }

    console.log(`[weekly-journal-export] found ${list.length} rows, ${byMentor.size} mentors`);

    // 3. 每位老師產一份 Markdown 上傳
    const uploaded: { path: string; mentor: string; slug: string; rows: number }[] = [];
    for (const [mentorId, g] of byMentor) {
      const md = buildMentorMarkdown({
        mentorName: g.name,
        slug: g.slug,
        assetLabel: g.asset,
        currency: g.currency,
        weekStart: range.startLabel,
        weekEnd: range.endLabel,
        rows: g.rows,
      });
      const filename = `${safeSlug(g.slug, mentorId)}.md`;
      const path = `${range.startLabel}/${filename}`;
      const { error: upErr } = await supabase.storage
        .from("journal-exports")
        .upload(path, new Blob([md], { type: "text/markdown;charset=utf-8" }), {
          contentType: "text/markdown;charset=utf-8",
          upsert: true,
        });
      if (upErr) {
        console.error(`upload failed for ${mentorId}: ${upErr.message}`);
        continue;
      }
      uploaded.push({ path, mentor: g.name, slug: g.slug, rows: g.rows.length });
    }

    // 4. 通知 company_admin（一律連到歷史列表，讓管理員自行下載各老師檔案）
    const { data: admins, error: adminErr } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "company_admin");
    if (adminErr) throw new Error(`fetch admins failed: ${adminErr.message}`);

    const adminIds = (admins ?? []).map((a: any) => a.user_id);
    const title = list.length > 0
      ? `週記匯出完成：${range.startLabel} 週共 ${list.length} 則 / ${uploaded.length} 位老師（Markdown）`
      : `週記匯出：${range.startLabel} 週目前無任何已發布週記`;
    const bodyText = list.length > 0
      ? `已為 ${uploaded.length} 位老師各產出一份 Markdown 檔，請至「週記匯出」頁面下載。`
      : `本週尚無 mentor 發布週記，未產生任何檔案。`;

    if (adminIds.length > 0) {
      const notifRows = adminIds.map((uid: string) => ({
        user_id: uid,
        title,
        body: bodyText,
        type: "journal_export",
        link: "/company/journals-export",
      }));
      const { error: notifErr } = await supabase.from("notifications").insert(notifRows);
      if (notifErr) console.error(`insert notifications failed: ${notifErr.message}`);
    }

    // 5. 清理超過 30 天的舊檔
    let deletedCount = 0;
    try {
      const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const { data: folders } = await supabase.storage.from("journal-exports").list("", { limit: 1000 });
      const toDelete: string[] = [];
      for (const folder of folders ?? []) {
        if (!folder.name) continue;
        const folderDate = new Date(`${folder.name}T00:00:00+08:00`).getTime();
        if (Number.isFinite(folderDate) && folderDate < cutoff) {
          const { data: files } = await supabase.storage.from("journal-exports").list(folder.name, { limit: 200 });
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
      format: "markdown",
      weekStart: range.startLabel,
      weekEnd: range.endLabel,
      journals: list.length,
      mentors: uploaded.length,
      admins_notified: adminIds.length,
      files: uploaded,
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
