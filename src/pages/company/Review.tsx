import { useState } from 'react';
import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CheckCircle, XCircle, Clock, Eye, MessageSquare } from 'lucide-react';

const allItems = [
  { id: '1', type: '訊號', analyst: '趙彭博（投顧）', slug: 'zhao-pengbo', title: '買進 2330 台積電', detail: '看好 AI 伺服器需求持續成長，技術面突破月線', time: '2026-02-24 09:15', status: 'pending' },
  { id: '2', type: '週記', analyst: '趙彭博（導師）', slug: 'zhao-pengbo-mentor', title: '第8週實戰週記：AI 族群輪動', detail: '本週重點拆解 AI 概念股的族群輪動邏輯', time: '2026-02-23 18:00', status: 'pending' },
  { id: '3', type: '訊號', analyst: '趙彭博（投顧）', slug: 'zhao-pengbo', title: '減碼 2454 聯發科', detail: '短線漲幅已大，先減碼鎖利', time: '2026-02-22 13:20', status: 'approved' },
  { id: '4', type: '訊號', analyst: '趙彭博（投顧）', slug: 'zhao-pengbo', title: '賣出 2603 長榮', detail: '航運景氣反轉訊號明確，獲利了結', time: '2026-02-21 10:05', status: 'rejected' },
  { id: '5', type: '訊號', analyst: '陳建宏', slug: 'chen-advisor', title: '買進 2881 富邦金', detail: '金融股估值偏低，殖利率具吸引力', time: '2026-02-20 14:30', status: 'approved' },
  { id: '6', type: '週記', analyst: '吳志明（導師）', slug: 'wu-mentor', title: '第7週教學：均線戰法實戰', detail: '利用 5MA/20MA 交叉判斷短線進出場', time: '2026-02-19 17:00', status: 'approved' },
  { id: '7', type: '訊號', analyst: '林美玲', slug: 'lin-advisor', title: '加碼 0056 高股息', detail: '除息後回填空間大，逢低加碼', time: '2026-02-18 09:45', status: 'approved' },
  { id: '8', type: '訊號', analyst: '黃雅琪（導師）', slug: 'huang-mentor', title: '觀察 3037 欣興', detail: 'ABF 載板需求回溫，技術面打底完成', time: '2026-02-17 11:00', status: 'pending' },
];

const CompanyReview = () => {
  const [tab, setTab] = useState('pending');

  const pendingItems = allItems.filter(i => i.status === 'pending');
  const approvedItems = allItems.filter(i => i.status === 'approved');
  const rejectedItems = allItems.filter(i => i.status === 'rejected');

  const renderItems = (items: typeof allItems) => (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item.id} className="flex items-start justify-between py-3 border-b last:border-0">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <Badge variant={item.type === '訊號' ? 'default' : 'secondary'} className="text-xs w-12 justify-center mt-0.5 shrink-0">
              {item.type}
            </Badge>
            <div className="min-w-0">
              <p className="font-medium text-sm">{item.title}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{item.detail}</p>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs text-muted-foreground">{item.analyst}</span>
                <span className="text-xs text-muted-foreground">·</span>
                <span className="text-xs text-muted-foreground">{item.time}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-3">
            {item.status === 'pending' ? (
              <>
                <Button size="sm" variant="ghost" className="h-7 text-xs" asChild>
                  <a href={`/admin/${item.slug}/signals`}>
                    <Eye className="h-3 w-3 mr-1" />查看
                  </a>
                </Button>
                <Button size="sm" variant="outline" className="text-green-600 border-green-600/30 hover:bg-green-500/10 h-7 text-xs">
                  <CheckCircle className="h-3 w-3 mr-1" />通過
                </Button>
                <Button size="sm" variant="outline" className="text-destructive border-destructive/30 hover:bg-destructive/10 h-7 text-xs">
                  <XCircle className="h-3 w-3 mr-1" />退回
                </Button>
              </>
            ) : (
              <Badge variant={item.status === 'approved' ? 'outline' : 'destructive'} className="text-xs">
                {item.status === 'approved' ? '已通過' : '已退回'}
              </Badge>
            )}
          </div>
        </div>
      ))}
      {items.length === 0 && (
        <div className="py-8 text-center text-muted-foreground text-sm">
          暫無項目
        </div>
      )}
    </div>
  );

  return (
    <CompanyLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">內容審核</h1>
          <p className="text-muted-foreground text-sm mt-1">審核分析師發布的訊號與內容</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <Clock className="h-5 w-5 text-yellow-500" />
              <div>
                <div className="text-2xl font-bold">{pendingItems.length}</div>
                <div className="text-xs text-muted-foreground">待審核</div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <CheckCircle className="h-5 w-5 text-green-500" />
              <div>
                <div className="text-2xl font-bold">{approvedItems.length}</div>
                <div className="text-xs text-muted-foreground">已通過</div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <XCircle className="h-5 w-5 text-destructive" />
              <div>
                <div className="text-2xl font-bold">{rejectedItems.length}</div>
                <div className="text-xs text-muted-foreground">已退回</div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="pending">
              待審核 {pendingItems.length > 0 && <Badge variant="destructive" className="ml-1.5 h-4 px-1.5 text-[10px]">{pendingItems.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="approved">已通過</TabsTrigger>
            <TabsTrigger value="rejected">已退回</TabsTrigger>
          </TabsList>
          <Card className="mt-4">
            <CardContent className="pt-4">
              <TabsContent value="pending" className="mt-0">{renderItems(pendingItems)}</TabsContent>
              <TabsContent value="approved" className="mt-0">{renderItems(approvedItems)}</TabsContent>
              <TabsContent value="rejected" className="mt-0">{renderItems(rejectedItems)}</TabsContent>
            </CardContent>
          </Card>
        </Tabs>
      </div>
    </CompanyLayout>
  );
};

export default CompanyReview;
