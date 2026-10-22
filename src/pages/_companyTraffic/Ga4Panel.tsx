import { useQuery } from '@tanstack/react-query';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import Ga4ReconcileCard from '@/pages/_companyTraffic/Ga4ReconcileCard';

type Status = 'OK' | 'NO_DATA' | 'NOT_CONFIGURED' | 'INVALID_CONFIG' | 'INVALID_INPUT' | 'AUTH_FAILED' | 'PERMISSION_DENIED' | 'API_DISABLED' | 'PROPERTY_NOT_FOUND' | 'QUERY_ERROR' | 'FORBIDDEN' | 'UNAUTHENTICATED';
interface Report {
  propertyId: string; timeZone: string | null; startDate: string; endDate: string;
  totals: { users: number; sessions: number; pageViews: number };
  daily: Array<{ day: string; users: number; sessions: number; pageViews: number }>;
  topPages: Array<{ path: string; pageViews: number; users: number }>;
}
interface Result { status: Status; message?: string; missing?: string[]; serviceAccountEmail?: string | null; report?: Report }

const STATUS_LABEL: Record<Status, string> = {
  OK: '已連線', NO_DATA: '已連線，期間內無資料', NOT_CONFIGURED: '尚未設定', INVALID_CONFIG: '設定格式錯誤',
  INVALID_INPUT: '期間錯誤', AUTH_FAILED: '服務帳戶驗證失敗', PERMISSION_DENIED: '未授權讀取此資源',
  API_DISABLED: 'Data API 未啟用', PROPERTY_NOT_FOUND: '找不到 GA4 資源', QUERY_ERROR: '查詢錯誤',
  FORBIDDEN: '權限不足', UNAUTHENTICATED: '未登入',
};

/** Taipei calendar day of an instant, YYYY-MM-DD. */
export function taipeiDay(d: Date): string {
  return new Date(d.getTime() + 8 * 3600000).toISOString().slice(0, 10);
}
const slash = (s: string) => s.replace(/-/g, '/');
const fmt = (n: number) => n.toLocaleString();

export default function Ga4Panel({ from, to }: { from: Date; to: Date }) {
  const startDate = taipeiDay(from);
  const endDate = taipeiDay(to);
  const q = useQuery({
    queryKey: ['ga4-report', startDate, endDate],
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async (): Promise<Result> => {
      const { data, error } = await supabase.functions.invoke('ga4-report', { body: { startDate, endDate } });
      if (error) {
        let body: any = null;
        if (error instanceof FunctionsHttpError) body = await error.context.json().catch(() => null);
        const code = body?.code ?? body?.status;
        if (code === 'FORBIDDEN_ADMIN') return { status: 'FORBIDDEN', message: body?.message };
        if (code === 'UNAUTHENTICATED') return { status: 'UNAUTHENTICATED', message: body?.message };
        if (body?.status) return body as Result;
        return { status: 'QUERY_ERROR', message: error.message };
      }
      return data as Result;
    },
  });

  const r = q.data;
  const report = r && (r.status === 'OK' || r.status === 'NO_DATA') ? r.report : undefined;
  const ok = !!report;

  return (
    <div className="space-y-4" data-testid="ga4-panel">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-base">Google Analytics 4（直接讀取 GA 報表）</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              期間 {slash(startDate)} – {slash(endDate)}（日期依 GA 資源時區解讀{ok && r.report?.timeZone ? `：${r.report.timeZone}` : ''}）。
              GA4 報表來自 Google；對比視圖另列網站紀錄，兩者不混算。
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => q.refetch()} disabled={q.isFetching}>重新讀取</Button>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {q.isLoading && <p className="text-muted-foreground">讀取 GA4 中…</p>}
          {q.isError && <p role="alert">讀取失敗：{(q.error as Error).message}</p>}
          {r && (
            <div role="status" data-status={r.status} className="space-y-1">
              <p><span className="font-bold">連線狀態：</span>{STATUS_LABEL[r.status] ?? r.status}{report ? `（資源 ${report.propertyId}）` : ''}</p>
              {r.message && <p className="text-muted-foreground">{r.message}</p>}
              {r.missing && r.missing.length > 0 && <p>需要在安全表單設定：{r.missing.map((m) => <code key={m} className="mx-1 break-all inline-block">{m}</code>)}</p>}
              {r.serviceAccountEmail && !ok && <p>服務帳戶：<code className="break-all">{r.serviceAccountEmail}</code>（需在 GA4 資源存取管理加入為「檢視者」）</p>}
            </div>
          )}
        </CardContent>
      </Card>

      {report && (() => {
        const rep = report;
        return (
          <Tabs defaultValue="comparison" className="space-y-4">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="comparison">GA4 與網站資料對比</TabsTrigger>
              <TabsTrigger value="report">GA4 報表</TabsTrigger>
            </TabsList>
            <TabsContent value="comparison">
              {rep.timeZone === 'Asia/Taipei' ? <Ga4ReconcileCard ga4={rep} startDate={rep.startDate} endDate={rep.endDate} /> : <p role="alert" className="text-sm text-destructive">GA4 時區不是 Asia/Taipei，無法與網站每日資料直接對帳。</p>}
            </TabsContent>
            <TabsContent value="report" className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[['使用者（期間去重）', rep.totals.users], ['工作階段', rep.totals.sessions], ['瀏覽', rep.totals.pageViews]].map(([l, v]) => (
                <Card key={l as string}><CardContent className="pt-4"><p className="text-xs text-muted-foreground">{l}</p><p className="text-xl font-bold">{fmt(v as number)}</p></CardContent></Card>
              ))}
            </div>
            <Card>
              <CardHeader><CardTitle className="text-base">GA4 每日趨勢</CardTitle><p className="text-xs text-muted-foreground mt-1">每日使用者不可相加；期間使用者以上方去重數字為準。</p></CardHeader>
              <CardContent style={{ height: 280 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={rep.daily.map((d) => ({ ...d, label: slash(d.day).slice(5) }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="label" fontSize={11} />
                    <YAxis fontSize={11} allowDecimals={false} />
                    <Tooltip labelFormatter={(_, p) => slash(String(p?.[0]?.payload?.day ?? ''))} />
                    <Legend />
                    <Line type="monotone" dataKey="users" name="使用者" stroke="hsl(var(--foreground))" dot={false} />
                    <Line type="monotone" dataKey="sessions" name="工作階段" stroke="hsl(var(--mentor))" dot={false} />
                    <Line type="monotone" dataKey="pageViews" name="瀏覽" stroke="hsl(var(--primary))" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">GA4 熱門頁面（前 15，依瀏覽）</CardTitle></CardHeader>
              <CardContent>
                {rep.topPages.length === 0 ? <p className="text-sm text-muted-foreground">期間內無頁面資料</p> : (
                  <Table>
                    <TableHeader><TableRow><TableHead>頁面路徑</TableHead><TableHead className="text-right">瀏覽</TableHead><TableHead className="text-right">使用者</TableHead></TableRow></TableHeader>
                    <TableBody>{rep.topPages.map((p) => (
                      <TableRow key={p.path}><TableCell className="font-mono text-xs break-all">{p.path}</TableCell><TableCell className="text-right">{fmt(p.pageViews)}</TableCell><TableCell className="text-right">{fmt(p.users)}</TableCell></TableRow>
                    ))}</TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
            </TabsContent>
          </Tabs>
        );
      })()}
    </div>
  );
}
