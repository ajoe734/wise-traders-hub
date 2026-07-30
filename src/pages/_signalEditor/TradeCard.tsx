import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowUp, ArrowDown, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { LazyRichTextEditor as RichTextEditor } from '@/components/admin/LazyRichTextEditor';
import { htmlToPlainText } from '@/lib/sanitizeHtml';
import type { TradeAction } from '@/lib/simulatePositions';
import type { TradeDraft, CapitalStatus, AIAssistFn } from './types';
import type { TradeIssue } from './derive';
import {
  normalizeCurrency,
  type Currency,
} from '@/lib/currency';
import {
  getAssetSpec,
  normalizeAssetClass,
  sanitizeAssetQuantityUnit,
  type AssetClass,
  type QuantityUnit,
} from '@/lib/asset';
import { formatBaseQuantity, resolveMaxBuyDraftQuantity, resolveMaxSellDraftQuantity } from '@/lib/positionQuantity';
import { ComboBuilder } from './ComboBuilder';
import { emptyComboLeg } from '@/lib/optionCombo';
import { Switch } from '@/components/ui/switch';

interface Props {
  idx: number;
  trade: TradeDraft;
  totalTrades: number;
  signalTemplates: any[];
  capital: CapitalStatus | null;
  cashSim: { remaining: number; perTrade: number[] };
  /** C9：買/賣「最大值」按鈕要用的模擬持倉表（每檔 base 股數）。 */
  simulatedPositions?: Map<string, number>;
  expertId?: string;
  /** 從 expert.currency 帶下來；預設 TWD */
  currency?: Currency;
  /** 從 expert.asset_class 帶下來；優先於 currency，用於單位與代碼規格 */
  assetClass?: AssetClass | string | null;
  /** mentor 才會看到「觀察 hold」選項 */
  allowHold?: boolean;
  /** B2：輸入當下的單位／方向／資金問題（已依本卡片過濾） */
  issues?: TradeIssue[];
  updateTrade: (idx: number, patch: Partial<TradeDraft>) => void;
  removeTrade: (idx: number) => void;
  moveTrade: (idx: number, dir: -1 | 1) => void;
  fetchStockInfo: (idx: number, code: string) => void;
  callAIAssist: AIAssistFn;
}

