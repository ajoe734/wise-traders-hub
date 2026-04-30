import { useEffect, useMemo, useState } from 'react';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, Brain, Activity } from 'lucide-react';
import { logAdminAction } from '@/lib/auditLog';

const CATEGORIES = [
  { key: 'chip_analysis', label: '籌碼分析' },
  { key: 'technical_analysis', label: '技術分析' },
  { key: 'industry_trends', label: '產業趨勢' },
  { key: 'strategy_cases', label: '策略案例' },
  { key: 'news_correlation', label: '新聞事件' },
] as const;

type Category = typeof CATEGORIES[number]['key'];

interface KnowledgeItem {
  id: string;
  category: Category;
  item_id: string;
  title: string;
  fact: string;
  interpretation: string | null;
  action: string | null;
  lessons: string | null;
  return_pct: number | null;
  outcome: string | null;
  confidence: number | null;
  tags: string[] | null;
  is_active: boolean;
  version: number;
  updated_at: string;
}

const emptyItem = (category: Category): Partial<KnowledgeItem> => ({
  category,
  item_id: '',
  title: '',
  fact: '',
  interpretation: '',
  action: '',
  lessons: '',
  return_pct: 0,
  outcome: 'success',
  confidence: 0.75,
  tags: [],
  is_active: true,
});

interface UsageStat {
  knowledge_item_id: string;
  hit_count: number;
  hit_count_7d: number;
  last_hit_at: string | null;
}

