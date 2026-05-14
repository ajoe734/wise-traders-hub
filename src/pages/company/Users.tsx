import { useEffect, useState, useCallback } from 'react';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { Loader2, Shield, Search, RefreshCw, MoreHorizontal, Pencil, KeyRound, Ban, Trash2, ShieldOff } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PermissionTooltip } from '@/components/admin/PermissionTooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { avatarUrl } from '@/lib/imageTransform';

interface UserRow {
  user_id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  expert_slug: string | null;
  is_tester: boolean;
  is_line: boolean;
  banned_until: string | null;
  roles: string[];
  created_at: string;
}

const errorMap: Record<string, string> = {
  cannot_remove_self_admin: '不能移除自己的管理員權限',
  cannot_ban_self: '不能停權自己',
  cannot_delete_self: '不能刪除自己的帳號',
  last_admin: '系統至少需保留一位管理員',
  forbidden: '權限不足',
  line_account_no_email: 'Line 帳號無 Email，無法寄送重設信',
  user_not_found: '找不到使用者',
  email_not_configured: '寄信服務未設定',
  no_changes: '沒有變更內容',
};

export default function CompanyUsers() {
  const { user } = useAuth();
  const [rows, setRows] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'admin' | 'analyst' | 'banned'>('all');
  const [busy, setBusy] = useState<string | null>(null);

  const [editTarget, setEditTarget] = useState<UserRow | null>(null);
  const [editName, setEditName] = useState('');
  const [editSlug, setEditSlug] = useState('');

  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState('');

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

  const isBanned = (r: UserRow) => !!r.banned_until && new Date(r.banned_until) > new Date();

  const visible = rows.filter((r) => {
    if (filter === 'admin') return r.roles.includes('company_admin');
    if (filter === 'analyst') return r.roles.includes('analyst');
    if (filter === 'banned') return isBanned(r);
    return true;
  });

  const callAction = async (key: string, payload: any, successMsg: string) => {
    setBusy(key);
    const { data, error } = await supabase.functions.invoke('admin-manage-users', { body: payload });
    setBusy(null);
    if (error || data?.error) {
      const msg = data?.error || error?.message || '操作失敗';
      toast({ title: '失敗', description: errorMap[msg] || msg, variant: 'destructive' });
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

  const toggleBan = async (row: UserRow) => {
    const banned = isBanned(row);
    const verb = banned ? '解除停權' : '停權';
    if (!confirm(`確定要${verb}「${row.display_name || row.email}」？`)) return;
    await callAction(`${row.user_id}:ban`, {
      action: 'set_banned', user_id: row.user_id, banned: !banned,
    }, `已${verb}`);
  };

  const sendReset = async (row: UserRow) => {
    if (!confirm(`寄送密碼重設信至 ${row.email}？`)) return;
    await callAction(`${row.user_id}:reset`, {
      action: 'send_password_reset', user_id: row.user_id,
    }, '已寄送密碼重設信');
  };

  const openEdit = (row: UserRow) => {
    setEditTarget(row);
    setEditName(row.display_name || '');
    setEditSlug(row.expert_slug || '');
  };

  const submitEdit = async () => {
    if (!editTarget) return;
    const ok = await callAction(`${editTarget.user_id}:edit`, {
      action: 'update_profile',
      user_id: editTarget.user_id,
      display_name: editName,
      expert_slug: editSlug,
    }, '已更新資料');
    if (ok) setEditTarget(null);
  };

  const submitDelete = async () => {
    if (!deleteTarget) return;
    if (deleteConfirm !== deleteTarget.email) {
      toast({ title: '驗證失敗', description: '輸入的 Email 不符', variant: 'destructive' });
      return;
    }
    const ok = await callAction(`${deleteTarget.user_id}:delete`, {
      action: 'delete_user', user_id: deleteTarget.user_id,
    }, '已刪除帳號');
    if (ok) {
      setDeleteTarget(null);
      setDeleteConfirm('');
    }
  };

  return (
    <CompanyLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-medium tracking-tight flex items-center gap-2">
              <Shield className="h-5 w-5" /> 帳號管理
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              管理所有使用者帳號：權限、Tester、停權、密碼重設、刪除。所有變更會記錄至審計日誌。
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
              {(['all', 'admin', 'analyst', 'banned'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1.5 rounded-full transition-colors ${
                    filter === f ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground hover:bg-muted/70'
                  }`}
                >
                  {f === 'all' ? '全部' : f === 'admin' ? '管理員' : f === 'analyst' ? '分析師' : '已停權'}
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
                  <TableHead>狀態</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((r) => {
                  const isAdmin = r.roles.includes('company_admin');
                  const isAnalyst = r.roles.includes('analyst');
                  const isSelf = r.user_id === user?.id;
                  const banned = isBanned(r);
                  return (
                    <TableRow key={r.user_id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {r.avatar_url ? (
                            <img src={avatarUrl(r.avatar_url, 56)} alt="" loading="lazy" decoding="async" className="shrink-0 h-7 w-7 rounded-full object-cover object-[center_15%]" />
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
                          {banned && <Badge variant="destructive">已停權</Badge>}
                          {r.is_line && <Badge variant="outline">LINE</Badge>}
                          {r.expert_slug && <Badge variant="outline">{r.expert_slug}</Badge>}
                        </div>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEdit(r)}>
                              <Pencil className="h-4 w-4 mr-2" /> 編輯資料
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => sendReset(r)}
                              disabled={!r.email || r.email.endsWith('@line.local')}
                            >
                              <KeyRound className="h-4 w-4 mr-2" /> 寄送密碼重設信
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => toggleBan(r)}
                              disabled={isSelf}
                            >
                              {banned ? (
                                <><ShieldOff className="h-4 w-4 mr-2" /> 解除停權</>
                              ) : (
                                <><Ban className="h-4 w-4 mr-2" /> 停權</>
                              )}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => { setDeleteTarget(r); setDeleteConfirm(''); }}
                              disabled={isSelf}
                              className="text-destructive focus:text-destructive"
                            >
                              <Trash2 className="h-4 w-4 mr-2" /> 刪除帳號
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {visible.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-12">
                      沒有符合條件的帳號
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </div>
      </div>

      {/* Edit Dialog */}
      <Dialog open={!!editTarget} onOpenChange={(o) => !o && setEditTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>編輯帳號資料</DialogTitle>
            <DialogDescription className="font-mono text-xs">{editTarget?.email}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>顯示名稱</Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Expert Slug</Label>
              <Input
                value={editSlug}
                onChange={(e) => setEditSlug(e.target.value)}
                placeholder="留空表示非分析師"
              />
              <p className="text-xs text-muted-foreground">用於分析師頁面的 URL，需唯一</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>取消</Button>
            <Button
              onClick={submitEdit}
              disabled={busy === `${editTarget?.user_id}:edit`}
            >
              {busy === `${editTarget?.user_id}:edit` && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              儲存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) { setDeleteTarget(null); setDeleteConfirm(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">刪除帳號</DialogTitle>
            <DialogDescription>
              此操作無法復原。將永久刪除使用者及其所有資料（profile、訂閱、角色等）。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-lg border p-3 text-sm">
              <div>{deleteTarget?.display_name || '—'}</div>
              <div className="font-mono text-xs text-muted-foreground">{deleteTarget?.email}</div>
            </div>
            <div className="space-y-2">
              <Label>請輸入此帳號的 Email 以確認刪除</Label>
              <Input
                value={deleteConfirm}
                onChange={(e) => setDeleteConfirm(e.target.value)}
                placeholder={deleteTarget?.email || ''}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeleteTarget(null); setDeleteConfirm(''); }}>取消</Button>
            <Button
              variant="destructive"
              onClick={submitDelete}
              disabled={!deleteTarget || deleteConfirm !== deleteTarget.email || busy === `${deleteTarget?.user_id}:delete`}
            >
              {busy === `${deleteTarget?.user_id}:delete` && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              永久刪除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </CompanyLayout>
  );
}
