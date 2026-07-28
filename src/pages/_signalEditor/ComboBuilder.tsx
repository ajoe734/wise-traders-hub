import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2 } from 'lucide-react';
import {
  analyzeCombo,
  buildOccSymbol,
  detectComboStrategy,
  emptyComboLeg,
  formatComboLabel,
  validateCombo,
  COMBO_STRATEGY_LABELS,
  type ComboLeg,
  type ComboStrategy,
} from '@/lib/optionCombo';
import { formatMoneyByCurrency } from '@/lib/currency';

interface Props {
  legs: ComboLeg[];
  strategy?: ComboStrategy;
  onChange: (patch: { legs: ComboLeg[]; comboStrategy: ComboStrategy; label: string }) => void;
}

const TEMPLATES: { key: ComboStrategy; label: string; make: (u: string, e: string) => ComboLeg[] }[] = [
  {
    key: 'vertical_put',
    label: '賣權價差',
    make: (u, e) => [
      { ...emptyComboLeg(u, e), right: 'P', side: 'short' },
      { ...emptyComboLeg(u, e), right: 'P', side: 'long' },
    ],
  },
  {
    key: 'vertical_call',
    label: '買權價差',
    make: (u, e) => [
      { ...emptyComboLeg(u, e), right: 'C', side: 'short' },
      { ...emptyComboLeg(u, e), right: 'C', side: 'long' },
    ],
  },
  {
    key: 'iron_condor',
    label: '鐵兀鷹',
    make: (u, e) => [
      { ...emptyComboLeg(u, e), right: 'P', side: 'long' },
      { ...emptyComboLeg(u, e), right: 'P', side: 'short' },
      { ...emptyComboLeg(u, e), right: 'C', side: 'short' },
      { ...emptyComboLeg(u, e), right: 'C', side: 'long' },
    ],
  },
];

export function ComboBuilder({ legs, strategy, onChange }: Props) {
  const underlying = legs[0]?.underlying || '';
  const expiry = legs[0]?.expiry || '';
  const metrics = analyzeCombo(legs);
  const check = legs.length >= 2 ? validateCombo(legs) : { ok: false, error: '請至少加入 2 腿' };
  const fmt = (n: number) => formatMoneyByCurrency(n, 'USD');

  const push = (next: ComboLeg[], nextStrategy?: ComboStrategy) => {
    onChange({
      legs: next,
      comboStrategy: nextStrategy || detectComboStrategy(next),
      label: formatComboLabel(next),
    });
  };

  const patchLeg = (i: number, patch: Partial<ComboLeg>) =>
    push(legs.map((l, k) => (k === i ? { ...l, ...patch } : l)));

  return (
    <div className="rounded-md border border-dashed p-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">快速套用：</span>
        {TEMPLATES.map((tpl) => (
          <Button
            key={tpl.key}
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => push(tpl.make(underlying, expiry), tpl.key)}
          >{tpl.label}</Button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">標的（Underlying）</Label>
          <Input
            value={underlying}
            placeholder="例：SNDK"
            onChange={(e) => {
              const v = e.target.value.toUpperCase();
              push(legs.map((l) => ({ ...l, underlying: v })));
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">到期日（套用全部腿）</Label>
          <Input
            type="date"
            value={expiry}
            onChange={(e) => push(legs.map((l) => ({ ...l, expiry: e.target.value })))}
          />
        </div>
      </div>

      <div className="space-y-2">
        {legs.map((l, i) => (
          <div key={i} className="grid grid-cols-12 gap-2 items-end">
            <div className="col-span-3 space-y-1">
              <Label className="text-[10px] text-muted-foreground">買/賣</Label>
              <Select value={l.side} onValueChange={(v) => patchLeg(i, { side: v as any })}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="long">買進 Long</SelectItem>
                  <SelectItem value="short">賣出 Short</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 space-y-1">
              <Label className="text-[10px] text-muted-foreground">C/P</Label>
              <Select value={l.right} onValueChange={(v) => patchLeg(i, { right: v as any })}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="C">Call</SelectItem>
                  <SelectItem value="P">Put</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-3 space-y-1">
              <Label className="text-[10px] text-muted-foreground">履約價</Label>
              <Input
                type="number"
                className="h-9"
                value={l.strike || ''}
                onChange={(e) => patchLeg(i, { strike: parseFloat(e.target.value) || 0 })}
              />
            </div>
            <div className="col-span-3 space-y-1">
              <Label className="text-[10px] text-muted-foreground">權利金/股</Label>
              <Input
                type="number"
                step="0.01"
                className="h-9"
                value={l.price || ''}
                onChange={(e) => patchLeg(i, { price: parseFloat(e.target.value) || 0 })}
              />
            </div>
            <div className="col-span-1 flex justify-end">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive"
                onClick={() => push(legs.filter((_, k) => k !== i))}
              ><Trash2 className="h-4 w-4" /></Button>
            </div>
            {buildOccSymbol(l) && (
              <div className="col-span-12 -mt-1 text-[10px] text-muted-foreground font-mono">
                {buildOccSymbol(l)}
              </div>
            )}
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full border-dashed h-8 text-xs"
          onClick={() => push([...legs, emptyComboLeg(underlying, expiry)])}
        ><Plus className="h-3.5 w-3.5 mr-1" /> 新增一腿</Button>
      </div>

      <div className="rounded-md bg-muted/40 p-3 text-xs space-y-1">
        <div className="flex justify-between">
          <span className="text-muted-foreground">組合</span>
          <span className="font-mono font-semibold">{formatComboLabel(legs) || '—'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">策略</span>
          <span>{COMBO_STRATEGY_LABELS[strategy || detectComboStrategy(legs)]}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">每組淨權利金</span>
          <span className={metrics.netPremium >= 0 ? 'text-success' : ''}>
            {metrics.netPremium >= 0 ? `收 ${fmt(metrics.netPremium)}` : `付 ${fmt(-metrics.netPremium)}`}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">每組最大損失（佔用資金）</span>
          <span className="font-semibold">
            {metrics.maxLossPerUnit === null ? '風險無限' : fmt(metrics.maxLossPerUnit)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">每組最大獲利</span>
          <span>{metrics.maxProfitPerUnit === null ? '無上限' : fmt(metrics.maxProfitPerUnit)}</span>
        </div>
        {!check.ok && <div className="pt-1 text-destructive">{check.error}</div>}
      </div>
    </div>
  );
}
