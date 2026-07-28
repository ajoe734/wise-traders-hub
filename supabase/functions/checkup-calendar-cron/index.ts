// AUTH: cron  (auto-annotated 2026-07-27, see docs/security/edge-function-auth-matrix.md)
// deno-lint-ignore-file
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { requireCronKey, AuthError } from '../_shared/authGuard.ts';
import { jsonResponse } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabaseClients.ts";
import { withLogging } from "../_shared/edgeLogger.ts";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const GATEWAY_MODELS = ["google/gemini-2.5-flash", "google/gemini-2.0-flash"];

function decodeHtml(value: string) {
  return String(value || "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
function pickTag(block: string, tag: string) {
  const match = block.match(new RegExp(`<${tag}(?:[^>]*)>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return decodeHtml(match?.[1] || "");
}

async function fetchNewsForStocks(stocksStr: string): Promise<string> {
  const items = stocksStr.split(/[、,]/).map((s) => s.trim()).filter(Boolean).slice(0, 10);
  const allNews: string[] = [];
  for (const item of items) {
    const code = item.match(/^(\d{4,6})/)?.[1] || "";
    const name = item.replace(/^\d+\s*/, "").trim();
    const q = `${code} ${name} 台股 法說 財報 除息 營收`;
    try {
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "portfolio-dashboard/1.0" } });
      clearTimeout(timer);
      const xml = await res.text();
      const rssItems = Array.from(xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)).map((m) => m[0]).slice(0, 3);
      for (const ri of rssItems) allNews.push(`- ${pickTag(ri, "title")} (${pickTag(ri, "source")})`);
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  return allNews.length > 0 ? allNews.join("\n") : "（無即時新聞）";
}

async function callAI(system: string, user: string, maxTokens = 8192): Promise<{ ok: boolean; text: string }> {
  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  const geminiKey = Deno.env.get("GOOGLE_GEMINI_API_KEY");
  const messages = [
    ...(system ? [{ role: "system", content: system }] : []),
    { role: "user", content: user },
  ];

  if (lovableKey) {
    for (const model of GATEWAY_MODELS) {
      try {
        const response = await fetch(GATEWAY_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${lovableKey}` },
          body: JSON.stringify({ model, messages, temperature: 0.3, max_tokens: maxTokens }),
        });
        if (response.status === 429) { console.log(`Gateway ${model} 429`); continue; }
        if (!response.ok) { console.error(`Gateway ${model} failed (${response.status})`); continue; }
        const data = await response.json();
        const text = data.choices?.[0]?.message?.content?.trim();
        if (text) return { ok: true, text };
      } catch (err) { console.error(`Gateway ${model} error:`, err); }
    }
  }

  if (geminiKey) {
    for (const model of ["gemini-2.5-flash", "gemini-2.0-flash"]) {
      try {
        const body: any = {
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: maxTokens },
        };
        if (system) body.systemInstruction = { parts: [{ text: system }] };
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
        );
        if (response.status === 429) continue;
        if (!response.ok) continue;
        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.map((p: any) => p.text || "").join("").trim();
        if (text) return { ok: true, text };
      } catch {}
    }
  }

  return { ok: false, text: "" };
}

function extractJsonArray(text: string): string | null {
  const start = text.indexOf("[");
  if (start === -1) return null;
  let depth = 0, inString = false, escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\" && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "[") depth++;
    else if (ch === "]") { depth--; if (depth === 0) return text.substring(start, i + 1); }
  }
  return null;
}

function tryParseEvents(text: string): any[] | null {
  try { const p = JSON.parse(text); if (Array.isArray(p) && p.length > 0) return p; } catch {}
  const cleaned = text.replace(/```(?:json)?\s*/g, "").replace(/```\s*/g, "");
  const jsonStr = extractJsonArray(cleaned);
  if (jsonStr) { try { const p = JSON.parse(jsonStr); if (Array.isArray(p) && p.length > 0) return p; } catch {} }
  return null;
}

