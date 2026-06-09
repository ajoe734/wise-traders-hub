import { SEO } from '@/components/SEO';
import { useQuery } from '@tanstack/react-query';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';

const STATUS_LABEL: Record<string, string> = {
  pending: '待發送', processing: '發送中', sent: '已送達',
  partial: '部分成功', failed: '失敗', canceled: '已取消',
};

export default function CompanyLinePushHistory() {
  const { data, isFetching, refetch } = useQuery({
    queryKey: ['company', 'line-push-jobs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('line_push_jobs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return data || [];
    },
    staleTime: 10_000,
  });

  const cancelJob = async (id: string) => {
    const { error } = await supabase.from('line_push_jobs')
      .update({ status: 'canceled' }).eq('id', id).eq('status', 'pending');
    if (error) toast.error(error.message);
    else { toast.success('已取消'); refetch(); }
  };

  const retryNow = async (id: string) => {
    const { data, error } = await supabase.functions.invoke('admin-line-push', { body: { job_id: id } });
    if (error) toast.error(error.message);
    else { toast.success('已觸發：' + JSON.stringify(data)); refetch(); }
  };

  return (
    <CompanyLayout>
      <SEO title="Line 推播紀錄 | legendflow" description="後台 Line 推播任務紀錄。" path="/company/line-push-history" noindex />
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/company/subscribers"><ArrowLeft className="h-4 w-4 mr-1" />返回</Link>
            </Button>
            <h1 className="text-2xl font-bold">Line 推播紀錄</h1>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>重新整理</Button>
        </div>

        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b text-left text-sm text-muted-foreground">
                  <th className="p-3">建立時間</th>
                  <th className="p-3">排程</th>
                  <th className="p-3">類型</th>
                  <th className="p-3">內容</th>
                  <th className="p-3 text-center">收件</th>
                  <th className="p-3 text-center">成功</th>
                  <th className="p-3 text-center">略過</th>
                  <th className="p-3 text-center">失敗</th>
                  <th className="p-3">狀態</th>
                  <th className="p-3">操作</th>
                </tr>
              </thead>
              <tbody>
                {isFetching && !data ? (
                  <tr><td colSpan={10} className="p-8 text-center text-muted-foreground text-sm">載入中...</td></tr>
                ) : (data?.length || 0) === 0 ? (
                  <tr><td colSpan={10} className="p-8 text-center text-muted-foreground text-sm">尚無推播紀錄</td></tr>
                ) : (
                  (data || []).map((j: any) => (
                    <tr key={j.id} className="border-b last:border-0 text-sm">
                      <td className="p-3 text-muted-foreground">{new Date(j.created_at).toLocaleString('zh-TW')}</td>
                      <td className="p-3 text-muted-foreground">{j.scheduled_at ? new Date(j.scheduled_at).toLocaleString('zh-TW') : '立即'}</td>
                      <td className="p-3"><Badge variant="outline" className="text-xs">{j.message_kind}</Badge></td>
                      <td className="p-3 max-w-xs">
                        <div className="truncate" title={j.text || j.image_url || ''}>
                          {j.text || j.image_url || '-'}
                        </div>
                        {j.action_url && <div className="text-xs text-muted-foreground truncate">→ {j.action_label}: {j.action_url}</div>}
                      </td>
                      <td className="p-3 text-center">{(j.recipient_user_ids || []).length}</td>
                      <td className="p-3 text-center text-green-600">{j.sent_count}</td>
                      <td className="p-3 text-center text-muted-foreground">{j.skipped_count}</td>
                      <td className="p-3 text-center text-destructive">{j.failed_count}</td>
                      <td className="p-3">
                        <Badge variant={j.status === 'sent' ? 'default' : j.status === 'failed' ? 'destructive' : 'outline'} className="text-xs">
                          {STATUS_LABEL[j.status] || j.status}
                        </Badge>
                        {j.error && <div className="text-xs text-destructive mt-1 max-w-[200px] truncate" title={j.error}>{j.error}</div>}
                      </td>
                      <td className="p-3 space-x-1">
                        {j.status === 'pending' && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => retryNow(j.id)}>立即發送</Button>
                            <Button size="sm" variant="ghost" onClick={() => cancelJob(j.id)}>取消</Button>
                          </>
                        )}
                        {(j.status === 'failed' || j.status === 'partial') && (
                          <Button size="sm" variant="outline" onClick={() => retryNow(j.id)}>重試</Button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </CompanyLayout>
  );
}
