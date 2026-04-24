import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, Link, useSearchParams } from 'react-router-dom';
import { PortalLayout } from '@/components/layouts/PortalLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/AuthContext';

import { supabase } from '@/integrations/supabase/client';
import { CheckCircle, Loader2, CreditCard, Shield, ArrowLeft, Check, XCircle } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

interface DbPlan {
  id: string;
  name: string;
  plan_type: string;
  price_monthly: number;
  price_yearly: number | null;
  description: string | null;
  features: any;
  expert_id: string;
}

interface DbExpert {
  id: string;
  name: string;
  slug: string;
  avatar_url: string | null;
  role: string;
}

interface PaymentProvider {
  id: string;
  display_name: string;
  provider_type: string;
  is_active: boolean;
  is_default: boolean;
}

const Checkout = () => {
  const { slug, planId } = useParams<{ slug: string; planId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  
  const fromAccount = searchParams.get('from') === 'account';

  const [plan, setPlan] = useState<DbPlan | null>(null);
  const [expert, setExpert] = useState<DbExpert | null>(null);
  const [providers, setProviders] = useState<PaymentProvider[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [loading, setLoading] = useState(true);
  const [alreadySubscribed, setAlreadySubscribed] = useState(false);
  const [resultDialog, setResultDialog] = useState<{ open: boolean; success: boolean; message?: string } | null>(null);
  const [consentOpen, setConsentOpen] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);

  // ACpay cardholder form fields
  const [cardHolderName, setCardHolderName] = useState('');
  const [cardHolderEmail, setCardHolderEmail] = useState('');
  const [cardHolderPhone, setCardHolderPhone] = useState('');
  const [countryCode, setCountryCode] = useState('886');
  const [cardFieldErrors, setCardFieldErrors] = useState<{ name?: string; email?: string; phone?: string }>({});

  // ACpay SDK refs
  const acpayCardRef = useRef<HTMLDivElement>(null);
  const acpaySdkLoaded = useRef(false);
  const acpayFieldsRef = useRef<any>(null);

  // Determine if selected provider is ACpay
  const selectedProviderObj = providers.find(p => p.id === selectedProvider);
  const isAcpay = selectedProviderObj?.provider_type === 'acpay';

  // Load ACpay JS SDK when acpay provider is selected
  useEffect(() => {
    if (!isAcpay || acpaySdkLoaded.current) return;

    const sdkUrl = 'https://js.payloop.com.tw/sdk/v1.0/acpay.js';
    const existingScript = document.querySelector(`script[src="${sdkUrl}"]`);
    if (existingScript) {
      acpaySdkLoaded.current = true;
      initACpayFields();
      return;
    }

    const script = document.createElement('script');
    script.src = sdkUrl;
    script.async = true;
    script.onload = () => {
      acpaySdkLoaded.current = true;
      initACpayFields();
    };
    script.onerror = () => {
      console.error('Failed to load ACpay SDK');
    };
    document.head.appendChild(script);
  }, [isAcpay]);

  const initACpayFields = useCallback(() => {
    if (!acpayCardRef.current || !(window as any).ACPay) return;

    try {
      const ACPay = (window as any).ACPay;
      const fields = ACPay.setupSDK({
        fields: {
          number: { element: '#portal-acpay-card-number', placeholder: '卡號' },
          expirationDate: { element: '#portal-acpay-expiry', placeholder: 'MM/YY' },
          ccv: { element: '#portal-acpay-ccv', placeholder: '安全碼' },
        },
      });
      acpayFieldsRef.current = fields;
    } catch (e) {
      console.error('ACpay SDK init error:', e);
    }
  }, []);

  // Handle ACpay 3DS return
  useEffect(() => {
    const acpayResult = searchParams.get('acpay');
    if (acpayResult !== 'result' || !user || !planId || resultDialog) return;

    setIsConfirming(true);

    const checkAndListen = async () => {
      const { data: existing } = await supabase
        .from('member_subscriptions')
        .select('id')
        .eq('user_id', user.id)
        .eq('plan_id', planId)
        .eq('status', 'active');

      if (existing && existing.length > 0) {
        setIsConfirming(false);
        setResultDialog({ open: true, success: true });
        return;
      }

      let resolved = false;
      const channel = supabase
        .channel('acpay-portal-confirm')
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'member_subscriptions',
          filter: `user_id=eq.${user.id}`,
        }, (payload) => {
          const row = payload.new as any;
          if (row.plan_id === planId && row.status === 'active' && !resolved) {
            resolved = true;
            clearInterval(pollTimer);
            setIsConfirming(false);
            setResultDialog({ open: true, success: true });
          }
        })
        .subscribe();

      const pollTimer = setInterval(async () => {
        if (resolved) { clearInterval(pollTimer); return; }
        const { data: polled } = await supabase
          .from('member_subscriptions')
          .select('id')
          .eq('user_id', user.id)
          .eq('plan_id', planId)
          .eq('status', 'active');
        if (polled && polled.length > 0 && !resolved) {
          resolved = true;
          clearInterval(pollTimer);
          supabase.removeChannel(channel);
          setIsConfirming(false);
          setResultDialog({ open: true, success: true });
        }
      }, 5000);

      setTimeout(() => {
        clearInterval(pollTimer);
        supabase.removeChannel(channel);
        if (!resolved) {
          setIsConfirming(false);
          setResultDialog({ open: true, success: false, message: '付款確認逾時，如已扣款請聯繫客服' });
        }
      }, 60000);
    };

    checkAndListen();
  }, [searchParams, user, planId]);

  // Handle LINE Pay return
  useEffect(() => {
    const linepay = searchParams.get('linepay');
    const transactionId = searchParams.get('transactionId');
    const txOrderId = searchParams.get('orderId');

    if (linepay === 'confirm' && transactionId && !isConfirming && !resultDialog && plan) {
      const confirmPayment = async () => {
        setIsConfirming(true);
        try {
          const returnedBillingCycle = searchParams.get('billingCycle') || billingCycle;
          
          const currentPrice = returnedBillingCycle === 'yearly'
            ? (plan.price_yearly || plan.price_monthly * 12)
            : plan.price_monthly;

          const isSimulate = searchParams.get('simulate') === 'true';
          const { data, error } = await supabase.functions.invoke('confirm-linepay', {
            body: {
              transactionId,
              orderId: txOrderId || '',
              amount: currentPrice,
              planId,
              billingCycle: returnedBillingCycle,
              userId: user?.id || null,
              simulate: isSimulate,
            },
          });

          if (error || !data?.success) {
            console.error('LINE Pay confirm error:', error || data);
            setResultDialog({ open: true, success: false, message: '付款確認失敗' });
          } else {
            setResultDialog({ open: true, success: true });
          }
        } catch (err) {
          console.error('LINE Pay confirm exception:', err);
          setResultDialog({ open: true, success: false, message: '付款確認時發生錯誤' });
        } finally {
          setIsConfirming(false);
        }
      };
      confirmPayment();
    } else if (linepay === 'cancel') {
      setResultDialog({ open: true, success: false, message: '您已取消付款' });
    }
  }, [searchParams, plan, user]);

  // Handle ECPay return — use Realtime to detect subscription created by server callback
  useEffect(() => {
    const ecpayResult = searchParams.get('ecpay');
    if (ecpayResult !== 'result' || !user || !planId || resultDialog) return;

    setIsConfirming(true);

    // First, check if subscription already exists (callback may have already fired)
    const checkExisting = async () => {
      const { data: subs } = await supabase
        .from('member_subscriptions')
        .select('id')
        .eq('user_id', user.id)
        .eq('plan_id', planId)
        .eq('status', 'active');
      if (subs && subs.length > 0) {
        setIsConfirming(false);
        setResultDialog({ open: true, success: true });
        return true;
      }
      return false;
    };

    let channel: ReturnType<typeof supabase.channel> | null = null;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    checkExisting().then(found => {
      if (found) return;

      // Listen for realtime INSERT on member_subscriptions for this user+plan
      channel = supabase
        .channel('ecpay-sub-confirm')
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'member_subscriptions',
            filter: `user_id=eq.${user.id}`,
          },
          (payload) => {
            const row = payload.new as any;
            if (row.plan_id === planId && row.status === 'active') {
              setIsConfirming(false);
              setResultDialog({ open: true, success: true });
            }
          }
        )
        .subscribe();

      // Timeout after 60 seconds
      timeout = setTimeout(() => {
        setIsConfirming(false);
        setResultDialog({ open: true, success: false, message: '付款確認逾時，如已扣款請聯繫客服' });
      }, 60000);
    });

    return () => {
      if (channel) supabase.removeChannel(channel);
      if (timeout) clearTimeout(timeout);
    };
  }, [searchParams, user, planId]);

  useEffect(() => {
    const fetchData = async () => {
      if (!planId || !slug) return;

      // Fetch plan
      const { data: planData } = await supabase
        .from('expert_plans')
        .select('id, name, plan_type, price_monthly, price_yearly, description, features, expert_id')
        .eq('id', planId)
        .single();

      if (!planData) {
        setLoading(false);
        return;
      }
      setPlan(planData);

      // Fetch expert
      const { data: expertData } = await supabase
        .from('experts')
        .select('id, name, slug, avatar_url, role')
        .eq('id', planData.expert_id)
        .single();

      setExpert(expertData);

      // Fetch active payment providers
      const { data: providerData } = await supabase
        .from('payment_providers_safe')
        .select('id, display_name, provider_type, is_active, is_default')
        .eq('is_active', true)
        .order('is_default', { ascending: false });

      if (providerData && providerData.length > 0) {
        setProviders(providerData);
        setSelectedProvider(providerData[0].id);
      }

      // Check if already subscribed
      if (user) {
        const { data: subs } = await supabase
          .from('member_subscriptions')
          .select('id')
          .eq('user_id', user.id)
          .eq('plan_id', planId)
          .eq('status', 'active');

        if (subs && subs.length > 0) {
          setAlreadySubscribed(true);
        }
      }

      setLoading(false);
    };

    fetchData();
  }, [planId, slug, user]);

  if (loading) {
    return (
       <PortalLayout hideAppEntry hideHeader>
        <div className="flex justify-center items-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </PortalLayout>
    );
  }

  if (!plan || !expert) {
    return (
       <PortalLayout hideAppEntry hideHeader>
        <div className="container py-12 text-center">
          <h1 className="text-2xl font-bold mb-4">找不到此方案</h1>
          <Button asChild>
            <Link to="/experts">返回專家列表</Link>
          </Button>
        </div>
      </PortalLayout>
    );
  }

  const isAdvisor = plan.plan_type !== 'mentor_weekly_journal';
  const price = billingCycle === 'monthly' ? plan.price_monthly : (plan.price_yearly || plan.price_monthly * 12);

  const formatPrice = (p: number) => new Intl.NumberFormat('zh-TW').format(p);

  const getPlanFeatures = (planType: string): string[] => {
    switch (planType) {
      case 'analyst_signal_l1':
        return ['即時策略訊號推播', '每筆操作教學說明', '風險與部位控管解說'];
      case 'analyst_signal_diag_l2':
        return ['即時策略訊號推播', '每筆操作教學說明', '風險與部位控管解說', '持股健檢報告'];
      case 'mentor_weekly_journal':
        return ['每週修煉派週記', '完整操作邏輯拆解', '事後檢討與學習重點'];
      default:
        return [];
    }
  };

  const getProviderIcon = (providerType: string) => {
    switch (providerType) {
      case 'acpay': return '💳';
      case 'ecpay': return '🏦';
      case 'line_pay': return '💚';
      case 'newebpay': return '🔵';
      default: return '💳';
    }
  };

  const handleCheckout = async () => {
    if (!user) {
      navigate('/auth/login');
      return;
    }

    if (!selectedProvider) {
      setResultDialog({ open: true, success: false, message: '請選擇付款方式' });
      return;
    }

    // Show consent dialog for all plan types
    setConsentChecked(false);
    setConsentOpen(true);
    return;
  };

  const proceedCheckout = async () => {
    setIsProcessing(true);

    try {
      // Check if selected provider is LINE Pay
      const provider = providers.find(p => p.id === selectedProvider);
      
      if (provider?.provider_type === 'line_pay') {
        // Call create-linepay-order edge function
        const { data, error } = await supabase.functions.invoke('create-linepay-order', {
          body: {
            planId: plan.id,
            billingCycle,
            slug,
            amount: price,
            planName: plan.name,
            expertName: expert.name,
            origin: window.location.origin,
          },
        });

        if (error || !data?.paymentUrl) {
          console.error('Create LINE Pay order error:', error || data);
          setResultDialog({ open: true, success: false, message: '建立 LINE Pay 訂單失敗，請稍後再試' });
          return;
        }

        // Redirect to LINE Pay
        window.location.href = data.paymentUrl;
        return;
      }

      if (provider?.provider_type === 'ecpay') {
        // Call create-ecpay-order edge function
        const { data, error } = await supabase.functions.invoke('create-ecpay-order', {
          body: {
            planId: plan.id,
            billingCycle,
            slug,
            amount: price,
            planName: plan.name,
            expertName: expert.name,
            origin: window.location.origin,
            userId: user.id,
          },
        });

        if (error || !data?.actionUrl || !data?.params) {
          console.error('Create ECPay order error:', error || data);
          setResultDialog({ open: true, success: false, message: '建立綠界訂單失敗，請稍後再試' });
          return;
        }

        // Create and submit a hidden form to ECPay in a new window
        const form = document.createElement('form');
        form.method = 'POST';
        form.action = data.actionUrl;
        form.style.display = 'none';

        for (const [key, value] of Object.entries(data.params)) {
          const input = document.createElement('input');
          input.type = 'hidden';
          input.name = key;
          input.value = String(value);
          form.appendChild(input);
        }

        document.body.appendChild(form);
        form.submit();
        document.body.removeChild(form);
        return;
      }

      if (provider?.provider_type === 'acpay') {
        // Validate cardholder fields
        const cErrors: { name?: string; email?: string; phone?: string } = {};
        if (!cardHolderName.trim()) cErrors.name = '請輸入英文姓名';
        else if (!/^[a-zA-Z\s]+$/.test(cardHolderName.trim())) cErrors.name = '姓名須為英文字母';
        if (!cardHolderEmail.trim()) cErrors.email = '請輸入電子郵件';
        else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cardHolderEmail.trim())) cErrors.email = '電子郵件格式不正確';
        if (!cardHolderPhone.trim()) cErrors.phone = '請輸入手機號碼';
        else if (!/^\d{9,10}$/.test(cardHolderPhone.trim())) cErrors.phone = '手機號碼須為 9-10 位數字';
        if (Object.keys(cErrors).length > 0) {
          setCardFieldErrors(cErrors);
          return;
        }
        setCardFieldErrors({});

        let prime: string | null = null;
        const ACPay = (window as any).ACPay;
        if (ACPay && acpayFieldsRef.current) {
          try {
            const result = await new Promise<any>((resolve, reject) => {
              ACPay.getPrime(acpayFieldsRef.current, (primeResult: any) => {
                if (primeResult.status !== 0) {
                  reject(new Error(primeResult.msg || '取得 prime token 失敗'));
                } else {
                  resolve(primeResult);
                }
              });
            });
            prime = result.prime;
          } catch (e: any) {
            console.error('ACpay getPrime error:', e);
            setResultDialog({ open: true, success: false, message: e.message || '信用卡資訊有誤，請確認後重試' });
            return;
          }
        } else {
          console.warn('ACpay SDK not available, using simulate mode');
          prime = 'SIMULATE_PRIME';
        }

        const { data, error } = await supabase.functions.invoke('create-acpay-order', {
          body: {
            prime,
            amount: price,
            phone: cardHolderPhone,
            countryCode,
            cardHolderName,
            cardHolderEmail,
            planId: plan.id,
            billingCycle,
            userId: user.id,
            origin: window.location.origin,
            slug,
            planName: plan.name,
            expertName: expert.name,
          },
        });

        if (error) {
          console.error('ACpay checkout error:', error);
          setResultDialog({ open: true, success: false, message: '建立 ACpay 訂單失敗，請稍後再試' });
          return;
        }

        // 3DS flow: redirect to code_url for OTP
        if (data?.threeDS && data?.codeUrl) {
          window.location.href = data.codeUrl;
          return;
        }

        // non-3DS flow: synchronous success
        if (data?.success) {
          setResultDialog({ open: true, success: true });
          return;
        }

        setResultDialog({ open: true, success: false, message: '付款失敗，請稍後再試' });
        return;
      }

      // Other providers: simulate payment and create subscription directly
      const expiresAt = new Date();
      if (billingCycle === 'monthly') {
        expiresAt.setMonth(expiresAt.getMonth() + 1);
      } else {
        expiresAt.setFullYear(expiresAt.getFullYear() + 1);
      }

      const { error: subError } = await supabase
        .from('member_subscriptions')
        .insert({
          user_id: user.id,
          plan_id: plan.id,
          status: 'active',
          provider_id: selectedProvider,
          started_at: new Date().toISOString(),
          expires_at: expiresAt.toISOString(),
        });

      if (subError) throw subError;

      setResultDialog({ open: true, success: true });
    } catch (err: any) {
      console.error('Checkout error:', err);
      setResultDialog({ open: true, success: false, message: err.message || '請稍後再試' });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <PortalLayout hideAppEntry hideHeader>
      {/* Blocking overlay while confirming payment */}
      {isConfirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
        </div>
      )}
      <div className="container py-8 md:py-12">
        <div className="max-w-4xl mx-auto">
          {/* Back */}
          <Button variant="ghost" size="sm" className="mb-6 gap-2" asChild>
            <Link to={`/expert/${slug}${fromAccount ? '?from=account' : ''}#plans`}>
              <ArrowLeft className="h-4 w-4" />
              返回方案
            </Link>
          </Button>

          <h1 className="text-2xl md:text-3xl font-bold mb-8 text-center">確認訂閱</h1>

          {alreadySubscribed && (
            <Card className="mb-6 border-success/40 bg-success/5">
              <CardContent className="p-4 flex items-center gap-3">
                <Check className="h-5 w-5 text-success" />
                <span className="text-success font-medium">您已訂閱此方案，無需重複訂閱。</span>
                <Button variant="outline" size="sm" asChild className="ml-auto">
                  <Link to={`/expert/${slug}#plans`}>返回</Link>
                </Button>
              </CardContent>
            </Card>
          )}

          <div className="grid md:grid-cols-5 gap-8">
            {/* Left: Order Summary */}
            <div className="md:col-span-3 space-y-6">
              {/* Expert + Plan Info */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">訂閱內容</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-4">
                    <img
                      src={expert.avatar_url || '/placeholder.svg'}
                      alt={expert.name}
                      className="h-14 w-14 rounded-xl object-cover"
                    />
                    <div>
                      <span className="font-semibold">{expert.name}</span>
                      <p className="text-sm text-muted-foreground">{plan.name}</p>
                    </div>
                  </div>

                  <div className={cn(
                    "p-4 rounded-lg border-2",
                    isAdvisor ? "border-advisor/20 bg-advisor-light/30" : "border-mentor/20 bg-mentor-light/30"
                  )}>
                    <h3 className="font-semibold mb-2">{plan.name}</h3>
                    {plan.description && (
                      <p className="text-sm text-muted-foreground mb-4">{plan.description}</p>
                    )}
                    <ul className="space-y-2">
                      {(Array.isArray(plan.features) && (plan.features as any[]).filter((f: any) => typeof f === 'string' && f.trim()).length > 0
                        ? (plan.features as string[]).filter((f) => typeof f === 'string' && f.trim())
                        : getPlanFeatures(plan.plan_type)
                      ).map((feature, idx) => (
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
                          ? isAdvisor ? "border-primary bg-primary/5" : "border-mentor bg-mentor-light/30"
                          : isAdvisor ? "border-border hover:border-primary/50" : "border-border hover:border-mentor/50"
                      )}
                    >
                      <p className="font-semibold">月繳</p>
                      <p className="text-2xl font-bold mt-1">NT$ {formatPrice(plan.price_monthly)}</p>
                      <p className="text-sm text-muted-foreground">每月</p>
                    </button>
                    <button
                      disabled
                      className={cn(
                        "p-4 rounded-lg border-2 text-left transition-colors relative",
                        "border-border opacity-50 cursor-not-allowed"
                      )}
                    >
                      {plan.price_yearly && (
                        <Badge variant="secondary" className="absolute -top-2 -right-2 rotate-12">
                          省 {Math.round((1 - plan.price_yearly / (plan.price_monthly * 12)) * 100)}%
                        </Badge>
                      )}
                      <p className="font-semibold">年繳</p>
                      <p className="text-2xl font-bold mt-1">
                        NT$ {formatPrice(plan.price_yearly || plan.price_monthly * 12)}
                      </p>
                      <p className="text-sm text-muted-foreground">尚未開放</p>
                    </button>
                  </div>
                </CardContent>
              </Card>

              {/* Payment Method Selection */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">選擇付款方式</CardTitle>
                  <p className="text-xs text-muted-foreground">🧪 目前為沙盒測試模式</p>
                </CardHeader>
                <CardContent>
                  {providers.length === 0 ? (
                    <p className="text-sm text-muted-foreground">尚未設定可用的付款方式</p>
                  ) : (
                    <div className="space-y-3">
                      {providers.map(provider => (
                        <button
                          key={provider.id}
                          onClick={() => setSelectedProvider(provider.id)}
                          className={cn(
                            "w-full flex items-center gap-4 p-4 rounded-lg border-2 text-left transition-colors",
                            selectedProvider === provider.id
                              ? isAdvisor ? "border-primary bg-primary/5" : "border-mentor bg-mentor-light/30"
                              : isAdvisor ? "border-border hover:border-primary/50" : "border-border hover:border-mentor/50"
                          )}
                        >
                          <span className="text-2xl">{getProviderIcon(provider.provider_type)}</span>
                          <div className="flex-1">
                            <p className="font-semibold">{provider.display_name}</p>
                            <p className="text-xs text-muted-foreground">
                              {provider.provider_type === 'acpay' && '信用卡付款'}
                              {provider.provider_type === 'ecpay' && '信用卡 / ATM / 超商代碼'}
                              {provider.provider_type === 'line_pay' && 'LINE Pay 行動支付'}
                              {provider.provider_type === 'newebpay' && '信用卡 / WebATM'}
                            </p>
                          </div>
                          <div className={cn(
                            "w-5 h-5 rounded-full border-2 flex items-center justify-center",
                            selectedProvider === provider.id
                              ? isAdvisor ? "border-primary bg-primary" : "border-mentor bg-mentor"
                              : "border-muted-foreground/30"
                          )}>
                            {selectedProvider === provider.id && (
                              <Check className="h-3 w-3 text-primary-foreground" />
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* ACpay card fields — shown when ACpay is selected */}
              {isAcpay && (
                <Card>
                  <CardContent className="p-6 space-y-4">
                    <div className="flex items-center gap-2 mb-2">
                      <CreditCard className="h-4 w-4 text-muted-foreground" />
                      <h3 className="text-sm font-medium">信用卡資訊</h3>
                    </div>

                    {/* ACpay SDK renders card input fields here */}
                    <div ref={acpayCardRef} className="space-y-3">
                      <div>
                        <Label htmlFor="portal-acpay-card-number" className="text-xs text-muted-foreground">卡號</Label>
                        <div id="portal-acpay-card-number" className="h-10 border rounded-md border-input bg-background px-3 py-2" />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label htmlFor="portal-acpay-expiry" className="text-xs text-muted-foreground">有效日期</Label>
                          <div id="portal-acpay-expiry" className="h-10 border rounded-md border-input bg-background px-3 py-2" />
                        </div>
                        <div>
                          <Label htmlFor="portal-acpay-ccv" className="text-xs text-muted-foreground">安全碼</Label>
                          <div id="portal-acpay-ccv" className="h-10 border rounded-md border-input bg-background px-3 py-2" />
                        </div>
                      </div>
                    </div>

                    <div className="border-t pt-4 space-y-3">
                      <h4 className="text-xs font-medium text-muted-foreground">持卡人資訊</h4>
                      <div>
                        <Label htmlFor="portal-card-holder-name" className="text-xs text-muted-foreground">英文姓名（如卡片上所示）</Label>
                        <Input
                          id="portal-card-holder-name"
                          value={cardHolderName}
                          onChange={(e) => { setCardHolderName(e.target.value); setCardFieldErrors(prev => ({ ...prev, name: undefined })); }}
                          placeholder="WANG DA MING"
                          className={`mt-1 ${cardFieldErrors.name ? 'border-destructive' : ''}`}
                        />
                        {cardFieldErrors.name && <p className="text-xs text-destructive mt-1">{cardFieldErrors.name}</p>}
                      </div>
                      <div>
                        <Label htmlFor="portal-card-holder-email" className="text-xs text-muted-foreground">電子郵件</Label>
                        <Input
                          id="portal-card-holder-email"
                          type="email"
                          value={cardHolderEmail}
                          onChange={(e) => { setCardHolderEmail(e.target.value); setCardFieldErrors(prev => ({ ...prev, email: undefined })); }}
                          placeholder="example@mail.com"
                          className={`mt-1 ${cardFieldErrors.email ? 'border-destructive' : ''}`}
                        />
                        {cardFieldErrors.email && <p className="text-xs text-destructive mt-1">{cardFieldErrors.email}</p>}
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <Label htmlFor="portal-country-code" className="text-xs text-muted-foreground">國碼</Label>
                          <Input
                            id="portal-country-code"
                            value={countryCode}
                            onChange={(e) => setCountryCode(e.target.value)}
                            placeholder="886"
                            className="mt-1"
                          />
                        </div>
                        <div className="col-span-2">
                          <Label htmlFor="portal-card-holder-phone" className="text-xs text-muted-foreground">手機號碼（去掉前綴 0）</Label>
                          <Input
                            id="portal-card-holder-phone"
                            value={cardHolderPhone}
                            onChange={(e) => { setCardHolderPhone(e.target.value); setCardFieldErrors(prev => ({ ...prev, phone: undefined })); }}
                            placeholder="912345678"
                            className={`mt-1 ${cardFieldErrors.phone ? 'border-destructive' : ''}`}
                          />
                          {cardFieldErrors.phone && <p className="text-xs text-destructive mt-1">{cardFieldErrors.phone}</p>}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Right: Payment Summary */}
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
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">付款方式</span>
                    <span>{providers.find(p => p.id === selectedProvider)?.display_name || '-'}</span>
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

                  <Badge variant="outline" className="w-full justify-center py-1">
                    🧪 沙盒測試模式 — 不會實際扣款
                  </Badge>

                  {user ? (
                    <Button
                      className={cn("w-full", !isAdvisor && "bg-mentor hover:bg-mentor-dark")}
                      size="lg"
                      onClick={handleCheckout}
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
            </div>
          </div>

          {/* Compliance */}
          <div className="mt-8 text-center">
            <p className="text-xs text-muted-foreground">
              過去績效不代表未來表現，投資有風險，請謹慎評估。
            </p>
          </div>
        </div>
      </div>

      {/* Consent Dialog — content varies by plan type */}
      <Dialog open={consentOpen} onOpenChange={(open) => { if (!open) setConsentOpen(false); }}>
        <DialogContent className="max-w-lg max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{isAdvisor ? '跟單派使用者條款與風險揭露' : '修煉派使用者條款與學習聲明'}</DialogTitle>
          </DialogHeader>
          <ScrollArea className="flex-1 max-h-[60vh] pr-4">
            <div className="prose prose-sm dark:prose-invert text-sm space-y-4">
              {isAdvisor ? (
                <>
                  <p>在訂閱「跟單派」服務前，請詳閱以下內容。</p>
                  <p>當你勾選同意並開始使用本服務，即視為你已充分理解並接受本條款之全部內容。</p>

                  <h4 className="font-semibold mt-4">一、服務性質說明</h4>
                  <p>「跟單派」提供即時訊號、交易觀察、進出場紀錄、操作邏輯摘要及市場資訊整理。</p>
                  <p>本服務之目的在於協助使用者提升資訊取得效率，而非提供投資建議。</p>
                  <p>本服務不構成：</p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>投資建議</li>
                    <li>投資顧問服務</li>
                    <li>代操或資產管理服務</li>
                    <li>任何形式之收益或保本承諾</li>
                  </ul>
                  <p>使用者應依自身之資金狀況、風險承受能力及投資判斷，自行決定是否採取任何交易行為。</p>

                  <h4 className="font-semibold mt-4">二、結果差異說明</h4>
                  <p>即使參考相同之交易訊號，實際投資結果仍可能產生顯著差異，包括但不限於：</p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>訊號接收時間差異</li>
                    <li>下單價格與成交條件不同</li>
                    <li>部位規模與資金配置差異</li>
                    <li>停損、停利及加減碼策略不同</li>
                    <li>市場波動及流動性變化</li>
                    <li>使用者執行紀律與決策差異</li>
                  </ul>
                  <p>因此，本服務所提供之資訊，不應被視為可複製之投資成果。</p>

                  <h4 className="font-semibold mt-4">三、風險揭露</h4>
                  <p>所有投資行為均涉及風險，包括但不限於：</p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>本金損失風險</li>
                    <li>市場波動風險</li>
                    <li>個別標的突發事件風險</li>
                    <li>流動性風險</li>
                    <li>價格滑價與執行落差</li>
                    <li>使用者判斷錯誤之風險</li>
                  </ul>
                  <p>過往績效、歷史紀錄、案例展示或任何形式之數據分析，均不代表未來表現。</p>

                  <h4 className="font-semibold mt-4">四、責任界線</h4>
                  <p>使用本服務，即表示使用者確認並同意：</p>
                  <ol className="list-decimal pl-5 space-y-1">
                    <li>本平台僅提供資訊，不對任何投資結果作出保證。</li>
                    <li>所有交易決策由使用者自行獨立作出。</li>
                    <li>因使用本服務所產生之一切損益結果，均由使用者自行承擔。</li>
                    <li>本平台及相關內容提供者，不對任何直接或間接之損失負責。</li>
                  </ol>

                  <h4 className="font-semibold mt-4">五、非個人化聲明</h4>
                  <p>本服務未針對個別使用者之財務狀況、投資目標或風險承受能力提供個人化建議。</p>
                  <p>使用者不得將本平台內容視為適用於其個人情境之投資依據。</p>

                  <h4 className="font-semibold mt-4">六、即時性與技術限制</h4>
                  <p>本服務可能涉及即時通知與資料更新，但不保證：</p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>訊號即時送達</li>
                    <li>資料同步無延遲</li>
                    <li>系統持續穩定運作</li>
                  </ul>
                  <p>使用者應理解，技術性延遲、網路狀況或第三方服務限制，均可能影響資訊呈現。</p>

                  <h4 className="font-semibold mt-4">七、適用對象</h4>
                  <p>本服務適用於具備以下條件之使用者：</p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>已理解投資風險之存在</li>
                    <li>能自行判斷與承擔投資決策後果</li>
                    <li>不以本服務作為唯一決策依據</li>
                  </ul>
                  <p>若使用者期待保證收益、固定報酬或完全複製績效，本服務不適用。</p>

                  <h4 className="font-semibold mt-4">八、使用規範</h4>
                  <p>使用者不得：</p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>未經授權轉載、轉售或散布本平台內容</li>
                    <li>冒用他人身分使用服務</li>
                    <li>將平台內容對外宣稱為投資建議或招攬工具</li>
                    <li>從事任何違法或不當用途</li>
                  </ul>
                  <p>違反者，平台有權終止服務且不另行退費。</p>

                  <h4 className="font-semibold mt-4">九、服務調整</h4>
                  <p>本平台得依營運需求調整服務內容、功能或條款，並保留修改或終止部分服務之權利。</p>

                  <h4 className="font-semibold mt-4">十、最終確認</h4>
                  <p>在使用本服務前，請確認：</p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>已理解本服務不構成投資建議</li>
                    <li>已理解投資結果具有不確定性</li>
                    <li>已理解所有決策與風險由本人承擔</li>
                  </ul>
                </>
              ) : (
                <>
                  <p>在訂閱「修煉派」服務前，請詳閱以下內容。</p>
                  <p>當你勾選同意並開始使用本服務，即視為你已充分理解並接受本條款之全部內容。</p>

                  <h4 className="font-semibold mt-4">一、服務性質說明</h4>
                  <p>「修煉派」提供交易紀錄、操作思路拆解、策略邏輯說明及相關市場觀察。</p>
                  <p>本服務之目的在於協助使用者理解交易方法與決策過程，而非提供即時操作指引。</p>
                  <p>本服務不構成：</p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>投資建議</li>
                    <li>投資顧問服務</li>
                    <li>即時進出場指示</li>
                    <li>任何形式之收益或績效保證</li>
                  </ul>
                  <p>使用者應將本服務視為學習與參考資料，而非直接操作依據。</p>

                  <h4 className="font-semibold mt-4">二、學習與結果差異</h4>
                  <p>理解交易方法與實際獲得投資成果，屬於不同層次之能力。</p>
                  <p>即使使用者已閱讀或理解相關內容，其實際操作結果仍可能產生顯著差異，原因包括但不限於：</p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>對策略理解程度不同</li>
                    <li>市場環境變化（與原案例不同）</li>
                    <li>資金規模與風險承受能力差異</li>
                    <li>操作節奏與執行紀律不同</li>
                    <li>情緒管理與決策偏差</li>
                  </ul>
                  <p>因此，本服務所提供之內容，不應被視為可直接複製之投資成果或操作方法。</p>

                  <h4 className="font-semibold mt-4">三、風險揭露</h4>
                  <p>使用本服務進行學習與後續實際交易，仍涉及投資風險，包括但不限於：</p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>本金損失風險</li>
                    <li>市場波動風險</li>
                    <li>策略失效或不適用之風險</li>
                    <li>使用者理解錯誤或應用不當之風險</li>
                  </ul>
                  <p>過往案例、紀錄、分析內容或方法說明，均不代表未來市場情況或個人結果。</p>

                  <h4 className="font-semibold mt-4">四、責任界線</h4>
                  <p>使用本服務，即表示使用者確認並同意：</p>
                  <ol className="list-decimal pl-5 space-y-1">
                    <li>本平台僅提供學習與資訊內容，不對任何投資結果作出保證。</li>
                    <li>使用者對於內容之理解、應用與轉化，均屬個人行為。</li>
                    <li>所有實際交易決策與其結果，均由使用者自行負責。</li>
                    <li>本平台及相關內容提供者，不對任何直接或間接之損失負責。</li>
                  </ol>

                  <h4 className="font-semibold mt-4">五、非個人化聲明</h4>
                  <p>本服務未針對個別使用者之財務狀況、投資目標或風險承受能力提供個人化建議。</p>
                  <p>所有內容僅為一般性觀點與方法分享，不應被視為適用於特定個人之策略。</p>

                  <h4 className="font-semibold mt-4">六、內容性質與限制</h4>
                  <p>本服務所提供之交易紀錄、案例與策略說明：</p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>可能來自特定時間點之市場條件</li>
                    <li>不保證在未來市場中持續有效</li>
                    <li>不代表完整策略或所有決策細節</li>
                  </ul>
                  <p>使用者應理解，任何策略或方法均存在適用範圍與限制。</p>

                  <h4 className="font-semibold mt-4">七、適用對象</h4>
                  <p>本服務適用於：</p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>希望建立自身交易邏輯與判斷能力之使用者</li>
                    <li>能接受學習過程需要時間與反覆驗證</li>
                    <li>能承擔策略嘗試與調整過程中的損益波動</li>
                  </ul>
                  <p>若使用者期待：</p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>立即可用之操作指引</li>
                    <li>穩定或可預測之投資成果</li>
                    <li>無需理解即可套用之方法</li>
                  </ul>
                  <p>則本服務不適用。</p>

                  <h4 className="font-semibold mt-4">八、使用規範</h4>
                  <p>使用者不得：</p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>未經授權轉載、轉售或散布本平台內容</li>
                    <li>將平台內容包裝為個人投資建議對外提供</li>
                    <li>誤導他人認為本服務可保證成果</li>
                    <li>從事任何違法或不當用途</li>
                  </ul>
                  <p>違反者，平台有權終止服務且不另行退費。</p>

                  <h4 className="font-semibold mt-4">九、服務調整</h4>
                  <p>本平台得依營運需求調整內容形式、策略分享方式或服務範圍，並保留修改或終止部分服務之權利。</p>

                  <h4 className="font-semibold mt-4">十、最終確認</h4>
                  <p>在使用本服務前，請確認：</p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>已理解本服務屬於學習性質，而非操作指引</li>
                    <li>已理解方法學習不等於可直接複製成果</li>
                    <li>已理解所有決策與風險由本人承擔</li>
                  </ul>
                </>
              )}
            </div>
          </ScrollArea>
          <div className="border-t pt-4 space-y-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <Checkbox
                checked={consentChecked}
                onCheckedChange={(checked) => setConsentChecked(checked === true)}
                className="mt-0.5"
              />
              <span className="text-sm leading-relaxed">
                {isAdvisor
                  ? '我已閱讀並同意以上條款，並願意自行承擔所有投資風險後使用「跟單派」服務'
                  : '我已閱讀並同意以上條款，並理解「學習不等於保證成果」後使用「修煉派」服務'}
              </span>
            </label>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConsentOpen(false)}>取消</Button>
              <Button
                className={cn(isAdvisor ? "" : "bg-mentor hover:bg-mentor-dark")}
                disabled={!consentChecked}
                onClick={() => {
                  setConsentOpen(false);
                  proceedCheckout();
                }}
              >
                同意並前往付款
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>


      <AlertDialog open={resultDialog?.open ?? false} onOpenChange={() => {}}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              {resultDialog?.success ? (
                <><CheckCircle className="h-5 w-5 text-green-500" />訂閱成功 🎉</>
              ) : (
                <><XCircle className="h-5 w-5 text-destructive" />訂閱失敗</>
              )}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 pt-2">
                <div className="flex items-center gap-3">
                  <img
                    src={expert?.avatar_url || '/placeholder.svg'}
                    alt={expert?.name}
                    className="h-10 w-10 rounded-full object-cover"
                  />
                  <div>
                    <p className="font-medium text-foreground">{expert?.name}</p>
                    <p className="text-sm text-muted-foreground">{plan?.name}</p>
                  </div>
                </div>
                <div className="text-sm space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">付款週期</span>
                    <span className="text-foreground">{billingCycle === 'monthly' ? '月繳' : '年繳'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">金額</span>
                    <span className="text-foreground font-medium">NT$ {formatPrice(price)}</span>
                  </div>
                </div>
                {resultDialog?.success ? (
                  <p className="text-sm text-muted-foreground">您現在可以前往帳號頁面綁定 LINE 以接收即時通知。</p>
                ) : (
                  <p className="text-sm text-destructive">{resultDialog?.message || '付款處理時發生錯誤，請稍後再試。'}</p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
              <AlertDialogAction
                onClick={() => {
                  if (resultDialog?.success) {
                    navigate('/app/account');
                  } else {
                    setResultDialog(null);
                  }
                }}
                className={cn(!isAdvisor && "bg-mentor hover:bg-mentor/90")}
              >
                {resultDialog?.success ? '前往帳號頁' : '重試'}
              </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PortalLayout>
  );
};

export default Checkout;
