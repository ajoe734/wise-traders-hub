import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { AdminLayout } from '@/components/layouts/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { Save, Upload, X, Plus, Eye, EyeOff, AlertTriangle, Lock } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useExpertPerformance } from '@/hooks/usePerformance';
import { PermissionTooltip } from '@/components/admin/PermissionTooltip';

const AdminProfile = () => {
  const { expertSlug } = useParams<{ expertSlug: string }>();
  const { user, hasRole } = useAuth();
  const isCompanyAdmin = hasRole('company_admin');
  const isOwner = !!user?.expertSlug && user.expertSlug === expertSlug;
  // company_admin 擁有最高權限，可代為編輯任一分析師個人檔案
  const isReadOnly = !isCompanyAdmin && !isOwner;

  const [expert, setExpert] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [description, setDescription] = useState('');
  const [strategySummary, setStrategySummary] = useState('');
  const [styleTags, setStyleTags] = useState<string[]>([]);
  const [markets, setMarkets] = useState<string[]>([]);
  const [newTag, setNewTag] = useState('');
  const [newMarket, setNewMarket] = useState('');
  const [uploading, setUploading] = useState(false);
  const [startingCapital, setStartingCapital] = useState<string>('');
  const [startingCapitalLocked, setStartingCapitalLocked] = useState(false);
  const [showCapitalConfirm, setShowCapitalConfirm] = useState(false);
  const [pendingCapital, setPendingCapital] = useState<number>(0);
  const [capitalStatus, setCapitalStatus] = useState<{ available_cash: number; open_cost_value: number; realized_pnl_amount: number } | null>(null);

  const { data: perf } = useExpertPerformance(expert?.id);

  useEffect(() => {
    if (!expert?.id) return;
    supabase.rpc('get_expert_capital_status' as any, { _expert_id: expert.id }).then(({ data }) => {
      if (data) setCapitalStatus(data as any);
    });
  }, [expert?.id]);

  useEffect(() => { fetchExpert(); }, [expertSlug]);

  const fetchExpert = async () => {
    if (!expertSlug) return;
    setLoading(true);
    const { data } = await supabase.from('experts').select('*').eq('slug', expertSlug).single();
    if (data) {
      setExpert(data);
      setName(data.name || '');
      setBio(data.bio || '');
      setDescription(data.description || '');
      setStrategySummary((data as any).strategy_summary || '');
      setStyleTags(data.style_tags || []);
      setMarkets(data.markets || []);
      if (data.starting_capital != null) {
        setStartingCapital(String(data.starting_capital));
        setStartingCapitalLocked(true);
      }
    }
    setLoading(false);
  };

  const handleSave = async () => {
    if (!expert) return;
    setSaving(true);
    const { error } = await supabase.from('experts').update({
      name,
      bio,
      description,
      strategy_summary: strategySummary,
      style_tags: styleTags,
      markets,
    } as any).eq('id', expert.id);
    setSaving(false);
    if (error) { toast.error('儲存失敗：' + error.message); return; }
    toast.success('已儲存');
    setExpert({ ...expert, name, bio, description, strategy_summary: strategySummary, style_tags: styleTags, markets });
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !expert || !user?.id) return;

    // 前置檢查
    if (!file.type.startsWith('image/')) {
      toast.error('請選擇圖片檔案');
      e.target.value = '';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('檔案大小不可超過 5MB');
      e.target.value = '';
      return;
    }

    setUploading(true);
    try {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      // 路徑第一層必須符合 Storage RLS：
      // - 本人編輯 → 自己 uid
      // - company_admin 代編輯他人 → 該 expert 的 user_id（admin policy 允許）
      const folderUid = (!isOwner && isCompanyAdmin && expert.user_id) ? expert.user_id : user.id;
      const rand = Math.random().toString(36).slice(2, 8);
      const path = `${folderUid}/avatar-${Date.now()}-${rand}.${ext}`;

      // 唯一檔名 → 不需要 upsert，避免觸發 update 路徑的 RLS
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(path, file, { upsert: false, contentType: file.type });
      if (uploadError) {
        toast.error('上傳檔案失敗：' + uploadError.message);
        return;
      }

      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
      const avatarUrl = urlData.publicUrl;

      const { error: updateError } = await supabase
        .from('experts')
        .update({ avatar_url: avatarUrl })
        .eq('id', expert.id);
      if (updateError) {
        toast.error('更新頭像失敗：' + updateError.message);
        return;
      }

      // best-effort：刪除舊檔（失敗不影響流程）
      const oldUrl: string | undefined = expert.avatar_url;
      if (oldUrl && oldUrl.includes('/avatars/')) {
        try {
          const oldPath = oldUrl.split('/avatars/')[1]?.split('?')[0];
          if (oldPath && oldPath !== path) {
            await supabase.storage.from('avatars').remove([oldPath]);
          }
        } catch { /* ignore */ }
      }

      toast.success('頭像已更新');
      setExpert({ ...expert, avatar_url: avatarUrl });
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const addTag = () => {
    if (newTag.trim() && !styleTags.includes(newTag.trim())) {
      setStyleTags([...styleTags, newTag.trim()]);
      setNewTag('');
    }
  };

  const addMarket = () => {
    if (newMarket.trim() && !markets.includes(newMarket.trim())) {
      setMarkets([...markets, newMarket.trim()]);
      setNewMarket('');
    }
  };

  if (loading) return <AdminLayout><div className="flex items-center justify-center h-64 text-muted-foreground">載入中...</div></AdminLayout>;
  if (!expert) return <AdminLayout><div /></AdminLayout>;

  const isAdvisor = expert.role === 'advisor';

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">個人檔案</h1>
            <p className="text-muted-foreground text-sm mt-1">編輯您的公開資訊</p>
          </div>
          <PermissionTooltip disabled={isReadOnly}>
            <Button
              onClick={handleSave}
              disabled={saving || isReadOnly}
              className={cn(isAdvisor ? "bg-advisor hover:bg-advisor/90" : "bg-mentor hover:bg-mentor/90")}
            >
              <Save className="h-4 w-4 mr-2" />
              {saving ? '儲存中...' : '儲存變更'}
            </Button>
          </PermissionTooltip>
        </div>

        {/* Avatar */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">頭像</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-6">
              <img
                src={expert.avatar_url || '/placeholder.svg'}
                alt={expert.name}
                className="h-20 w-20 rounded-full object-cover border-2 border-border"
              />
              <div>
                <PermissionTooltip disabled={isReadOnly}>
                  <label className={cn(isReadOnly && 'pointer-events-none')}>
                    <Button variant="outline" size="sm" asChild disabled={uploading || isReadOnly}>
                      <span>
                        <Upload className="h-4 w-4 mr-2" />
                        {uploading ? '上傳中...' : '更換頭像'}
                      </span>
                    </Button>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleAvatarUpload}
                      disabled={isReadOnly}
                    />
                  </label>
                </PermissionTooltip>
                <p className="text-xs text-muted-foreground mt-2">建議尺寸 400x400px，JPG 或 PNG</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Basic Info */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">基本資訊</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>姓名</Label>
                <Input value={name} onChange={e => setName(e.target.value)} disabled={isReadOnly} />
              </div>
              <div className="space-y-2">
                <Label>角色</Label>
                <div className="flex items-center h-9">
                  <Badge variant={isAdvisor ? 'advisor' : 'mentor'}>
                    {isAdvisor ? '投顧分析師' : '實戰導師'}
                  </Badge>
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <Label>簡介</Label>
              <Input value={bio} onChange={e => setBio(e.target.value)} disabled={isReadOnly} />
            </div>
            <div className="space-y-2">
              <Label>詳細介紹</Label>
              <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={4} disabled={isReadOnly} />
            </div>
          </CardContent>
        </Card>

        {/* Style & Market */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">風格與市場</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>風格標籤</Label>
              <div className="flex flex-wrap gap-2">
                {styleTags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="gap-1">
                    {tag}
                    <PermissionTooltip disabled={isReadOnly}>
                      <X
                        className={cn(
                          'h-3 w-3',
                          isReadOnly ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
                        )}
                        onClick={() => !isReadOnly && setStyleTags(styleTags.filter(t => t !== tag))}
                      />
                    </PermissionTooltip>
                  </Badge>
                ))}
                <div className="flex gap-1">
                  <Input
                    value={newTag}
                    onChange={e => setNewTag(e.target.value)}
                    placeholder="新標籤"
                    className={cn('h-6 w-24 text-xs', isReadOnly && 'bg-muted/50 cursor-not-allowed')}
                    onKeyDown={e => e.key === 'Enter' && !isReadOnly && addTag()}
                    readOnly={isReadOnly}
                  />
                  <PermissionTooltip disabled={isReadOnly}>
                    <Button variant="outline" size="sm" className="h-6 text-xs" onClick={addTag} disabled={isReadOnly}>
                      <Plus className="h-3 w-3" />
                    </Button>
                  </PermissionTooltip>
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <Label>交易市場</Label>
              <div className="flex flex-wrap gap-2">
                {markets.map((market) => (
                  <Badge key={market} variant="outline" className="gap-1">
                    {market}
                    <PermissionTooltip disabled={isReadOnly}>
                      <X
                        className={cn(
                          'h-3 w-3',
                          isReadOnly ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
                        )}
                        onClick={() => !isReadOnly && setMarkets(markets.filter(m => m !== market))}
                      />
                    </PermissionTooltip>
                  </Badge>
                ))}
                <div className="flex gap-1">
                  <Input
                    value={newMarket}
                    onChange={e => setNewMarket(e.target.value)}
                    placeholder="新市場"
                    className={cn('h-6 w-24 text-xs', isReadOnly && 'bg-muted/50 cursor-not-allowed')}
                    onKeyDown={e => e.key === 'Enter' && !isReadOnly && addMarket()}
                    readOnly={isReadOnly}
                  />
                  <PermissionTooltip disabled={isReadOnly}>
                    <Button variant="outline" size="sm" className="h-6 text-xs" onClick={addMarket} disabled={isReadOnly}>
                      <Plus className="h-3 w-3" />
                    </Button>
                  </PermissionTooltip>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Strategy & Backtest (KPIs are system-calculated, read-only) */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              策略與回測
              <Badge variant="outline" className="text-[10px] font-normal">
                <Lock className="h-3 w-3 mr-1" />KPI 系統計算
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>策略摘要</Label>
              <Textarea
                value={strategySummary}
                onChange={(e) => setStrategySummary(e.target.value)}
                rows={3}
                placeholder="一段話總結您的選股與操作邏輯，會顯示於前台 Hero 區"
                disabled={isReadOnly}
              />
              <p className="text-xs text-muted-foreground">出現在前台個人頁的策略區段</p>
            </div>

            <div>
              <Label className="mb-2 block">回測 KPI（系統依實際交易紀錄自動計算，不可手動修改）</Label>
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border bg-muted/30 p-3">
                  <div className="text-xs text-muted-foreground">1 年累積報酬</div>
                  <div className="text-lg font-semibold tabular-nums mt-1">
                    {perf?.return_1y != null ? `${perf.return_1y.toFixed(2)}%` : '—'}
                  </div>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3">
                  <div className="text-xs text-muted-foreground">最大回撤</div>
                  <div className="text-lg font-semibold tabular-nums mt-1">
                    {perf?.max_drawdown != null ? `${perf.max_drawdown.toFixed(2)}%` : '—'}
                  </div>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3">
                  <div className="text-xs text-muted-foreground">總報酬率（含未實現）</div>
                  <div className="text-lg font-semibold tabular-nums mt-1">
                    {(perf as any)?.total_return_pct != null ? `${Number((perf as any).total_return_pct).toFixed(2)}%` : '—'}
                  </div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                數值會隨您發布的訊號與已平倉交易自動更新
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">起始資金</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2 max-w-sm">
              <Label>起始資金（NT$）</Label>
              <Input
                type="number"
                value={startingCapital}
                onChange={e => setStartingCapital(e.target.value)}
                placeholder="例：1000000"
                disabled={startingCapitalLocked || isReadOnly}
                className={cn(isReadOnly && !startingCapitalLocked && 'bg-muted/50 cursor-not-allowed')}
              />
              {startingCapitalLocked && (
                <p className="text-xs text-muted-foreground">起始資金已設定，無法修改。</p>
              )}
              {capitalStatus && startingCapitalLocked && (
                <div className="grid grid-cols-3 gap-2 pt-2">
                  <div className="rounded-md border bg-muted/30 p-2">
                    <div className="text-[10px] text-muted-foreground">目前可用現金</div>
                    <div className={cn('text-sm font-semibold tabular-nums', capitalStatus.available_cash < 0 ? 'text-destructive' : '')}>
                      ${(capitalStatus.available_cash || 0).toLocaleString()}
                    </div>
                  </div>
                  <div className="rounded-md border bg-muted/30 p-2">
                    <div className="text-[10px] text-muted-foreground">未平倉成本</div>
                    <div className="text-sm font-semibold tabular-nums">${(capitalStatus.open_cost_value || 0).toLocaleString()}</div>
                  </div>
                  <div className="rounded-md border bg-muted/30 p-2">
                    <div className="text-[10px] text-muted-foreground">已實現損益</div>
                    <div className={cn('text-sm font-semibold tabular-nums',
                      capitalStatus.realized_pnl_amount > 0 ? 'text-red-600 dark:text-red-400' :
                      capitalStatus.realized_pnl_amount < 0 ? 'text-green-600 dark:text-green-400' : '')}>
                      {capitalStatus.realized_pnl_amount > 0 ? '+' : ''}${(capitalStatus.realized_pnl_amount || 0).toLocaleString()}
                    </div>
                  </div>
                </div>
              )}
            </div>
            {!startingCapitalLocked && (
              <PermissionTooltip disabled={isReadOnly}>
                <Button
                  size="sm"
                  disabled={!startingCapital || Number(startingCapital) <= 0 || isReadOnly}
                  onClick={() => {
                    setPendingCapital(Number(startingCapital));
                    setShowCapitalConfirm(true);
                  }}
                >
                  確認設定
                </Button>
              </PermissionTooltip>
            )}
          </CardContent>
        </Card>

        <AlertDialog open={showCapitalConfirm} onOpenChange={setShowCapitalConfirm}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-destructive" />
                確認起始資金
              </AlertDialogTitle>
              <AlertDialogDescription>
                您即將設定起始資金為 <strong>NT$ {pendingCapital.toLocaleString()}</strong>。
                <br /><br />
                <span className="text-destructive font-medium">起始資金設定後將無法更改，請確認金額正確。</span>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction onClick={async () => {
                if (!expert) return;
                const { error } = await supabase.from('experts').update({ starting_capital: pendingCapital } as any).eq('id', expert.id);
                if (error) { toast.error('設定失敗：' + error.message); return; }
                toast.success('起始資金已設定');
                setStartingCapitalLocked(true);
                setExpert({ ...expert, starting_capital: pendingCapital });
              }}>
                確認設定
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {!isReadOnly && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">修改密碼</CardTitle>
            </CardHeader>
            <CardContent>
              <PasswordChangeForm />
            </CardContent>
          </Card>
        )}
      </div>
    </AdminLayout>
  );
};

function PasswordChangeForm() {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleChange = async () => {
    if (newPassword.length < 6) { toast.error('密碼至少 6 位'); return; }
    if (newPassword !== confirmPassword) { toast.error('兩次密碼不一致'); return; }
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setSaving(false);
    if (error) { toast.error('修改失敗：' + error.message); return; }
    toast.success('密碼已更新');
    setNewPassword('');
    setConfirmPassword('');
  };

  return (
    <div className="space-y-4 max-w-sm">
      <div className="space-y-2">
        <Label>新密碼</Label>
        <div className="relative">
          <Input type={showNew ? 'text' : 'password'} value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="至少 6 位" className="pr-10" />
          <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setShowNew(!showNew)}>
            {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>
      <div className="space-y-2">
        <Label>確認新密碼</Label>
        <div className="relative">
          <Input type={showConfirm ? 'text' : 'password'} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="再次輸入" className="pr-10" />
          <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setShowConfirm(!showConfirm)}>
            {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>
      <Button onClick={handleChange} disabled={saving} size="sm">
        {saving ? '更新中...' : '更新密碼'}
      </Button>
    </div>
  );
}

export default AdminProfile;
