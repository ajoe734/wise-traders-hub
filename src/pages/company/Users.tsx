import { useEffect, useState, useCallback } from 'react';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { Loader2, Shield, Search, RefreshCw } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PermissionTooltip } from '@/components/admin/PermissionTooltip';

interface UserRow {
  user_id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  expert_slug: string | null;
  is_tester: boolean;
  is_line: boolean;
  roles: string[];
  created_at: string;
}

export default function CompanyUsers() {
  const { user } = useAuth();
  const [rows, setRows] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'admin' | 'analyst'>('all');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke('admin-manage-users', {
      body: { action: 'list', search, limit: 200 },
    });
    if (error) {
      toast({ title: '載入失敗', description: error.message, variant: 'destructive' });
    } else {
      setRows(data?.users || []);
    }
    setLoading(false);
  }, [search]);

  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [load]);

  const visible = rows.filter((r) => {
    if (filter === 'admin') return r.roles.includes('company_admin');
    if (filter === 'analyst') return r.roles.includes('analyst');
    return true;
  });

  const callAction = async (key: string, payload: any, successMsg: string) => {
    setBusy(key);
    const { data, error } = await supabase.functions.invoke('admin-manage-users', { body: payload });
    setBusy(null);
    if (error || data?.error) {
      const msg = data?.error || error?.message || '操作失敗';
      const map: Record<string, string> = {
        cannot_remove_self_admin: '不能移除自己的管理員權限',
        last_admin: '系統至少需保留一位管理員',
        forbidden: '權限不足',
      };
      toast({ title: '失敗', description: map[msg] || msg, variant: 'destructive' });
      return false;
    }
    toast({ title: successMsg });
    await load();
    return true;
  };

  const toggleRole = async (row: UserRow, role: 'company_admin' | 'analyst', enabled: boolean) => {
    const verb = enabled ? '指派' : '移除';
    const label = role === 'company_admin' ? '管理員' : '分析師';
    if (!confirm(`確定要${verb}「${row.display_name || row.email}」的${label}權限？`)) return;
    await callAction(`${row.user_id}:${role}`, {
      action: 'set_role', user_id: row.user_id, role, enabled,
    }, `已${verb} ${label} 權限`);
  };

  const toggleTester = async (row: UserRow, value: boolean) => {
    if (!confirm(`確定要將「${row.display_name || row.email}」設為${value ? '' : '非'} Tester？`)) return;
    await callAction(`${row.user_id}:tester`, {
      action: 'set_tester', user_id: row.user_id, value,
    }, value ? '已設為 Tester' : '已取消 Tester');
  };

  return (
    <CompanyLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-medium tracking-tight flex items-center gap-2">
              <Shield className="h-5 w-5" /> 帳號權限管理
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              指派或移除使用者的管理員 / 分析師權限。所有變更會記錄至審計日誌。
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
            重新整理
          </Button>
        </div>

        <div className="rounded-2xl border bg-card p-4 space-y-3">
          <div className="flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-[240px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜尋 Email、名稱、Slug、UUID"
                className="pl-9 rounded-full"
              />
            </div>
            <div className="flex gap-1 text-xs">
              {(['all', 'admin', 'analyst'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1.5 rounded-full transition-colors ${
                    filter === f ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground hover:bg-muted/70'
                  }`}
                >
                  {f === 'all' ? '全部' : f === 'admin' ? '管理員' : '分析師'}
                </button>
              ))}
            </div>
            <span className="text-xs text-muted-foreground ml-auto">共 {visible.length} 位</span>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>使用者</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>角色</TableHead>
                  <TableHead className="text-center">管理員</TableHead>
                  <TableHead className="text-center">分析師</TableHead>
                  <TableHead className="text-center">Tester</TableHead>
                  <TableHead>身份</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((r) => {
                  const isAdmin = r.roles.includes('company_admin');
                  const isAnalyst = r.roles.includes('analyst');
                  const isSelf = r.user_id === user?.id;
                  return (
                    <TableRow key={r.user_id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {r.avatar_url ? (
                            <img src={r.avatar_url} alt="" className="h-7 w-7 rounded-full object-cover" />
                          ) : (
                            <div className="h-7 w-7 rounded-full bg-muted" />
                          )}
                          <div className="min-w-0">
                            <div className="text-sm truncate">{r.display_name || '—'}</div>
                            {isSelf && <div className="text-[10px] text-muted-foreground">你自己</div>}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground font-mono truncate max-w-[220px]">
                        {r.email || '—'}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1 flex-wrap">
                          {isAdmin && <Badge variant="default" className="text-[10px]">管理員</Badge>}
                          {isAnalyst && <Badge variant="secondary" className="text-[10px]">分析師</Badge>}
                          {!isAdmin && !isAnalyst && <span className="text-xs text-muted-foreground">一般用戶</span>}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <PermissionTooltip
                          disabled={isSelf && isAdmin}
                          message="不可移除自己的管理員權限"
                        >
                          <Switch
                            checked={isAdmin}
                            disabled={(isSelf && isAdmin) || busy === `${r.user_id}:company_admin`}
                            onCheckedChange={(v) => toggleRole(r, 'company_admin', v)}
                          />
                        </PermissionTooltip>
                      </TableCell>
                      <TableCell className="text-center">
                        <Switch
                          checked={isAnalyst}
                          disabled={busy === `${r.user_id}:analyst`}
                          onCheckedChange={(v) => toggleRole(r, 'analyst', v)}
                        />
                      </TableCell>
                      <TableCell className="text-center">
                        <Switch
                          checked={r.is_tester}
                          disabled={busy === `${r.user_id}:tester`}
                          onCheckedChange={(v) => toggleTester(r, v)}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1 flex-wrap text-[10px]">
                          {r.is_line && <Badge variant="outline">LINE</Badge>}
                          {r.expert_slug && <Badge variant="outline">{r.expert_slug}</Badge>}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {visible.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-12">
                      沒有符合條件的帳號
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
    </CompanyLayout>
  );
}
