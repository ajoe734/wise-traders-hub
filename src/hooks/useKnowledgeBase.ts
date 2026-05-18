import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { logAdminAction } from '@/lib/auditLog';

export const CATEGORIES = [
  { key: 'chip_analysis', label: '籌碼分析' },
  { key: 'technical_analysis', label: '技術分析' },
  { key: 'industry_trends', label: '產業趨勢' },
  { key: 'strategy_cases', label: '策略案例' },
  { key: 'news_correlation', label: '新聞事件' },
] as const;

export type Category = typeof CATEGORIES[number]['key'];

export interface KnowledgeItem {
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
  lifecycle_status?: 'active' | 'candidate' | 'rescue' | 'archived';
  rescue_started_at?: string | null;
  rescue_attempts?: number;
  candidate_observed_since?: string | null;
  archived_reason?: string | null;
}

export interface Candidate {
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

export interface UsageStat {
  knowledge_item_id: string;
  hit_count: number;
  hit_count_7d: number;
  last_hit_at: string | null;
}

export const emptyItem = (category: Category): Partial<KnowledgeItem> => ({
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

/**
 * Knowledge-base data layer. Owns the single useQuery snapshot, derived
 * aggregates, and all 12 mutations. UI state (which tab/category, dialog
 * open, per-row loading flags) stays in components.
 */
export function useKnowledgeBase() {
  const queryClient = useQueryClient();

  const { data, isFetching } = useQuery({
    queryKey: ['company', 'knowledge-base'],
    queryFn: async () => {
      const [itemsRes, usageRes, candRes, runsRes] = await Promise.all([
        supabase.from('checkup_knowledge_items').select('*').order('category').order('item_id'),
        supabase.from('checkup_knowledge_usage_stats' as any).select('*'),
        supabase.from('checkup_knowledge_candidates' as any).select('*').order('created_at', { ascending: false }),
        supabase.from('knowledge_backtest_runs' as any).select('*').order('created_at', { ascending: false }).limit(200),
      ]);
      if (itemsRes.error) toast.error('讀取失敗：' + itemsRes.error.message);
      const usageMap: Record<string, UsageStat> = {};
      if (!usageRes.error && Array.isArray(usageRes.data)) {
        for (const row of usageRes.data as any[]) {
          usageMap[row.knowledge_item_id] = row as UsageStat;
        }
      }
      return {
        items: ((itemsRes.data ?? []) as any) as KnowledgeItem[],
        usage: usageMap,
        candidates: (candRes.error ? [] : (candRes.data ?? [])) as unknown as Candidate[],
        backtestRuns: (runsRes.error ? [] : (runsRes.data ?? [])) as unknown as any[],
      };
    },
    staleTime: 60_000,
  });

  const items = data?.items ?? [];
  const usage = data?.usage ?? {};
  const candidates = data?.candidates ?? [];
  const backtestRuns = data?.backtestRuns ?? [];
  const loading = isFetching && !data;

  const load = () => queryClient.invalidateQueries({ queryKey: ['company', 'knowledge-base'] });

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

  const recentSummary = useMemo(() => {
    const since = Date.now() - 24 * 60 * 60 * 1000;
    const recent = backtestRuns.filter((r: any) => new Date(r.created_at).getTime() >= since);
    const success = recent.filter((r: any) => r.status === 'completed');
    const failed = recent.filter((r: any) => r.status === 'failed');
    const autoActions = success.filter((r: any) => !!r.auto_action);
    const byItem = new Map<string, any[]>();
    for (const r of backtestRuns) {
      if (r.status !== 'completed' || r.win_rate == null || !r.knowledge_item_id) continue;
      if (!byItem.has(r.knowledge_item_id)) byItem.set(r.knowledge_item_id, []);
      byItem.get(r.knowledge_item_id)!.push(r);
    }
    const deltas: { item_id: string; title: string; prev: number; cur: number; delta: number }[] = [];
    for (const r of success) {
      if (r.win_rate == null) continue;
      const list = byItem.get(r.knowledge_item_id) ?? [];
      const prev = list.find((x: any) => new Date(x.created_at).getTime() < new Date(r.created_at).getTime());
      if (!prev || prev.win_rate == null) continue;
      const item = items.find(i => i.id === r.knowledge_item_id);
      deltas.push({
        item_id: r.knowledge_item_id,
        title: item?.title ?? r.knowledge_item_id?.slice(0, 8),
        prev: Number(prev.win_rate),
        cur: Number(r.win_rate),
        delta: Number(r.win_rate) - Number(prev.win_rate),
      });
    }
    deltas.sort((a, b) => b.delta - a.delta);
    return {
      total: recent.length,
      success: success.length,
      failed,
      autoActions,
      topGain: deltas[0],
      topLoss: deltas[deltas.length - 1],
    };
  }, [backtestRuns, items]);

  // ---------- mutations ----------
  const [drafting, setDrafting] = useState(false);
  const [bulkApproving, setBulkApproving] = useState(false);
  const [backtesting, setBacktesting] = useState<string | null>(null);
  const [gridSearching, setGridSearching] = useState<string | null>(null);
  const [backfilling, setBackfilling] = useState(false);

  async function saveItem(
    editing: Partial<KnowledgeItem>,
    tagsInput: string,
    industryTagsInput: string,
  ): Promise<boolean> {
    if (!editing.item_id || !editing.title || !editing.fact || !editing.category) {
      toast.error('代號 / 標題 / 事實 為必填');
      return false;
    }
    const tags = tagsInput.split(',').map(t => t.trim()).filter(Boolean);
    const industryTags = industryTagsInput.split(',').map(t => t.trim()).filter(Boolean);
    const payload: any = {
      category: editing.category,
      item_id: editing.item_id,
      title: editing.title,
      fact: editing.fact,
      interpretation: editing.interpretation ?? null,
      action: editing.action ?? null,
      lessons: editing.lessons ?? null,
      return_pct: editing.return_pct ?? null,
      outcome: editing.outcome ?? null,
      confidence: editing.confidence ?? 0.75,
      tags,
      industry_tags: industryTags,
      time_horizon: editing.time_horizon || null,
      trigger_condition: (editing as any).trigger_condition ?? null,
      expected_outcome: (editing as any).expected_outcome ?? null,
      is_active: editing.is_active ?? true,
    };

    const isUpdate = Boolean((editing as any).id);
    let result;
    if (isUpdate) {
      const before = items.find(x => x.id === (editing as any).id);
      result = await supabase.from('checkup_knowledge_items')
        .update(payload).eq('id', (editing as any).id).select().single();
      if (!result.error) {
        await logAdminAction({
          action: 'knowledge.update',
          targetType: 'checkup_knowledge_items',
          targetId: (editing as any).id,
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
      return false;
    }
    toast.success(isUpdate ? '已更新（版本自動 +1）' : '已新增');
    load();
    return true;
  }

  async function removeItem(item: KnowledgeItem) {
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

  async function draftWithClaude(activeCat: Category, draftCount: number, onSuccess?: () => void) {
    setDrafting(true);
    try {
      const { data, error } = await supabase.functions.invoke('knowledge-draft-claude', {
        body: { category: activeCat, count: draftCount },
      });
      if (error) throw error;
      toast.success(`Claude 草擬完成：新增 ${data?.inserted ?? 0} 條候選`);
      onSuccess?.();
      load();
    } catch (err: any) {
      toast.error('草擬失敗：' + (err?.message ?? String(err)));
    } finally {
      setDrafting(false);
    }
  }

  async function approveCandidate(c: Candidate, opts: { silent?: boolean } = {}) {
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
      if (!opts.silent) toast.error('核可失敗：' + ins.error.message);
      throw ins.error;
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
    if (!opts.silent) {
      toast.success('已核可並寫入正式知識庫');
      load();
    }
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

  async function runBacktest(item: KnowledgeItem) {
    if (!item.trigger_condition?.type) {
      toast.error('此條目無 trigger_condition.type，無法回測');
      return;
    }
    setBacktesting(item.id);
    const prevWr = item.win_rate;
    const prevN = item.sample_size ?? 0;
    try {
      const { data, error } = await supabase.functions.invoke('knowledge-backtest', {
        body: { mode: 'single', item_id: item.id },
      });
      if (error) throw error;
      if (data?.error === 'INSUFFICIENT_DATA') {
        toast.error(data.message || '歷史資料不足，請先完成「初始化（36 個月）」回填');
      } else {
        const stats = data?.results?.[0]?.stats;
        const newWr = stats?.win_rate;
        const newN = stats?.total_hits ?? 0;
        const wrTxt = newWr != null ? `${(newWr * 100).toFixed(1)}%` : 'N/A';
        const wrDelta = (prevWr != null && newWr != null)
          ? `（${(prevWr * 100).toFixed(1)}% → ${(newWr * 100).toFixed(1)}%，${newWr >= prevWr ? '↑' : '↓'}${Math.abs((newWr - prevWr) * 100).toFixed(1)}pp）`
          : '（首次回測）';
        toast.success(`✅ 回測完成 · ${item.title}\n勝率 ${wrTxt} ${wrDelta}\n樣本 n=${prevN} → ${newN}`);
      }
      load();
    } catch (err: any) {
      toast.error(`❌ 回測失敗 · ${item.title}\n${err?.message ?? String(err)}`);
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

  return {
    // data
    items, usage, candidates, backtestRuns,
    grouped, pendingCandidates, backtestReport, recentSummary,
    loading, load,
    // mutations
    saveItem, removeItem, toggleActive,
    draftWithClaude, approveCandidate, rejectCandidate,
    bulkApprove, bulkReject,
    runBacktest, runGridSearch, runBackfill,
    // flags
    drafting, bulkApproving, backtesting, gridSearching, backfilling,
  };
}
