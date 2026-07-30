/**
 * LINE 推播文案核心（Deno 側唯一資料源）。
 *
 * 這裡放三件原本被複製的東西：
 *   1. htmlToText        — TipTap 富文字拍平成 LINE 純文字
 *   2. buildPromoMessage — 已取消訂閱者收到的績效招回 Flex Message
 *   3. classifyLineTargets — LINE 綁定分流成「訂閱中／已取消」
 *
 * 為什麼：`publish-weekly-journals` 與 `line-push-signal` 各自有一份幾乎相同
 * 的實作，`src/lib/weeklyPublishLogic.ts` 檔頭甚至宣稱「the Deno function is
 * drift-detected」，但全庫沒有任何測試比對兩邊 —— 假守衛比沒守衛更危險。
 *
 * 前台鏡像：src/lib/linePushCore.ts
 * （由 scripts/gen-line-push-core-mirror.mjs 產生，禁止手改）
 */

// ── htmlToText ────────────────────────────────────────────────────────────────

/**
 * 把 TipTap HTML 拍平成 LINE 純文字（保留段落／列表換行）。
 * 非 HTML 輸入原樣回傳；null/undefined 回空字串。
 */
export function htmlToText(s: unknown): string {
  if (s == null) return '';
  const str = String(s);
  if (!/<[^>]+>/.test(str)) return str;
  return str
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/(p|div|li|h[1-6]|blockquote)\s*>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '• ')
    .replace(/<img[^>]*>/gi, '[圖片] ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 對 signal 物件中的富文字欄位做 HTML→純文字。 */
export const PLAINIFY_FIELDS = [
  'reason_summary',
  'reason_detail',
  'risk_notes',
  'learning_points',
  'overall_summary',
  'teaching_topic',
] as const;

export function plainifySignal<T extends Record<string, any>>(signal: T | null | undefined): T {
  if (!signal) return signal as T;
  const out: Record<string, any> = { ...signal };
  for (const f of PLAINIFY_FIELDS) {
    if (out[f]) out[f] = htmlToText(out[f]);
  }
  return out as T;
}

// ── buildPromoMessage ─────────────────────────────────────────────────────────

export interface ExpertPerformance {
  win_rate?: number | null;
  total_return_pct?: number | null;
  return_1y?: number | null;
  total_trades?: number | null;
}

const pct = (v: number | null | undefined) =>
  v != null ? `${Number(v).toFixed(1)}%` : '-';

/**
 * 已取消訂閱者的績效招回訊息。
 *
 * `signalCount` 有值 = 週記批次情境（publish-weekly-journals）：
 *   副標寫「本週發布了 N 筆操作紀錄」、altText 帶筆數。
 * `signalCount` 省略 = 單筆訊號情境（line-push-signal）：
 *   副標寫「分析師剛發布了新的操作訊號」、altText 為績效更新。
 */
export function buildPromoMessage(
  expertName: string,
  performance: ExpertPerformance | null | undefined,
  signalCount?: number | null,
): Record<string, any> {
  const isBatch = signalCount != null;
  const bodyContents: Record<string, any>[] = [
    {
      type: 'text',
      text: `📊 ${expertName} 最新績效`,
      weight: 'bold',
      size: 'lg',
      color: '#333333',
    },
    {
      type: 'text',
      text: isBatch
        ? `本週發布了 ${signalCount} 筆操作紀錄，以下是最新績效表現：`
        : '分析師剛發布了新的操作訊號，以下是最新績效表現：',
      size: 'sm',
      color: '#666666',
      margin: 'md',
      wrap: true,
    },
    { type: 'separator', margin: 'lg' },
  ];

  if (performance) {
    const rows: [string, string, string][] = [
      ['📈 累計報酬', pct(performance.total_return_pct), '#00B900'],
      ['📅 近一年報酬', pct(performance.return_1y), '#00B900'],
      ['🎯 勝率', pct(performance.win_rate), '#333'],
      ['📊 總交易數', `${performance.total_trades ?? 0}`, '#333'],
    ];
    rows.forEach(([label, value, color], i) => {
      bodyContents.push({
        type: 'box',
        layout: 'horizontal',
        margin: i === 0 ? 'lg' : 'sm',
        contents: [
          { type: 'text', text: label, size: 'sm', color: '#333', flex: 1 },
          { type: 'text', text: value, size: 'sm', color, align: 'end', weight: 'bold', flex: 1 },
        ],
      });
    });
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
    altText: isBatch
      ? `📊 ${expertName} 本週發布 ${signalCount} 筆操作 — 立即重新訂閱！`
      : `📊 ${expertName} 最新績效更新 — 立即重新訂閱跟上操作！`,
    contents: {
      type: 'bubble',
      body: { type: 'box', layout: 'vertical', contents: bodyContents },
    },
  };
}

// ── classifyLineTargets ───────────────────────────────────────────────────────

export interface LineBinding {
  user_id: string;
  line_user_id: string;
}

export interface ActiveSubscription {
  user_id: string;
  plan_id: string;
  canceled_at: string | null;
  /** 有值且早於 nowIso 者視為已過期，兩組名單都不收。 */
  expires_at?: string | null;
}

/**
 * 把 LINE 綁定分成兩組推播名單。
 *
 * subscribedTargets：有效且未取消的訂閱 → 收完整週記／訊號
 * canceledTargets  ：有效但已標記 canceled_at → 收績效招回訊息
 * 兩者皆非（無相關有效訂閱）→ 不推播
 *
 * 過期判定：`expires_at` 有值且早於 `nowIso`（預設現在）者一律剔除；
 * `expires_at` 為 null 視為無到期日，保留。
 */
export function classifyLineTargets(
  bindings: LineBinding[],
  activeSubs: ActiveSubscription[],
  expertPlanIds: Set<string>,
  nowIso: string = new Date().toISOString(),
): { subscribedTargets: string[]; canceledTargets: string[] } {
  const relevantSubs = activeSubs.filter(
    (s) => expertPlanIds.has(s.plan_id) && !(s.expires_at && s.expires_at < nowIso),
  );
  const subscribedUserIds = new Set(
    relevantSubs.filter((s) => !s.canceled_at).map((s) => s.user_id),
  );
  const canceledUserIds = new Set(
    relevantSubs.filter((s) => s.canceled_at).map((s) => s.user_id),
  );

  return {
    subscribedTargets: bindings
      .filter((b) => subscribedUserIds.has(b.user_id))
      .map((b) => b.line_user_id),
    canceledTargets: bindings
      .filter((b) => canceledUserIds.has(b.user_id))
      .map((b) => b.line_user_id),
  };
}
