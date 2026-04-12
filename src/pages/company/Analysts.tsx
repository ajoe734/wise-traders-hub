import { useState, useEffect } from 'react';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/integrations/supabase/client';
import { Eye, UserPlus, MessageCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

const CompanyAnalysts = () => {
  const [experts, setExperts] = useState<any[]>([]);
  const [isCreateOpen, setIsCreateOpen] = useState(() => {
    return sessionStorage.getItem('company_analyst_create_open') === 'true';
  });
  const [loading, setLoading] = useState(true);

  // Create analyst form – restore from sessionStorage on mount
  const [email, setEmail] = useState(() => sessionStorage.getItem('ca_email') || '');
  const [password, setPassword] = useState(() => sessionStorage.getItem('ca_password') || '');
  const [name, setName] = useState(() => sessionStorage.getItem('ca_name') || '');
  const [slug, setSlug] = useState(() => sessionStorage.getItem('ca_slug') || '');
  const [role, setRole] = useState(() => sessionStorage.getItem('ca_role') || '');
  const [creating, setCreating] = useState(false);

  // Persist create form state
  useEffect(() => {
    sessionStorage.setItem('company_analyst_create_open', String(isCreateOpen));
  }, [isCreateOpen]);
  useEffect(() => { sessionStorage.setItem('ca_email', email); }, [email]);
  useEffect(() => { sessionStorage.setItem('ca_password', password); }, [password]);
  useEffect(() => { sessionStorage.setItem('ca_name', name); }, [name]);
  useEffect(() => { sessionStorage.setItem('ca_slug', slug); }, [slug]);
  useEffect(() => { sessionStorage.setItem('ca_role', role); }, [role]);

  const clearForm = () => {
    setEmail(''); setPassword(''); setName(''); setSlug(''); setRole('');
    ['ca_email','ca_password','ca_name','ca_slug','ca_role'].forEach(k => sessionStorage.removeItem(k));
  };

  // LINE channel management
  const [lineExpertId, setLineExpertId] = useState<string | null>(() => {
    return sessionStorage.getItem('company_line_expert_id') || null;
  });
  const [lineExpertName, setLineExpertName] = useState(() => sessionStorage.getItem('cl_name') || '');
  const [lineChannel, setLineChannel] = useState<any>(null);
  const [lineLoading, setLineLoading] = useState(false);
  const [lineChannelId, setLineChannelId] = useState(() => sessionStorage.getItem('cl_channelId') || '');
  const [lineToken, setLineToken] = useState(() => sessionStorage.getItem('cl_token') || '');
  const [lineChannelName, setLineChannelName] = useState(() => sessionStorage.getItem('cl_channelName') || '');
  const [lineOaId, setLineOaId] = useState(() => sessionStorage.getItem('cl_oaId') || '');
  const [lineQrCodeUrl, setLineQrCodeUrl] = useState(() => sessionStorage.getItem('cl_qrCode') || '');
  const [lineActive, setLineActive] = useState(() => sessionStorage.getItem('cl_active') !== 'false');
  const [savingLine, setSavingLine] = useState(false);
  const [lineBindingsCount, setLineBindingsCount] = useState(0);

  // Persist LINE form fields
  useEffect(() => { sessionStorage.setItem('cl_name', lineExpertName); }, [lineExpertName]);
  useEffect(() => { sessionStorage.setItem('cl_channelId', lineChannelId); }, [lineChannelId]);
  useEffect(() => { sessionStorage.setItem('cl_token', lineToken); }, [lineToken]);
  useEffect(() => { sessionStorage.setItem('cl_channelName', lineChannelName); }, [lineChannelName]);
  useEffect(() => { sessionStorage.setItem('cl_oaId', lineOaId); }, [lineOaId]);
  useEffect(() => { sessionStorage.setItem('cl_qrCode', lineQrCodeUrl); }, [lineQrCodeUrl]);
  useEffect(() => { sessionStorage.setItem('cl_active', String(lineActive)); }, [lineActive]);

  useEffect(() => {
    if (lineExpertId) {
      sessionStorage.setItem('company_line_expert_id', lineExpertId);
    } else {
      sessionStorage.removeItem('company_line_expert_id');
    }
  }, [lineExpertId]);

  // Restore LINE dialog on mount if persisted — no flicker if fields already cached
  useEffect(() => {
    if (lineExpertId && experts.length > 0) {
      const exp = experts.find(e => e.id === lineExpertId);
      if (exp && !lineExpertName) {
        setLineExpertName(exp.name);
      }
    }
  }, [lineExpertId, experts]);

  useEffect(() => { fetchExperts(); }, []);

  const fetchExperts = async () => {
    setLoading(true);
    const { data } = await supabase.from('experts').select('*').order('created_at', { ascending: false });
    setExperts(data || []);
    setLoading(false);
  };

  const handleCreate = async () => {
    if (!email || !password || !name || !slug || !role) {
      toast.error('請填寫所有必填欄位');
      return;
    }
    setCreating(true);
    const { data, error } = await supabase.functions.invoke('create-analyst', {
      body: { email, password, name, slug, role },
    });
    setCreating(false);
    if (error || data?.error) {
      toast.error(data?.error || error?.message || '建立失敗');
      return;
    }
    toast.success('分析師已建立');
    setIsCreateOpen(false);
    clearForm();
    fetchExperts();
  };

  const toggleStatus = async (id: string, currentStatus: string) => {
    let newStatus: string;
    if (currentStatus === 'suspended') {
      // Restore: real experts (created_by is set) go back to 'active', test experts to 'draft'
      const expert = experts.find(e => e.id === id);
      newStatus = expert?.created_by ? 'active' : 'draft';
    } else {
      newStatus = 'suspended';
    }
    setExperts(prev => prev.map(e => e.id === id ? { ...e, status: newStatus } : e));
    await supabase.from('experts').update({ status: newStatus }).eq('id', id);
    toast.success(newStatus === 'suspended' ? '已停用' : '已啟用');
  };

  // LINE channel management
  const clearLineForm = () => {
    setLineChannel(null);
    setLineChannelId('');
    setLineToken('');
    setLineChannelName('');
    setLineOaId('');
    setLineQrCodeUrl('');
    setLineActive(true);
    setLineBindingsCount(0);
    ['cl_channelId','cl_token','cl_channelName','cl_oaId','cl_qrCode','cl_active'].forEach(k => sessionStorage.removeItem(k));
  };

  const openLineSettings = (expert: any) => {
    clearLineForm();
    setLineExpertId(expert.id);
    setLineExpertName(expert.name);
    setLineLoading(true);
    (async () => {
      const { data: ch } = await supabase
        .from('expert_line_channels')
        .select('*')
        .eq('expert_id', expert.id)
        .single();
      if (ch) {
        setLineChannel(ch);
        setLineChannelId(ch.channel_id);
        setLineToken(ch.channel_access_token);
        setLineChannelName(ch.channel_name || '');
        setLineOaId(ch.line_oa_id || '');
        setLineQrCodeUrl(ch.qr_code_url || '');
        setLineActive(ch.is_active);
      }
      const { count } = await supabase
        .from('member_line_bindings_analyst')
        .select('id', { count: 'exact', head: true })
        .eq('expert_id', expert.id)
        .eq('is_active', true);
      setLineBindingsCount(count || 0);
      setLineLoading(false);
    })();
  };

  const closeLineSettings = () => {
    setLineExpertId(null);
    setLineExpertName('');
    setLineChannel(null);
    clearLineForm();
  };

  const handleSaveLine = async () => {
    if (!lineExpertId || !lineChannelId || !lineToken) {
      toast.error('請填寫 Channel ID 和 Access Token');
      return;
    }
    setSavingLine(true);
    if (lineChannel) {
      const { error } = await supabase
        .from('expert_line_channels')
        .update({
          channel_id: lineChannelId,
          channel_access_token: lineToken,
          channel_name: lineChannelName || null,
          line_oa_id: lineOaId || null,
          qr_code_url: lineQrCodeUrl || null,
          is_active: lineActive,
        })
        .eq('id', lineChannel.id);
      if (error) { toast.error('更新失敗'); setSavingLine(false); return; }
      toast.success('LINE 設定已更新');
    } else {
      const { error } = await supabase
        .from('expert_line_channels')
        .insert({
          expert_id: lineExpertId,
          channel_id: lineChannelId,
          channel_access_token: lineToken,
          channel_name: lineChannelName || null,
          line_oa_id: lineOaId || null,
          qr_code_url: lineQrCodeUrl || null,
          is_active: lineActive,
        });
      if (error) { toast.error('建立失敗'); setSavingLine(false); return; }
      toast.success('LINE 設定已儲存');
    }
    setSavingLine(false);
    closeLineSettings();
  };

  return (
    <CompanyLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">分析師管理</h1>
            <p className="text-muted-foreground text-sm mt-1">管理所有分析師帳號與權限</p>
          </div>
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="bg-company hover:bg-company/90 text-white" onClick={() => { clearForm(); setIsCreateOpen(true); }}><UserPlus className="h-4 w-4 mr-2" />新增分析師</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>新增分析師帳號</DialogTitle></DialogHeader>
              <div className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input value={email} onChange={e => setEmail(e.target.value)} placeholder="analyst@example.com" type="email" />
                </div>
                <div className="space-y-2">
                  <Label>密碼</Label>
                  <Input value={password} onChange={e => setPassword(e.target.value)} placeholder="至少 6 位" type="password" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>姓名</Label>
                    <Input value={name} onChange={e => setName(e.target.value)} placeholder="趙彭博" />
                  </div>
                  <div className="space-y-2">
                    <Label>Slug（URL識別）</Label>
                    <Input value={slug} onChange={e => setSlug(e.target.value)} placeholder="zhao-pengbo" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>角色</Label>
                  <Select value={role} onValueChange={setRole}>
                    <SelectTrigger><SelectValue placeholder="選擇角色" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="advisor">投顧分析師</SelectItem>
                      <SelectItem value="mentor">實戰導師</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex justify-end gap-3 pt-2">
                  <Button variant="outline" onClick={() => setIsCreateOpen(false)}>取消</Button>
                  <Button onClick={handleCreate} disabled={creating}>{creating ? '建立中...' : '建立帳號'}</Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <Card>
          <CardContent className="p-0">
            <table className="w-full">
              <thead>
                <tr className="border-b text-left text-sm text-muted-foreground">
                  <th className="p-4">分析師</th>
                  <th className="p-4">角色</th>
                  <th className="p-4">Slug</th>
                  <th className="p-4">狀態</th>
                  <th className="p-4">操作</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={5} className="p-8 text-center text-muted-foreground text-sm">載入中...</td></tr>
                ) : experts.length === 0 ? (
                  <tr><td colSpan={5} className="p-8 text-center text-muted-foreground text-sm">尚無分析師</td></tr>
                ) : (
                  experts.map(exp => (
                    <tr key={exp.id} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          <img src={exp.avatar_url || '/placeholder.svg'} alt={exp.name} className="h-8 w-8 rounded-full object-cover" />
                          <p className="font-medium text-sm">{exp.name}</p>
                        </div>
                      </td>
                      <td className="p-4">
                        <Badge variant={exp.role === 'advisor' ? 'default' : 'secondary'} className="text-xs">
                          {exp.role === 'advisor' ? '投顧分析師' : '實戰導師'}
                        </Badge>
                      </td>
                      <td className="p-4 text-sm text-muted-foreground">{exp.slug}</td>
                      <td className="p-4">
                        <Badge 
                          className={`text-xs ${exp.status === 'suspended' ? 'bg-red-500 text-white' : 'bg-emerald-500 text-white'}`}
                        >
                          {exp.status === 'suspended' ? '已停用' : '啟用中'}
                        </Badge>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => openLineSettings(exp)}>
                            <MessageCircle className="h-3 w-3 mr-1" />LINE
                          </Button>
                          <Button variant="ghost" size="sm" className="h-7 text-xs" asChild>
                            <Link to={`/admin/${exp.slug}`}><Eye className="h-3 w-3 mr-1" />後台</Link>
                          </Button>
                          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => toggleStatus(exp.id, exp.status)}>
                            {exp.status === 'suspended' ? '啟用' : '停用'}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      {/* LINE Channel Settings Dialog */}
      <Dialog open={!!lineExpertId} onOpenChange={(open) => { if (!open) closeLineSettings(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{lineExpertName} — LINE 設定</DialogTitle>
          </DialogHeader>
          {lineLoading ? (
            <p className="text-sm text-muted-foreground text-center py-4">載入中...</p>
          ) : (
            <div className="space-y-4 mt-2">
              <div className="space-y-2">
                <Label>Channel ID</Label>
                <Input value={lineChannelId} onChange={e => setLineChannelId(e.target.value)} placeholder="LINE Channel ID" />
              </div>
              <div className="space-y-2">
                <Label>Channel Access Token</Label>
                <Input value={lineToken} onChange={e => setLineToken(e.target.value)} placeholder="長期 Channel Access Token" type="password" />
              </div>
              <div className="space-y-2">
                <Label>顯示名稱（選填）</Label>
                <Input value={lineChannelName} onChange={e => setLineChannelName(e.target.value)} placeholder="例：趙彭博｜訊號通知" />
              </div>
              <div className="space-y-2">
                <Label>Bot Basic ID</Label>
                <Input value={lineOaId} onChange={e => setLineOaId(e.target.value)} placeholder="例：@zhao-pengbo" />
                <p className="text-xs text-muted-foreground">訂閱者透過此 ID 搜尋並加入官方帳號</p>
              </div>
              <div className="space-y-2">
                <Label>QR Code 網址</Label>
                <Input value={lineQrCodeUrl} onChange={e => setLineQrCodeUrl(e.target.value)} placeholder="https://qr-official.line.me/..." />
                <p className="text-xs text-muted-foreground">訂閱者可掃描 QR Code 加入官方帳號</p>
              </div>
              <div className="flex items-center justify-between">
                <Label>啟用推播</Label>
                <Switch checked={lineActive} onCheckedChange={setLineActive} />
              </div>
              <div className="text-xs text-muted-foreground">
                已綁定訂閱者：{lineBindingsCount} 人
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <Button variant="outline" onClick={closeLineSettings}>取消</Button>
                <Button onClick={handleSaveLine} disabled={savingLine}>
                  {savingLine ? '儲存中...' : lineChannel ? '更新設定' : '儲存設定'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </CompanyLayout>
  );
};

export default CompanyAnalysts;
