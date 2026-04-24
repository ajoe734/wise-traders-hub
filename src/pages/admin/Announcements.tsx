import { useEffect, useState } from 'react';
import { AdminLayout } from '@/components/layouts/AdminLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { Megaphone, Info } from 'lucide-react';

interface Announcement {
  id: string;
  title: string;
  content: string;
  status: string;
  published_at: string | null;
  created_at: string;
}

const fmtDate = (s: string | null) => {
  if (!s) return '-';
  const d = new Date(s);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
};

const AdminAnnouncements = () => {
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('announcements')
        .select('id, title, content, status, published_at, created_at')
        .eq('status', 'published')
        .order('published_at', { ascending: false });
      setItems((data as Announcement[]) || []);
      setLoading(false);
    })();
  }, []);

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Megaphone className="h-6 w-6" /> 系統公告
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            查閱公司發布的最新平台公告
          </p>
        </div>

        <Card className="bg-muted/30 border-dashed">
          <CardContent className="p-4 flex items-start gap-2">
            <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <p className="text-xs text-muted-foreground">
              公告由公司統一發布，分析師為唯讀檢視。如有特殊事項需公告，請聯絡公司管理員。
            </p>
          </CardContent>
        </Card>

        {loading ? (
          <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">載入中...</div>
        ) : items.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground text-sm">
              目前尚無公告
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {items.map((a) => (
              <Card key={a.id}>
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="font-semibold text-base">{a.title}</h2>
                    <Badge variant="secondary" className="text-[10px] shrink-0">
                      {fmtDate(a.published_at || a.created_at)}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground whitespace-pre-line leading-relaxed">
                    {a.content}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AdminLayout>
  );
};

export default AdminAnnouncements;
