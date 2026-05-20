import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CreditCard, Loader2, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';


interface PaymentProvider {
  id: string;
  display_name: string;
}

interface OrderSummaryCardProps {
  plan: { name: string };
  providers: PaymentProvider[];
  selectedProvider: string | null;
  billingCycle: 'monthly' | 'yearly';
  basePrice: number;
  price: number;
  crossDiscount: number;
  upgradeCredit: number;
  formatPrice: (p: number) => string;
  user: { id: string } | null;
  isAdvisor: boolean;
  isSandbox?: boolean;
  isProcessing: boolean;
  alreadySubscribed: boolean;
  onCheckout: () => void;
}

export function OrderSummaryCard({
  plan,
  providers,
  selectedProvider,
  billingCycle,
  basePrice,
  price,
  crossDiscount,
  upgradeCredit,
  formatPrice,
  user,
  isAdvisor,
  isSandbox = false,
  isProcessing,
  alreadySubscribed,
  onCheckout,
}: OrderSummaryCardProps) {
  return (
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
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">付款方式</span>
          <span>{providers.find(p => p.id === selectedProvider)?.display_name || '-'}</span>
        </div>
        <div className="border-t pt-4 space-y-2">
          {(crossDiscount > 0 || upgradeCredit > 0) && (
            <>
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>原價</span>
                <span>NT$ {formatPrice(basePrice)}</span>
              </div>
              {crossDiscount > 0 && (
                <div className="flex justify-between text-sm text-primary">
                  <span>跨產品折扣</span>
                  <span>- NT$ {formatPrice(crossDiscount)}</span>
                </div>
              )}
              {upgradeCredit > 0 && (
                <div className="flex justify-between text-sm text-primary">
                  <span>月升年抵扣</span>
                  <span>- NT$ {formatPrice(upgradeCredit)}</span>
                </div>
              )}
            </>
          )}
          <div className="flex justify-between font-semibold">
            <span>總計</span>
            <span>NT$ {formatPrice(price)}</span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            單次扣款，效期 {billingCycle === 'monthly' ? '1 個月' : '1 年'}，到期需手動續訂
          </p>
        </div>

        <Badge variant="outline" className="w-full justify-center py-1">
          🧪 沙盒測試模式 — 不會實際扣款
        </Badge>

        {user ? (
          <Button
            className={cn("w-full", !isAdvisor && "bg-mentor hover:bg-mentor-dark")}
            size="lg"
            onClick={onCheckout}
            disabled={isProcessing || alreadySubscribed || !selectedProvider}
          >
            {isProcessing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                處理中...
              </>
            ) : (
              <>
                <CreditCard className="h-4 w-4 mr-2" />
                確認付款（沙盒）
              </>
            )}
          </Button>
        ) : (
          <Button className={cn("w-full", !isAdvisor && "bg-mentor hover:bg-mentor/90 text-white")} size="lg" asChild>
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
  );
}
