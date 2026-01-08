import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { LineLayout } from '@/components/layouts/LineLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { getPersonBySlug, getUserSubscriptions } from '@/data/mockData';
import { useAuth } from '@/contexts/AuthContext';
import { PersonRole, PlanType } from '@/types';
import { FileCheck, AlertTriangle, Plus, Trash2, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';

interface HoldingInput {
  id: string;
  symbol: string;
  cost: string;
  shares: string;
}

const LineDiagnosis = () => {
  const { expertSlug } = useParams<{ expertSlug: string }>();
  const { user } = useAuth();
  const expert = expertSlug ? getPersonBySlug(expertSlug) : undefined;
  const [holdings, setHoldings] = useState<HoldingInput[]>([
    { id: '1', symbol: '', cost: '', shares: '' }
  ]);
  const [submitted, setSubmitted] = useState(false);

  if (!expert) {
    return null;
  }

  const isAdvisor = expert.role === PersonRole.ADVISOR;

  // Check if user has L2 subscription
  const subscriptions = user ? getUserSubscriptions(user.id) : [];
  const expertSub = subscriptions.find(s => s.person.slug === expertSlug);
  const hasL2Access = expertSub?.plan.planType === PlanType.ANALYST_SIGNAL_DIAG_L2;

  // Non-advisor experts don't have diagnosis
  if (!isAdvisor) {
    return (
      <LineLayout>
        <div className="p-4 text-center py-12">
          <Lock className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-xl font-bold mb-2">此功能不適用</h2>
          <p className="text-muted-foreground mb-4">
            持股診斷功能僅適用於投顧分析師的等級 2 方案
          </p>
          <Button asChild>
            <Link to={`/line/${expertSlug}/home`}>返回首頁</Link>
          </Button>
        </div>
      </LineLayout>
    );
  }

  // No L2 access
  if (!hasL2Access) {
    return (
      <LineLayout>
        <div className="p-4 text-center py-12">
          <Lock className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-xl font-bold mb-2">需要等級 2 方案</h2>
          <p className="text-muted-foreground mb-4">
            持股診斷功能僅限「投顧策略訂閱 等級 2」會員使用
          </p>
          <Button variant="advisor" asChild>
            <Link to={`/line/${expertSlug}/account`}>升級方案</Link>
          </Button>
        </div>
      </LineLayout>
    );
  }

  const addHolding = () => {
    setHoldings([...holdings, { id: Date.now().toString(), symbol: '', cost: '', shares: '' }]);
  };

  const removeHolding = (id: string) => {
    if (holdings.length > 1) {
      setHoldings(holdings.filter(h => h.id !== id));
    }
  };

  const updateHolding = (id: string, field: keyof HoldingInput, value: string) => {
    setHoldings(holdings.map(h => h.id === id ? { ...h, [field]: value } : h));
  };

  const handleSubmit = () => {
    // Mock submission
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <LineLayout>
        <div className="p-4 space-y-4">
          {/* Header */}
          <div className="mb-4">
            <Badge variant="advisor" className="mb-2">診斷報告</Badge>
            <h1 className="text-xl font-bold">持股健檢結果</h1>
          </div>

          {/* Summary */}
          <Card className="border-advisor/30">
            <CardContent className="p-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="h-12 w-12 rounded-full bg-warning/10 flex items-center justify-center">
                  <AlertTriangle className="h-6 w-6 text-warning" />
                </div>
                <div>
                  <p className="font-semibold">整體風險等級</p>
                  <p className="text-warning font-bold">中等偏高</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Analysis */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">診斷摘要</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm font-medium text-success mb-2">✓ 與策略吻合的持股</p>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">2330 台積電</Badge>
                  <Badge variant="secondary">2454 聯發科</Badge>
                </div>
              </div>
              <div>
                <p className="text-sm font-medium text-warning mb-2">⚠ 需要注意的持股</p>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary" className="bg-warning/10">2317 鴻海</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  持股比例偏高，建議降低曝險
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Risk Assessment */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">風險評估</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm">產業集中度</span>
                  <Badge className="bg-warning/10 text-warning">偏高</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">單一標的比重</span>
                  <Badge className="bg-success/10 text-success">正常</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">整體波動度</span>
                  <Badge className="bg-warning/10 text-warning">中等</Badge>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Suggestions */}
          <Card className="bg-advisor/5">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">建議事項</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm">
                <li className="flex items-start gap-2">
                  <span className="text-advisor">1.</span>
                  <span>建議降低電子股曝險，目前佔比約 78%</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-advisor">2.</span>
                  <span>可考慮增加防禦性部位，如金融或傳產</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-advisor">3.</span>
                  <span>鴻海目前佔比 15%，建議控制在 10% 以內</span>
                </li>
              </ul>
            </CardContent>
          </Card>

          <Button variant="outline" className="w-full" onClick={() => setSubmitted(false)}>
            重新診斷
          </Button>

          {/* Compliance */}
          <div className="compliance-disclaimer">
            本診斷報告為投顧服務的一部分，提供之建議僅供參考，不保證獲利。
            投資一定有風險，請謹慎評估。
          </div>
        </div>
      </LineLayout>
    );
  }

  return (
    <LineLayout>
      <div className="p-4 space-y-4">
        {/* Header */}
        <div className="mb-4">
          <Badge variant="advisor" className="mb-2">等級 2 專屬</Badge>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <FileCheck className="h-5 w-5" />
            持股健檢
          </h1>
          <p className="text-sm text-muted-foreground">
            上傳你的持股，獲得個人化診斷報告
          </p>
        </div>

        {/* Holdings Form */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">輸入持股</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {holdings.map((holding, idx) => (
              <div key={holding.id} className="p-3 bg-muted/30 rounded-lg space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">持股 {idx + 1}</span>
                  {holdings.length > 1 && (
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={() => removeHolding(holding.id)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <Label className="text-xs">股票代號</Label>
                    <Input 
                      placeholder="2330"
                      value={holding.symbol}
                      onChange={(e) => updateHolding(holding.id, 'symbol', e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">成本價</Label>
                    <Input 
                      placeholder="580"
                      value={holding.cost}
                      onChange={(e) => updateHolding(holding.id, 'cost', e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">張數</Label>
                    <Input 
                      placeholder="5"
                      value={holding.shares}
                      onChange={(e) => updateHolding(holding.id, 'shares', e.target.value)}
                    />
                  </div>
                </div>
              </div>
            ))}
            
            <Button variant="outline" className="w-full" onClick={addHolding}>
              <Plus className="h-4 w-4 mr-1" />
              新增持股
            </Button>
          </CardContent>
        </Card>

        {/* Submit */}
        <Button variant="advisor" className="w-full" onClick={handleSubmit}>
          提交診斷
        </Button>

        {/* Note */}
        <div className="text-xs text-muted-foreground text-center">
          診斷結果通常在提交後 1-2 個工作天內產出
        </div>

        {/* Compliance */}
        <div className="compliance-disclaimer">
          持股診斷為投顧服務的一部分，診斷結果僅供參考，不構成買賣建議。
        </div>
      </div>
    </LineLayout>
  );
};

export default LineDiagnosis;