export function TradeCard({
  idx, trade: t, totalTrades, signalTemplates, capital, cashSim, simulatedPositions,
  expertId, currency: currencyProp, assetClass: assetClassProp, allowHold, issues = [],
  updateTrade, removeTrade, moveTrade, fetchStockInfo, callAIAssist,
}: Props) {
  const currency: Currency = normalizeCurrency(currencyProp);
  const assetClass = assetClassProp ? normalizeAssetClass(assetClassProp) : (currency === 'USD' ? 'us_stock' : 'tw_stock');
  const spec = getAssetSpec(assetClass);
  const units = spec.units;
  const isUsd = spec.currency === 'USD';
  const isHold = t.action === 'hold';
  const safeUnit = sanitizeAssetQuantityUnit(t.quantityUnit, assetClass);
  const canCombo = assetClass === 'us_option';
  const isCombo = !!t.isCombo && canCombo;
  const issueFor = (field: TradeIssue['field']) => issues.find((i) => i.field === field);
  const actionIssue = issueFor('action');
  const quantityIssue = issueFor('quantity');
  const unitIssue = issueFor('quantityUnit');
  const issueClass = 'border-destructive focus-visible:ring-destructive';
  const IssueText = ({ issue }: { issue?: TradeIssue }) =>
    issue ? <p role="alert" className="text-[11px] text-destructive">{issue.message}</p> : null;
  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium text-muted-foreground">操作 #{idx + 1}</div>
          <div className="flex items-center gap-1">
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => moveTrade(idx, -1)} disabled={idx === 0}>
              <ArrowUp className="h-4 w-4" />
            </Button>
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => moveTrade(idx, 1)} disabled={idx === totalTrades - 1}>
              <ArrowDown className="h-4 w-4" />
            </Button>
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeTrade(idx)} disabled={totalTrades === 1}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {canCombo && (
          <div className="flex items-center justify-between rounded-md border px-3 py-2">
            <div>
              <div className="text-xs font-medium">原生組合單（多腿價差）</div>
              <div className="text-[10px] text-muted-foreground">開啟後以「組」為單位，資金佔用＝每組最大損失</div>
            </div>
            <Switch
              checked={isCombo}
              onCheckedChange={(v) => updateTrade(idx, {
                isCombo: v,
                quantityUnit: (v ? '組' : '口') as QuantityUnit,
                legs: v && !(t.legs?.length) ? [emptyComboLeg(), emptyComboLeg()] : t.legs,
              })}
            />
          </div>
        )}

        {isCombo && (
          <ComboBuilder
            legs={t.legs || []}
            strategy={t.comboStrategy}
            onChange={({ legs, comboStrategy, label }) => updateTrade(idx, {
              legs,
              comboStrategy,
              stockCode: label,
              stockName: '',
              quantityUnit: '組' as QuantityUnit,
            })}
          />
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">操作時間</Label>
            <Input
              type="datetime-local"
              value={t.executedAt}
              onChange={(e) => updateTrade(idx, { executedAt: e.target.value })}
            />
          </div>
          {!isCombo && <div className="space-y-1.5">
            <Label className="text-xs">股票代碼</Label>
            <Input
              value={t.stockCode}
              onChange={(e) => {
                const raw = e.target.value;
                // 一律 uppercase：TW 純數字為 no-op；ETF 字尾（L/R/B）需大寫；US 需大寫
                const v = raw.toUpperCase();
                updateTrade(idx, { stockCode: v });
                if (v.trim().length >= spec.minSymbolLen) fetchStockInfo(idx, v);
              }}
              placeholder={spec.symbolPlaceholder}
            />
          </div>}
          {!isCombo && <div className="space-y-1.5">
            <Label className="text-xs">股票名稱</Label>
            <Input value={t.stockName} onChange={(e) => updateTrade(idx, { stockName: e.target.value })} />
          </div>}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">操作方向</Label>
            <Select value={t.action} onValueChange={(v) => updateTrade(idx, { action: v as TradeAction })}>
              <SelectTrigger><SelectValue placeholder="選擇" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="buy">買進</SelectItem>
                <SelectItem value="sell">賣出</SelectItem>
                <SelectItem value="add">加碼</SelectItem>
                <SelectItem value="trim">減碼</SelectItem>
                <SelectItem value="exit">平損</SelectItem>
                {allowHold && <SelectItem value="hold">觀察（不進出場）</SelectItem>}
              </SelectContent>
            </Select>
            <IssueText issue={actionIssue} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs flex items-center justify-between">
              <span>{isCombo ? '組數' : '數量'}{isHold && <span className="text-muted-foreground ml-1">（選填）</span>}</span>
              {(t.action === 'buy' || t.action === 'add') && capital && (
                <button
                  type="button"
                  className="text-[10px] text-primary hover:underline"
                  onClick={() => {
                    const price = parseFloat(t.priceHint || '0');
                    if (!price || price <= 0) { toast.error('請先填參考價位'); return; }
                    const remainingBefore =
                      cashSim.perTrade[idx] ?? (capital.available_cash || 0);
                    const maxBaseQty = Math.max(0, Math.floor(remainingBefore / price));
                    updateTrade(idx, resolveMaxBuyDraftQuantity(maxBaseQty, spec.defaultUnit, assetClass));
                  }}
                >最大可買</button>
              )}
              {(t.action === 'sell' || t.action === 'trim' || t.action === 'exit') && (() => {
                const code = t.stockCode.trim();
                const availBase = code ? (simulatedPositions?.get(code) ?? 0) : 0;
                if (availBase <= 0) return null;
                return (
                  <button
                    type="button"
                    className="text-[10px] text-primary hover:underline"
                    onClick={() => updateTrade(idx, resolveMaxSellDraftQuantity(availBase, safeUnit, assetClass))}
                  >全部持有（{formatBaseQuantity(availBase, safeUnit, assetClass)}）</button>
                );
              })()}
            </Label>
            <div className="flex gap-2">
              <Input
                type="number"
                min={0}
                value={t.quantity}
                onChange={(e) => updateTrade(idx, { quantity: e.target.value })}
                className={`flex-1 ${quantityIssue ? issueClass : ''}`}
                placeholder={isHold ? '可不填' : ''}
              />
              <Select
                value={safeUnit}
                onValueChange={(v) => updateTrade(idx, { quantityUnit: v as QuantityUnit })}
                disabled={units.length === 1}
              >
                <SelectTrigger className={`w-20 ${unitIssue ? issueClass : ''}`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {units.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <IssueText issue={quantityIssue} />
            <IssueText issue={unitIssue} />
          </div>
          {!isCombo && <div className="space-y-1.5">
            <Label className="text-xs">參考價位{isHold && <span className="text-muted-foreground ml-1">（選填）</span>}</Label>
            <Input type="number" value={t.priceHint} onChange={(e) => updateTrade(idx, { priceHint: e.target.value })} placeholder={isHold ? '可不填' : '890'} />
          </div>}
        </div>

        {signalTemplates.length > 0 && (
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">套用訊號模板（不會覆蓋已填內容）</Label>
            <div className="flex flex-wrap gap-1.5">
              {signalTemplates.map((tpl) => (
                <Button
                  key={tpl.id}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() =>
                    updateTrade(idx, {
                      action: t.action || tpl.action,
                      reasonSummary: t.reasonSummary || (tpl.reason ? `<p>${tpl.reason}</p>` : ''),
                      riskNotes: t.riskNotes || (tpl.risk_note ? `<p>${tpl.risk_note}</p>` : ''),
                      reasonDetail: t.reasonDetail || (tpl.strategy_note ? `<p>${tpl.strategy_note}</p>` : ''),
                    })
                  }
                >
                  {tpl.title}
                </Button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          <Label className="text-xs">為什麼這樣操作？</Label>
          <RichTextEditor
            uploadFolder={expertId}
            value={t.reasonSummary}
            onChange={(html) => updateTrade(idx, { reasonSummary: html })}
            placeholder="決策摘要、訊號背後的理由…"
            minHeight={90}
            aiField="reason_summary"
            onAIAssist={(mode, html, ins) =>
              callAIAssist('reason_summary', mode, htmlToPlainText(html), ins, {
                instrument: `${t.stockCode} ${t.stockName}`.trim(),
                action: t.action,
                price_hint: t.priceHint,
              })
            }
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">部位控管想法</Label>
          <RichTextEditor
            uploadFolder={expertId}
            value={t.reasonDetail}
            onChange={(html) => updateTrade(idx, { reasonDetail: html })}
            placeholder="進出場條件、停損停利、加碼計畫…"
            minHeight={100}
            aiField="reason_detail"
            onAIAssist={(mode, html, ins) => callAIAssist('reason_detail', mode, htmlToPlainText(html), ins)}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">風險提醒</Label>
          <RichTextEditor
            uploadFolder={expertId}
            value={t.riskNotes}
            onChange={(html) => updateTrade(idx, { riskNotes: html })}
            placeholder="可能出錯的情境、停損點、總曝險…"
            minHeight={80}
            aiField="risk_notes"
            onAIAssist={(mode, html, ins) => callAIAssist('risk_notes', mode, htmlToPlainText(html), ins)}
          />
        </div>
      </CardContent>
    </Card>
  );
}
