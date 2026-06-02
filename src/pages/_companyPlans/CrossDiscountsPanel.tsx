import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { CROSS_FIELDS } from '@/pages/_companyPlans/types';

interface Props {
  cross: Record<string, number>;
  crossOriginal: Record<string, number>;
  savingCross: boolean;
  setCross: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  onSave: () => void;
  onReset: () => void;
}

export default function CrossDiscountsPanel({ cross, crossOriginal: _crossOriginal, savingCross, setCross, onSave, onReset }: Props) {
  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div>
          <h3 className="font-semibold">跨產品折扣（NT$）</h3>
          <p className="text-xs text-muted-foreground mt-1">
            已持有某類商品的會員，購買另一類商品時自動套用的折抵金額。設為 0 表示不折抵。
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {CROSS_FIELDS.map(f => (
            <div key={f.key} className="space-y-1">
              <Label className="text-xs font-medium">{f.label}</Label>
              <p className="text-[11px] text-muted-foreground leading-snug">{f.hint}</p>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">NT$</span>
                <Input
                  type="number" min={0}
                  value={cross[f.key] ?? 0}
                  onChange={e => setCross(p => ({ ...p, [f.key]: Number(e.target.value) }))}
                />
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3 pt-2">
          <Button size="sm" onClick={onSave} disabled={savingCross}>
            {savingCross ? '儲存中…' : '儲存折扣設定'}
          </Button>
          <Button size="sm" variant="ghost" onClick={onReset} disabled={savingCross}>還原</Button>
        </div>
      </CardContent>
    </Card>
  );
}
