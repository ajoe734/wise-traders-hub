import { useState, useEffect } from 'react';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Plus, Megaphone, Pencil, Trash2, Send, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { logAdminAction } from '@/lib/auditLog';

const CompanyAnnouncements = () => {
  const { user } = useAuth();
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState<'all' | 'draft' | 'published'>('all');
  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchAnnouncements(); }, []);

  const fetchAnnouncements = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('announcements')
      .select('*')
      .order('created_at', { ascending: false });
    setAnnouncements(data || []);
    setLoading(false);
  };

  const openCreate = () => {
    setEditingId(null);
    setTitle('');
    setContent('');
    setIsOpen(true);
  };

  const openEdit = (a: any) => {
    setEditingId(a.id);
    setTitle(a.title);
    setContent(a.content);
    setIsOpen(true);
  };

  const handleSave = async () => {
    if (!title.trim() || !content.trim()) return;
    if (editingId) {
      const { error } = await supabase.from('announcements').update({ title, content }).eq('id', editingId);
      if (error) { toast.error(error.message); return; }
      toast.success('公告已更新');
    } else {
      const { error } = await supabase.from('announcements').insert({
        title, content, created_by: user?.id,
      });
      if (error) { toast.error(error.message); return; }
      toast.success('公告已建立');
    }
    setIsOpen(false);
    fetchAnnouncements();
  };

  const togglePublish = async (a: any) => {
    const newStatus = a.status === 'published' ? 'draft' : 'published';
    const updates: any = { status: newStatus };
    if (newStatus === 'published') updates.published_at = new Date().toISOString();
    else updates.published_at = null;

    await supabase.from('announcements').update(updates).eq('id', a.id);
    await logAdminAction({
      action: newStatus === 'published' ? 'announcement.publish' : 'announcement.unpublish',
      targetType: 'announcements',
      targetId: a.id,
      detail: {
        before: { status: a.status, published_at: a.published_at },
        after: { status: newStatus, published_at: updates.published_at },
        context: { title: a.title },
      },
    });
    toast.success(newStatus === 'published' ? '已發布' : '已取消發布');
    fetchAnnouncements();
  };

  const handleDelete = async (id: string) => {
    const target = announcements.find(x => x.id === id);
    await supabase.from('announcements').delete().eq('id', id);
    await logAdminAction({
      action: 'announcement.delete',
      targetType: 'announcements',
      targetId: id,
      detail: { before: { title: target?.title, status: target?.status }, context: { title: target?.title } },
    });
    toast.success('公告已刪除');
    fetchAnnouncements();
  };

  const filtered = announcements.filter(a => statusFilter === 'all' || a.status === statusFilter);

  return (
    <CompanyLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">系統公告</h1>
            <p className="text-muted-foreground text-sm mt-1">管理全平台公告訊息</p>
          </div>
          <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="bg-company hover:bg-company/90 text-white" onClick={openCreate}>
                <Plus className="h-4 w-4 mr-2" />新增公告
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>{editingId ? '編輯公告' : '新增公告'}</DialogTitle></DialogHeader>
              <div className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label>標題</Label>
                  <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="公告標題" />
                </div>
                <div className="space-y-2">
                  <Label>內容</Label>
                  <Textarea value={content} onChange={e => setContent(e.target.value)} placeholder="公告內容..." rows={5} />
                </div>
                <div className="flex justify-end gap-3">
                  <Button variant="outline" onClick={() => setIsOpen(false)}>取消</Button>
                  <Button onClick={handleSave}>{editingId ? '更新' : '建立'}</Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <div className="flex items-center bg-muted rounded-lg p-1 w-fit">
          {[{ key: 'all', label: '全部' }, { key: 'draft', label: '草稿' }, { key: 'published', label: '已發布' }].map(f => (
            <button
              key={f.key}
              onClick={() => setStatusFilter(f.key as any)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${statusFilter === f.key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {loading ? (
          <Card><CardContent className="py-12 text-center text-muted-foreground text-sm">載入中...</CardContent></Card>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <Megaphone className="h-8 w-8 mx-auto mb-3 opacity-50" />
              <p>尚無公告</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {filtered.map(a => (
              <Card key={a.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-medium truncate">{a.title}</h3>
                        <Badge variant={a.status === 'published' ? 'default' : 'secondary'} className="text-xs shrink-0">
                          {a.status === 'published' ? '已發布' : '草稿'}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-2">{a.content}</p>
                      <p className="text-xs text-muted-foreground mt-2">
                        {new Date(a.created_at).toLocaleString('zh-TW')}
                        {a.published_at && ` · 發布於 ${new Date(a.published_at).toLocaleString('zh-TW')}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {a.status === 'draft' ? (
                        <Button size="sm" className="h-8 text-xs bg-company hover:bg-company/90 text-white" onClick={() => togglePublish(a)}>
                          <Send className="h-3.5 w-3.5 mr-1" />發布
                        </Button>
                      ) : (
                        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => togglePublish(a)}>
                          <RotateCcw className="h-3.5 w-3.5 mr-1" />取消發布
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => openEdit(a)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive hover:text-destructive">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>確認刪除</AlertDialogTitle>
                            <AlertDialogDescription>確定要刪除公告「{a.title}」嗎？此操作無法復原。</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>取消</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleDelete(a.id)}>刪除</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </CompanyLayout>
  );
};

export default CompanyAnnouncements;
