/**
 * Strategy Brain utilities
 *
 * This module handles strategy brain normalization, validation, and lifecycle management.
 */

import { parseFlexibleDate, daysSince, computeStaleness } from "./datetime.js";

// ── Rule text extraction ──────────────────────────────────────────────

export function brainRuleText(rule) {
  if (typeof rule === "string") return rule.trim();
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) return "";
  return String(rule.text || rule.rule || "").trim();
}

export function brainRuleKey(rule) {
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) return "";
  return String(rule.id || "").trim() || brainRuleText(rule);
}

// ── Staleness management ──────────────────────────────────────────────

export function normalizeBrainRuleStaleness(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ["fresh", "aging", "stale", "missing"].includes(normalized) ? normalized : "";
}

export function brainRuleStalenessLabel(value) {
  switch (normalizeBrainRuleStaleness(value)) {
    case "fresh": return "新鮮";
    case "aging": return "待更新";
    case "stale": return "陳舊";
    case "missing": return "未驗證";
    default: return "";
  }
}

export function brainRuleStalenessRank(value) {
  switch (normalizeBrainRuleStaleness(value)) {
    case "fresh": return 3;
    case "aging": return 2;
    case "stale": return 1;
    case "missing": default: return 0;
  }
}

export function deriveBrainRuleStaleness({ lastValidatedAt = null, evidenceRefs = [] } = {}, { now = new Date() } = {}) {
  const candidates = [
    lastValidatedAt,
    ...(Array.isArray(evidenceRefs) ? evidenceRefs.map(ref => ref?.date).filter(Boolean) : []),
  ]
    .map(item => ({ raw: item, parsed: parseFlexibleDate(item) }))
    .filter(item => item.parsed);

  if (candidates.length === 0) return "missing";
  
  candidates.sort((a, b) => b.parsed.getTime() - a.parsed.getTime());
  const latestDate = candidates[0].raw;
  
  const freshness = computeStaleness(latestDate, 30, { now });
  if (freshness === "fresh") return "fresh";
  
  const age = daysSince(latestDate, now);
  return age <= 90 ? "aging" : "stale";
}

// ── Validation score ──────────────────────────────────────────────────

export function deriveBrainRuleValidationScore({ 
  confidence = null, 
  evidenceCount = 0, 
  staleness = "", 
  status = "active" 
} = {}) {
  const hasConfidence = Number.isFinite(confidence);
  const hasEvidence = Number.isFinite(evidenceCount) && evidenceCount > 0;
  const normalizedStaleness = normalizeBrainRuleStaleness(staleness);
  
  if (!hasConfidence && !hasEvidence && !["fresh", "aging", "stale"].includes(normalizedStaleness)) {
    return null;
  }

  let score = hasConfidence ? Math.round((confidence / 10) * 55) : 25;
  score += hasEvidence ? Math.min(30, Math.round(evidenceCount) * 6) : 0;

  if (normalizedStaleness === "fresh") score += 15;
  if (normalizedStaleness === "aging") score += 7;
  if (normalizedStaleness === "stale") score -= 8;
  if (normalizedStaleness === "missing") score -= 12;

  if (status === "candidate") score = Math.min(score, 69);
  
  return Math.max(0, Math.min(100, Math.round(score)));
}

// ── Evidence references ───────────────────────────────────────────────

export function normalizeBrainEvidenceType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ["analysis", "research", "review", "event", "fundamental", "target", "report", "dossier", "note"].includes(normalized)
    ? normalized
    : "note";
}

export function normalizeBrainEvidenceRef(value) {
  if (typeof value === "string") {
    const label = value.trim();
    return label ? { type: "note", refId: null, code: null, label, date: null } : null;
  }
  
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  
  const label = String(value.label || value.text || value.title || "").trim();
  if (!label) return null;
  
  return {
    type: normalizeBrainEvidenceType(value.type),
    refId: String(value.refId || value.id || "").trim() || null,
    code: String(value.code || "").trim() || null,
    label,
    date: String(value.date || value.updatedAt || "").trim() || null,
  };
}

export function normalizeBrainEvidenceRefs(value) {
  return Array.isArray(value)
    ? value.map(normalizeBrainEvidenceRef).filter(Boolean).slice(0, 8)
    : [];
}

export function mergeBrainEvidenceRefs(primaryRefs, secondaryRefs, { limit = 4 } = {}) {
  const primary = normalizeBrainEvidenceRefs(primaryRefs);
  const secondary = normalizeBrainEvidenceRefs(secondaryRefs);
  
  if (primary.length >= limit) return primary.slice(0, limit);
  
  const merged = [...primary];
  const existingLabels = new Set(primary.map(ref => ref.label));
  
  for (const ref of secondary) {
    if (merged.length >= limit) break;
    if (!existingLabels.has(ref.label)) {
      merged.push(ref);
      existingLabels.add(ref.label);
    }
  }
  
  return merged;
}

