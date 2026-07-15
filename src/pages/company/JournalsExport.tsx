import { useMemo, useState } from 'react';
import { SEO } from '@/components/SEO';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Download, FileText, Filter, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

// ── Taipei week helpers ────────────────────────────────────
const TZ_OFFSET_MS = 8 * 60 * 60 * 1000;
const MS_DAY = 86_400_000;

function taipeiMondayOf(d: Date): string {
  const shifted = new Date(d.getTime() + TZ_OFFSET_MS);
  const day = shifted.getUTCDay();
  const diff = (day + 6) % 7;
  const monday = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate() - diff));
  return monday.toISOString().slice(0, 10);
}

function weekRangeUtc(weekStart: string) {
  const start = new Date(`${weekStart}T00:00:00+08:00`);
  const end = new Date(start.getTime() + 7 * MS_DAY);
  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    startLabel: weekStart,
    endLabel: new Date(end.getTime() - MS_DAY).toISOString().slice(0, 10),
  };
}

// ── CSV helpers ────────────────────────────────────────────
function csvEscape(v: unknown): string {
  const s = v == null ? '' : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
function buildCsv(header: string[], rows: unknown[][]): string {
  const body = [header, ...rows].map((r) => r.map(csvEscape).join(',')).join('\n');
  return '\ufeff' + body;
}
function downloadFile(name: string, content: string, mime: string) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8;` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function fmtTaipei(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const shifted = new Date(d.getTime() + TZ_OFFSET_MS);
  const yyyy = shifted.getUTCFullYear();
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(shifted.getUTCDate()).padStart(2, '0');
  const hh = String(shifted.getUTCHours()).padStart(2, '0');
  const mi = String(shifted.getUTCMinutes()).padStart(2, '0');
  return `${yyyy}/${mm}/${dd} ${hh}:${mi}`;
}

const ASSET_LABEL: Record<string, string> = {
  tw_stock: '台股',
  us_stock: '美股',
  crypto: '加密',
};
type AssetFilter = 'all' | 'tw_stock' | 'us_stock' | 'crypto';
type StatusFilter = 'published_only' | 'all';

interface MentorLite {
  id: string;
  name: string | null;
  slug: string | null;
  asset_class: string | null;
  currency: string | null;
  status: string | null;
}

interface JournalRow {
  id: string;
  status: string | null;
  instrument: string | null;
  action: string | null;
  price_hint: number | null;
  reason_summary: string | null;
  reason_detail: string | null;
  risk_notes: string | null;
  learning_points: string | null;
  published_at: string | null;
  created_at: string | null;
  expert_id: string;
  experts?: {
    name: string | null;
    slug: string | null;
    role: string | null;
    asset_class: string | null;
    currency: string | null;
  } | null;
}

// ── 自動排程與歷史匯出檔區塊 ─────────────────────────────
interface StoredExport {
  path: string;
  name: string;
  week: string;
  size: number | null;
  updatedAt: string | null;
}

function AutoExportSection() {
  const [running, setRunning] = useState(false);

  const { data: files = [], isLoading, refetch } = useQuery({
    queryKey: ['company-journals-export', 'storage-history'],
    queryFn: async (): Promise<StoredExport[]> => {
      // 列出所有週資料夾（bucket 根目錄）
      const { data: folders, error } = await supabase.storage
        .from('journal-exports')
        .list('', { limit: 200, sortBy: { column: 'name', order: 'desc' } });
      if (error) throw error;

      const out: StoredExport[] = [];
      for (const f of folders ?? []) {
        if (!f.name || !/^\d{4}-\d{2}-\d{2}$/.test(f.name)) continue;
        const { data: inner } = await supabase.storage
          .from('journal-exports')
          .list(f.name, { limit: 20, sortBy: { column: 'updated_at', order: 'desc' } });
        for (const file of inner ?? []) {
          out.push({
            path: `${f.name}/${file.name}`,
            name: file.name,
            week: f.name,
            size: (file.metadata as any)?.size ?? null,
            updatedAt: file.updated_at ?? file.created_at ?? null,
          });
        }
      }
      return out.sort((a, b) => b.week.localeCompare(a.week));
    },
    staleTime: 60_000,
  });

  const openDownload = async (path: string) => {
    const { data, error } = await supabase.storage
      .from('journal-exports')
      .createSignedUrl(path, 60 * 10); // 10 分鐘臨時連結
    if (error || !data?.signedUrl) {
      toast.error(`取得下載連結失敗：${error?.message ?? '未知錯誤'}`);
      return;
    }
    window.open(data.signedUrl, '_blank');
  };

  const triggerNow = async () => {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke('weekly-journal-export', { body: {} });
      if (error) throw error;
      toast.success(`已手動觸發：${data?.journals ?? 0} 則 / ${data?.mentors ?? 0} 位老師`);
      refetch();
    } catch (e: any) {
      toast.error(`觸發失敗：${e?.message ?? e}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-base">4. 自動排程 & 歷史匯出</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            系統於<span className="font-medium text-foreground"> 每週五 23:30 (Asia/Taipei)</span> 自動匯出當週所有 mentor 已發布週記為 CSV，
            上傳至受保護的 Storage，並以站內通知附上 30 天有效的下載連結。舊檔於 30 天後自動清理。
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>重新整理</Button>
          <Button size="sm" onClick={triggerNow} disabled={running}>
            {running ? '執行中…' : '立即手動觸發'}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="py-6 text-center text-sm text-muted-foreground">載入中…</div>
        ) : files.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            尚無自動匯出紀錄。首次執行為下個週五 23:30，或點「立即手動觸發」測試。
          </div>
        ) : (
          <div className="border rounded-md divide-y">
            {files.map((f) => (
              <div key={f.path} className="flex items-center justify-between px-4 py-2 text-sm gap-3">
                <div className="min-w-0">
                  <div className="font-medium truncate">{f.name}</div>
                  <div className="text-xs text-muted-foreground">
                    週別 {f.week}
                    {f.updatedAt ? ` · 產生於 ${fmtTaipei(f.updatedAt)}` : ''}
                    {f.size ? ` · ${(f.size / 1024).toFixed(1)} KB` : ''}
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={() => openDownload(f.path)} className="gap-1 shrink-0">
                  <Download className="h-3 w-3" /> 下載
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}


const JournalsExport = () => {
  const [weekStart, setWeekStart] = useState<string>(() => taipeiMondayOf(new Date()));
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [publishedOnly, setPublishedOnly] = useState(true);
  const [assetFilter, setAssetFilter] = useState<AssetFilter>('all');
  const [selectedMentors, setSelectedMentors] = useState<Set<string>>(new Set());
  const range = useMemo(() => weekRangeUtc(weekStart), [weekStart]);

  // ── 全部 mentor（給下拉多選用；不受週別/資產影響）────
  const { data: mentors = [] } = useQuery({
    queryKey: ['company-journals-export', 'mentors'],
    queryFn: async (): Promise<MentorLite[]> => {
      const { data, error } = await supabase
        .from('experts')
        .select('id, name, slug, asset_class, currency, status')
        .eq('role', 'mentor')
        .order('name', { ascending: true });
      if (error) throw error;
      return (data ?? []) as any as MentorLite[];
    },
    staleTime: 5 * 60_000,
  });

  // ── 該週原始資料（DB 端只做狀態與時間篩選；mentor/資產在 client 過濾）
  const statusFilter: StatusFilter = publishedOnly ? 'published_only' : 'all';

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['company-journals-export', weekStart, statusFilter],
    queryFn: async (): Promise<JournalRow[]> => {
      let q = supabase
        .from('expert_signals')
        .select('id, status, instrument, action, price_hint, reason_summary, reason_detail, risk_notes, learning_points, published_at, created_at, expert_id, experts!inner(name, slug, role, asset_class, currency)')
        .eq('experts.role', 'mentor');

      if (publishedOnly) {
        q = q
          .eq('status', 'published')
          .gte('published_at', range.startIso)
          .lt('published_at', range.endIso)
          .order('expert_id', { ascending: true })
          .order('published_at', { ascending: true });
      } else {
        // 含草稿/撤回：以 created_at 落在該週為準
        q = q
          .gte('created_at', range.startIso)
          .lt('created_at', range.endIso)
          .order('expert_id', { ascending: true })
          .order('created_at', { ascending: true });
      }

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as any as JournalRow[];
    },
    staleTime: 30_000,
  });

  const allRows = data ?? [];

  // ── Client-side 篩選 ────────────────────────────────────
  const rows = useMemo(() => {
    return allRows.filter((r) => {
      if (selectedMentors.size > 0 && !selectedMentors.has(r.expert_id)) return false;
      if (assetFilter !== 'all') {
        const ac = r.experts?.asset_class ?? 'tw_stock';
        if (ac !== assetFilter) return false;
      }
      return true;
    });
  }, [allRows, selectedMentors, assetFilter]);

  const groups = useMemo(() => {
    const m = new Map<string, { name: string; count: number; assetClass: string }>();
    for (const r of rows) {
      const name = r.experts?.name ?? '(未知)';
      const assetClass = r.experts?.asset_class ?? 'tw_stock';
      const g = m.get(r.expert_id) ?? { name, count: 0, assetClass };
      g.count += 1;
      m.set(r.expert_id, g);
    }
    return Array.from(m.entries())
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
  }, [rows]);

  const toggleMentor = (id: string) => {
    setSelectedMentors((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const clearFilters = () => {
    setSelectedMentors(new Set());
    setAssetFilter('all');
    setPublishedOnly(true);
  };

  const activeFilterCount =
    (selectedMentors.size > 0 ? 1 : 0) +
    (assetFilter !== 'all' ? 1 : 0) +
    (!publishedOnly ? 1 : 0);

  const doExportCsv = () => {
    if (rows.length === 0) {
      toast.warning('目前篩選條件下沒有可匯出的週記');
      return;
    }
    const header = [
      '老師名稱', '老師 Slug', '資產類別', '幣別',
      '週別起始', '週別結束',
      '狀態', '發布時間 (台北)', '建立時間 (台北)',
      '標的', '動作', '參考價',
      '重點摘要', '詳細分析', '風險提醒', '學習重點',
      '訊號 ID',
    ];
    const body: unknown[][] = rows.map((r) => [
      r.experts?.name ?? '',
      r.experts?.slug ?? '',
      ASSET_LABEL[r.experts?.asset_class ?? ''] ?? (r.experts?.asset_class ?? ''),
      r.experts?.currency ?? '',
      range.startLabel,
      range.endLabel,
      r.status ?? '',
      fmtTaipei(r.published_at),
      fmtTaipei(r.created_at),
      r.instrument ?? '',
      r.action ?? '',
      r.price_hint ?? '',
      r.reason_summary ?? '',
      r.reason_detail ?? '',
      r.risk_notes ?? '',
      r.learning_points ?? '',
      r.id,
    ]);
    const csv = buildCsv(header, body);
    const suffix = publishedOnly ? 'published' : 'all';
    downloadFile(
      `legendflow-journals-${range.startLabel}_to_${range.endLabel}_${suffix}.csv`,
      csv,
      'text/csv',
    );
    toast.success(`已匯出 ${rows.length} 則週記（${groups.length} 位老師）`);
  };

  return (
    <CompanyLayout>
      <SEO title="週記匯出 | 公司後台" description="批次匯出實戰導師本週已發布週記" path="/company/journals-export" noindex />
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileText className="h-6 w-6" /> 週記匯出
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            匯出實戰導師（mentor）於指定週別（週一 00:00 ~ 週日 23:59 Asia/Taipei）之週記為 CSV。可依老師、資產類別、發布狀態精準篩選。
          </p>
        </div>

        {/* 週別 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">1. 選擇週別</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label htmlFor="week-start" className="text-xs">週一（Asia/Taipei）</Label>
                <Input
                  id="week-start"
                  type="date"
                  value={weekStart}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!v) return;
                    setWeekStart(taipeiMondayOf(new Date(`${v}T12:00:00+08:00`)));
                  }}
                  className="w-[180px]"
                />
              </div>
              <div className="text-sm text-muted-foreground pb-2">
                範圍：<span className="font-medium text-foreground">{range.startLabel}</span> ~ <span className="font-medium text-foreground">{range.endLabel}</span>
              </div>
              <Button variant="outline" size="sm" onClick={() => setWeekStart(taipeiMondayOf(new Date()))}>本週</Button>
              <Button variant="outline" size="sm" onClick={() => {
                const d = new Date(`${weekStart}T00:00:00+08:00`);
                d.setUTCDate(d.getUTCDate() - 7);
                setWeekStart(taipeiMondayOf(d));
              }}>上一週</Button>
              <Button variant="outline" size="sm" onClick={() => {
                const d = new Date(`${weekStart}T00:00:00+08:00`);
                d.setUTCDate(d.getUTCDate() + 7);
                setWeekStart(taipeiMondayOf(d));
              }}>下一週</Button>
              <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching}>重新整理</Button>
            </div>
          </CardContent>
        </Card>

        {/* 篩選條件 */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base flex items-center gap-2">
              <Filter className="h-4 w-4" /> 2. 篩選條件
              {activeFilterCount > 0 && (
                <Badge variant="secondary" className="ml-1">{activeFilterCount} 項</Badge>
              )}
            </CardTitle>
            {activeFilterCount > 0 && (
              <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1">
                <X className="h-3 w-3" /> 清除全部
              </Button>
            )}
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-end gap-6">
              {/* Mentor 多選 */}
              <div className="space-y-1">
                <Label className="text-xs">實戰導師（可複選）</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="min-w-[220px] justify-between">
                      {selectedMentors.size === 0
                        ? `全部老師（共 ${mentors.length} 位）`
                        : `已選 ${selectedMentors.size} / ${mentors.length} 位`}
                      <Filter className="h-3 w-3 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[300px] p-0" align="start">
                    <div className="p-2 border-b flex items-center justify-between text-xs">
                      <button
                        className="text-primary hover:underline"
                        onClick={() => setSelectedMentors(new Set(mentors.map((m) => m.id)))}
                      >全選</button>
                      <button
                        className="text-muted-foreground hover:underline"
                        onClick={() => setSelectedMentors(new Set())}
                      >清除</button>
                    </div>
                    <div className="max-h-[320px] overflow-y-auto p-1">
                      {mentors.length === 0 ? (
                        <div className="py-4 text-center text-xs text-muted-foreground">尚無實戰導師</div>
                      ) : (
                        mentors.map((m) => {
                          const checked = selectedMentors.has(m.id);
                          const acLabel = ASSET_LABEL[m.asset_class ?? ''] ?? '未設定';
                          return (
                            <label
                              key={m.id}
                              className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer text-sm"
                            >
                              <Checkbox checked={checked} onCheckedChange={() => toggleMentor(m.id)} />
                              <span className="flex-1 truncate">{m.name ?? '(未命名)'}</span>
                              <Badge variant="outline" className="text-[10px] px-1 py-0">{acLabel}</Badge>
                            </label>
                          );
                        })
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>

              {/* 資產類別 */}
              <div className="space-y-1">
                <Label className="text-xs">資產類別</Label>
                <Select value={assetFilter} onValueChange={(v) => setAssetFilter(v as AssetFilter)}>
                  <SelectTrigger className="w-[160px] h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部資產</SelectItem>
                    <SelectItem value="tw_stock">台股</SelectItem>
                    <SelectItem value="us_stock">美股</SelectItem>
                    <SelectItem value="crypto">加密</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* 只匯出已發布 */}
              <div className="space-y-1">
                <Label className="text-xs">發布狀態</Label>
                <div className="flex items-center gap-2 h-9">
                  <Switch id="published-only" checked={publishedOnly} onCheckedChange={setPublishedOnly} />
                  <Label htmlFor="published-only" className="text-sm font-normal cursor-pointer">
                    只匯出「已發布」週記
                  </Label>
                </div>
                <p className="text-[11px] text-muted-foreground pt-1">
                  {publishedOnly
                    ? '範圍以 published_at 為準，排除草稿與撤回。'
                    : '範圍以 created_at 為準，含草稿、撤回、已發布全部狀態。'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 預覽 + 匯出 */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-base">3. 預覽 & 匯出</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                符合條件：<span className="font-semibold text-foreground">{rows.length}</span> 則週記 / <span className="font-semibold text-foreground">{groups.length}</span> 位老師
                {allRows.length !== rows.length && (
                  <span className="ml-2 text-[11px]">（原始 {allRows.length} 則 → 篩選後 {rows.length} 則）</span>
                )}
              </p>
            </div>
            <Button onClick={() => setConfirmOpen(true)} disabled={isLoading || rows.length === 0} className="gap-2">
              <Download className="h-4 w-4" />
              匯出 CSV
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {isLoading ? (
              <div className="py-8 text-center text-sm text-muted-foreground">載入中…</div>
            ) : groups.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                此條件下沒有任何週記。試試變更週別或清除篩選。
              </div>
            ) : (
              <>
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-2">各老師發文則數</div>
                  <div className="border rounded-md divide-y">
                    {groups.map((g) => (
                      <div key={g.id} className="flex items-center justify-between px-4 py-2 text-sm">
                        <span className="font-medium flex items-center gap-2">
                          {g.name}
                          <Badge variant="outline" className="text-[10px] px-1 py-0">
                            {ASSET_LABEL[g.assetClass] ?? g.assetClass}
                          </Badge>
                        </span>
                        <span className="text-muted-foreground">{g.count} 則</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-2">週記內容預覽（將全部匯出）</div>
                  <div className="border rounded-md overflow-x-auto max-h-[520px] overflow-y-auto">
                    <Table>
                      <TableHeader className="sticky top-0 bg-background z-10">
                        <TableRow>
                          <TableHead className="w-[60px]">#</TableHead>
                          <TableHead>老師</TableHead>
                          <TableHead>資產</TableHead>
                          <TableHead>狀態</TableHead>
                          <TableHead className="whitespace-nowrap">時間</TableHead>
                          <TableHead>標的</TableHead>
                          <TableHead>動作</TableHead>
                          <TableHead className="text-right">參考價</TableHead>
                          <TableHead>重點摘要</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rows.map((r, i) => (
                          <TableRow key={r.id}>
                            <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                            <TableCell className="font-medium whitespace-nowrap">{r.experts?.name ?? '-'}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-[10px] px-1 py-0">
                                {ASSET_LABEL[r.experts?.asset_class ?? ''] ?? '-'}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge variant={r.status === 'published' ? 'default' : 'secondary'} className="text-[10px] px-1 py-0">
                                {r.status ?? '-'}
                              </Badge>
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-xs">
                              {fmtTaipei(r.published_at || r.created_at)}
                            </TableCell>
                            <TableCell
                              className="max-w-[240px] min-w-[140px] break-words [overflow-wrap:anywhere] align-top"
                              title={r.instrument ?? ''}
                            >
                              {r.instrument ?? '-'}
                            </TableCell>
                            <TableCell>{r.action ?? '-'}</TableCell>
                            <TableCell className="text-right">{r.price_hint ?? '-'}</TableCell>
                            <TableCell className="max-w-[320px] truncate" title={r.reason_summary ?? ''}>
                              {r.reason_summary ?? '-'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <AutoExportSection />
      </div>


      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>確認匯出週記 CSV？</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-1 text-sm">
                <div>週別：<span className="font-medium text-foreground">{range.startLabel} ~ {range.endLabel}</span></div>
                <div>發布狀態：<span className="font-medium text-foreground">{publishedOnly ? '只匯出已發布' : '含全部狀態（草稿/撤回/已發布）'}</span></div>
                <div>資產類別：<span className="font-medium text-foreground">{assetFilter === 'all' ? '全部' : ASSET_LABEL[assetFilter]}</span></div>
                <div>老師：<span className="font-medium text-foreground">{selectedMentors.size === 0 ? '全部' : `已選 ${selectedMentors.size} 位`}</span></div>
                <div className="pt-2">
                  將匯出 <span className="font-semibold text-foreground">{rows.length}</span> 則週記，涵蓋 <span className="font-semibold text-foreground">{groups.length}</span> 位老師。
                </div>
                <div className="text-xs text-muted-foreground pt-1">
                  檔名：legendflow-journals-{range.startLabel}_to_{range.endLabel}_{publishedOnly ? 'published' : 'all'}.csv
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirmOpen(false); doExportCsv(); }}>
              確認下載
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </CompanyLayout>
  );
};

export default JournalsExport;
