import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { AdminLayout } from '@/components/layouts/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { getPersonBySlug } from '@/data/mockData';
import { PersonRole } from '@/types';
import { cn } from '@/lib/utils';
import { Plus, Search, Filter, Edit2, Trash2, Eye } from 'lucide-react';
import { format } from 'date-fns';

const AdminSignals = () => {
  const { expertSlug } = useParams<{ expertSlug: string }>();
  const expert = expertSlug ? getPersonBySlug(expertSlug) : undefined;
  const [searchQuery, setSearchQuery] = useState('');
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  if (!expert) return <AdminLayout><div /></AdminLayout>;

  const isAdvisor = expert.role === PersonRole.ADVISOR;

  // Mock signals data
  const mockSignals = [
    { id: '1', instrument: '2330 台積電', action: 'BUY', price: '890', reason: '突破前高，量能放大，符合4有指標', time: '2025-02-20 09:15', status: 'published' },
    { id: '2', instrument: '2454 聯發科', action: 'SELL', price: '1250', reason: '跌破20MA支撐，量縮價跌', time: '2025-02-19 13:20', status: 'published' },
    { id: '3', instrument: '3661 世芯-KY', action: 'ADD', price: '2100', reason: '突破盤整區，主力連續買超3天', time: '2025-02-18 10:05', status: 'published' },
    { id: '4', instrument: '2603 長榮', action: 'TRIM', price: '178', reason: '航運類股轉弱，先減碼保利潤', time: '2025-02-17 11:30', status: 'published' },
    { id: '5', instrument: '6505 台塑化', action: 'EXIT', price: '68.5', reason: '跌破停損點，無條件出場', time: '2025-02-16 10:45', status: 'published' },
    { id: '6', instrument: '2881 富邦金', action: 'BUY', price: '82', reason: '金融股回測支撐完成，有大人買訊號', time: '2025-02-15 09:30', status: 'draft' },
  ];

  const actionLabels: Record<string, { label: string; variant: 'default' | 'destructive' | 'secondary' | 'outline' }> = {
    BUY: { label: '買進', variant: 'default' },
    SELL: { label: '賣出', variant: 'destructive' },
    ADD: { label: '加碼', variant: 'secondary' },
    TRIM: { label: '減碼', variant: 'outline' },
    EXIT: { label: '出場', variant: 'destructive' },
  };

  const filteredSignals = mockSignals.filter(s => 
    s.instrument.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.reason.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <AdminLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">訊號管理</h1>
            <p className="text-muted-foreground text-sm mt-1">
              管理您發布的交易訊號
            </p>
          </div>
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button className={cn(isAdvisor ? "bg-advisor hover:bg-advisor/90" : "bg-mentor hover:bg-mentor/90")}>
                <Plus className="h-4 w-4 mr-2" />
                發布新訊號
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>發布新訊號</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 mt-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>股票代碼</Label>
                    <Input placeholder="例：2330" />
                  </div>
                  <div className="space-y-2">
                    <Label>股票名稱</Label>
                    <Input placeholder="例：台積電" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>操作方向</Label>
                    <Select>
                      <SelectTrigger><SelectValue placeholder="選擇" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="BUY">買進</SelectItem>
                        <SelectItem value="SELL">賣出</SelectItem>
                        <SelectItem value="ADD">加碼</SelectItem>
                        <SelectItem value="TRIM">減碼</SelectItem>
                        <SelectItem value="EXIT">出場</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>參考價位</Label>
                    <Input placeholder="例：890" type="number" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>操作理由（摘要）</Label>
                  <Textarea placeholder="簡述操作原因..." rows={2} />
                </div>
                <div className="space-y-2">
                  <Label>詳細分析</Label>
                  <Textarea placeholder="詳細的技術面/基本面分析..." rows={4} />
                </div>
                <div className="space-y-2">
                  <Label>風險提示</Label>
                  <Textarea placeholder="停損點、注意事項..." rows={2} />
                </div>
                <div className="flex justify-end gap-3 pt-2">
                  <Button variant="outline" onClick={() => setIsCreateOpen(false)}>存為草稿</Button>
                  <Button className={cn(isAdvisor ? "bg-advisor hover:bg-advisor/90" : "bg-mentor hover:bg-mentor/90")}>
                    立即發布
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Search & Filter */}
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="搜尋股票代碼或理由..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <Button variant="outline" size="icon">
            <Filter className="h-4 w-4" />
          </Button>
        </div>

        {/* Signals Table */}
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground">時間</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground">標的</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground">方向</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground">價位</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground">理由</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground">狀態</th>
                    <th className="text-right p-3 text-xs font-medium text-muted-foreground">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSignals.map((signal) => {
                    const actionInfo = actionLabels[signal.action];
                    return (
                      <tr key={signal.id} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="p-3 text-sm text-muted-foreground whitespace-nowrap">{signal.time}</td>
                        <td className="p-3 text-sm font-medium">{signal.instrument}</td>
                        <td className="p-3">
                          <Badge variant={actionInfo.variant} className="text-xs">
                            {actionInfo.label}
                          </Badge>
                        </td>
                        <td className="p-3 text-sm">{signal.price}</td>
                        <td className="p-3 text-sm text-muted-foreground max-w-[200px] truncate">{signal.reason}</td>
                        <td className="p-3">
                          <Badge variant={signal.status === 'published' ? 'secondary' : 'outline'} className="text-xs">
                            {signal.status === 'published' ? '已發布' : '草稿'}
                          </Badge>
                        </td>
                        <td className="p-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <Edit2 className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive">
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
};

export default AdminSignals;
