import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Activity, Loader2, Sparkles, Trash2 } from 'lucide-react';
import { BackfillProgressPanel } from './BackfillProgressPanel';
import { AutoRulesPanel } from './AutoRulesPanel';
import type { KnowledgeItem } from '@/hooks/useKnowledgeBase';

interface Props {
  items: KnowledgeItem[];
  backtestRuns: any[];
  backtestReport: {
    backtestable: KnowledgeItem[];
    withSamples: KnowledgeItem[];
    distribution: { excellent: number; good: number; fair: number; poor: number; untested: number };
    toArchive: KnowledgeItem[];
    toOptimize: KnowledgeItem[];
  };
  recentSummary: {
    total: number;
    success: number;
    failed: any[];
    autoActions: any[];
    topGain?: { item_id: string; title: string; prev: number; cur: number; delta: number };
    topLoss?: { item_id: string; title: string; prev: number; cur: number; delta: number };
  };
  gridSearching: string | null;
  onGridSearch: (item: KnowledgeItem) => void;
  onToggleActive: (item: KnowledgeItem) => void;
  onOpenRunDetail: (id: string) => void;
  onOpenGridDetail: (id: string) => void;
}

export function BacktestTab({
  items, backtestRuns, backtestReport, recentSummary,
  gridSearching, onGridSearch, onToggleActive,
  onOpenRunDetail, onOpenGridDetail,
}: Props) {
  return (
    <div className="space-y-6 mt-4">
      {/* 近 24 小時回測摘要 */}
      <div className="border rounded-lg p-4 bg-card">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <h3 className="text-base font-medium flex items-center gap-2">
            <Activity className="h-4 w-4" /> 近 24 小時回測摘要
          </h3>
          <span className="text-xs text-muted-foreground">
            共 {recentSummary.total} 次 · 成功 {recentSummary.success} · 失敗 {recentSummary.failed.length} · 自動處置 {recentSummary.autoActions.length}
          </span>
        </div>
        {recentSummary.total === 0 ? (
          <p className="text-sm text-muted-foreground">過去 24 小時尚無回測。可在「正式知識庫」針對單條按「回測」，或讓 cron 自動跑。</p>
        ) : (
          <div className="grid md:grid-cols-2 gap-3">
            <div className="space-y-2">
              {recentSummary.topGain && recentSummary.topGain.delta > 0 && (
                <div className="border rounded p-2 bg-emerald-500/5">
                  <p className="text-xs text-muted-foreground mb-1">勝率提升 Top 1（更新成功 ✅）</p>
                  <p className="text-sm font-medium truncate">{recentSummary.topGain.title}</p>
                  <p className="text-sm">
                    {(recentSummary.topGain.prev * 100).toFixed(1)}% → <span className="text-emerald-600 font-medium">{(recentSummary.topGain.cur * 100).toFixed(1)}%</span>
                    <span className="text-emerald-600 ml-2">↑{(recentSummary.topGain.delta * 100).toFixed(1)}pp</span>
                  </p>
                </div>
              )}
              {recentSummary.topLoss && recentSummary.topLoss.delta < 0 && (
                <div className="border rounded p-2 bg-red-500/5">
                  <p className="text-xs text-muted-foreground mb-1">勝率下滑 Top 1（需關注 ⚠️）</p>
                  <p className="text-sm font-medium truncate">{recentSummary.topLoss.title}</p>
                  <p className="text-sm">
                    {(recentSummary.topLoss.prev * 100).toFixed(1)}% → <span className="text-red-600 font-medium">{(recentSummary.topLoss.cur * 100).toFixed(1)}%</span>
                    <span className="text-red-600 ml-2">↓{Math.abs(recentSummary.topLoss.delta * 100).toFixed(1)}pp</span>
                  </p>
                </div>
              )}
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">失敗清單（{recentSummary.failed.length}）</p>
              {recentSummary.failed.length === 0 ? (
                <p className="text-sm text-muted-foreground">沒有失敗 ✅</p>
              ) : (
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {recentSummary.failed.slice(0, 10).map((r: any) => {
                    const item = items.find(i => i.id === r.knowledge_item_id);
                    return (
                      <div key={r.id} className="text-xs border rounded p-1.5 bg-red-500/5">
                        <div className="flex items-center gap-2">
                          <Badge variant="destructive" className="text-[10px]">failed</Badge>
                          <span className="truncate flex-1">{item?.title ?? r.knowledge_item_id?.slice(0, 8)}</span>
                        </div>
                        <p className="text-muted-foreground mt-0.5 line-clamp-2">{r.error_message ?? '(無錯誤訊息)'}</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <BackfillProgressPanel />
      <AutoRulesPanel />

      {/* 統計區塊 */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: '優秀 ≥70%', count: backtestReport.distribution.excellent, color: 'bg-green-500' },
          { label: '良好 55-70%', count: backtestReport.distribution.good, color: 'bg-emerald-400' },
          { label: '普通 45-55%', count: backtestReport.distribution.fair, color: 'bg-yellow-400' },
          { label: '弱 <45%', count: backtestReport.distribution.poor, color: 'bg-red-500' },
          { label: '尚未驗證', count: backtestReport.distribution.untested, color: 'bg-muted-foreground' },
        ].map(s => (
          <div key={s.label} className="border rounded-lg p-4 bg-card">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${s.color}`} />
              <p className="text-xs text-muted-foreground">{s.label}</p>
            </div>
            <p className="text-2xl font-semibold mt-1">{s.count}</p>
          </div>
        ))}
      </div>

      {/* 待淘汰 */}
      <div>
        <h3 className="text-base font-medium mb-2 flex items-center gap-2">
          <Trash2 className="h-4 w-4 text-red-500" />
          待淘汰（勝率 &lt; 45%，n ≥ 30）
        </h3>
        {backtestReport.toArchive.length === 0 ? (
          <p className="text-sm text-muted-foreground">沒有條目落在淘汰區，狀況良好。</p>
        ) : (
          <div className="space-y-2">
            {backtestReport.toArchive.map(it => (
              <div key={it.id} className="border rounded-lg p-3 bg-card flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <code className="text-xs text-muted-foreground">{it.item_id}</code>
                    <span className="font-medium">{it.title}</span>
                    <Badge variant="destructive">勝率 {((it.win_rate ?? 0) * 100).toFixed(0)}% (n={it.sample_size})</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-1 mt-1">{it.fact}</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button size="sm" variant="outline" onClick={() => onGridSearch(it)} disabled={gridSearching === it.id}>
                    {gridSearching === it.id ? <Loader2 className="h-4 w-4 animate-spin" /> : '網格救援'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => onToggleActive(it)}>停用</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 待優化 */}
      <div>
        <h3 className="text-base font-medium mb-2 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-yellow-500" />
          待優化（勝率 45-60%，建議跑網格搜尋）
        </h3>
        {backtestReport.toOptimize.length === 0 ? (
          <p className="text-sm text-muted-foreground">沒有條目落在優化區。</p>
        ) : (
          <div className="space-y-2">
            {backtestReport.toOptimize.map(it => (
              <div key={it.id} className="border rounded-lg p-3 bg-card flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <code className="text-xs text-muted-foreground">{it.item_id}</code>
                    <span className="font-medium">{it.title}</span>
                    <Badge variant="secondary">勝率 {((it.win_rate ?? 0) * 100).toFixed(0)}% (n={it.sample_size})</Badge>
                    <Badge variant="outline">{it.trigger_condition?.type}</Badge>
                  </div>
                  <pre className="text-xs bg-muted p-2 rounded mt-2 overflow-x-auto">當前參數：{JSON.stringify(it.trigger_condition, null, 0)}</pre>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button size="sm" onClick={() => onGridSearch(it)} disabled={gridSearching === it.id}>
                    {gridSearching === it.id ? <Loader2 className="h-4 w-4 animate-spin" /> : '網格搜尋'}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 最近回測 runs */}
      <div>
        <h3 className="text-base font-medium mb-2">最近回測紀錄（{backtestRuns.length}）— 點選列檢視明細</h3>
        {backtestRuns.length === 0 ? (
          <p className="text-sm text-muted-foreground">尚未跑過回測。可在「正式知識庫」每條 backtestable 條目按「回測」開始。</p>
        ) : (
          <div className="space-y-1 max-h-96 overflow-y-auto">
            {backtestRuns.slice(0, 100).map((r: any) => {
              const item = items.find(i => i.id === r.knowledge_item_id);
              const isGrid = r.run_mode === 'grid_search';
              const isFailed = r.status === 'failed';
              return (
                <button
                  key={r.id}
                  onClick={() => isGrid ? onOpenGridDetail(r.id) : onOpenRunDetail(r.id)}
                  className={`w-full border rounded p-2 text-sm text-left hover:bg-muted/50 transition-colors ${isFailed ? 'border-red-500/40 bg-red-500/5' : ''}`}
                >
                  <div className="flex items-center gap-3 flex-wrap">
                    <Badge variant={isFailed ? 'destructive' : isGrid ? 'default' : 'outline'}>
                      {isFailed ? 'failed' : r.run_mode}
                    </Badge>
                    <code className="text-xs text-muted-foreground">{item?.item_id ?? r.knowledge_item_id?.slice(0, 8)}</code>
                    <span className="flex-1 truncate">{item?.title ?? '(已刪除)'}</span>
                    {r.auto_action && (
                      <Badge variant={r.auto_action.includes('archived') ? 'destructive' : 'secondary'} className="text-xs">
                        {r.auto_action}
                      </Badge>
                    )}
                    {!isFailed && r.win_rate != null && <span>勝率 {(r.win_rate * 100).toFixed(1)}%</span>}
                    {!isFailed && <span className="text-muted-foreground">n={r.total_hits}</span>}
                    <span className="text-xs text-muted-foreground">
                      {new Date(r.created_at).toLocaleString('zh-TW', { hour12: false })}
                    </span>
                  </div>
                  {isFailed && r.error_message && (
                    <p className="text-xs text-red-600 mt-1 line-clamp-2">⚠️ {r.error_message}</p>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
