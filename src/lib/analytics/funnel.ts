// 漏斗計算純函式（供 /company/funnel 看板使用）
//
// 設計重點（見 .lovable/plan/漏斗看板準不準…）：
//   A. Purchase 以「成交事實」（payment_intents completed / member_subscriptions 生效）為準，
//      不依賴前端 checkout_success —— 匯款單由管理員審核開通時使用者不在前端。
//   B. 轉換率必須是「上一階段的子集」，且匿名 visitor 與登入 user 需歸戶成同一身分。
//   D. 多來源合併時，事件次數以 (stage, actor, 秒級時間戳) 去重。

export const FUNNEL_STEPS = ['view_pricing', 'upgrade_click', 'begin_checkout', 'purchase'] as const;
export type StepKey = (typeof FUNNEL_STEPS)[number];

export interface ActorRef {
  userId?: string | null;
  visitorId?: string | null;
}

export interface StageEvent extends ActorRef {
  stage: StepKey;
  at: string | number | Date;
  source: string;
}

export interface StepResult {
  key: StepKey;
  actors: number;
  events: number;
  prevActors: number | null;
  rate: number | null;
  /** 本階段有事件、但沒走過上一階段（或無法歸戶）而未計入的 actor 數 */
  unattributed: number;
  /** 各來源的原始事件筆數（去重前），用於「來源無資料」標示 */
  bySource: Record<string, number>;
}

/**
 * 建立 visitor_id → user_id 的歸戶索引。
 * 任何同時帶 user_id 與 visitor_id 的紀錄（traffic_events / traffic_visits）都是一條歸戶線索。
 */
export function buildIdentityIndex(links: ActorRef[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const l of links) {
    if (l.userId && l.visitorId && !index.has(l.visitorId)) index.set(l.visitorId, l.userId);
  }
  return index;
}

/** 解析成單一身分 key：user 優先；匿名 visitor 若能歸戶則併入該 user。 */
export function resolveActor(ref: ActorRef, index: Map<string, string>): string | null {
  if (ref.userId) return `u:${ref.userId}`;
  if (ref.visitorId) {
    const mapped = index.get(ref.visitorId);
    return mapped ? `u:${mapped}` : `v:${ref.visitorId}`;
  }
  return null;
}

function secondKey(at: StageEvent['at']): number {
  const ms = at instanceof Date ? at.getTime() : new Date(at).getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
}

/**
 * 計算依序子集漏斗。
 * 第 0 階段取所有有事件的 actor；之後每階段 = 上一階段集合 ∩ 本階段有事件者。
 */
export function computeFunnel(events: StageEvent[], index: Map<string, string>): StepResult[] {
  const seen: Record<StepKey, Set<string>> = {
    view_pricing: new Set(), upgrade_click: new Set(), begin_checkout: new Set(), purchase: new Set(),
  };
  const dedupe: Record<StepKey, Set<string>> = {
    view_pricing: new Set(), upgrade_click: new Set(), begin_checkout: new Set(), purchase: new Set(),
  };
  const bySource: Record<StepKey, Record<string, number>> = {
    view_pricing: {}, upgrade_click: {}, begin_checkout: {}, purchase: {},
  };

  for (const e of events) {
    bySource[e.stage][e.source] = (bySource[e.stage][e.source] ?? 0) + 1;
    const actor = resolveActor(e, index);
    if (!actor) continue;
    seen[e.stage].add(actor);
    dedupe[e.stage].add(`${actor}|${secondKey(e.at)}`);
  }

  let carried: Set<string> | null = null;
  return FUNNEL_STEPS.map((key, i) => {
    const stageActors = seen[key];
    const current = carried === null
      ? new Set(stageActors)
      : new Set([...stageActors].filter((a) => carried!.has(a)));
    const prev = carried === null ? null : carried.size;
    const result: StepResult = {
      key,
      actors: current.size,
      events: dedupe[key].size,
      prevActors: prev,
      rate: prev !== null && prev > 0 ? current.size / prev : null,
      unattributed: stageActors.size - current.size,
      bySource: bySource[key],
    };
    carried = current;
    return result;
  });
}