function classifyHoldings(stocks: string): { stockList: string; warrantList: string; parentStocks: string[] } {
  const items = stocks.split(/[、,]/).map((s) => s.trim()).filter(Boolean);
  const stockItems: string[] = [], warrantItems: string[] = [], parentStocks: string[] = [];
  for (const item of items) {
    const code = item.match(/^(\d+)/)?.[1] || "";
    const name = item.replace(/^\d+\s*/, "");
    const isWarrant = code.length === 6 || /[購售牛熊]/.test(name);
    if (isWarrant) {
      warrantItems.push(item);
      const brokerMatch = name.match(/^(.+?)(凱基|元大|富邦|群益|統一|國票|永豐|中信|日盛|兆豐|台新|玉山|永昌)/);
      if (brokerMatch?.[1]) parentStocks.push(brokerMatch[1]);
    } else stockItems.push(item);
  }
  return { stockList: stockItems.join("、"), warrantList: warrantItems.join("、"), parentStocks: [...new Set(parentStocks)] };
}

const handler = withLogging("checkup-calendar-cron", async (req, log) => {
  // AUTH: cron (Phase M-2 runtime enforcement)
  if (req.method !== 'OPTIONS') {
    try { requireCronKey(req); }
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

  const supabase = serviceClient();
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  if (!Deno.env.get("LOVABLE_API_KEY") && !Deno.env.get("GOOGLE_GEMINI_API_KEY")) {
    log.info("skipped_no_api_key");
    return jsonResponse({ status: "skipped", reason: "no API key" });
  }

  const { data: allHoldings } = await supabase.from("checkup_storage")
    .select("user_id, data").eq("key", "pf-calendar-holdings");

  const usersWithHoldings = (allHoldings || []).filter((r: any) => r.data?.stocks && r.user_id !== "00000000-0000-0000-0000-000000000000");
  if (usersWithHoldings.length === 0) return jsonResponse({ status: "skipped", reason: "no users" });

  let totalAdded = 0, totalPredicted = 0;

  for (const holdingsRow of usersWithHoldings) {
    const userId = holdingsRow.user_id;
    const stocks = holdingsRow.data.stocks;
    const holdingCodes = holdingsRow.data.holdingCodes || "";

    const { data: calRow } = await supabase.from("checkup_storage")
      .select("data").eq("user_id", userId).eq("key", "pf-calendar-v1").maybeSingle();
    const existingEvents: any[] = calRow?.data?.events || [];

    const today = new Date().toLocaleDateString("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit" }).replace(/\//g, "/");
    const oneYearLater = new Date();
    oneYearLater.setFullYear(oneYearLater.getFullYear() + 1);
    const endDate = oneYearLater.toLocaleDateString("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit" }).replace(/\//g, "/");

    const stocksStr = typeof stocks === "string" ? stocks : stocks.map((s: any) => `${s.code} ${s.name}`).join("、");
    const newsContext = await fetchNewsForStocks(stocksStr);

    const { stockList, warrantList, parentStocks } = classifyHoldings(stocksStr);
    let holdingsSection = "";
    if (stockList) holdingsSection += `## 股票持倉\n${stockList}\n\n`;
    if (warrantList) holdingsSection += `## 權證持倉（僅需列出「到期日」事件）\n${warrantList}\n\n`;
    if (parentStocks.length > 0) holdingsSection += `## 權證母股\n${parentStocks.join("、")}\n\n`;

    const outputFormat = `JSON陣列，每個元素格式：
{"date":"日期","label":"事件標題含代碼","sub":"簡要說明","urgent":boolean,"type":"法說/財報/營收/催化/操作/總經/除息/權證","sources":[]}

規則：date 精確日期用 YYYY/MM/DD；模糊用「2025/07月」；urgent=true 僅未來一週內；按日期排序`;

    const systemPrompt = `你是頂級 AI 財經分析師，精通台股市場。根據即時新聞和知識整理事件行事曆。
營收公布日（每月10日前）和財報公布截止日是固定規律，必須列出。只輸出 JSON 陣列。`;

    const userPrompt = `# 即時新聞（Google News RSS）
${newsContext}

# Task
針對以下持倉，找出「${today} 隔天起到 ${endDate}」的重要事件。

${holdingsSection}

# 事件類別（8 大類）
營收、財報、法說、除息、總經、催化、權證、操作

# 嚴格限制
- 只能針對上方持倉標的
- 不要包含今天或過去事件
- 即使日期不精確也要列出

# Output Format
${outputFormat}

只輸出 JSON 陣列。`;

    const result = await callAI(systemPrompt, userPrompt, 8192);
    if (!result.ok) { log.error("ai_failed", { userId }); continue; }

    const newEvents = tryParseEvents(result.text);
    if (!newEvents) { log.error("parse_failed", { userId }); continue; }

    const seen = new Set(existingEvents.map((e: any) => `${e.label}||${e.date}`));
    const merged = [...existingEvents];
    let addedCount = 0;
    for (const ne of newEvents) {
      if (!ne?.label) continue;
      const key = `${ne.label}||${ne.date}`;
      if (!seen.has(key)) { merged.push(ne); seen.add(key); addedCount++; }
    }
    merged.sort((a: any, b: any) => (a.date || "").localeCompare(b.date || ""));

    await supabase.from("checkup_storage").upsert({
      user_id: userId, key: "pf-calendar-v1",
      data: { events: merged, holdingCodes },
    }, { onConflict: "user_id,key" });

    log.info("calendar_done", { userId, existing: existingEvents.length, added: addedCount, total: merged.length });
    totalAdded += addedCount;

    let predictedCount = 0;
    try {
      const now = new Date(); now.setHours(0, 0, 0, 0);
      const sevenDaysLater = new Date(now); sevenDaysLater.setDate(sevenDaysLater.getDate() + 7);

      const { data: newsRow } = await supabase.from("checkup_storage")
        .select("data").eq("user_id", userId).eq("key", "pf-news-events-v1").maybeSingle();
      const newsEvents: any[] = newsRow?.data || [];

      const needsPrediction = newsEvents.filter((e: any) => {
        if (e.status !== "pending") return false;
        if (!e.date?.match(/^\d{4}\/\d{2}\/\d{2}/)) return false;
        const evDate = new Date(e.date.replace(/\//g, "-")); evDate.setHours(0, 0, 0, 0);
        return evDate >= now && evDate <= sevenDaysLater;
      });

      if (needsPrediction.length > 0) {
        const predictRes = await fetch(`${supabaseUrl}/functions/v1/checkup-predict-events`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceKey}` },
          body: JSON.stringify({
            events: needsPrediction.map((e: any, i: number) => ({
              index: i + 1, date: e.date, title: e.title || e.label,
              detail: e.detail || e.sub || "", stocks: e.stocks || [],
            })),
            holdings: typeof stocks === "string" ? [] : stocks.map((s: any) => ({
              code: s.code, name: s.name, costPrice: s.costPrice, marketPrice: s.marketPrice,
            })),
          }),
        });
        if (predictRes.ok) {
          const predData = await predictRes.json();
          const preds = predData.predictions || [];
          const updatedNews = [...newsEvents];
          needsPrediction.forEach((e: any, i: number) => {
            const idx = updatedNews.findIndex((x: any) => x.id === e.id);
            if (idx < 0) return;
            const p = preds.find((pp: any) => pp.index === i + 1);
            updatedNews[idx] = { ...updatedNews[idx], status: "verifying",
              pred: p?.pred || "neutral", predReason: p?.predReason || "AI 自動預測（Cron）" };
            predictedCount++;
          });
          await supabase.from("checkup_storage").upsert({
            user_id: userId, key: "pf-news-events-v1", data: updatedNews,
          }, { onConflict: "user_id,key" });
        }
      }
    } catch (predErr) { log.error("prediction_error", { message: (predErr as Error).message }); }
    totalPredicted += predictedCount;
  }

  return jsonResponse({ status: "ok", usersProcessed: usersWithHoldings.length, totalAdded, totalPredicted });
});

Deno.serve(handler);
