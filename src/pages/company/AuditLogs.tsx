import { useState, useEffect } from 'react';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { Search, ScrollText } from 'lucide-react';

const actionLabels: Record<string, string> = {
  refund: '退款',
  create_analyst: '新增分析師',
  update_signal: '更新訊號',
  take_down_signal: '下架訊號',
  create_plan: '新增方案',
  update_plan: '更新方案',
  approve_plan: '審核方案',
};

const CompanyAuditLogs = () => {
  const [logs, setLogs] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('audit_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);
    setLogs(data || []);

    const actorIds = [...new Set((data || []).map(l => l.actor_id).filter(Boolean))];
    if (actorIds.length > 0) {
      const { data: pData } = await supabase
        .from('profiles')
        .select('user_id, display_name')
        .in('user_id', actorIds);
      const map: Record<string, string> = {};
      (pData || []).forEach(p => { map[p.user_id] = p.display_name || ''; });
      setProfiles(map);
    }
    setLoading(false);
  };

  const filtered = logs.filter(l => {
    if (!search) return true;
    const q = search.toLowerCase();
    const actor = (profiles[l.actor_id] || '').toLowerCase();
    const action = (actionLabels[l.action] || l.action || '').toLowerCase();
    const target = (l.target_type || '').toLowerCase();
    return actor.includes(q) || action.includes(q) || target.includes(q);
  });

  return (
    <CompanyLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">操作紀錄</h1>
          <p className="text-muted-foreground text-sm mt-1">查看所有管理操作的歷史紀錄</p>
        </div>

        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="搜尋動作類型、執行者..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>

        <Card>
          <CardContent className="p-0">
            <table className="w-full">
              <thead>
                <tr className="border-b text-left text-sm text-muted-foreground">
                  <th className="p-4">時間</th>
                  <th className="p-4">執行者</th>
                  <th className="p-4">動作</th>
                  <th className="p-4">目標類型</th>
                  <th className="p-4">詳情</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={5} className="p-8 text-center text-muted-foreground text-sm">載入中...</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={5} className="p-8 text-center text-muted-foreground text-sm">
                    <ScrollText className="h-8 w-8 mx-auto mb-3 opacity-50" />
                    暫無操作紀錄
                  </td></tr>
                ) : (
                  filtered.map(log => (
                    <tr key={log.id} className="border-b last:border-0">
                      <td className="p-4 text-sm text-muted-foreground whitespace-nowrap">
                        {new Date(log.created_at).toLocaleString('zh-TW')}
                      </td>
                      <td className="p-4 text-sm font-medium">
                        {profiles[log.actor_id] || log.actor_id?.slice(0, 8) || '-'}
                      </td>
                      <td className="p-4">
                        <Badge variant="outline" className="text-xs">
                          {actionLabels[log.action] || log.action}
                        </Badge>
                      </td>
                      <td className="p-4 text-sm text-muted-foreground">{log.target_type || '-'}</td>
                      <td className="p-4 text-sm text-muted-foreground max-w-[200px] truncate">
                        {log.detail ? JSON.stringify(log.detail) : '-'}
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
};

export default CompanyAuditLogs;
