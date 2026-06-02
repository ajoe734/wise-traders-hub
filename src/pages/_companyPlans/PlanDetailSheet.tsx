import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { CheckCircle2, XCircle, Pencil, Trash2, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  STATUS_LABEL, PLAN_TYPE_LABEL,
  type PlanRow, type DefaultRule, type SplitForm,
} from '@/pages/_companyPlans/types';

interface Props {
  open: boolean;
  current: PlanRow | null;
  defaultRule: DefaultRule;
  acting: boolean;
  splitEditing: boolean;
  splitForm: SplitForm;
  setSplitForm: React.Dispatch<React.SetStateAction<SplitForm>>;
  setSplitEditing: (v: boolean) => void;
  setOpen: (v: boolean) => void;
  beginEditSplit: (p: PlanRow) => void;
  onApprove: (p: PlanRow) => void;
  onOpenReject: (p: PlanRow) => void;
  onToggleActive: (p: PlanRow, next: boolean) => void;
  onSaveSplit: () => void;
  onRemoveSplit: (p: PlanRow) => void;
}

export default function PlanDetailSheet({
  open, current, defaultRule, acting,
  splitEditing, splitForm, setSplitForm, setSplitEditing,
  setOpen, beginEditSplit,
  onApprove, onOpenReject, onToggleActive, onSaveSplit, onRemoveSplit,
}: Props) {
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) { setOpen(false); setSplitEditing(false); } }}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        {current && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <span>{current.name}</span>
                <Badge className={cn('text-[11px] border', STATUS_LABEL[current.review_status].cls)} variant="outline">
                  {STATUS_LABEL[current.review_status].label}
                </Badge>
              </SheetTitle>
              <SheetDescription>
                {current.experts?.name} / {PLAN_TYPE_LABEL[current.plan_type] || current.plan_type}
              </SheetDescription>
            </SheetHeader>

            <div className="space-y-6 mt-6">
              {/* Plan content */}
              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-muted-foreground">方案內容</h3>
                <div className="rounded-lg border p-3 space-y-2 text-sm">
                  {current.description && <div className="text-muted-foreground">{current.description}</div>}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">月費</span>
                    <span className="tabular-nums font-medium">NT$ {current.price_monthly.toLocaleString()}</span>
                  </div>
                  {current.price_yearly != null && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">年費</span>
                      <span className="tabular-nums font-medium">NT$ {current.price_yearly.toLocaleString()}</span>
                    </div>
                  )}
                  {Array.isArray(current.features) && current.features.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {current.features.filter((f: any) => typeof f === 'string').map((f: string, i: number) => (
                        <Badge key={i} variant="outline" className="text-[10px] gap-1">
                          <Sparkles className="h-2.5 w-2.5" />{f}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </section>

              {/* Review */}
              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-muted-foreground">審核</h3>
                <div className="rounded-lg border p-3 space-y-3">
                  {current.review_status === 'rejected' && current.review_note && (
                    <div className="text-xs text-destructive bg-destructive/5 rounded p-2">
                      退回原因：{current.review_note}
                    </div>
                  )}
                  {current.reviewed_at && (
                    <div className="text-xs text-muted-foreground">
                      審核時間：{new Date(current.reviewed_at).toLocaleString('zh-TW')}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {current.review_status !== 'approved' && (
                      <Button size="sm" onClick={() => onApprove(current)} disabled={acting}>
                        <CheckCircle2 className="h-3.5 w-3.5 mr-1" />核准
                      </Button>
                    )}
                    {current.review_status !== 'rejected' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onOpenReject(current)}
                        disabled={acting}
                      >
                        <XCircle className="h-3.5 w-3.5 mr-1" />
                        {current.review_status === 'approved' ? '撤銷核准' : '退回'}
                      </Button>
                    )}
                  </div>
                </div>
              </section>

              {/* Active toggle */}
              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-muted-foreground">上下架</h3>
                <div className="rounded-lg border p-3 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">{current.is_active ? '前台顯示中' : '前台隱藏'}</div>
                    <div className="text-xs text-muted-foreground">
                      關閉後該方案不會出現在訂閱選擇頁
                    </div>
                  </div>
                  <Switch
                    checked={current.is_active}
                    disabled={acting}
                    onCheckedChange={(v) => onToggleActive(current, v)}
                  />
                </div>
              </section>

              {/* Split override */}
              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-muted-foreground">分潤覆寫</h3>
                <div className="rounded-lg border p-3 space-y-3">
                  <div className="text-sm">
                    目前生效規則：
                    <span className="ml-2 font-medium">
                      {current.override && current.override.is_active
                        ? `${current.override.pct_platform}/${current.override.pct_expert}（此方案覆寫）`
                        : `${defaultRule.pct_platform}/${defaultRule.pct_expert}（全站預設）`}
                    </span>
                  </div>
                  {current.override && !current.override.is_active && (
                    <div className="text-xs text-muted-foreground">
                      已建立覆寫但目前停用中（{current.override.pct_platform}/{current.override.pct_expert}）
                    </div>
                  )}
                  {current.override?.notes && (
                    <div className="text-xs text-muted-foreground">備註：{current.override.notes}</div>
                  )}

                  {!splitEditing ? (
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => beginEditSplit(current)}>
                        <Pencil className="h-3.5 w-3.5 mr-1" />
                        {current.override ? '編輯覆寫' : '新增覆寫'}
                      </Button>
                      {current.override && (
                        <Button size="sm" variant="ghost" onClick={() => onRemoveSplit(current)} disabled={acting}>
                          <Trash2 className="h-3.5 w-3.5 mr-1" />刪除覆寫
                        </Button>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label className="text-xs">平台（%）</Label>
                          <Input
                            type="number" min={0} max={100}
                            value={splitForm.pct_platform}
                            onChange={e => {
                              const v = Math.max(0, Math.min(100, Number(e.target.value) || 0));
                              setSplitForm(p => ({ ...p, pct_platform: v, pct_expert: 100 - v }));
                            }}
                          />
                        </div>
                        <div>
                          <Label className="text-xs">專家（%）</Label>
                          <Input
                            type="number" min={0} max={100}
                            value={splitForm.pct_expert}
                            onChange={e => {
                              const v = Math.max(0, Math.min(100, Number(e.target.value) || 0));
                              setSplitForm(p => ({ ...p, pct_expert: v, pct_platform: 100 - v }));
                            }}
                          />
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <Switch
                          checked={splitForm.is_active}
                          onCheckedChange={(v) => setSplitForm(p => ({ ...p, is_active: v }))}
                        />
                        <Label className="text-sm">啟用此覆寫</Label>
                      </div>
                      <div>
                        <Label className="text-xs">備註（選填）</Label>
                        <Textarea
                          rows={2}
                          value={splitForm.notes}
                          onChange={e => setSplitForm(p => ({ ...p, notes: e.target.value }))}
                        />
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={onSaveSplit} disabled={acting}>儲存</Button>
                        <Button size="sm" variant="ghost" onClick={() => setSplitEditing(false)}>取消</Button>
                      </div>
                    </div>
                  )}
                </div>
              </section>

              <section className="text-xs text-muted-foreground">
                建立於 {new Date(current.created_at).toLocaleString('zh-TW')}
              </section>
            </div>

            <SheetFooter className="mt-6">
              <Button variant="outline" onClick={() => setOpen(false)}>關閉</Button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
