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
  tw_future: "台指期",
  tw_option: "台指選",
  us_future: "美期",
  us_option: "美選",
  crypto: "加密",
};

// 由 asset_class 決定合法單位；quantity_unit 缺值或不合法時，回退到該資產類別預設。
// 絕不因缺值退回硬編「股」或「張」。
const UNIT_ALLOWED: Record<string, string[]> = {
  tw_stock: ["張", "股"],
  us_stock: ["股"],
  tw_future: ["口"],
  tw_option: ["口"],
  us_future: ["口"],
  us_option: ["口"],
  crypto: ["顆"],
};
const UNIT_DEFAULT: Record<string, string> = {
  tw_stock: "張",
  us_stock: "股",
  tw_future: "口",
  tw_option: "口",
  us_future: "口",
  us_option: "口",
  crypto: "顆",
};
function resolveDisplayUnit(row: any): string {
  const cls = String(row?.experts?.asset_class ?? "").trim();
  const raw = String(row?.quantity_unit ?? "").trim();
  const allowed = UNIT_ALLOWED[cls];
  if (allowed) {
    if (raw && allowed.includes(raw)) return raw;
    return UNIT_DEFAULT[cls];
  }
  // 未知 asset_class：不硬編「股」，若原始值可用就用原始值，否則以 currency=USD 推 us_stock。
  if (raw) return raw;
  const currency = String(row?.experts?.currency ?? "").toUpperCase();
  if (currency === "USD") return "股";
  return "張";
}

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

  const buyTotals = new Map<string, number>();
  const sellTotals = new Map<string, number>();
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
      const unit = resolveDisplayUnit(r);
      const verb = r.action === "sell" ? "賣出" : r.action === "buy" ? "買進" : "數量";
      meta.push(`${verb}數量：${r.quantity} ${unit}`);
      const qty = Number(r.quantity);
      if (r.action === "buy") buyTotals.set(unit, (buyTotals.get(unit) ?? 0) + qty);
      else if (r.action === "sell") sellTotals.set(unit, (sellTotals.get(unit) ?? 0) + qty);
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
  const pushTotals = (label: string, m: Map<string, number>) => {
    if (m.size === 0) {
      lines.push(`- ${label}：0 股`);
      return;
    }
    if (m.size === 1) {
      const [unit, n] = Array.from(m.entries())[0];
      lines.push(`- ${label}：${n} ${unit}`);
      return;
    }
    const entries = Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
    lines.push(`- ${label}（依單位分列）：`);
    for (const [unit, n] of entries) {
      lines.push(`  - ${unit}：${n} ${unit}`);
    }
  };
  lines.push("## 本週總計");
  lines.push("");
  pushTotals("總買進股數", buyTotals);
  pushTotals("總賣出股數", sellTotals);
  lines.push("");

  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

// ── Export risk gate (server-side backstop) ─────────────
// 保持與 src/lib/journalsExport.ts detectExportRisks 邏輯一致。
const BUY_ACTIONS = new Set(["buy", "add"]);
const SELL_ACTIONS = new Set(["sell", "trim", "exit"]);
const TRADE_ACTIONS = new Set([...BUY_ACTIONS, ...SELL_ACTIONS]);

function normalizeUnit(u: any): "lot" | "share" | "contract" | "other" | "missing" {
  const raw = String(u ?? "").trim();
  if (!raw) return "missing";
  const s = raw.toLowerCase();
  if (raw === "張" || s === "lot" || s === "lots") return "lot";
  if (raw === "股" || s === "share" || s === "shares") return "share";
  if (raw === "口" || s === "contract" || s === "contracts") return "contract";
  return "other";
}
function toSharesSrv(qty: number, u: ReturnType<typeof normalizeUnit>): number {
  if (u === "lot") return qty * 1000;
  if (u === "share" || u === "missing") return qty;
  return NaN;
}

interface RiskIssue {
  code: string;
  severity: "block" | "warn";
  expert_id: string;
  expert_name: string | null;
  instrument: string | null;
  detail: string;
  rowIds: string[];
}

