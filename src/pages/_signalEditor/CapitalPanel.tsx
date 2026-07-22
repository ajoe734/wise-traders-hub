import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Wallet, History, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TradeAction } from '@/lib/simulatePositions';
import { formatMoneyByCurrency, normalizeCurrency, type Currency } from '@/lib/currency';
import { getAssetSpec, normalizeAssetClass, type AssetClass } from '@/lib/asset';
import { formatBaseQuantity, resolvePositionQuantityDisplay } from '@/lib/positionQuantity';
import type { CapitalStatus, TradeDraft } from './types';

interface Props {
  capital: CapitalStatus;
  cashSim: { remaining: number; perTrade: number[] };
  simulatedPositions: Map<string, number>;
  trades: TradeDraft[];
  showHistory: boolean;
  setShowHistory: (v: boolean | ((v: boolean) => boolean)) => void;
  addTrade: () => void;
  updateTrade: (idx: number, patch: Partial<TradeDraft>) => void;
  /** 從 expert.currency 帶下來；預設 TWD */
  currency?: Currency;
  /** 從 expert.asset_class 帶下來；優先於 currency，用於帶入持倉時的預設單位 */
  assetClass?: AssetClass | string | null;
}

export function CapitalPanel({
  capital, cashSim, simulatedPositions, trades,
  showHistory, setShowHistory, addTrade, updateTrade,
  currency: currencyProp, assetClass: assetClassProp,
}: Props) {
  const currency: Currency = normalizeCurrency(currencyProp ?? capital.currency);
  const assetClass = assetClassProp ? normalizeAssetClass(assetClassProp) : (currency === 'USD' ? 'us_stock' : 'tw_stock');
  const defaultUnit = getAssetSpec(assetClass).defaultUnit;
  const fmt = (n: number) => formatMoneyByCurrency(n, currency);

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Wallet className="h-4 w-4 text-muted-foreground" />
            資金狀況
          </div>
          <span className="text-xs text-muted-foreground">
            幣別：{currency === 'USD' ? '美元 (USD)' : '新台幣 (TWD)'}
          </span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <div className="text-xs text-muted-foreground">起始資金</div>
            <div className="text-base font-medium">{fmt(capital.starting_capital)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">已實現損益</div>
            <div className={cn('text-base font-medium', capital.realized_pnl_amount >= 0 ? 'text-success' : 'text-destructive')}>
              {capital.realized_pnl_amount >= 0 ? '+' : ''}{fmt(capital.realized_pnl_amount)}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">未平倉成本</div>
            <div className="text-base font-medium">{fmt(capital.open_cost_value)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">可用現金</div>
            <div className={cn('text-lg font-bold', capital.available_cash < 0 ? 'text-destructive' : 'text-foreground')}>
              {fmt(capital.available_cash)}
            </div>
          </div>
        </div>
        <div className={cn(
          'rounded-md border px-3 py-2 text-sm',
          cashSim.remaining < 0 ? 'border-destructive/40 bg-destructive/10 text-destructive' : 'border-muted bg-muted/30 text-muted-foreground',
        )}>
          送出後預估可用現金：<span className="font-medium">{fmt(cashSim.remaining)}</span>
          {cashSim.remaining < 0 && <span className="ml-2">⚠ 已超過上限，將被擋下</span>}
        </div>

        {capital.open_positions.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">目前持倉（{capital.open_positions.length} 檔）</div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-1.5 font-normal">股票</th>
                    <th className="text-right font-normal">數量</th>
                    <th className="text-right font-normal">送出後</th>
                    <th className="text-right font-normal">均價</th>
                    <th className="text-right font-normal">現價</th>
                    <th className="text-right font-normal">市值</th>
                    <th className="text-right font-normal">未實現</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {capital.open_positions.map((p) => {
                    const rowAssetClass = p.asset_class ? normalizeAssetClass(p.asset_class) : assetClass;
                    const currentQty = resolvePositionQuantityDisplay(
                      p.quantity_shares,
                      p.quantity_unit || defaultUnit,
                      rowAssetClass,
                    );
                    const simQty = simulatedPositions.get(p.symbol);
                    const hasSim = simQty !== undefined && simQty !== p.quantity_shares;
                    const isCleared = hasSim && simQty === 0;
                    const isDecreased = hasSim && simQty! < p.quantity_shares && simQty! > 0;
                    const isIncreased = hasSim && simQty! > p.quantity_shares;
                    return (
                      <tr key={p.symbol} className="border-b last:border-0">
                        <td className="py-1.5">{p.instrument}</td>
                        <td className="text-right">{currentQty.label}</td>
                        <td className="text-right">
                          {!hasSim ? (
                            <span className="text-muted-foreground">—</span>
                          ) : isCleared ? (
                            <span className="text-muted-foreground">全數出清</span>
                          ) : (
                            <span className={cn(isDecreased && 'text-success', isIncreased && 'text-destructive')}>
                              {formatBaseQuantity(simQty, currentQty.unit, rowAssetClass)} {isDecreased ? '▾' : '▴'}
                            </span>
                          )}
                        </td>
                        <td className="text-right">{Number(p.entry_price || 0).toFixed(2)}</td>
                        <td className="text-right">{p.current_price != null ? Number(p.current_price).toFixed(2) : '—'}</td>
                        <td className="text-right">{fmt(p.market_value)}</td>
                        <td className={cn('text-right', p.unrealized_pnl >= 0 ? 'text-success' : 'text-destructive')}>
                          {p.unrealized_pnl >= 0 ? '+' : ''}{fmt(p.unrealized_pnl)}
                          <span className="ml-1 opacity-70">({p.unrealized_pct >= 0 ? '+' : ''}{p.unrealized_pct.toFixed(2)}%)</span>
                        </td>
                        <td className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs gap-1">
                                帶入 <ChevronDown className="h-3 w-3" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-32">
                              {([
                                { key: 'add',   label: '加碼', full: false, reason: '' },
                                { key: 'trim',  label: '減碼', full: false, reason: '' },
                                { key: 'sell',  label: '出場', full: true,  reason: '' },
                                { key: 'exit',  label: '停損', full: true,  reason: '<p>停損出場</p>' },
                              ] as const).map((opt) => (
                                <DropdownMenuItem
                                  key={opt.key}
                                  onSelect={() => {
                                    const last = trades[trades.length - 1];
                                    const targetIdx = last && !last.stockCode ? trades.length - 1 : trades.length;
                                    if (targetIdx === trades.length) addTrade();
                                    const patch: Partial<TradeDraft> = {
                                      stockCode: p.symbol,
                                      stockName: p.instrument.replace(p.symbol, '').trim(),
                                      action: opt.key as TradeAction,
                                      priceHint: p.current_price ? String(p.current_price) : '',
                                      quantityUnit: currentQty.unit,
                                      quantity: opt.full ? String(currentQty.inputQuantity) : '',
                                    };
                                    if (opt.reason) patch.reasonSummary = opt.reason;
                                    setTimeout(() => updateTrade(targetIdx, patch), 0);
                                  }}
                                >{opt.label}</DropdownMenuItem>
                              ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <button
            type="button"
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setShowHistory((v: boolean) => !v)}
          >
            <History className="h-3.5 w-3.5" />
            最近交易紀錄（{capital.recent_trades.length}）{showHistory ? '收合' : '展開'}
          </button>
          {showHistory && capital.recent_trades.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-1.5 font-normal">日期</th>
                    <th className="text-left font-normal">股票</th>
                    <th className="text-left font-normal">狀態</th>
                    <th className="text-right font-normal">數量</th>
                    <th className="text-right font-normal">進價</th>
                    <th className="text-right font-normal">出價</th>
                    <th className="text-right font-normal">損益%</th>
                  </tr>
                </thead>
                <tbody>
                  {capital.recent_trades.map((r) => (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="py-1.5">{new Date(r.created_at).toLocaleDateString('en-CA').replace(/-/g, '/')}</td>
                      <td>{r.instrument}</td>
                      <td>{r.status}</td>
                      <td className="text-right">
                        {formatBaseQuantity(
                          r.quantity_shares || 0,
                          r.quantity_unit || defaultUnit,
                          r.asset_class || assetClass,
                        )}
                      </td>
                      <td className="text-right">{r.entry_price != null ? Number(r.entry_price).toFixed(2) : '—'}</td>
                      <td className="text-right">{r.exit_price != null ? Number(r.exit_price).toFixed(2) : '—'}</td>
                      <td className={cn('text-right', (r.pnl_percent || 0) >= 0 ? 'text-success' : 'text-destructive')}>
                        {r.pnl_percent != null ? `${r.pnl_percent >= 0 ? '+' : ''}${r.pnl_percent.toFixed(2)}%` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
