import { CompanyLayout } from '@/components/layouts/CompanyLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckCircle, XCircle, Clock } from 'lucide-react';

const pendingItems = [
  { id: '1', type: '訊號', analyst: '趙彭博（投顧）', title: '買進 2330 台積電', time: '2025-02-24 09:15', status: 'pending' },
  { id: '2', type: '週記', analyst: '趙彭博（導師）', title: '第8週實戰週記：AI 族群輪動', time: '2025-02-23 18:00', status: 'pending' },
  { id: '3', type: '訊號', analyst: '趙彭博（投顧）', title: '減碼 2454 聯發科', time: '2025-02-22 13:20', status: 'approved' },
  { id: '4', type: '訊號', analyst: '趙彭博（投顧）', title: '賣出 2603 長榮', time: '2025-02-21 10:05', status: 'rejected' },
];

const CompanyReview = () => {
  return (
    <CompanyLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">內容審核</h1>
          <p className="text-muted-foreground text-sm mt-1">審核分析師發布的訊號與內容</p>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <Clock className="h-5 w-5 text-yellow-500" />
              <div>
                <div className="text-2xl font-bold">{pendingItems.filter(i => i.status === 'pending').length}</div>
                <div className="text-xs text-muted-foreground">待審核</div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <CheckCircle className="h-5 w-5 text-green-500" />
              <div>
                <div className="text-2xl font-bold">{pendingItems.filter(i => i.status === 'approved').length}</div>
                <div className="text-xs text-muted-foreground">已通過</div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <XCircle className="h-5 w-5 text-red-500" />
              <div>
                <div className="text-2xl font-bold">{pendingItems.filter(i => i.status === 'rejected').length}</div>
                <div className="text-xs text-muted-foreground">已退回</div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">審核列表</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {pendingItems.map((item) => (
                <div key={item.id} className="flex items-center justify-between py-3 border-b last:border-0">
                  <div className="flex items-center gap-3">
                    <Badge variant={item.type === '訊號' ? 'default' : 'secondary'} className="text-xs w-12 justify-center">
                      {item.type}
                    </Badge>
                    <div>
                      <p className="font-medium text-sm">{item.title}</p>
                      <p className="text-xs text-muted-foreground">{item.analyst} · {item.time}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {item.status === 'pending' ? (
                      <>
                        <Button size="sm" variant="outline" className="text-green-600 border-green-200 hover:bg-green-50 h-7 text-xs">
                          <CheckCircle className="h-3 w-3 mr-1" />通過
                        </Button>
                        <Button size="sm" variant="outline" className="text-red-600 border-red-200 hover:bg-red-50 h-7 text-xs">
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
            </div>
          </CardContent>
        </Card>
      </div>
    </CompanyLayout>
  );
};

export default CompanyReview;
