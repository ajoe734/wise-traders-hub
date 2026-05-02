// Calendar/event merge utilities. Pure functions, no React.
// stableId format must match server-side makeStableId in
// supabase/functions/checkup-calendar/index.ts so prediction-cache and
// upsert merging stay aligned across refreshes.

export function computeCalendarStableId(label, date, type) {
  const code = String(label || "").match(/\d{4,6}/)?.[0] || "na";
  const t = String(type || "event").replace(/[^\w\u4e00-\u9fa5]/g, "");
  const d = String(date || "").trim();
  let dn = "tba";
  const ymd = d.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  const ym = d.match(/(\d{4})\/(\d{1,2})月/);
  const yq = d.match(/(\d{4})\s*Q([1-4])/i);
  if (ymd) dn = `${ymd[1]}${ymd[2].padStart(2, "0")}${ymd[3].padStart(2, "0")}`;
  else if (ym) dn = `${ym[1]}${ym[2].padStart(2, "0")}MM`;
  else if (yq) dn = `${yq[1]}Q${yq[2]}`;
  return `cal-${code}-${t}-${dn}`;
}

/**
 * Dedupe & sort raw calendar events from edge function vs existing local cache.
 * Returns merged array with `_holdingCodes` annotation.
 */
export function mergeCalendarEvents(existingEvents, newEvents, holdingCodes) {
  const existing = Array.isArray(existingEvents) ? existingEvents : [];
  const seen = new Set(existing.map(e => `${e.label}||${e.date}`));
  const merged = [...existing];
  for (const ne of newEvents || []) {
    if (!ne || !ne.label) continue;
    const key = `${ne.label}||${ne.date}`;
    if (!seen.has(key)) { merged.push(ne); seen.add(key); }
  }
  merged.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  if (holdingCodes !== undefined) merged._holdingCodes = holdingCodes;
  return merged;
}

/**
 * Merge calendar events into news/event-analysis list.
 * - Preserves user-edited fields (status, actual, lessons, pred when reviewed)
 * - Drops stale calendar events that AI no longer lists AND are still pending
 * - Manual events untouched
 */
export function mergeCalendarToNewsEvents(prevNewsEvents, calEvents) {
  if (!Array.isArray(calEvents)) return prevNewsEvents || [];

  const existing = prevNewsEvents || [];
  const calendarMap = new Map();
  const manual = [];
  for (const e of existing) {
    if (e.source === "calendar") {
      const key = e.stableId || computeCalendarStableId(e.title, e.date, e.type);
      calendarMap.set(key, { ...e, stableId: key });
    } else {
      manual.push(e);
    }
  }

  const incomingKeys = new Set();
  const merged = [];

  for (const ce of calEvents) {
    if (!ce || !ce.label) continue;
    const key = ce.stableId || computeCalendarStableId(ce.label, ce.date, ce.type);
    if (incomingKeys.has(key)) continue;
    incomingKeys.add(key);

    const codeMatch = String(ce.label).match(/\d{4,6}/);
    const aiPart = {
      date: ce.date || "",
      title: ce.label,
      detail: ce.sub || "",
      stocks: codeMatch
        ? [{ code: codeMatch[0], name: String(ce.label).replace(/\d{4,6}/, "").replace(/[—\-\s]+/g, " ").trim() }]
        : [],
      type: ce.type || "",
    };

    const prior = calendarMap.get(key);
    if (prior) {
      const userReviewed = prior.actual != null || (prior.lessons && String(prior.lessons).trim() !== "");
      merged.push({
        ...prior,
        ...aiPart,
        status: prior.status || "pending",
        pred: userReviewed ? prior.pred : (ce.pred || prior.pred || "neutral"),
        predReason: userReviewed ? prior.predReason : (ce.predReason || prior.predReason || ""),
        stableId: key,
        source: "calendar",
      });
    } else {
      merged.push({
        id: key,
        stableId: key,
        ...aiPart,
        pred: ce.pred || "neutral",
        predReason: ce.predReason || "",
        status: "pending",
        actual: null,
        actualNote: "",
        correct: null,
        source: "calendar",
      });
    }
  }

  // Keep prior calendar events AI no longer lists, except still-pending ones
  for (const [key, prior] of calendarMap) {
    if (incomingKeys.has(key)) continue;
    if (prior.status === "pending") continue;
    merged.push(prior);
  }

  return [...manual, ...merged];
}
