import { useState, useEffect } from 'react';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { Eye, UserPlus, BarChart3, Radio } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

const CompanyAnalysts = () => {
  const [experts, setExperts] = useState<any[]>([]);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  // Form
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [role, setRole] = useState('');
  const [creating, setCreating] = useState(false);

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
    setEmail(''); setPassword(''); setName(''); setSlug(''); setRole('');
    fetchExperts();
  };

  const toggleStatus = async (id: string, currentStatus: string) => {
    const newStatus = currentStatus === 'active' ? 'suspended' : 'active';
    await supabase.from('experts').update({ status: newStatus }).eq('id', id);
    toast.success(newStatus === 'active' ? '已啟用' : '已停用');
    fetchExperts();
  };

  return (
    <CompanyLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">分析師管理</h1>
            <p className="text-muted-foreground text-sm mt-1">管理所有分析師帳號、權限與績效</p>
          </div>
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><UserPlus className="h-4 w-4 mr-2" />新增分析師</Button>
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
                        <Badge variant={exp.status === 'active' ? 'outline' : 'destructive'} className="text-xs">
                          {exp.status === 'active' ? '啟用中' : '已停用'}
                        </Badge>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="sm" className="h-7 text-xs" asChild>
                            <Link to={`/admin/${exp.slug}`}><Eye className="h-3 w-3 mr-1" />後台</Link>
                          </Button>
                          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => toggleStatus(exp.id, exp.status)}>
                            {exp.status === 'active' ? '停用' : '啟用'}
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
    </CompanyLayout>
  );
};

export default CompanyAnalysts;