function detectRisks(rows: any[], openingBalances: Map<string, number>) {
  const issues: RiskIssue[] = [];
  const byKey = new Map<string, { rows: any[]; expertId: string; expertName: string | null; instrument: string | null }>();
  for (const r of rows) {
    const key = `${r.expert_id}::${r.instrument ?? ""}`;
    const g = byKey.get(key) ?? {
      rows: [],
      expertId: r.expert_id,
      expertName: r.experts?.name ?? null,
      instrument: r.instrument,
    };
    g.rows.push(r);
    byKey.set(key, g);
  }
  for (const [key, bucket] of byKey) {
    const { rows: bRows, expertId, expertName, instrument } = bucket;

    // QTY_INVALID
    const invalid = bRows.filter((r) => {
      if (!TRADE_ACTIONS.has(String(r.action ?? "").toLowerCase())) return false;
      if (r.quantity === null || r.quantity === undefined) return false;
      const n = Number(r.quantity);
      return !Number.isFinite(n) || n <= 0;
    });
    if (invalid.length > 0) {
      issues.push({
        code: "QTY_INVALID", severity: "block",
        expert_id: expertId, expert_name: expertName, instrument,
        detail: `${invalid.length} 筆交易訊號的數量為 0 或無效數字`,
        rowIds: invalid.map((r) => r.id),
      });
    }

    // UNIT_MIX
    const unitBuckets = new Map<string, any[]>();
    const missingUnitRows: any[] = [];
    for (const r of bRows) {
      if (r.quantity === null || r.quantity === undefined) continue;
      if (!TRADE_ACTIONS.has(String(r.action ?? "").toLowerCase())) continue;
      const u = normalizeUnit(r.quantity_unit);
      if (u === "missing") missingUnitRows.push(r);
      const list = unitBuckets.get(u) ?? [];
      list.push(r);
      unitBuckets.set(u, list);
    }
    const lotN = unitBuckets.get("lot")?.length ?? 0;
    const shareN = unitBuckets.get("share")?.length ?? 0;
    if (lotN > 0 && shareN > 0) {
      const related = [...(unitBuckets.get("lot") ?? []), ...(unitBuckets.get("share") ?? [])];
      issues.push({
        code: "UNIT_MIX", severity: "block",
        expert_id: expertId, expert_name: expertName, instrument,
        detail: `同一標的同時使用「張」與「股」（張 ${lotN} 筆、股 ${shareN} 筆）`,
        rowIds: related.map((r) => r.id),
      });
    }
    if (missingUnitRows.length > 0) {
      const asset = missingUnitRows[0].experts?.asset_class ?? "";
      if (asset === "tw_stock" || asset === "us_stock") {
        issues.push({
          code: "UNIT_MISSING", severity: "warn",
          expert_id: expertId, expert_name: expertName, instrument,
          detail: `${missingUnitRows.length} 筆訊號未填寫單位（預設為「股」，建議補齊）`,
          rowIds: missingUnitRows.map((r) => r.id),
        });
      }
    }

    // 方向
    let buyShares = 0, sellShares = 0;
    let hasEntry = false, hasExit = false;
    const buyIds: string[] = [], sellIds: string[] = [];
    for (const r of bRows) {
      const action = String(r.action ?? "").toLowerCase();
      if (!TRADE_ACTIONS.has(action)) continue;
      if (r.quantity === null || r.quantity === undefined) continue;
      const qty = Number(r.quantity);
      if (!Number.isFinite(qty) || qty <= 0) continue;
      const u = normalizeUnit(r.quantity_unit);
      const sh = toSharesSrv(qty, u);
      if (!Number.isFinite(sh)) continue;
      if (BUY_ACTIONS.has(action)) { buyShares += sh; hasEntry = true; buyIds.push(r.id); }
      else if (SELL_ACTIONS.has(action)) { sellShares += sh; hasExit = true; sellIds.push(r.id); }
    }
    const opening = openingBalances.get(key) ?? 0;
    if (hasExit && !hasEntry && opening <= 0) {
      issues.push({
        code: "DIRECTION_NO_ENTRY", severity: "block",
        expert_id: expertId, expert_name: expertName, instrument,
        detail: "本週只有賣出/減碼/出場，且 trade_records 查無期初持倉",
        rowIds: sellIds,
      });
    }
    if (sellShares > buyShares + opening) {
      issues.push({
        code: "DIRECTION_OVERSELL", severity: "block",
        expert_id: expertId, expert_name: expertName, instrument,
        detail: `賣出/減碼合計 ${sellShares} 股 > 買進/加碼 ${buyShares} 股 + 期初 ${opening} 股`,
        rowIds: [...sellIds, ...buyIds],
      });
    }
  }
  const block = issues.filter((i) => i.severity === "block").length;
  const warn = issues.filter((i) => i.severity === "warn").length;
  return { issues, blocked: block > 0, summary: { block, warn } };
}

