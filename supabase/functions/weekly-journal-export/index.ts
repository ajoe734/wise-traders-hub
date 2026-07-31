// AUTH: user  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
// Weekly journal export — 每週五 23:30 Asia/Taipei 自動執行
// 抓當週 (Mon 00:00 ~ next Mon 00:00) 所有 mentor 已發布週記
// → 每位老師產出獨立 Markdown 檔（<週別>/<slug>.md）
// → 上傳到 storage bucket "journal-exports"
// → 為所有 company_admin 建立站內通知（連到 /company/journals-export 歷史列表）
// → 清理超過 30 天的舊檔
//
// 觸發：pg_cron（詳見同批 SQL）。也可帶 body { weekStart: "YYYY-MM-DD" } 手動補跑。

import { serviceClient } from '../_shared/supabaseClients.ts';
import { listCompanyAdminIds } from "../_shared/adminGuard.ts";
import { requireCaller, AuthError } from '../_shared/authGuard.ts';
import { taipeiMondayOf, taipeiWeekRangeUtc } from "../_shared/weekBoundary.ts";
import {
  buildMentorMarkdown,
  detectExportRisks,
  normalizeQuantityUnit,
  safeSlug,
  toShares,
  BUY_ACTIONS,
  SELL_ACTIONS,
  type JournalRowExport,
} from "../_shared/journalExportCore.ts";

import { corsHeaders } from '../_shared/cors.ts';
import { forExport } from "../_shared/journalRepository.ts";
import { buildJournalExportNotification } from "../_shared/notificationTemplates.ts";

const MS_DAY = 86_400_000;

function weekRangeUtc(weekStart: string) {
  const { startIso, endIso } = taipeiWeekRangeUtc(weekStart);
  return {
    startIso,
    endIso,
    startLabel: weekStart,
    endLabel: new Date(new Date(endIso).getTime() - MS_DAY).toISOString().slice(0, 10),
  };
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
    const u = normalizeQuantityUnit(t.quantity_unit);
    const sh = toShares(qty, u);
    if (!Number.isFinite(sh)) continue;
    const action = String(t.action ?? "").toLowerCase();
    const cur = map.get(key) ?? 0;
    if (BUY_ACTIONS.has(action)) map.set(key, cur + sh);
    else if (SELL_ACTIONS.has(action)) map.set(key, cur - sh);
  }
  return map;
}

Deno.serve(async (req) => {
  // AUTH: user (Phase M-2 runtime enforcement)
  if (req.method !== 'OPTIONS') {
    try { await requireCaller(req); }
    catch (e) {
      if (e instanceof AuthError) {
        return new Response(JSON.stringify({ error: e.message, code: e.code }), {
          status: e.status,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
      throw e;
    }
  }

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = serviceClient();

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
    const { rows, error: qErr } = await forExport(supabase, {
      startIso: range.startIso,
      endIso: range.endIso,
      publishedOnly: true,
    });

    if (qErr) throw new Error(`query expert_signals failed: ${qErr}`);
    const list = (rows ?? []) as any[];

    // 1b. 風險守門（server-side backstop）
    let riskReport: ReturnType<typeof detectExportRisks> | null = null;
    if (list.length > 0) {
      const openings = await loadOpeningBalances(supabase, list, range.startIso);
      riskReport = detectExportRisks(list, { openingBalances: openings, publishedOnly: true });
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

    // 2. 依老師分組（規則與前台共用 core）
    const byMentor = new Map<string, JournalRowExport[]>();
    for (const r of list as JournalRowExport[]) {
      const arr = byMentor.get(r.expert_id) ?? [];
      arr.push(r);
      byMentor.set(r.expert_id, arr);
    }

    console.log(`[weekly-journal-export] found ${list.length} rows, ${byMentor.size} mentors`);

    // 3. 每位老師產一份 Markdown 上傳（與後台頁面下載的檔案逐字相同）
    const uploaded: { path: string; mentor: string; slug: string; rows: number }[] = [];
    for (const [mentorId, mentorRows] of byMentor) {
      const md = buildMentorMarkdown(mentorRows, { startLabel: range.startLabel, endLabel: range.endLabel });
      const mentorName = mentorRows[0].experts?.name ?? "(未命名)";
      const rawSlug = mentorRows[0].experts?.slug ?? mentorId;
      const filename = `${safeSlug(rawSlug, mentorId)}.md`;
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
      uploaded.push({ path, mentor: mentorName, slug: rawSlug, rows: mentorRows.length });
    }

    // 4. 通知 company_admin（一律連到歷史列表，讓管理員自行下載各老師檔案）
    const adminIds = await listCompanyAdminIds();

    if (adminIds.length > 0) {
      const notifRows = adminIds.map((uid: string) => buildJournalExportNotification({
        userId: uid,
        weekLabel: range.startLabel,
        journalCount: list.length,
        mentorCount: uploaded.length,
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
