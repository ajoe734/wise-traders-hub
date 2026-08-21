import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { useExpertPerformance } from '@/hooks/usePerformance';
import { useProjectionStatus } from '@/hooks/useProjectionStatus';
import { projectedAmount, projectedPercent } from '@/contracts/publicProjection';
import { NO_PUBLIC_RECORD } from '@/lib/complianceCopy';

type PanelState = 'loading' | 'error' | 'empty' | 'ready';

interface PerformanceOverviewPanelProps {
  /** 由父層直接傳入，避免本元件再查一次 experts 表。 */
  expertId: string | undefined;
  /** 父層已知的起始資金；若未提供則使用公開績效 RPC 回傳值。 */
  startingCapital?: number | null;
  variant?: 'advisor' | 'mentor';
  onStateChange?: (state: PanelState) => void;
}

/**
 * 公開詳情頁只顯示 public projection 放行後的彙總績效。
 * 不讀任何逐筆敏感資料表，也不以 0 代替 loading、error 或 empty。
 */
export function PerformanceOverviewPanel({
  expertId,
  startingCapital: startingCapitalProp,
  onStateChange,
}: PerformanceOverviewPanelProps) {
  const projection = useProjectionStatus(expertId);
  const { data: perfData, isLoading, isError } = useExpertPerformance(expertId);
  const totalTrades = Number(perfData?.total_trades ?? 0);

  const panelState: PanelState = isLoading
    ? 'loading'
    : !projection.showNumbers || isError
      ? 'error'
      : !perfData || !Number.isFinite(totalTrades) || totalTrades <= 0
        ? 'empty'
        : 'ready';

  useEffect(() => {
    onStateChange?.(panelState);
  }, [panelState, onStateChange]);

  if (panelState !== 'ready') {
    const stateCopy = panelState === 'loading'
      ? '績效資料載入中'
      : panelState === 'empty'
        ? NO_PUBLIC_RECORD
        : '資料暫時無法取得';
    return (
      <Card>
        <CardContent
          className="flex min-h-32 items-center justify-center p-6 text-center text-muted-foreground"
          role="status"
          data-testid={`performance-${panelState}`}
        >
          {panelState === 'loading' && <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" />}
          {stateCopy}
        </CardContent>
      </Card>
    );
  }

  const startingCapital = startingCapitalProp ?? perfData.starting_capital;
  const capitalText = projectedAmount(projection, startingCapital);
  const assetText = projectedAmount(projection, perfData.current_asset);
  const returnText = projectedPercent(projection, perfData.total_return_pct);

  return (
    <Card>
      <CardContent
        className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-3"
        data-testid="performance-ready"
        data-economic-zone="performance-cards"
      >
        <PerformanceMetric label="起始資金" value={capitalText} />
        <PerformanceMetric label="目前資產" value={assetText} />
        <PerformanceMetric label="總報酬率" value={returnText} />
      </CardContent>
    </Card>
  );
}

function PerformanceMetric({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0 text-center">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 break-words text-lg font-bold text-foreground">
        {value ?? '資料暫時無法取得'}
      </div>
    </div>
  );
}