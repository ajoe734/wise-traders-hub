import { useMemo, useState } from 'react';
import { SEO } from '@/components/SEO';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Download, FileText } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

// ── Taipei week helpers ────────────────────────────────────
// 週一 00:00 Asia/Taipei 為起點；下週一 00:00 為終點（不含）
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
  return { startIso: start.toISOString(), endIso: end.toISOString(), startLabel: weekStart, endLabel: new Date(end.getTime() - MS_DAY).toISOString().slice(0, 10) };
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

// 台北時區顯示
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

interface JournalRow {
  id: string;
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
  experts?: { name: string | null; slug: string | null; role: string | null } | null;
}

const JournalsExport = () => {
  const [weekStart, setWeekStart] = useState<string>(() => taipeiMondayOf(new Date()));
  const range = useMemo(() => weekRangeUtc(weekStart), [weekStart]);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['company-journals-export', weekStart],
    queryFn: async (): Promise<JournalRow[]> => {
      const { data, error } = await supabase
        .from('expert_signals')
        .select('id, instrument, action, price_hint, reason_summary, reason_detail, risk_notes, learning_points, published_at, created_at, expert_id, experts!inner(name, slug, role)')
        .eq('status', 'published')
        .eq('experts.role', 'mentor')
        .gte('published_at', range.startIso)
        .lt('published_at', range.endIso)
        .order('expert_id', { ascending: true })
        .order('published_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as any as JournalRow[];
    },
    staleTime: 30_000,
  });

  const rows = data ?? [];

  // 依老師分組統計
  const groups = useMemo(() => {
    const m = new Map<string, { name: string; count: number }>();
    for (const r of rows) {
      const name = r.experts?.name ?? '(未知)';
      const g = m.get(r.expert_id) ?? { name, count: 0 };
      g.count += 1;
      m.set(r.expert_id, g);
    }
    return Array.from(m.entries()).map(([id, v]) => ({ id, ...v })).sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
  }, [rows]);

  const handleExportCsv = () => {
    if (rows.length === 0) {
      toast.warning('本週尚無週記可匯出');
      return;
    }
    const header = [
      '老師名稱', '老師 Slug', '週別起始', '週別結束',
      '發布時間 (台北)', '標的', '動作', '參考價',
      '重點摘要', '詳細分析', '風險提醒', '學習重點',
      '訊號 ID',
    ];
    const body: unknown[][] = rows.map((r) => [
      r.experts?.name ?? '',
      r.experts?.slug ?? '',
      range.startLabel,
      range.endLabel,
      fmtTaipei(r.published_at),
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
    downloadFile(`legendflow-journals-${range.startLabel}_to_${range.endLabel}.csv`, csv, 'text/csv');
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
            匯出實戰導師（mentor）於指定週別（週一 00:00 ~ 週日 23:59 Asia/Taipei）已發布之週記為 CSV。
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">選擇週別</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label htmlFor="week-start" className="text-xs">週一（Asia/Taipei）</Label>
                <Input
                  id="week-start"
                  type="date"
                  value={weekStart}
                  onChange={(e) => {
                    // 允許輸入任一日期，自動 snap 到該週週一
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
              <Button
                variant="outline"
                size="sm"
                onClick={() => setWeekStart(taipeiMondayOf(new Date()))}
                className="pb-2"
              >
                本週
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const d = new Date(`${weekStart}T00:00:00+08:00`);
                  d.setUTCDate(d.getUTCDate() - 7);
                  setWeekStart(taipeiMondayOf(d));
                }}
              >
                上一週
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const d = new Date(`${weekStart}T00:00:00+08:00`);
                  d.setUTCDate(d.getUTCDate() + 7);
                  setWeekStart(taipeiMondayOf(d));
                }}
              >
                下一週
              </Button>
              <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching}>
                重新整理
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-base">本次結果</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                共 {rows.length} 則週記 / {groups.length} 位實戰導師
              </p>
            </div>
            <Button onClick={handleExportCsv} disabled={isLoading || rows.length === 0} className="gap-2">
              <Download className="h-4 w-4" />
              匯出 CSV
            </Button>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="py-8 text-center text-sm text-muted-foreground">載入中…</div>
            ) : groups.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                此週別沒有任何實戰導師發布週記。
              </div>
            ) : (
              <div className="border rounded-md divide-y">
                {groups.map((g) => (
                  <div key={g.id} className="flex items-center justify-between px-4 py-2 text-sm">
                    <span className="font-medium">{g.name}</span>
                    <span className="text-muted-foreground">{g.count} 則</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </CompanyLayout>
  );
};

export default JournalsExport;