async function loadOpeningBalances(supabase: any, rows: any[], startIso: string): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const pairs = new Map<string, { expert_id: string; instrument: string }>();
  for (const r of rows) {
    if (!r.instrument) continue;
    const key = `${r.expert_id}::${r.instrument}`;
    if (!pairs.has(key)) pairs.set(key, { expert_id: r.expert_id, instrument: r.instrument });
  }
  if (pairs.size === 0) return map;
  const expertIds = [...new Set([...pairs.values()].map((p) => p.expert_id))];
  const { data, error } = await supabase
    .from("trade_records")
    .select("expert_id, instrument, action, quantity, quantity_unit, occurred_at")
    .in("expert_id", expertIds)
    .lt("occurred_at", startIso);
  if (error) {
    console.warn(`[weekly-journal-export] loadOpeningBalances failed: ${error.message}`);
    return map;
  }
  for (const t of (data ?? []) as any[]) {
    const key = `${t.expert_id}::${t.instrument}`;
    if (!pairs.has(key)) continue;
    const qty = Number(t.quantity);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const u = normalizeUnit(t.quantity_unit);
    const sh = toSharesSrv(qty, u);
    if (!Number.isFinite(sh)) continue;
    const action = String(t.action ?? "").toLowerCase();
    const cur = map.get(key) ?? 0;
    if (BUY_ACTIONS.has(action)) map.set(key, cur + sh);
    else if (SELL_ACTIONS.has(action)) map.set(key, cur - sh);
  }
  return map;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    let weekStart: string | null = null;
    let force = false;
    try {
      if (req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        if (body?.weekStart && /^\d{4}-\d{2}-\d{2}$/.test(body.weekStart)) {
          weekStart = taipeiMondayOf(new Date(`${body.weekStart}T12:00:00+08:00`));
        }
        if (body?.force === true) force = true;
      }
    } catch { /* ignore */ }
    if (!weekStart) weekStart = taipeiMondayOf(new Date());
    const range = weekRangeUtc(weekStart);

    console.log(`[weekly-journal-export] week=${weekStart} (${range.startIso} ~ ${range.endIso}) force=${force}`);

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

    // 1b. 風險守門（server-side backstop）
    let riskReport: ReturnType<typeof detectRisks> | null = null;
    if (list.length > 0) {
      const openings = await loadOpeningBalances(supabase, list, range.startIso);
      riskReport = detectRisks(list, openings);
      if (riskReport.blocked && !force) {
        console.warn(`[weekly-journal-export] blocked: ${riskReport.summary.block} block / ${riskReport.summary.warn} warn`);
        return new Response(
          JSON.stringify({
            ok: false,
            code: "EXPORT_BLOCKED",
            error: `偵測到 ${riskReport.summary.block} 項高風險資料，已阻擋匯出。若確認可加上 { force: true } 重試。`,
            weekStart: range.startLabel,
            weekEnd: range.endLabel,
            risk_report: riskReport,
          }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

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
      forced: force,
      risk_report: riskReport,
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
