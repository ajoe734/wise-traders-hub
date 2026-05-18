import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { KnowledgeItem, Category } from '@/hooks/useKnowledgeBase';
import { CATEGORIES } from '@/hooks/useKnowledgeBase';

interface Props {
  editing: Partial<KnowledgeItem> | null;
  setEditing: (e: Partial<KnowledgeItem> | null) => void;
  tagsInput: string;
  setTagsInput: (v: string) => void;
  industryTagsInput: string;
  setIndustryTagsInput: (v: string) => void;
  onSave: () => void;
}

export function KnowledgeItemEditor({
  editing, setEditing, tagsInput, setTagsInput,
  industryTagsInput, setIndustryTagsInput, onSave,
}: Props) {
  return (
    <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{(editing as any)?.id ? '編輯條目' : '新增條目'}</DialogTitle>
        </DialogHeader>
        {editing && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>分類</Label>
                <Select
                  value={editing.category}
                  onValueChange={(v) => setEditing({ ...editing, category: v as Category })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map(c => (
                      <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>條目代號（如 ta-06）</Label>
                <Input
                  value={editing.item_id ?? ''}
                  onChange={(e) => setEditing({ ...editing, item_id: e.target.value })}
                />
              </div>
            </div>
            <div>
              <Label>標題</Label>
              <Input
                value={editing.title ?? ''}
                onChange={(e) => setEditing({ ...editing, title: e.target.value })}
              />
            </div>
            <div>
              <Label>事實 (fact)</Label>
              <Textarea rows={2}
                value={editing.fact ?? ''}
                onChange={(e) => setEditing({ ...editing, fact: e.target.value })}
              />
            </div>
            <div>
              <Label>解讀 (interpretation)</Label>
              <Textarea rows={2}
                value={editing.interpretation ?? ''}
                onChange={(e) => setEditing({ ...editing, interpretation: e.target.value })}
              />
            </div>
            <div>
              <Label>行動 (action)</Label>
              <Textarea rows={2}
                value={editing.action ?? ''}
                onChange={(e) => setEditing({ ...editing, action: e.target.value })}
              />
            </div>
            {editing.category === 'strategy_cases' && (
              <>
                <div>
                  <Label>教訓 (lessons)</Label>
                  <Textarea rows={2}
                    value={editing.lessons ?? ''}
                    onChange={(e) => setEditing({ ...editing, lessons: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>報酬率（小數，0.15 = 15%）</Label>
                    <Input type="number" step="0.01"
                      value={editing.return_pct ?? 0}
                      onChange={(e) => setEditing({ ...editing, return_pct: Number(e.target.value) })}
                    />
                  </div>
                  <div>
                    <Label>結果</Label>
                    <Select
                      value={editing.outcome ?? 'success'}
                      onValueChange={(v) => setEditing({ ...editing, outcome: v })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="success">success</SelectItem>
                        <SelectItem value="failure">failure</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </>
            )}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>信心度（0–1）</Label>
                <Input type="number" min={0} max={1} step="0.01"
                  value={editing.confidence ?? 0.75}
                  onChange={(e) => setEditing({ ...editing, confidence: Number(e.target.value) })}
                />
              </div>
              <div>
                <Label>時間視野</Label>
                <Select
                  value={editing.time_horizon ?? ''}
                  onValueChange={(v) => setEditing({ ...editing, time_horizon: v })}
                >
                  <SelectTrigger><SelectValue placeholder="未設定" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="intraday">當沖</SelectItem>
                    <SelectItem value="short">短線 (1-5d)</SelectItem>
                    <SelectItem value="swing">波段 (1-4w)</SelectItem>
                    <SelectItem value="medium">中線 (1-3m)</SelectItem>
                    <SelectItem value="long">{'長線 (>3m)'}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end gap-2 pb-1">
                <Switch
                  checked={editing.is_active ?? true}
                  onCheckedChange={(v) => setEditing({ ...editing, is_active: v })}
                />
                <Label>啟用</Label>
              </div>
            </div>
            <div>
              <Label>標籤（以逗號分隔）</Label>
              <Input
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                placeholder="半導體, 庫存, 週期"
              />
            </div>
            <div>
              <Label>產業標籤（以逗號分隔）</Label>
              <Input
                value={industryTagsInput}
                onChange={(e) => setIndustryTagsInput(e.target.value)}
                placeholder="semiconductor, biotech, shipping"
              />
            </div>
            <div>
              <Label>觸發條件 (trigger_condition, JSON)</Label>
              <Textarea rows={3}
                value={(editing as any).trigger_condition ? JSON.stringify((editing as any).trigger_condition, null, 2) : ''}
                onChange={(e) => {
                  try {
                    const v = e.target.value.trim() ? JSON.parse(e.target.value) : null;
                    setEditing({ ...editing, trigger_condition: v } as any);
                  } catch { /* 暫存原文 */ }
                }}
                placeholder='{"foreign_buy_days": ">=3", "volume_ratio": ">1.5"}'
              />
            </div>
            <div>
              <Label>預期結果 (expected_outcome, JSON)</Label>
              <Textarea rows={3}
                value={(editing as any).expected_outcome ? JSON.stringify((editing as any).expected_outcome, null, 2) : ''}
                onChange={(e) => {
                  try {
                    const v = e.target.value.trim() ? JSON.parse(e.target.value) : null;
                    setEditing({ ...editing, expected_outcome: v } as any);
                  } catch { /* 暫存原文 */ }
                }}
                placeholder='{"direction": "up", "magnitude_pct": 5, "horizon_days": 10}'
              />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setEditing(null)}>取消</Button>
          <Button onClick={onSave}>儲存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
