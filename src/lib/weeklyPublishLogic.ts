/**
 * Weekly journal publish logic helpers extracted from
 * supabase/functions/publish-weekly-journals/index.ts.
 * Pure functions for unit testing; the Deno function is drift-detected.
 */

export interface ExpertPerformance {
  win_rate?: number | null;
  total_return_pct?: number | null;
  return_1y?: number | null;
  total_trades?: number | null;
}

export interface LineBinding {
  user_id: string;
  line_user_id: string;
}

export interface ActiveSubscription {
  user_id: string;
  plan_id: string;
  canceled_at: string | null;
}

/**
 * Build a promotional Flex Message for canceled subscribers.
 * Mirrors buildPromoMessage in publish-weekly-journals/index.ts.
 */
export function buildPromoMessage(
  expertName: string,
  performance: ExpertPerformance | null | undefined,
  signalCount: number,
): object {
  const bodyContents: object[] = [
    {
      type: 'text',
      text: `📊 ${expertName} 最新績效`,
      weight: 'bold',
      size: 'lg',
      color: '#333333',
    },
    {
      type: 'text',
      text: `本週發布了 ${signalCount} 筆操作紀錄，以下是最新績效表現：`,
      size: 'sm',
      color: '#666666',
      margin: 'md',
      wrap: true,
    },
    { type: 'separator', margin: 'lg' },
  ];

  if (performance) {
    const winRate =
      performance.win_rate != null ? `${Number(performance.win_rate).toFixed(1)}%` : '-';
    const cumReturn =
      performance.total_return_pct != null
        ? `${Number(performance.total_return_pct).toFixed(1)}%`
        : '-';
    const return1y =
      performance.return_1y != null ? `${Number(performance.return_1y).toFixed(1)}%` : '-';
    const totalTrades = performance.total_trades ?? 0;

    bodyContents.push(
      {
        type: 'box',
        layout: 'horizontal',
        margin: 'lg',
        contents: [
          { type: 'text', text: '📈 累計報酬', size: 'sm', color: '#333', flex: 1 },
          { type: 'text', text: cumReturn, size: 'sm', color: '#00B900', align: 'end', weight: 'bold', flex: 1 },
        ],
      },
      {
        type: 'box',
        layout: 'horizontal',
        margin: 'sm',
        contents: [
          { type: 'text', text: '📅 近一年報酬', size: 'sm', color: '#333', flex: 1 },
          { type: 'text', text: return1y, size: 'sm', color: '#00B900', align: 'end', weight: 'bold', flex: 1 },
        ],
      },
      {
        type: 'box',
        layout: 'horizontal',
        margin: 'sm',
        contents: [
          { type: 'text', text: '🎯 勝率', size: 'sm', color: '#333', flex: 1 },
          { type: 'text', text: winRate, size: 'sm', color: '#333', align: 'end', weight: 'bold', flex: 1 },
        ],
      },
      {
        type: 'box',
        layout: 'horizontal',
        margin: 'sm',
        contents: [
          { type: 'text', text: '📊 總交易數', size: 'sm', color: '#333', flex: 1 },
          { type: 'text', text: `${totalTrades}`, size: 'sm', color: '#333', align: 'end', weight: 'bold', flex: 1 },
        ],
      },
    );
  }

  bodyContents.push(
    { type: 'separator', margin: 'lg' },
    {
      type: 'text',
      text: '想跟上最新操作？立即重新訂閱！',
      size: 'sm',
      color: '#FF6B00',
      margin: 'lg',
      weight: 'bold',
      wrap: true,
    },
  );

  return {
    type: 'flex',
    altText: `📊 ${expertName} 本週發布 ${signalCount} 筆操作 — 立即重新訂閱！`,
    contents: {
      type: 'bubble',
      body: { type: 'box', layout: 'vertical', contents: bodyContents },
    },
  };
}

/**
 * Classify LINE binding targets into subscribed vs canceled groups.
 * Mirrors the inline classification logic in publish-weekly-journals/index.ts.
 *
 * @param bindings  - LINE bindings (is_active=true) for this expert
 * @param activeSubs - Active subscriptions (status='active', expires_at > now)
 * @param expertPlanIds - Set of plan IDs belonging to this expert
 *
 * subscribedTargets: users with an active, non-canceled subscription → receive full journal
 * canceledTargets: users with an active but canceled_at-set subscription → receive promo
 * Users with no relevant active subscription are excluded from both.
 */
export function classifyLineTargets(
  bindings: LineBinding[],
  activeSubs: ActiveSubscription[],
  expertPlanIds: Set<string>,
): { subscribedTargets: string[]; canceledTargets: string[] } {
  const relevantSubs = activeSubs.filter(s => expertPlanIds.has(s.plan_id));
  const subscribedUserIds = new Set(
    relevantSubs.filter(s => !s.canceled_at).map(s => s.user_id),
  );
  const canceledUserIds = new Set(
    relevantSubs.filter(s => s.canceled_at).map(s => s.user_id),
  );

  return {
    subscribedTargets: bindings
      .filter(b => subscribedUserIds.has(b.user_id))
      .map(b => b.line_user_id),
    canceledTargets: bindings
      .filter(b => canceledUserIds.has(b.user_id))
      .map(b => b.line_user_id),
  };
}
