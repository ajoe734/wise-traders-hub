import { useState } from 'react';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Pencil, Trash2, Brain, Activity, Sparkles, Check, X, Loader2, TrendingUp, Plus } from 'lucide-react';
import { BacktestRunDetailDialog } from './knowledge-base/BacktestRunDetailDialog';
import { GridSearchDetailDialog } from './knowledge-base/GridSearchDetailDialog';
import { CleanupCandidatesPanel } from './knowledge-base/CleanupCandidatesPanel';
import { KnowledgeItemEditor } from './knowledge-base/KnowledgeItemEditor';
import { BacktestTab } from './knowledge-base/BacktestTab';
import {
  useKnowledgeBase, CATEGORIES, emptyItem,
  type Category, type KnowledgeItem,
} from '@/hooks/useKnowledgeBase';

export default function KnowledgeBasePage() {
  const kb = useKnowledgeBase();
  const {
    items, usage, candidates: _candidates, backtestRuns,
    grouped, pendingCandidates, backtestReport, recentSummary,
    loading,
    saveItem, removeItem, toggleActive,
    draftWithClaude, approveCandidate, rejectCandidate,
    bulkApprove, bulkReject,
    runBacktest, runGridSearch,
    drafting, bulkApproving, backtesting, gridSearching,
  } = kb;

  const [activeCat, setActiveCat] = useState<Category>('chip_analysis');
  const [editing, setEditing] = useState<Partial<KnowledgeItem> | null>(null);
  const [tagsInput, setTagsInput] = useState('');
  const [industryTagsInput, setIndustryTagsInput] = useState('');
  const [draftCount, setDraftCount] = useState(10);
  const [mainTab, setMainTab] = useState<'items' | 'candidates' | 'backtest' | 'cleanup'>('items');
  const [openRunDetail, setOpenRunDetail] = useState<string | null>(null);
  const [openGridDetail, setOpenGridDetail] = useState<string | null>(null);

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
  async function handleSave() {
    if (!editing) return;
    const ok = await saveItem(editing, tagsInput, industryTagsInput);
    if (ok) setEditing(null);
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
            <Button
              onClick={() => draftWithClaude(activeCat, draftCount, () => setMainTab('candidates'))}
              disabled={drafting} variant="outline"
            >
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
            <TabsTrigger value="cleanup">待清理候選</TabsTrigger>
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
                            {(() => {
                              const ls = item.lifecycle_status ?? 'active';
                              const map: Record<string, { label: string; cls: string }> = {
                                active: { label: '使用中', cls: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
                                candidate: { label: '備選', cls: 'bg-amber-100 text-amber-800 border-amber-200' },
                                rescue: { label: '救援中', cls: 'bg-orange-100 text-orange-800 border-orange-200' },
                                archived: { label: '已歸檔', cls: 'bg-muted text-muted-foreground' },
                              };
                              const m = map[ls] ?? map.active;
                              return <Badge variant="outline" className={m.cls}>{m.label}</Badge>;
                            })()}
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
                          <Button variant="ghost" size="icon" onClick={() => removeItem(item)}>
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
            {pendingCandidates.length > 0 && (
              <div className="flex items-center justify-between gap-3 flex-wrap rounded-2xl border bg-card px-4 py-3">
                <div className="text-sm">
                  待審 <span className="font-semibold">{pendingCandidates.length}</span> 條 ·
                  高信心（≥80%） <span className="font-semibold">{pendingCandidates.filter(c => (c.confidence ?? 0) >= 0.8).length}</span> 條
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" disabled={bulkApproving} onClick={() => bulkApprove(0.8)}>
                    {bulkApproving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Check className="h-4 w-4 mr-1" />}
                    一鍵核可（高信心 ≥80%）
                  </Button>
                  <Button size="sm" disabled={bulkApproving} onClick={() => bulkApprove(0)}>
                    {bulkApproving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Check className="h-4 w-4 mr-1" />}
                    一鍵核可全部
                  </Button>
                  <Button size="sm" variant="ghost" disabled={bulkApproving} onClick={bulkReject}>
                    <X className="h-4 w-4 mr-1" />全部退回
                  </Button>
                </div>
              </div>
            )}
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

          <TabsContent value="backtest">
            <BacktestTab
              items={items}
              backtestRuns={backtestRuns}
              backtestReport={backtestReport}
              recentSummary={recentSummary}
              gridSearching={gridSearching}
              onGridSearch={runGridSearch}
              onToggleActive={toggleActive}
              onOpenRunDetail={setOpenRunDetail}
              onOpenGridDetail={setOpenGridDetail}
            />
          </TabsContent>

          <TabsContent value="cleanup" className="space-y-2 mt-4">
            <CleanupCandidatesPanel onChanged={kb.load} />
          </TabsContent>
        </Tabs>

        <BacktestRunDetailDialog runId={openRunDetail} onClose={() => setOpenRunDetail(null)} />
        <GridSearchDetailDialog runId={openGridDetail} onClose={() => setOpenGridDetail(null)} />

        <KnowledgeItemEditor
          editing={editing}
          setEditing={setEditing}
          tagsInput={tagsInput}
          setTagsInput={setTagsInput}
          industryTagsInput={industryTagsInput}
          setIndustryTagsInput={setIndustryTagsInput}
          onSave={handleSave}
        />
      </div>
    </CompanyLayout>
  );
}
