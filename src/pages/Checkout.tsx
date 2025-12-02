import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { PortalLayout } from '@/components/layouts/PortalLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { RoleBadge } from '@/components/RoleBadge';
import { getPlanById, people, tradingSystems } from '@/data/mockData';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { PersonRole, PlanType } from '@/types';
import { CheckCircle, Loader2, CreditCard, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';

const Checkout = () => {
  const { planId } = useParams<{ planId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [isProcessing, setIsProcessing] = useState(false);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');

  const plan = planId ? getPlanById(planId) : undefined;
  const person = plan ? people.find(p => p.id === plan.personId) : undefined;
  const system = plan?.systemId ? tradingSystems.find(s => s.id === plan.systemId) : undefined;

  if (!plan || !person) {
    return (
      <PortalLayout>
        <div className="container py-12 text-center">
          <h1 className="text-2xl font-bold mb-4">找不到此方案</h1>
          <Button asChild>
            <Link to="/pricing">返回方案頁</Link>
          </Button>
        </div>
      </PortalLayout>
    );
  }

  const isAdvisor = person.role === PersonRole.ADVISOR;
  const price = billingCycle === 'monthly' ? plan.priceMonthly : plan.priceYearly;

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('zh-TW').format(price);
  };

  const getPlanFeatures = (planType: PlanType) => {
    switch (planType) {
      case PlanType.ANALYST_SIGNAL_L1:
        return ['即時策略訊號推播', '每筆操作教學說明', '風險與部位控管解說'];
      case PlanType.ANALYST_SIGNAL_DIAG_L2:
        return ['即時策略訊號推播', '每筆操作教學說明', '風險與部位控管解說', '持股健檢報告'];
      case PlanType.MENTOR_WEEKLY_JOURNAL:
        return ['每週實戰週記', '完整操作邏輯拆解', '事後檢討與學習重點'];
    }
  };

  const handleCheckout = async () => {
    if (!user) {
      navigate('/auth/login');
      return;
    }

    setIsProcessing(true);

    // Simulate payment processing
    await new Promise(resolve => setTimeout(resolve, 1500));

    toast({
      title: '訂閱成功！',
      description: '可在「我的服務」中查看您的訂閱。',
    });

    setIsProcessing(false);
    navigate('/app');
  };

  return (
    <PortalLayout>
      <div className="container py-8 md:py-12">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-2xl md:text-3xl font-bold mb-8 text-center">確認訂閱</h1>

          <div className="grid md:grid-cols-5 gap-8">
            {/* Order Summary */}
            <div className="md:col-span-3 space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">訂閱內容</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Person Info */}
                  <div className="flex items-center gap-4">
                    <img
                      src={person.avatarUrl || '/placeholder.svg'}
                      alt={person.name}
                      className="h-14 w-14 rounded-xl object-cover"
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{person.name}</span>
                        <RoleBadge role={person.role} size="sm" />
                      </div>
                      <p className="text-sm text-muted-foreground">{person.bio}</p>
                    </div>
                  </div>

                  {/* Plan Info */}
                  <div className={cn(
                    "p-4 rounded-lg border-2",
                    isAdvisor ? "border-advisor/20 bg-advisor-light/30" : "border-mentor/20 bg-mentor-light/30"
                  )}>
                    <h3 className="font-semibold mb-2">{plan.name}</h3>
                    <p className="text-sm text-muted-foreground mb-4">{plan.description}</p>
                    <ul className="space-y-2">
                      {getPlanFeatures(plan.planType).map((feature, idx) => (
                        <li key={idx} className="flex items-center gap-2 text-sm">
                          <CheckCircle className={cn(
                            "h-4 w-4",
                            isAdvisor ? "text-advisor" : "text-mentor"
                          )} />
                          {feature}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Trading System */}
                  {system && (
                    <div className="p-3 rounded-lg bg-muted/50">
                      <p className="text-sm font-medium mb-1">包含交易系統教學</p>
                      <p className="text-sm text-muted-foreground">{system.name}</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Billing Cycle */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">選擇付款週期</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4">
                    <button
                      onClick={() => setBillingCycle('monthly')}
                      className={cn(
                        "p-4 rounded-lg border-2 text-left transition-colors",
                        billingCycle === 'monthly' 
                          ? "border-primary bg-primary/5" 
                          : "border-border hover:border-primary/50"
                      )}
                    >
                      <p className="font-semibold">月繳</p>
                      <p className="text-2xl font-bold mt-1">
                        NT$ {formatPrice(plan.priceMonthly)}
                      </p>
                      <p className="text-sm text-muted-foreground">每月</p>
                    </button>
                    <button
                      onClick={() => setBillingCycle('yearly')}
                      className={cn(
                        "p-4 rounded-lg border-2 text-left transition-colors relative",
                        billingCycle === 'yearly' 
                          ? "border-primary bg-primary/5" 
                          : "border-border hover:border-primary/50"
                      )}
                    >
                      <Badge className="absolute -top-2 right-2">
                        省 {Math.round((1 - plan.priceYearly / (plan.priceMonthly * 12)) * 100)}%
                      </Badge>
                      <p className="font-semibold">年繳</p>
                      <p className="text-2xl font-bold mt-1">
                        NT$ {formatPrice(plan.priceYearly)}
                      </p>
                      <p className="text-sm text-muted-foreground">每年</p>
                    </button>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Payment */}
            <div className="md:col-span-2">
              <Card className="sticky top-24">
                <CardHeader>
                  <CardTitle className="text-lg">付款摘要</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">方案</span>
                    <span>{plan.name}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">週期</span>
                    <span>{billingCycle === 'monthly' ? '月繳' : '年繳'}</span>
                  </div>
                  <div className="border-t pt-4">
                    <div className="flex justify-between font-semibold">
                      <span>總計</span>
                      <span>NT$ {formatPrice(price)}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {billingCycle === 'monthly' ? '每月自動續訂' : '每年自動續訂'}
                    </p>
                  </div>

                  {user ? (
                    <Button 
                      className="w-full" 
                      size="lg"
                      onClick={handleCheckout}
                      disabled={isProcessing}
                    >
                      {isProcessing ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          處理中...
                        </>
                      ) : (
                        <>
                          <CreditCard className="h-4 w-4 mr-2" />
                          確認付款
                        </>
                      )}
                    </Button>
                  ) : (
                    <Button className="w-full" size="lg" asChild>
                      <Link to="/auth/login">登入後付款</Link>
                    </Button>
                  )}

                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Shield className="h-3.5 w-3.5" />
                    <span>SSL 加密安全付款</span>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    點擊「確認付款」即表示您同意我們的{' '}
                    <Link to="/legal" className="underline">服務條款</Link>。
                    訂閱可隨時取消。
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </PortalLayout>
  );
};

export default Checkout;
