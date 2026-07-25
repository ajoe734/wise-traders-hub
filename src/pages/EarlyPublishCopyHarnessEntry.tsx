// @ts-nocheck
/**
 * Preview-only E2E harness — Early-publish → notification 文案回歸
 *
 * 目的：覆蓋「mentor-admin/signals 點擊『提前開放本週發布』→ /app/ 通知呈現」
 * 這條完整入口鏈上，TW / US 兩個市場所有面向使用者的文字，都不得出現「下週」。
 *
 * 覆蓋來源（皆使用 production 實際字串／組件，避免測試與程式碼漂移）：
 *   1. `Signals.tsx` header 提示：`{authoringWindowLabel}，{publishMomentLabel}（本週待發布 N 筆）`
 *   2. `Signals.tsx` 提前發布按鈕 title / label
 *   3. `EarlyPublishDialog`（實際組件）標題、描述、`publishMomentLabel` 內嵌文字
 *   4. `AdminLayout` 側邊欄 hint（`週記於每週五 20:00 統一開放發布`）
 *   5. `publish-weekly-journals` edge function 對訂閱者寫入的通知：
 *        title: `{expertName} 本週週記已提前開放`
 *        link:  `/app/expert/{slug}`
 *      使用者側 `/app/notifications` 讀到的完整 title + body。
 *
 * SECURITY: preview-only；prod 一律 return null。
 */
import { useState } from 'react';
import { EarlyPublishDialog } from '@/pages/_adminSignals/EarlyPublishDialog';
import { Button } from '@/components/ui/button';
import { nextPublishMomentLabel, marketOfAssetClass } from '@/lib/publishingWindow';

function isPreviewEnv() {
  try {
    const h = typeof window !== 'undefined' ? window.location.hostname : '';
    return (
      (typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV) ||
      h === 'localhost' ||
      h === '127.0.0.1' ||
      h.endsWith('.lovableproject.com') ||
      (h.startsWith('id-preview--') && h.endsWith('.lovable.app'))
    );
  } catch {
    return false;
  }
}

// 與 publish-weekly-journals/index.ts 內插入 notifications 的欄位完全一致
function buildEarlyOpenNotification(expertName: string, slug: string) {
  return {
    title: `${expertName} 本週週記已提前開放`,
    body: `${expertName} 已提前公開本週週記，點擊立即檢視最新交易紀錄與心法。`,
    link: `/app/expert/${slug}`,
  };
}

// 與 AdminLayout.tsx 的 side-nav hint 保持同源
const ADMIN_LAYOUT_SIDENAV_HINT = '週記於每週五 20:00 統一開放發布';

// 與 Dashboard.tsx 撰寫本週週記卡片描述同源
const DASHBOARD_PENDING_HINT = '週記儲存後狀態為「待發布」，本週五 20:00 統一開放發布';

interface MarketPanelProps {
  market: 'TW' | 'US';
  assetClass: string;
  expertName: string;
  expertSlug: string;
  pendingCount: number;
}

function MarketPanel({ market, assetClass, expertName, expertSlug, pendingCount }: MarketPanelProps) {
  const [open, setOpen] = useState(false);
  const [notified, setNotified] = useState<null | ReturnType<typeof buildEarlyOpenNotification>>(null);
  const publishMomentLabel = nextPublishMomentLabel(assetClass);
  const authoringWindowLabel =
    marketOfAssetClass(assetClass) === 'US' ? '週一~週六 08:00 前撰寫' : '週一~五撰寫';

  const testid = market.toLowerCase();

  return (
    <section
      data-testid={`market-panel-${testid}`}
      style={{ border: '1px solid #ccc', padding: 16, marginBottom: 16 }}
    >
      <h2>市場：{market}（{assetClass}）</h2>

      {/* 1) Signals.tsx header 提示 — 與 Signals.tsx L204 同源 */}
      <p data-testid={`signals-header-hint-${testid}`}>
        {`${authoringWindowLabel}，${publishMomentLabel}（本週待發布 ${pendingCount} 筆）`}
      </p>

      {/* 2) AdminLayout side-nav hint */}
      <p data-testid={`sidenav-hint-${testid}`}>{ADMIN_LAYOUT_SIDENAV_HINT}</p>

      {/* 3) Dashboard 待辦提示 */}
      <p data-testid={`dashboard-hint-${testid}`}>{DASHBOARD_PENDING_HINT}</p>

      {/* 4) 提前開放按鈕 — 與 Signals.tsx L214-221 同源 */}
      <Button
        variant="outline"
        data-testid={`early-publish-btn-${testid}`}
        title={`繞過 ${publishMomentLabel} 排程，立即公開本週 ${pendingCount} 筆待發布週記`}
        onClick={() => setOpen(true)}
      >
        ⚡ 提前開放本週發布
      </Button>

      {/* 5) 實際 EarlyPublishDialog 組件 */}
      <EarlyPublishDialog
        open={open}
        onOpenChange={setOpen}
        pendingCount={pendingCount}
        publishMomentLabel={publishMomentLabel}
        submitting={false}
        onConfirm={() => {
          // 模擬 publish-weekly-journals 對訂閱者寫入的通知
          setNotified(buildEarlyOpenNotification(expertName, expertSlug));
          setOpen(false);
        }}
      />

      {/* 6) /app/ 通知卡呈現（title + body + link 與 edge function 完全同源） */}
      {notified && (
        <article data-testid={`app-notification-${testid}`} style={{ marginTop: 12 }}>
          <h3 data-testid={`app-notif-title-${testid}`}>{notified.title}</h3>
          <p data-testid={`app-notif-body-${testid}`}>{notified.body}</p>
          <a data-testid={`app-notif-link-${testid}`} href={notified.link}>
            {notified.link}
          </a>
        </article>
      )}
    </section>
  );
}

export default function EarlyPublishCopyHarnessEntry() {
  if (!isPreviewEnv()) return null;
  return (
    <main style={{ padding: 24, fontFamily: 'system-ui' }}>
      <h1>Early-publish copy harness</h1>
      {/* 這裡刻意不放中文描述，避免 harness 自身文字混入「零下週」全文掃描。 */}

      <MarketPanel
        market="TW"
        assetClass="tw_stock"
        expertName="老周"
        expertSlug="lao-zhou"
        pendingCount={6}
      />
      <MarketPanel
        market="US"
        assetClass="us_stock"
        expertName="Benny"
        expertSlug="benny"
        pendingCount={3}
      />
    </main>
  );
}
