import { useParams } from 'react-router-dom';
import { AdminLayout } from '@/components/layouts/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { getPersonBySlug } from '@/data/mockData';
import { PersonRole } from '@/types';
import { cn } from '@/lib/utils';
import { Save, Upload } from 'lucide-react';

const AdminProfile = () => {
  const { expertSlug } = useParams<{ expertSlug: string }>();
  const expert = expertSlug ? getPersonBySlug(expertSlug) : undefined;

  if (!expert) return <AdminLayout><div /></AdminLayout>;

  const isAdvisor = expert.role === PersonRole.ADVISOR;

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">個人檔案</h1>
            <p className="text-muted-foreground text-sm mt-1">編輯您的公開資訊</p>
          </div>
          <Button className={cn(isAdvisor ? "bg-advisor hover:bg-advisor/90" : "bg-mentor hover:bg-mentor/90")}>
            <Save className="h-4 w-4 mr-2" />
            儲存變更
          </Button>
        </div>

        {/* Avatar */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">頭像</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-6">
              <img
                src={expert.avatarUrl || '/placeholder.svg'}
                alt={expert.name}
                className="h-20 w-20 rounded-full object-cover border-2 border-border"
              />
              <div>
                <Button variant="outline" size="sm">
                  <Upload className="h-4 w-4 mr-2" />
                  更換頭像
                </Button>
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
                <Input defaultValue={expert.name} />
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
              <Input defaultValue={expert.bio} />
            </div>
            <div className="space-y-2">
              <Label>詳細介紹</Label>
              <Textarea defaultValue={expert.description} rows={4} />
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
                {expert.styleTags.map((tag) => (
                  <Badge key={tag} variant="secondary">{tag}</Badge>
                ))}
                <Button variant="outline" size="sm" className="h-6 text-xs">+ 新增</Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label>交易市場</Label>
              <div className="flex flex-wrap gap-2">
                {expert.markets.map((market) => (
                  <Badge key={market} variant="outline">{market}</Badge>
                ))}
                <Button variant="outline" size="sm" className="h-6 text-xs">+ 新增</Button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>風險屬性</Label>
                <Input defaultValue={expert.riskTolerance || ''} />
              </div>
              <div className="space-y-2">
                <Label>交易週期</Label>
                <Input defaultValue={expert.timeframe || ''} />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
};

export default AdminProfile;
