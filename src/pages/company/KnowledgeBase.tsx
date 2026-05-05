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
import { BackfillProgressPanel } from './knowledge-base/BackfillProgressPanel';
import { BacktestRunDetailDialog } from './knowledge-base/BacktestRunDetailDialog';
import { GridSearchDetailDialog } from './knowledge-base/GridSearchDetailDialog';
import { AutoRulesPanel } from './knowledge-base/AutoRulesPanel';

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
  const [mainTab, setMainTab] = useState<'items' | 'candidates' | 'backtest'>('items');
  const [backtestRuns, setBacktestRuns] = useState<any[]>([]);
  const [backtesting, setBacktesting] = useState<string | null>(null);
  const [gridSearching, setGridSearching] = useState<string | null>(null);
  const [backfilling, setBackfilling] = useState(false);
  const [openRunDetail, setOpenRunDetail] = useState<string | null>(null);
  const [openGridDetail, setOpenGridDetail] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const [itemsRes, usageRes, candRes, runsRes] = await Promise.all([
      supabase.from('checkup_knowledge_items').select('*').order('category').order('item_id'),
      supabase.from('checkup_knowledge_usage_stats' as any).select('*'),
      supabase.from('checkup_knowledge_candidates' as any).select('*').order('created_at', { ascending: false }),
      supabase.from('knowledge_backtest_runs' as any).select('*').order('created_at', { ascending: false }).limit(200),
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
    if (!runsRes.error && Array.isArray(runsRes.data)) {
      setBacktestRuns(runsRes.data as any[]);
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

  const [bulkApproving, setBulkApproving] = useState(false);

  async function bulkApprove(minConfidence = 0) {
    const targets = pendingCandidates.filter(c => (c.confidence ?? 0) >= minConfidence);
    if (targets.length === 0) { toast.info('沒有符合條件的候選'); return; }
    if (!confirm(`確定一鍵核可 ${targets.length} 條候選${minConfidence > 0 ? `（信心 ≥ ${(minConfidence*100).toFixed(0)}%）` : ''}？`)) return;
    setBulkApproving(true);
    let ok = 0, fail = 0;
    for (const c of targets) {
      try { await approveCandidate(c, { silent: true }); ok++; }
      catch { fail++; }
    }
    setBulkApproving(false);
    toast.success(`已核可 ${ok} 條${fail ? `（失敗 ${fail}）` : ''}`);
    load();
  }

  async function bulkReject() {
    if (pendingCandidates.length === 0) return;
    if (!confirm(`確定一鍵退回所有 ${pendingCandidates.length} 條候選？`)) return;
    setBulkApproving(true);
    const ids = pendingCandidates.map(c => c.id);
    await supabase.from('checkup_knowledge_candidates' as any)
      .update({ status: 'rejected', reviewer_note: 'bulk reject', reviewed_at: new Date().toISOString() })
      .in('id', ids);
    setBulkApproving(false);
    toast.success(`已退回 ${ids.length} 條`);
    load();
  }

  async function approveCandidate(c: Candidate, opts: { silent?: boolean } = {}) {
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

  async function runBacktest(item: KnowledgeItem) {
    if (!item.trigger_condition?.type) {
      toast.error('此條目無 trigger_condition.type，無法回測');
      return;
    }
    setBacktesting(item.id);
    try {
      const { data, error } = await supabase.functions.invoke('knowledge-backtest', {
        body: { mode: 'single', item_id: item.id },
      });
      if (error) throw error;
      if (data?.error === 'INSUFFICIENT_DATA') {
        toast.error(data.message || '歷史資料不足');
      } else {
        const stats = data?.results?.[0]?.stats;
        toast.success(`回測完成：命中 ${stats?.total_hits ?? 0} 筆，勝率 ${stats?.win_rate != null ? (stats.win_rate * 100).toFixed(1) + '%' : 'N/A'}`);
      }
      load();
    } catch (err: any) {
      toast.error('回測失敗：' + (err?.message ?? String(err)));
    } finally {
      setBacktesting(null);
    }
  }

  async function runGridSearch(item: KnowledgeItem) {
    if (!item.trigger_condition?.type) {
      toast.error('此條目無 trigger_condition.type，無法網格搜尋');
      return;
    }
    const promote = window.confirm('找到更佳參數時是否自動歸檔舊版並升級？\n（按「確定」=自動升級；按「取消」=只跑搜尋不升級）');
    setGridSearching(item.id);
    try {
      const { data, error } = await supabase.functions.invoke('knowledge-backtest', {
        body: { mode: 'grid_search', item_id: item.id, promote_if_better: promote },
      });
      if (error) throw error;
      const best = data?.best;
      if (data?.promoted) {
        toast.success(`已升級到 v+1：勝率 ${(best?.stats?.win_rate * 100).toFixed(1)}%`);
      } else {
        toast.success(`網格搜尋完成（${data?.grid_size ?? 0} 組），最佳勝率 ${best?.stats?.win_rate != null ? (best.stats.win_rate * 100).toFixed(1) + '%' : 'N/A'}`);
      }
      load();
    } catch (err: any) {
      toast.error('網格搜尋失敗：' + (err?.message ?? String(err)));
    } finally {
      setGridSearching(null);
    }
  }

  async function runBackfill() {
    if (!window.confirm('將從 TWSE 拉取近 36 個月日 K 資料，需要分多次執行（每次 ~50 秒）。確定開始？')) return;
    setBackfilling(true);
    try {
      const { data, error } = await supabase.functions.invoke('backfill-daily-snapshots', {
        body: { months: 36 },
      });
      if (error) throw error;
      toast.success(`回填完成：寫入 ${data?.rows_inserted ?? 0} 筆${data?.partial ? '（未完成，請再次點擊繼續）' : ''}`);
    } catch (err: any) {
      toast.error('回填失敗：' + (err?.message ?? String(err)));
    } finally {
      setBackfilling(false);
    }
  }

  // ---- 報表分頁衍生資料 ----
  const backtestReport = useMemo(() => {
    const backtestable = items.filter(i => (i as any).backtestable && i.is_active);
    const withSamples = backtestable.filter(i => (i.sample_size ?? 0) >= 30);
    const distribution = { excellent: 0, good: 0, fair: 0, poor: 0, untested: 0 };
    const toArchive: KnowledgeItem[] = [];
    const toOptimize: KnowledgeItem[] = [];
    for (const it of backtestable) {
      const wr = it.win_rate;
      if (wr == null || (it.sample_size ?? 0) < 30) {
        distribution.untested++;
        continue;
      }
      if (wr >= 0.7) distribution.excellent++;
      else if (wr >= 0.55) distribution.good++;
      else if (wr >= 0.45) distribution.fair++;
      else distribution.poor++;

      if (wr < 0.45) toArchive.push(it);
      else if (wr >= 0.45 && wr < 0.6) toOptimize.push(it);
    }
    return { backtestable, withSamples, distribution, toArchive, toOptimize };
  }, [items]);

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
            <TabsTrigger value="backtest">淘弱加強 ({backtestReport.withSamples.length}/{backtestReport.backtestable.length})</TabsTrigger>
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
                          {(item as any).backtestable && (
                            <>
                              <Button
                                variant="ghost" size="sm"
                                onClick={() => runBacktest(item)}
                                disabled={backtesting === item.id}
                                title="用歷史資料回測勝率"
                              >
                                {backtesting === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : '回測'}
                              </Button>
                              <Button
                                variant="ghost" size="sm"
                                onClick={() => runGridSearch(item)}
                                disabled={gridSearching === item.id}
                                title="跑參數網格搜尋最佳組合"
                              >
                                {gridSearching === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : '網格'}
                              </Button>
                            </>
                          )}
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

          <TabsContent value="backtest" className="space-y-6 mt-4">
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
                        <Button size="sm" variant="outline" onClick={() => runGridSearch(it)} disabled={gridSearching === it.id}>
                          {gridSearching === it.id ? <Loader2 className="h-4 w-4 animate-spin" /> : '網格救援'}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => toggleActive(it)}>停用</Button>
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
                        <Button size="sm" onClick={() => runGridSearch(it)} disabled={gridSearching === it.id}>
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
                    return (
                      <button
                        key={r.id}
                        onClick={() => isGrid ? setOpenGridDetail(r.id) : setOpenRunDetail(r.id)}
                        className="w-full border rounded p-2 text-sm flex items-center gap-3 flex-wrap text-left hover:bg-muted/50 transition-colors"
                      >
                        <Badge variant={isGrid ? 'default' : 'outline'}>{r.run_mode}</Badge>
                        <code className="text-xs text-muted-foreground">{item?.item_id ?? r.knowledge_item_id?.slice(0, 8)}</code>
                        <span className="flex-1 truncate">{item?.title ?? '(已刪除)'}</span>
                        {r.auto_action && (
                          <Badge variant={r.auto_action.includes('archived') ? 'destructive' : 'secondary'} className="text-xs">
                            {r.auto_action}
                          </Badge>
                        )}
                        {r.win_rate != null && <span>勝率 {(r.win_rate * 100).toFixed(1)}%</span>}
                        <span className="text-muted-foreground">n={r.total_hits}</span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(r.created_at).toLocaleString('zh-TW', { hour12: false })}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>

        <BacktestRunDetailDialog runId={openRunDetail} onClose={() => setOpenRunDetail(null)} />
        <GridSearchDetailDialog runId={openGridDetail} onClose={() => setOpenGridDetail(null)} />

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