export function brainRuleEvidenceSummary(evidenceRefs, { limit = 2 } = {}) {
  const refs = Array.isArray(evidenceRefs) ? evidenceRefs.filter(Boolean) : [];
  if (refs.length === 0) return "";
  
  const labels = refs
    .map(ref => String(ref?.label || "").trim())
    .filter(Boolean)
    .slice(0, limit);
    
  if (labels.length === 0) return `證據${refs.length}筆`;
  
  return `證據${refs.length}筆：${labels.join("、")}${refs.length > limit ? "…" : ""}`;
}

// ── Rule normalization ────────────────────────────────────────────────

export function normalizeBrainRule(rule, { defaultSource = "ai", defaultStatus = "active" } = {}) {
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) return null;
  
  const text = brainRuleText(rule);
  if (!text) return null;
  
  const id = String(rule.id || "").trim() || `rule-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const when = String(rule.when || "").trim() || "";
  const action = String(rule.action || "").trim() || "";
  const scope = String(rule.scope || "").trim() || "";
  
  const appliesTo = Array.isArray(rule.appliesTo) 
    ? rule.appliesTo.map(s => String(s || "").trim()).filter(Boolean).slice(0, 6)
    : [];
    
  const catalystWindow = String(rule.catalystWindow || "").trim() || "";
  const marketRegime = String(rule.marketRegime || "").trim() || "";
  
  const confidence = Number(rule.confidence);
  const evidenceCount = Number(rule.evidenceCount) || 0;
  const validationScore = Number(rule.validationScore);
  
  const lastValidatedAt = String(rule.lastValidatedAt || "").trim() || null;
  const staleness = normalizeBrainRuleStaleness(rule.staleness) || deriveBrainRuleStaleness({ lastValidatedAt, evidenceRefs: rule.evidenceRefs });
  
  const status = ["active", "candidate", "archived"].includes(rule.status) ? rule.status : defaultStatus;
  const source = ["ai", "manual", "backtest", "review"].includes(rule.source) ? rule.source : defaultSource;
  
  const checklistStage = normalizeBrainChecklistStage(rule.checklistStage);
  
  const historicalAnalogs = normalizeBrainAnalogCases(rule.historicalAnalogs);
  const invalidationSignals = Array.isArray(rule.invalidationSignals)
    ? rule.invalidationSignals.map(s => String(s || "").trim()).filter(Boolean).slice(0, 5)
    : [];
    
  const evidenceRefs = normalizeBrainEvidenceRefs(rule.evidenceRefs);
  
  return {
    id,
    text,
    when,
    action,
    scope,
    appliesTo,
    catalystWindow,
    marketRegime,
    confidence: Number.isFinite(confidence) ? confidence : null,
    evidenceCount,
    validationScore: Number.isFinite(validationScore) ? validationScore : deriveBrainRuleValidationScore({ confidence, evidenceCount, staleness, status }),
    lastValidatedAt,
    staleness,
    status,
    source,
    checklistStage,
    historicalAnalogs,
    invalidationSignals,
    evidenceRefs,
  };
}

// ── Checklist helpers ─────────────────────────────────────────────────

export function normalizeBrainChecklistStage(value) {
  const raw = String(value || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (!raw) return "";
  if (raw === "entry" || raw === "preentry") return "preEntry";
  if (raw === "add" || raw === "preadd") return "preAdd";
  if (raw === "exit" || raw === "preexit") return "preExit";
  return "";
}

export function brainChecklistStageLabel(stage) {
  if (stage === "preEntry") return "進場前";
  if (stage === "preAdd") return "加碼前";
  if (stage === "preExit") return "出場前";
  return "未分類";
}

export function normalizeBrainChecklistItems(items) {
  return Array.isArray(items)
    ? Array.from(new Set(items.map(item => String(item || "").trim()).filter(Boolean))).slice(0, 12)
    : [];
}

export function hasBrainChecklistContent(checklists) {
  if (!checklists || typeof checklists !== "object") return false;
  return (
    (Array.isArray(checklists.preEntry) && checklists.preEntry.length > 0) ||
    (Array.isArray(checklists.preAdd) && checklists.preAdd.length > 0) ||
    (Array.isArray(checklists.preExit) && checklists.preExit.length > 0)
  );
}

// ── Analog case helpers ───────────────────────────────────────────────

export function normalizeBrainAnalogVerdict(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ["supported", "mixed", "contradicted"].includes(normalized) ? normalized : "";
}

export function brainAnalogVerdictLabel(value) {
  switch (normalizeBrainAnalogVerdict(value)) {
    case "supported": return "支持";
    case "mixed": return "部分支持";
    case "contradicted": return "相反";
    default: return "";
  }
}

export function normalizeBrainAnalogDifferenceType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ["none", "stock_specific", "market_regime", "timing", "liquidity", "rule_miss"].includes(normalized)
    ? normalized
    : "";
}

export function brainAnalogDifferenceTypeLabel(value) {
  switch (normalizeBrainAnalogDifferenceType(value)) {
    case "none": return "無明顯差異";
    case "stock_specific": return "個股特性差異";
    case "market_regime": return "市場節奏不同";
    case "timing": return "時間窗口不同";
    case "liquidity": return "流動性差異";
    case "rule_miss": return "規則判斷失準";
    default: return "";
  }
}

export function normalizeBrainAnalogCase(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  
  const code = String(value.code || "").trim();
  const name = String(value.name || "").trim();
  const thesis = String(value.thesis || value.reason || "").trim();
  const verdict = normalizeBrainAnalogVerdict(value.verdict);
  const differenceType = normalizeBrainAnalogDifferenceType(value.differenceType);
  
  if (!code && !name && !thesis) return null;
  
  return {
    code,
    name,
    period: String(value.period || value.window || "").trim(),
    thesis,
    verdict,
    differenceType,
    note: String(value.note || value.notes || "").trim(),
  };
}

export function normalizeBrainAnalogCases(value) {
  return Array.isArray(value)
    ? value.map(normalizeBrainAnalogCase).filter(Boolean).slice(0, 5)
    : [];
}

// ── Rule formatting ───────────────────────────────────────────────────

export function brainRuleMetaParts(rule, { includeEvidencePreview = false } = {}) {
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) return [];
  
  return [
    rule.when ? `條件:${rule.when}` : null,
    rule.action ? `動作:${rule.action}` : null,
    rule.scope ? `範圍:${rule.scope}` : null,
    (rule.appliesTo || []).length > 0 ? `適用:${rule.appliesTo.slice(0, 3).join("/")}` : null,
    rule.marketRegime ? `市況:${rule.marketRegime}` : null,
    rule.catalystWindow ? `窗口:${rule.catalystWindow}` : null,
    rule.confidence != null ? `信心${rule.confidence}/10` : null,
    rule.evidenceCount > 0 ? `驗證${rule.evidenceCount}次` : null,
    rule.validationScore != null ? `驗證分${rule.validationScore}` : null,
    rule.lastValidatedAt ? `最近驗證${rule.lastValidatedAt}` : null,
    rule.staleness ? `狀態:${brainRuleStalenessLabel(rule.staleness)}` : null,
    rule.checklistStage ? `檢查點:${brainChecklistStageLabel(rule.checklistStage)}` : null,
    (rule.historicalAnalogs || []).length > 0 ? `歷史比對${rule.historicalAnalogs.length}例` : null,
    includeEvidencePreview ? brainRuleEvidenceSummary(rule.evidenceRefs) : null,
  ].filter(Boolean);
}

export function formatBrainRulesForPrompt(rules, { limit = 8 } = {}) {
  const normalized = (Array.isArray(rules) ? rules : [])
    .map(rule => normalizeBrainRule(rule))
    .filter(Boolean)
    .sort(compareBrainRulesByStrength)
    .slice(0, limit);
    
  return normalized.map(rule => `- ${brainRuleText(rule)}`);
}

export function formatBrainRulesForValidationPrompt(rules, { limit = 8 } = {}) {
  const normalized = (Array.isArray(rules) ? rules : [])
    .map(rule => normalizeBrainRule(rule))
    .filter(Boolean)
    .sort(compareBrainRulesByStrength)
    .slice(0, limit);
    
  return normalized.map(rule => ({
    id: rule.id,
    text: brainRuleText(rule),
    when: rule.when,
    action: rule.action,
    validationScore: rule.validationScore,
    staleness: rule.staleness,
  }));
}

// ── Sorting ───────────────────────────────────────────────────────────

export function compareBrainRulesByStrength(a, b) {
  const scoreDiff = (Number(b?.validationScore) || -1) - (Number(a?.validationScore) || -1);
  if (scoreDiff !== 0) return scoreDiff;
  
  const freshnessDiff = brainRuleStalenessRank(b?.staleness) - brainRuleStalenessRank(a?.staleness);
  if (freshnessDiff !== 0) return freshnessDiff;
  
  const evidenceDiff = (Number(b?.evidenceCount) || 0) - (Number(a?.evidenceCount) || 0);
  if (evidenceDiff !== 0) return evidenceDiff;
  
  const confidenceDiff = (Number(b?.confidence) || 0) - (Number(a?.confidence) || 0);
  if (confidenceDiff !== 0) return confidenceDiff;
  
  return brainRuleText(a).localeCompare(brainRuleText(b), "zh-Hant");
}
