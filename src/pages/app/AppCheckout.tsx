import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { UnifiedAppLayout } from "@/components/layouts/UnifiedAppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { ArrowLeft, Check, Shield, Lock } from "lucide-react";
import { getPersonBySlug, plans } from "@/data/mockData";
import { useToast } from "@/hooks/use-toast";

const AppCheckout = () => {
  const { slug, planId } = useParams<{ slug: string; planId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const [billingCycle, setBillingCycle] = useState<"monthly" | "yearly">("monthly");
  const [isProcessing, setIsProcessing] = useState(false);

  const expert = getPersonBySlug(slug || "");
  const plan = plans.find(p => p.id === planId);

  if (!expert || !plan) {
    return (
      <UnifiedAppLayout>
        <div className="flex flex-col items-center justify-center py-16">
          <p className="text-muted-foreground">找不到此方案</p>
          <Button variant="ghost" onClick={() => navigate("/app/explore")} className="mt-4">
            返回探索
          </Button>
        </div>
      </UnifiedAppLayout>
    );
  }

  const monthlyPrice = plan.priceMonthly;
  const yearlyPrice = plan.priceYearly;
  const yearlyDiscount = Math.round((1 - yearlyPrice / (monthlyPrice * 12)) * 100);

  const currentPrice = billingCycle === "monthly" ? monthlyPrice : yearlyPrice;
  const billingLabel = billingCycle === "monthly" ? "/月" : "/年";

  const handleCheckout = async () => {
    setIsProcessing(true);
    
    // Simulate payment processing
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    toast({
      title: "訂閱成功！",
      description: `已成功訂閱 ${expert.name} 的 ${plan.name}`,
    });
    
    // Navigate to account page so user can proceed with LINE binding
    navigate('/app/account');
  };

  return (
    <UnifiedAppLayout>
      <div className="p-4 space-y-6 pb-24">
        {/* Back button */}
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={() => navigate(`/app/expert/${expert.slug}`)}
          className="gap-2 -ml-2"
        >
          <ArrowLeft className="h-4 w-4" />
          返回方案
        </Button>

        {/* Header */}
        <div className="text-center">
          <h1 className="text-xl font-bold">確認訂閱</h1>
          <p className="text-sm text-muted-foreground mt-1">
            請確認您的訂閱內容
          </p>
        </div>

        {/* Order Summary */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3 mb-4">
              <Avatar className="h-12 w-12">
                <AvatarImage src={expert.avatarUrl} alt={expert.name} />
                <AvatarFallback>{expert.name[0]}</AvatarFallback>
              </Avatar>
              <div>
                <p className="font-semibold">{expert.name}</p>
                <p className="text-sm text-muted-foreground">{plan.name}</p>
              </div>
            </div>

            {/* Plan features */}
            {plan.features && (
              <div className="border-t pt-3 mb-3">
                <p className="text-xs text-muted-foreground mb-2">包含內容：</p>
                <ul className="space-y-1">
                  {plan.features.slice(0, 4).map((feature, idx) => (
                    <li key={idx} className="flex items-center gap-2 text-sm">
                      <Check className="h-3 w-3 text-green-500 shrink-0" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Billing Cycle Selection */}
        <div>
          <h2 className="text-sm font-medium mb-3">選擇付款週期</h2>
          <div className="grid grid-cols-2 gap-3">
            <Card 
              className={`cursor-pointer transition-all ${
                billingCycle === "monthly" 
                  ? "border-primary ring-2 ring-primary/20" 
                  : "hover:border-muted-foreground/30"
              }`}
              onClick={() => setBillingCycle("monthly")}
            >
              <CardContent className="p-4 text-center">
                <div className={`w-4 h-4 rounded-full border-2 mx-auto mb-2 ${
                  billingCycle === "monthly" 
                    ? "border-primary bg-primary" 
                    : "border-muted-foreground/30"
                }`}>
                  {billingCycle === "monthly" && (
                    <Check className="h-3 w-3 text-primary-foreground m-auto" />
                  )}
                </div>
                <p className="font-semibold">月繳</p>
                <p className="text-lg font-bold">
                  NT$ {monthlyPrice.toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground">/月</p>
              </CardContent>
            </Card>

            <Card 
              className={`cursor-pointer transition-all relative ${
                billingCycle === "yearly" 
                  ? "border-primary ring-2 ring-primary/20" 
                  : "hover:border-muted-foreground/30"
              }`}
              onClick={() => setBillingCycle("yearly")}
            >
              {yearlyDiscount > 0 && (
                <Badge className="absolute -top-2 -right-2 text-xs">
                  省 {yearlyDiscount}%
                </Badge>
              )}
              <CardContent className="p-4 text-center">
                <div className={`w-4 h-4 rounded-full border-2 mx-auto mb-2 ${
                  billingCycle === "yearly" 
                    ? "border-primary bg-primary" 
                    : "border-muted-foreground/30"
                }`}>
                  {billingCycle === "yearly" && (
                    <Check className="h-3 w-3 text-primary-foreground m-auto" />
                  )}
                </div>
                <p className="font-semibold">年繳</p>
                <p className="text-lg font-bold">
                  NT$ {yearlyPrice.toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground">/年</p>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Payment Summary */}
        <Card className="bg-muted/50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-4">
              <span className="text-muted-foreground">訂閱方案</span>
              <span>{plan.name}</span>
            </div>
            <div className="flex items-center justify-between mb-4">
              <span className="text-muted-foreground">付款週期</span>
              <span>{billingCycle === "monthly" ? "月繳" : "年繳"}</span>
            </div>
            <div className="border-t pt-4">
              <div className="flex items-center justify-between">
                <span className="font-semibold">總計</span>
                <span className="text-xl font-bold">
                  NT$ {currentPrice.toLocaleString()}{billingLabel}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Checkout Button */}
        <Button 
          className="w-full h-12 text-base"
          onClick={handleCheckout}
          disabled={isProcessing}
        >
          {isProcessing ? (
            <span className="flex items-center gap-2">
              <span className="animate-spin">⏳</span>
              處理中...
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <Lock className="h-4 w-4" />
              確認付款
            </span>
          )}
        </Button>

        {/* Security Notice */}
        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Shield className="h-3 w-3" />
          <span>SSL 加密安全付款</span>
        </div>
      </div>
    </UnifiedAppLayout>
  );
};

export default AppCheckout;
