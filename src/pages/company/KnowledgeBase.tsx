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
import { Plus, Pencil, Trash2, Brain, Activity, Sparkles, Check, X, Loader2, TrendingUp } from 'lucide-react';
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
  trigger_condition: any;
  expected_outcome: any;
  win_rate: number | null;
  sample_size: number;
  source_type: string;
  industry_tags: string[];
  time_horizon: string | null;
}

interface Candidate {
  id: string;
  category: Category;
  item_id: string | null;
  title: string;
  fact: string;
  interpretation: string | null;
  action: string | null;
  lessons: string | null;
  return_pct: number | null;
  outcome: string | null;
  confidence: number;
  tags: string[];
  trigger_condition: any;
  expected_outcome: any;
  industry_tags: string[];
  time_horizon: string | null;
  status: 'pending' | 'approved' | 'rejected';
  source_type: string;
  source_meta: any;
  reviewer_note: string | null;
  created_at: string;
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
  industry_tags: [],
  time_horizon: '',
});

interface UsageStat {
  knowledge_item_id: string;
  hit_count: number;
  hit_count_7d: number;
  last_hit_at: string | null;
}

export default function KnowledgeBasePage() {
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [usage, setUsage] = useState<Record<string, UsageStat>>({});
  const [loading, setLoading] = useState(true);
  const [activeCat, setActiveCat] = useState<Category>('chip_analysis');
  const [editing, setEditing] = useState<Partial<KnowledgeItem> | null>(null);
  const [tagsInput, setTagsInput] = useState('');
  const [industryTagsInput, setIndustryTagsInput] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [draftCount, setDraftCount] = useState(10);
  const [mainTab, setMainTab] = useState<'items' | 'candidates'>('items');

  async function load() {
    setLoading(true);
    const [itemsRes, usageRes, candRes] = await Promise.all([
      supabase.from('checkup_knowledge_items').select('*').order('category').order('item_id'),
      supabase.from('checkup_knowledge_usage_stats' as any).select('*'),
      supabase.from('checkup_knowledge_candidates' as any).select('*').order('created_at', { ascending: false }),
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
    if (!candRes.error && Array.isArray(candRes.data)) {
      setCandidates(candRes.data as any);
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

  const pendingCandidates = useMemo(
    () => candidates.filter(c => c.status === 'pending'),
    [candidates],
  );

  function openNew() {
    setEditing(emptyItem(activeCat));
    setTagsInput('');
    setIndustryTagsInput('');
  }
  function openEdit(item: KnowledgeItem) {
    setEditing({ ...item });
    setTagsInput((item.tags ?? []).join(', '));
    setIndustryTagsInput((item.industry_tags ?? []).join(', '));
  }

  async function save() {
    if (!editing) return;
    const e = editing;
    if (!e.item_id || !e.title || !e.fact || !e.category) {
      toast.error('代號 / 標題 / 事實 為必填');
      return;
    }
    const tags = tagsInput.split(',').map(t => t.trim()).filter(Boolean);
    const industryTags = industryTagsInput.split(',').map(t => t.trim()).filter(Boolean);
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
      industry_tags: industryTags,
      time_horizon: e.time_horizon || null,
      trigger_condition: (e as any).trigger_condition ?? null,
      expected_outcome: (e as any).expected_outcome ?? null,
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

  async function draftWithClaude() {
    setDrafting(true);
    try {
      const { data, error } = await supabase.functions.invoke('knowledge-draft-claude', {
        body: { category: activeCat, count: draftCount },
      });
      if (error) throw error;
      toast.success(`Claude 草擬完成：新增 ${data?.inserted ?? 0} 條候選`);
      setMainTab('candidates');
      load();
    } catch (err: any) {
      toast.error('草擬失敗：' + (err?.message ?? String(err)));
    } finally {
      setDrafting(false);
    }
  }

  async function approveCandidate(c: Candidate) {
    // 推進到正式 items；item_id 若無則自動命名
    const itemId = c.item_id || `${c.category.split('_')[0]}-${Date.now().toString(36)}`;
    const payload: any = {
      category: c.category,
      item_id: itemId,
      title: c.title,
      fact: c.fact,
      interpretation: c.interpretation,
      action: c.action,
      lessons: c.lessons,
      return_pct: c.return_pct,
      outcome: c.outcome,
      confidence: c.confidence,
      tags: c.tags ?? [],
      industry_tags: c.industry_tags ?? [],
      time_horizon: c.time_horizon,
      trigger_condition: c.trigger_condition,
      expected_outcome: c.expected_outcome,
      source_type: c.source_type ?? 'ai_draft',
      is_active: true,
    };
    const ins = await supabase.from('checkup_knowledge_items').insert(payload).select().single();
    if (ins.error) {
      toast.error('核可失敗：' + ins.error.message);
      return;
    }
    await supabase.from('checkup_knowledge_candidates' as any)
      .update({ status: 'approved', reviewed_at: new Date().toISOString() })
      .eq('id', c.id);
    await logAdminAction({
      action: 'knowledge.candidate.approve',
      targetType: 'checkup_knowledge_candidates',
      targetId: c.id,
      detail: { promoted_to: ins.data?.id },
    });
    toast.success('已核可並寫入正式知識庫');
    load();
  }

  async function rejectCandidate(c: Candidate) {
    const note = prompt('退回原因（選填）：') ?? '';
    await supabase.from('checkup_knowledge_candidates' as any)
      .update({ status: 'rejected', reviewer_note: note, reviewed_at: new Date().toISOString() })
      .eq('id', c.id);
    await logAdminAction({
      action: 'knowledge.candidate.reject',
      targetType: 'checkup_knowledge_candidates',
      targetId: c.id,
      detail: { reason: note },
    });
    toast.success('已退回');
    load();
  }

  return (
    <CompanyLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Brain className="h-6 w-6" /> 持倉看板知識庫
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              正式 {items.length} 條 · 候選待審 {pendingCandidates.length} 條 · 近 7 天命中 {Object.values(usage).reduce((s, u) => s + (u.hit_count_7d ?? 0), 0)} 次
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Input
              type="number" min={1} max={20} value={draftCount}
              onChange={(e) => setDraftCount(Math.max(1, Math.min(20, Number(e.target.value) || 10)))}
              className="w-20"
            />
            <Button onClick={draftWithClaude} disabled={drafting} variant="outline">
              {drafting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1" />}
              Claude 起草（{CATEGORIES.find(c => c.key === activeCat)?.label}）
            </Button>
            <Button onClick={openNew}><Plus className="h-4 w-4 mr-1" />新增條目</Button>
          </div>
        </div>

        <Tabs value={mainTab} onValueChange={(v) => setMainTab(v as any)}>
          <TabsList>
            <TabsTrigger value="items">正式知識庫 ({items.length})</TabsTrigger>
            <TabsTrigger value="candidates">候選審核 ({pendingCandidates.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="items" className="space-y-4 mt-4">
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
                    <p className="text-sm text-muted-foreground">尚無條目，可用上方「Claude 起草」批次產生候選。</p>
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
                            {typeof item.win_rate === 'number' && item.sample_size >= 1 && (
                              <Badge variant="outline" className="gap-1">
                                <TrendingUp className="h-3 w-3" />
                                勝率 {(item.win_rate * 100).toFixed(0)}% (n={item.sample_size})
                              </Badge>
                            )}
                            {item.source_type && item.source_type !== 'editorial' && (
                              <Badge variant="secondary">{item.source_type}</Badge>
                            )}
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
          </TabsContent>

          <TabsContent value="candidates" className="space-y-2 mt-4">
            {pendingCandidates.length === 0 && (
              <p className="text-sm text-muted-foreground">目前沒有待審候選。可用上方「Claude 起草」批次產生。</p>
            )}
            {pendingCandidates.map(c => (
              <div key={c.id} className="border rounded-lg p-4 bg-card">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline">{CATEGORIES.find(x => x.key === c.category)?.label ?? c.category}</Badge>
                      <span className="font-medium">{c.title}</span>
                      <Badge variant="secondary">{c.source_type}</Badge>
                      <Badge variant="outline">信心 {(c.confidence * 100).toFixed(0)}%</Badge>
                      {c.time_horizon && <Badge variant="outline">{c.time_horizon}</Badge>}
                    </div>
                    <p className="text-sm mt-2"><span className="text-muted-foreground">事實：</span>{c.fact}</p>
                    {c.interpretation && <p className="text-sm mt-1"><span className="text-muted-foreground">解讀：</span>{c.interpretation}</p>}
                    {c.action && <p className="text-sm mt-1"><span className="text-muted-foreground">行動：</span>{c.action}</p>}
                    {c.trigger_condition && (
                      <pre className="text-xs bg-muted p-2 rounded mt-2 overflow-x-auto">
                        觸發條件：{JSON.stringify(c.trigger_condition, null, 2)}
                      </pre>
                    )}
                    {c.expected_outcome && (
                      <pre className="text-xs bg-muted p-2 rounded mt-2 overflow-x-auto">
                        預期結果：{JSON.stringify(c.expected_outcome, null, 2)}
                      </pre>
                    )}
                    {(c.tags?.length > 0 || c.industry_tags?.length > 0) && (
                      <div className="flex gap-1 mt-2 flex-wrap">
                        {c.tags?.map(t => (<Badge key={'t-' + t} variant="secondary" className="text-xs">{t}</Badge>))}
                        {c.industry_tags?.map(t => (<Badge key={'i-' + t} variant="outline" className="text-xs">#{t}</Badge>))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button size="sm" onClick={() => approveCandidate(c)}>
                      <Check className="h-4 w-4 mr-1" />核可
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => rejectCandidate(c)}>
                      <X className="h-4 w-4 mr-1" />退回
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </TabsContent>
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
              <Button onClick={save}>儲存</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </CompanyLayout>
  );
}