export default function KnowledgeBasePage() {
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [usage, setUsage] = useState<Record<string, UsageStat>>({});
  const [loading, setLoading] = useState(true);
  const [activeCat, setActiveCat] = useState<Category>('chip_analysis');
  const [editing, setEditing] = useState<Partial<KnowledgeItem> | null>(null);
  const [tagsInput, setTagsInput] = useState('');

  async function load() {
    setLoading(true);
    const [itemsRes, usageRes] = await Promise.all([
      supabase.from('checkup_knowledge_items').select('*').order('category').order('item_id'),
      supabase.from('checkup_knowledge_usage_stats' as any).select('*'),
    ]);
    if (itemsRes.error) {
      toast.error('讀取失敗：' + itemsRes.error.message);
    } else {
      setItems((itemsRes.data ?? []) as any);
    }
    if (!usageRes.error && Array.isArray(usageRes.data)) {
      const map: Record<string, UsageStat> = {};
      for (const row of usageRes.data as any[]) {
        map[row.knowledge_item_id] = row as UsageStat;
      }
      setUsage(map);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const grouped = useMemo(() => {
    const m: Record<Category, KnowledgeItem[]> = {
      chip_analysis: [], technical_analysis: [], industry_trends: [],
      strategy_cases: [], news_correlation: [],
    };
    for (const it of items) m[it.category]?.push(it);
    return m;
  }, [items]);

  function openNew() {
    setEditing(emptyItem(activeCat));
    setTagsInput('');
  }
  function openEdit(item: KnowledgeItem) {
    setEditing({ ...item });
    setTagsInput((item.tags ?? []).join(', '));
  }

  async function save() {
    if (!editing) return;
    const e = editing;
    if (!e.item_id || !e.title || !e.fact || !e.category) {
      toast.error('代號 / 標題 / 事實 為必填');
      return;
    }
    const tags = tagsInput.split(',').map(t => t.trim()).filter(Boolean);
    const payload: any = {
      category: e.category,
      item_id: e.item_id,
      title: e.title,
      fact: e.fact,
      interpretation: e.interpretation ?? null,
      action: e.action ?? null,
      lessons: e.lessons ?? null,
      return_pct: e.return_pct ?? null,
      outcome: e.outcome ?? null,
      confidence: e.confidence ?? 0.75,
      tags,
      is_active: e.is_active ?? true,
    };

    let result;
    const isUpdate = Boolean((e as any).id);
    if (isUpdate) {
      const before = items.find(x => x.id === (e as any).id);
      result = await supabase.from('checkup_knowledge_items')
        .update(payload).eq('id', (e as any).id).select().single();
      if (!result.error) {
        await logAdminAction({
          action: 'knowledge.update',
          targetType: 'checkup_knowledge_items',
          targetId: (e as any).id,
          detail: { before, after: result.data },
        });
      }
    } else {
      result = await supabase.from('checkup_knowledge_items')
        .insert(payload).select().single();
      if (!result.error) {
        await logAdminAction({
          action: 'knowledge.create',
          targetType: 'checkup_knowledge_items',
          targetId: result.data?.id,
          detail: { after: result.data },
        });
      }
    }
    if (result.error) {
      toast.error('儲存失敗：' + result.error.message);
      return;
    }
    toast.success(isUpdate ? '已更新（版本自動 +1）' : '已新增');
    setEditing(null);
    load();
  }

  async function remove(item: KnowledgeItem) {
    if (!confirm(`確定刪除「${item.title}」？`)) return;
    const { error } = await supabase
      .from('checkup_knowledge_items').delete().eq('id', item.id);
    if (error) { toast.error(error.message); return; }
    await logAdminAction({
      action: 'knowledge.delete',
      targetType: 'checkup_knowledge_items',
      targetId: item.id,
      detail: { before: item },
    });
    toast.success('已刪除');
    load();
  }

  async function toggleActive(item: KnowledgeItem) {
    const { error, data } = await supabase
      .from('checkup_knowledge_items')
      .update({ is_active: !item.is_active })
      .eq('id', item.id)
      .select().single();
    if (error) { toast.error(error.message); return; }
    await logAdminAction({
      action: item.is_active ? 'knowledge.deactivate' : 'knowledge.activate',
      targetType: 'checkup_knowledge_items',
      targetId: item.id,
      detail: { before: item, after: data },
    });
    load();
  }

  return (
    <CompanyLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Brain className="h-6 w-6" /> 持倉看板知識庫
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              共 {items.length} 條 · 雲端為權威來源 · AI 分析會即時注入到 prompt
            </p>
          </div>
          <Button onClick={openNew}><Plus className="h-4 w-4 mr-1" />新增條目</Button>
        </div>

        <Tabs value={activeCat} onValueChange={(v) => setActiveCat(v as Category)}>
          <TabsList>
            {CATEGORIES.map(c => (
              <TabsTrigger key={c.key} value={c.key}>
                {c.label} ({grouped[c.key]?.length ?? 0})
              </TabsTrigger>
            ))}
          </TabsList>

          {CATEGORIES.map(c => (
            <TabsContent key={c.key} value={c.key} className="space-y-2 mt-4">
              {loading && <p className="text-sm text-muted-foreground">載入中…</p>}
              {!loading && grouped[c.key].length === 0 && (
                <p className="text-sm text-muted-foreground">尚無條目</p>
              )}
              {grouped[c.key].map(item => (
                <div key={item.id} className="border rounded-lg p-4 bg-card">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <code className="text-xs text-muted-foreground">{item.item_id}</code>
                        <span className="font-medium">{item.title}</span>
                        <Badge variant="outline">v{item.version}</Badge>
                        <Badge variant={item.is_active ? 'default' : 'secondary'}>
                          {item.is_active ? '啟用' : '停用'}
                        </Badge>
                        <Badge variant="outline">
                          信心 {((item.confidence ?? 0) * 100).toFixed(0)}%
                        </Badge>
                        {(() => {
                          const u = usage[item.id];
                          const total = u?.hit_count ?? 0;
                          const recent = u?.hit_count_7d ?? 0;
                          if (total === 0) {
                            return <Badge variant="outline" className="text-muted-foreground">未被使用</Badge>;
                          }
                          return (
                            <Badge variant={recent > 0 ? 'default' : 'secondary'} className="gap-1">
                              <Activity className="h-3 w-3" />
                              使用中 · 7天 {recent} / 累計 {total}
                            </Badge>
                          );
                        })()}
                        {usage[item.id]?.last_hit_at && (
                          <span className="text-xs text-muted-foreground">
                            最近：{new Date(usage[item.id].last_hit_at!).toLocaleString('zh-TW', { hour12: false })}
                          </span>
                        )}
                      </div>
                      <p className="text-sm mt-2 text-muted-foreground line-clamp-2">{item.fact}</p>
                      {item.tags && item.tags.length > 0 && (
                        <div className="flex gap-1 mt-2 flex-wrap">
                          {item.tags.map(t => (
                            <Badge key={t} variant="secondary" className="text-xs">{t}</Badge>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Switch
                        checked={item.is_active}
                        onCheckedChange={() => toggleActive(item)}
                      />
                      <Button variant="ghost" size="icon" onClick={() => openEdit(item)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => remove(item)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </TabsContent>
          ))}
        </Tabs>

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
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>信心度（0–1）</Label>
                    <Input type="number" min={0} max={1} step="0.01"
                      value={editing.confidence ?? 0.75}
                      onChange={(e) => setEditing({ ...editing, confidence: Number(e.target.value) })}
                    />
                  </div>
                  <div className="flex items-end gap-2 pb-1">
                    <Switch
                      checked={editing.is_active ?? true}
                      onCheckedChange={(v) => setEditing({ ...editing, is_active: v })}
                    />
                    <Label>啟用（停用則不會注入 prompt）</Label>
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
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditing(null)}>取消</Button>
              <Button onClick={save}>儲存</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </CompanyLayout>
  );
}
